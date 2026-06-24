import { Module } from "@nestjs/common";
import { ArchiveModule } from "./archive/archive.module";
import { ApprovalModule } from "./approval/approval.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CompanyEntityModule } from "./company-entity/company-entity.module";
import { ContractModule } from "./contract/contract.module";
import { ContractTemplateModule } from "./contract-template/contract-template.module";
import { DatabaseModule } from "./database/database.module";
import { FileModule } from "./file/file.module";
import { HealthController } from "./health.controller";
import { MeModule } from "./me/me.module";
import { OrganizationModule } from "./organization/organization.module";
import { PaymentModule } from "./payment/payment.module";
import { PdfModule } from "./pdf/pdf.module";
import { ProjectModule } from "./project/project.module";
import { SettlementModule } from "./settlement/settlement.module";

@Module({
  imports: [
    DatabaseModule,
    OrganizationModule,
    ProjectModule,
    ContractModule,
    ContractTemplateModule,
    CompanyEntityModule,
    SettlementModule,
    PaymentModule,
    ApprovalModule,
    FileModule,
    MeModule,
    ArchiveModule,
    AuditModule,
    AuthModule,
    PdfModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
