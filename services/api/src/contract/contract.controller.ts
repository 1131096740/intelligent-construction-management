import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

@Controller("contracts")
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly contractRead: ContractReadService
  ) {}

  // 创建合同草稿：策略表未定义 create 动作，草稿在进入受守的审批步骤前无业务效力，仅要求登录。
  @Post()
  create(@Body() body: CreateContractDto) {
    return this.contracts.createDraft(body);
  }

  @Get(":contractId")
  detail(@Param("contractId") contractId: string) {
    return this.contractRead.getDetail(contractId);
  }

  @Post(":contractVersionId/approval-submission")
  @RequireProjectRole("contract.submit")
  submitApproval(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.submitApproval(contractVersionId, user.id);
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
}
