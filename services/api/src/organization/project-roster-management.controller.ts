import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApplyProjectRosterChangeDto, ProjectRosterChangeDto } from "./dto/project-roster-change.dto";
import { ProjectRosterManagementService } from "./project-roster-management.service";

@Controller("organization/project-roster")
@RequirePositions("chairman", "comprehensive_director")
export class ProjectRosterManagementController {
  constructor(private readonly roster: ProjectRosterManagementService) {}

  @Get("options")
  options(@CurrentUser() actor: AuthenticatedUser) {
    return this.roster.options(actor.id);
  }

  @Post("preview")
  preview(@CurrentUser() actor: AuthenticatedUser, @Body() body: ProjectRosterChangeDto) {
    return this.roster.preview(actor.id, body);
  }

  @Post("apply")
  apply(@CurrentUser() actor: AuthenticatedUser, @Body() body: ApplyProjectRosterChangeDto) {
    return this.roster.apply(actor.id, body);
  }
}
