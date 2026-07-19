import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { AssignPaymentApprovalDto } from "./dto/assign-payment-approval.dto";
import { AbandonPaymentRequestDto } from "./dto/abandon-payment-request.dto";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { GeneratePaymentPdfArchiveDto } from "./dto/generate-payment-pdf-archive.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Controller("payments")
export class PaymentController {
  constructor(
    private readonly paymentRead: PaymentReadService,
    private readonly payments: PaymentRequestService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  @Post()
  @RequireProjectRole("payment.create")
  create(@Body() body: CreatePaymentRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.create(body, user.id);
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
    @Query("limit") limit?: string,
    @Query("view") view?: "formal_ledger" | "my_drafts" | "returned_for_revision" | "ended",
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(user.id);
    if (view !== undefined || page !== undefined || pageSize !== undefined) {
      return this.paymentRead.listLedger({ view, page, pageSize }, visibleProjectIds, user.id);
    }
    return this.paymentRead.listRecent(limit, visibleProjectIds);
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
    @Body() body: AssignPaymentApprovalDto
  ) {
    return this.payments.delegateApproval(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-withdrawal")
  withdrawApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.withdrawApproval(paymentId, user.id);
  }

  @Post(":paymentId/abandonment")
  abandonRequest(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonPaymentRequestDto
  ) {
    return this.payments.abandonReturnedRequest(paymentId, user.id, body);
  }

  // 超时催办：由申请人发起，督促当前节点审批人；是否超时/重复节流在 service 内判定。
  @Post(":paymentId/approval-reminder")
  remindApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.remindApproval(paymentId, user.id);
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

  @Get(":paymentId")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async detail(@Param("paymentId") paymentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentRead.getDetail(
      paymentId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }
}
