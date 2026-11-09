import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractArchiveEvidenceFile, type ContractVersion } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import type { AuditService } from "../audit/audit.service";
import type { ContractVersionActivationService } from "./contract-version-activation.service";
import { excludedAmountYuan, latestEconomicReviews, reviewAppliesToVersion } from "../contract-ledger/contract-economic-coverage";
import { readGeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";
import { readGeneratedOutsideCommitment } from "./contract-generated-outside-commitment";
import type { GeneratedArchiveOperatingReceipt, GeneratedArchivePinPolicy, GeneratedArchiveRequestBinding, GeneratedArchiveWriterAuthority } from "./contract-generated-archive-installation";
import { assertContractV2ArchivePersistentProof, generatedArchiveCompletion } from "./contract-v2-archive-persistent-proof";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
}

function unavailable(): never {
  throw new ServiceUnavailableException("正式归档资格或经营状态尚未核对，请保留原件和本次标识");
}

export async function writeGeneratedArchive(tx: Prisma.TransactionClient, input: {
  binding: GeneratedArchiveRequestBinding;
  writer: GeneratedArchiveWriterAuthority;
  owner: Contract;
  version: ContractVersion;
  snapshot: Record<string, unknown>;
  archivedAt: Date;
  actingRoleKey: "contract_director" | "contract_staff" | null;
  activation: ContractVersionActivationService;
  audit: AuditService;
}) {
  const { binding, writer, owner, version, snapshot, archivedAt, actingRoleKey, activation, audit } = input;
  const { scope, uploaderUserId: actor } = binding;
  if (!actingRoleKey || version.id !== scope.contractVersionId || owner.id !== scope.contractId
    || owner.projectId !== scope.projectId || owner.ownerUserId !== actor || scope.handlerUserId !== actor
    || writer.transaction !== tx || !isDeepStrictEqual(writer.binding, binding)) unavailable();
  async function readOperatingPolicy(beforeActivation: boolean): Promise<GeneratedArchivePinPolicy> {
    const project = await tx.project.findUnique({ where: { id: scope.projectId }, select: { isActive: true, operatingLedgerEffectiveDate: true } });
    if (!project?.isActive) unavailable();
    const ledgerDate = project.operatingLedgerEffectiveDate;
    const outside = ledgerDate !== null && scope.relationship === "outside" && version.signingSubjectType === "affiliate"
      && writer.installation.outsideWriteQualified === true;
    const upward = ledgerDate !== null && scope.relationship === "upward" && version.signingSubjectType === "upward"
      && writer.installation.upwardOperatingQualified === true;
    if (ledgerDate !== null && !outside && !upward) unavailable();
    const source = { sourceType: "contract_version", sourceBusinessId: scope.contractVersionId,
      ...(ledgerDate === null ? { projectId: scope.projectId } : {}) };
    if ((!outside || beforeActivation) && (await tx.operatingFact.count({ where: source })
      || await tx.operatingImpactEntry.count({ where: source }))) unavailable();
    if (ledgerDate === null) return { policy: "operating_ledger_not_enabled" };
    const operatingLedgerEffectiveDateSnapshot = ledgerDate.toISOString().slice(0, 10);
    return outside ? { policy: "outside_downstream_commitment", operatingLedgerEffectiveDateSnapshot }
      : { policy: "upward_internal_reference", operatingLedgerEffectiveDateSnapshot };
  }
  const operatingPolicy = await readOperatingPolicy(true);
  const outside = operatingPolicy.policy === "outside_downstream_commitment";
  const amount = version.amountYuan?.toFixed(4) ?? null;
  const commitment = outside ? await freezeOutsideMoney(tx, owner, version, archivedAt, amount) : null;
  const operatingConsequence = operatingPolicy.policy === "operating_ledger_not_enabled"
    ? { protocolVersion: 1, mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null }
    : { protocolVersion: 1, operatingLedgerEffectiveDateSnapshot: operatingPolicy.operatingLedgerEffectiveDateSnapshot,
      ...(commitment ? { mode: "projection_required", expectedSource: commitment.expectedSource }
        : { mode: "internal_reference_only", expectedSource: null }) };

  const manifest = binding.originals.map(({ fileId, displayOrder, mimeType, sizeBytes, contentSha256 }) =>
    ({ fileId, displayOrder, mimeType, sizeBytes, contentSha256 }));
  const sourceBasis = {
    basisProtocolVersion: 1,
    sourceLocator: { projectId: scope.projectId, contractId: scope.contractId, contractVersionId: scope.contractVersionId,
      sourceType: "contract_version", sourceBusinessId: scope.contractVersionId, entryKind: "original",
      sourceVersion: version.versionNo, versionNo: version.versionNo, changeType: "original", formalCode: owner.code },
    versionEvidence: { draftRevision: scope.sourceRevision, documentContentRevision: scope.documentContentRevision,
      documentContentFingerprint: scope.documentContentFingerprint, businessTemplateVersionId: snapshot.businessTemplateVersionId,
      layoutTemplateVersionId: scope.layoutTemplateVersionId, sourceSha256: scope.sourceSha256,
      generatedDocumentId: scope.generatedDocumentId, generatedDocumentFiles: { word: scope.files[0], pdf: scope.files[1] },
      approvalInstanceId: scope.approvalInstanceId, sealTaskId: scope.sealTaskId },
    businessTime: { archivedAt: archivedAt.toISOString(), businessDay: chinaDateOnly(archivedAt), handlerUserId: actor },
    fileManifest: manifest,
    money: { numericProtocolVersion: 2, amountCents: null, amountYuan: amount, amountState: amount === null ? "unknown" : "known",
      amountLimitType: version.amountLimitType, pricingNature: version.pricingNature, amountSource: version.amountSource,
      ...commitment?.money },
    subjects: { signingIdentity: scope.signingIdentity, parties: snapshot.parties },
    termsAndTax: { paymentTerms: snapshot.paymentTerms, taxFacts: snapshot.taxFacts }
  };
  const id = randomUUID();
  const response = { archiveId: id, contractVersionId: scope.contractVersionId, status: "effective", fileIds: manifest.map(file => file.fileId) };
  const archive = await tx.contractArchiveFile.create({ data: {
    id, contractVersionId: scope.contractVersionId, fileId: null, archiveProtocolVersion: 2, archiveSource: "generated_approval",
    uploadedByUserId: actor, confirmedByUserId: actor, confirmedAt: archivedAt, status: "confirmed",
    approvalInstanceId: scope.approvalInstanceId, sealTaskId: scope.sealTaskId,
    idempotencyKey: binding.idempotencyKey, requestSha256: binding.requestSha256, sourceRevision: scope.sourceRevision,
    documentContentRevision: scope.documentContentRevision, documentContentFingerprint: scope.documentContentFingerprint,
    authoritySnapshot: json({
      authorityProtocolVersion: 1, projectId: scope.projectId, contractId: scope.contractId, contractVersionId: scope.contractVersionId,
      archiveSource: "generated_approval", handlerUserId: actor, archivedAt: archivedAt.toISOString(), requestSha256: binding.requestSha256,
      sourceRevision: scope.sourceRevision, documentContentRevision: scope.documentContentRevision,
      documentContentFingerprint: scope.documentContentFingerprint, approvalInstanceId: scope.approvalInstanceId,
      sealTaskId: scope.sealTaskId, sourceBasis, fileManifest: manifest,
      operatingConsequence
    }), responseSnapshot: json(response)
  } });
  const authority = archive.authoritySnapshot as Prisma.JsonObject | null;
  if (archive.id !== id || archive.contractVersionId !== scope.contractVersionId || archive.requestSha256 !== binding.requestSha256
    || archive.idempotencyKey !== binding.idempotencyKey || !archive.authoritySha256 || !archive.fileManifestSha256
    || typeof authority?.sourceBasisSha256 !== "string") unavailable();

  const evidence: ContractArchiveEvidenceFile[] = [];
  for (const file of manifest) {
    evidence.push(await tx.contractArchiveEvidenceFile.create({ data: {
      archiveFileId: id, contractVersionId: scope.contractVersionId, ...file
    } }));
  }
  const originalsCommand = generatedArchiveCompletion(owner, archive, evidence, binding.originals, operatingPolicy);
  await writer.appendOriginals(JSON.parse(JSON.stringify(originalsCommand)) as typeof originalsCommand);

  // The project row is already locked by the archive service. Recheck after the installed callback and before activation.
  if (!isDeepStrictEqual(operatingPolicy, await readOperatingPolicy(true))) unavailable();
  await activation.activateArchivedV2(tx, scope.contractVersionId, actor, archivedAt, id);
  await audit.record(tx, {
    actorUserId: actor, action: "contract.archive.complete", businessType: "contract_version", businessId: scope.contractVersionId,
    metadata: json({ archiveId: id, approvalInstanceId: scope.approvalInstanceId, sealTaskId: scope.sealTaskId,
      fileIds: response.fileIds, authoritySha256: archive.authoritySha256, actingRoleKey })
  });
  await writer.appendCompletion(id);
  if (!isDeepStrictEqual(operatingPolicy, await readOperatingPolicy(false))) unavailable();
  const effective = await tx.contractVersion.findUnique({ where: { id: scope.contractVersionId } });
  const persisted = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: binding.idempotencyKey } });
  if (!effective || !persisted || persisted.id !== id) unavailable();
  let operatingReceipt: GeneratedArchiveOperatingReceipt;
  if (operatingPolicy.policy === "outside_downstream_commitment") {
    const policy = readGeneratedArchiveOperatingPolicy({ archive, contract: owner, version: effective });
    if (policy?.mode !== "outside_downstream_commitment") unavailable();
    operatingReceipt = await readGeneratedOutsideCommitment(tx, policy);
  } else {
    operatingReceipt = operatingPolicy;
  }
  const completion = generatedArchiveCompletion(owner, archive, evidence, binding.originals, operatingReceipt);
  await assertContractV2ArchivePersistentProof(tx, owner, effective, persisted, completion);
}

