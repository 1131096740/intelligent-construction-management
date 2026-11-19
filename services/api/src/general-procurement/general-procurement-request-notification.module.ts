import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { GeneralProcurementRequestNotificationService } from "./general-procurement-request-notification.service";
@Module({ imports: [AuthModule], providers: [GeneralProcurementRequestNotificationService, ApprovalSmsService], exports: [GeneralProcurementRequestNotificationService] })
export class GeneralProcurementRequestNotificationModule {}
