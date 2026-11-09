import { ConflictException } from "@nestjs/common";
import type { Contract, ContractArchiveFile, ContractVersion } from "@prisma/client";
import { chinaDateOnly, normalizeBusinessAmount, sumBusinessAmounts } from "@jiangkong/shared-domain";
import { isDeepStrictEqual } from "node:util";
import { excludedAmountYuan } from "../contract-ledger/contract-economic-coverage";
import { sourceJson } from "../operating-ledger/formal-operating-source.helpers";
import type { OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";

type Archive = Pick<ContractArchiveFile, "id" | "contractVersionId" | "archiveProtocolVersion" | "archiveSource" |
  "status" | "fileId" | "uploadedByUserId" | "confirmedByUserId" | "confirmedAt" | "requestSha256" |
  "authoritySha256" | "authoritySnapshot" | "approvalInstanceId" | "sealTaskId" | "sourceRevision" |
  "documentContentRevision" | "documentContentFingerprint">;
type Version = Pick<ContractVersion, "id" | "contractId" | "versionNo" | "changeType" | "status" | "supersedesVersionId" |
  "firstSubmittedAt" | "effectiveAt" | "taxFactsFrozenAt" | "numericProtocolVersion" | "amountYuan" | "amountLimitType" |
  "pricingNature" | "amountSource" | "signingSubjectType" | "affiliateAssignmentId" | "affiliateBusinessPartyVersionId" |
  "affiliateNameSnapshot" | "affiliateCreditCodeSnapshot" | "companyEntityIdSnapshot" | "companyEntityVersionId" |
  "companyEntityNameSnapshot" | "draftRevision" | "documentContentRevision" | "documentContentFingerprint" | "readinessSnapshot">;
type Owner = Pick<Contract, "id" | "projectId" | "code" | "ownerUserId" | "companyEntityId" | "voidedAt">;
type UpwardContractReference = {
  archiveId: string;
  archiveAuthoritySha256: string;
  sourceBasisSha256: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  sourceBusinessCode: string;
  effectiveAt: string;
  businessDay: string;
  operatingLedgerEffectiveDateSnapshot: string;
  company: { id: string; versionId: string; name: string; participationId: string; joinedCompanyVersionId: string };
  enterprise: { assignmentId: string; businessPartyId: string; businessPartyVersionId: string; name: string };
  contractAmountYuan: string | null;
};
export type GeneratedArchiveOperatingPolicy =
  | { mode: "outside_downstream_commitment"; fact: OperatingSourceFactInput }
  | { mode: "upward_internal_reference"; reference: UpwardContractReference };

function reject(): never {
  throw new ConflictException("生成合同的冻结经营依据不一致，请核对原归档和签约资料");
}
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function frozenDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) reject();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) reject();
  return value;
}
function frozenParty(parties: unknown[], identity: Record<string, unknown>) {
  const rows = parties.map(record).filter(party => party.id === identity.partySnapshotId);
  const [party] = rows;
  if (rows.length !== 1 || !id(identity.partySnapshotId) || party.roleKey !== identity.roleKey
    || party.displayOrder !== 0 || identity.displayOrder !== 0 || party.businessPartyVersionId !== identity.businessPartyVersionId) reject();
  const snapshot = record(party.snapshot);
  const name = typeof snapshot.name === "string" ? snapshot.name.trim() : "";
  const creditCode = typeof snapshot.unifiedSocialCreditCode === "string" ? snapshot.unifiedSocialCreditCode.trim() || null : null;
  if (!name) reject();
  return { name, creditCode };
}

