import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { FUND_REVIEW_ACTION } from "./fund-account-duty";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { CorrectFundBalanceDto, ConfirmFundBalanceDto, RegisterFundBalanceDto } from "./fund-account.dto";
import { FundAccountService } from "./fund-account.service";
@Controller("fund-accounts")
export class FundAccountController {
  constructor(private readonly accounts: FundAccountService) {}
  @Get()
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  list(@CurrentUser() actor: AuthenticatedUser) { return this.accounts.list(actor.id); }
  @Get("registrations/:registrationId")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  readRegistration(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string) { return this.accounts.readRegistration(actor.id, id); }
  @Get(":scopeKey")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  readAccount(@CurrentUser() actor: AuthenticatedUser, @Param("scopeKey") key: string) { return this.accounts.readAccount(actor.id, key); }
  @Get("registrations/:registrationId/review")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  readReview(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string) { return this.accounts.readReview(actor.id, id); }
  @Post("openings")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  registerOpening(@CurrentUser() actor: AuthenticatedUser, @Body() input: RegisterFundBalanceDto) { return this.accounts.registerOpening(actor.id, input); }
  @Post("corrections")
  @RequirePositions("finance_staff", "finance_director")
  requestCorrection(@CurrentUser() actor: AuthenticatedUser, @Body() input: CorrectFundBalanceDto) { return this.accounts.requestCorrection(actor.id, input); }
  @Post("registrations/:registrationId/confirm")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  confirmCorrection(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string, @Body() input: ConfirmFundBalanceDto) { return this.accounts.confirmCorrection(actor.id, id, input); }
  @Post("registrations/:registrationId/return")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  returnCorrection(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string, @Body() input: ConfirmFundBalanceDto) { return this.accounts.returnCorrection(actor.id, id, input); }
  @Post("registrations/:registrationId/withdraw")
  @RequirePositions("finance_staff", "finance_director")
  withdrawCorrection(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string, @Body() input: ConfirmFundBalanceDto) { return this.accounts.withdrawCorrection(actor.id, id, input); }
}
