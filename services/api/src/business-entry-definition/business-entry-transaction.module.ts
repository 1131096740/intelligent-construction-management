import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import {
  BUSINESS_ENTRY_DEFINITION_REGISTRY
} from "./business-entry-definition.service";
import {
  BUSINESS_ENTRY_SNAPSHOT_STORE,
  PrismaBusinessEntrySnapshotStore
} from "./business-entry-definition.snapshot-store";
import {
  BUSINESS_ENTRY_DEFINITION_REGISTRY as definitions
} from "./business-entry-definition.scene-registry";
import {
  BUSINESS_ENTRY_TRANSACTION_REGISTRY,
  BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY
} from "./business-entry-transaction-scene-registry";
import { BusinessEntryTransactionService } from "./business-entry-transaction.service";

@Module({
  imports: [AuditModule],
  providers: [
    { provide: BUSINESS_ENTRY_DEFINITION_REGISTRY, useValue: definitions },
    {
      provide: BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY,
      useValue: BUSINESS_ENTRY_TRANSACTION_REGISTRY
    },
    { provide: BUSINESS_ENTRY_SNAPSHOT_STORE, useClass: PrismaBusinessEntrySnapshotStore },
    BusinessEntryTransactionService
  ],
  exports: [BusinessEntryTransactionService]
})
export class BusinessEntryTransactionModule {}
