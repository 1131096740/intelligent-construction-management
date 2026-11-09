import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { FileService, PrivateFileStorage } from "../file/file.service";
import type { GeneratedArchiveSealScope } from "./contract-generated-archive-installation";

export const GENERATED_ARCHIVE_PREPARATION_READER = Symbol("GENERATED_ARCHIVE_PREPARATION_READER");
export type GeneratedArchivePreparationReader = Pick<PrivateFileStorage, "readVerifiedVersion">;

type SignedOriginal = Readonly<{
  fileId: string;
  displayOrder: number;
  bucket: string;
  objectKey: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  contentSha256: string;
  objectGeneration: string;
}>;

type PreparedGeneratedArchive = Readonly<{
  scope: GeneratedArchiveSealScope;
  idempotencyKey: string;
  requestSha256: string;
  originals: readonly SignedOriginal[];
}>;

export async function prepareGeneratedArchive(
  tx: Prisma.TransactionClient, files: FileService, reader: GeneratedArchivePreparationReader,
  scope: GeneratedArchiveSealScope, request: { idempotencyKey: string; requestSha256: string; fileIds: readonly string[] }
): Promise<PreparedGeneratedArchive> {
  const enterprise = scope.signingIdentity.enterprise as Record<string, unknown>;
  const assignment = await tx.projectAffiliateAssignment.findUnique({ where: { id: String(enterprise.assignmentId) } });
  if (!assignment || assignment.id !== enterprise.assignmentId || assignment.projectId !== scope.projectId || assignment.businessPartyId !== enterprise.businessPartyId
    || assignment.businessPartyVersionId !== enterprise.businessPartyVersionId) {
    throw new ConflictException("本轮施工企业的项目资料已变化，请核对当前合同");
  }
  if (scope.relationship === "upward") {
    const company = scope.signingIdentity.company as Record<string, unknown>;
    const participant = await tx.projectParticipatingCompany.findUnique({ where: { id: String(company.projectParticipatingCompanyId) } });
    if (!participant || participant.id !== company.projectParticipatingCompanyId || participant.projectId !== scope.projectId || participant.companyEntityId !== company.companyEntityId
      || participant.companyEntityVersionId !== company.joinedCompanyEntityVersionId) {
      throw new ConflictException("本轮我方签约公司的项目资料已变化，请核对当前合同");
    }
  }

  const originals: SignedOriginal[] = [];
  for (const [displayOrder, fileId] of request.fileIds.entries()) {
    await files.assertCanAttachUnlinkedFile(tx, fileId, scope.handlerUserId);
    const file = await tx.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    if (file.mimeType !== "application/pdf" || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0
      || !file.contentSha256 || !/^[a-f0-9]{64}$/u.test(file.contentSha256)) {
      throw new BadRequestException("双方签章原件必须是可校验的PDF文件");
    }
    const { bucket, objectKey, sizeBytes, contentSha256 } = file;
    if (scope.files.some(generated => generated.contentSha256 === contentSha256)) {
      throw new ConflictException("双方签章原件须与本轮生成文书分开上传");
    }
    const { buffer, objectGeneration } = await readSignedOriginalVersion(reader, { bucket, objectKey, sizeBytes, contentSha256 });
    const pdf = await PDFDocument.load(buffer).catch(() => { throw new BadRequestException("归档PDF无法解析，请重新核对原件"); });
    if (!pdf.getPageCount()) throw new BadRequestException("归档PDF不能为空");
    originals.push({ fileId, displayOrder, bucket, objectKey, mimeType: file.mimeType, sizeBytes, contentSha256, objectGeneration });
  }
  for (const { bucket, objectKey, sizeBytes, contentSha256, objectGeneration } of originals) {
    await readSignedOriginalVersion(reader, { bucket, objectKey, sizeBytes, contentSha256, expectedGeneration: objectGeneration });
  }
  return { scope, idempotencyKey: request.idempotencyKey, requestSha256: request.requestSha256, originals };
}

async function readSignedOriginalVersion(reader: GeneratedArchivePreparationReader,
  input: Parameters<GeneratedArchivePreparationReader["readVerifiedVersion"]>[0]) {
  const unavailable = () => new ServiceUnavailableException("资料文件版本或完整性暂无法核对，请保留原件");
  const version = await reader.readVerifiedVersion(input).catch(() => { throw unavailable(); });
  const buffer = version?.buffer, objectGeneration = version?.objectGeneration;
  if (typeof objectGeneration !== "string" || objectGeneration.length > 1024 || !/^[\x21-\x7e]+$/u.test(objectGeneration)
    || objectGeneration.toLowerCase() === "null" || objectGeneration.includes(",")
    || (input.expectedGeneration !== undefined && objectGeneration !== input.expectedGeneration)
    || !Buffer.isBuffer(buffer) || buffer.length !== input.sizeBytes || createHash("sha256").update(buffer).digest("hex") !== input.contentSha256) {
    throw unavailable();
  }
  return { buffer, objectGeneration };
}
