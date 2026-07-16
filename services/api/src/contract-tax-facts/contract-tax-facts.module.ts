import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { ContractTaxFactsService } from "./contract-tax-facts.service";

@Module({
  imports: [AuditModule, FileModule],
  providers: [ContractTaxFactsService],
  exports: [ContractTaxFactsService]
})
export class ContractTaxFactsModule {}
