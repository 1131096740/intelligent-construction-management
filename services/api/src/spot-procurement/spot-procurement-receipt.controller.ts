import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import { type MemoryUploadedFile, normalizeUploadedOriginalName } from "../file/uploaded-file";
import { AttachReceiptPhotoDto } from "./dto/attach-receipt-photo.dto";
import { CreateReceiptDelegationDto } from "./dto/create-receipt-delegation.dto";
import { ReviewReceiptDto } from "./dto/review-receipt.dto";
import { RevokeReceiptReviewDto } from "./dto/revoke-receipt-review.dto";
import { ResetSpotProcurementReceiptDto } from "./dto/reset-spot-procurement-receipt.dto";
import { UpdateReceiptDraftDto } from "./dto/update-receipt-draft.dto";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";

@Controller("spot-procurements")
export class SpotProcurementReceiptController {
  constructor(
    private readonly receipts: SpotProcurementReceiptService,
    @Optional() private readonly files?: FileService
  ) {}

  @Get(":procurementId/receipt")
  detail(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.getReceipt(procurementId, user.id);
  }

  @Post(":procurementId/receipt/delegations")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  createDelegation(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReceiptDelegationDto
  ) {
    return this.receipts.createDelegation(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt-photo-file-uploads")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadReceiptPhotoFile(
    @Param("procurementId") procurementId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(
      procurementId,
      user.id,
      "append_receipt_photo",
      file,
      idempotencyKey,
      "收货照片"
    );
  }

  @Post(":procurementId/refund-voucher-file-uploads")
  @RequireProjectRole("spot_procurement.refund.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadRefundVoucherFile(
    @Param("procurementId") procurementId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(
      procurementId,
      user.id,
      "record_refund",
      file,
      idempotencyKey,
      "退款凭证"
    );
  }

  @Post(":procurementId/invoice-file-uploads")
  @RequireProjectRole("spot_procurement.invoice.append")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadInvoiceFile(
    @Param("procurementId") procurementId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(
      procurementId,
      user.id,
      "append_invoice",
      file,
      idempotencyKey,
      "采购发票"
    );
  }

  @Patch(":procurementId/receipt/draft")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  updateDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateReceiptDraftDto
  ) {
    return this.receipts.updateDraft(procurementId, user.id, body);
  }

  @Post(":procurementId/receipt/draft-reset")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  resetDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ResetSpotProcurementReceiptDto
  ) {
    return this.receipts.resetDraft(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/photos")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  attachPhoto(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachReceiptPhotoDto
  ) {
    return this.receipts.attachPhoto(procurementId, user.id, body);
  }

  @Delete(":procurementId/receipt/photos/:photoId")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  deleteDraftPhoto(
    @Param("procurementId") procurementId: string,
    @Param("photoId") photoId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.deleteDraftPhoto(
      procurementId,
      photoId,
      user.id
    );
  }

  @Post(":procurementId/receipt/submission")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  submit(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.submit(procurementId, user.id);
  }

  @Post(":procurementId/receipt/review")
  @RequireProjectRole("spot_procurement.receipt.review")
  review(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewReceiptDto
  ) {
    return this.receipts.review(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/review-revocation")
  @RequireProjectRole(
    "spot_procurement.receipt.review_revoke"
  )
  revokeReview(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RevokeReceiptReviewDto
  ) {
    return this.receipts.revokeReview(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/pdf-refresh")
  @RequireProjectRole("spot_procurement.receipt.review")
  retryFormalPdf(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.retryFormalPdf(
      procurementId,
      user.id
    );
  }

  private async uploadPrivateFile(
    procurementId: string,
    actorUserId: string,
    actionKey: string,
    file: MemoryUploadedFile | undefined,
    idempotencyKey: string | undefined,
    label: string
  ) {
    await this.receipts.assertActionAvailable(
      procurementId,
      actorUserId,
      actionKey
    );
    if (!file) throw new BadRequestException(`请选择要上传的${label}`);
    if (!this.files) {
      throw new BadRequestException("零星采购收货文件服务暂不可用，请稍后重试");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: actorUserId,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }
}
