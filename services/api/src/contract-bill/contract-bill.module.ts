import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { ContractBillController } from "./contract-bill.controller";
import { ContractBillExcelController } from "./contract-bill-excel.controller";
import { ContractBillExcelService } from "./contract-bill-excel.service";
import { ContractBillService } from "./contract-bill.service";
import { ContractBillLineageService } from "./contract-bill-lineage.service";

@Module({
  imports: [AuditModule, FileModule],
  controllers: [ContractBillController, ContractBillExcelController],
  providers: [ContractBillService, ContractBillExcelService, ContractBillLineageService],
  exports: [ContractBillLineageService]
})
export class ContractBillModule {}
