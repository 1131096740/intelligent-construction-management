import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractWorkbenchModule } from "../contract-workbench/contract-workbench.module";
import { FileModule } from "../file/file.module";
import { MeModule } from "../me/me.module";
import {
  ContractController,
  ContractNumberRuleController
} from "./contract.controller";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";
import { ContractApprovalRouteService } from "./contract-approval-route.service";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractSealService } from "./contract-seal.service";
import { ContractVersionActivationService } from "./contract-version-activation.service";

@Module({
  imports: [
    ApprovalModule,
    AuditModule,
    AuthModule,
    ContractBillModule,
    ContractWorkbenchModule,
    FileModule,
    MeModule
  ],
  controllers: [ContractController, ContractNumberRuleController],
  providers: [
    ContractService,
    ContractStatusService,
    ContractReadService,
    ContractApprovalRouteService,
    ContractFormalFileService,
    ContractAuthorizationService,
    ContractSealService,
    ContractVersionActivationService
  ],
  exports: [
    ContractService,
    ContractStatusService,
    ContractReadService,
    ContractFormalFileService,
    ContractAuthorizationService,
    ContractSealService,
    ContractVersionActivationService
  ]
})
export class ContractModule {}
