import { ConflictException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type ApprovalInstance, type AuditLog, type CompanyTransfer } from "@prisma/client";
import { auditDutyNoticeId, dispatchAuditDutyNotices, type AuditDutySmsMessage, type AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { companyTransferDutyTarget } from "../approval/approval-duty-sms-intent";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { loadProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { companyTransferCashAccess, companyTransferFinanceRoles, companyTransferRoles } from "./company-transfer.access";
import { companyTransferCorrectionDutyLabel, currentCompanyTransferCorrectionDuties } from "./company-transfer-correction-duty";
import { companyRepaymentApprovals } from "./company-transfer-repayment-approval";
import { companyTransferFinalReviewer, currentCompanyTransferCashDuties, lockCompanyTransfers } from "./company-transfer.domain";

const finalReviewKind = "company_transfer_final_review_duty_notification";
const cashDutyKind = "company_transfer_cash_duty_notification";
const correctionKind = "company_transfer_correction_duty_notification";
type NoticeKind = typeof finalReviewKind | typeof cashDutyKind | typeof correctionKind;
type CompanyTransferNotice = AuditDutyNoticeStatus & { dutyName:string };
const noticeMetadata = (row:AuditLog|null|undefined) => (row?.metadata ?? {}) as Prisma.JsonObject;
const noticeKind = (kind:string|null):kind is NoticeKind=>kind===finalReviewKind || kind===cashDutyKind || kind===correctionKind;

function originalNoticeId(row:AuditLog) {
  const data=noticeMetadata(row);
  if(row.action!=="queued" || !row.businessId || typeof data.recipientId!=="string" || data.retryOf!==undefined)return null;
  if(row.businessType===finalReviewKind && typeof data.roundId==="string") {
    if (data.nodeIndex === undefined) return auditDutyNoticeId(finalReviewKind,data.roundId,data.recipientId);
    if (typeof data.nodeIndex === "number" && Number.isInteger(data.nodeIndex) && data.nodeIndex >= 0) {
      return auditDutyNoticeId(finalReviewKind,data.roundId,String(data.nodeIndex),data.recipientId);
    }
    return null;
  }
  if ((row.businessType===cashDutyKind || row.businessType===correctionKind) && typeof data.key==="string") {
    return auditDutyNoticeId(row.businessType,row.businessId,data.key,data.recipientId);
  }
  return null;
}

function matchesRetry(row:AuditLog,origin:AuditLog,previousId:string,kind:NoticeKind) {
  const data=noticeMetadata(row), prior=noticeMetadata(origin);
  return row.id===auditDutyNoticeId(kind,previousId,"retry") && row.businessType===kind && origin.businessType===kind &&
    row.businessId===origin.businessId && row.action==="queued" && data.retryOf===previousId && data.originalId===origin.id &&
    data.recipientId===prior.recipientId && data.roundId===prior.roundId && data.key===prior.key && data.nodeIndex===prior.nodeIndex;
}
const cashEventSelect = {id:true,kind:true,amountCents:true,outgoingEventId:true,returnedIncomingEventId:true,recordedByUserId:true,createdAt:true} as const;
const transferSelect = {
  id:true,status:true,approvalInstanceId:true,applicantUserId:true,code:true,amountCents:true,
  frozenParties:true,sourceProjectId:true,destinationProjectId:true,approvedAt:true,createdAt:true,requiresParallelRepaymentApproval:true,originalTransferId:true,originalProxyId:true,
  originalFundMovementRelationshipId:true,originalInterEntityRelationshipId:true,originalOperationalPaymentId:true
} as const;
type TransferSummary = Prisma.CompanyTransferGetPayload<{select:typeof transferSelect}>;
type TransferCashDuty = Pick<TransferSummary,"id"|"status"|"amountCents"|"approvedAt"|"createdAt"|
  "sourceProjectId"|"destinationProjectId"|"requiresParallelRepaymentApproval">;
type TransferDuty = Pick<CompanyTransfer,"id"|"status"|"approvalInstanceId"|"applicantUserId">;

@Injectable()
export class CompanyTransferNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(CompanyTransferNotificationService.name);

  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService,
    private readonly visibility: ProjectVisibilityService = new ProjectVisibilityService(prisma)) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queueFinalReview(tx: Prisma.TransactionClient, transfer: TransferDuty, round: ApprovalInstance, candidates: readonly string[]) {
    const recipients = [];
    for (const recipientId of new Set(candidates)) {
      if (companyTransferFinalReviewer(transfer,round,recipientId,await companyTransferRoles(tx,recipientId))) recipients.push(recipientId);
    }
    if (recipients.length) await tx.auditLog.createMany({skipDuplicates:true,data:recipients.map(recipientId=>({
      id:auditDutyNoticeId(finalReviewKind,round.id,recipientId),actorUserId:transfer.applicantUserId,action:"queued",
      businessType:finalReviewKind,businessId:transfer.id,metadata:{recipientId,roundId:round.id}
    }))});
  }

  async queueParallelReview(tx: Prisma.TransactionClient, transfer: TransferSummary, round: ApprovalInstance) {
    if (!this.isCurrentParallelRound(transfer, round)) return;
    const data: Prisma.AuditLogCreateManyInput[] = [];
    for (const nodeIndex of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
      const node = round.frozenNodes[nodeIndex];
      const roleKeys = node.roleKeys as string[];
      const global = await tx.position.findMany({where:{key:{in:roleKeys.filter(role => role !== "project_manager")}},select:{id:true}});
      const globalHolders = global.length ? await tx.userPosition.findMany({
        where:{projectId:null,positionId:{in:global.map(row=>row.id)}},select:{userId:true}
      }) : [];
      const projectHolders = roleKeys.includes("project_manager")
        ? await loadProjectApprovalAssignments(tx,transfer.sourceProjectId!,["project_manager"]) : [];
      for (const recipientId of new Set([...globalHolders,...projectHolders].map(row=>row.userId))) {
        if (!(await companyRepaymentApprovals(tx,this.visibility,recipientId,transfer.sourceProjectId!,
          transfer.applicantUserId,round.frozenNodes,round.currentNodeIndex)).some(duty=>duty.nodeIndex===nodeIndex)) continue;
        data.push({id:auditDutyNoticeId(finalReviewKind,round.id,String(nodeIndex),recipientId),actorUserId:transfer.applicantUserId,
          action:"queued",businessType:finalReviewKind,businessId:transfer.id,metadata:{recipientId,roundId:round.id,nodeIndex}});
      }
    }
    if (data.length) await tx.auditLog.createMany({skipDuplicates:true,data});
  }

  private isCurrentParallelRound(transfer: TransferSummary, round: ApprovalInstance | null):
    round is ApprovalInstance & {frozenNodes: Record<string, unknown>[]} {
    return Boolean(transfer.requiresParallelRepaymentApproval && transfer.sourceProjectId &&
      transfer.sourceProjectId===transfer.destinationProjectId && transfer.status==="submitted" && round &&
      round.id===transfer.approvalInstanceId && round.businessId===transfer.id && round.applicantUserId===transfer.applicantUserId &&
      round.businessType==="company_transfer" && round.flowType==="company_transfer.approve" &&
      round.status==="in_progress" && isParallelApprovalRound(round.frozenNodes));
  }

  async queueCashDuty(tx: Prisma.TransactionClient, transfer: TransferCashDuty, key: string, actorId: string) {
    const roles = transfer.requiresParallelRepaymentApproval && key==="outgoing"
      ? [...companyTransferFinanceRoles,"comprehensive_director"] : companyTransferFinanceRoles;
    const positions = await tx.position.findMany({where:{key:{in:roles}},select:{id:true}});
    const globals = await tx.userPosition.findMany({where:{projectId:null,positionId:{in:positions.map(row=>row.id)}},select:{userId:true}});
    const scoped = transfer.sourceProjectId && transfer.destinationProjectId
      ? await loadProjectApprovalAssignments(tx,transfer.sourceProjectId,companyTransferFinanceRoles) : [];
    const candidates = new Set([...globals,...scoped].map(row=>row.userId));
    const events=await tx.companyTransferEvent.findMany({where:{transferId:transfer.id},select:cashEventSelect});
    const recipients = [];
    for (const recipientId of candidates) {
      if (currentCompanyTransferCashDuties(transfer,events,recipientId).some(duty=>duty.key===key) &&
        await this.canHandleCashDuty(tx,transfer,recipientId,key)) recipients.push(recipientId);
    }
    if (recipients.length) await tx.auditLog.createMany({skipDuplicates:true,data:recipients.map(recipientId=>({
      id:auditDutyNoticeId(cashDutyKind,transfer.id,key,recipientId),actorUserId:actorId,action:"queued",
      businessType:cashDutyKind,businessId:transfer.id,metadata:{recipientId,key}
    }))});
  }

  async queueCorrectionDuty(tx: Prisma.TransactionClient, transferId: string, eventId: string, actorId: string) {
    const transfer = await tx.companyTransfer.findUnique({where:{id:transferId},select:transferSelect});
    if (!transfer || !await this.correctionDuty(tx,transfer,eventId)) return;
    const positions = await tx.position.findMany({where:{key:"finance_director"},select:{id:true}});
    const assignments = await tx.userPosition.findMany({
      where:{projectId:null,positionId:{in:positions.map(row=>row.id)}},select:{userId:true},
    });
    const data: Prisma.AuditLogCreateManyInput[] = [];
    for (const recipientId of new Set(assignments.map(row=>row.userId))) {
      if (!(await companyTransferRoles(tx,recipientId)).includes("finance_director")) continue;
      data.push({id:auditDutyNoticeId(correctionKind,transfer.id,eventId,recipientId),actorUserId:actorId,action:"queued",
        businessType:correctionKind,businessId:transfer.id,metadata:{recipientId,key:eventId}});
    }
    if (data.length) await tx.auditLog.createMany({skipDuplicates:true,data});
  }

  private async correctionDuty(tx: Prisma.TransactionClient,transfer: TransferSummary,eventId:string) {
    const events = await tx.companyTransferEvent.findMany({where:{transferId:transfer.id,
      OR:[{id:eventId},{outgoingEventId:eventId}]},select:cashEventSelect});
    return (await currentCompanyTransferCorrectionDuties(tx,transfer,events)).find(item=>item.event.id===eventId);
  }

  private async currentCorrectionMessage(tx: Prisma.TransactionClient,intent: AuditLog) {
    const {recipientId,key} = noticeMetadata(intent);
    if (!intent.businessId || typeof recipientId!=="string" || typeof key!=="string" ||
      !(await companyTransferRoles(tx,recipientId)).includes("finance_director")) return null;
    const transfer = await tx.companyTransfer.findUnique({where:{id:intent.businessId},select:transferSelect});
    const duty = transfer && await this.correctionDuty(tx,transfer,key);
    if (!transfer || !duty) return null;
    return this.message(tx,transfer,recipientId,duty.requestedByUserId,"原债更正确认",
      companyTransferCorrectionDutyLabel,duty.event.amountCents);
  }

  async afterCommit() {
    try {
      const lock = async(tx:Prisma.TransactionClient)=>{await lockCompanyTransfers(tx);};
      await dispatchAuditDutyNotices(this.prisma,this.sms,finalReviewKind,lock,(tx,intent)=>this.dispatchTarget(tx,intent));
      await dispatchAuditDutyNotices(this.prisma,this.sms,cashDutyKind,lock,(tx,intent)=>this.dispatchTarget(tx,intent));
      await dispatchAuditDutyNotices(this.prisma,this.sms,correctionKind,lock,(tx,intent)=>this.dispatchTarget(tx,intent));
    } catch {
      this.logger.warn("公司互转通知暂未完成，保留记录以供核对");
    }
  }

  private currentTarget(tx:Prisma.TransactionClient,row:AuditLog) {
    if (row.businessType === correctionKind) return this.currentCorrectionMessage(tx,row);
    if (row.businessType !== finalReviewKind) return this.currentCashMessage(tx,row);
    return noticeMetadata(row).nodeIndex === undefined ? this.currentMessage(tx,row) : this.currentParallelMessage(tx,row);
  }

  private async dispatchTarget(tx:Prisma.TransactionClient,row:AuditLog) {
    const kind=row.businessType;
    const data=noticeMetadata(row);
    if(!noticeKind(kind))return null;
    if(typeof data.retryOf==="string" && typeof data.originalId==="string") {
      const [origin,prior]=await Promise.all([
        tx.auditLog.findUnique({where:{id:data.originalId}}),
        tx.auditLog.findUnique({where:{id:data.retryOf}})
      ]);
      const previousId=noticeMetadata(prior).retryOf;
      if(!origin || !prior || originalNoticeId(origin)!==origin.id || !matchesRetry(row,origin,prior.id,kind) ||
        (prior.id!==origin.id && (typeof previousId!=="string" || !matchesRetry(prior,origin,previousId,kind))) ||
        await this.attemptStatus(tx,kind,prior)!=="failed")return null;
    } else if(originalNoticeId(row)!==row.id)return null;
    return this.currentTarget(tx,row);
  }

  private async attemptStatus(tx:Prisma.TransactionClient,kind:NoticeKind,attempt:AuditLog):Promise<AuditDutyNoticeStatus["status"]> {
    const claimId=auditDutyNoticeId(kind,attempt.id,"claim"),terminalId=auditDutyNoticeId(kind,attempt.id,"terminal");
    const rows=await tx.auditLog.findMany({where:{id:{in:[claimId,terminalId]}}});
    if(!rows.length)return "queued";
    const action=(id:string)=>rows.find(row=>row.id===id&&row.businessType===kind&&row.businessId===attempt.businessId&&
      noticeMetadata(row).intentId===attempt.id)?.action;
    const terminal=action(terminalId);
    if(terminal==="cancelled")return "cancelled";
    return action(claimId)==="dispatch_claimed"&&(terminal==="failed"||terminal==="accepted")?terminal:"unknown";
  }

  private async currentNotices(tx:Prisma.TransactionClient,id:string,actorId:string) {
    const rows=await tx.$queryRaw<AuditLog[]>(Prisma.sql`
      SELECT queued.* FROM "AuditLog" queued
      WHERE queued."businessType" IN (${finalReviewKind},${cashDutyKind},${correctionKind}) AND queued."businessId"=${id}
        AND queued."action"='queued' AND queued."metadata"->>'recipientId'=${actorId}
      ORDER BY queued."createdAt",queued."id"
    `);
    const byId=new Map(rows.map(row=>[row.id,row]));
    const notices=[];
    for(const origin of rows) {
      const kind=origin.businessType;
      if(!noticeKind(kind) || originalNoticeId(origin)!==origin.id)continue;
      const message=await this.currentTarget(tx,origin);
      if(!message)continue;
      const chain=[origin.id];
      let attempt=origin,status=await this.attemptStatus(tx,kind,origin);
      while(status==="failed") {
        const next=byId.get(auditDutyNoticeId(kind,attempt.id,"retry"));
        if(!next || !matchesRetry(next,origin,attempt.id,kind))break;
        chain.push(next.id);attempt=next;status=await this.attemptStatus(tx,kind,next);
      }
      notices.push({kind,origin,chain,notice:{attemptId:attempt.id,status,canRetry:status==="failed"&&this.sms.available(),
        dutyName:message.intent.dutyName}});
    }
    return notices;
  }

  notificationStatus(id:string,actorId:string) {
    return this.prisma.$transaction(async tx=>(await this.currentNotices(tx,id,actorId)).map(row=>row.notice));
  }

  async retry(id:string,actorId:string,attemptId:string):Promise<CompanyTransferNotice> {
    const result=await this.prisma.$transaction(async tx=>{
      const previous=await tx.auditLog.findUnique({where:{id:attemptId}});
      if(!previous || !noticeKind(previous.businessType) || previous.action!=="queued" || previous.businessId!==id ||
        noticeMetadata(previous).recipientId!==actorId)throw new ConflictException("当前待办或短信记录已变化，请刷新");
      await lockCompanyTransfers(tx);
      const current=(await this.currentNotices(tx,id,actorId)).find(row=>row.chain.includes(attemptId));
      if(!current)throw new ConflictException("当前待办或短信记录已变化，请刷新");
      if(current.notice.attemptId!==attemptId)return {notice:current.notice,enqueued:false};
      if(!current.notice.canRetry)throw new ConflictException("仅确认发送失败的短信可以重试");
      const retryId=auditDutyNoticeId(current.kind,attemptId,"retry");
      const written=await tx.auditLog.createMany({skipDuplicates:true,data:[{
        id:retryId,businessId:id,businessType:current.kind,actorUserId:actorId,action:"queued",
        metadata:{...noticeMetadata(current.origin) as Prisma.InputJsonObject,originalId:current.origin.id,retryOf:attemptId}
      }]});
      return {notice:{...current.notice,attemptId:retryId,status:"queued" as const,canRetry:false},enqueued:written.count===1};
    });
    if(result.enqueued)void this.afterCommit();
    return result.notice;
  }

  private async canHandleCash(tx: Prisma.TransactionClient, transfer: TransferCashDuty, recipientId: string) {
    return companyTransferCashAccess(tx,this.visibility,recipientId,[transfer.sourceProjectId,transfer.destinationProjectId],
      await companyTransferRoles(tx,recipientId));
  }

  private async canHandleCashDuty(tx: Prisma.TransactionClient,transfer: TransferCashDuty,recipientId: string,key: string) {
    if (await this.canHandleCash(tx,transfer,recipientId)) return true;
    return key==="outgoing" && transfer.requiresParallelRepaymentApproval && !!transfer.sourceProjectId &&
      (await companyTransferRoles(tx,recipientId)).includes("comprehensive_director") &&
      (await this.visibility.visibleProjectIdsInTransaction(tx,recipientId)).includes(transfer.sourceProjectId);
  }

  private async currentParallelMessage(tx: Prisma.TransactionClient,intent: AuditLog) {
    const {recipientId,roundId,nodeIndex} = noticeMetadata(intent);
    if (!intent.businessId || typeof recipientId!=="string" || typeof roundId!=="string" || typeof nodeIndex!=="number") return null;
    const [transfer,round] = await Promise.all([
      tx.companyTransfer.findUnique({where:{id:intent.businessId},select:transferSelect}),
      tx.approvalInstance.findUnique({where:{id:roundId}})
    ]);
    if (!transfer || !this.isCurrentParallelRound(transfer,round)) return null;
    const eligible = await companyRepaymentApprovals(tx,this.visibility,recipientId,transfer.sourceProjectId!,
      transfer.applicantUserId,round.frozenNodes,round.currentNodeIndex);
    if (!eligible.some(duty=>duty.nodeIndex===nodeIndex)) return null;
    const name = round.frozenNodes[nodeIndex]?.name;
    return this.message(tx,transfer,recipientId,transfer.applicantUserId,"公司代付归还审批",
      typeof name==="string" ? name : "原代付归还审批",transfer.amountCents);
  }

  private async currentCashMessage(tx: Prisma.TransactionClient,intent: AuditLog): Promise<AuditDutySmsMessage|null> {
    const {recipientId,key} = (intent.metadata ?? {}) as Prisma.JsonObject;
    if (!intent.businessId || typeof recipientId !== "string" || typeof key !== "string") return null;
    const transfer=await tx.companyTransfer.findUnique({where:{id:intent.businessId},select:transferSelect});
    if (!transfer || transfer.status !== "approved" || !await this.canHandleCashDuty(tx,transfer,recipientId,key)) return null;
    const events=await tx.companyTransferEvent.findMany({where:{transferId:transfer.id},select:cashEventSelect});
    const duty=currentCompanyTransferCashDuties(transfer,events,recipientId).find(item=>item.key===key);
    if (!duty) return null;
    const initiatorId=key==="outgoing" ? transfer.applicantUserId : events.find(event=>event.id===key)!.recordedByUserId;
    return this.message(tx,transfer,recipientId,initiatorId,"公司互转收付",duty.label,duty.amountCents);
  }

  private async currentMessage(tx: Prisma.TransactionClient,intent: AuditLog): Promise<AuditDutySmsMessage|null> {
    const {recipientId,roundId} = (intent.metadata ?? {}) as Prisma.JsonObject;
    if (!intent.businessId || typeof recipientId !== "string" || typeof roundId !== "string") return null;
    const [transfer, round] = await Promise.all([
      tx.companyTransfer.findUnique({where:{id:intent.businessId},select:transferSelect}),
      tx.approvalInstance.findUnique({where:{id:roundId}})
    ]);
    if (!transfer || transfer.requiresParallelRepaymentApproval || !companyTransferFinalReviewer(transfer,round,recipientId,await companyTransferRoles(tx,recipientId))) return null;
    return this.message(tx,transfer,recipientId,transfer.applicantUserId,"公司互转终审","董事长或总经理终审",transfer.amountCents);
  }

  private async message(tx:Prisma.TransactionClient,transfer:TransferSummary,recipientId:string,initiatorId:string,
    businessLabel:string,dutyName:string,amountCents:bigint):Promise<AuditDutySmsMessage|null> {
    const [recipient,applicant] = await Promise.all([
      tx.user.findUnique({where:{id:recipientId},select:{phone:true,isActive:true}}),
      tx.user.findUnique({where:{id:initiatorId},select:{name:true}})
    ]);
    if (!recipient?.isActive) return null;
    const parties = transfer.frozenParties as {source?:{name?:string};destination?:{name?:string}};
    const participants = [parties?.source?.name,parties?.destination?.name].filter((name):name is string=>typeof name === "string" && name.length > 0);
    return {phone:recipient.phone ?? "",intent:{
      businessLabel,dutyName,businessCode:transfer.code,
      scopeName:transfer.sourceProjectId || transfer.destinationProjectId ? "项目资金" : "公司自有资金",
      initiatorName:applicant?.name ?? "申请人待核对",subject:dutyName,participants,
      amountText:`${formatMoneyCentsAsPlainYuan(amountCents)} 元`,targetPath:transfer.requiresParallelRepaymentApproval ? companyTransferDutyTarget(transfer.id) : "/公司互转台账"
    }};
  }
}
