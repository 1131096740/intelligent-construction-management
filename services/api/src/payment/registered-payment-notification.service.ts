import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { sensitiveBusinessReadAllowed } from "../auth/sensitive-business-read";
import type { AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { currentRegisteredPaymentApproval } from "./registered-payment-approval";
import { assertRegisteredPaymentActor } from "./registered-payment-funding";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import { ApprovalSmsService, approvalDutyRichTemplateEnabled, type SmsOutcome } from "../approval/approval-sms.service";
import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

export const REGISTERED_PAYMENT_EXECUTION_NOTICE_KIND = "registered_payment_execution_notification_v1";
const KIND = REGISTERED_PAYMENT_EXECUTION_NOTICE_KIND;
const DUTY = "payment_execution";
const key = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function actionFingerprint(action: ApprovalActionLog) {
  const sha256 = action?.signatureSha256Snapshot;
  if (!action || !action.id || action.action !== "approve" || !(action.createdAt instanceof Date) || !action.signatureFileIdSnapshot || !action.signatureVersionIdSnapshot || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new ConflictException("付款批准的正式签批依据不完整，不能生成办理通知");
  }
  return key(action.id, action.approvalInstanceId, action.actorUserId, action.approvedRoleKey ?? "", action.representedUserId ?? "", action.signatureFileIdSnapshot, action.signatureVersionIdSnapshot, sha256, action.createdAt.toISOString());
}

async function pendingPayment(tx: Prisma.TransactionClient, paymentId: string, roundId: string) {
  const domain = await currentRegisteredPaymentDomain(tx,paymentId);
  if (!domain.supportedDomain) return null;
  const payment = domain.payment;
  const round = await currentRegisteredPaymentApproval(tx, paymentId);
  if (!payment || payment.remainingWithdrawnCents != null || !round || round.id !== roundId || payment.paymentSubjectType !== "our_company" || !["approved_pending_payment", "partially_paid"].includes(payment.status) || (payment.approvedAmountCents ?? payment.requestedAmountCents) <= payment.paidAmountCents) return null;
  return {payment,round,version:domain.version};
}

async function mayRegister(tx: Prisma.TransactionClient, actorUserId: string) {
  try { await assertRegisteredPaymentActor(tx, actorUserId); return true; }
  catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
}

const dispatchKey = (intentId:string, event:string) => key(KIND,intentId,event);
const retryKey = (intentId:string) => key(KIND,intentId,"retry");
const originKey = (paymentId:string,roundId:string,recipientId:string) => key(KIND,paymentId,roundId,DUTY,recipientId);

function registeredNotificationEvents(row:ApprovalActionLog,claim?:ApprovalActionLog|null,result?:ApprovalActionLog|null):AuditDutyNoticeStatus["status"] {
  const intent=object(row.metadata);
  const claimId=dispatchKey(row.id,"dispatch_claim");
  const matches=(entry:ApprovalActionLog|null|undefined,id:string,event:string)=>{
    const data=object(entry?.metadata);
    return entry?.id===id && entry.action==="system_notification" && entry.approvalInstanceId===row.approvalInstanceId &&
      data.kind===KIND && data.event===event && data.intentId===row.id &&
      data.paymentId===intent.paymentId && data.roundId===intent.roundId && data.duty===DUTY && data.recipientId===intent.recipientId;
  };
  if(!claim && !result)return "queued";
  if(!matches(claim,claimId,"dispatch_started") || object(claim?.metadata).anchorId!==intent.anchorId ||
     !matches(result,dispatchKey(row.id,"dispatch_result"),"dispatch_result"))return "unknown";
  const outcome=object(result?.metadata);
  if(outcome.claimId!==claimId)return "unknown";
  return outcome.status==="failed"||outcome.status==="accepted"?outcome.status:"unknown";
}

function sameRegisteredDuty(candidate:ApprovalActionLog|null|undefined,row:ApprovalActionLog) {
  const expected=object(row.metadata), data=object(candidate?.metadata);
  return candidate?.action==="system_notification" && candidate.approvalInstanceId===row.approvalInstanceId &&
    candidate.actorUserId===row.actorUserId && data.kind===KIND && data.event==="queued" && data.duty===DUTY &&
    data.paymentId===expected.paymentId && data.roundId===expected.roundId &&
    data.recipientId===expected.recipientId && data.anchorId===expected.anchorId;
}

async function isRegisteredRetry(tx:Prisma.TransactionClient,row:ApprovalActionLog,originId:string) {
  const data=object(row.metadata);
  if (data.origin!=="manual_retry" || data.rootIntentId!==originId ||
      typeof data.retryOf!=="string" || row.id!==retryKey(data.retryOf)) return false;
  const [root,parent,claim,result]=await Promise.all([
    tx.approvalActionLog.findUnique({where:{id:originId}}),
    tx.approvalActionLog.findUnique({where:{id:data.retryOf}}),
    tx.approvalActionLog.findUnique({where:{id:dispatchKey(data.retryOf,"dispatch_claim")}}),
    tx.approvalActionLog.findUnique({where:{id:dispatchKey(data.retryOf,"dispatch_result")}})
  ]);
  if (!root || object(root.metadata).origin!=="approval_transaction" || !sameRegisteredDuty(root,row) ||
      !parent || !sameRegisteredDuty(parent,row)) return false;
  const previous=object(parent.metadata);
  if(parent.id!==originId && (previous.origin!=="manual_retry" || previous.rootIntentId!==originId ||
    typeof previous.retryOf!=="string" || parent.id!==retryKey(previous.retryOf))) return false;
  return registeredNotificationEvents(parent,claim,result)==="failed";
}

async function mayReadPaymentDuty(tx:Prisma.TransactionClient,actorId:string,paymentId:string,projectId:string,roles:readonly string[]) {
  return (await new ProjectVisibilityService(tx as PrismaService).visibleProjectIdsInTransaction(tx,actorId)).includes(projectId) &&
    await sensitiveBusinessReadAllowed(tx,"payment_request",paymentId,actorId,roles);
}

async function notificationPayment(tx: Prisma.TransactionClient, row: ApprovalActionLog, recipientId: string) {
  const data = object(row.metadata);
  if (row.action!=="system_notification" || data.kind!==KIND || data.event !== "queued" || data.recipientId !== recipientId || data.duty !== DUTY || typeof data.paymentId !== "string" || typeof data.roundId !== "string") return null;
  if (row.approvalInstanceId!==data.roundId) return null;
  const originId=originKey(data.paymentId,data.roundId,recipientId);
  if (row.id===originId ? data.origin!=="approval_transaction" : !await isRegisteredRetry(tx,row,originId)) return null;
  const source = await pendingPayment(tx,data.paymentId,data.roundId);
  if (!source) return null;
  const {payment} = source;
  const anchorId = key(KIND,payment.id,data.roundId,"approved_anchor");
  const anchor = await tx.approvalActionLog.findUnique({where:{id:anchorId}});
  const proof = object(anchor?.metadata);
  if (!anchor || anchor.approvalInstanceId!==data.roundId || anchor.action!=="system_notification" || proof.kind!==KIND || data.anchorId !== anchorId || proof.event !== "approved_anchor" || proof.paymentId !== payment.id || proof.roundId !== data.roundId || typeof proof.finalActionId !== "string") return null;
  const action = await tx.approvalActionLog.findUnique({where:{id:proof.finalActionId}});
  if (!action || action.approvalInstanceId !== data.roundId) return null;
  try { if (actionFingerprint(action) !== proof.finalActionFingerprint) return null; }
  catch (error) { if (error instanceof ConflictException) return null; throw error; }
  return {...source,roundId:data.roundId,anchorId,originId};
}

async function paymentDutyIntent(tx: Prisma.TransactionClient,
    source: NonNullable<Awaited<ReturnType<typeof notificationPayment>>>): Promise<ApprovalDutySmsIntent> {
  const {payment,round,version} = source;
  const [project,applicant,contract,settlement] = await Promise.all([
    tx.project.findUnique({where:{id:payment.projectId},select:{name:true}}),
    tx.user.findUnique({where:{id:round.applicantUserId},select:{name:true}}),
    tx.contract.findUnique({where:{id:payment.contractId,projectId:payment.projectId},select:{name:true,counterparty:true}}),
    payment.settlementId ? tx.settlement.findUnique({where:{
      id:payment.settlementId,projectId:payment.projectId,contractId:payment.contractId,
    },select:{finalCumulativeAmountCents:true,payableAmountCents:true}}) : null,
  ]);
  const yuan = (amount: bigint) => `${formatMoneyCentsAsPlainYuan(amount)} 元`;
  const approved = payment.approvedAmountCents;
  const detail = settlement?.finalCumulativeAmountCents != null ? `关联累计结算 ${yuan(settlement.finalCumulativeAmountCents)}`
    : settlement?.payableAmountCents != null ? `关联结算应付 ${yuan(settlement.payableAmountCents)}` : null;
  return {
    businessLabel:"付款申请",dutyName:"实际付款登记",businessCode:payment.code,
    scopeName:project?.name ?? "项目名称待核对",initiatorName:applicant?.name ?? "发起人待核对",
    subject:payment.paymentMatter?.trim() || contract?.name || "实际付款登记",
    participants:[
      ...(version?.companyEntityNameSnapshot ? [`申请付款主体：${version.companyEntityNameSnapshot}`] : []),
      ...(contract?.counterparty ? [`合同对方：${contract.counterparty}`] : []),
    ],
    amountText:approved == null ? "待确定" : `待实付 ${yuan(approved - payment.paidAmountCents)}`,
    details:[`本申请已付 ${yuan(payment.paidAmountCents)}`,...(detail ? [detail] : [])],
    targetPath:approvalDutyTarget("payment",payment.id),
  };
}

/** Called only by the genuine final approval, using its same transaction.
 * The action proves origin; it is deliberately absent from the deduplication key. */
export async function queueApprovedRegisteredPaymentNotifications(tx: Prisma.TransactionClient, paymentId: string, roundId: string, action: ApprovalActionLog) {
  // Unsupported original business approval must not fail because this outbox
  // has a stricter registered-payment protocol or signature anchor contract.
  if (!(await currentRegisteredPaymentDomain(tx,paymentId)).supportedDomain) return;
  const finalActionFingerprint = actionFingerprint(action);
  const pending = await pendingPayment(tx, paymentId, roundId);
  if (!pending || action.approvalInstanceId !== roundId) throw new ConflictException("付款批准轮次已变化，不能生成办理通知");
  const anchorId = key(KIND, paymentId, roundId, "approved_anchor");
  await tx.approvalActionLog.createMany({ skipDuplicates: true, data: [{
    id: anchorId, approvalInstanceId: roundId, action: "system_notification", actorUserId: action.actorUserId,
    metadata: { kind: KIND, event: "approved_anchor", paymentId, roundId, finalActionId: action.id, finalActionFingerprint, origin: "approval_transaction" }
  }] });
  const anchor = await tx.approvalActionLog.findUnique({ where: { id: anchorId } });
  if (!anchor || object(anchor.metadata).finalActionFingerprint !== finalActionFingerprint) throw new ConflictException("付款通知已有不同的正式批准依据，请核对原轮次");
  const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true } });
  const intents: Prisma.ApprovalActionLogCreateManyInput[] = [];
  for (const user of users) if (await mayRegister(tx, user.id)) intents.push({
    id: originKey(paymentId,roundId,user.id), approvalInstanceId: roundId, action: "system_notification", actorUserId: action.actorUserId,
    metadata: { kind: KIND, event: "queued", paymentId, roundId, duty: DUTY, recipientId: user.id, anchorId, origin: "approval_transaction" }
  });
  if (intents.length) await tx.approvalActionLog.createMany({ data: intents, skipDuplicates: true });
}

