import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { CompanyOwnedFundOptionsDto, RegisterCompanyOwnedFundReceiptDto, RegisterFundAccountAdvanceDto } from "./fund-account-advance.dto";
import { FundAccountAdvanceService } from "./fund-account-advance.service";

@Controller("fund-account-advance-receipts")
@RequirePositions("finance_staff", "finance_director", "comprehensive_director")
export class FundAccountAdvanceController {
  constructor(private readonly advances: FundAccountAdvanceService) {}

  @Get("contributor-options")
  contributorOptions(@CurrentUser() actor: AuthenticatedUser) {
    return this.advances.contributorOptions(actor.id);
  }

  @Get("company-owned-bank-options")
  @RequirePositions("finance_director")
  companyOwnedBankOptions(@CurrentUser() actor: AuthenticatedUser, @Query() input: CompanyOwnedFundOptionsDto) {
    return this.advances.companyOwnedBankOptions(actor.id, input.companyId);
  }

  @Post("company-owned")
  @RequirePositions("finance_director")
  registerCompanyOwned(@CurrentUser() actor: AuthenticatedUser, @Body() input: RegisterCompanyOwnedFundReceiptDto) {
    return this.advances.registerCompanyOwned(actor.id, input);
  }

  @Post()
  register(@CurrentUser() actor: AuthenticatedUser, @Body() input: RegisterFundAccountAdvanceDto) {
    return this.advances.register(actor.id, input);
  }
}
