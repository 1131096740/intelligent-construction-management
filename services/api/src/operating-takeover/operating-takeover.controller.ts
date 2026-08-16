import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { normalizeUploadedOriginalName, type MemoryUploadedFile } from "../file/uploaded-file";
import {
  AddOperatingTakeoverAttachmentGroupDto,
  ActivateOperatingTakeoverDto,
  ConfirmOperatingTakeoverDto,
  CreateOperatingTakeoverBatchDto,
  PrecheckOperatingTakeoverDto,
  UpdateOperatingTakeoverRowDto
} from "./operating-takeover.dto";
import { OperatingTakeoverExcelService, OPERATING_TAKEOVER_XLSX_MIME } from "./operating-takeover-excel.service";
import { OperatingTakeoverService } from "./operating-takeover.service";

@Controller("projects/:projectId/operating-takeovers")
export class OperatingTakeoverController {
  constructor(
    private readonly takeovers: OperatingTakeoverService,
    private readonly excel: OperatingTakeoverExcelService
  ) {}

  @Get("capability")
  @RequireProjectRole("operating_takeover.manage")
  capability(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeovers.capability(projectId, user.id);
  }

  @Get("scenes")
  @RequireProjectRole("operating_takeover.manage")
  scenes(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeovers.sceneList(projectId, user.id);
  }

  @Get("workbook-template")
  @RequireProjectRole("operating_takeover.manage")
  async workbookTemplate(
    @Query("sceneKey") sceneKey: string | undefined,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.excel.exportTemplate(sceneKey);
    this.downloadHeaders(response, result.buffer, result.fileName);
    return new StreamableFile(result.buffer);
  }

  @Post("precheck")
  @RequireProjectRole("operating_takeover.manage")
  precheck(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: PrecheckOperatingTakeoverDto) {
    return this.takeovers.precheck(projectId, user.id, body);
  }

  @Post("precheck-xlsx")
  @RequireProjectRole("operating_takeover.manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async precheckXlsx(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @Query("sceneKey") sceneKey?: string
  ) {
    if (!file) throw new BadRequestException("请选择历史接管 Excel 文件");
    const parsed = await this.excel.parse(file.buffer, sceneKey);
    return this.takeovers.precheck(projectId, user.id, { rows: parsed.rows });
  }

  @Post("files")
  @RequireProjectRole("operating_takeover.file.upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadSourceFile(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    if (!file) throw new BadRequestException("请选择历史经营接管资料文件");
    return this.takeovers.uploadSourceFile(projectId, user.id, {
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }

  @Get()
  @RequireProjectRole("operating_takeover.manage")
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeovers.list(projectId, user.id);
  }

  @Post()
  @RequireProjectRole("operating_takeover.manage")
  create(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: CreateOperatingTakeoverBatchDto) {
    return this.takeovers.createBatch(projectId, user.id, body);
  }

  @Get(":batchId")
  @RequireProjectRole("operating_takeover.manage")
  detail(@Param("projectId") projectId: string, @Param("batchId") batchId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeovers.detail(projectId, batchId, user.id);
  }

  @Patch(":batchId/rows/:rowId")
  @RequireProjectRole("operating_takeover.manage")
  updateRow(@Param("projectId") projectId: string, @Param("batchId") batchId: string, @Param("rowId") rowId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: UpdateOperatingTakeoverRowDto) {
    return this.takeovers.updateRow(projectId, batchId, rowId, user.id, body);
  }

  @Post(":batchId/confirmations")
  @RequireProjectRole("operating_takeover.confirm")
  confirm(@Param("projectId") projectId: string, @Param("batchId") batchId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ConfirmOperatingTakeoverDto) {
    return this.takeovers.confirm(projectId, batchId, user.id, body);
  }

  @Post(":batchId/activation")
  @RequireProjectRole("operating_takeover.activate")
  activate(@Param("projectId") projectId: string, @Param("batchId") batchId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ActivateOperatingTakeoverDto) {
    return this.takeovers.activate(projectId, batchId, user.id, body.idempotencyKey);
  }

  @Post(":batchId/attachments")
  @RequireProjectRole("operating_takeover.file.upload")
  attachments(@Param("projectId") projectId: string, @Param("batchId") batchId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: AddOperatingTakeoverAttachmentGroupDto) {
    return this.takeovers.addAttachmentGroup(projectId, batchId, user.id, body);
  }

  private downloadHeaders(response: { set: (headers: Record<string, string>) => void }, buffer: Buffer, fileName: string) {
    response.set({
      "Content-Type": OPERATING_TAKEOVER_XLSX_MIME,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="operating-takeover.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
  }
}
