import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { ContractBillController } from "./contract-bill.controller";
import { ContractBillExcelController } from "./contract-bill-excel.controller";
import { ContractBillExcelService } from "./contract-bill-excel.service";
import { ContractBillService } from "./contract-bill.service";
import { ContractBillLineageService } from "./contract-bill-lineage.service";
import { ContractBillTransitionController } from "./contract-bill-transition.controller";
import { ContractBillTransitionService } from "./contract-bill-transition.service";

@Module({
  imports: [AuditModule, FileModule],
  controllers: [ContractBillController, ContractBillExcelController, ContractBillTransitionController],
  providers: [ContractBillService, ContractBillExcelService, ContractBillLineageService, ContractBillTransitionService],
  exports: [ContractBillLineageService]
})
export class ContractBillModule {}
