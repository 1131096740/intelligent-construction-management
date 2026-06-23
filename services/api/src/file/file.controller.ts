import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "./file.service";

interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller("files")
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file) {
      throw new Error("Private file is required");
    }

    return this.files.uploadPrivateFile({
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer
    });
  }

  @Get(":fileId/download-ticket")
  createDownloadTicket(
    @Param("fileId") fileId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.files.createDownloadTicket(fileId, { actorUserId: user.id });
  }

  // 下载走短时效票据（expiresAt + token），用于可直接打开的链接，因此不强制 Bearer。
  @Public()
  @Get(":fileId/download")
  async download(
    @Param("fileId") fileId: string,
    @Query("actorUserId") actorUserId: string,
    @Query("expiresAt") expiresAt: string,
    @Query("token") token: string,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.files.readPrivateFile(fileId, { actorUserId, expiresAt, token });

    response.set({
      "Content-Type": result.file.mimeType,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        result.file.originalName
      )}`
    });

    return new StreamableFile(result.buffer);
  }
}
