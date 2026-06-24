import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { ContractTemplateController } from "./contract-template.controller";
import { ContractTemplateService } from "./contract-template.service";
import { LayoutTemplateService } from "./layout-template.service";

@Module({
  imports: [DatabaseModule, AuditModule, FileModule],
  controllers: [ContractTemplateController],
  providers: [ContractTemplateService, LayoutTemplateService],
  exports: [ContractTemplateService, LayoutTemplateService]
})
export class ContractTemplateModule {}
