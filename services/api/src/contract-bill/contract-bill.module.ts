import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ContractBillController } from "./contract-bill.controller";
import { ContractBillService } from "./contract-bill.service";

@Module({
  imports: [AuditModule],
  controllers: [ContractBillController],
  providers: [ContractBillService]
})
export class ContractBillModule {}
