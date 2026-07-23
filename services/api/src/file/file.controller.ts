import {
  BadRequestException,
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
import { CreateDownloadTicketDto } from "./dto/create-download-ticket.dto";
import { FileService } from "./file.service";

interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function normalizeUploadedOriginalName(originalName: string) {
  const decoded = Buffer.from(originalName, "latin1").toString("utf8");
  const looksLikeMojibake = /[\u00c0-\u00ff]/.test(originalName);
  const decodedToChinese = /[\u4e00-\u9fff]/.test(decoded);
  const alreadyChinese = /[\u4e00-\u9fff]/.test(originalName);

  if (looksLikeMojibake && decodedToChinese && !alreadyChinese && !decoded.includes("\uFFFD")) {
    return decoded;
  }
  return originalName;
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
      throw new Error("请选择要上传的资料文件");
    }

    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
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
    @Body() input: CreateDownloadTicketDto
  ) {
    if (!input.confirmationPassword.trim()) {
      throw new BadRequestException("请输入当前登录密码后再下载资料");
    }
    if (!input.downloadReason?.trim()) {
      throw new BadRequestException("请填写下载原因，便于留痕审计");
    }

    await this.auth.confirmPassword(user.id, input.confirmationPassword);
    return this.files.createDownloadTicket(fileId, {
      actorUserId: user.id,
      downloadReason: input.downloadReason,
      ...(input.accessMode ? { accessMode: input.accessMode } : {})
    });
  }

  // 下载走短时效票据（expiresAt + token），用于可直接打开的链接，因此不强制 Bearer。
  @Public()
  @Get(":fileId/download")
  async download(
    @Param("fileId") fileId: string,
    @Query("actorUserId") actorUserId: string,
    @Query("expiresAt") expiresAt: string,
    @Query("downloadReason") downloadReason: string,
    @Query("accessMode") accessMode: "download" | "preview" | undefined,
    @Query("token") token: string,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.files.readPrivateFile(fileId, {
      actorUserId,
      expiresAt,
      downloadReason,
      accessMode,
      token
    });

    response.set({
      "Content-Type": result.file.mimeType,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `${result.accessMode === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
        result.file.originalName
      )}`
    });

    return new StreamableFile(result.buffer);
  }
}
