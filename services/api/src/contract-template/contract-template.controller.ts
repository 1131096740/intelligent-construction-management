import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractTemplateService } from "./contract-template.service";
import type {
  CreateBusinessTemplateDto,
  CreateStandardClauseDto,
  PublishTemplateVersionDto,
  UpdateBusinessTemplateVersionDto
} from "./dto/contract-template.dto";
import { LayoutTemplateService } from "./layout-template.service";

@Controller()
export class ContractTemplateController {
  constructor(
    private readonly templates: ContractTemplateService,
    private readonly layouts: LayoutTemplateService
  ) {}

  @Get("contract-layout-templates")
  listPublishedLayouts(@Query("contractTypeKey") contractTypeKey?: string) {
    return this.layouts.listPublishedLayouts(contractTypeKey);
  }

  @Post("contract-layout-templates")
  createLayout(
    @Body()
    body: {
      name: string;
      contractTypeKey: string;
      docxFileId: string;
      placeholderSchema: unknown;
    },
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.createLayout(user.id, body);
  }

  @Post("contract-layout-template-versions/:versionId/inspection")
  inspectLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.inspectVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/preview-generation")
  queueLayoutPreview(
    @Param("versionId") versionId: string,
    @Body() sampleData: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.queuePreview(versionId, user.id, sampleData);
  }

  @Get("contract-layout-template-versions/:versionId/preview-generation")
  getLayoutPreview(@Param("versionId") versionId: string) {
    return this.layouts.getLatestPreview(versionId);
  }

  @Post("contract-layout-template-versions/:versionId/submission")
  submitLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.submitVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/publication")
  publishLayout(
    @Param("versionId") versionId: string,
    @Body() body: { changeSummary: string },
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.publishVersion(versionId, user.id, body.changeSummary);
  }

  @Post("contract-layout-template-versions/:versionId/clone")
  cloneLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.cloneVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/stop")
  stopLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.stopVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/revoke")
  revokeLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.revokeVersion(versionId, user.id);
  }

  // ---------------------------------------------------------------------------
  // Business templates
  // ---------------------------------------------------------------------------

  @Get("contract-templates")
  listPublished(@Query("contractTypeKey") contractTypeKey?: string) {
    return this.templates.listPublished(contractTypeKey);
  }

  @Get("contract-templates/:templateId")
  getTemplate(@Param("templateId") templateId: string) {
    return this.templates.getTemplate(templateId);
  }

  @Post("contract-templates")
  createTemplate(
    @Body() body: CreateBusinessTemplateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createTemplate(user.id, body);
  }

  @Patch("contract-template-versions/:versionId")
  updateDraftVersion(
    @Param("versionId") versionId: string,
    @Body() body: UpdateBusinessTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.updateDraftVersion(versionId, user.id, body);
  }

  @Post("contract-template-versions/:versionId/clone")
  cloneVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.cloneVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/submission")
  submitVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.submitVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/publication")
  publishVersion(
    @Param("versionId") versionId: string,
    @Body() body: PublishTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.publishVersion(versionId, user.id, body);
  }

  @Post("contract-template-versions/:versionId/stop")
  stopVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.stopVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/revoke")
  revokeVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.revokeVersion(versionId, user.id);
  }

  // ---------------------------------------------------------------------------
  // Standard clauses
  // ---------------------------------------------------------------------------

  @Get("standard-clauses")
  listPublishedClauses(@Query("category") category?: string) {
    return this.templates.listPublishedClauses(category);
  }

  @Post("standard-clauses")
  createClause(
    @Body() body: CreateStandardClauseDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createClause(user.id, body);
  }

  @Post("standard-clause-versions/:versionId/publication")
  publishClauseVersion(
    @Param("versionId") versionId: string,
    @Body() body: { changeSummary: string },
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.publishClauseVersion(versionId, user.id, body.changeSummary);
  }
}
