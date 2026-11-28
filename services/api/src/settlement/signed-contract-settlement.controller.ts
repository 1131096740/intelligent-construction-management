import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min, ValidateIf } from "class-validator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CreateDownloadTicketDto } from "../file/dto/create-download-ticket.dto";
import { FileService } from "../file/file.service";
import { signedSettlementFileMime } from "../file/signed-settlement-file";
import { FileInterceptor, type MemoryUploadedFile, normalizeUploadedOriginalName } from "../file/uploaded-file";
import { SignedContractSettlementService, signedContractKinds, type SignedContractKind } from "./signed-contract-settlement.service";

class SignedContractIdentityDto {
  @IsIn(signedContractKinds, { message: "请选择可登记的合同类别" })
  contractKind!: SignedContractKind;

  @IsString({ message: "请选择合同" })
  @IsNotEmpty({ message: "请选择合同" })
  @MaxLength(128, { message: "合同编号过长" })
  contractId!: string;
}

class SaveSignedSettlementDto extends SignedContractIdentityDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算编号必须是文字" })
  @MaxLength(100, { message: "结算编号不能超过100个字符" })
  number?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "本期金额格式不正确" })
  @MaxLength(32, { message: "本期金额过长" })
  amountYuan?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "已签附件格式不正确" })
  @ArrayMaxSize(30, { message: "每单最多上传30份附件" })
  @IsString({ each: true, message: "已签附件编号格式不正确" })
  @MaxLength(128, { each: true, message: "已签附件编号过长" })
  fileIds?: string[];
}

class UpdateSignedSettlementDto extends SaveSignedSettlementDto {
  @IsInt({ message: "结算版本号必须是整数" })
  @Min(1, { message: "结算版本号无效" })
  revision!: number;
}

class SubmitSignedSettlementDto {
  @IsInt({ message: "结算版本号必须是整数" })
  @Min(1, { message: "结算版本号无效" })
  revision!: number;
}

class ReviewSignedSettlementDto extends SubmitSignedSettlementDto {
  @IsIn(["confirm", "return"], { message: "请选择通过或驳回" })
  decision!: "confirm" | "return";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "复核原因必须是文字" })
  @MaxLength(500, { message: "复核原因不能超过500个字符" })
  reason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "密码格式不正确" })
  @MaxLength(256, { message: "密码格式不正确" })
  confirmationPassword?: string;
}

class DownloadSignedSettlementAttachmentDto {
  @IsString()
  @IsNotEmpty()
  expiresAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  downloadReason!: string;

  @IsIn(["download", "preview"])
  accessMode!: "download" | "preview";

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}

@Controller("projects/:projectId/signed-contract-settlements")
export class SignedContractSettlementController {
  constructor(
    private readonly settlements: SignedContractSettlementService,
    private readonly files: FileService
  ) {}

  @Get()
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlements.list(projectId, user.id);
  }

  @Get("contracts")
  contracts(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlements.contracts(projectId, user.id);
  }

  @Get("payment-basis")
  paymentBasis(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @Query() query: SignedContractIdentityDto) {
    return this.settlements.paymentBasis(projectId, user.id, query.contractKind, query.contractId);
  }

  @Get("contract-overview")
  overview(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @Query() query: SignedContractIdentityDto) {
    return this.settlements.overview(projectId, user.id, query.contractKind, query.contractId);
  }

  @Get(":id/attachments/:fileId")
  attachmentMetadata(@Param("projectId") projectId: string, @Param("id") id: string, @Param("fileId") fileId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlements.attachmentMetadata(projectId, id, fileId, user.id);
  }

  @Post(":id/attachments/:fileId/download-ticket")
  async attachmentDownloadTicket(
    @Param("projectId") projectId: string, @Param("id") settlementId: string,
    @Param("fileId") fileId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: CreateDownloadTicketDto
  ) {
    if (body.delegatorUserId) throw new BadRequestException("已签结算附件须由本人查阅");
    return this.files.createSignedSettlementDownloadTicket({ projectId, settlementId, fileId }, {
      actorUserId: user.id,
      ...(body.downloadReason?.trim() ? { downloadReason: body.downloadReason } : {}),
      accessMode: body.accessMode
    });
  }

  @Get(":id/attachments/:fileId/download")
  async attachmentDownload(
    @Param("projectId") projectId: string, @Param("id") settlementId: string,
    @Param("fileId") fileId: string, @CurrentUser() user: AuthenticatedUser, @Query() query: DownloadSignedSettlementAttachmentDto,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const file = await this.files.readSignedSettlementFile({ projectId, settlementId, fileId }, { ...query, actorUserId: user.id });
    response.set({
      "Content-Type": file.mimeType,
      "Content-Length": String(file.buffer.length),
      "Content-Disposition": `${file.accessMode === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": "private, no-store"
    });
    return new StreamableFile(file.buffer);
  }

  @Post("files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) } }))
  async upload(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: MemoryUploadedFile) {
    await this.settlements.assertProjectAccess(projectId, user.id);
    if (!file) throw new BadRequestException("请上传已签 PDF 或照片");
    const originalName = normalizeUploadedOriginalName(file.originalname);
    const mimeType = signedSettlementFileMime(originalName, file.buffer);
    const saved = await this.files.uploadPrivateFile({
      originalName, mimeType, sizeBytes: file.size, uploadedByUserId: user.id, buffer: file.buffer,
      signedSettlementProjectId: projectId
    });
    return { id: saved.id, originalName: saved.originalName, mimeType: saved.mimeType };
  }

  @Post()
  create(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: SaveSignedSettlementDto) {
    return this.settlements.save(projectId, user.id, body);
  }

  @Patch(":id")
  update(@Param("projectId") projectId: string, @Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: UpdateSignedSettlementDto) {
    return this.settlements.save(projectId, user.id, body, id, body.revision);
  }

  @Post(":id/submission")
  submit(@Param("projectId") projectId: string, @Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: SubmitSignedSettlementDto) {
    return this.settlements.submit(projectId, id, user.id, body.revision);
  }

  @Post(":id/review")
  review(@Param("projectId") projectId: string, @Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ReviewSignedSettlementDto) {
    return this.settlements.review(projectId, id, user.id, body.revision, body.decision, body.reason, body.confirmationPassword);
  }
}
