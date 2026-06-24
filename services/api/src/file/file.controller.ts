import {
  Controller,
  Body,
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
import { AuthService } from "../auth/auth.service";
import { FileService } from "./file.service";

interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface CreateDownloadTicketDto {
  confirmationPassword?: string;
}

@Controller("files")
export class FileController {
  constructor(private readonly files: FileService, private readonly auth: AuthService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
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

  @Post(":fileId/download-ticket")
  async createDownloadTicket(
    @Param("fileId") fileId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input?: CreateDownloadTicketDto
  ) {
    if (!input?.confirmationPassword?.trim()) {
      throw new Error("Confirmation password is required");
    }

    await this.auth.confirmPassword(user.id, input.confirmationPassword);
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
