import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ClearingModule } from "../clearing/clearing.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundDisputeController } from "./project-fund-dispute.controller";
import { ProjectFundDisputeService } from "./project-fund-dispute.service";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    OperatingLedgerModule,
    ClearingModule,
    FileModule
  ],
  controllers: [ProjectFundDisputeController],
  providers: [ProjectFundDisputeService],
  exports: [ProjectFundDisputeService]
})
export class ProjectFundDisputeModule {}
