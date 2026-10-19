import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
export type LegacyOriginalRef = { originalTransferId?: string | null; originalProxyId?: string | null; originalFundMovementRelationshipId?: string | null; originalInterEntityRelationshipId?: string | null };
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
  return null;
}
export async function transferRepaymentUsage(tx: Prisma.TransactionClient, ref: LegacyOriginalRef, at?: Date) {
  const requests = await tx.companyTransfer.findMany({ where: { ...ref, status: { in: ["submitted", "approved"] } } });
  const events = await tx.companyTransferEvent.findMany({ where: { transferId: { in: requests.map(r => r.id) } } });
  return { received: events.filter(e => e.kind === "incoming" && (!at || e.occurredAt <= at)).reduce((a, e) => a + e.amountCents, 0n), reserved: requests.reduce((a, r) => a + r.amountCents, 0n) - events.filter(e => e.kind === "returned").reduce((a, e) => a + e.amountCents, 0n) };
}
