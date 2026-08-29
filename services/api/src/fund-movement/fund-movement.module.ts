import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { FundMovementController } from "./fund-movement.controller";
import { FundMovementService } from "./fund-movement.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, OperatingLedgerModule, ProjectFundingModule],
  controllers: [FundMovementController],
  providers: [FundMovementService],
  exports: [FundMovementService]
})
export class FundMovementModule {}
