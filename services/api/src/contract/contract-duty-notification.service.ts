import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import type { AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { ConflictException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog, type ApprovalInstance, type Contract, type ContractSealTask, type ContractVersion } from "@prisma/client";
import { createHash } from "node:crypto";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { CONTRACT_PARALLEL_DUTY_RESOURCE, contractParallelDutyId, contractParallelDutyIdentity, contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "./contract-parallel-duty-access";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";

const KIND = "contract_v2_inside_duty_notification";
type Stage = "approval" | "seal" | "archive" | "correction";
type Version = Pick<ContractVersion, "id" | "numericProtocolVersion" | "signingSubjectType" | "status">;
type Task = Pick<ContractSealTask, "id" | "status" | "handlerUserId">;
type ContractNoticeStatus = AuditDutyNoticeStatus & {dutyName:string};
const digest = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify([KIND, ...parts])).digest("hex");

@Injectable()
export class ContractDutyNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContractDutyNotificationService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  static supports(version: Version) {
    return version.numericProtocolVersion === 2 && version.signingSubjectType === "our_company";
  }

  /** 驳回/退回修改只提醒原申请人，与用章主体是否本公司无关。 */
  static supportsCorrection(version: Version) {
    return version.numericProtocolVersion === 2;
  }

  private stage(version: Version, round: ApprovalInstance, task?: Task): Stage | null {
    if (round.businessType !== "contract_version" ||
        round.businessId !== version.id || round.flowType !== "contract.approve" || !isParallelApprovalRound(round.frozenNodes)) return null;
    if (version.status === "draft" && round.status === "rejected") return "correction";
    if (!ContractDutyNotificationService.supports(version)) return null;
    if (version.status === "in_approval" && round.status === "in_progress") return "approval";
    if (round.status !== "approved" || task?.handlerUserId !== round.applicantUserId) return null;
    if (version.status === "approved_pending_seal" && task.status === "in_seal") return "seal";
    if (version.status === "seal_approved_pending_archive" && task.status === "completed") return "archive";
    return null;
  }

  private async candidates(tx: Prisma.TransactionClient, contract: Contract, round: ApprovalInstance, stage: Stage, index: number) {
    if (stage === "archive") return [round.applicantUserId];
    const nodes = isParallelApprovalRound(round.frozenNodes) ? round.frozenNodes : [];
    const keys = stage === "seal" ? ["comprehensive_director"] : nodes[index]?.roleKeys as string[] ?? [];
    const positions = await tx.position.findMany({ where: { key: { in: keys } }, select: { id: true } });
    const now = new Date();
    const [assignments, memberships, delegations] = await Promise.all([
      tx.userPosition.findMany({ where: { positionId: { in: positions.map(row => row.id) },
        ...(stage === "seal" ? { projectId: null } : { OR: [{ projectId: null }, { projectId: contract.projectId }] }) }, select: { userId: true } }),
      stage === "approval" ? tx.projectMember.findMany({
        where: { projectId: contract.projectId, positionKey: { in: keys } }, select: { userId: true }
      }) : [],
      stage === "approval" ? tx.approvalDelegation.groupBy({
        by: ["toUserId"],
        where: { enabled: true, actionKey: "contract.approve", resourceType: CONTRACT_PARALLEL_DUTY_RESOURCE,
          resourceId: contractParallelDutyId(round.id, index), startsAt: { lte: now }, endsAt: { gt: now } }
      }) : []
    ]);
    return [...new Set([...assignments.map(row => row.userId), ...memberships.map(row => row.userId), ...delegations.map(row => row.toUserId)])];
  }

  private async authorized(tx: Prisma.TransactionClient, contract: Contract, round: ApprovalInstance, stage: Stage, index: number, actor: string) {
    if (stage === "approval") return Boolean(await contractParallelDutyIdentity(tx, round, contract.projectId, actor, index, false));
    if (stage === "seal") return hasActiveContractGlobalRole(tx, actor, "comprehensive_director");
    if (stage === "correction") return actor === round.applicantUserId && contract.ownerUserId === round.applicantUserId;
    return actor === contract.ownerUserId && (await resolveGovernedFinalArchiveAccess(tx, {
      actorUserId: actor, projectId: contract.projectId, handlerUserId: round.applicantUserId
    })).canUpload;
  }

  async queueNewApprovalDuties(tx: Prisma.TransactionClient, recipientId: string, roundIds: string[]) {
    const rounds = await tx.approvalInstance.findMany({
      where: { id: { in: roundIds }, status: "in_progress", businessType: "contract_version", flowType: "contract.approve" }
    });
    for (const round of rounds) {
      const version = await tx.contractVersion.findUnique({ where: { id: round.businessId } });
      if (!version || this.stage(version, round) !== "approval") continue;
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      if (contract?.code) await this.queue(tx, contract, version, round, contract.code, undefined, recipientId);
    }
  }

  async queue(tx: Prisma.TransactionClient, contract: Contract, version: Version, round: ApprovalInstance, code: string, task?: Task, recipientId?: string) {
    const stage = this.stage(version, round, task);
    if (!stage || (stage !== "approval" && contract.ownerUserId !== round.applicantUserId) || contract.voidedAt || !(await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } }))?.isActive) return;
    const nodes = isParallelApprovalRound(round.frozenNodes) ? round.frozenNodes : [];
    const indexes = stage === "approval" ? activeApprovalNodeIndexes(nodes, round.currentNodeIndex) : [-1];
    const intents: Prisma.AuditLogCreateManyInput[] = [];
    for (const index of indexes) {
      for (const actor of await this.candidates(tx, contract, round, stage, index)) {
        if (recipientId && actor !== recipientId) continue;
        if (!await this.authorized(tx, contract, round, stage, index, actor)) continue;
        const dutyName = stage === "approval" ? String(nodes[index].name) : stage === "seal" ? "确认已盖章" : "上传双方签章原件归档";
        intents.push({ id: digest(round.id, stage, index, actor), businessType: KIND, businessId: round.id, actorUserId: round.applicantUserId,
          action: "queued", metadata: { kind: KIND, event: "queued", stage, nodeIndex: index, recipientId: actor,
            dutyName, businessCode: code, contractVersionId: version.id, sealTaskId: task?.id ?? null } });
      }
    }
    if (intents.length) await tx.auditLog.createMany({ data: intents, skipDuplicates: true });
  }

  /** 最终驳回/退回后只提醒原申请人修改重提，共用同一 claimed/terminal 幂等与失败重试。 */
  async queueCorrection(tx: Prisma.TransactionClient, contract: Contract, version: Version, round: ApprovalInstance, code: string) {
    if (!ContractDutyNotificationService.supportsCorrection(version) || this.stage(version, round) !== "correction" ||
        contract.voidedAt || contract.ownerUserId !== round.applicantUserId) return;
    if (!(await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } }))?.isActive) return;
    const recipientId = round.applicantUserId;
    await tx.auditLog.createMany({ skipDuplicates: true, data: [{
      id: digest(round.id, "correction", -1, recipientId), businessType: KIND, businessId: round.id,
      actorUserId: recipientId, action: "queued",
      metadata: { kind: KIND, event: "queued", stage: "correction", nodeIndex: -1, recipientId,
        dutyName: "审批退回，请修改后重新提交", businessCode: code, contractVersionId: version.id, sealTaskId: null }
    }] });
  }

  async afterCommit(attemptId?:string) {
    if (!this.sms.available()) return;
    try {
      const events = await this.prisma.$queryRaw<AuditLog[]>(Prisma.sql`
        SELECT queued.* FROM "AuditLog" queued
        WHERE queued."businessType" = ${KIND} AND queued."action" = 'queued'
          ${attemptId ? Prisma.sql`AND queued."id"=${attemptId}`:Prisma.empty}
          AND NOT EXISTS (SELECT 1 FROM "AuditLog" receipt
            WHERE receipt."businessType" = ${KIND}
              AND receipt."metadata"->>'intentId' = queued."id")
        ORDER BY queued."createdAt", queued."id" LIMIT 100
      `);
      for (const intent of events) await this.dispatch(intent);
    } catch {
      this.logger.warn("合同待办短信暂未完成，保留记录以供核对");
    }
  }

  private async lockVersion(tx:Prisma.TransactionClient,versionId:string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${versionId} FOR UPDATE`);
  }

  private async currentMessage(tx:Prisma.TransactionClient,intent:AuditLog,strict:boolean) {
    const roundId=intent.businessId;
    const data=intent.metadata as Prisma.JsonObject|null;
    if(!roundId || !data || intent.businessType!==KIND || intent.action!=="queued" ||
      data.kind!==KIND || data.event!=="queued" || typeof data.contractVersionId!=="string" ||
      typeof data.recipientId!=="string" || typeof data.dutyName!=="string")return null;
    const [version,round]=await Promise.all([
      tx.contractVersion.findUnique({where:{id:data.contractVersionId}}),
      tx.approvalInstance.findUnique({where:{id:roundId}})
    ]);
    if(!version || !round || !version.contractId)return null;
    const contract=await tx.contract.findUnique({where:{id:version.contractId}});
    const task=typeof data.sealTaskId==="string" ? await tx.contractSealTask.findUnique({where:{id:data.sealTaskId}}):null;
    const stage=this.stage(version,round,task??undefined),actor=data.recipientId,index=Number(data.nodeIndex);
    if(!stage || stage!==data.stage || !contract?.code || contract.voidedAt ||
      (task && (task.approvalInstanceId!==round.id || task.contractVersionId!==version.id || contract.ownerUserId!==round.applicantUserId)))return null;
    if(strict) {
      if(stage==="correction") {
        // 只有仍是最新一轮退回才提醒；已重提或已撤回的旧轮不再打扰申请人。
        const latest=await tx.approvalInstance.findFirst({where:{businessType:"contract_version",businessId:version.id,flowType:"contract.approve"},
          orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true}});
        if(latest?.id!==round.id)return null;
      } else {
        const snapshot=contractRoundSubmissionSnapshot(round.frozenNodes);
        if(!snapshot || snapshot.contractVersionId!==version.id || snapshot.documentContentRevision!==version.documentContentRevision ||
           snapshot.documentContentFingerprint!==version.documentContentFingerprint)return null;
        if(stage==="approval") {
          const rounds=await tx.approvalInstance.findMany({where:{businessType:"contract_version",businessId:version.id,flowType:"contract.approve",status:"in_progress"},select:{id:true},take:2});
          if(rounds.length!==1 || rounds[0].id!==round.id)return null;
        } else {
          if(!task?.approvedByUserId || !task.approvedAt || activeApprovalNodeIndexes(round.frozenNodes,0).length)return null;
          if(stage==="archive" && (version.changeType!=="original" || version.supersedesVersionId || !task.completedByUserId || !task.completedAt))return null;
        }
      }
    }
    const project=await tx.project.findUnique({where:{id:contract.projectId},select:{isActive:true,name:true}});
    if(!project?.isActive || !await this.authorized(tx,contract,round,stage,index,actor))return null;
    const user=await tx.user.findUnique({where:{id:actor},select:{phone:true,isActive:true}});
    if(!user?.isActive)return null;
    const applicant=await tx.user.findUnique({where:{id:round.applicantUserId},select:{name:true}});
    const message:ApprovalDutySmsIntent={
      businessLabel:stage==="correction"?"合同退回修改":"合同待办",dutyName:data.dutyName,businessCode:contract.code,
      scopeName:project.name,initiatorName:applicant?.name??"发起人待核对",subject:contract.name,
      participants:[version.companyEntityNameSnapshot??contract.companyEntityName,contract.counterparty].filter((name):name is string=>Boolean(name)),
      amountText:version.amountYuan!=null&&version.amountLimitType!=="uncapped"?`${version.amountYuan.toFixed(4)} 元`:"金额待确定",
      targetPath:approvalDutyTarget("contract",contract.code)
    };
    return {phone:user.phone??"",message};
  }

  private async dispatch(intent: AuditLog) {
    const data=intent.metadata as Prisma.JsonObject|null;
    if(!intent.businessId || typeof data?.contractVersionId!=="string")return;
    const versionId=data.contractVersionId;
    const claim=await this.prisma.$transaction(async tx=>{
      await this.lockVersion(tx,versionId);
      const handled=await tx.auditLog.findMany({where:{id:{in:[digest(intent.id,"claim"),digest(intent.id,"terminal")]}},select:{id:true}});
      if(handled.length)return null;
      if(typeof data.retryOf==="string") {
        const original=typeof data.originalId==="string" ? await tx.auditLog.findUnique({where:{id:data.originalId}}):null;
        const prior=await tx.auditLog.findUnique({where:{id:data.retryOf}});
        if(!original || !prior || !this.sameDuty(original,prior) || !this.matchesRetry(intent,original,prior.id) ||
          (await this.statusOf(tx,prior)).status!=="failed")return null;
      }
      const target=await this.currentMessage(tx,intent,typeof data.retryOf==="string");
      if(!target) {
        await this.record(tx,intent,"cancelled");
        return null;
      }
      return (await this.record(tx,intent,"dispatch_claimed")).count===1?target:null;
    });
    if(!claim)return;
    const result=await this.sms.sendDutyIntent(claim.phone,claim.message).catch(()=>({status:"unknown" as const}));
    await this.record(this.prisma,intent,result.status);
  }

  private sameDuty(origin:AuditLog,candidate:AuditLog) {
    const root=origin.metadata as Prisma.JsonObject|null,next=candidate.metadata as Prisma.JsonObject|null;
    return candidate.businessType===KIND && candidate.action==="queued" && candidate.businessId===origin.businessId &&
      candidate.actorUserId===origin.actorUserId && Boolean(root&&next&&
        ["kind","event","stage","nodeIndex","recipientId","contractVersionId","sealTaskId","dutyName","businessCode"]
          .every(field=>root[field]===next[field]));
  }

  private matchesRetry(candidate:AuditLog,origin:AuditLog,priorId:string) {
    const data=candidate.metadata as Prisma.JsonObject|null;
    const root=origin.metadata as Prisma.JsonObject|null;
    return root && root.retryOf===undefined && origin.id===digest(origin.businessId,root.stage,root.nodeIndex,root.recipientId) &&
      candidate.id===digest(priorId,"retry") && data?.originalId===origin.id && data?.retryOf===priorId && this.sameDuty(origin,candidate);
  }

  private async statusOf(tx:Prisma.TransactionClient,attempt:AuditLog):Promise<ContractNoticeStatus> {
    const claimId=digest(attempt.id,"claim"),terminalId=digest(attempt.id,"terminal");
    const events=await tx.auditLog.findMany({where:{id:{in:[claimId,terminalId]}}});
    const event=(id:string)=>events.find(row=>{
      const data=row.metadata as Prisma.JsonObject|null;
      return row.id===id && row.businessType===KIND && row.businessId===attempt.businessId &&
        data?.kind===KIND && data?.intentId===attempt.id && data?.event===row.action;
    })?.action;
    const terminal=event(terminalId);
    let status:AuditDutyNoticeStatus["status"]="unknown";
    if(!events.length)status="queued";
    else if(terminal==="cancelled")status="cancelled";
    else if(event(claimId)==="dispatch_claimed" && (terminal==="failed" || terminal==="accepted"))status=terminal;
    return {attemptId:attempt.id,status,canRetry:status==="failed"&&this.sms.available(),
      dutyName:String((attempt.metadata as Prisma.JsonObject).dutyName)};
  }

  private async currentNoticeAttempts(tx:Prisma.TransactionClient,versionId:string,actor:string) {
    const rows=await tx.$queryRaw<AuditLog[]>(Prisma.sql`
      SELECT queued.* FROM "AuditLog" queued
      WHERE queued."businessType"=${KIND} AND queued."action"='queued'
        AND queued."metadata"->>'contractVersionId'=${versionId} AND queued."metadata"->>'recipientId'=${actor}
      ORDER BY queued."createdAt",queued."id"
    `);
    const byId=new Map(rows.map(row=>[row.id,row]));
    const notices=[];
    for(const origin of rows) {
      const data=origin.metadata as Prisma.JsonObject|null;
      if(!data || data.retryOf!==undefined || data.contractVersionId!==versionId || data.recipientId!==actor ||
        origin.id!==digest(origin.businessId,data.stage,data.nodeIndex,actor) || !await this.currentMessage(tx,origin,true))continue;
      let status=await this.statusOf(tx,origin);
      while(status.status==="failed") {
        const next=byId.get(digest(status.attemptId,"retry"));
        if(!next || !this.matchesRetry(next,origin,status.attemptId))break;
        status=await this.statusOf(tx,next);
      }
      notices.push({origin,status});
    }
    return {notices,byId};
  }

  async notificationStatus(versionId:string,actor:string) {
    return this.prisma.$transaction(async tx=>(await this.currentNoticeAttempts(tx,versionId,actor)).notices.map(row=>row.status));
  }

  async retry(versionId:string,actor:string,attemptId:string):Promise<ContractNoticeStatus> {
    const result=await this.prisma.$transaction(async tx=>{
      await this.lockVersion(tx,versionId);
      const {notices,byId}=await this.currentNoticeAttempts(tx,versionId,actor);
      const id=digest(attemptId,"retry");
      const previous=byId.get(id);
      const current=notices.find(item=>item.status.attemptId===attemptId ||
        (previous && this.matchesRetry(previous,item.origin,attemptId)));
      if(!current)throw new ConflictException("当前待办或短信记录已变化，请刷新");
      if(current.status.attemptId!==attemptId)return {status:current.status,enqueued:false};
      if(!current.status.canRetry)throw new ConflictException("仅确认发送失败的短信可以重试");
      const written=await tx.auditLog.createMany({skipDuplicates:true,data:[{
        id,businessType:KIND,businessId:current.origin.businessId,actorUserId:current.origin.actorUserId,action:"queued",
        metadata:{...current.origin.metadata as Prisma.InputJsonObject,originalId:current.origin.id,retryOf:attemptId}
      }]});
      return {status:{attemptId:id,status:"queued" as const,canRetry:false,dutyName:current.status.dutyName},enqueued:written.count===1};
    });
    if(result.enqueued)void this.afterCommit(result.status.attemptId);
    return result.status;
  }

  private record(tx: Pick<Prisma.TransactionClient, "auditLog">, intent: AuditLog, event: string) {
    return tx.auditLog.createMany({ skipDuplicates: true, data: [{
      id: digest(intent.id, event === "dispatch_claimed" ? "claim" : "terminal"), businessType: KIND, businessId: intent.businessId,
      action: event, actorUserId: intent.actorUserId, metadata: { kind: KIND, event, intentId: intent.id }
    }] });
  }
}
