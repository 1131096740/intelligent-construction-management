import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  OperatingCostAttributionRequestDto,
  OperatingCostAttributionReviewDto
} from "./dto/operating-cost-attribution.dto";
import { OperatingCostAttributionService } from "./operating-cost-attribution.service";

@Controller("projects/:projectId/cost-attributions")
@RequirePositions(
  "comprehensive_director",
  "finance_staff",
  "finance_director"
)
export class OperatingCostAttributionController {
  constructor(
    private readonly attributions: OperatingCostAttributionService
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ) {
    return this.attributions.list(projectId, user.id);
  }

  @Post(":factId")
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @Body() body: OperatingCostAttributionRequestDto
  ) {
    return this.attributions.request(projectId, factId, body, user.id);
  }

  @Post(":id/review")
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() body: OperatingCostAttributionReviewDto
  ) {
    return this.attributions.review(projectId, id, body, user.id);
  }
}
