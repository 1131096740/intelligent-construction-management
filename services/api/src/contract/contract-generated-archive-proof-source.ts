import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { archiveRequestSha } from "./contract-archive-request-digest";
import type { GeneratedArchiveBindingWitness, GeneratedArchiveRequestBinding, GeneratedArchiveSealAuthority,
  GeneratedArchiveSealScope, GeneratedArchiveSignedOriginal, GeneratedArchiveVerifiedVersion } from "./contract-generated-archive-installation";
import { assertGeneratedArchiveSealSources, generatedArchiveSealScope } from "./contract-generated-archive-seal-authority";
import { readGeneratedArchiveWriteInstallation } from "./contract-generated-archive-write-authority";
import { contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "./contract-parallel-duty-access";

async function readScope(tx: Prisma.TransactionClient, candidate: GeneratedArchiveSealScope, forArchive: boolean) {
  const version = await tx.contractVersion.findUnique({ where: { id: candidate.contractVersionId } });
  if (!version || version.numericProtocolVersion !== 2 || !version.firstSubmittedAt || !version.documentContentFingerprint) return null;
  const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
  if (!contract || contract.voidedAt) return null;
  const project = await tx.project.findUnique({ where: { id: contract.projectId } });
  if (!project?.isActive || project.operatingLedgerEffectiveDate !== null) return null;

  const rounds = await tx.approvalInstance.findMany({ where: { businessId: version.id, businessType: "contract_version",
    flowType: "contract.approve", status: { in: ["in_progress", "approved"] } } });
  const tasks = await tx.contractSealTask.findMany({ where: { contractVersionId: version.id, status: { not: "cancelled" } } });
  if (rounds.length !== 1 || tasks.length !== 1) return null;
  const [round] = rounds, [task] = tasks;
  const snapshot = contractRoundSubmissionSnapshot(round.frozenNodes);
  if (round.id !== candidate.approvalInstanceId || round.status !== "approved" || activeApprovalNodeIndexes(round.frozenNodes, 0).length
    || task.id !== candidate.sealTaskId || task.approvalInstanceId !== round.id || task.handlerUserId !== round.applicantUserId
    || !task.approvedAt || !task.approvedByUserId || !snapshot || !isDeepStrictEqual(version.readinessSnapshot, snapshot)
    || snapshot.contractVersionId !== version.id || snapshot.documentContentRevision !== version.documentContentRevision
    || snapshot.documentContentFingerprint !== version.documentContentFingerprint) return null;

  let confirmer: string;
  if (!forArchive && version.status === "approved_pending_seal" && task.status === "in_seal"
    && !task.completedAt && !task.completedByUserId) {
    if (!await hasActiveContractGlobalRole(tx, candidate.actorUserId, "comprehensive_director")) return null;
    confirmer = candidate.actorUserId;
  } else if ((version.status === "seal_approved_pending_archive" || !forArchive && version.status === "effective")
    && task.status === "completed" && task.completedAt && task.completedByUserId && task.completedAt >= task.approvedAt) {
    confirmer = task.completedByUserId;
  } else return null;

  if (version.status === "effective") {
    const archive = await tx.contractArchiveFile.findFirst({ where: { contractVersionId: version.id,
      archiveProtocolVersion: 2, archiveSource: "generated_approval", status: "confirmed" } });
    if (!archive || !archive.authoritySha256 || archive.approvalInstanceId !== round.id || archive.sealTaskId !== task.id
      || archive.uploadedByUserId !== task.handlerUserId || archive.confirmedByUserId !== task.handlerUserId
      || !archive.confirmedAt || archive.confirmedAt.getTime() !== version.effectiveAt?.getTime()) return null;
  }
  const scope = generatedArchiveSealScope(contract, version, round, task, snapshot, confirmer, version.documentContentFingerprint);
  if (!scope || !isDeepStrictEqual(scope, candidate)) return null;
  await assertGeneratedArchiveSealSources(tx, scope, snapshot);
  return scope;
}

export async function readNativeGeneratedArchiveSealAuthority(tx: Prisma.TransactionClient,
  candidate: GeneratedArchiveSealScope): Promise<GeneratedArchiveSealAuthority | null> {
  const installation = await readGeneratedArchiveWriteInstallation(tx);
  if (!installation) return null;
  const scope = await readScope(tx, candidate, false);
  return scope ? { transaction: tx, scope, installation } : null;
}

export async function readNativeGeneratedArchiveRequestBinding(tx: Prisma.TransactionClient,
  candidate: GeneratedArchiveRequestBinding, verifiedVersions: readonly GeneratedArchiveVerifiedVersion[]
): Promise<GeneratedArchiveBindingWitness | null> {
  const installation = await readGeneratedArchiveWriteInstallation(tx);
  if (!installation) return null;
  const scope = await readScope(tx, candidate.scope, true);
  if (!scope || scope.handlerUserId !== candidate.uploaderUserId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate.idempotencyKey)) return null;
  const uploaderUserId = scope.handlerUserId;
  const fileIds = candidate.originals.map(file => file.fileId);
  if (fileIds.length < 1 || fileIds.length > 20 || new Set(fileIds).size !== fileIds.length
    || verifiedVersions.length !== fileIds.length || scope.files.some(file => fileIds.includes(file.fileId))) return null;
  const rows = await tx.fileObject.findMany({ where: { id: { in: fileIds } } });
  if (rows.length !== fileIds.length) return null;
  const originals: GeneratedArchiveSignedOriginal[] = [];
  const storageCoordinates = new Set<string>();
  for (const [displayOrder, fileId] of fileIds.entries()) {
    const file = rows.find(row => row.id === fileId), verified = verifiedVersions[displayOrder];
    if (!file || file.uploadedByUserId !== uploaderUserId || file.storageStatus !== "active" || file.purgeReceiptId
      || file.supersedesFileObjectId || file.mimeType !== "application/pdf" || !file.contentSha256
      || !/^[a-f0-9]{64}$/u.test(file.contentSha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1
      || file.bucket !== verified.bucket || file.objectKey !== verified.objectKey || file.sizeBytes !== verified.sizeBytes
      || file.contentSha256 !== verified.contentSha256 || scope.files.some(source => source.contentSha256 === file.contentSha256)
      || !/^[\x21-\x7e]{1,1024}$/u.test(verified.objectGeneration) || verified.objectGeneration.toLowerCase() === "null"
      || verified.objectGeneration.includes(",")) return null;
    const { bucket, objectKey, mimeType, sizeBytes, contentSha256 } = file;
    const coordinate = JSON.stringify([bucket, objectKey]);
    if (storageCoordinates.has(coordinate)) return null;
    storageCoordinates.add(coordinate);
    originals.push({ fileId, displayOrder, bucket, objectKey, mimeType, sizeBytes, contentSha256,
      objectGeneration: verified.objectGeneration });
  }
  const idempotencyKey = candidate.idempotencyKey;
  const requestSha256 = archiveRequestSha(scope.contractVersionId, uploaderUserId, {
    archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey, fileIds,
    expectedApprovalInstanceId: scope.approvalInstanceId, expectedSealTaskId: scope.sealTaskId,
    documentContentRevision: scope.documentContentRevision, documentContentFingerprint: scope.documentContentFingerprint,
    confirmedMatchingSignedDocument: true
  });
  const binding: GeneratedArchiveRequestBinding = { protocolVersion: 1, archiveSource: "generated_approval",
    scope, uploaderUserId, idempotencyKey, requestSha256, originals };
  return isDeepStrictEqual(binding, candidate) ? { transaction: tx, installation, binding } : null;
}
