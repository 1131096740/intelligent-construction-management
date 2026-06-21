import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

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
}
