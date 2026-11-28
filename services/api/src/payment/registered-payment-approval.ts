import { ConflictException } from "@nestjs/common";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import type { Prisma } from "@prisma/client";

/** The latest real payment-approval round governs new registered execution.
 * Filtering approved status in the query would accidentally revive an old round. */
export async function currentRegisteredPaymentApproval(tx: Prisma.TransactionClient, paymentId: string) {
  const [round,next] = await tx.approvalInstance.findMany({
    where:{businessType:"payment_request",businessId:paymentId,flowType:"payment.approve"},
    orderBy:{createdAt:"desc"},take:2
  });
  if (!round || (next && next.createdAt.getTime()===round.createdAt.getTime())) return null;
  return round?.status === "approved" && round.businessType === "payment_request" && round.businessId === paymentId && round.flowType === "payment.approve" ? round : null;
}

/** Server-only coordinates for the immutable event; never caller flags. */
export async function registeredPaymentWriteAuthority(tx: Prisma.TransactionClient, paymentId: string, historyRevision:bigint) {
  const domain=await currentRegisteredPaymentDomain(tx,paymentId);
  const payment=domain.payment,version=domain.version;
  const approval=await currentRegisteredPaymentApproval(tx,paymentId);
  if (!domain.supportedDomain || !payment || !version || version.contractId!==payment.contractId || !approval) throw new ConflictException("当前付款来源、冻结版本或批准依据已变化，请刷新后重新核对");
  return {schemaVersion:1,contractHistoryRevision:historyRevision.toString(),paymentRequestId:payment.id,projectId:payment.projectId,contractId:payment.contractId,
    contractVersionId:version.id,sourceType:payment.sourceType,paymentSubjectType:payment.paymentSubjectType,
    signingSubjectType:version.signingSubjectType,requestStatusBeforeExecution:payment.status,
    paidAmountBeforeExecution:payment.paidAmountCents.toString(),approvedAmountCents:(payment.approvedAmountCents??payment.requestedAmountCents).toString(),
    approvalRound:{id:approval.id,businessType:approval.businessType,businessId:approval.businessId,flowType:approval.flowType,status:approval.status,createdAt:approval.createdAt.toISOString()}};
}
