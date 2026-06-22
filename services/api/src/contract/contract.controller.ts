import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
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
