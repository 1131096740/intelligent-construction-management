import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { NecessaryExpenseReserveController } from "./necessary-expense-reserve.controller";
import { NecessaryExpenseReserveService } from "./necessary-expense-reserve.service";

@Module({
  imports: [DatabaseModule, AuditModule, OperatingLedgerModule],
  controllers: [NecessaryExpenseReserveController],
  providers: [NecessaryExpenseReserveService],
  exports: [NecessaryExpenseReserveService]
})
export class NecessaryExpenseReserveModule {}
