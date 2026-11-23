import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { HistoryExpenseController } from "./history-expense.controller";
import { HistoryExpenseService } from "./history-expense.service";

@Module({
  imports: [AuthModule, AuditModule, OperatingLedgerModule],
  controllers: [HistoryExpenseController],
  providers: [HistoryExpenseService],
  exports: [HistoryExpenseService]
})
export class HistoryExpenseModule {}
