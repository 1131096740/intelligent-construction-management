import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ContractTaxFactsModule } from "../contract-tax-facts/contract-tax-facts.module";
import { ContractTakeoverActivationService } from "./contract-takeover-activation.service";
import { ContractTakeoverController } from "./contract-takeover.controller";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";
import { ContractTakeoverService } from "./contract-takeover.service";

@Module({
  imports: [AuditModule, AuthModule, FileModule, ContractTaxFactsModule],
  controllers: [ContractTakeoverController],
  providers: [
    ContractTakeoverService,
    ContractTakeoverExcelService,
    ContractTakeoverActivationService
  ],
  exports: [ContractTakeoverService]
})
export class ContractTakeoverModule {}
