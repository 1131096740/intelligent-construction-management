import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractNumberingService } from "../contract-workbench/contract-numbering.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDraftDto } from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

@Controller("contracts")
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly contractRead: ContractReadService,
    private readonly workbench: ContractWorkbenchService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  // 创建合同草稿：合同员或合同部主管从已发布模板快照初始化工作台草稿。
  @Post()
  @RequireProjectRole("contract.create")
  create(
    @Body() body: CreateContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.createDraft(body, user.id);
  }

  @Get()
  @RequirePositions(
    "chairman",
    "general_manager",
    "project_manager",
    "contract_director",
    "contract_staff",
    "budget_director",
    "budget_staff",
    "finance_director",
    "finance_staff",
    "super_admin"
  )
  async list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.contractRead.listRecent(limit, await this.projectVisibility.visibleProjectIds(user.id));
  }

  @Get("settlement-create-options")
  @RequireProjectRole("settlement.create")
  settlementCreateOptions(@Query("projectId") projectId: string) {
    return this.contractRead.listCreateOptions(projectId);
  }

  @Get("payment-create-options")
  @RequireProjectRole("payment.create")
  paymentCreateOptions(@Query("projectId") projectId: string) {
    return this.contractRead.listCreateOptions(projectId);
  }

  @Get(":contractId")
  @RequirePositions(
    "chairman",
    "general_manager",
    "project_manager",
    "contract_director",
    "contract_staff",
    "budget_director",
    "budget_staff",
    "finance_director",
    "finance_staff"
  )
  detail(@Param("contractId") contractId: string) {
    return this.contractRead.getDetail(contractId);
  }

  @Post(":contractVersionId/approval-submission")
  @RequireProjectRole("contract.submit")
  submitApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown
  ) {
    return this.contracts.submitApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/readiness")
  @RequireProjectRole("contract.submit")
  checkReadiness(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.workbench.checkReadiness(contractVersionId, user.id);
  }

  @Post(":contractVersionId/approval")
  @RequireProjectRole("contract.approve")
  reviewApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewContractApprovalDto
  ) {
    return this.contracts.reviewApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/approval-transfer")
  @RequireProjectRole("contract.approve")
  transferApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { toUserId: string }
  ) {
    return this.contracts.transferApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/approval-delegation")
  @RequireProjectRole("contract.approve")
  delegateApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { toUserId: string }
  ) {
    return this.contracts.delegateApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/approval-withdrawal")
  withdrawApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.withdrawApproval(contractVersionId, user.id);
  }

  // 超时催办：由申请人发起，督促当前节点审批人；是否超时/重复节流在 service 内判定。
  @Post(":contractVersionId/approval-reminder")
  remindApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.remindApproval(contractVersionId, user.id);
  }

  @Post(":contractVersionId/seal-approval")
  @RequireProjectRole("contract.seal")
  approveSeal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.approveSeal(contractVersionId, user.id);
  }

  @Post(":contractVersionId/archive-files")
  @RequireProjectRole("contract.archive.upload")
  uploadArchiveFile(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadContractArchiveFileDto
  ) {
    return this.contracts.uploadArchiveFile(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/archive-confirmation")
  @RequireProjectRole("contract.archive.confirm")
  confirmArchiveFile(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractArchiveDto
  ) {
    return this.contracts.confirmArchiveFile(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/pdf-generation")
  @RequireProjectRole("contract.archive.upload")
  generatePdfArchive(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { templateKey?: string; departmentScope?: string }
  ) {
    return this.contracts.generatePdfArchive(contractVersionId, user.id, body);
  }
}

@Controller("contract-number-rules")
export class ContractNumberRuleController {
  constructor(private readonly numbering: ContractNumberingService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.numbering.listActive(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.numbering.create(user.id, body);
  }

  @Patch(":ruleId")
  update(
    @Param("ruleId") ruleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown
  ) {
    return this.numbering.update(ruleId, user.id, body);
  }

  @Post(":ruleId/stop")
  stop(@Param("ruleId") ruleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.numbering.stop(ruleId, user.id);
  }
}
