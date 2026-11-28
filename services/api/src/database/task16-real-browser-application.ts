import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module";
import { ContractRelationshipLedgerModule } from "../contract-ledger/contract-relationship-ledger.module";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";

/** Isolated test composition; the caller must install the narrow ingress fence. */
@Module({imports:[Task16SharedPaymentApplicationModule,ProjectModule,ContractRelationshipLedgerModule]})
export class Task16RealBrowserModule {}
