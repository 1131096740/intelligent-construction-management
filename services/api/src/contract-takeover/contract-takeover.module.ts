import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ContractTakeoverController } from "./contract-takeover.controller";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";
import { ContractTakeoverService } from "./contract-takeover.service";

@Module({
  imports: [AuditModule, AuthModule, FileModule],
  controllers: [ContractTakeoverController],
  providers: [ContractTakeoverService, ContractTakeoverExcelService],
  exports: [ContractTakeoverService]
})
export class ContractTakeoverModule {}
