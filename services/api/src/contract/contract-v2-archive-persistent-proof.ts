import { ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type Contract, type ContractVersion, type ContractArchiveFile } from "@prisma/client";
import { readGeneratedArchiveOriginals, requiresGeneratedArchiveOriginals } from "./contract-generated-archive-original-read";
import type { ArchiveSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v, (_k, value) => typeof value === "bigint" ? value.toString() : value));
function object(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
const same = (a: unknown, b: unknown) => isDeepStrictEqual(json(a), json(b));

export function archiveRequestSha(versionId: string, actor: string, input: ArchiveSignedContractV2Dto) {
  return createHash("sha256").update(JSON.stringify({ versionId, actor, archiveProtocolVersion: input.archiveProtocolVersion, archiveSource: input.archiveSource,
    idempotencyKey: input.idempotencyKey, expectedApprovalInstanceId: input.expectedApprovalInstanceId, expectedSealTaskId: input.expectedSealTaskId,
    documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint,
    fileIds: input.fileIds, confirmedMatchingSignedDocument: input.confirmedMatchingSignedDocument })).digest("hex");
}

/** Read-only durable proof, shared by outcome and detail; caller authorization stays with each reader. */
export async function assertContractV2ArchivePersistentProof(tx: Prisma.TransactionClient,
  owner: Contract, version: ContractVersion | null, durable: ContractArchiveFile) {
  const versionId = durable.contractVersionId, actor = durable.uploadedByUserId, key = durable.idempotencyKey;
  if (!key) throw new ServiceUnavailableException("归档请求标识尚未完整核对，请保留原标识");
  if (durable.archiveSource !== "generated_approval") throw new ServiceUnavailableException("归档来源的持久结果尚未核对，请保留原标识");
  const files = await tx.contractArchiveEvidenceFile.findMany({ where: { archiveFileId: durable.id }, orderBy: { displayOrder: "asc" } });
  const frozen = object(durable.authoritySnapshot), consequence = object(frozen.operatingConsequence);
  if (version?.status !== "effective" || !version.effectiveAt || durable.archiveProtocolVersion !== 2 || !durable.authoritySha256 || !durable.fileManifestSha256 || !same(files.map(f => ({ fileId: f.fileId, displayOrder: f.displayOrder, mimeType: f.mimeType, sizeBytes: f.sizeBytes, contentSha256: f.contentSha256 })), frozen.fileManifest)) throw new ServiceUnavailableException("归档持久结果尚未完整核对，请查询原标识，不要重发");
  const requiresFixedOriginals = requiresGeneratedArchiveOriginals(version, durable);
  if (!requiresFixedOriginals && consequence.mode === "projection_required") {
    const fact = await tx.operatingFact.findUnique({ where: { idempotencyKey: `contract_version:${versionId}` } });
    const impact = await tx.operatingImpactEntry.findUnique({ where: { idempotencyKey: `contract_version:${versionId}:commitment` } });
    const expected = object(consequence.expectedSource), basis = object(frozen.sourceBasis), locator = object(basis.sourceLocator), money = object(basis.money), subjects = object(basis.subjects), signing = object(subjects.signingIdentity), company = object(signing.company);
    const persistedSource = object(fact?.sourceSnapshot);
    const amountMatches = (value: Prisma.Decimal | null | undefined) => expected.amountYuan === null ? value === null : typeof expected.amountYuan === "string" && value !== null && value !== undefined && value.toFixed(4) === expected.amountYuan;
    const basisDelta = typeof money.commitmentDeltaYuan === "string" ? new Prisma.Decimal(money.commitmentDeltaYuan).abs().toFixed(4) : null;
    if (!fact || !impact || expected.sourceType !== "contract_version" || expected.sourceBusinessId !== versionId || expected.sourceVersion !== locator.sourceVersion || expected.entryKind !== "original" || expected.numericProtocolVersion !== 2 || expected.amountYuan !== basisDelta || expected.direction !== money.direction || expected.amountState !== (basisDelta === null ? "unknown" : "known") || expected.sourceImpactKey !== "contract_commitment_reference" || expected.impactKind !== "contract_commitment_reference" || expected.factIdempotencyKey !== fact.idempotencyKey || expected.impactIdempotencyKey !== impact.idempotencyKey ||
      fact.projectId !== owner.projectId || fact.sourceType !== expected.sourceType || fact.sourceBusinessId !== versionId || fact.sourceVersion !== expected.sourceVersion || fact.entryKind !== "original" || fact.factKind !== "downstream_contract" || fact.status !== "confirmed" || fact.numericProtocolVersion !== 2 || fact.amountCents !== null || !amountMatches(fact.amountYuan) || fact.direction !== "neutral" || fact.currencyCode !== "CNY" || fact.debtorSubjectKind !== "participating_company" || fact.debtorSubjectId !== company.companyEntityId || fact.confirmedByUserId !== actor || fact.occurredAt.getTime() !== durable.confirmedAt?.getTime() || fact.confirmedAt.getTime() !== durable.confirmedAt?.getTime() ||
      persistedSource.archiveProtocolVersion !== 2 || persistedSource.archiveAuthorityId !== durable.id || persistedSource.archiveAuthoritySha256 !== durable.authoritySha256 || persistedSource.sourceBasisSha256 !== frozen.sourceBasisSha256 || !same(persistedSource.sourceBasis, basis) ||
      impact.factId !== fact.id || impact.projectId !== owner.projectId || impact.sourceType !== fact.sourceType || impact.sourceBusinessId !== versionId || impact.numericProtocolVersion !== 2 || impact.amountCents !== null || !amountMatches(impact.amountYuan) || impact.sourceImpactKey !== expected.sourceImpactKey || impact.impactKind !== expected.impactKind || impact.direction !== expected.direction || impact.subjectRole !== "debtor" || impact.subjectKind !== fact.debtorSubjectKind || impact.subjectId !== fact.debtorSubjectId) throw new ServiceUnavailableException("经营事实的持久结果尚未确认，请查询原标识，不要重发");
  } else if (!requiresFixedOriginals && consequence.mode !== "not_applicable") throw new ServiceUnavailableException("归档后果预期尚未确认，请查询原标识");
  if (!durable.approvalInstanceId || !durable.sealTaskId || durable.documentContentRevision === null || !durable.documentContentFingerprint) throw new ServiceUnavailableException("归档请求坐标尚未完整核对，请保留原标识");
  const intent: ArchiveSignedContractV2Dto = { archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: key,
    expectedApprovalInstanceId: durable.approvalInstanceId, expectedSealTaskId: durable.sealTaskId,
    documentContentRevision: durable.documentContentRevision, documentContentFingerprint: durable.documentContentFingerprint,
    fileIds: files.map(file => file.fileId), confirmedMatchingSignedDocument: true };
  if (!intent.expectedApprovalInstanceId || !intent.expectedSealTaskId || !Number.isInteger(intent.documentContentRevision) || intent.documentContentRevision < 1 || !/^[a-f0-9]{64}$/.test(intent.documentContentFingerprint) || !files.length || archiveRequestSha(versionId, actor, intent) !== durable.requestSha256) throw new ServiceUnavailableException("归档请求身份尚未完整核对，请保留原标识");
  const response = object(durable.responseSnapshot);
  const result = { archiveId: durable.id, contractVersionId: versionId, status: "effective" as const, fileIds: intent.fileIds };
  if (response.archiveId !== result.archiveId || response.contractVersionId !== result.contractVersionId
    || response.status !== result.status || !Array.isArray(response.fileIds) || !same(response.fileIds, result.fileIds)) {
    throw new ServiceUnavailableException("归档回执尚未完整核对，请保留原标识");
  }
  if (requiresFixedOriginals) {
    await readGeneratedArchiveOriginals(tx, owner, version, durable, files);
    throw new ServiceUnavailableException("归档原件固定版本已核对，正式归档结果尚未确认，请保留本次标识");
  }
  return { status: "archived" as const, result, requestSha256: durable.requestSha256, intent };
}
