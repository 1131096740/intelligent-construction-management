import { Controller, Get, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ARCHIVE_READ_ROLE_KEYS } from "@jiangkong/shared-domain";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ArchiveService } from "./archive.service";

@Controller("archives")
@RequirePositions(...ARCHIVE_READ_ROLE_KEYS)
export class ArchiveController {
  constructor(
    private readonly archives: ArchiveService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("limit") limit?: string,
    @Query("project") project?: string,
    @Query("contract") contract?: string,
    @Query("counterparty") counterparty?: string,
    @Query("documentType") documentType?: string,
    @Query("archiveStatus") archiveStatus?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("keyword") keyword?: string
  ) {
    return this.archives.listRecent(
      limit,
      await this.projectVisibility.visibleProjectIds(user.id),
      { project, contract, counterparty, documentType, archiveStatus, dateFrom, dateTo, keyword }
    );
  }
}
