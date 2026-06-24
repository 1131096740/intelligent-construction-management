import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { ApprovalDelegationController } from "./approval-delegation.controller";
import { ApprovalDelegationService } from "./approval-delegation.service";
import { ApprovalFormController } from "./approval-form.controller";
import { ApprovalFormService } from "./approval-form.service";
import { ApprovalFreezeService } from "./approval-freeze.service";

@Module({
  imports: [AuditModule, FileModule],
  controllers: [ApprovalDelegationController, ApprovalFormController],
  providers: [ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService],
  exports: [ApprovalFreezeService, ApprovalDelegationService, ApprovalFormService]
})
export class ApprovalModule {}
