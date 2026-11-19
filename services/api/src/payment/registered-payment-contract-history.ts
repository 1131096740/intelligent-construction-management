import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { RecordRegisteredPaymentExecutionDto } from "./dto/record-registered-payment-execution.dto";

/** Missing markers are not repaired by a business command. Real locking and
 * definer privileges belong to the prepared PG protocol, not synthetic tests. */
async function historyRevision(tx: Prisma.TransactionClient, contractId: string, lock: boolean) {
  const rows=await tx.$queryRaw<Array<{revision:bigint|null}>>(lock
    ? Prisma.sql`SELECT public."jg_registered_history_lock_revision"(${contractId}) AS "revision"`
    : Prisma.sql`SELECT public."jg_registered_history_read_revision"(${contractId}) AS "revision"`);
  const revision=rows[0]?.revision;
  if(typeof revision!=="bigint" || revision<0n)throw new ConflictException("合同历史核对基线尚未准备，请保留填写并联系管理员核验");
  return revision;
}
export async function lockRegisteredContractHistoryRevision(tx: Prisma.TransactionClient,contractId:string){
  return historyRevision(tx,contractId,true);
}

/** The marker versions the complete set; do not lock historical rows after it. */
export async function registeredContractHistoryBasis(tx: Prisma.TransactionClient, contractId: string, lockedRevision?: bigint) {
  const revision=lockedRevision??await historyRevision(tx,contractId,false);
  const rows = await tx.contractTakeover.findMany({where:{contractId,takeoverStatus:"confirmed",historicalBalanceConfirmedAt:{not:null}},orderBy:{id:"asc"}});
  const records = rows.map(row=>({
    id:row.id,contractId:row.contractId,contractVersionId:row.contractVersionId,paymentTermsVersionId:row.paymentTermsVersionId,
    updatedAt:row.updatedAt.toISOString(),confirmedAt:row.historicalBalanceConfirmedAt!.toISOString(),activatedAt:row.activatedAt?.toISOString()??null,
    historicalPaidCents:row.historicalPaidCents.toString(),historicalProxyPaidCents:row.historicalProxyPaidCents.toString(),historicalAdvancePaidCents:row.historicalAdvancePaidCents.toString()
  }));
  const required=rows.some(row=>row.historicalPaidCents!==0n || row.historicalProxyPaidCents!==0n || row.historicalAdvancePaidCents!==0n);
  return {required,revision:revision.toString(),fingerprint:createHash("sha256").update(JSON.stringify({contractId,revision:revision.toString(),records})).digest("hex"),records};
}

export async function confirmRegisteredContractHistory(tx: Prisma.TransactionClient, contractId: string, input: RecordRegisteredPaymentExecutionDto, lockedRevision:bigint) {
  const basis=await registeredContractHistoryBasis(tx,contractId,lockedRevision);
  const confirmation=input.contractHistoryConfirmation;
  if (!confirmation && !basis.required) return null;
  if (!confirmation || confirmation.treatment!=="not_included") throw new ConflictException("请先独立确认本次实付未计入合同历史已付；已含或不确定时请保留填写并核对原来源");
  if (confirmation.expectedFingerprint!==basis.fingerprint) throw new ConflictException("合同历史核对版本或金额已变化，请刷新后重新核对，原填写已保留");
  if (!confirmation.reason.trim() || !confirmation.evidence.trim()) throw new ConflictException("请填写本次未计入合同历史已付的核对原因和依据");
  return {treatment:"not_included",reason:confirmation.reason.trim(),evidence:confirmation.evidence.trim(),basis};
}
