import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ProjectService } from "./project.service";

const FUNDS_OVERVIEW_POSITIONS = [
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
] as const;

@Controller("projects")
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listActiveOptions(user.id);
  }

  @Get(":projectId/operating-funds-overview")
  @RequirePositions(...FUNDS_OVERVIEW_POSITIONS)
  operatingFundsOverview(@Param("projectId") projectId: string) {
    return this.projects.getOperatingFundsOverview(projectId);
  }
}
