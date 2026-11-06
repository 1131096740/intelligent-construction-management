import { UploadPrivateFileDto } from "../file/dto/upload-private-file.dto";
import { FileInterceptor, normalizeUploadedOriginalName, type MemoryUploadedFile } from "../file/uploaded-file";
import { AttachRegisteredPaymentVoucherDto } from "./dto/attach-registered-payment-voucher.dto";
import { PaymentRequestService } from "./payment-request.service";
import { RecordRegisteredPaymentExecutionDto } from "./dto/record-registered-payment-execution.dto";
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "./registered-payment-notification.service";

@Controller("payment-executions")
export class RegisteredPaymentExecutionController {
  constructor(private readonly executions: RegisteredPaymentExecutionService, private readonly payments: PaymentRequestService, private readonly notifications: RegisteredPaymentNotificationService) {}

  @Get("notifications")
  currentNotifications(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.forCurrentActor(actor.id);
  }

  @Post(":executionId/voucher-file-uploads")
  @UseInterceptors(FileInterceptor("file",{limits:{fileSize:Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)}}))
  uploadVoucher(@CurrentUser() actor: AuthenticatedUser, @Param("executionId") executionId: string, @UploadedFile() file: MemoryUploadedFile | undefined, @Body() body: UploadPrivateFileDto = new UploadPrivateFileDto()) {
    if (!file) throw new BadRequestException("请选择需要后补的付款凭证文件");
    return this.payments.uploadRegisteredVoucherFile(executionId,actor.id,{
      originalName:normalizeUploadedOriginalName(file.originalname),mimeType:file.mimetype,sizeBytes:file.size,buffer:file.buffer,
      ...(body.idempotencyKey === undefined ? {} : {idempotencyKey:body.idempotencyKey})
    });
  }

  @Get(":executionId/voucher-ticket")
  voucherTicket(@CurrentUser() actor: AuthenticatedUser, @Param("executionId") executionId: string) {
    return this.payments.registeredVoucherTicket(executionId, actor.id);
  }

  @Post(":executionId/voucher")
  attachVoucher(@CurrentUser() actor: AuthenticatedUser, @Param("executionId") executionId: string, @Body() input: AttachRegisteredPaymentVoucherDto) {
    return this.payments.attachRegisteredVoucher(executionId, actor.id, input.fileId);
  }

  @Get(":paymentId/registration-options")
  registrationOptions(@CurrentUser() actor: AuthenticatedUser, @Param("paymentId") paymentId: string) {
    return this.payments.registeredExecutionOptions(paymentId,actor.id);
  }

  @Get(":paymentId/existing-source/:type/:id")
  existingSource(@CurrentUser() actor: AuthenticatedUser, @Param("paymentId") paymentId: string, @Param("type") type: string, @Param("id", new ParseUUIDPipe({version:"4"})) id: string) {
    return this.executions.existingSource(actor.id,paymentId,type,id);
  }

  @Post(":paymentId/registrations")
  record(@CurrentUser() actor: AuthenticatedUser, @Param("paymentId") paymentId: string, @Body() input: RecordRegisteredPaymentExecutionDto) {
    return this.payments.recordRegisteredExecution(paymentId, actor.id, input);
  }

  @Get("recorded-items")
  recordedItems(@CurrentUser() actor: AuthenticatedUser, @Query("paymentId") paymentId?: string) {
    return this.executions.recordedItems(actor.id,paymentId);
  }

  @Get("results/:idempotencyKey")
  result(@CurrentUser() actor: AuthenticatedUser, @Param("idempotencyKey", new ParseUUIDPipe({ version: "4" })) key: string) {
    return this.executions.result(actor.id, key);
  }

  @Get("work-items")
  workItems(@CurrentUser() actor: AuthenticatedUser) {
    return this.executions.workItems(actor.id);
  }
}
