import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
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
    private readonly payments: PaymentRequestService
  ) {}

  // 创建付款申请：策略表未定义 create 动作，申请在审批前无业务效力，仅要求登录。
  @Post()
  create(@Body() body: CreatePaymentRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.create(body, user.id);
  }

  @Get()
  @RequirePositions(
    "chairman",
    "general_manager",
    "project_manager",
    "contract_director",
    "contract_staff",
    "budget_director",
    "budget_staff",
    "finance_director",
    "finance_staff",
    "super_admin"
  )
  list(@Query("limit") limit?: string) {
    return this.paymentRead.listRecent(limit);
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
    @Body() body: { toUserId: string }
  ) {
    return this.payments.transferApproval(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-delegation")
  @RequireProjectRole("payment.approve")
  delegateApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { toUserId: string }
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
    @Body() body: { templateKey?: string; departmentScope?: string }
  ) {
    return this.payments.generatePdfArchive(paymentId, user.id, body);
  }

  @Get(":paymentId")
  detail(@Param("paymentId") paymentId: string) {
    return this.paymentRead.getDetail(paymentId);
  }
}
