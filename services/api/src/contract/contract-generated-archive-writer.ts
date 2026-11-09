import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractArchiveEvidenceFile, type ContractVersion } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import type { AuditService } from "../audit/audit.service";
import type { ContractVersionActivationService } from "./contract-version-activation.service";
import type { GeneratedArchiveRequestBinding, GeneratedArchiveWriterAuthority } from "./contract-generated-archive-installation";
import { assertContractV2ArchivePersistentProof, generatedArchiveCompletion } from "./contract-v2-archive-persistent-proof";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
}

function unavailable(): never {
  throw new ServiceUnavailableException("正式归档资格或经营状态尚未核对，请保留原件和本次标识");
}

async function assertOperatingLedgerNotEnabled(tx: Prisma.TransactionClient, projectId: string, contractVersionId: string) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { isActive: true, operatingLedgerEffectiveDate: true } });
  if (!project?.isActive || project.operatingLedgerEffectiveDate !== null) unavailable();
  const source = { projectId, sourceType: "contract_version", sourceBusinessId: contractVersionId };
  if (await tx.operatingFact.count({ where: source }) || await tx.operatingImpactEntry.count({ where: source })) unavailable();
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
  await assertOperatingLedgerNotEnabled(tx, scope.projectId, scope.contractVersionId);

  const manifest = binding.originals.map(({ fileId, displayOrder, mimeType, sizeBytes, contentSha256 }) =>
    ({ fileId, displayOrder, mimeType, sizeBytes, contentSha256 }));
  const amount = version.amountYuan?.toFixed(4) ?? null;
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
    // Preserve the actual contract facts. No commitment or operating entries are derived in this branch.
    money: { numericProtocolVersion: 2, amountCents: null, amountYuan: amount, amountState: amount === null ? "unknown" : "known",
      amountLimitType: version.amountLimitType, pricingNature: version.pricingNature, amountSource: version.amountSource },
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
      operatingConsequence: { protocolVersion: 1, mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null }
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
  const completion = generatedArchiveCompletion(owner, archive, evidence, binding.originals);
  await writer.appendOriginals(JSON.parse(JSON.stringify(completion)) as typeof completion);

  // The project row is already locked by the archive service. Recheck after the installed callback and before activation.
  await assertOperatingLedgerNotEnabled(tx, scope.projectId, scope.contractVersionId);
  await activation.activateArchivedV2(tx, scope.contractVersionId, actor, archivedAt, id);
  await audit.record(tx, {
    actorUserId: actor, action: "contract.archive.complete", businessType: "contract_version", businessId: scope.contractVersionId,
    metadata: json({ archiveId: id, approvalInstanceId: scope.approvalInstanceId, sealTaskId: scope.sealTaskId,
      fileIds: response.fileIds, authoritySha256: archive.authoritySha256, actingRoleKey })
  });
  await writer.appendCompletion(id);
  await assertOperatingLedgerNotEnabled(tx, scope.projectId, scope.contractVersionId);
  const effective = await tx.contractVersion.findUnique({ where: { id: scope.contractVersionId } });
  const persisted = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: binding.idempotencyKey } });
  if (!persisted || persisted.id !== id) unavailable();
  await assertContractV2ArchivePersistentProof(tx, owner, effective, persisted, completion);
}
