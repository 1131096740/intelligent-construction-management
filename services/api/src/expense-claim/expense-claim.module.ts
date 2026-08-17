import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ExpenseClaimController } from "./expense-claim.controller";
import { ExpenseClaimService } from "./expense-claim.service";

@Module({
  imports: [
    ApprovalModule,
    AuditModule,
    AuthModule,
    BusinessNumberModule,
    FileModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [ExpenseClaimController],
  providers: [ExpenseClaimService]
})
export class ExpenseClaimModule {}
