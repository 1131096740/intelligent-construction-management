import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import {
  CreateSettlementTemplateDto,
  PublishSettlementTemplateVersionDto,
  SettlementTemplatePreviewDownloadDto,
  UpdateSettlementTemplateVersionDto
} from "./dto/settlement-template.dto";
import { DiscardSettlementTemplateVersionDto } from "./dto/discard-settlement-template-version.dto";
import { SettlementTemplateService } from "./settlement-template.service";

@Controller()
@RequirePositions("contract_director", "super_admin")
export class SettlementTemplateGovernanceController {
  constructor(private readonly templates: SettlementTemplateService) {}

  @Get("settlement-templates")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("includeHistory") includeHistory?: string
  ) {
    return this.templates.listGovernance(user.id, includeHistory === "true");
  }

  @Post("settlement-templates")
  create(
    @Body() input: CreateSettlementTemplateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.create(user.id, input);
  }

  @Get("settlement-templates/:templateId")
  get(
    @Param("templateId") templateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("includeHistory") includeHistory?: string
  ) {
    return this.templates.get(templateId, user.id, includeHistory === "true");
  }

  @Patch("settlement-template-versions/:versionId")
  update(
    @Param("versionId") versionId: string,
    @Body() input: UpdateSettlementTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.updateDraft(versionId, user.id, input);
  }

  @Post("settlement-template-versions/:versionId/inspection")
  inspect(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.inspect(versionId, user.id);
  }

  @Post("settlement-template-versions/:versionId/preview-generation")
  preview(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.generatePreview(versionId, user.id);
  }

  @Post("settlement-template-versions/:versionId/submission")
  submit(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.submit(versionId, user.id);
  }

  @Post("settlement-template-versions/:versionId/publication")
  publish(
    @Param("versionId") versionId: string,
    @Body() input: PublishSettlementTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.publish(versionId, user.id, input.changeSummary);
  }

  @Post("settlement-template-versions/:versionId/clone")
  clone(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.clone(versionId, user.id);
  }

  @Post("settlement-template-versions/:versionId/discard")
  @RequirePositions("contract_director")
  discard(
    @Param("versionId") versionId: string,
    @Body() input: DiscardSettlementTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.discard(versionId, user.id, input.reason, input.expectedRevision);
  }

  @Post("settlement-template-versions/:versionId/stop")
  stop(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.stop(versionId, user.id);
  }

  @Post("settlement-template-versions/:versionId/preview-xlsx/download-ticket")
  downloadPreviewXlsx(
    @Param("versionId") versionId: string,
    @Body() input: SettlementTemplatePreviewDownloadDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createPreviewDownloadTicket(
      versionId,
      "xlsx",
      user.id,
      input.downloadReason
    );
  }

  @Post("settlement-template-versions/:versionId/preview-pdf/download-ticket")
  downloadPreviewPdf(
    @Param("versionId") versionId: string,
    @Body() input: SettlementTemplatePreviewDownloadDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createPreviewDownloadTicket(
      versionId,
      "pdf",
      user.id,
      input.downloadReason
    );
  }
}

@Controller("settlement-workbench")
export class SettlementTemplateRecommendationController {
  constructor(private readonly templates: SettlementTemplateService) {}

  @Get("projects/:projectId/contract-versions/:contractVersionId/template-recommendations")
  @RequireProjectRole("settlement.create")
  recommend(
    @Param("projectId") projectId: string,
    @Param("contractVersionId") contractVersionId: string
  ) {
    return this.templates.recommend(projectId, contractVersionId);
  }
}
