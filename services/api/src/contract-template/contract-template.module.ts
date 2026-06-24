import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { ContractTemplateController } from "./contract-template.controller";
import { ContractTemplateService } from "./contract-template.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [ContractTemplateController],
  providers: [ContractTemplateService],
  exports: [ContractTemplateService]
})
export class ContractTemplateModule {}
