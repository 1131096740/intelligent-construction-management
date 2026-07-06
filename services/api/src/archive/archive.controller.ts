import { Controller, Get, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ArchiveService } from "./archive.service";

@Controller("archives")
@RequirePositions(
  "chairman",
  "general_manager",
  "contract_director",
  "contract_staff",
  "finance_director",
  "finance_staff",
  "super_admin"
)
export class ArchiveController {
  constructor(
    private readonly archives: ArchiveService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.archives.listRecent(limit, await this.projectVisibility.visibleProjectIds(user.id));
  }
}
