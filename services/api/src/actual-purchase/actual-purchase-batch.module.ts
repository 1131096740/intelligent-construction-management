import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ActualPurchaseBatchController } from "./actual-purchase-batch.controller";
import { ActualPurchaseBatchNotificationService } from "./actual-purchase-batch-notification.service";
import { ActualPurchaseBatchService } from "./actual-purchase-batch.service";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OperatingLedgerModule, ApprovalModule],
  controllers: [ActualPurchaseBatchController],
  providers: [ActualPurchaseBatchService, ActualPurchaseBatchNotificationService],
  exports: [ActualPurchaseBatchService]
})
export class ActualPurchaseBatchModule {}
