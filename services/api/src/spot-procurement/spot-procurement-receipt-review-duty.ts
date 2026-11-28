import type { Prisma } from "@prisma/client";
import type { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

export async function readSpotReceiptReviewDuty(
  tx: Prisma.TransactionClient,
  procurementId: string,
  pilot: Pick<SpotProcurementPilotService, "isEnabled">
) {
  const receipt = await tx.spotProcurementReceipt.findUnique({ where: { procurementId } });
  if (!receipt || receipt.status !== "submitted" || receipt.invalidatedAt || !receipt.firstSubmittedAt ||
      !receipt.submittedAt || !receipt.submittedByUserId || !pilot.isEnabled(receipt.projectId)) return null;
  const [procurement, version, revision, project] = await Promise.all([
    tx.spotProcurement.findUnique({ where: { id: procurementId } }),
    tx.spotProcurementVersion.findUnique({ where: { id: receipt.procurementVersionId } }),
    tx.spotProcurementReceiptRevision.findUnique({ where: { receiptId_revisionNo: {
      receiptId: receipt.id, revisionNo: receipt.currentRevisionNo
    } } }),
    tx.project.findUnique({ where: { id: receipt.projectId }, select: { name: true, isActive: true } })
  ]);
  if (!procurement || procurement.projectId !== receipt.projectId || procurement.status !== "approved_in_progress" ||
      procurement.currentVersionId !== receipt.procurementVersionId || procurement.voidedAt ||
      !version || version.status !== "approved" || version.procurementId !== procurementId ||
      !revision || revision.procurementId !== procurementId || revision.procurementVersionId !== version.id ||
      !project?.isActive ||
      [procurement.handlerUserId, version.handlerUserId, revision.handlerUserId].some(id => id !== receipt.handlerUserId) ||
      revision.submittedAt?.getTime() !== receipt.submittedAt.getTime() ||
      revision.submittedByUserId !== receipt.submittedByUserId || revision.submissionDelegationId !== receipt.submissionDelegationId ||
      revision.actualCostCents !== receipt.actualCostCents || procurement.actualCostCents !== receipt.actualCostCents) return null;
  return { receipt, procurement, version, project, submittedAt: receipt.submittedAt };
}
