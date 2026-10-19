import {ContractBankVerificationController} from "./contract-bank-verification.controller";
import {ContractBankVerificationService} from "./contract-bank-verification.service";
import { UpwardReceiptMatchService } from "./upward-receipt-match.service";
import { UpwardReceiptMatchController } from "./upward-receipt-match.controller";
import { ContractClassificationPreflightService } from "./contract-classification-preflight.service";
import { UpwardContractAmountService } from "./upward-contract-amount.service";
import { UpwardContractAmountController } from "./upward-contract-amount.controller";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ContractProxyExecutionController } from "./contract-proxy-execution.controller";
import { ContractProxyExecutionService } from "./contract-proxy-execution.service";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ContractEconomicReviewController } from "./contract-economic-review.controller";
import { ContractEconomicReviewService } from "./contract-economic-review.service";
import { AuditModule } from "../audit/audit.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContractRelationshipLedgerService } from "./contract-relationship-ledger.service";
import { ContractRelationshipLedgerController } from "./contract-relationship-ledger.controller";
@Module({ imports: [ProjectFundingModule, AuthModule, AuditModule, OperatingLedgerModule], controllers: [ContractBankVerificationController,UpwardReceiptMatchController,UpwardContractAmountController, ContractProxyExecutionController, ContractRelationshipLedgerController, ContractEconomicReviewController], providers: [ContractBankVerificationService,UpwardReceiptMatchService,ContractClassificationPreflightService,UpwardContractAmountService, ContractProxyExecutionService, ContractRelationshipLedgerService, ContractEconomicReviewService] })
export class ContractRelationshipLedgerModule {}
