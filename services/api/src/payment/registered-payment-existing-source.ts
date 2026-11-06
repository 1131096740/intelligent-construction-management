import { paymentExecutionVoucherFileId } from "./payment-execution-voucher";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { fingerprint } from "../operating-takeover/operating-takeover.utils";
import { currentRegisteredPaymentDomain, registeredExecutionIsWageLinked } from "./registered-payment-domain";
export { registeredExecutionIsWageLinked } from "./registered-payment-domain";

const unavailable = () => new ConflictException("无法核验当前付款申请的历史来源，请保留填写并联系业务主管核对");

/** Read-only identity proof. An activated historical amount is not a new payment. */
export async function resolveRegisteredExistingSource(tx: Prisma.TransactionClient, paymentId: string, type: string, id: string) {
  if (!(await currentRegisteredPaymentDomain(tx,paymentId)).supportedDomain) throw unavailable();
  const request = await tx.paymentRequest.findUnique({ where: { id: paymentId } });
  if (!request) throw unavailable();
  if (type === "historical_financial_takeover_row") {
    const row = await tx.historicalFinancialTakeoverRowMapping.findUnique({where:{id}});
    if (!row || row.projectId !== request.projectId || row.kind !== "payment_execution" || row.evidenceLevel !== "A" || row.mappingDecision !== "LINK" || row.targetKind !== "payment_execution" || !row.targetRef) throw unavailable();
    const batch = await tx.historicalFinancialTakeoverBatch.findUnique({where:{id:row.batchId}});
    const activation = await tx.historicalFinancialTakeoverActivation.findUnique({where:{batchId:row.batchId}});
    const compensation = await tx.historicalFinancialTakeoverCompensation.findUnique({where:{batchId:row.batchId}});
    if (!batch || batch.projectId !== request.projectId || batch.status !== "activated" || !activation || !activation.activatedAt || activation.manifestFingerprint !== batch.manifestFingerprint || compensation) throw unavailable();
    const execution = await tx.paymentExecution.findUnique({where:{id:row.targetRef}});
    if (!execution || execution.amountCents !== row.amountCents) throw unavailable();
    const linkedRequest = await tx.paymentRequest.findUnique({where:{id:execution.paymentRequestId}});
    if (!linkedRequest || linkedRequest.projectId !== request.projectId || !["paid", "partially_paid"].includes(linkedRequest.status)) throw unavailable();
    if (await registeredExecutionIsWageLinked(tx,execution.id)) throw unavailable();
    const voucherFileId = await paymentExecutionVoucherFileId(tx,execution);
    if (!voucherFileId) throw unavailable();
    const target = {id:execution.id,idempotencyKey:execution.idempotencyKey,voucherFileId,amountCents:execution.amountCents,paidAt:execution.paidAt,payerCompanyEntityId:execution.companyEntityIdSnapshot};
    if (fingerprint(target) !== row.targetFingerprint || fingerprint(row.targetSnapshot) !== row.targetFingerprint) throw unavailable();
    const samePaymentRequest = execution.paymentRequestId === request.id;
    return {
      source:{type,id,version:batch.revision,fingerprint:fingerprint({row,batch,activation,target,linkedRequest})},
      samePaymentRequest,contractHistoryAlreadyIncluded:null,
      conclusion:samePaymentRequest ? "original_result" : "not_linked_to_request",
      amountCents:execution.amountCents.toString(),paidAt:chinaDateOnly(execution.paidAt),
      ...(samePaymentRequest ? {originalResultKey:execution.idempotencyKey,originalExecutionId:execution.id} : {})
    };
  }
  if (type !== "contract_takeover_historical_payment") throw unavailable();
  const payment = await tx.contractTakeoverHistoricalPayment.findUnique({ where: { id } });
  if (!payment || payment.status !== "activated" || !payment.activatedAt) throw unavailable();
  const takeover = await tx.contractTakeover.findUnique({ where: { id: payment.takeoverId } });
  if (!takeover || takeover.projectId !== request.projectId || takeover.contractId !== request.contractId || takeover.takeoverStatus !== "confirmed" || !takeover.activatedAt || !["A", "B"].includes(takeover.takeoverLevel)) throw unavailable();
  const corrections = await tx.contractTakeoverCorrection.findMany({ where: { takeoverId: takeover.id }, orderBy: { id: "asc" } });
  return {
    source: { type, id, version: 1, fingerprint: fingerprint({ payment, takeover, corrections }) },
    samePaymentRequest: false,
    contractHistoryAlreadyIncluded: true,
    conclusion: "not_linked_to_request",
    amountCents: payment.amountCents.toString(), paidAt: chinaDateOnly(payment.paidAt)
  };
}

/** Discover only already-existing canonical payments of this exact request.
 * An invalid/compensated/sensitive source never becomes a selectable receipt. */
export async function registeredOriginalPaymentResults(tx: Prisma.TransactionClient, paymentId: string) {
  const request = await tx.paymentRequest.findUnique({where:{id:paymentId},select:{projectId:true}});
  if (!request) return [];
  const executions = await tx.paymentExecution.findMany({where:{paymentRequestId:paymentId},select:{id:true}});
  if (!executions.length) return [];
  const rows = await tx.historicalFinancialTakeoverRowMapping.findMany({where:{projectId:request.projectId,kind:"payment_execution",evidenceLevel:"A",mappingDecision:"LINK",targetKind:"payment_execution",targetRef:{in:executions.map(row=>row.id)}},orderBy:{id:"asc"}});
  const results: Array<{executionId:string;resultKey:string;amountCents:string;paidAt:string;source:{type:string;id:string;version:number;fingerprint:string}}> = [];
  for (const row of rows) {
    try {
      const proof = await resolveRegisteredExistingSource(tx,paymentId,"historical_financial_takeover_row",row.id);
      if (!proof.samePaymentRequest || !("originalExecutionId" in proof) || typeof proof.originalExecutionId !== "string" || typeof proof.originalResultKey !== "string" || results.some(result=>result.executionId === proof.originalExecutionId)) continue;
      results.push({executionId:proof.originalExecutionId,resultKey:proof.originalResultKey,amountCents:proof.amountCents,paidAt:proof.paidAt,source:proof.source});
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }
  }
  return results;
}
