import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { DatabaseModule } from "../database/database.module";
import { ContractDutyNotificationService } from "./contract-duty-notification.service";

@Module({
  imports: [ApprovalModule, DatabaseModule],
  providers: [ContractDutyNotificationService],
  exports: [ContractDutyNotificationService]
})
export class ContractDutyNotificationModule {}
