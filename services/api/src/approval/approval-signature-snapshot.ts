import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

interface SignatureSnapshotClient {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
}

export async function snapshotApprovalSignature(
  tx: SignatureSnapshotClient,
  actorUserId: string,
  options: { required: boolean }
): Promise<{ fileId: string | null; sha256: string | null; versionId: string | null }> {
  if (!options.required) return { fileId: null, sha256: null, versionId: null };
  const [user] = await tx.$queryRaw<Array<{
    id: string;
    isActive: boolean;
  }>>(Prisma.sql`
    SELECT "id", "isActive"
    FROM "User"
    WHERE "id" = ${actorUserId}
    FOR UPDATE
  `);
  if (!user?.isActive) {
    throw new ForbiddenException("当前审批账号已停用，请先转交或委托给启用账号");
  }
  const [signatureVersion] = await tx.$queryRaw<Array<{
    id: string;
    fileId: string;
    contentSha256: string;
  }>>(Prisma.sql`
    SELECT "id", "fileId", "contentSha256"
    FROM "HandwrittenSignatureVersion"
    WHERE "userId" = ${actorUserId} AND "source" = 'canvas'
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
    FOR UPDATE
  `);
  if (!signatureVersion) {
    throw new BadRequestException("审批手写签名未配置，请先在个人设置中完成手写签名后重试");
  }

  const [file] = await tx.$queryRaw<Array<{
    id: string;
    contentSha256: string | null;
    storageStatus: string;
  }>>(Prisma.sql`
    SELECT "id", "contentSha256", "storageStatus"
    FROM "FileObject"
    WHERE "id" = ${signatureVersion.fileId}
    FOR UPDATE
  `);
  if (!file || file.storageStatus !== "active" || !/^[a-f0-9]{64}$/iu.test(file.contentSha256 ?? "")) {
    throw new BadRequestException("审批签名文件校验失败，请重新上传签名后重试");
  }
  const verifiedSha256 = file.contentSha256!;
  if (verifiedSha256.toLowerCase() !== signatureVersion.contentSha256.toLowerCase()) {
    throw new BadRequestException("审批手写签名版本校验失败，请重新签名后重试");
  }
  return { fileId: file.id, sha256: verifiedSha256, versionId: signatureVersion.id };
}

export function verifyApprovalSignatureSnapshot(
  buffer: Buffer,
  expectedSha256: string | null | undefined
): Buffer {
  if (!/^[a-f0-9]{64}$/iu.test(expectedSha256 ?? "")) {
    throw new BadRequestException("审批签名快照摘要无效，暂不能生成审批文件");
  }
  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== expectedSha256!.toLowerCase()) {
    throw new BadRequestException("审批签名快照校验失败，请重试或联系管理员");
  }
  if (!isEmbeddableSignatureImage(buffer)) {
    throw new BadRequestException("审批签名快照不是有效的 PNG 或 JPEG 图片");
  }
  return buffer;
}

function isEmbeddableSignatureImage(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPng || isJpeg;
}
