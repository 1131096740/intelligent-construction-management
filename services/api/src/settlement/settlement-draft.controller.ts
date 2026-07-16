import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  SaveSettlementDraftDto,
  SubmitSettlementDraftDto
} from "./dto/settlement-draft.dto";
import { SettlementDraftService } from "./settlement-draft.service";
import { SettlementSubmissionService } from "./settlement-submission.service";

@Controller("projects/:projectId/settlement-drafts")
export class SettlementDraftController {
  constructor(
    private readonly drafts: SettlementDraftService,
    private readonly submissions: SettlementSubmissionService
  ) {}

  @Post()
  @RequireProjectRole("settlement.create")
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveSettlementDraftDto
  ) {
    return this.drafts.create(projectId, user.id, body);
  }

  @Get()
  @RequireProjectRole("settlement.create")
  list(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.drafts.list(projectId, user.id);
  }

  @Get(":draftId")
  @RequireProjectRole("settlement.create")
  detail(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.drafts.get(projectId, draftId, user.id);
  }

  @Patch(":draftId")
  @RequireProjectRole("settlement.create")
  update(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveSettlementDraftDto
  ) {
    return this.drafts.update(projectId, draftId, user.id, body);
  }

  @Post(":draftId/approval-submission")
  @RequireProjectRole("settlement.create")
  submit(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitSettlementDraftDto
  ) {
    return this.submissions.submitDraft(
      projectId,
      draftId,
      user.id,
      body.expectedRevision
    );
  }
}
