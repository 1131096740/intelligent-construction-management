import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ContractEndedApplicationRetentionService } from "./contract-ended-retention.service";
import { ContractEndedRetentionHoldDto } from "./dto/contract-ended-retention-hold.dto";

@Controller("contract-ended-retention")
@RequirePositions("contract_director")
export class ContractEndedApplicationRetentionController {
  constructor(
    private readonly retention: ContractEndedApplicationRetentionService
  ) {}

  @Get("preview")
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.retention.preview(user.id, page, limit);
  }

  @Post(":contractVersionId/holds")
  createHold(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: ContractEndedRetentionHoldDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.retention.createHold(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/hold-release")
  releaseHold(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: ContractEndedRetentionHoldDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.retention.releaseHold(contractVersionId, user.id, body);
  }
}
