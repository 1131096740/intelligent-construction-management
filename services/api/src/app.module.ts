import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ArchiveModule } from "./archive/archive.module";
import { ApprovalModule } from "./approval/approval.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BusinessPartyModule } from "./business-party/business-party.module";
import { BusinessEntryDefinitionModule } from "./business-entry-definition/business-entry-definition.module";
import { ClearingModule } from "./clearing/clearing.module";
import { CompanyEntityModule } from "./company-entity/company-entity.module";
import { ContractBillModule } from "./contract-bill/contract-bill.module";
import { ContractDocumentModule } from "./contract-document/contract-document.module";
import { ContractModule } from "./contract/contract.module";
import { ContractTemplateModule } from "./contract-template/contract-template.module";
import { ContractTakeoverModule } from "./contract-takeover/contract-takeover.module";
import { ContractWorkbenchModule } from "./contract-workbench/contract-workbench.module";
import { DatabaseModule } from "./database/database.module";
import { FileModule } from "./file/file.module";
import { DraftRetentionModule } from "./draft-retention/draft-retention.module";
import { ContractEndedApplicationRetentionModule } from "./contract-ended-retention/contract-ended-retention.module";
import { ContractEndedApplicationPurgeModule } from "./contract-ended-purge/contract-ended-application-purge.module";
import { ExpenseClaimModule } from "./expense-claim/expense-claim.module";
import { FundsWorkbenchModule } from "./funds-workbench/funds-workbench.module";
import { HealthController } from "./health.controller";
import { InvoiceLedgerModule } from "./invoice-ledger/invoice-ledger.module";
import { MeModule } from "./me/me.module";
import { OrganizationModule } from "./organization/organization.module";
import { OperatingLedgerModule } from "./operating-ledger/operating-ledger.module";
import { OperatingTakeoverModule } from "./operating-takeover/operating-takeover.module";
import { PaymentModule } from "./payment/payment.module";
import { PdfModule } from "./pdf/pdf.module";
import { ProjectExpenseModule } from "./project-expense/project-expense.module";
import { ProjectModule } from "./project/project.module";
import { ProjectOperatingConstraintFilter } from "./project/project-operating-constraint.filter";
import { SettlementModule } from "./settlement/settlement.module";
import { SpotProcurementModule } from "./spot-procurement/spot-procurement.module";
import { WageStatementModule } from "./wage-statement/wage-statement.module";

@Module({
  imports: [
    DatabaseModule,
    OrganizationModule,
    ProjectModule,
    ContractModule,
    ContractBillModule,
    ContractDocumentModule,
    ContractWorkbenchModule,
    ContractTemplateModule,
    ContractTakeoverModule,
    BusinessPartyModule,
    BusinessEntryDefinitionModule,
    ClearingModule,
    CompanyEntityModule,
    OperatingLedgerModule,
    OperatingTakeoverModule,
    SettlementModule,
    PaymentModule,
    ProjectExpenseModule,
    ExpenseClaimModule,
    FundsWorkbenchModule,
    SpotProcurementModule,
    WageStatementModule,
    InvoiceLedgerModule,
    ApprovalModule,
    FileModule,
    DraftRetentionModule,
    ContractEndedApplicationRetentionModule,
    ContractEndedApplicationPurgeModule,
    MeModule,
    ArchiveModule,
    AuditModule,
    AuthModule,
    PdfModule
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]
})
export class AppModule {}