/** Targeted payment notifications only; reading never queues or sends anything. */
@Injectable()
export class RegisteredPaymentNotificationService {
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  /** Product caller invokes this only after its genuine approval transaction.
   * Claim and result are append-only. A missing result after a claim is unknown,
   * never permission to send again. The external adapter is outside callbacks. */
  async dispatchQueued(paymentId: string, attemptId?: string) {
    const counts = {accepted:0,failed:0,unknown:0,deferred:false};
    if (!this.sms.available()) return {...counts,deferred:true};
    const rows = await this.prisma.$transaction(tx => tx.approvalActionLog.findMany({where:{action:"system_notification",metadata:{path:["kind"],equals:KIND}},orderBy:{createdAt:"asc"}}));
    for (const row of rows) {
      const data = object(row.metadata);
      if ((attemptId && row.id!==attemptId) || data.event !== "queued" || data.paymentId !== paymentId || typeof data.recipientId !== "string") continue;
      const recipientId = data.recipientId;
      const claim = await this.prisma.$transaction(async tx => {
        if (!(await mayRegister(tx,recipientId))) return null;
        const source = await notificationPayment(tx,row,recipientId);
        if (!source) return null;
        if (data.origin==="manual_retry") {
          const roles=await assertRegisteredPaymentActor(tx,recipientId);
          if(!await mayReadPaymentDuty(tx,recipientId,paymentId,source.payment.projectId,roles))return null;
        }
        const [previousClaim,previousResult]=await Promise.all([
          tx.approvalActionLog.findUnique({where:{id:dispatchKey(row.id,"dispatch_claim")}}),
          tx.approvalActionLog.findUnique({where:{id:dispatchKey(row.id,"dispatch_result")}})
        ]);
        if(registeredNotificationEvents(row,previousClaim,previousResult)!=="queued")return null;
        const user = await tx.user.findUnique({where:{id:recipientId},select:{id:true,isActive:true,phone:true}});
        if (!user?.isActive) return null;
        const claimId = dispatchKey(row.id,"dispatch_claim");
        const written = await tx.approvalActionLog.createMany({skipDuplicates:true,data:[{
          id:claimId,approvalInstanceId:source.roundId,action:"system_notification",actorUserId:row.actorUserId,
          metadata:{kind:KIND,event:"dispatch_started",paymentId,roundId:source.roundId,duty:DUTY,recipientId,intentId:row.id,anchorId:source.anchorId}
        }]});
        if (written.count !== 1) return null;
        // Phone is resolved at dispatch, never frozen at approval or persisted
        // in the outbox/audit metadata.
        const richIntent = approvalDutyRichTemplateEnabled() ? await paymentDutyIntent(tx,source) : null;
        return {claimId,roundId:source.roundId,code:source.payment.code,phone:user.phone,richIntent};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if (!claim) continue;
      let outcome: SmsOutcome;
      if (!claim.phone || !/^(?:1\d{10}|\+[1-9]\d{7,14})$/.test(claim.phone)) outcome={status:"failed",message:"当前接收人没有有效手机号，网页付款待办仍可办理"};
      else {
        try { outcome = claim.richIntent ? await this.sms.sendDutyIntent(claim.phone,claim.richIntent)
          : await this.sms.send(claim.phone,"付款申请","实际付款登记",claim.code); }
        catch { outcome={status:"unknown",message:"通知发送结果待确认，请勿重复发送"}; }
      }
      // Persist only the safe normalized status, never provider text or phone.
      await this.prisma.$transaction(tx => tx.approvalActionLog.createMany({skipDuplicates:true,data:[{
        id:dispatchKey(row.id,"dispatch_result"),approvalInstanceId:claim.roundId,action:"system_notification",actorUserId:row.actorUserId,
        metadata:{kind:KIND,event:"dispatch_result",paymentId,roundId:claim.roundId,duty:DUTY,recipientId,intentId:row.id,claimId:claim.claimId,status:outcome.status}
      }]}));
      counts[outcome.status]++;
    }
    return counts;
  }

  private async noticeRows(tx:Prisma.TransactionClient,roundId?:string) {
    return tx.approvalActionLog.findMany({where:{action:"system_notification",metadata:{path:["kind"],equals:KIND},
      ...(roundId ? {approvalInstanceId:roundId}:{})},orderBy:{createdAt:"asc"}});
  }

  private currentAttempt(rows:ReadonlyMap<string,ApprovalActionLog>,origin:ApprovalActionLog) {
    let attempt=origin;
    let status=registeredNotificationEvents(attempt,rows.get(dispatchKey(attempt.id,"dispatch_claim")),rows.get(dispatchKey(attempt.id,"dispatch_result")));
    while(status==="failed") {
      const retry=rows.get(retryKey(attempt.id));
      const metadata=object(retry?.metadata);
      if(!retry || metadata.origin!=="manual_retry" || metadata.retryOf!==attempt.id || metadata.rootIntentId!==origin.id ||
         !sameRegisteredDuty(retry,origin))break;
      attempt=retry;
      status=registeredNotificationEvents(attempt,rows.get(dispatchKey(attempt.id,"dispatch_claim")),rows.get(dispatchKey(attempt.id,"dispatch_result")));
    }
    return {attempt,status};
  }

  private async currentNotice(tx:Prisma.TransactionClient,paymentId:string,actorId:string) {
    const roles=await assertRegisteredPaymentActor(tx,actorId);
    const round=await currentRegisteredPaymentApproval(tx,paymentId);
    if(!round)return null;
    const rows=new Map((await this.noticeRows(tx,round.id)).map(row=>[row.id,row]));
    const origin=rows.get(originKey(paymentId,round.id,actorId));
    const source=origin ? await notificationPayment(tx,origin,actorId):null;
    if(!origin || !source || !await mayReadPaymentDuty(tx,actorId,paymentId,source.payment.projectId,roles))return null;
    return {...this.currentAttempt(rows,origin),rows,origin};
  }

  async notificationStatus(paymentId:string,actorId:string):Promise<AuditDutyNoticeStatus|null> {
    return this.prisma.$transaction(async tx=>{
      const current=await this.currentNotice(tx,paymentId,actorId);
      return current ? {attemptId:current.attempt.id,status:current.status,canRetry:current.status==="failed" && this.sms.available()}:null;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async retry(paymentId:string,actorId:string,expectedAttempt:string):Promise<AuditDutyNoticeStatus> {
    const result=await this.prisma.$transaction(async tx=>{
      await assertRegisteredPaymentActor(tx,actorId);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentRequest" WHERE "id"=${paymentId} FOR UPDATE`);
      const current=await this.currentNotice(tx,paymentId,actorId);
      if(!current)throw new ConflictException("当前待办或短信记录已变化，请刷新");
      const status={attemptId:current.attempt.id,status:current.status,canRetry:current.status==="failed" && this.sms.available()};
      const attemptId=retryKey(expectedAttempt);
      if(status.attemptId!==expectedAttempt) {
        const replay=current.rows.get(attemptId);
        const metadata=object(replay?.metadata);
        if(sameRegisteredDuty(replay,current.origin) && metadata.origin==="manual_retry" &&
          metadata.retryOf===expectedAttempt && metadata.rootIntentId===current.origin.id)return {status,enqueued:false};
        throw new ConflictException("短信记录已更新，请刷新后重试");
      }
      if(!status.canRetry)throw new ConflictException("仅确认发送失败的短信可以重试");
      const written=await tx.approvalActionLog.createMany({skipDuplicates:true,data:[{
        id:attemptId,approvalInstanceId:current.origin.approvalInstanceId,actorUserId:current.origin.actorUserId,action:"system_notification",
        metadata:{...object(current.origin.metadata) as Prisma.InputJsonObject,origin:"manual_retry",
          rootIntentId:current.origin.id,retryOf:expectedAttempt}
      }]});
      return {status:{attemptId,status:"queued" as const,canRetry:false},enqueued:written.count===1};
    });
    if(result.enqueued)void this.dispatchQueued(paymentId,result.status.attemptId).catch(()=>undefined);
    return result.status;
  }

  async forCurrentActor(actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      await assertRegisteredPaymentActor(tx, actorUserId);
      const rows = await this.noticeRows(tx);
      const byId=new Map(rows.map(row=>[row.id,row]));
      const items = [];
      for (const row of rows) {
        if (object(row.metadata).origin!=="approval_transaction")continue;
        const source=await notificationPayment(tx,row,actorUserId);
        if (!source) continue;
        const {payment}=source;
        const {status}=this.currentAttempt(byId,row);
        items.push({ businessCode: payment.code, status, summary: `付款申请${payment.code}已批准，请查看当前实际付款待办`, targetPath: `/付款管理?payment=${encodeURIComponent(payment.code)}` });
      }
      return { items, total: items.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
