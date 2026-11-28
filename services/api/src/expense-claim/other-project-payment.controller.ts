import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { CorrectOtherProjectPaymentDto } from "./dto/correct-other-project-payment.dto";
import { CreateOtherProjectPaymentDto } from "./dto/create-other-project-payment.dto";
import { RecordOtherProjectPaymentRefundDto } from "./dto/record-other-project-payment-refund.dto";
import { RecordExpenseClaimPaymentDto } from "./dto/record-expense-claim-payment.dto";
import { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import { ExpenseClaimCorrectionService } from "./expense-claim-correction.service";
import { ExpenseClaimPaymentRefundService } from "./expense-claim-payment-refund.service";
import { ExpenseClaimService } from "./expense-claim.service";
import { OTHER_PROJECT_PAYMENT_CATEGORIES, OTHER_PROJECT_PAYMENT_ENTRY } from "./other-project-payment";

/**
 * #405 PAY-17：无合同特殊项目付款与费用的明显入口。
 *
 * 这里只是费用/付款领域之上的入口与编排：登记、审批、实付、退款、更正
 * 都复用既有 ExpenseClaim、ExpenseClaimPaymentExecution、PaymentExecutionRefund
 * 与经营账事实，不建立第二套合同/结算/成本口径。
 */
@Controller("other-project-payments")
export class OtherProjectPaymentController {
  private readonly roles: CompanyRoleResolverService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ExpenseClaimService,
    private readonly refunds: ExpenseClaimPaymentRefundService,
    private readonly corrections: ExpenseClaimCorrectionService
  ) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  @Get("entry")
  entry(@CurrentUser() user: AuthenticatedUser) {
    return {
      ...OTHER_PROJECT_PAYMENT_ENTRY,
      categories: OTHER_PROJECT_PAYMENT_CATEGORIES,
      entryPath: "/其他项目付款",
      voucherUploadPath: "/expense-claims/:claimId/payment-voucher-file-uploads",
      viewerUserId: user.id
    };
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateOtherProjectPaymentDto) {
    const roleKeys = await this.roleKeys(user.id);
    if (!roleKeys.includes("comprehensive_director")) {
      throw new ForbiddenException("只有当前综合部主管可以办理其他项目付款");
    }
    return this.claims.create(user.id, {
      claimType: "incidental_expense",
      companyEntityId: body.companyEntityId,
      projectId: body.projectId,
      applicantUserId: user.id,
      reason: body.reason,
      requestedAmountCents: body.requestedAmountCents,
      incidentalExpenseCategory: body.incidentalExpenseCategory,
      payeeName: body.payeeName,
      paymentMethod: body.paymentMethod,
      payeeAccountName: body.payeeAccountName,
      payeeBankName: body.payeeBankName,
      payeeBankAccount: body.payeeBankAccount
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query("view") view?: string) {
    const rows = await this.claims.listMine(user.id, view);
    return rows.filter((row) => row.claimType === "incidental_expense");
  }

  @Get(":claimId")
  async detail(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    const detail = await this.claims.getMine(claimId, user.id);
    if (detail.claimType !== "incidental_expense") throw new NotFoundException("其他项目付款不存在或当前账号无权读取");
    return detail;
  }

  @Post(":claimId/submission")
  async submit(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertIncidental(claimId);
    return this.claims.submit(claimId, user.id);
  }

  @Post(":claimId/approval")
  @RequireProjectRole("expense_claim.approve")
  async approve(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewExpenseClaimDto
  ) {
    await this.assertIncidental(claimId);
    return this.claims.review(claimId, user.id, body);
  }

  @Post(":claimId/payments")
  @RequireProjectRole("expense_claim.payment.execute")
  async recordPayment(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordExpenseClaimPaymentDto
  ) {
    await this.assertIncidental(claimId);
    return this.claims.recordPayment(claimId, user.id, body);
  }

  @Post(":claimId/payments/:executionId/refunds")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  async recordRefund(
    @Param("claimId") claimId: string,
    @Param("executionId") executionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordOtherProjectPaymentRefundDto
  ) {
    await this.assertIncidental(claimId);
    return this.refunds.recordRefund(claimId, executionId, user.id, body);
  }

  @Post(":claimId/corrections")
  @RequirePositions("finance_director")
  async correctAmount(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CorrectOtherProjectPaymentDto
  ) {
    await this.assertIncidental(claimId);
    return this.corrections.correctConfirmedAmount(claimId, user.id, body);
  }

  private async assertIncidental(claimId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId },
      select: { claimType: true }
    });
    if (!claim || claim.claimType !== "incidental_expense") {
      throw new NotFoundException("其他项目付款不存在");
    }
  }

  private async roleKeys(actorUserId: string): Promise<string[]> {
    try {
      return await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前岗位已失效，不能办理其他项目付款");
    }
  }
}
