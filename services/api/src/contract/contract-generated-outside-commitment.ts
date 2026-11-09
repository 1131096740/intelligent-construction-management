import { ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { normalizeOperatingSourceSnapshot, operatingNumericSnapshot, sameOperatingMoney } from "../operating-ledger/operating-money-protocol";
import type { GeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";
import type { GeneratedArchiveOperatingReceipt } from "./contract-generated-archive-installation";

type OutsidePolicy = Extract<GeneratedArchiveOperatingPolicy, { mode: "outside_downstream_commitment" }>;

function unavailable(): never {
  throw new ServiceUnavailableException("表外合同下游承诺尚未完整核对，请保留本次标识");
}

/** Match both durable operating rows to the frozen archive rather than using their values as authority. */
export async function readGeneratedOutsideCommitment(tx: Prisma.TransactionClient, { fact: { input } }: OutsidePolicy):
  Promise<Extract<GeneratedArchiveOperatingReceipt, { policy: "outside_downstream_commitment" }>> {
  const { projectId, sourceType, sourceBusinessId } = input;
  const source = { sourceType, sourceBusinessId };
  const [fact, ...extraFacts] = await tx.operatingFact.findMany({ where: source, take: 2 });
  const expectedDebtor = input.subjects.debtor, expectedCreditor = input.subjects.creditor;
  const expectedImpact = input.impacts[0];
  const { affiliate, operatingLedgerEffectiveDate } = input.sourceSnapshot;
  if (!expectedDebtor || !expectedCreditor || input.numericProtocolVersion !== 2 || expectedImpact?.numericProtocolVersion !== 2
    || !affiliate || typeof affiliate !== "object" || Array.isArray(affiliate) || !("businessPartyId" in affiliate)
    || typeof affiliate.businessPartyId !== "string" || typeof operatingLedgerEffectiveDate !== "string") unavailable();
  const debtor = { ...expectedDebtor, businessPartyId: affiliate.businessPartyId,
    businessPartyVersionId: input.affiliateBusinessPartyVersionId, name: input.affiliateNameSnapshot,
    creditCode: input.affiliateCreditCodeSnapshot ?? null };
  if (!fact || extraFacts.length || fact.projectId !== projectId || fact.sourceType !== sourceType
    || fact.sourceBusinessId !== sourceBusinessId || fact.sourceVersion !== input.sourceVersion
    || fact.sourceBusinessCode !== input.sourceBusinessCode || fact.idempotencyKey !== input.idempotencyKey
    || fact.status !== "confirmed" || fact.entryKind !== "original" || fact.factKind !== input.factKind
    || fact.operatingLevel !== input.operatingLevel || fact.evidenceLevel !== input.evidenceLevel
    || fact.direction !== input.direction || fact.currencyCode !== input.currencyCode || !sameOperatingMoney(fact, input)
    || fact.occurredAt.getTime() !== input.occurredAt.getTime() || fact.confirmedAt.getTime() !== input.confirmedAt.getTime()
    || fact.confirmedByUserId !== input.confirmedByUserId || fact.recordedByUserId !== input.confirmedByUserId
    || fact.operatingLedgerEffectiveDateSnapshot.toISOString() !== operatingLedgerEffectiveDate
    || fact.isBeforeOperatingLedgerEffectiveDate !== input.isBeforeOperatingLedgerEffectiveDate
    || fact.affiliateAssignmentId !== input.affiliateAssignmentId
    || fact.affiliateBusinessPartyVersionId !== input.affiliateBusinessPartyVersionId
    || fact.affiliateNameSnapshot !== input.affiliateNameSnapshot
    || (fact.affiliateCreditCodeSnapshot ?? null) !== (input.affiliateCreditCodeSnapshot ?? null)
    || fact.debtorSubjectKind !== expectedDebtor.kind || fact.debtorSubjectId !== expectedDebtor.id
    || fact.creditorSubjectKind !== expectedCreditor.kind || fact.creditorSubjectId !== expectedCreditor.id
    || [fact.adjustsFactId, fact.historicalTakeoverBatchId, fact.paymentExecutionId, fact.fundExecutionId, fact.fundExecutionCaseId,
      fact.approvedPayerSubjectKind, fact.approvedPayerSubjectId, fact.actualPayerSubjectKind, fact.actualPayerSubjectId,
      fact.payeeSubjectKind, fact.payeeSubjectId, fact.costBearingCompanySubjectKind, fact.costBearingCompanySubjectId].some(value => value != null)
    || !isDeepStrictEqual(fact.subjectSnapshot, { debtor, creditor: expectedCreditor })
    || !isDeepStrictEqual(fact.basisSnapshot, input.basisSnapshot)
    || !isDeepStrictEqual(fact.sourceSnapshot, normalizeOperatingSourceSnapshot(input))) unavailable();

  const [impact, ...extraImpacts] = await tx.operatingImpactEntry.findMany({
    where: { OR: [source, { factId: fact.id }] }, take: 2
  });
  if (!impact || extraImpacts.length || impact.factId !== fact.id || impact.projectId !== projectId
    || impact.sourceType !== sourceType || impact.sourceBusinessId !== sourceBusinessId || impact.idempotencyKey !== expectedImpact.idempotencyKey
    || impact.sourceImpactKey !== expectedImpact.sourceImpactKey || impact.impactKind !== expectedImpact.impactKind
    || impact.direction !== expectedImpact.direction || !sameOperatingMoney(impact, expectedImpact)
    || impact.subjectRole !== expectedImpact.subjectRole || impact.subjectKind !== expectedDebtor.kind || impact.subjectId !== expectedDebtor.id
    || impact.description !== expectedImpact.description
    || [impact.costCategoryCode, impact.fundPurpose, impact.paymentExecutionId, impact.fundExecutionId,
      impact.fundExecutionCaseId, impact.executionAllocationLineId].some(value => value != null)
    || !isDeepStrictEqual(impact.impactSnapshot, { numericFacts: operatingNumericSnapshot(expectedImpact), subjectSnapshot: debtor })) unavailable();
  return { policy: "outside_downstream_commitment", operatingLedgerEffectiveDateSnapshot: operatingLedgerEffectiveDate.slice(0, 10),
    operatingFactId: fact.id, operatingImpactId: impact.id };
}
