import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateExpenseClaimDto } from "./dto/create-expense-claim.dto";
import { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import { RecordLoanDisbursementDto } from "./dto/record-loan-disbursement.dto";
import { ConfirmEmployeeLoanRepaymentDto, RecordEmployeeLoanRepaymentDto } from "./dto/record-employee-loan-repayment.dto";
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

  @Get(":claimId")
  detail(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.getMine(claimId, user.id);
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
