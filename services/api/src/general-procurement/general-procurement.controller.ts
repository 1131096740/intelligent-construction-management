import { FileService } from "../file/file.service";
import { FileInterceptor, type MemoryUploadedFile, normalizeUploadedOriginalName } from "../file/uploaded-file";
import { BadRequestException, ForbiddenException, Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CancelProcurementPaymentDto, CreateGeneralProcurementDto, GeneralProcurementRevisionDto, ReviewGeneralProcurementDto, UpdateGeneralProcurementDto, WithdrawGeneralProcurementDto, ArchiveGeneralProcurementDto } from "./general-procurement.dto";
import { GeneralProcurementService } from "./general-procurement.service";

@Controller("general-procurements")
export class GeneralProcurementController {
  constructor(private readonly procurements: GeneralProcurementService, private readonly files: FileService) {}
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateGeneralProcurementDto) { return this.procurements.create(user.id, body); }
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.procurements.list(user.id); }
  @Get("create-options") options(@CurrentUser() user: AuthenticatedUser) { return this.procurements.options(user.id); }
  @Get(":id") detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) { return this.procurements.detail(id, user.id); }
  @Post(":id/submission") submit(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: GeneralProcurementRevisionDto) { return this.procurements.submit(id, user.id, body.revision); }
  @Post(":id/review") review(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ReviewGeneralProcurementDto) { return this.procurements.review(id, user.id, body); }

  @Post(":id/draft") updateDraft(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: UpdateGeneralProcurementDto) { return this.procurements.updateDraft(id, user.id, body); }
  @Post(":id/withdrawal") withdraw(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: WithdrawGeneralProcurementDto) { return this.procurements.withdraw(id, user.id, body); }

  @Post(":id/payments/:claimId/cancellation")
  cancelPayment(@Param("id") id: string, @Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: CancelProcurementPaymentDto) {
    return this.procurements.cancelPayment(id, claimId, user.id, body.reason);
  }

  @Post(":id/archive") archive(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ArchiveGeneralProcurementDto) { return this.procurements.archive(id, user.id, body); }
  @Post(":id/archive-file-uploads")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) } }))
  async uploadArchive(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @UploadedFile() file: MemoryUploadedFile | undefined, @Body() body: { idempotencyKey?: string } = {}) {
    const detail = await this.procurements.detail(id, user.id);
    if (!detail.canArchive) throw new ForbiddenException("当前账号不能为此申请上传归档依据");
    if (!file) throw new BadRequestException("请上传采购资料或费用凭证");
    return this.files.uploadPrivateFile({ originalName: normalizeUploadedOriginalName(file.originalname), mimeType: file.mimetype,
      sizeBytes: file.size, uploadedByUserId: user.id, buffer: file.buffer, ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }) });
  }

}
