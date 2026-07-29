import { Body, Controller, Get, GoneException, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { AssignProjectAffiliateDto } from "./dto/assign-project-affiliate.dto";
import { ConfirmProjectOwnerContractDto } from "./dto/confirm-project-owner-contract.dto";
import { ConfirmProjectUpstreamSettlementDto } from "./dto/confirm-project-upstream-settlement.dto";
import { ConfirmProjectUpstreamFundFactDto } from "./dto/confirm-project-upstream-fund-fact.dto";
import type { CreateProjectDto } from "./dto/create-project.dto";
import { RecordProjectOwnerContractDto } from "./dto/record-project-owner-contract.dto";
import { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import { RecordProjectUpstreamFundFactDto } from "./dto/record-project-upstream-fund-fact.dto";
import { RequestProjectFinancingQuotaDto } from "./dto/request-project-financing-quota.dto";
import { RequestSettlementExceptionQuotaDto } from "./dto/request-settlement-exception-quota.dto";
import { ReviewProjectFinancingQuotaDto } from "./dto/review-project-financing-quota.dto";
import { ReviewSettlementExceptionQuotaDto } from "./dto/review-settlement-exception-quota.dto";
import { TerminateProjectFinancingQuotaDto } from "./dto/terminate-project-financing-quota.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";
import { ProjectService } from "./project.service";

@Controller("projects")
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Post()
  @RequirePositions("chairman", "general_manager")
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateProjectDto) {
    return this.projects.createProject(user.id, body);
  }

  @Patch(":projectId")
  @RequirePositions("chairman", "general_manager")
  update(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProjectDto
  ) {
    return this.projects.updateProject(projectId, user.id, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listActiveOptions(user.id);
  }

  @Get("contract-create-options")
  contractCreateOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listContractCreateOptions(user.id);
  }

  @Get("affiliate-mapping-report")
  @RequirePositions("chairman", "general_manager", "contract_director")
  affiliateMappingReport() {
    return this.projects.getAffiliateMappingReport();
  }

  @Get("roster")
  roster(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listRoster(user.id);
  }

  @Get(":projectId/operating-funds-overview")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  operatingFundsOverview(@Param("projectId") projectId: string) {
    return this.projects.getOperatingFundsOverview(projectId);
  }

  @Post(":projectId/affiliate-assignment")
  @RequirePositions("chairman", "general_manager")
  assignAffiliate(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignProjectAffiliateDto
  ) {
    return this.projects.assignAffiliate(projectId, user.id, body);
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

  @Post(":projectId/upstream-fund-facts")
  @RequireProjectRole("project.upstream_fund_fact.record")
  recordUpstreamFundFact(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectUpstreamFundFactDto
  ) {
    return this.projects.recordUpstreamFundFact(projectId, user.id, body);
  }

  @Post(":projectId/upstream-fund-facts/:fundFactId/confirmation")
  @RequireProjectRole("project.upstream_fund_fact.confirm")
  confirmUpstreamFundFact(
    @Param("projectId") projectId: string,
    @Param("fundFactId") fundFactId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectUpstreamFundFactDto
  ) {
    return this.projects.confirmUpstreamFundFact(projectId, fundFactId, user.id, body);
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

  @Post(":projectId/upstream-settlements/:upstreamSettlementId/confirmation")
  @RequireProjectRole("project.upstream_settlement.confirm")
  confirmUpstreamSettlement(
    @Param("projectId") projectId: string,
    @Param("upstreamSettlementId") upstreamSettlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectUpstreamSettlementDto
  ) {
    return this.projects.confirmUpstreamSettlement(
      projectId,
      upstreamSettlementId,
      user.id,
      body
    );
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
    void projectId;
    void user;
    void body;
    throw new GoneException(
      "结算例外额度已停止新增；下游结算超过上游时改为风险提示和审计"
    );
  }

  @Post(":projectId/settlement-exception-quotas/:quotaId/approval")
  @RequireProjectRole("project.settlement_exception_quota.approve")
  reviewSettlementExceptionQuota(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSettlementExceptionQuotaDto
  ) {
    void projectId;
    void quotaId;
    void user;
    void body;
    throw new GoneException(
      "结算例外额度审批写入已停止；历史记录仅保留查询和审计"
    );
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

  @Post(":projectId/financing-quotas/:quotaId/termination")
  @RequireProjectRole("project.financing_quota.terminate")
  terminateProjectFinancingQuota(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TerminateProjectFinancingQuotaDto
  ) {
    return this.projects.terminateProjectFinancingQuota(projectId, quotaId, user.id, body);
  }
}