function frozenExclusion(money: Record<string, unknown>, contractRef: string, versionRef: string, archivedAt: string) {
  if (!Array.isArray(money.economicReviewSources) || typeof money.economicExcludedYuan !== "string") reject();
  const reviews = new Set<string>(), oppositeRefs = new Set<string>();
  const amounts = money.economicReviewSources.map(raw => {
    const review = record(raw), document = record(review.frozenDocument);
    const { reviewId, leftSourceRef, rightSourceRef, confirmedAt, revision, coverage } = review;
    if (!id(reviewId) || !id(leftSourceRef) || !id(rightSourceRef) || leftSourceRef === rightSourceRef
      || ![leftSourceRef, rightSourceRef].includes(contractRef) || !Array.isArray(coverage)
      || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1
      || typeof confirmedAt !== "string" || !Number.isFinite(Date.parse(confirmedAt))
      || new Date(confirmedAt).toISOString() !== confirmedAt || confirmedAt > archivedAt
      || document.ref !== contractRef || document.version !== versionRef) reject();
    const oppositeRef = leftSourceRef === contractRef ? rightSourceRef : leftSourceRef;
    if (reviews.has(reviewId) || oppositeRefs.has(oppositeRef)) reject();
    reviews.add(reviewId);
    oppositeRefs.add(oppositeRef);
    return excludedAmountYuan({ leftSourceRef, rightSourceRef, coverage }, contractRef);
  });
  const amount = sumBusinessAmounts(amounts);
  if (amount === null || amount.startsWith("-") || amount !== money.economicExcludedYuan) reject();
  return amount;
}

