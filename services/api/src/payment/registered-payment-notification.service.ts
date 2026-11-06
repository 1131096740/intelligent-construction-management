import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { currentRegisteredPaymentApproval } from "./registered-payment-approval";
import { assertRegisteredPaymentActor } from "./registered-payment-funding";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import { ApprovalSmsService, type SmsOutcome } from "../approval/approval-sms.service";

const KIND = "registered_payment_execution_notification_v1";
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
  if (!payment || !round || round.id !== roundId || payment.paymentSubjectType !== "our_company" || !["approved_pending_payment", "partially_paid"].includes(payment.status) || (payment.approvedAmountCents ?? payment.requestedAmountCents) <= payment.paidAmountCents) return null;
  return payment;
}

async function mayRegister(tx: Prisma.TransactionClient, actorUserId: string) {
  try { await assertRegisteredPaymentActor(tx, actorUserId); return true; }
  catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
}

async function notificationPayment(tx: Prisma.TransactionClient, row: ApprovalActionLog, recipientId: string) {
  const data = object(row.metadata);
  if (data.event !== "queued" || data.recipientId !== recipientId || data.duty !== DUTY || typeof data.paymentId !== "string" || typeof data.roundId !== "string") return null;
  if (row.id !== key(KIND,data.paymentId,data.roundId,DUTY,recipientId)) return null;
  const payment = await pendingPayment(tx,data.paymentId,data.roundId);
  if (!payment) return null;
  const anchorId = key(KIND,payment.id,data.roundId,"approved_anchor");
  const anchor = await tx.approvalActionLog.findUnique({where:{id:anchorId}});
  const proof = object(anchor?.metadata);
  if (!anchor || data.anchorId !== anchorId || proof.event !== "approved_anchor" || proof.paymentId !== payment.id || proof.roundId !== data.roundId || typeof proof.finalActionId !== "string") return null;
  const action = await tx.approvalActionLog.findUnique({where:{id:proof.finalActionId}});
  if (!action || action.approvalInstanceId !== data.roundId) return null;
  try { if (actionFingerprint(action) !== proof.finalActionFingerprint) return null; }
  catch (error) { if (error instanceof ConflictException) return null; throw error; }
  return {payment,roundId:data.roundId,anchorId};
}
const dispatchKey = (intentId:string, event:string) => key(KIND,intentId,event);

/** Called only by the genuine final approval, using its same transaction.
 * The action proves origin; it is deliberately absent from the deduplication key. */
export async function queueApprovedRegisteredPaymentNotifications(tx: Prisma.TransactionClient, paymentId: string, roundId: string, action: ApprovalActionLog) {
  // Unsupported original business approval must not fail because this outbox
  // has a stricter registered-payment protocol or signature anchor contract.
  if (!(await currentRegisteredPaymentDomain(tx,paymentId)).supportedDomain) return;
  const finalActionFingerprint = actionFingerprint(action);
  const payment = await pendingPayment(tx, paymentId, roundId);
  if (!payment || action.approvalInstanceId !== roundId) throw new ConflictException("付款批准轮次已变化，不能生成办理通知");
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
    id: key(KIND, paymentId, roundId, DUTY, user.id), approvalInstanceId: roundId, action: "system_notification", actorUserId: action.actorUserId,
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
  async dispatchQueued(paymentId: string) {
    const counts = {accepted:0,failed:0,unknown:0,deferred:false};
    if (!this.sms.available()) return {...counts,deferred:true};
    const rows = await this.prisma.$transaction(tx => tx.approvalActionLog.findMany({where:{action:"system_notification",metadata:{path:["kind"],equals:KIND}},orderBy:{createdAt:"asc"}}));
    for (const row of rows) {
      const data = object(row.metadata);
      if (data.event !== "queued" || data.paymentId !== paymentId || typeof data.recipientId !== "string") continue;
      const recipientId = data.recipientId;
      const claim = await this.prisma.$transaction(async tx => {
        if (!(await mayRegister(tx,recipientId))) return null;
        const source = await notificationPayment(tx,row,recipientId);
        if (!source) return null;
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
        return {claimId,roundId:source.roundId,code:source.payment.code,phone:user.phone};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if (!claim) continue;
      let outcome: SmsOutcome;
      if (!claim.phone || !/^(?:1\d{10}|\+[1-9]\d{7,14})$/.test(claim.phone)) outcome={status:"failed",message:"当前接收人没有有效手机号，网页付款待办仍可办理"};
      else {
        try { outcome=await this.sms.send(claim.phone,"付款申请","实际付款登记",claim.code); }
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

  async forCurrentActor(actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      await assertRegisteredPaymentActor(tx, actorUserId);
      const rows = await tx.approvalActionLog.findMany({ where: { action: "system_notification", metadata: { path: ["kind"], equals: KIND } }, orderBy: { createdAt: "asc" } });
      const items = [];
      for (const row of rows) {
        const source = await notificationPayment(tx,row,actorUserId);
        if (!source) continue;
        const {payment} = source;
        const claimId = dispatchKey(row.id,"dispatch_claim");
        const claim = rows.find(candidate => candidate.id === claimId);
        const result = rows.find(candidate => candidate.id === dispatchKey(row.id,"dispatch_result"));
        const outcome = object(result?.metadata);
        const status = !claim ? "queued" : result && outcome.event === "dispatch_result" && outcome.intentId === row.id && outcome.claimId === claimId && ["accepted","failed","unknown"].includes(String(outcome.status)) ? String(outcome.status) : "unknown";
        items.push({ businessCode: payment.code, status, summary: `付款申请${payment.code}已批准，请查看当前实际付款待办`, targetPath: `/付款管理?payment=${encodeURIComponent(payment.code)}` });
      }
      return { items, total: items.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
