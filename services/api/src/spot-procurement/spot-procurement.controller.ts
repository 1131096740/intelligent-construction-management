import {
  Body,
  Controller,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import { CreateSpotProcurementVersionDto } from "./dto/create-spot-procurement-version.dto";
import { ReviewSpotProcurementDto } from "./dto/review-spot-procurement.dto";
import { UpdateSpotProcurementDraftDto } from "./dto/update-spot-procurement-draft.dto";
import { VoidSpotProcurementDto } from "./dto/void-spot-procurement.dto";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";

@Controller("spot-procurements")
export class SpotProcurementController {
  constructor(
    private readonly applications: SpotProcurementApplicationService
  ) {}

  @Post()
  @RequireProjectRole("spot_procurement.create")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSpotProcurementDto
  ) {
    return this.applications.createDraft(user.id, body);
  }

  @Patch(":procurementId/draft")
  @RequireProjectRole("spot_procurement.create")
  updateDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSpotProcurementDraftDto
  ) {
    return this.applications.updateDraft(procurementId, user.id, body);
  }

  @Post(":procurementId/versions")
  @RequireProjectRole("spot_procurement.create")
  createVersion(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSpotProcurementVersionDto
  ) {
    return this.applications.createVersion(procurementId, user.id, body);
  }

  @Post(":procurementId/submission")
  @RequireProjectRole("spot_procurement.create")
  submit(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.applications.submit(procurementId, user.id);
  }

  @Post(":procurementId/approval")
  @RequireProjectRole("spot_procurement.approve")
  review(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSpotProcurementDto
  ) {
    return this.applications.review(procurementId, user.id, body);
  }

  @Post(":procurementId/voiding")
  @RequireProjectRole("spot_procurement.void")
  voidProcurement(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidSpotProcurementDto
  ) {
    return this.applications.voidProcurement(
      procurementId,
      user.id,
      body.reason
    );
  }
}
