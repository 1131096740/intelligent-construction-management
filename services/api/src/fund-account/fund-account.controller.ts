import { Body, Controller, Get, Optional, Param, Post, Query, ServiceUnavailableException } from "@nestjs/common";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { FUND_REVIEW_ACTION } from "./fund-account-duty";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { FUND_ACCOUNT_READ_ROLE_KEYS } from "@jiangkong/shared-domain";
import { CorrectFundBalanceDto, ConfirmFundBalanceDto, RegisterFundBalanceDto } from "./fund-account.dto";
import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { FundBalanceReviewNotificationService } from "./fund-balance-review-notification.service";
import { FundAccountService } from "./fund-account.service";
class RetryFundReviewDutySmsDto extends RetryDutyNotificationDto {
  @IsString()
  @IsNotEmpty({ message: "复核轮次已变化，请刷新后重试" })
  @MaxLength(200)
  expectedApprovalInstanceId!: string;
}

@Controller("fund-accounts")
export class FundAccountController {
  constructor(private readonly accounts: FundAccountService,
    @Optional() private readonly balanceNotifications?: FundBalanceReviewNotificationService) {}
  @Get()
  @RequirePositions(...FUND_ACCOUNT_READ_ROLE_KEYS)
  list(@CurrentUser() actor: AuthenticatedUser, @Query("includeSourceOwnership") ownership?: string) { return this.accounts.list(actor.id, ownership === "true"); }
  @Get("registrations/:registrationId")
  @RequirePositions(...FUND_ACCOUNT_READ_ROLE_KEYS)
  readRegistration(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string) { return this.accounts.readRegistration(actor.id, id); }
  @Get(":scopeKey")
  @RequirePositions(...FUND_ACCOUNT_READ_ROLE_KEYS)
  readAccount(@CurrentUser() actor: AuthenticatedUser, @Param("scopeKey") key: string) { return this.accounts.readAccount(actor.id, key); }
  @Get("registrations/:registrationId/review")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  readReview(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string) { return this.accounts.readReview(actor.id, id); }
  @Get("registrations/:registrationId/review/duty-sms")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  reviewDutySms(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string) {
    if (!this.balanceNotifications) throw new ServiceUnavailableException("资金复核短信状态暂不可用");
    return this.balanceNotifications.status(id, actor.id);
  }

  @Post("registrations/:registrationId/review/duty-sms/retry")
  @RequireProjectRole(FUND_REVIEW_ACTION)
  retryReviewDutySms(@CurrentUser() actor: AuthenticatedUser, @Param("registrationId") id: string, @Body() body: RetryFundReviewDutySmsDto) {
    if (!this.balanceNotifications) throw new ServiceUnavailableException("资金复核短信状态暂不可用");
    return this.balanceNotifications.retry(id, actor.id, body.attemptId, body.expectedApprovalInstanceId);
  }
  @Post("openings")
  @RequirePositions(...FUND_ACCOUNT_READ_ROLE_KEYS)
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
