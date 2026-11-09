import { ServiceUnavailableException } from "@nestjs/common";
import { archiveRequestSha } from "./contract-archive-request-digest";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type Contract, type ContractVersion, type ContractArchiveFile, type ContractArchiveEvidenceFile, type FileObject } from "@prisma/client";
import { readGeneratedArchiveOriginals, requiresGeneratedArchiveOriginals } from "./contract-generated-archive-original-read";
import { readGeneratedArchiveCompletion, type GeneratedArchiveCompletion, type GeneratedArchiveOperatingReceipt, type GeneratedArchivePinPolicy, type GeneratedArchiveReceiptFields, type GeneratedArchiveSignedOriginal } from "./contract-generated-archive-installation";
import { readGeneratedOutsideCommitment } from "./contract-generated-outside-commitment";
import { readGeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";
import type { ArchiveSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v, (_k, value) => typeof value === "bigint" ? value.toString() : value));
function object(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
const same = (a: unknown, b: unknown) => isDeepStrictEqual(json(a), json(b));

function requireOriginalArchiveKey(durable: ContractArchiveFile) {
  const key = durable.idempotencyKey;
  if (!key) throw new ServiceUnavailableException("归档请求标识尚未完整核对，请保留原标识");
  if (durable.archiveSource !== "generated_approval") throw new ServiceUnavailableException("归档来源的持久结果尚未核对，请保留原标识");
  return key;
}

async function readOrderedArchiveEvidence(tx: Prisma.TransactionClient, version: ContractVersion | null, durable: ContractArchiveFile) {
  const files = await tx.contractArchiveEvidenceFile.findMany({ where: { archiveFileId: durable.id }, orderBy: { displayOrder: "asc" } });
  const frozen = object(durable.authoritySnapshot);
  if (version?.status !== "effective" || !version.effectiveAt || durable.archiveProtocolVersion !== 2 || !durable.authoritySha256 || !durable.fileManifestSha256 || !same(files.map(f => ({ fileId: f.fileId, displayOrder: f.displayOrder, mimeType: f.mimeType, sizeBytes: f.sizeBytes, contentSha256: f.contentSha256 })), frozen.fileManifest)) throw new ServiceUnavailableException("归档持久结果尚未完整核对，请查询原标识，不要重发");
  return { version, files, frozen };
}

function readOriginalArchiveReceipt(durable: ContractArchiveFile, key: string, files: readonly ContractArchiveEvidenceFile[]) {
  const versionId = durable.contractVersionId, actor = durable.uploadedByUserId;
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
  return { intent, result };
}

/** Called after current file authorization. Formal receipt/accounting qualification remains a separate gate. */
export async function readGeneratedArchiveDownloadGeneration(tx: Prisma.TransactionClient, owner: Contract, version: ContractVersion,
  archive: ContractArchiveFile, evidence: ContractArchiveEvidenceFile, file: FileObject) {
  const key = requireOriginalArchiveKey(archive);
  const { files } = await readOrderedArchiveEvidence(tx, version, archive);
  readOriginalArchiveReceipt(archive, key, files);
  const selectedEvidence = files[evidence.displayOrder];
  const original = (await readGeneratedArchiveOriginals(tx, owner, version, archive, files))[evidence.displayOrder];
  if (!selectedEvidence || selectedEvidence.id !== evidence.id || !original || original.fileId !== file.id
    || original.bucket !== file.bucket || original.objectKey !== file.objectKey
    || original.mimeType !== file.mimeType || original.sizeBytes !== file.sizeBytes || original.contentSha256 !== file.contentSha256
    || file.storageStatus !== "active" || file.purgeReceiptId !== null || file.supersedesFileObjectId !== null) {
    throw new ServiceUnavailableException("归档原件固定版本尚未完整核对，暂不能下载");
  }
  return original.objectGeneration;
}

export function generatedArchiveCompletion<Policy extends GeneratedArchivePinPolicy>(owner: Contract, archive: ContractArchiveFile,
  files: readonly ContractArchiveEvidenceFile[], originals: readonly GeneratedArchiveSignedOriginal[],
  operatingReceipt: Policy): GeneratedArchiveReceiptFields & Policy {
  const { approvalInstanceId, sealTaskId, idempotencyKey, requestSha256, authoritySha256, fileManifestSha256, confirmedAt } = archive;
  if (!approvalInstanceId || !sealTaskId || !idempotencyKey || !requestSha256 || !authoritySha256 || !fileManifestSha256 || !confirmedAt) {
    throw new ServiceUnavailableException("归档请求持久证据尚未完整核对，请保留原标识");
  }
  const fields: GeneratedArchiveReceiptFields = { protocolVersion: 1, archiveId: archive.id, projectId: owner.projectId,
    contractId: owner.id, contractVersionId: archive.contractVersionId, approvalInstanceId, sealTaskId,
    uploaderUserId: archive.uploadedByUserId, idempotencyKey, requestSha256, authoritySha256, fileManifestSha256,
    archivedAt: confirmedAt.toISOString(), evidenceIds: files.map(file => file.id), originals };
  return { ...operatingReceipt, ...fields };
}

/** Read-only durable proof, shared by outcome and detail; caller authorization stays with each reader. */
export async function assertContractV2ArchivePersistentProof(tx: Prisma.TransactionClient,
  owner: Contract, currentVersion: ContractVersion | null, durable: ContractArchiveFile, expected?: GeneratedArchiveCompletion) {
  const versionId = durable.contractVersionId, actor = durable.uploadedByUserId, key = requireOriginalArchiveKey(durable);
  const { version, files, frozen } = await readOrderedArchiveEvidence(tx, currentVersion, durable);
  const consequence = object(frozen.operatingConsequence);
  const requiresFixedOriginals = requiresGeneratedArchiveOriginals(version, durable);
  if (expected && !requiresFixedOriginals) {
    throw new ServiceUnavailableException("归档来源的持久结果尚未核对，请保留原标识");
  }
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
  const { intent, result } = readOriginalArchiveReceipt(durable, key, files);
  if (requiresFixedOriginals) {
    const originals = await readGeneratedArchiveOriginals(tx, owner, version, durable, files);
    const completion = await readGeneratedArchiveCompletion(tx, durable.id).catch(() => null);
    let operatingReceipt: GeneratedArchiveOperatingReceipt = { policy: "operating_ledger_not_enabled" };
    if (consequence.mode === "internal_reference_only") {
      const policy = readGeneratedArchiveOperatingPolicy({ archive: durable, contract: owner, version });
      const source = { sourceType: "contract_version", sourceBusinessId: versionId };
      if (policy?.mode !== "upward_internal_reference" || await tx.operatingFact.count({ where: source })
        || await tx.operatingImpactEntry.count({ where: source })) {
        throw new ServiceUnavailableException("对上合同经营依据尚未核对，请保留本次标识");
      }
      operatingReceipt = { policy: "upward_internal_reference",
        operatingLedgerEffectiveDateSnapshot: policy.reference.operatingLedgerEffectiveDateSnapshot };
    } else if (consequence.mode === "projection_required") {
      const policy = readGeneratedArchiveOperatingPolicy({ archive: durable, contract: owner, version });
      if (policy?.mode !== "outside_downstream_commitment") {
        throw new ServiceUnavailableException("表外合同下游承诺尚未完整核对，请保留本次标识");
      }
      operatingReceipt = await readGeneratedOutsideCommitment(tx, policy);
    }
    const expectedConsequence = operatingReceipt.policy === "operating_ledger_not_enabled"
      ? { protocolVersion: 1, mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null }
      : { protocolVersion: 1, operatingLedgerEffectiveDateSnapshot: operatingReceipt.operatingLedgerEffectiveDateSnapshot,
        ...(operatingReceipt.policy === "upward_internal_reference"
          ? { mode: "internal_reference_only", expectedSource: null }
          : { mode: "projection_required", expectedSource: consequence.expectedSource }) };
    const actual = generatedArchiveCompletion(owner, durable, files, originals, operatingReceipt);
    if (!completion || completion.transaction !== tx || !same(completion.completion, actual)
      || (expected && !same(expected, actual)) || !same(consequence, expectedConsequence)) {
      throw new ServiceUnavailableException("归档原件固定版本已核对，正式归档结果尚未确认，请保留本次标识");
    }
  }
  return { status: "archived" as const, result, requestSha256: durable.requestSha256, intent };
}
