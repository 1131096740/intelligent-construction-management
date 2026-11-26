import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
export type LegacyOriginalRef = { originalTransferId?: string | null; originalProxyId?: string | null; originalFundMovementRelationshipId?: string | null; originalInterEntityRelationshipId?: string | null; originalOperationalPaymentId?: string | null };
export function originalSourceKey(ref: LegacyOriginalRef) {
  if (ref.originalTransferId) return `loan:${ref.originalTransferId}`;
  if (ref.originalProxyId) return `proxy:${ref.originalProxyId}`;
  if (ref.originalFundMovementRelationshipId) return `movement:${ref.originalFundMovementRelationshipId}`;
  if (ref.originalInterEntityRelationshipId) return `inter_entity:${ref.originalInterEntityRelationshipId}`;
  return ref.originalOperationalPaymentId ? `operational:${ref.originalOperationalPaymentId}` : null;
}

export async function companyRepaymentCorrectionDelta(
  tx: Prisma.TransactionClient, ref: LegacyOriginalRef, cutoff?: Date, receivedOnly = false, excludeTransferId?: string,
) {
  const key = originalSourceKey(ref);
  if (!key || ref.originalTransferId) return 0n;
  const [row] = await tx.$queryRaw<Array<{ delta: bigint }>>(Prisma.sql`
    SELECT public.jg_company_transfer_correction_delta(${key}, ${cutoff ?? null}::timestamp,
      ${receivedOnly}, ${excludeTransferId ?? null}) AS delta
  `);
  return row.delta;
}
/** Already recorded legacy debt remains the authority. Repayment events never recreate its cash. */
export async function readLegacyTransferDebt(tx: Prisma.TransactionClient, ref: LegacyOriginalRef, at?: Date) {
  if (ref.originalFundMovementRelationshipId) {
    const r = await tx.fundMovementRelationshipEntry.findUnique({ where: { id: ref.originalFundMovementRelationshipId }, include: { movement: true } });
    if (!r || r.status !== "confirmed" || r.direction !== "increase" || r.adjustsEntryId || r.debtorCompanyEntityId === r.creditorCompanyEntityId) throw new BadRequestException("请选择已确认的公司间原资金往来");
    const changes = await tx.fundMovementRelationshipEntry.aggregate({ where: { adjustsEntryId: r.id, status: "confirmed", direction: "decrease", ...(at ? { confirmedAt: { lte: at } } : {}) }, _sum: { amountCents: true } });
    return { id: r.id, reference: `原资金往来 ${r.createdAt.toISOString().slice(0, 10)}`, sourceCompanyId: r.debtorCompanyEntityId, destinationCompanyId: r.creditorCompanyEntityId, sourceProjectId: r.beneficiaryProjectId, destinationProjectId: r.sourceProjectId, amountCents: r.amountCents, remainingCents: r.amountCents - (changes._sum.amountCents ?? 0n), occurredAt: r.confirmedAt ?? r.createdAt, kind: r.entryKind, legacyType: "movement" as const };
  }
  if (ref.originalInterEntityRelationshipId) {
    const r = await tx.interEntityRelationshipEntry.findUnique({ where: { id: ref.originalInterEntityRelationshipId } });
    if (!r || r.status !== "confirmed" || r.entryKind !== "proxy_payment" || r.direction !== "increase" || r.adjustsEntryId || r.originalDebtorCompanyId === r.creditorCompanyId || !r.projectId) throw new BadRequestException("请选择具有明确项目归属的已确认公司代付往来");
    const changes = await tx.interEntityRelationshipEntry.aggregate({ where: { adjustsEntryId: r.id, status: "confirmed", direction: "decrease", ...(at ? { confirmedAt: { lte: at } } : {}) }, _sum: { amountCents: true } });
    return { id: r.id, reference: `原代付往来 ${r.createdAt.toISOString().slice(0, 10)}`, sourceCompanyId: r.originalDebtorCompanyId, destinationCompanyId: r.creditorCompanyId, sourceProjectId: r.projectId, destinationProjectId: r.projectId, amountCents: r.amountCents, remainingCents: r.amountCents - (changes._sum.amountCents ?? 0n), occurredAt: r.confirmedAt ?? r.createdAt, kind: r.entryKind, legacyType: "inter_entity" as const };
  }
  if (ref.originalOperationalPaymentId) {
    const row = await tx.registeredOperationalPayment.findUnique({ where: { id: ref.originalOperationalPaymentId } });
    if (!row?.actualPayerCompanyId || row.originalDebtorCompanyId === row.actualPayerCompanyId) {
      throw new BadRequestException("请选择已经登记的公司间代付");
    }
    return { id: row.id, reference: `原业务代付 ${row.paidAt.toISOString().slice(0, 10)}`,
      sourceCompanyId: row.originalDebtorCompanyId, destinationCompanyId: row.actualPayerCompanyId,
      sourceProjectId: row.projectId, destinationProjectId: row.projectId, amountCents: row.amountCents,
      remainingCents: row.amountCents, occurredAt: row.paidAt, kind: "proxy_payment", legacyType: "operational" as const };
  }
  return null;
}
export async function transferRepaymentUsage(tx: Prisma.TransactionClient, ref: LegacyOriginalRef, at?: Date) {
  const requests = await tx.companyTransfer.findMany({ where: { ...ref, status: { in: ["submitted", "approved"] } } });
  const events = await tx.companyTransferEvent.findMany({ where: { transferId: { in: requests.map(r => r.id) } } });
  const [receivedCorrection, reservationCorrection] = await Promise.all([
    companyRepaymentCorrectionDelta(tx, ref, at, true),
    companyRepaymentCorrectionDelta(tx, ref),
  ]);
  return {
    received: events.filter(e => e.kind === "incoming" && (!at || e.occurredAt <= at)).reduce((a, e) => a + e.amountCents, 0n) + receivedCorrection,
    reserved: requests.reduce((a, r) => a + r.amountCents, 0n) - events.filter(e => e.kind === "returned").reduce((a, e) => a + e.amountCents, 0n) + reservationCorrection,
  };
}
