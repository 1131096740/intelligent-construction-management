import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { SettlementTemplateService } from "./settlement-template.service";
import { CreateTemplateWorkbenchDto, PublishTemplateWorkbenchDto, TemplateWorkbenchRevisionDto, UpdateTemplateWorkbenchDto } from "./dto/settlement-template-workbench.dto";
import { DiscardSettlementTemplateVersionDto } from "./dto/discard-settlement-template-version.dto";
import { SettlementTemplatePreviewDownloadDto } from "./dto/settlement-template.dto";

@Controller("settlement-template-workbench")
@RequirePositions("contract_director", "super_admin")
export class SettlementTemplateWorkbenchController {
  constructor(private readonly templates: SettlementTemplateService) {}

  @Get("capability")
  capability(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.workbenchCapability(user.id);
  }

  @Get("templates")
  list(@CurrentUser() user: AuthenticatedUser, @Query("includeHistory") history?: string) {
    return this.templates.listGovernance(user.id, history === "true");
  }

  @Get("templates/:templateId")
  get(@Param("templateId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.get(id, user.id, true);
  }

  @Post("templates")
  create(@Body() input: CreateTemplateWorkbenchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.create(user.id, input, input.definitionVersion);
  }

  @Get("versions/:versionId/capability")
  versionCapability(@Param("versionId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.workbenchVersionCapability(id, user.id);
  }

  @Patch("versions/:versionId")
  update(@Param("versionId") id: string, @Body() input: UpdateTemplateWorkbenchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.updateDraft(id, user.id, input, input.definitionVersion);
  }

  @Post("versions/:versionId/inspection")
  inspect(@Param("versionId") id: string, @Body() input: TemplateWorkbenchRevisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.inspect(id, user.id, input);
  }

  @Post("versions/:versionId/preview-generation")
  preview(@Param("versionId") id: string, @Body() input: TemplateWorkbenchRevisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.generatePreview(id, user.id, input);
  }

  @Post("versions/:versionId/submission")
  submit(@Param("versionId") id: string, @Body() input: TemplateWorkbenchRevisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.submit(id, user.id, input);
  }

  @Post("versions/:versionId/publication")
  publish(@Param("versionId") id: string, @Body() input: PublishTemplateWorkbenchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.publish(id, user.id, input.changeSummary, input);
  }

  @Post("versions/:versionId/clone")
  clone(@Param("versionId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.clone(id, user.id);
  }

  @Post("versions/:versionId/discard")
  @RequirePositions("contract_director")
  discard(@Param("versionId") id: string, @Body() input: DiscardSettlementTemplateVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.discard(id, user.id, input.reason, input.expectedRevision);
  }

  @Post("versions/:versionId/stop")
  stop(@Param("versionId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.stop(id, user.id);
  }

  @Post("versions/:versionId/preview-xlsx/download-ticket")
  xlsx(@Param("versionId") id: string, @Body() input: SettlementTemplatePreviewDownloadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.createPreviewDownloadTicket(id, "xlsx", user.id, input.downloadReason);
  }

  @Post("versions/:versionId/preview-pdf/download-ticket")
  pdf(@Param("versionId") id: string, @Body() input: SettlementTemplatePreviewDownloadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.createPreviewDownloadTicket(id, "pdf", user.id, input.downloadReason);
  }
}
