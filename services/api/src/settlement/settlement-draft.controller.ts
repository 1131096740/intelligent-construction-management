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
import { LinkSettlementCounterpartySignedDocumentDto } from "./dto/settlement-signed-document.dto";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { GenerateSettlementFrozenDocumentDto } from "./dto/settlement-signed-document-action.dto";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";
import { AbandonSettlementDraftDto } from "./dto/abandon-settlement-draft.dto";

@Controller("projects/:projectId/settlement-drafts")
export class SettlementDraftController {
  constructor(
    private readonly drafts: SettlementDraftService,
    private readonly submissions: SettlementSubmissionService,
    private readonly counterpartyDocuments: SettlementCounterpartyDocumentService,
    private readonly frozenDocuments: SettlementFrozenDocumentService
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

  @Post(":draftId/abandonment")
  @RequireProjectRole("settlement.create")
  abandon(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonSettlementDraftDto
  ) {
    return this.drafts.abandon(projectId, draftId, user.id, body);
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

  @Post(":draftId/counterparty-signed-documents")
  @RequireProjectRole("settlement.create")
  linkCounterpartySignedDocument(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: LinkSettlementCounterpartySignedDocumentDto
  ) {
    return this.counterpartyDocuments.link(projectId, draftId, user.id, body);
  }

  @Post(":draftId/frozen-document")
  @RequireProjectRole("settlement.create")
  generateFrozenDocument(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GenerateSettlementFrozenDocumentDto
  ) {
    return this.frozenDocuments.generate(
      projectId,
      draftId,
      user.id,
      body.expectedRevision
    );
  }
}