/** The caller supplies a persisted archive already qualified by the native read/transaction path. */
export function readGeneratedArchiveOperatingPolicy({ archive, contract, version }: {
  archive: Archive; contract: Owner; version: Version;
}): GeneratedArchiveOperatingPolicy | null {
  const authority = record(archive.authoritySnapshot);
  const basis = record(authority.sourceBasis);
  const locator = record(basis.sourceLocator);
  const time = record(basis.businessTime);
  const subjects = record(basis.subjects);
  const identity = record(subjects.signingIdentity);
  const readiness = record(version.readinessSnapshot);
  const money = record(basis.money);
  const consequence = record(authority.operatingConsequence);
  const { relationship } = identity;
  const actor = archive.confirmedByUserId;
  const confirmedAt = archive.confirmedAt;
  if (!confirmedAt || !Number.isFinite(confirmedAt.getTime()) || !id(archive.id) || !id(actor)
    || !id(contract.id) || !id(contract.projectId) || !id(contract.code) || !id(version.id)
    || !id(archive.approvalInstanceId) || !id(archive.sealTaskId)
    || !sha(archive.authoritySha256) || !sha(archive.requestSha256) || !sha(authority.sourceBasisSha256)
    || archive.archiveProtocolVersion !== 2 || archive.archiveSource !== "generated_approval"
    || archive.status !== "confirmed" || archive.fileId !== null || archive.uploadedByUserId !== actor
    || contract.ownerUserId !== actor || contract.voidedAt || archive.contractVersionId !== version.id || version.contractId !== contract.id
    || version.status !== "effective" || version.versionNo !== 1 || version.changeType !== "original"
    || version.supersedesVersionId !== null || !version.firstSubmittedAt || version.numericProtocolVersion !== 2
    || version.effectiveAt?.getTime() !== confirmedAt.getTime() || version.taxFactsFrozenAt?.getTime() !== confirmedAt.getTime()
    || archive.sourceRevision !== version.draftRevision || archive.documentContentRevision !== version.documentContentRevision
    || !sha(version.documentContentFingerprint) || archive.documentContentFingerprint !== version.documentContentFingerprint) reject();

  const archivedAt = confirmedAt.toISOString();
  const businessDay = chinaDateOnly(confirmedAt);
  if (authority.authorityProtocolVersion !== 1 || authority.projectId !== contract.projectId || authority.contractId !== contract.id
    || authority.contractVersionId !== version.id || authority.archiveSource !== archive.archiveSource
    || authority.requestSha256 !== archive.requestSha256 || authority.handlerUserId !== actor || authority.archivedAt !== archivedAt
    || authority.approvalInstanceId !== archive.approvalInstanceId || authority.sealTaskId !== archive.sealTaskId
    || authority.sourceRevision !== version.draftRevision || authority.documentContentRevision !== version.documentContentRevision
    || authority.documentContentFingerprint !== version.documentContentFingerprint || basis.basisProtocolVersion !== 1
    || !isDeepStrictEqual(locator, { projectId: contract.projectId, contractId: contract.id, contractVersionId: version.id,
      sourceType: "contract_version", sourceBusinessId: version.id, sourceVersion: version.versionNo, versionNo: version.versionNo,
      entryKind: "original", changeType: "original", formalCode: contract.code })
    || time.archivedAt !== archivedAt || time.businessDay !== businessDay || time.handlerUserId !== actor
    || (relationship !== "outside" && relationship !== "upward") || identity.protocolVersion !== 1
    || !isDeepStrictEqual(identity, readiness.signingIdentity) || !Array.isArray(subjects.parties)
    || !isDeepStrictEqual(subjects.parties, readiness.parties)) reject();

  const enterprise = record(identity.enterprise);
  if (enterprise.domain !== "project_affiliate_assignment" || !id(enterprise.assignmentId)
    || !id(enterprise.businessPartyId) || !id(enterprise.businessPartyVersionId)
    || (enterprise.roleKey !== "party_a" && enterprise.roleKey !== "party_b")
    || enterprise.assignmentId !== version.affiliateAssignmentId || enterprise.businessPartyVersionId !== version.affiliateBusinessPartyVersionId) reject();
  const enterpriseSnapshot = frozenParty(subjects.parties, enterprise);
  if (enterpriseSnapshot.name !== version.affiliateNameSnapshot || enterpriseSnapshot.creditCode !== version.affiliateCreditCodeSnapshot) reject();
  const amountYuan = normalizeBusinessAmount(version.amountYuan?.toFixed(4) ?? null);
  const amountState = amountYuan === null ? "unknown" : "known";
  if (money.numericProtocolVersion !== 2 || money.amountCents !== null || money.amountYuan !== amountYuan
    || money.amountState !== amountState || money.amountLimitType !== version.amountLimitType
    || money.pricingNature !== version.pricingNature || money.amountSource !== version.amountSource) reject();
  if (isDeepStrictEqual(consequence, { protocolVersion: 1, mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null })) return null;
  const effectiveDay = frozenDate(consequence.operatingLedgerEffectiveDateSnapshot);
  if (consequence.protocolVersion !== 1) reject();

  const affiliate = { assignmentId: enterprise.assignmentId, businessPartyId: enterprise.businessPartyId,
    businessPartyVersionId: enterprise.businessPartyVersionId, ...enterpriseSnapshot };
  if (relationship === "upward") {
    const company = record(identity.company);
    if (consequence.mode !== "internal_reference_only" || consequence.expectedSource !== null
      || version.signingSubjectType !== "upward" || enterprise.roleKey !== "party_b" || subjects.parties.length !== 1
      || identity.roleSource !== "document_company_selection_party_a_and_assignment_party_b"
      || company.domain !== "company_entity_version" || company.roleKey !== "party_a" || company.displayOrder !== 0
      || !id(company.companyEntityId) || !id(company.id) || !id(company.projectParticipatingCompanyId)
      || !id(company.joinedCompanyEntityVersionId) || company.companyEntityId !== contract.companyEntityId
      || company.companyEntityId !== version.companyEntityIdSnapshot || company.id !== version.companyEntityVersionId
      || !id(version.companyEntityNameSnapshot)) reject();
    return { mode: "upward_internal_reference", reference: {
      archiveId: archive.id, archiveAuthoritySha256: archive.authoritySha256, sourceBasisSha256: authority.sourceBasisSha256,
      projectId: contract.projectId, contractId: contract.id, contractVersionId: version.id, sourceBusinessCode: contract.code,
      effectiveAt: archivedAt, businessDay, operatingLedgerEffectiveDateSnapshot: effectiveDay, contractAmountYuan: amountYuan,
      company: { id: company.companyEntityId, versionId: company.id, name: version.companyEntityNameSnapshot,
        participationId: company.projectParticipatingCompanyId, joinedCompanyVersionId: company.joinedCompanyEntityVersionId },
      enterprise: affiliate
    } };
  }

  const downstream = record(identity.downstream);
  const paper = downstream.domain === "contract_party_snapshot";
  if (consequence.mode !== "projection_required" || version.signingSubjectType !== "affiliate" || subjects.parties.length !== 2
    || identity.roleSource !== "document_party_snapshots" || contract.companyEntityId !== null || version.companyEntityIdSnapshot !== null
    || version.companyEntityVersionId !== null || downstream.partySnapshotId === enterprise.partySnapshotId || !id(downstream.partySnapshotId)
    || downstream.roleKey !== (enterprise.roleKey === "party_a" ? "party_b" : "party_a")
    || (paper ? downstream.businessPartyId !== null || downstream.businessPartyVersionId !== null
      : downstream.domain !== "business_party_version" || !id(downstream.businessPartyId) || !id(downstream.businessPartyVersionId)
        || downstream.businessPartyId === enterprise.businessPartyId || downstream.businessPartyVersionId === enterprise.businessPartyVersionId)) reject();
  const downstreamSnapshot = frozenParty(subjects.parties, downstream);
  if ((paper && downstreamSnapshot.name === enterpriseSnapshot.name)
    || (downstreamSnapshot.creditCode && downstreamSnapshot.creditCode.toUpperCase() === enterpriseSnapshot.creditCode?.toUpperCase())) reject();

  const excluded = frozenExclusion(money, `contract:${contract.id}`, `${version.id}:${version.documentContentRevision}`, archivedAt);
  const net = amountYuan === null ? null : sumBusinessAmounts([amountYuan, `-${excluded}`]);
  if (net?.startsWith("-")) reject();
  const direction = net === null ? "notice" : "increase";
  const factKey = `contract_version:${version.id}`, impactKey = `${factKey}:commitment`;
  const impactKind = "contract_commitment_reference";
  if (money.commitmentDeltaYuan !== net || money.direction !== direction || !isDeepStrictEqual(consequence.expectedSource, {
    sourceType: "contract_version", sourceBusinessId: version.id, sourceVersion: version.versionNo, entryKind: "original",
    factIdempotencyKey: factKey, impactIdempotencyKey: impactKey, sourceImpactKey: impactKind, impactKind,
    numericProtocolVersion: 2, amountState, amountYuan: net, direction
  })) reject();

  const counterpartyVersionId = typeof downstream.businessPartyVersionId === "string" ? downstream.businessPartyVersionId : null;
  const debtor = { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId };
  const creditor = { kind: "downstream_counterparty" as const, id: counterpartyVersionId ?? `contract_party_snapshot:${downstream.partySnapshotId}` };
  const factMoney = { numericProtocolVersion: 2 as const, amountCents: null, amountYuan: net };
  return { mode: "outside_downstream_commitment", fact: { entryKind: "original", input: {
    projectId: contract.projectId, sourceType: "contract_version", sourceBusinessId: version.id,
    sourceBusinessCode: contract.code, sourceVersion: version.versionNo, idempotencyKey: factKey,
    occurredAt: confirmedAt, confirmedAt, confirmedByUserId: actor, factKind: "downstream_contract",
    operatingLevel: "project", evidenceLevel: "A", ...factMoney, currencyCode: "CNY", direction: "neutral",
    isBeforeOperatingLedgerEffectiveDate: businessDay < effectiveDay,
    affiliateAssignmentId: affiliate.assignmentId, affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
    affiliateNameSnapshot: affiliate.name, ...(affiliate.creditCode ? { affiliateCreditCodeSnapshot: affiliate.creditCode } : {}),
    sourceSnapshot: sourceJson({
      contractId: contract.id, contractVersionId: version.id, contractRelationship: "outside", signingSubjectType: version.signingSubjectType,
      counterpartyVersionId, counterpartySubjectId: creditor.id, counterpartyName: downstreamSnapshot.name,
      counterpartyIdentity: downstream, archiveProtocolVersion: 2, archiveAuthorityId: archive.id,
      archiveAuthoritySha256: archive.authoritySha256, sourceBasisSha256: authority.sourceBasisSha256, sourceBasis: basis,
      amountNature: amountYuan === null ? "uncapped" : "fixed", numericProtocolVersion: 2, amountYuan, amountState,
      sourceAmountStatus: version.amountLimitType, currentAmount: { protocolVersion: 2, amountState, amountYuan,
        sourceAmountStatus: version.amountLimitType }, priorAmount: null, supersedesVersionId: null,
      economicExcludedYuan: excluded, commitmentDeltaYuan: net, occurredAt: archivedAt, confirmedAt: archivedAt,
      confirmedByUserId: actor, operatingLedgerEffectiveDate: `${effectiveDay}T00:00:00.000Z`, archiveBusinessDay: businessDay, affiliate
    }),
    basisSnapshot: sourceJson({ authority: "effective_contract_version", amountNature: amountYuan === null ? "uncapped" : "fixed" }),
    subjects: { debtor, creditor }, impacts: [{
      idempotencyKey: impactKey, sourceImpactKey: impactKind, impactKind, ...factMoney, direction,
      subjectRole: "debtor", subject: debtor, description: "表外原合同承诺，不形成成本或应付"
    }]
  } } };
}
