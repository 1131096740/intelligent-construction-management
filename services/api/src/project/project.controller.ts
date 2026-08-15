import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { FileService } from "../file/file.service";
import {
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import { AssignProjectAffiliateDto } from "./dto/assign-project-affiliate.dto";
import { AssignProjectConstructionEnterpriseDto } from "./dto/assign-project-construction-enterprise.dto";
import { AddProjectParticipatingCompanyDto } from "./dto/add-project-participating-company.dto";
import { DeactivateProjectParticipatingCompanyDto } from "./dto/deactivate-project-participating-company.dto";
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
import { UpdateProjectOperatingProfileDto } from "./dto/update-project-operating-profile.dto";
import { ProjectAffiliateBusinessService } from "./project-affiliate-business.service";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";
import { ProjectService } from "./project.service";
import { ProjectOperatingProfileService } from "./project-operating-profile.service";

@Controller("projects")
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    @Optional()
    private readonly affiliateBusiness?: ProjectAffiliateBusinessService,
    @Optional()
    private readonly affiliateCompanyContracts?: ProjectAffiliateCompanyContractService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly operatingProfiles?: ProjectOperatingProfileService
  ) {}

  private operatingProfileService(): ProjectOperatingProfileService {
    if (!this.operatingProfiles) {
      throw new Error("Project operating profile service is not available");
    }
    return this.operatingProfiles;
  }

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

  @Get("create-capability")
  @RequirePositions("chairman", "general_manager")
  createCapability() {
    return { availableActions: ["create_project"] };
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

  @Get(":projectId/update-capability")
  @RequirePositions("chairman", "general_manager")
  updateCapability(@Param("projectId") projectId: string) {
    return { projectId, availableActions: ["update_project"] };
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

  @Get(":projectId/operating-profile")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  getOperatingProfile(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.operatingProfileService().getProfile(projectId, user.id);
  }

  @Get(":projectId/participating-company-options")
  @RequireProjectRole("project.operating_profile.manage")
  participatingCompanyOptions(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.operatingProfileService().listParticipatingCompanyOptions(projectId, user.id);
  }

  @Get(":projectId/construction-enterprise-options")
  @RequireProjectRole("project.operating_profile.manage")
  constructionEnterpriseOptions(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.operatingProfileService().listConstructionEnterpriseOptions(projectId, user.id);
  }

  @Patch(":projectId/operating-profile")
  @RequireProjectRole("project.operating_profile.manage")
  updateOperatingProfile(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProjectOperatingProfileDto
  ) {
    return this.operatingProfileService().updateProfile(projectId, user.id, body);
  }

  @Post(":projectId/construction-enterprise")
  @RequireProjectRole("project.operating_profile.manage")
  assignConstructionEnterprise(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignProjectConstructionEnterpriseDto
  ) {
    return this.projects.assignAffiliate(projectId, user.id, body);
  }

  @Post(":projectId/participating-companies")
  @RequireProjectRole("project.operating_profile.manage")
  addParticipatingCompany(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AddProjectParticipatingCompanyDto
  ) {
    return this.operatingProfileService().addParticipatingCompany(projectId, user.id, body);
  }

  @Patch(":projectId/participating-companies/:participantId/deactivation")
  @RequireProjectRole("project.operating_profile.manage")
  deactivateParticipatingCompany(
    @Param("projectId") projectId: string,
    @Param("participantId") participantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeactivateProjectParticipatingCompanyDto
  ) {
    return this.operatingProfileService().deactivateParticipatingCompany(
      projectId,
      participantId,
      user.id,
      body
    );
  }

  @Delete(":projectId/participating-companies/:participantId")
  @RequireProjectRole("project.operating_profile.manage")
  removeParticipatingCompany(
    @Param("projectId") projectId: string,
    @Param("participantId") participantId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.operatingProfileService().removeParticipatingCompany(
      projectId,
      participantId,
      user.id
    );
  }

  @Get(":projectId/financing-quotas")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  projectFinancingQuotaWorkbench(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.projects.getProjectFinancingQuotaWorkbench(projectId, user.id);
  }

  @Get(":projectId/financing-quotas/:quotaId/review-capability")
  @RequireProjectRole("project.financing_quota.approve")
  projectFinancingQuotaReviewCapability(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.projects.getProjectFinancingQuotaReviewCapability(
      projectId,
      quotaId,
      user.id
    );
  }

  @Get(":projectId/financing-quotas/:quotaId/termination-capability")
  @RequireProjectRole("project.financing_quota.terminate")
  projectFinancingQuotaTerminationCapability(
    @Param("projectId") projectId: string,
    @Param("quotaId") quotaId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.projects.getProjectFinancingQuotaTerminationCapability(
      projectId,
      quotaId,
      user.id
    );
  }

  @Get(":projectId/affiliate-business-facts")
  @RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
  affiliateBusinessFacts(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.affiliateBusinessService().listFacts(projectId, user.id);
  }

  @Get(":projectId/affiliate-business-facts/record-capability")
  affiliateBusinessRecordCapability(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("businessType") businessType?: string,
    @Query("entryKind") entryKind?: string,
    @Query("adjustsFactId") adjustsFactId?: string
  ) {
    return this.affiliateBusinessService().getRecordCapability(
      projectId,
      user.id,
      businessType,
      entryKind,
      adjustsFactId
    );
  }

  @Get(":projectId/affiliate-business-facts/:factId/capability")
  affiliateBusinessFactCapability(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("businessType") businessType?: string
  ) {
    return this.affiliateBusinessService().getFactCapability(
      projectId,
      factId,
      user.id,
      businessType
    );
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

  @Post(":projectId/affiliate-company-contracts/file-uploads")
  @RequireProjectRole("project.affiliate_company_contract.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadAffiliateCompanyContractPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "线下合同登记文件");
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
  @RequireProjectRole("project.operating_profile.manage")
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

  @Get(":projectId/upstream-fund-facts/record-capability")
  @RequireProjectRole("project.upstream_fund_fact.record")
  upstreamFundRecordCapability(@Param("projectId") projectId: string) {
    return { projectId, availableActions: ["record_upstream_fund_fact"] };
  }

  @Post(":projectId/upstream-fund-facts/file-uploads")
  @RequireProjectRole("project.upstream_fund_fact.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadUpstreamFundPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "上游资金依据");
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

  @Get(":projectId/upstream-fund-facts/:fundFactId/confirmation-capability")
  @RequireProjectRole("project.upstream_fund_fact.confirm")
  upstreamFundConfirmationCapability(
    @Param("projectId") projectId: string,
    @Param("fundFactId") fundFactId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.projects.getUpstreamFundFactConfirmationCapability(
      projectId,
      fundFactId,
      user.id
    );
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

  @Post(":projectId/affiliate-contract-facts/file-uploads")
  @RequireProjectRole("project.affiliate_contract_fact.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadAffiliateContractPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "挂靠合同依据");
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

  @Post(":projectId/affiliate-settlement-facts/file-uploads")
  @RequireProjectRole("project.affiliate_settlement_fact.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadAffiliateSettlementPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "挂靠结算依据");
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

  @Post(":projectId/affiliate-payment-facts/file-uploads")
  @RequireProjectRole("project.affiliate_payment_fact.record")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadAffiliatePaymentPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "挂靠付款依据");
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

  @Post(":projectId/affiliate-business-facts/:factId/evidence-file-uploads")
  @RequireProjectRole("project.affiliate_business_fact.evidence_supplement")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  async uploadAffiliateBusinessEvidencePrivateFile(
    @Param("projectId") projectId: string,
    @Param("factId") factId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("businessType") businessType?: string,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    await this.affiliateBusinessService().assertEvidenceUploadAllowed(
      projectId,
      factId,
      user.id,
      businessType
    );
    return this.uploadPrivateFile(file, user, idempotencyKey, "挂靠业务补充依据");
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

  private uploadPrivateFile(
    file: MemoryUploadedFile | undefined,
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    label: string
  ) {
    if (!file) throw new BadRequestException(`请选择要上传的${label}文件`);
    if (!this.files) {
      throw new BadRequestException(`${label}文件服务暂不可用，请稍后重试`);
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
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

  @Post(":projectId/financing-quotas/file-uploads")
  @RequireProjectRole("project.financing_quota.request")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadProjectFinancingQuotaPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    return this.uploadPrivateFile(file, user, idempotencyKey, "项目垫资额度申请依据");
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
