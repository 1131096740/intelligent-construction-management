import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { ConfirmProjectOwnerContractDto } from "./dto/confirm-project-owner-contract.dto";
import type { RecordProjectOwnerContractDto } from "./dto/record-project-owner-contract.dto";
import type { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import type { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import type { RequestProjectFinancingQuotaDto } from "./dto/request-project-financing-quota.dto";
import type { RequestSettlementExceptionQuotaDto } from "./dto/request-settlement-exception-quota.dto";
import type { ReviewProjectFinancingQuotaDto } from "./dto/review-project-financing-quota.dto";
import type { ReviewSettlementExceptionQuotaDto } from "./dto/review-settlement-exception-quota.dto";
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

  @Post(":projectId/upstream-settlements")
  @RequireProjectRole("project.upstream_settlement.record")
  recordUpstreamSettlement(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectUpstreamSettlementDto
  ) {
    return this.projects.recordUpstreamSettlement(projectId, user.id, body);
  }

  @Post(":projectId/owner-contracts")
  @RequireProjectRole("project.owner_contract.record")
  recordOwnerContract(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectOwnerContractDto
  ) {
    return this.projects.recordOwnerContract(projectId, user.id, body);
  }

  @Post(":projectId/owner-contracts/:ownerContractId/confirmation")
  @RequireProjectRole("project.owner_contract.confirm")
  confirmOwnerContract(
    @Param("projectId") projectId: string,
    @Param("ownerContractId") ownerContractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectOwnerContractDto
  ) {
    return this.projects.confirmOwnerContract(projectId, ownerContractId, user.id, body);
  }

  @Post(":projectId/settlement-exception-quotas")
  @RequireProjectRole("project.settlement_exception_quota.request")
  requestSettlementExceptionQuota(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestSettlementExceptionQuotaDto
  ) {
    return this.projects.requestSettlementExceptionQuota(projectId, user.id, body);
  }

  @Post(":projectId/settlement-exception-quotas/:quotaId/approval")
  @RequireProjectRole("project.settlement_exception_quota.approve")
  reviewSettlementExceptionQuota(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSettlementExceptionQuotaDto
  ) {
    return this.projects.reviewSettlementExceptionQuota(projectId, quotaId, user.id, body);
  }

  @Post(":projectId/financing-quotas")
  @RequireProjectRole("project.financing_quota.request")
  requestProjectFinancingQuota(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestProjectFinancingQuotaDto
  ) {
    return this.projects.requestProjectFinancingQuota(projectId, user.id, body);
  }

  @Post(":projectId/financing-quotas/:quotaId/approval")
  @RequireProjectRole("project.financing_quota.approve")
  reviewProjectFinancingQuota(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewProjectFinancingQuotaDto
  ) {
    return this.projects.reviewProjectFinancingQuota(projectId, quotaId, user.id, body);
  }
}
