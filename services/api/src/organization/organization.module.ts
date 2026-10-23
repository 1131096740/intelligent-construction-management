import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrganizationController } from "./organization.controller";
import { OrganizationRoleService } from "./organization-role.service";
import { OrganizationService } from "./organization.service";
import { PermissionImpactService } from "./permission-impact.service";
import { EmployeeOnboardingController } from "./employee-onboarding.controller";
import { EmployeeOnboardingService } from "./employee-onboarding.service";
import { ProjectRosterManagementController } from "./project-roster-management.controller";
import { ProjectRosterManagementService } from "./project-roster-management.service";
import { PersonnelLifecycleService } from "./personnel-lifecycle.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [OrganizationController, EmployeeOnboardingController, ProjectRosterManagementController],
  providers: [OrganizationService, PermissionImpactService, OrganizationRoleService, EmployeeOnboardingService, ProjectRosterManagementService, PersonnelLifecycleService],
  exports: [OrganizationService, OrganizationRoleService]
})
export class OrganizationModule {}
