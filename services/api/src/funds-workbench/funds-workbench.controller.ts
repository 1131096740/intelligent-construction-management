import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FundsWorkbenchService } from "./funds-workbench.service";

@Controller("funds-workbench")
export class FundsWorkbenchController {
  constructor(private readonly funds: FundsWorkbenchService) {}

  @Get()
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") view?: string,
    @Query("source") source?: string
  ) {
    return this.funds.list(user.id, { view, source });
  }
}