async function freezeOutsideMoney(tx: Prisma.TransactionClient, owner: Contract, version: ContractVersion, archivedAt: Date, amount: string | null) {
  const ref = `contract:${owner.id}`, revision = `${version.id}:${version.documentContentRevision}`;
  const applicable = (await tx.contractEconomicReview.findMany({ where: { projectId: owner.projectId, status: "confirmed",
    confirmedAt: { lte: archivedAt }, OR: [{ leftSourceRef: ref }, { rightSourceRef: ref }] } }))
    .filter(review => reviewAppliesToVersion(review, ref, revision));
  const latest = latestEconomicReviews(applicable);
  if (latest.some(review => applicable.filter(other => other.leftSourceRef === review.leftSourceRef
    && other.rightSourceRef === review.rightSourceRef && other.confirmedAt?.getTime() === review.confirmedAt?.getTime()).length !== 1)) {
    throw new ConflictException("同时确认的履约范围存在歧义，请先核对复核来源");
  }
  const Decimal = Prisma.Decimal.clone({ precision: 60 });
  const excluded = latest.reduce((sum, review) => sum.plus(excludedAmountYuan(review, ref)), new Decimal(0));
  if (amount !== null && excluded.gt(amount)) throw new ConflictException("已确认排除范围超过合同金额，请先核对");
  const net = amount === null ? null : new Decimal(amount).minus(excluded).toFixed(4);
  const direction = net === null ? "notice" : "increase";
  const reviews = latest.sort((a, b) => a.id.localeCompare(b.id)).map(review => ({
    reviewId: review.id, revision: review.revision, confirmedAt: review.confirmedAt!.toISOString(),
    leftSourceRef: review.leftSourceRef, rightSourceRef: review.rightSourceRef, coverage: review.coverage,
    frozenDocument: (review.frozenSources as Prisma.JsonArray).find(row =>
      row !== null && typeof row === "object" && !Array.isArray(row) && row.ref === ref)
  }));
  const factKey = `contract_version:${version.id}`;
  return { money: { commitmentDeltaYuan: net, direction, economicExcludedYuan: excluded.toFixed(4), economicReviewSources: reviews, predecessor: null },
    expectedSource: { sourceType: "contract_version", sourceBusinessId: version.id, sourceVersion: version.versionNo, entryKind: "original",
      factIdempotencyKey: factKey, impactIdempotencyKey: `${factKey}:commitment`, sourceImpactKey: "contract_commitment_reference",
      impactKind: "contract_commitment_reference", numericProtocolVersion: 2, amountState: net === null ? "unknown" : "known", amountYuan: net, direction } };
}
