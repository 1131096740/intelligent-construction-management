import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectAffiliateBusinessService } from "./project-affiliate-business.service";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { ProjectOperatingProfileService } from "./project-operating-profile.service";

@Module({
  imports: [
    AuditModule,
    AuthModule,
    FileModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    ProjectAffiliateBusinessService,
    ProjectAffiliateCompanyContractService,
    ProjectOperatingProfileService
  ],
  exports: [ProjectOperatingProfileService]
})
export class ProjectModule {}
