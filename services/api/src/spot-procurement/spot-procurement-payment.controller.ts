import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import { type MemoryUploadedFile, normalizeUploadedOriginalName } from "../file/uploaded-file";
import { AbandonSpotProcurementPaymentDraftDto } from "./dto/abandon-spot-procurement-payment-draft.dto";
import { ExecuteSupplierBalanceDto } from "./dto/execute-supplier-balance.dto";
import { RecordSpotProcurementPaymentDto } from "./dto/record-spot-procurement-payment.dto";
import { ReviewSpotProcurementPaymentDto } from "./dto/review-spot-procurement-payment.dto";
import { UpdateSpotProcurementPaymentDraftDto } from "./dto/update-spot-procurement-payment-draft.dto";
import { UpdateSpotPaymentPayerDto } from "./dto/update-spot-payment-payer.dto";
import { VoidSpotProcurementDto } from "./dto/void-spot-procurement.dto";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementReadService } from "./spot-procurement-read.service";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";

@Controller("spot-procurement-payments")
export class SpotProcurementPaymentController {
  constructor(
    private readonly payments: SpotProcurementPaymentService,
    private readonly reads: SpotProcurementReadService,
    private readonly settlements: SpotProcurementSettlementService,
    @Optional() private readonly files?: FileService
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string,
    @Query("status") status?: string,
    @Query("keyword") keyword?: string,
    @Query("view") view?: string
  ) {
    return this.reads.listPayments(user.id, {
      projectId,
      status,
      keyword,
      view
    });
  }

  @Get(":paymentId")
  detail(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reads.getPayment(paymentId, user.id);
  }

  @Patch(":paymentId/draft")
  @RequireProjectRole("spot_procurement.payment.submit")
  updateDraft(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSpotProcurementPaymentDraftDto
  ) {
    return this.payments.updateDraft(paymentId, user.id, body);
  }

  @Post(":paymentId/draft-file-uploads")
  @RequireProjectRole("spot_procurement.payment.submit")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadDraftFile(
    @Param("paymentId") paymentId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(
      paymentId,
      user.id,
      "edit_draft",
      file,
      idempotencyKey,
      "付款草稿附件"
    );
  }

  @Post(":paymentId/execution-voucher-file-uploads")
  @RequireProjectRole("spot_procurement.payment.execute")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadExecutionVoucherFile(
    @Param("paymentId") paymentId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(
      paymentId,
      user.id,
      "record_execution",
      file,
      idempotencyKey,
      "实际付款凭证"
    );
  }

  @Patch(":paymentId/payer")
  @RequireProjectRole("spot_procurement.payment.facts.manage")
  updatePayer(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSpotPaymentPayerDto
  ) {
    return this.payments.updatePayer(paymentId, user.id, body);
  }

  @Post(":paymentId/submission")
  @RequireProjectRole("spot_procurement.payment.submit")
  submit(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.submit(paymentId, user.id);
  }

  @Post(":paymentId/abandonment")
  @RequireProjectRole("spot_procurement.payment.submit")
  abandonDraft(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonSpotProcurementPaymentDraftDto
  ) {
    return this.payments.abandonDraft(paymentId, user.id, body);
  }

  @Post(":paymentId/approval")
  @RequireProjectRole("spot_procurement.payment.approve")
  review(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSpotProcurementPaymentDto
  ) {
    return this.payments.review(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-withdrawal")
  @RequireProjectRole("spot_procurement.payment.submit")
  withdrawApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.withdrawApproval(paymentId, user.id);
  }

  @Post(":paymentId/voiding")
  @RequireProjectRole("spot_procurement.void")
  voidPayment(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidSpotProcurementDto
  ) {
    return this.payments.voidPayment(
      paymentId,
      user.id,
      body.reason
    );
  }

  @Post(":paymentId/executions")
  @RequireProjectRole("spot_procurement.payment.execute")
  recordExecution(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordSpotProcurementPaymentDto
  ) {
    return this.payments.recordExecution(paymentId, user.id, body);
  }

  @Post(":paymentId/balance-execution")
  @RequireProjectRole("spot_procurement.balance.execute")
  executeSupplierBalance(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ExecuteSupplierBalanceDto
  ) {
    return this.settlements.executeSupplierBalance(
      paymentId,
      user.id,
      body
    );
  }

  private async uploadPrivateFile(
    paymentId: string,
    actorUserId: string,
    actionKey: string,
    file: MemoryUploadedFile | undefined,
    idempotencyKey: string | undefined,
    label: string
  ) {
    await this.reads.assertPaymentActionAvailable(
      paymentId,
      actorUserId,
      actionKey
    );
    if (!file) throw new BadRequestException(`请选择要上传的${label}`);
    if (!this.files) {
      throw new BadRequestException("零星采购付款文件服务暂不可用，请稍后重试");
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
