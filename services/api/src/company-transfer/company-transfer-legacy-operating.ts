import { Prisma } from "@prisma/client";
import type { OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";
import { readAffiliateSnapshot, readOperatingLedgerEffectiveDate, sourceJson } from "../operating-ledger/formal-operating-source.helpers";
/** Repay only original relationship/internal-advance effects, never cash, expense or supplier payable. */
export async function legacyRepaymentSnapshot(tx: Prisma.TransactionClient, eventId: string, legId: string, projectId: string): Promise<OperatingSourceSnapshot | null> {
  const event = await tx.companyTransferEvent.findUnique({ where: { id: eventId } }); if (!event || event.kind !== "incoming") return null;
  const t = await tx.companyTransfer.findUniqueOrThrow({ where: { id: event.transferId } }); if (!t.originalFundMovementRelationshipId || ![t.sourceProjectId, t.destinationProjectId].includes(projectId)) return null;
  const root = await tx.fundMovementRelationshipEntry.findUniqueOrThrow({ where: { id: t.originalFundMovementRelationshipId } });
  const leg = await tx.fundMovementLeg.findUnique({ where: { id: legId } }); if (!leg || leg.movementId !== root.movementId || leg.projectId !== projectId || !leg.operatingFactId) return null;
  const fact = await tx.operatingFact.findUniqueOrThrow({ where: { id: leg.operatingFactId }, include: { impacts: { where: { sourceImpactKey: { in: ["internal_relationship", "company_advance_payable"] } } } } });
  const impacts = fact.impacts; if (!impacts.length) return null;
  const affiliate = await readAffiliateSnapshot(tx, { projectId, occurredAt: event.occurredAt }), effective = await readOperatingLedgerEffectiveDate(tx, projectId);
  return { projectId, sourceType: "company_transfer_event", sourceBusinessId: `${event.id}:relationship:${leg.id}`, sourceBusinessCode: t.code, sourceVersion: 1, status: "confirmed", sourceSnapshot: sourceJson({ contractRelationship: "non_contract", legacyRepayment: true, originalRelationshipId: root.id, eventKind: "incoming", companyId: t.destinationCompanyId, amountCents: event.amountCents.toString(), occurredAt: event.occurredAt.toISOString(), confirmedAt: event.createdAt.toISOString(), confirmedByUserId: event.recordedByUserId, affiliate, operatingLedgerEffectiveDate: effective.toISOString(), originalSubjects: fact.subjectSnapshot, legacyImpacts: impacts.map(i => ({ originalImpactId: i.id, originalFactId: i.factId, sourceImpactKey: i.sourceImpactKey, impactKind: i.direction === "increase" ? i.impactKind.replace(/increase$/u, "decrease") : i.impactKind.replace(/decrease$/u, "increase"), direction: i.direction === "increase" ? "decrease" : "increase", subjectRole: i.subjectRole, subject: { kind: i.subjectKind, id: i.subjectId } })) }) };
}
