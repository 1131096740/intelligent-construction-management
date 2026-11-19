import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ProjectController } from "../project/project.controller";
import { ProjectService } from "../project/project.service";
import { ProjectUpstreamFundBusinessEntryService } from "../project/project-upstream-fund-business-entry.service";
import { DatabaseModule } from "./database.module";
import { Task16RegisteredApplicationModule } from "./task16-registered-application.module";

/** Fixed isolated revocation app: retain the original controller and service. */
@Module({
  imports: [Task16RegisteredApplicationModule, DatabaseModule, AuditModule, AuthModule, FileModule, OperatingLedgerModule, ProjectFundingModule],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectUpstreamFundBusinessEntryService]
})
export class Task16RevocationApplicationModule {}
