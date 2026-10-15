import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const pageSource = readFileSync(fileURLToPath(new URL("./OrganizationManagementPage.vue", import.meta.url)), "utf8");
describe("组织管理入口", () => {
  it("以服务端能力显示新增人员、部门和逐人管理入口", () => {
    expect(pageSource).toContain("fetchOrganizationManagementCapabilities");
    expect(pageSource).toContain("capabilities?.canCreateUser");
    expect(pageSource).toContain("capabilities?.canManageDepartments");
    expect(pageSource).toContain("capabilities.value?.manageableUserIds.includes(id)");
    expect(pageSource).toContain("capabilities.value?.manageableRoleUserIds");
    expect(pageSource).toContain("新增人员和账号");
    expect(pageSource).toContain("重新启用");
    expect(pageSource).not.toContain("首次上线只读");
  });
  it("复用既有逐条授岗撤岗和人员编辑，保留批量撤岗关闭", () => {
    for (const component of ["OrganizationUserCreationDrawer", "OrganizationRoleAdditionDrawer", "OrganizationRoleRemovalDrawer", "OrganizationDetailsDrawer"]) expect(pageSource).toContain(component);
    expect(pageSource).not.toContain("OrganizationBatchRoleRemovalDrawer");
    expect(pageSource).toContain("fetchPermissionIntegrity");
    expect(pageSource).toContain('@click="refreshPage"');
    expect(pageSource).toContain("{{ position.name }}");
    expect(pageSource).not.toContain("{{ position.key }}");
  });
});
