import { Body, Controller, Get, Post, Query } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions, UseAnyProjectPositionScope } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import {
  HistoricalWageTakeoverCommandDto,
  HistoricalWageTakeoverSelectionRenewalDto
} from "./historical-wage-takeover.dto";
import { HistoricalWageTakeoverService } from "./historical-wage-takeover.service";

// There is intentionally no `:projectId` route parameter: an A source can
// span projects and #219's scope itself owns the complete server-resolved set.
// The service repeats canonical action/delegation checks in its transaction.
@Controller("operating-takeovers/historical-wage")
export class HistoricalWageTakeoverController {
  constructor(private readonly historicalWages: HistoricalWageTakeoverService) {}

  @Get("options")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.prepare")
  @RequirePositions("finance_staff", "finance_director")
  options(@CurrentUser() user: AuthenticatedUser, @Query("projectId") projectId?: string) {
    return this.historicalWages.options(user.id, projectId);
  }

  @Post("scopes/selection-ref")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.prepare")
  @RequirePositions("finance_staff", "finance_director")
  issueScopedCommandSelection(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverSelectionRenewalDto) {
    return this.historicalWages.issueScopedCommandSelection(user.id, body);
  }

  @Post("scopes")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.prepare")
  @RequirePositions("finance_staff", "finance_director")
  createScope(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverCommandDto) {
    return this.historicalWages.createScope(user.id, body);
  }

  @Post("scopes/apply")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.prepare")
  @RequirePositions("finance_staff", "finance_director")
  apply(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverCommandDto) {
    return this.historicalWages.apply(user.id, body);
  }

  @Post("scopes/attest")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.attest")
  @RequirePositions("finance_director")
  attest(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverCommandDto) {
    return this.historicalWages.attest(user.id, body);
  }

  @Post("scopes/activate")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.confirm")
  @RequirePositions("finance_director")
  activate(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverCommandDto) {
    return this.historicalWages.activate(user.id, body);
  }

  @Post("scopes/compensate")
  @UseAnyProjectPositionScope()
  @RequireProjectRole("clearing.confirm")
  @RequirePositions("finance_director")
  compensate(@CurrentUser() user: AuthenticatedUser, @Body() body: HistoricalWageTakeoverCommandDto) {
    return this.historicalWages.compensate(user.id, body);
  }
}
