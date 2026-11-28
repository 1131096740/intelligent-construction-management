import { ApprovalModule } from "../approval/approval.module";
import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { OperatingProjectionModule } from "../operating-projection/operating-projection.module";
import { ProjectAffiliateBusinessService } from "./project-affiliate-business.service";
import { ProjectConstructionPaymentCorrectionService } from "./project-construction-payment-correction.service";
import { ProjectConstructionEnterpriseDeductionService } from "./project-construction-enterprise-deduction.service";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { ProjectOperatingProfileService } from "./project-operating-profile.service";
import { ProjectUpstreamFundBusinessEntryService } from "./project-upstream-fund-business-entry.service";

@Module({
  imports: [
    ApprovalModule,
    AuditModule,
    AuthModule,
    FileModule,
    OperatingLedgerModule,
    OperatingProjectionModule,
    ProjectFundingModule
  ],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    ProjectAffiliateBusinessService,
    ProjectConstructionPaymentCorrectionService,
    ProjectConstructionEnterpriseDeductionService,
    ProjectAffiliateCompanyContractService,
    ProjectOperatingProfileService,
    ProjectUpstreamFundBusinessEntryService
  ],
  exports: [ProjectOperatingProfileService, ProjectService]
})
export class ProjectModule {}
