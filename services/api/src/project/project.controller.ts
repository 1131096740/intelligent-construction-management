import {
  Body,
  Controller,
  Get,
  GoneException,
  Optional,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { AssignProjectAffiliateDto } from "./dto/assign-project-affiliate.dto";
import { ConfirmProjectAffiliateBusinessFactDto } from "./dto/confirm-project-affiliate-business-fact.dto";
import { ConfirmProjectOwnerContractDto } from "./dto/confirm-project-owner-contract.dto";
import { ConfirmProjectUpstreamSettlementDto } from "./dto/confirm-project-upstream-settlement.dto";
import { ConfirmProjectUpstreamFundFactDto } from "./dto/confirm-project-upstream-fund-fact.dto";
import type { CreateProjectDto } from "./dto/create-project.dto";
import { RecordProjectOwnerContractDto } from "./dto/record-project-owner-contract.dto";
import { RecordProjectAffiliateCompanyContractDto } from "./dto/record-project-affiliate-company-contract.dto";
import { RecordProjectAffiliateContractFactDto } from "./dto/record-project-affiliate-contract-fact.dto";
import { RecordProjectAffiliatePaymentFactDto } from "./dto/record-project-affiliate-payment-fact.dto";
import { RecordProjectAffiliateSettlementFactDto } from "./dto/record-project-affiliate-settlement-fact.dto";
import { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import { RecordProjectUpstreamFundFactDto } from "./dto/record-project-upstream-fund-fact.dto";
import { RequestProjectFinancingQuotaDto } from "./dto/request-project-financing-quota.dto";
import { RequestSettlementExceptionQuotaDto } from "./dto/request-settlement-exception-quota.dto";
import { ReviewProjectFinancingQuotaDto } from "./dto/review-project-financing-quota.dto";
import { ReviewSettlementExceptionQuotaDto } from "./dto/review-settlement-exception-quota.dto";
import { TerminateProjectFinancingQuotaDto } from "./dto/terminate-project-financing-quota.dto";
import { SupplementProjectAffiliateBusinessEvidenceDto } from "./dto/supplement-project-affiliate-business-evidence.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";
import { ProjectAffiliateBusinessService } from "./project-affiliate-business.service";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";
import { ProjectService } from "./project.service";

@Controller("projects")
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    @Optional()
    private readonly affiliateBusiness?: ProjectAffiliateBusinessService,
    @Optional()
    private readonly affiliateCompanyContracts?: ProjectAffiliateCompanyContractService
  ) {}

  private affiliateBusinessService(): ProjectAffiliateBusinessService {
    if (!this.affiliateBusiness) {
      throw new Error("Affiliate business fact service is not available");
    }
    return this.affiliateBusiness;
  }

  private affiliateCompanyContractService(): ProjectAffiliateCompanyContractService {
    if (!this.affiliateCompanyContracts) {
      throw new Error("Affiliate-company contract service is not available");
    }
    return this.affiliateCompanyContracts;
  }

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

  @Get(":projectId/financing-quotas")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  projectFinancingQuotaWorkbench(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.projects.getProjectFinancingQuotaWorkbench(projectId, user.id);
  }

  @Get(":projectId/affiliate-business-facts")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  affiliateBusinessFacts(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.affiliateBusinessService().listFacts(projectId, user.id);
  }

  @Get(":projectId/affiliate-company-contracts")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS, "contract_staff")
  affiliateCompanyContractList(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.affiliateCompanyContractService().list(projectId, user.id);
  }

  @Post(":projectId/affiliate-company-contracts")
  @RequireProjectRole("project.affiliate_company_contract.record")
  recordAffiliateCompanyContract(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectAffiliateCompanyContractDto
  ) {
    return this.affiliateCompanyContractService().record(projectId, user.id, body);
  }

  @Post(":projectId/affiliate-company-contracts/:contractId/confirmation")
  @RequireProjectRole("project.affiliate_company_contract.confirm")
  confirmAffiliateCompanyContract(
    @Param("projectId") projectId: string,
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectAffiliateBusinessFactDto
  ) {
    return this.affiliateCompanyContractService().confirm(
      projectId,
      contractId,
      user.id,
      body
    );
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

  @Post(":projectId/affiliate-contract-facts")
  @RequireProjectRole("project.affiliate_contract_fact.record")
  recordAffiliateContractFact(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectAffiliateContractFactDto
  ) {
    return this.affiliateBusinessService().recordContractFact(projectId, user.id, body);
  }

  @Post(":projectId/affiliate-contract-facts/:factId/confirmation")
  @RequireProjectRole("project.affiliate_contract_fact.confirm")
  confirmAffiliateContractFact(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectAffiliateBusinessFactDto
  ) {
    return this.affiliateBusinessService().confirmContractFact(
      projectId,
      factId,
      user.id,
      body
    );
  }

  @Post(":projectId/affiliate-settlement-facts")
  @RequireProjectRole("project.affiliate_settlement_fact.record")
  recordAffiliateSettlementFact(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectAffiliateSettlementFactDto
  ) {
    return this.affiliateBusinessService().recordSettlementFact(projectId, user.id, body);
  }

  @Post(":projectId/affiliate-settlement-facts/:factId/confirmation")
  @RequireProjectRole("project.affiliate_settlement_fact.confirm")
  confirmAffiliateSettlementFact(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectAffiliateBusinessFactDto
  ) {
    return this.affiliateBusinessService().confirmSettlementFact(
      projectId,
      factId,
      user.id,
      body
    );
  }

  @Post(":projectId/affiliate-payment-facts")
  @RequireProjectRole("project.affiliate_payment_fact.record")
  recordAffiliatePaymentFact(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectAffiliatePaymentFactDto
  ) {
    return this.affiliateBusinessService().recordPaymentFact(projectId, user.id, body);
  }

  @Post(":projectId/affiliate-payment-facts/:factId/confirmation")
  @RequireProjectRole("project.affiliate_payment_fact.confirm")
  confirmAffiliatePaymentFact(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectAffiliateBusinessFactDto
  ) {
    return this.affiliateBusinessService().confirmPaymentFact(
      projectId,
      factId,
      user.id,
      body
    );
  }

  @Post(":projectId/affiliate-business-facts/:factId/evidence")
  @RequireProjectRole("project.affiliate_business_fact.evidence_supplement")
  supplementAffiliateBusinessEvidence(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SupplementProjectAffiliateBusinessEvidenceDto
  ) {
    return this.affiliateBusinessService().supplementEvidence(
      projectId,
      factId,
      user.id,
      body
    );
  }

  @Post(":projectId/proxy-payments")
  @RequireProjectRole("project.proxy_payment.record")
  recordProxyPayment(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectProxyPaymentDto
  ) {
    void projectId;
    void user;
    void body;
    throw new GoneException(
      "旧挂靠代付一步式写入口已停用，请使用挂靠业务持续接管的合同、结算、付款事实链"
    );
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
