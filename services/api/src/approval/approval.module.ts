import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApprovalDelegationController } from "./approval-delegation.controller";
import { ApprovalDelegationService } from "./approval-delegation.service";
import { ApprovalFreezeService } from "./approval-freeze.service";

@Module({
  imports: [AuditModule],
  controllers: [ApprovalDelegationController],
  providers: [ApprovalFreezeService, ApprovalDelegationService],
  exports: [ApprovalFreezeService, ApprovalDelegationService]
})
export class ApprovalModule {}
