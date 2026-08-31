import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { FundExecutionCanonicalAdapterService } from "./fund-execution-canonical-adapter.service";
import { FundExecutionController } from "./fund-execution.controller";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "./fund-execution-selection-ref.service";
import { FundExecutionService } from "./fund-execution.service";
import { PaymentExecutionSharedAllocationService } from "./payment-execution-shared-allocation.service";
import { VerifiedBankTransactionObservationService } from "./verified-bank-transaction-observation.service";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuditModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [FundExecutionController],
  providers: [
    FundExecutionService,
    FundExecutionSelectionOptionsService,
    FundExecutionSelectionRefService,
    FundExecutionCanonicalAdapterService,
    PaymentExecutionSharedAllocationService,
    VerifiedBankTransactionObservationService
  ],
  exports: [
    FundExecutionService,
    FundExecutionSelectionOptionsService,
    PaymentExecutionSharedAllocationService,
    VerifiedBankTransactionObservationService
  ]
})
export class FundExecutionModule {}
