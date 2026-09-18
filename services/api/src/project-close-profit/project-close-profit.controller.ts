import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import {
  AttestDownstreamCostDto,
  CompleteProjectCloseStageDto,
  CreateTemporaryProfitDistributionDto,
  ConfirmFinalProfitDto,
  ConfirmProjectCloseDistributionDto,
  ReconcileProjectCloseImpactsDto,
  SubmitFinalProfitDto,
  SubmitProjectCloseDistributionDto
} from "./dto/project-close-profit.dto";
import { ProjectCloseProfitService } from "./project-close-profit.service";

@Controller("projects/:projectId/close-profit")
@RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
export class ProjectCloseProfitController {
  constructor(private readonly closeProfit: ProjectCloseProfitService) {}

  @Get()
  getWorkbench(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ) {
    return this.closeProfit.getWorkbench(user.id, projectId);
  }

  @Post("stages/:stageKey/complete")
  completeStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("stageKey") stageKey: string,
    @Body() body: CompleteProjectCloseStageDto
  ) {
    return this.closeProfit.completeStage(user.id, projectId, {
      ...body,
      stageKey
    });
  }

  @Post("downstream-cost/attestations/contract")
  attestContractDownstreamCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: AttestDownstreamCostDto
  ) {
    return this.closeProfit.attestDownstreamCost(user.id, projectId, {
      ...body,
      specialty: "contract"
    });
  }

  @Post("downstream-cost/attestations/finance")
  attestFinanceDownstreamCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: AttestDownstreamCostDto
  ) {
    return this.closeProfit.attestDownstreamCost(user.id, projectId, {
      ...body,
      specialty: "finance"
    });
  }

  @Post("final-profit/confirm")
  confirmFinalProfit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: ConfirmFinalProfitDto
  ) {
    return this.closeProfit.confirmFinalProfit(user.id, projectId, body);
  }

  @Post("final-profit/submissions")
  submitFinalProfit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: SubmitFinalProfitDto
  ) {
    return this.closeProfit.submitFinalProfit(user.id, projectId, body);
  }

  @Post("temporary-distributions")
  createTemporaryDistribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateTemporaryProfitDistributionDto
  ) {
    return this.closeProfit.createTemporaryDistribution(user.id, projectId, body);
  }

  @Post("impacts/reconcile")
  reconcileImpacts(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: ReconcileProjectCloseImpactsDto
  ) {
    return this.closeProfit.reconcileImpacts(user.id, projectId, body);
  }

  @Post("distributions/confirm")
  confirmDistribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: ConfirmProjectCloseDistributionDto
  ) {
    return this.closeProfit.confirmDistribution(user.id, projectId, body);
  }

  @Post("distributions/submissions")
  submitDistribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: SubmitProjectCloseDistributionDto
  ) {
    return this.closeProfit.submitDistribution(user.id, projectId, body);
  }
}
