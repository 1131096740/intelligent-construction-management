import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrganizationController } from "./organization.controller";
import { OrganizationRoleService } from "./organization-role.service";
import { OrganizationService } from "./organization.service";
import { PermissionImpactService } from "./permission-impact.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, PermissionImpactService, OrganizationRoleService]
})
export class OrganizationModule {}
