import {
  Body,
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
import { CreateFileDownloadTicketDto } from "./dto/create-file-download-ticket.dto";
import { UploadPrivateFileDto } from "./dto/upload-private-file.dto";
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
  upload(@UploadedFile() file: MemoryUploadedFile | undefined, @Body() body: UploadPrivateFileDto) {
    if (!file) {
      throw new Error("Private file is required");
    }

    return this.files.uploadPrivateFile({
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: body.uploadedByUserId,
      buffer: file.buffer
    });
  }

  @Get(":fileId/download-ticket")
  createDownloadTicket(
    @Param("fileId") fileId: string,
    @Query() query: CreateFileDownloadTicketDto
  ) {
    return this.files.createDownloadTicket(fileId, query);
  }

  @Get(":fileId/download")
  async download(
    @Param("fileId") fileId: string,
    @Query("expiresAt") expiresAt: string,
    @Query("token") token: string,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.files.readPrivateFile(fileId, { expiresAt, token });

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
