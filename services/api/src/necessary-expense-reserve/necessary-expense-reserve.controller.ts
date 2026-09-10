import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { NecessaryExpenseReserveDraftCommand } from "./necessary-expense-reserve.domain";
import {
  NecessaryExpenseReserveService,
  type NecessaryExpenseReserveTransitionCommand
} from "./necessary-expense-reserve.service";

@Controller("necessary-expense-reserves")
export class NecessaryExpenseReserveController {
  constructor(private readonly reserves: NecessaryExpenseReserveService) {}

  @Get("capabilities")
  getCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string
  ) {
    return this.reserves.getCapabilities(projectId, { userId: user.id });
  }

  @Get("workbench")
  getWorkbench(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string,
    @Query("reserveId") reserveId?: string
  ) {
    return this.reserves.getWorkbench(
      { projectId, ...(reserveId ? { reserveId } : {}) },
      { userId: user.id }
    );
  }

  @Post("drafts")
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() command: NecessaryExpenseReserveDraftCommand
  ) {
    return this.reserves.saveDraft(command, { userId: user.id });
  }

  @Post("entries/:entryId/transition")
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("entryId") entryId: string,
    @Body() command: Omit<NecessaryExpenseReserveTransitionCommand, "entryId">
  ) {
    return this.reserves.transition(
      { ...command, entryId },
      { userId: user.id }
    );
  }
}
