import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { WageStatementController } from "./wage-statement.controller";
import { WageStatementService } from "./wage-statement.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, OperatingLedgerModule],
  controllers: [WageStatementController],
  providers: [WageStatementService],
  exports: [WageStatementService]
})
export class WageStatementModule {}
