import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ClearingController } from "./clearing.controller";
import { ClearingService } from "./clearing.service";
import { AffiliateClearingAuthorityController } from "./affiliate-clearing-authority.controller";
import { AffiliateClearingAuthorityService } from "./affiliate-clearing-authority.service";
import { AffiliateClearingSelectionRefService } from "./affiliate-clearing-selection-ref.service";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OperatingLedgerModule],
  controllers: [ClearingController, AffiliateClearingAuthorityController],
  providers: [ClearingService, AffiliateClearingAuthorityService, AffiliateClearingSelectionRefService],
  exports: [ClearingService]
})
export class ClearingModule {}
