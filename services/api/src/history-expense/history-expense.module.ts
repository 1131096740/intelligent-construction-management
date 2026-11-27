import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CompanyEntityModule } from "../company-entity/company-entity.module";
import { CompanyHistoryExpenseController } from "./company-history-expense.controller";
import { CompanyHistoryExpenseService } from "./company-history-expense.service";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { HistoryExpenseController } from "./history-expense.controller";
import { HistoryExpenseService } from "./history-expense.service";

@Module({
  imports: [AuthModule, AuditModule, CompanyEntityModule, OperatingLedgerModule],
  controllers: [HistoryExpenseController, CompanyHistoryExpenseController],
  providers: [HistoryExpenseService, CompanyHistoryExpenseService],
  exports: [HistoryExpenseService]
})
export class HistoryExpenseModule {}
