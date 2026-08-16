import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectModule } from "../project/project.module";
import {
  BUSINESS_ENTRY_DEFINITION_REGISTRY,
  BusinessEntryDefinitionService
} from "./business-entry-definition.service";
import { BusinessEntryDefinitionController } from "./business-entry-definition.controller";
import {
  BUSINESS_ENTRY_SNAPSHOT_STORE,
  PrismaBusinessEntrySnapshotStore
} from "./business-entry-definition.snapshot-store";
import { BUSINESS_ENTRY_DEFINITION_REGISTRY as registry } from "./business-entry-definition.scene-registry";
import { BusinessEntryExcelService } from "./business-entry-excel.service";

@Module({
  imports: [AuthModule, AuditModule, ProjectModule],
  controllers: [BusinessEntryDefinitionController],
  providers: [
    { provide: BUSINESS_ENTRY_DEFINITION_REGISTRY, useValue: registry },
    { provide: BUSINESS_ENTRY_SNAPSHOT_STORE, useClass: PrismaBusinessEntrySnapshotStore },
    BusinessEntryDefinitionService,
    BusinessEntryExcelService
  ],
  exports: [BusinessEntryDefinitionService, BusinessEntryExcelService]
})
export class BusinessEntryDefinitionModule {}
