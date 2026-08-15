import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ContractTaxFactsModule } from "../contract-tax-facts/contract-tax-facts.module";
import { ContractTakeoverActivationService } from "./contract-takeover-activation.service";
import { ContractTakeoverBalanceService } from "./contract-takeover-balance.service";
import { ContractTakeoverController } from "./contract-takeover.controller";
import { ContractTakeoverCorrectionService } from "./contract-takeover-correction.service";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";
import { ContractTakeoverService } from "./contract-takeover.service";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";

@Module({
  imports: [
    AuditModule,
    AuthModule,
    FileModule,
    ContractTaxFactsModule,
    OperatingLedgerModule
  ],
  controllers: [ContractTakeoverController],
  providers: [
    ContractTakeoverService,
    ContractTakeoverExcelService,
    ContractTakeoverActivationService,
    ContractTakeoverBalanceService,
    ContractTakeoverCorrectionService
  ],
  exports: [ContractTakeoverService, ContractTakeoverBalanceService]
})
export class ContractTakeoverModule {}
