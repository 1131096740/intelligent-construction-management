import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [OrganizationController],
  providers: [OrganizationService]
})
export class OrganizationModule {}
