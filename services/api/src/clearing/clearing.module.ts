import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ClearingController } from "./clearing.controller";
import { ClearingService } from "./clearing.service";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OperatingLedgerModule],
  controllers: [ClearingController],
  providers: [ClearingService],
  exports: [ClearingService]
})
export class ClearingModule {}
