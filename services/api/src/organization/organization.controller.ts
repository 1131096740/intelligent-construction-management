import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { CreateDepartmentDto } from "./dto/create-department.dto";
import { ApplyRoleRemovalDto } from "./dto/apply-role-removal.dto";
import { PreviewRoleRemovalDto } from "./dto/preview-role-removal.dto";
import { UpdateDepartmentDto } from "./dto/update-department.dto";
import { UpdateOrganizationUserDto } from "./dto/update-organization-user.dto";
import { OrganizationService } from "./organization.service";
import { OrganizationRoleService } from "./organization-role.service";
import { PermissionImpactService } from "./permission-impact.service";

@Controller("organization")
@RequirePositions("super_admin")
export class OrganizationController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly permissionImpacts: PermissionImpactService,
    private readonly organizationRoles: OrganizationRoleService
  ) {}

  @Get("directory")
  directory() {
    return this.organization.getDirectory();
  }

  @Get("permission-integrity")
  permissionIntegrity() {
    return this.organization.getPermissionIntegrity();
  }

  @Post("role-changes/preview")
  previewRoleRemoval(@Body() body: PreviewRoleRemovalDto) {
    return this.permissionImpacts.previewRoleRemoval(body);
  }

  @Post("role-changes/apply")
  applyRoleRemoval(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ApplyRoleRemovalDto
  ) {
    return this.organizationRoles.applyRoleRemoval(actor.id, body);
  }

  @Post("departments")
  createDepartment(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateDepartmentDto
  ) {
    return this.organization.createDepartment(actor.id, body);
  }

  @Patch("departments/:departmentId")
  updateDepartment(
    @Param("departmentId") departmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateDepartmentDto
  ) {
    return this.organization.updateDepartment(departmentId, actor.id, body);
  }

  @Patch("users/:userId")
  updateUser(
    @Param("userId") userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateOrganizationUserDto
  ) {
    return this.organization.updateUser(userId, actor.id, body);
  }
}
