import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { ProjectFundDisputeDraftCommand } from "./project-fund-dispute.domain";
import {
  ProjectFundDisputeService,
  type ProjectFundDisputeTransitionCommand
} from "./project-fund-dispute.service";

@Controller("project-fund-disputes")
export class ProjectFundDisputeController {
  constructor(private readonly disputes: ProjectFundDisputeService) {}

  @Get("workbench")
  getWorkbench(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string,
    @Query("disputeId") disputeId?: string
  ) {
    return this.disputes.getWorkbench(
      { projectId, ...(disputeId ? { disputeId } : {}) },
      { userId: user.id }
    );
  }

  @Post("drafts")
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() command: ProjectFundDisputeDraftCommand
  ) {
    return this.disputes.saveDraft(command, { userId: user.id });
  }

  @Post("entries/:entryId/transition")
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("entryId") entryId: string,
    @Body() command: Omit<ProjectFundDisputeTransitionCommand, "entryId">
  ) {
    return this.disputes.transition(
      { ...command, entryId },
      { userId: user.id }
    );
  }
}
