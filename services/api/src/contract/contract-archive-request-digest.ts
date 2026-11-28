import { createHash } from "node:crypto";
import type { ArchiveSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";

export function archiveRequestSha(versionId: string, actor: string, input: ArchiveSignedContractV2Dto) {
  return createHash("sha256").update(JSON.stringify({ versionId, actor, archiveProtocolVersion: input.archiveProtocolVersion, archiveSource: input.archiveSource,
    idempotencyKey: input.idempotencyKey, expectedApprovalInstanceId: input.expectedApprovalInstanceId, expectedSealTaskId: input.expectedSealTaskId,
    documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint,
    fileIds: input.fileIds, confirmedMatchingSignedDocument: input.confirmedMatchingSignedDocument })).digest("hex");
}
