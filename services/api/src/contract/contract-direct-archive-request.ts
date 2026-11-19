import { createHash } from "node:crypto";
import type { RegisterDirectSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";

/** UTF-8 byte lengths make the identity reproducible by PostgreSQL without JSON serialization order. */
export function directArchiveRequestSha(contractId: string, versionId: string, actor: string, input: RegisterDirectSignedContractV2Dto) {
  const parts = ["contract-direct-archive-request-v1", String(input.archiveProtocolVersion), input.archiveSource, contractId, versionId, actor,
    input.idempotencyKey, String(input.expectedDraftRevision), input.expectedInputSha256, String(input.fileIds.length),
    ...input.fileIds, String(input.confirmedMatchingSignedDocument)];
  return createHash("sha256").update(parts.map(part => `${Buffer.byteLength(part, "utf8")}:${part}`).join("")).digest("hex");
}
