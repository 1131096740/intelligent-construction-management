import { Module } from "@nestjs/common";
import { ContractModule } from "./contract/contract.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { OrganizationModule } from "./organization/organization.module";
import { PaymentModule } from "./payment/payment.module";
import { ProjectModule } from "./project/project.module";
import { SettlementModule } from "./settlement/settlement.module";

@Module({
  imports: [
    DatabaseModule,
    OrganizationModule,
    ProjectModule,
    ContractModule,
    SettlementModule,
    PaymentModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
