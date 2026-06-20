import { Module } from "@nestjs/common";
import { ContractModule } from "./contract/contract.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { OrganizationModule } from "./organization/organization.module";
import { ProjectModule } from "./project/project.module";

@Module({
  imports: [DatabaseModule, OrganizationModule, ProjectModule, ContractModule],
  controllers: [HealthController]
})
export class AppModule {}
