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

@Module({
  imports: [AuditModule, AuthModule, FileModule, SpotProcurementAccessModule],
  controllers: [ApprovalDelegationController, ApprovalFormController],
  providers: [ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService, ProjectVisibilityService],
  exports: [ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService]
})
export class ApprovalModule {}
