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
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractTemplateService } from "./contract-template.service";
import { ContractScenarioService } from "./contract-scenario.service";
import {
  CreateContractBusinessScenarioDto,
  CreateContractScenarioTemplateMappingDto,
  UpdateContractBusinessScenarioDto,
  UpdateContractScenarioTemplateMappingDto
} from "./dto/contract-scenario.dto";
import {
  CreateBusinessTemplateDto,
  CreateStandardClauseDto,
  PublishTemplateVersionDto,
  UpdateBusinessTemplateVersionDto
} from "./dto/contract-template.dto";
import {
  CreateLayoutTemplateDto,
  LayoutTemplatePreviewSampleDataDto,
  PublishTemplateChangeDto,
  UpdateLayoutTemplateVersionDto
} from "./dto/layout-template.dto";
import { LayoutTemplateService } from "./layout-template.service";

const TEMPLATE_MAINTENANCE_POSITIONS = [
  "contract_staff",
  "contract_director"
] as const;
const TEMPLATE_PUBLICATION_POSITIONS = ["contract_director"] as const;
const TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS = ["contract_director", "super_admin"] as const;

@Controller()
export class ContractTemplateController {
  constructor(
    private readonly templates: ContractTemplateService,
    private readonly layouts: LayoutTemplateService,
    private readonly scenarios: ContractScenarioService
  ) {}

  @Get("contract-business-scenarios/available")
  @RequireProjectRole("contract.create")
  listAvailableScenarios(
    @Query("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.listAvailable(projectId, user.id);
  }

  @Get("contract-business-scenarios/recommendations")
  @RequireProjectRole("contract.create")
  recommendScenarioTemplates(
    @Query("projectId") projectId: string,
    @Query("scenarioId") scenarioId: string,
    @Query("contractTypeKey") contractTypeKey: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.recommend(projectId, user.id, scenarioId, contractTypeKey);
  }

  @Get("contract-business-scenarios")
  @RequirePositions(...TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS)
  listScenarioGovernance(@CurrentUser() user: AuthenticatedUser) {
    return this.scenarios.listGovernance(user.id);
  }

  @Post("contract-business-scenarios")
  @RequirePositions(...TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS)
  createBusinessScenario(
    @Body() body: CreateContractBusinessScenarioDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.createScenario(user.id, body);
  }

  @Patch("contract-business-scenarios/:scenarioId")
  @RequirePositions(...TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS)
  updateBusinessScenario(
    @Param("scenarioId") scenarioId: string,
    @Body() body: UpdateContractBusinessScenarioDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.updateScenario(scenarioId, user.id, body);
  }

  @Post("contract-business-scenarios/:scenarioId/template-mappings")
  @RequirePositions(...TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS)
  createScenarioTemplateMapping(
    @Param("scenarioId") scenarioId: string,
    @Body() body: CreateContractScenarioTemplateMappingDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.createMapping(scenarioId, user.id, body);
  }

  @Patch("contract-scenario-template-mappings/:mappingId")
  @RequirePositions(...TEMPLATE_SCENARIO_GOVERNANCE_POSITIONS)
  updateScenarioTemplateMapping(
    @Param("mappingId") mappingId: string,
    @Body() body: UpdateContractScenarioTemplateMappingDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.scenarios.updateMapping(mappingId, user.id, body);
  }

  @Get("contract-layout-templates")
  listPublishedLayouts(@Query("contractTypeKey") contractTypeKey?: string) {
    return this.layouts.listPublishedLayouts(contractTypeKey);
  }

  @Post("contract-layout-templates")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  createLayout(
    @Body()
    body: CreateLayoutTemplateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.createLayout(user.id, body);
  }

  @Get("contract-layout-templates/:templateId")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  getLayoutTemplate(
    @Param("templateId") templateId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.getLayoutTemplate(templateId, user.id);
  }

  @Patch("contract-layout-template-versions/:versionId")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  updateLayoutDraftVersion(
    @Param("versionId") versionId: string,
    @Body() body: UpdateLayoutTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.updateDraftVersion(versionId, user.id, body);
  }

  @Post("contract-layout-template-versions/:versionId/inspection")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  inspectLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.inspectVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/preview-generation")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  queueLayoutPreview(
    @Param("versionId") versionId: string,
    @Body() sampleData: LayoutTemplatePreviewSampleDataDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.queuePreview(versionId, user.id, sampleData);
  }

  @Get("contract-layout-template-versions/:versionId/preview-generation")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  getLayoutPreview(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.getLatestPreview(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/submission")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  submitLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.submitVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/publication")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
  publishLayout(
    @Param("versionId") versionId: string,
    @Body() body: PublishTemplateChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.publishVersion(versionId, user.id, body.changeSummary);
  }

  @Post("contract-layout-template-versions/:versionId/clone")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  cloneLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.cloneVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/stop")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
  stopLayout(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.layouts.stopVersion(versionId, user.id);
  }

  @Post("contract-layout-template-versions/:versionId/revoke")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
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
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  getTemplate(@Param("templateId") templateId: string) {
    return this.templates.getTemplate(templateId);
  }

  @Post("contract-templates")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  createTemplate(
    @Body() body: CreateBusinessTemplateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createTemplate(user.id, body);
  }

  @Patch("contract-template-versions/:versionId")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  updateDraftVersion(
    @Param("versionId") versionId: string,
    @Body() body: UpdateBusinessTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.updateDraftVersion(versionId, user.id, body);
  }

  @Post("contract-template-versions/:versionId/clone")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  cloneVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.cloneVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/submission")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  submitVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.submitVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/publication")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
  publishVersion(
    @Param("versionId") versionId: string,
    @Body() body: PublishTemplateVersionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.publishVersion(versionId, user.id, body);
  }

  @Post("contract-template-versions/:versionId/stop")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
  stopVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.stopVersion(versionId, user.id);
  }

  @Post("contract-template-versions/:versionId/revoke")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
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
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  createClause(
    @Body() body: CreateStandardClauseDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.createClause(user.id, body);
  }

  @Post("standard-clause-versions/:versionId/submission")
  @RequirePositions(...TEMPLATE_MAINTENANCE_POSITIONS)
  submitClauseVersion(
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.submitClauseVersion(versionId, user.id);
  }

  @Post("standard-clause-versions/:versionId/publication")
  @RequirePositions(...TEMPLATE_PUBLICATION_POSITIONS)
  publishClauseVersion(
    @Param("versionId") versionId: string,
    @Body() body: PublishTemplateChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.templates.publishClauseVersion(versionId, user.id, body.changeSummary);
  }
}
