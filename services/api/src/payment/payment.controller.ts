import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { PaymentApprovalNotificationService } from "./payment-approval-notification.service";
import { UploadPrivateFileDto } from "../file/dto/upload-private-file.dto";
import { ApprovalProgressService } from "../approval/approval-progress.service";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Optional,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { ledgerExportHeaders } from "../core-flow/business-ledger-export";
import { FileService } from "../file/file.service";
import {
  FileInterceptor,
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import { AssignPaymentApprovalDto, DelegatePaymentApprovalDto } from "./dto/assign-payment-approval.dto";
import { AbandonPaymentRequestDto } from "./dto/abandon-payment-request.dto";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { GeneratePaymentPdfArchiveDto } from "./dto/generate-payment-pdf-archive.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { RevisePaymentRequestDto } from "./dto/revise-payment-request.dto";
import { WithdrawPaymentRemainderDto } from "./dto/withdraw-payment-remainder.dto";
import { WithdrawPaymentApprovalDto } from "./dto/withdraw-payment-approval.dto";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";
import { PAYMENT_REQUEST_ENTRY_DEFINITION } from "./payment-request-business-entry-definition";

@Controller("payments")
export class PaymentController {
  constructor(
    private readonly paymentRead: PaymentReadService,
    private readonly payments: PaymentRequestService,
    private readonly projectVisibility: ProjectVisibilityService,
    @Optional() private readonly files?: FileService,
    @Optional() private readonly approvalProgress?: ApprovalProgressService,
    @Optional() private readonly approvalNotifications?: PaymentApprovalNotificationService
  ) {}

  @Post()
  @RequireProjectRole("payment.create")
  create(@Body() body: CreatePaymentRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.create(body, user.id);
  }

  @Get("create-capability")
  @RequireProjectRole("payment.create")
  createCapability(@Query("projectId") projectId: string) {
    return {
      projectId,
      availableActions: ["create_payment"],
      businessEntry: { definition: PAYMENT_REQUEST_ENTRY_DEFINITION }
    };
  }

  @Get("contract-application")
  @RequireProjectRole("payment.create")
  contractApplication(@Query("contractVersionId") contractVersionId: string) {
    return this.paymentRead.getContractApplication(contractVersionId);
  }

  @Get()
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | string[] | undefined> = {}
  ) {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(user.id);
    const hasLedgerQuery = [
      "view",
      "page",
      "pageSize",
      "projectId",
      "dateFrom",
      "dateTo",
      "status",
      "keyword",
      "sort",
      "columns"
    ].some((key) => query[key] !== undefined);
    if (hasLedgerQuery) {
      return this.paymentRead.listLedger(query, visibleProjectIds, user.id);
    }
    const limit = typeof query.limit === "string" ? query.limit : undefined;
    return this.paymentRead.listRecent(limit, visibleProjectIds, { actorUserId: user.id });
  }

  /**
   * 付款台账导出：与列表共用读模型和逐行可见性过滤；
   * 导出的行是「全部筛选后的可见记录」，不是当前页。
   */
  @Get("ledger-export")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async exportLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void },
    @Query() query: Record<string, string | string[] | undefined> = {}
  ) {
    const result = await this.paymentRead.exportLedger(
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id,
      query
    );
    response.set(ledgerExportHeaders(result));
    return new StreamableFile(result.buffer);
  }

  @Get(":paymentId/approval/duty-sms")
  approvalDutySms(@Param("paymentId") id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!this.approvalNotifications) throw new ServiceUnavailableException("付款审批短信状态暂不可用");
    return this.approvalNotifications.status(id, user.id);
  }

  @Post(":paymentId/approval/duty-sms/retry")
  retryApprovalDutySms(@Param("paymentId") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: RetryDutyNotificationDto) {
    if (!this.approvalNotifications) throw new ServiceUnavailableException("付款审批短信状态暂不可用");
    return this.approvalNotifications.retry(id, user.id, body.attemptId);
  }

  @Post(":paymentId/approval")
  @RequireProjectRole("payment.approve")
  reviewApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewPaymentApprovalDto
  ) {
    return this.payments.reviewApproval(paymentId, user.id, body);
  }

  @Post(":paymentId/revision-submission")
  @RequireProjectRole("payment.create")
  reviseAndSubmit(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RevisePaymentRequestDto
  ) {
    return this.payments.reviseAndSubmit(paymentId, user.id, body);
  }

  @Post(":paymentRequestId/remainder-withdrawal")
  @RequireProjectRole("payment.create")
  withdrawRemainder(
    @Param("paymentRequestId") paymentRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawPaymentRemainderDto
  ) {
    return this.payments.withdrawRemainder(paymentRequestId, user.id, body);
  }

  @Post(":paymentId/approval-transfer")
  @RequireProjectRole("payment.approve")
  transferApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignPaymentApprovalDto
  ) {
    return this.payments.transferApproval(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-delegation")
  @RequireProjectRole("payment.approve")
  delegateApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DelegatePaymentApprovalDto
  ) {
    return this.payments.delegateApproval(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-withdrawal")
  withdrawApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body?: WithdrawPaymentApprovalDto
  ) {
    return this.payments.withdrawApproval(paymentId, user.id, body?.expectedApprovalInstanceId);
  }

  @Post(":paymentId/abandonment")
  abandonRequest(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonPaymentRequestDto
  ) {
    return this.payments.abandonReturnedRequest(paymentId, user.id, body);
  }

  // 旧 HTTP 入口由 RetiredWriteEntryGuard 返回 410；内部委托不构成公共办理入口。
  @Post(":paymentId/approval-reminder")
  remindApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!this.approvalProgress) throw new BadRequestException("审批催办服务暂不可用");
    return this.approvalProgress.remindBusiness("payment_request", paymentId, user.id);
  }

  @Post(":paymentId/executions")
  @RequireProjectRole("payment.execution")
  recordExecution(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordPaymentExecutionDto
  ) {
    return this.payments.recordExecution(paymentId, user.id, body);
  }

  @Post(":paymentId/execution-voucher-file-uploads")
  @RequireProjectRole("payment.execution")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  async uploadExecutionVoucherPrivateFile(
    @Param("paymentId") paymentId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() { idempotencyKey }: UploadPrivateFileDto = new UploadPrivateFileDto()
  ) {
    const detail = await this.paymentRead.getDetail(
      paymentId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
    if (!detail.availableActionKeys.includes("record_execution")) {
      throw new ForbiddenException("当前付款不可上传执行凭证");
    }
    if (!file) throw new BadRequestException("请选择付款执行凭证");
    if (!this.files) {
      throw new BadRequestException("付款文件服务暂不可用，请稍后重试");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }

  @Post(":paymentId/finance-records")
  @RequireProjectRole("payment.finance_record")
  recordFinance(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordFinanceRecordDto
  ) {
    return this.payments.recordFinance(paymentId, user.id, body);
  }

  @Post(":paymentId/pdf-archive")
  @RequireProjectRole("payment.pdf_archive")
  recordPdfArchive(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordPaymentPdfArchiveDto
  ) {
    return this.payments.recordPdfArchive(paymentId, user.id, body);
  }

  @Post(":paymentId/pdf-generation")
  @RequireProjectRole("payment.pdf_archive")
  generatePdfArchive(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GeneratePaymentPdfArchiveDto
  ) {
    return this.payments.generatePdfArchive(paymentId, user.id, body);
  }

  @Post(":paymentId/pdf-archive-file-uploads")
  @RequireProjectRole("payment.pdf_archive")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  async uploadPdfArchivePrivateFile(
    @Param("paymentId") paymentId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() { idempotencyKey }: UploadPrivateFileDto = new UploadPrivateFileDto()
  ) {
    const detail = await this.paymentRead.getDetail(
      paymentId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
    const operationAllowed = detail.availableActionKeys.includes("archive_pdf");
    if (!operationAllowed) {
      throw new ForbiddenException("当前付款状态或操作权限不允许上传财务归档");
    }
    if (!file) throw new BadRequestException("请选择要上传的付款归档文件");
    if (!this.files) {
      throw new BadRequestException("付款文件服务暂不可用，请稍后重试");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }

  @Get(":paymentId/capability")
  async capability(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const detail = await this.paymentRead.getDetail(
      paymentId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
    return {
      paymentId: detail.id,
      availableActions: detail.availableActionKeys,
      ...(detail.delegationApprovalContext ? { delegationApprovalContext: detail.delegationApprovalContext } : {})
    };
  }

  @Get(":paymentId")
  async detail(@Param("paymentId") paymentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentRead.getDetail(
      paymentId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }
}
