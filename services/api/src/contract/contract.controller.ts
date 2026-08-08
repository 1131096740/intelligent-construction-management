import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  Optional,
  InternalServerErrorException
} from "@nestjs/common";
import {
  CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS,
  CONTRACT_WORKBENCH_VIEWS,
  DRAFT_LEDGER_VIEWS,
  type ContractWorkbenchView,
  type DraftLedgerView
} from "@jiangkong/shared-domain";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { XLSX_MIME } from "../core-flow/ledger-excel";
import { ContractNumberingService } from "../contract-workbench/contract-numbering.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { PristineDraftDeletionService } from "../contract-workbench/pristine-draft-deletion.service";
import {
  ContractCutoverLegacyWrite,
  ContractCutoverSurface
} from "../contract-cutover/contract-cutover.decorators";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { AssignContractApprovalDto } from "./dto/assign-contract-approval.dto";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import {
  CreateContractNumberRuleDto,
  UpdateContractNumberRuleDto
} from "./dto/contract-number-rule.dto";
import { CreateContractDraftDto } from "./dto/create-contract.dto";
import { GenerateContractPdfArchiveDto } from "./dto/generate-contract-pdf-archive.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { WithdrawContractApprovalDto } from "./dto/withdraw-contract-approval.dto";
import { SubmitContractApprovalDto } from "./dto/submit-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";
import { CreateContractChangeDraftDto } from "./dto/create-contract-change-draft.dto";
import { AbandonContractDraftDto } from "./dto/abandon-contract-draft.dto";
import { CopyContractDraftDto } from "./dto/copy-contract-draft.dto";
import {
  ConfirmCounterpartySignedFileDto,
  UploadContractFormalFileDto,
  UploadCounterpartySignedFileDto
} from "./dto/contract-formal-file.dto";
import { SetContractAuthorizationDto } from "./dto/contract-authorization.dto";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractSealService } from "./contract-seal.service";
import {
  ApproveContractSealDto,
  CompleteContractSealDto,
  ConfirmMutuallySignedContractDto,
  InvalidateContractSigningDto,
  ReturnContractFormalFileDto,
  UploadMutuallySignedContractDto
} from "./dto/contract-seal.dto";

