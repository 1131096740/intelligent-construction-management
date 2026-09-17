import { Module } from "@nestjs/common";
import { SETTLEMENT_BASIC_ENTRY_DEFINITION } from "../settlement/settlement-business-entry-definition";
import { PAYMENT_FINANCE_ENTRY_DEFINITION } from "../payment/payment-business-entry-definition";
import { createBusinessEntryDefinitionRegistry } from "@jiangkong/shared-domain";
import { CONTRACT_BASIC_ENTRY_DEFINITION, CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION } from "../contract-workbench/contract-business-entry-definition";
import { AuditModule } from "../audit/audit.module";
import {
  BUSINESS_ENTRY_DEFINITION_REGISTRY
} from "./business-entry-definition.service";
import {
  BUSINESS_ENTRY_SNAPSHOT_STORE,
  PrismaBusinessEntrySnapshotStore
} from "./business-entry-definition.snapshot-store";
import {
  BUSINESS_ENTRY_SCENE_DEFINITIONS
} from "./business-entry-definition.scene-registry";
import {
  BUSINESS_ENTRY_TRANSACTION_REGISTRY,
  BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY
} from "./business-entry-transaction-scene-registry";
import { BusinessEntryTransactionService } from "./business-entry-transaction.service";

@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: BUSINESS_ENTRY_DEFINITION_REGISTRY,
      useValue: createBusinessEntryDefinitionRegistry([
        ...BUSINESS_ENTRY_SCENE_DEFINITIONS, CONTRACT_BASIC_ENTRY_DEFINITION, CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION, PAYMENT_FINANCE_ENTRY_DEFINITION, SETTLEMENT_BASIC_ENTRY_DEFINITION
      ])
    },
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
