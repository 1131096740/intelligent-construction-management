import { ApprovalRuleAssignmentsController } from "./approval-rule-assignments.controller";
import { ApprovalRuleAssignmentsService } from "./approval-rule-assignments.service";
import {SpotProcurementApprovalNotificationService} from "../spot-procurement/spot-procurement-approval-notification.service";
import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { FileModule } from "../file/file.module";
import { SpotProcurementAccessModule } from "../spot-procurement/spot-procurement-access.module";
import { ApprovalDelegationController } from "./approval-delegation.controller";
import { ApprovalDelegationService } from "./approval-delegation.service";
import { ApprovalFormController } from "./approval-form.controller";
import { ApprovalFormService } from "./approval-form.service";
import { ApprovalFreezeService } from "./approval-freeze.service";
import { ApprovalProgressController } from "./approval-progress.controller";
import { ApprovalProgressService } from "./approval-progress.service";
import { IndependentApprovalProgressService } from "./independent-approval-progress.service";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { ApprovalSmsService } from "./approval-sms.service";

@Module({
  imports: [AuditModule, AuthModule, FileModule, SpotProcurementAccessModule],
  controllers: [ApprovalRuleAssignmentsController, ApprovalDelegationController, ApprovalFormController, ApprovalProgressController],
  providers: [ApprovalRuleAssignmentsService, SpotProcurementApprovalNotificationService, ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService, ProjectVisibilityService, ApprovalProgressService, ApprovalSmsService, IndependentApprovalProgressService, SpotProcurementPilotService],
  exports: [SpotProcurementApprovalNotificationService, ApprovalSmsService, ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService, ApprovalProgressService]
})
export class ApprovalModule {}
