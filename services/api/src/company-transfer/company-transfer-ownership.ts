import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { readLegacyTransferDebt } from "./company-transfer-legacy";

/** Resolve historical ownership only from an approved repayment and its persisted original debt. */
export async function repaymentOwnershipDate(
  tx: Prisma.TransactionClient,
  locator: { projectId: string; sourceBusinessId: string }
): Promise<Date | undefined> {
  const [eventId, marker, legId] = locator.sourceBusinessId.split(":");
  const event = await tx.companyTransferEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new BadRequestException("互转资金事实不存在，请刷新核对");
  const transfer = await tx.companyTransfer.findUniqueOrThrow({ where: { id: event.transferId } });
  if (transfer.kind !== "repayment") return undefined;
  if (marker && (marker !== "relationship" || !transfer.originalFundMovementRelationshipId || event.kind !== "incoming")) throw new BadRequestException("归还事实来源不正确");
  const incoming = event.kind === "incoming";
  const projectId = incoming ? transfer.destinationProjectId : transfer.sourceProjectId;
  if (transfer.status !== "approved" || (marker !== "relationship" && projectId !== locator.projectId)) {
    throw new BadRequestException("归还事实与批准项目不一致");
  }
  let occurredAt: Date | undefined;
  if (transfer.originalTransferId) {
    const original = await tx.companyTransfer.findUniqueOrThrow({ where: { id: transfer.originalTransferId } });
    if (original.kind !== "loan" || original.status !== "approved" || original.sourceCompanyId !== transfer.destinationCompanyId || original.destinationCompanyId !== transfer.sourceCompanyId || original.sourceProjectId !== transfer.destinationProjectId || original.destinationProjectId !== transfer.sourceProjectId) throw new BadRequestException("归还主体与原借款不一致");
    occurredAt = (await tx.companyTransferEvent.findFirst({ where: { transferId: original.id, kind: incoming ? "outgoing" : "incoming", occurredAt: { lte: event.occurredAt } }, orderBy: { occurredAt: "asc" } }))?.occurredAt;
  } else if (transfer.originalProxyId) {
    const original = await tx.contractProxyExecution.findUniqueOrThrow({ where: { id: transfer.originalProxyId } });
    const parties = original.frozenSource as unknown as { debtor: { id: string }; actualPayer: { id: string } };
    if (original.status !== "confirmed" || original.entryKind !== "payment" || original.projectId !== locator.projectId || parties.debtor.id !== transfer.sourceCompanyId || parties.actualPayer.id !== transfer.destinationCompanyId) throw new BadRequestException("归还主体与原代付不一致");
    occurredAt = original.occurredAt;
  } else {
    const debt = await readLegacyTransferDebt(tx, transfer);
    if (!debt || debt.sourceCompanyId !== transfer.sourceCompanyId || debt.destinationCompanyId !== transfer.destinationCompanyId || debt.sourceProjectId !== transfer.sourceProjectId || debt.destinationProjectId !== transfer.destinationProjectId) throw new BadRequestException("归还主体与原往来不一致");
    if (transfer.originalFundMovementRelationshipId) {
      const root = await tx.fundMovementRelationshipEntry.findUniqueOrThrow({ where: { id: transfer.originalFundMovementRelationshipId } });
      const leg = await tx.fundMovementLeg.findFirst({ where: { movementId: root.movementId, projectId: locator.projectId, ...(marker === "relationship" ? { id: legId } : {}), operatingFactId: { not: null } }, orderBy: { id: "asc" } });
      occurredAt = leg?.operatingFactId ? (await tx.operatingFact.findUniqueOrThrow({ where: { id: leg.operatingFactId } })).occurredAt : undefined;
    } else if (transfer.originalInterEntityRelationshipId) {
      const root = await tx.interEntityRelationshipEntry.findUniqueOrThrow({ where: { id: transfer.originalInterEntityRelationshipId } });
      if (root.projectId !== locator.projectId) throw new BadRequestException("原代付项目不一致");
      if (root.paymentExecutionId) occurredAt = (await tx.paymentExecution.findUniqueOrThrow({ where: { id: root.paymentExecutionId } })).paidAt;
      else if (root.fundExecutionId) occurredAt = (await tx.fundExecution.findUniqueOrThrow({ where: { id: root.fundExecutionId } })).occurredAt;
    }
  }
  if (!occurredAt || occurredAt > event.occurredAt) throw new BadRequestException("缺少原债有效归属依据，不能登记归还");
  return occurredAt;
}
