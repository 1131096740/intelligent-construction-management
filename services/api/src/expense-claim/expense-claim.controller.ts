import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateExpenseClaimDto } from "./dto/create-expense-claim.dto";
import { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import { RecordLoanDisbursementDto } from "./dto/record-loan-disbursement.dto";
import { ConfirmEmployeeLoanRepaymentDto, RecordEmployeeLoanRepaymentDto } from "./dto/record-employee-loan-repayment.dto";
import { AttachExpenseClaimAttachmentDto, RemoveExpenseClaimAttachmentDto } from "./dto/manage-expense-claim-attachment.dto";
import { AdjustExpenseClaimPaymentSubjectDto } from "./dto/adjust-expense-claim-payment-subject.dto";
import { ExpenseClaimService } from "./expense-claim.service";

@Controller("expense-claims")
export class ExpenseClaimController {
  constructor(private readonly claims: ExpenseClaimService) {}

  @Post()
  @RequireProjectRole("expense_claim.create")
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateExpenseClaimDto) {
    return this.claims.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("view") view?: string) {
    return this.claims.listMine(user.id, view);
  }

  @Get("create-options")
  @RequireProjectRole("expense_claim.create")
  createOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.claims.createOptions(user.id);
  }

  @Get(":claimId")
  detail(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.getMine(claimId, user.id);
  }

  @Post(":claimId/payment-subject")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  adjustPaymentSubject(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AdjustExpenseClaimPaymentSubjectDto
  ) {
    return this.claims.adjustPaymentSubject(claimId, user.id, body);
  }

  @Post(":claimId/submission")
  @RequireProjectRole("expense_claim.submit")
  submit(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.submit(claimId, user.id);
  }

  @Post(":claimId/approval")
  @RequireProjectRole("expense_claim.approve")
  review(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewExpenseClaimDto
  ) {
    return this.claims.review(claimId, user.id, body);
  }

  @Post(":claimId/attachments")
  @RequireProjectRole("expense_claim.create")
  attach(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachExpenseClaimAttachmentDto
  ) {
    return this.claims.attachAttachment(claimId, user.id, body);
  }

  @Post(":claimId/attachments/append")
  @RequireProjectRole("expense_claim.attachment.append")
  appendAttachment(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachExpenseClaimAttachmentDto
  ) {
    return this.claims.appendAttachment(claimId, user.id, body);
  }

  @Post(":claimId/attachments/:attachmentId/removal")
  @RequireProjectRole("expense_claim.create")
  removeAttachment(
    @Param("claimId") claimId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RemoveExpenseClaimAttachmentDto
  ) {
    return this.claims.removeAttachment(claimId, attachmentId, user.id, body);
  }

  @Post(":claimId/disbursements")
  @RequireProjectRole("expense_claim.disburse")
  recordLoanDisbursement(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordLoanDisbursementDto
  ) {
    return this.claims.recordLoanDisbursement(claimId, user.id, body);
  }

  @Post(":claimId/repayments")
  @RequireProjectRole("expense_claim.repayment.record")
  recordRepayment(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: RecordEmployeeLoanRepaymentDto) {
    return this.claims.recordEmployeeLoanRepayment(claimId, user.id, body);
  }

  @Post(":claimId/repayments/:repaymentId/confirmation")
  @RequireProjectRole("expense_claim.repayment.confirm")
  confirmRepayment(@Param("claimId") claimId: string, @Param("repaymentId") repaymentId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: ConfirmEmployeeLoanRepaymentDto) {
    return this.claims.confirmEmployeeLoanRepayment(claimId, repaymentId, user.id, body);
  }
}
