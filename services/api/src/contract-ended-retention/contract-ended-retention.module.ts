import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ContractEndedApplicationRetentionController } from "./contract-ended-retention.controller";
import { ContractEndedApplicationRetentionService } from "./contract-ended-retention.service";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule],
  controllers: [ContractEndedApplicationRetentionController],
  providers: [ContractEndedApplicationRetentionService]
})
export class ContractEndedApplicationRetentionModule {}
