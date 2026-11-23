import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ActualPurchaseBatchController } from "./actual-purchase-batch.controller";
import { ActualPurchaseBatchService } from "./actual-purchase-batch.service";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OperatingLedgerModule],
  controllers: [ActualPurchaseBatchController],
  providers: [ActualPurchaseBatchService],
  exports: [ActualPurchaseBatchService]
})
export class ActualPurchaseBatchModule {}
