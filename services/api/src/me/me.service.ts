import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";

export interface UploadSignatureInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService
  ) {}

  // 个人签名图预上传：存私有文件并记录到 User.signatureFileId，审批单渲染时复用。
  async setSignature(userId: string, input: UploadSignatureInput) {
    if (!input.mimeType.startsWith("image/")) {
      throw new Error("Signature must be an image");
    }
    // 仅接受 PNG/JPEG 魔数，挡掉伪装 mime 的非图片字节（避免渲染时解码异常）。
    const b = input.buffer;
    const isPng = b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpeg = b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("Signature must be a PNG or JPEG image");
    }

    const file = await this.files.uploadPrivateFile({
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedByUserId: userId,
      buffer: input.buffer
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { signatureFileId: file.id }
    });

    return { signatureFileId: file.id };
  }

  async getSignatureTicket(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.signatureFileId) {
      return null;
    }

    return this.files.createDownloadTicket(user.signatureFileId, { actorUserId: userId });
  }
}
