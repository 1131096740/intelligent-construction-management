import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { CompanyEntityAccess } from "./company-entity-access";
import { CompanyEntityController } from "./company-entity.controller";
import { CompanyEntityService } from "./company-entity.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [CompanyEntityController],
  providers: [CompanyEntityAccess, CompanyEntityService],
  exports: [CompanyEntityService, CompanyEntityAccess]
})
export class CompanyEntityModule {}
