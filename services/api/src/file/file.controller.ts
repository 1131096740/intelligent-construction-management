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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateDownloadTicketDto } from "./dto/create-download-ticket.dto";
import { CreateFilePackageDto } from "./dto/create-file-package.dto";
import { UploadPrivateFileDto } from "./dto/upload-private-file.dto";
import { FileService } from "./file.service";
import {
  FileInterceptor,
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "./uploaded-file";

function parsePackageFileIds(raw: string | string[] | undefined): string[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

@Controller("files")
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post()
  @RequirePositions(
    "contract_staff",
    "contract_director",
    "finance_staff",
    "finance_director"
  )
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  upload(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadPrivateFileDto = new UploadPrivateFileDto()
  ) {
    if (!file) {
      throw new Error("请选择要上传的资料文件");
    }

    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(body.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: body.idempotencyKey })
    });
  }

  @Get("download-package-capability")
  downloadPackageCapability(
    @CurrentUser() user: AuthenticatedUser,
    @Query("fileIds") fileIds?: string | string[]
  ) {
    return this.files.getDownloadPackageCapability(parsePackageFileIds(fileIds), user.id);
  }

  @Post("download-package")
  async downloadPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateFilePackageDto,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.files.createDownloadPackage(input.fileIds, user.id);

    response.set({
      "Content-Type": "application/zip",
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
    });

    return new StreamableFile(result.buffer);
  }

  @Post(":fileId/download-ticket")
  async createDownloadTicket(
    @Param("fileId") fileId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateDownloadTicketDto
  ) {
    return this.files.createDownloadTicket(fileId, {
      actorUserId: user.id,
      ...(input.downloadReason?.trim() ? { downloadReason: input.downloadReason } : {}),
      ...(input.delegatorUserId ? { delegatorUserId: input.delegatorUserId } : {}),
      ...(input.accessMode ? { accessMode: input.accessMode } : {})
    });
  }

  @Get(":fileId/download-ticket-capability")
  downloadTicketCapability(
    @Param("fileId") fileId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("delegatorUserId") delegatorUserId?: string
  ) {
    return this.files.getDownloadTicketCapability(fileId, user.id, delegatorUserId);
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
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void },
    @Query("delegatorUserId") delegatorUserId?: string
  ) {
    const result = await this.files.readPrivateFile(fileId, {
      actorUserId,
      expiresAt,
      downloadReason,
      accessMode,
      ...(delegatorUserId ? { delegatorUserId } : {}),
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
