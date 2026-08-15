import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import { BusinessEntryDraftRequestDto } from "./dto/business-entry-draft-request.dto";

@Controller("business-entry-definitions")
export class BusinessEntryDefinitionController {
  constructor(private readonly definitions: BusinessEntryDefinitionService) {}

  @Get(":sceneKey")
  @RequireProjectRole("project.operating_profile.manage")
  getSceneDefinition(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.getSceneDefinition(sceneKey, projectId, user.id);
  }

  @Post(":sceneKey/validate")
  @RequireProjectRole("project.operating_profile.manage")
  validateDraft(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string,
    @Body() body: BusinessEntryDraftRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.validateDraft(sceneKey, projectId, user.id, body);
  }

  @Post(":sceneKey/freeze")
  @RequireProjectRole("project.operating_profile.manage")
  freezeSubmissionSnapshot(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string,
    @Body() body: BusinessEntryDraftRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.freezeSubmissionSnapshot(sceneKey, projectId, user.id, body);
  }
}
