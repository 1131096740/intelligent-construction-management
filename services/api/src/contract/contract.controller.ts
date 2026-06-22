import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ApproveContractSealDto } from "./dto/approve-contract-seal.dto";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { SubmitContractApprovalDto } from "./dto/submit-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

@Controller("contracts")
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly contractRead: ContractReadService
  ) {}

  @Post()
  create(@Body() body: CreateContractDto) {
    return this.contracts.createDraft(body);
  }

  @Get(":contractId")
  detail(@Param("contractId") contractId: string) {
    return this.contractRead.getDetail(contractId);
  }

  @Post(":contractVersionId/approval-submission")
  submitApproval(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: SubmitContractApprovalDto
  ) {
    return this.contracts.submitApproval(contractVersionId, body);
  }

  @Post(":contractVersionId/approval")
  reviewApproval(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: ReviewContractApprovalDto
  ) {
    return this.contracts.reviewApproval(contractVersionId, body);
  }

  @Post(":contractVersionId/seal-approval")
  approveSeal(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: ApproveContractSealDto
  ) {
    return this.contracts.approveSeal(contractVersionId, body);
  }

  @Post(":contractVersionId/archive-files")
  uploadArchiveFile(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: UploadContractArchiveFileDto
  ) {
    return this.contracts.uploadArchiveFile(contractVersionId, body);
  }

  @Post(":contractVersionId/archive-confirmation")
  confirmArchiveFile(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: ConfirmContractArchiveDto
  ) {
    return this.contracts.confirmArchiveFile(contractVersionId, body);
  }
}