@Controller("contracts")
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly contractRead: ContractReadService,
    private readonly workbench: ContractWorkbenchService,
    private readonly projectVisibility: ProjectVisibilityService,
    @Optional() private readonly formalFiles?: ContractFormalFileService,
    @Optional() private readonly authorizations?: ContractAuthorizationService,
    @Optional() private readonly seals?: ContractSealService,
    @Optional() private readonly pristineDeletion?: PristineDraftDeletionService
  ) {}

  // 创建合同草稿：合同员或合同部主管从已发布模板快照初始化工作台草稿。
  @Post()
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  create(
    @Body() body: CreateContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.createDraft(body, user.id);
  }

  @Get("create-capability")
  @RequireProjectRole("contract.create")
  createCapability(@Query("projectId") projectId: string) {
    return {
      projectId,
      availableActions: ["create_contract_draft"]
    };
  }

  @Post(":contractVersionId/change-drafts")
  @ContractCutoverSurface()
  // 合同变更草稿：合同员或合同部主管作为合同经办人发起。
  @RequireProjectRole("contract.create")
  createChangeDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: CreateContractChangeDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.createChangeDraft(contractVersionId, body, user.id);
  }

  @Post(":contractVersionId/copies")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  copyAbandonedDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: CopyContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.copyAbandonedDraft(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/abandonment")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.draft.delete")
  abandonDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: AbandonContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (body.action === "delete_pristine_draft") {
      if (!this.pristineDeletion) {
        throw new InternalServerErrorException("合同草稿删除服务不可用");
      }
      return this.pristineDeletion.deletePristineDraft(contractVersionId, user.id, {
        expectedRevision: body.expectedRevision,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.currentPassword ? { currentPassword: body.currentPassword } : {})
      });
    }
    return this.contracts.abandonDraft(contractVersionId, user.id, body);
  }

  @Get(":contractVersionId/change-eligibility")
  @RequireProjectRole("contract.create")
  changeEligibility(@Param("contractVersionId") contractVersionId: string) {
    return this.contracts.changeEligibility(contractVersionId);
  }

  @Get()
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.contractRead.listRecent(
      limit,
      await this.projectVisibility.visibleProjectIds(user.id),
      { actorUserId: user.id }
    );
  }

  @Get("lifecycle-ledger")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async lifecycleLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") rawView?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const view = DRAFT_LEDGER_VIEWS.includes(rawView as DraftLedgerView)
      ? rawView as DraftLedgerView
      : "formal_ledger";
    return this.contractRead.lifecycleLedger(
      view,
      page,
      pageSize,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }

  @Get("workbench")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async workbenchLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") rawView?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const view = CONTRACT_WORKBENCH_VIEWS.includes(rawView as ContractWorkbenchView)
      ? rawView as ContractWorkbenchView
      : "all";
    return this.contractRead.workbenchLedger(
      view,
      page,
      pageSize,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }

  @Get("ledger-export")
  @RequirePositions(...CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS)
  async exportLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.contractRead.exportLedger(
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
    response.set({
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length)
    });
    return new StreamableFile(result.buffer);
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
  async detail(
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("versionId") versionId?: string
  ) {
    return this.contractRead.getDetail(
      contractId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id,
      versionId
    );
  }

  @Post(":contractVersionId/approval-submission")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.submit")
  submitApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitContractApprovalDto
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

  @Post(":contractVersionId/formal-files/approval")
  @ContractCutoverLegacyWrite()
  @RequireProjectRole("contract.submit")
  uploadFormalApprovalFile(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadContractFormalFileDto
  ) {
    if (!this.formalFiles) throw new InternalServerErrorException("合同正式文件服务暂不可用，请稍后重试");
    return this.formalFiles.uploadApprovalVersion(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/authorizations")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.submit")
  setAuthorization(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetContractAuthorizationDto
  ) {
    if (!this.authorizations) throw new InternalServerErrorException("合同授权服务暂不可用，请稍后重试");
    return this.authorizations.setSide(contractVersionId, user.id, body);
  }

  @Get(":contractVersionId/authorizations/readiness")
  @RequireProjectRole("contract.submit")
  authorizationReadiness(@Param("contractVersionId") contractVersionId: string) {
    if (!this.authorizations) throw new InternalServerErrorException("合同授权服务暂不可用，请稍后重试");
    return this.authorizations.ready(contractVersionId);
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
    @Body() body: AssignContractApprovalDto
  ) {
    return this.contracts.transferApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/approval-delegation")
  @RequireProjectRole("contract.approve")
  delegateApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignContractApprovalDto
  ) {
    return this.contracts.delegateApproval(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/approval-withdrawal")
  withdrawApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawContractApprovalDto
  ) {
    return this.contracts.withdrawApproval(contractVersionId, user.id, body);
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

  @Post(":contractVersionId/seal/approve")
  @RequireProjectRole("contract.seal")
  approveGovernedSeal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApproveContractSealDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.approve(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/seal/complete")
  completeGovernedSeal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CompleteContractSealDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.complete(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/formal-files/counterparty")
  @RequireProjectRole("contract.submit")
  uploadCounterpartySignedFiles(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadCounterpartySignedFileDto
  ) {
    if (!this.formalFiles) throw new InternalServerErrorException("合同正式文件服务暂不可用，请稍后重试");
    return this.formalFiles.uploadCounterpartySigned(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/formal-files/counterparty/confirmation")
  @RequireProjectRole("contract.submit")
  confirmCounterpartySignedFiles(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmCounterpartySignedFileDto
  ) {
    if (!this.formalFiles) throw new InternalServerErrorException("合同正式文件服务暂不可用，请稍后重试");
    return this.formalFiles.confirmCounterpartySigned(contractVersionId, user.id, body);
  }

  @Get(":contractVersionId/formal-files/counterparty")
  @RequireProjectRole("contract.submit")
  listCounterpartySignedFiles(
    @Param("contractVersionId") contractVersionId: string
  ) {
    if (!this.formalFiles) throw new InternalServerErrorException("合同正式文件服务暂不可用，请稍后重试");
    return this.formalFiles.listCounterpartySigned(contractVersionId);
  }

  @Post(":contractVersionId/formal-files/final")
  @RequireProjectRole("contract.archive.final.upload")
  uploadMutuallySignedFinal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadMutuallySignedContractDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.uploadFinal(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/formal-files/final/return")
  @RequireProjectRole("contract.archive.confirm")
  returnMutuallySignedFinal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReturnContractFormalFileDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.returnForCorrection(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/formal-files/final/confirmation")
  @RequireProjectRole("contract.archive.confirm")
  confirmMutuallySignedFinal(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmMutuallySignedContractDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.confirmArchive(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/signing/material-change")
  invalidateSigningForMaterialChange(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InvalidateContractSigningDto
  ) {
    if (!this.seals) throw new InternalServerErrorException("合同用章任务服务暂不可用，请稍后重试");
    return this.seals.invalidateForMaterialChange(contractVersionId, user.id, body);
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
    @Body() body: GenerateContractPdfArchiveDto
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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateContractNumberRuleDto) {
    return this.numbering.create(user.id, body);
  }

  @Patch(":ruleId")
  update(
    @Param("ruleId") ruleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateContractNumberRuleDto
  ) {
    return this.numbering.update(ruleId, user.id, body);
  }

  @Post(":ruleId/stop")
  stop(@Param("ruleId") ruleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.numbering.stop(ruleId, user.id);
  }
}
