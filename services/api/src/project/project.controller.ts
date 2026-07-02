import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import { ProjectService } from "./project.service";

const FUNDS_OVERVIEW_POSITIONS = [
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
] as const;

@Controller("projects")
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listActiveOptions(user.id);
  }

  @Get(":projectId/operating-funds-overview")
  @RequirePositions(...FUNDS_OVERVIEW_POSITIONS)
  operatingFundsOverview(@Param("projectId") projectId: string) {
    return this.projects.getOperatingFundsOverview(projectId);
  }

  @Post(":projectId/receipts")
  @RequireProjectRole("project.receipt.record")
  recordReceipt(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectReceiptDto
  ) {
    return this.projects.recordReceipt(projectId, user.id, body);
  }

  @Post(":projectId/proxy-payments")
  @RequireProjectRole("project.proxy_payment.record")
  recordProxyPayment(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectProxyPaymentDto
  ) {
    return this.projects.recordProxyPayment(projectId, user.id, body);
  }
}
