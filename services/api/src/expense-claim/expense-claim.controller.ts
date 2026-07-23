import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateExpenseClaimDto } from "./dto/create-expense-claim.dto";
import { ExpenseClaimService } from "./expense-claim.service";

@Controller("expense-claims")
export class ExpenseClaimController {
  constructor(private readonly claims: ExpenseClaimService) {}

  @Post()
  @RequireProjectRole("expense_claim.create")
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateExpenseClaimDto) {
    return this.claims.create(user.id, body);
  }

  @Post(":claimId/submission")
  @RequireProjectRole("expense_claim.submit")
  submit(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.submit(claimId, user.id);
  }
}
