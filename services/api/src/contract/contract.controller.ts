import { Body, Controller, Post } from "@nestjs/common";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

@Controller("contracts")
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Post()
  create(@Body() body: CreateContractDto) {
    return this.contracts.createDraft(body);
  }
}
