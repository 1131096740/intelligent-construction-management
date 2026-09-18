import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingProjectionModule } from "../operating-projection/operating-projection.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectCloseProfitController } from "./project-close-profit.controller";
import { ProjectCloseProfitService } from "./project-close-profit.service";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    OperatingProjectionModule,
    OperatingLedgerModule
  ],
  controllers: [ProjectCloseProfitController],
  providers: [ProjectCloseProfitService],
  exports: [ProjectCloseProfitService]
})
export class ProjectCloseProfitModule {}
