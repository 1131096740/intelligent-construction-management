import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import {
  CompensateHistoricalFinancialTakeoverDto,
  HistoricalFinancialTakeoverCommandDto,
  PrepareHistoricalFinancialTakeoverDto
} from "./historical-financial-takeover.dto";
import { HistoricalFinancialTakeoverService } from "./historical-financial-takeover.service";

@Controller("projects/:projectId/operating-takeovers/historical-financial")
export class HistoricalFinancialTakeoverController {
  constructor(private readonly service: HistoricalFinancialTakeoverService) {}

  @Post("manifests")
  @RequireProjectRole("operating_takeover.manage")
  prepare(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PrepareHistoricalFinancialTakeoverDto
  ) {
    return this.service.prepare(projectId, user.id, body);
  }

  @Get("manifests")
  @RequireProjectRole("operating_takeover.manage")
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(projectId, user.id);
  }

  @Get("manifests/:batchId")
  @RequireProjectRole("operating_takeover.manage")
  detail(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.service.detail(projectId, batchId, user.id);
  }

  @Get("active-projection")
  @RequireProjectRole("operating_takeover.manage")
  activeProjection(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.activeProjection(projectId, user.id);
  }

  @Post("manifests/:batchId/apply-inactive")
  @RequireProjectRole("operating_takeover.manage")
  applyInactive(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: HistoricalFinancialTakeoverCommandDto
  ) {
    return this.service.applyInactive(projectId, batchId, user.id, body);
  }

  @Post("manifests/:batchId/attest")
  @RequireProjectRole("operating_takeover.confirm")
  attest(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: HistoricalFinancialTakeoverCommandDto
  ) {
    return this.service.attest(projectId, batchId, user.id, body);
  }

  @Post("manifests/:batchId/activate")
  @RequireProjectRole("operating_takeover.activate")
  activate(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: HistoricalFinancialTakeoverCommandDto
  ) {
    return this.service.activate(projectId, batchId, user.id, body);
  }

  @Post("manifests/:batchId/compensate")
  @RequireProjectRole("operating_takeover.activate")
  compensate(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CompensateHistoricalFinancialTakeoverDto
  ) {
    return this.service.compensate(projectId, batchId, user.id, body);
  }
}
