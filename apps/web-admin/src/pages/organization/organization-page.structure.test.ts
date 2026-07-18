import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("./OrganizationManagementPage.vue", import.meta.url)),
  "utf8"
);
const drawerSource = readFileSync(
  fileURLToPath(new URL("./components/OrganizationRoleRemovalDrawer.vue", import.meta.url)),
  "utf8"
);
const additionDrawerSource = readFileSync(
  fileURLToPath(new URL("./components/OrganizationRoleAdditionDrawer.vue", import.meta.url)),
  "utf8"
);
const batchRemovalDrawerSource = readFileSync(
  fileURLToPath(new URL("./components/OrganizationBatchRoleRemovalDrawer.vue", import.meta.url)),
  "utf8"
);
const userCreationDrawerSource = readFileSync(
  fileURLToPath(new URL("./components/OrganizationUserCreationDrawer.vue", import.meta.url)),
  "utf8"
);

describe("organization business-facing language", () => {
  it("shows position names without exposing internal role keys", () => {
    expect(pageSource).toContain("{{ position.name }}");
    expect(pageSource).not.toContain("{{ position.name }} · {{ position.key }}");
  });
});

describe("organization user creation structure", () => {
  it("shows user creation to a manager with eligible subordinate roles, while keeping department creation technical-only", () => {
    const userCreationActionIndex = pageSource.indexOf('@click="openUserCreationDrawer"');
    const userCreationButtonSource = pageSource.slice(
      pageSource.lastIndexOf("<t-button", userCreationActionIndex),
      pageSource.indexOf("</t-button>", userCreationActionIndex)
    );
    const departmentCreationActionIndex = pageSource.indexOf('@click="openCreateDepartment"');
    const departmentCreationButtonSource = pageSource.slice(
      pageSource.lastIndexOf("<t-button", departmentCreationActionIndex),
      pageSource.indexOf("</t-button>", departmentCreationActionIndex)
    );

    expect(userCreationButtonSource).toContain('v-if="userCreationRoleOptions.length"');
    expect(userCreationButtonSource).not.toContain('v-if="isTechnicalAdmin"');
    expect(departmentCreationButtonSource).toContain('v-if="isTechnicalAdmin"');
  });

  it("uses an independent drawer without role assignment or persisted secrets", () => {
    expect(pageSource).toContain("OrganizationUserCreationDrawer");
    expect(pageSource).toContain("新增人员");
    expect(userCreationDrawerSource).toContain("createOrganizationUser");
    expect(userCreationDrawerSource).toContain("公司统一初始密码");
    expect(userCreationDrawerSource).not.toContain("generateTemporaryPassword");
    expect(userCreationDrawerSource).not.toContain("navigator.clipboard.writeText");
    expect(userCreationDrawerSource).not.toContain("applyOrganizationRoleAddition");
    expect(userCreationDrawerSource).not.toContain("localStorage");
    expect(userCreationDrawerSource).not.toContain("sessionStorage");
    expect(userCreationDrawerSource).not.toContain("Math.random");
  });

  it("clears secrets on close, failure and success and refreshes only after success", () => {
    expect(userCreationDrawerSource).toContain("resetSensitiveFields");
    expect(userCreationDrawerSource).toMatch(/catch[\s\S]{0,300}resetSensitiveFields/u);
    expect(userCreationDrawerSource).toMatch(/await createOrganizationUser[\s\S]{0,400}resetSensitiveFields/u);
    expect(pageSource).toContain('@created="handleUserCreated"');
    expect(pageSource).toMatch(/handleUserCreated[\s\S]*loadDirectory\(\)/u);
    expect(pageSource).not.toMatch(/handleUserCreated[\s\S]{0,300}loadPermissionIntegrity\(\)/u);
  });
});

describe("organization batch role-removal preview structure", () => {
  it("uses a separate read-only TDesign drawer without password or apply paths", () => {
    expect(pageSource).toContain("OrganizationBatchRoleRemovalDrawer");
    expect(pageSource).toContain("批量预览撤岗");
    expect(batchRemovalDrawerSource).toContain("<t-drawer");
    expect(batchRemovalDrawerSource).toContain("multiple");
    expect(batchRemovalDrawerSource).toContain("previewOrganizationRoleRemovalBatch");
    expect(batchRemovalDrawerSource).not.toContain("confirmationPassword");
    expect(batchRemovalDrawerSource).not.toContain("applyOrganizationRoleRemoval");
    expect(batchRemovalDrawerSource).not.toContain("role-changes/apply");
  });

  it("never auto-previews, clears preview on selection and warns that apply remains single-role", () => {
    expect(batchRemovalDrawerSource).not.toMatch(/watch\([\s\S]{0,300}previewOrganizationRoleRemovalBatch\(/u);
    expect(batchRemovalDrawerSource).toContain("clearPreview");
    expect(batchRemovalDrawerSource).toContain("实际撤销仍需回到单人岗位管理");
    expect(batchRemovalDrawerSource).toContain("不得用于撤销接口");
    expect(batchRemovalDrawerSource).toContain("combinedSnapshotHash");
  });
});

describe("organization role removal page structure", () => {
  it("uses an independent drawer and exposes only one-role-at-a-time removal", () => {
    expect(pageSource).toContain("OrganizationRoleRemovalDrawer");
    expect(pageSource).toContain("岗位管理");
    expect(drawerSource).toContain("当前仅支持逐条撤销");
    expect(drawerSource).not.toContain("批量撤销");
    expect(drawerSource).not.toContain("确认新增岗位");
  });

  it("shows password only behind server canApply and treats conflicts as stale previews", () => {
    expect(drawerSource).toContain('v-if="canConfirmRemoval"');
    expect(drawerSource).toContain("error.status === 409");
    expect(drawerSource).toContain("previewStale.value = true");
    expect(drawerSource).toContain("resetPassword()");
  });

  it("refreshes directory and permission integrity together after apply success", () => {
    expect(pageSource).toContain("@applied=\"handleRoleRemovalApplied\"");
    expect(pageSource).toMatch(
      /handleRoleRemovalApplied[\s\S]*Promise\.all\(\[loadDirectory\(\), loadPermissionIntegrity\(\)\]\)/u
    );
    expect(pageSource).toContain(
      ':disabled="saving || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"'
    );
    expect(pageSource).toMatch(
      /handleRoleRemovalApplied[\s\S]*refreshing\.value = true[\s\S]*finally[\s\S]*refreshing\.value = false/u
    );
  });

  it("offers manual cleanup only through an injected canonical remediation target", () => {
    expect(pageSource).toContain('#operation="{ row }"');
    expect(pageSource).toContain("预览清理");
    expect(pageSource).toContain("openProjectSuperAdminRemediation");
    expect(pageSource).toContain(':remediation-target="roleDrawerRemediationTarget"');
    expect(pageSource).toContain("roleDrawerRemediationTarget.value = null");
    expect(drawerSource).toContain("remediationTarget");
    expect(drawerSource).toContain("mergeOrganizationRoleRemovalTargets");
    expect(drawerSource).not.toMatch(/watch\([\s\S]{0,300}previewTarget\(/u);
  });
});

describe("organization role addition page structure", () => {
  it("uses a separate one-role addition drawer with explicit inactive-user blocking", () => {
    expect(pageSource).toContain("OrganizationRoleAdditionDrawer");
    expect(pageSource).toContain("新增岗位");
    expect(pageSource).toContain("人员已停用，不能新增岗位");
    expect(additionDrawerSource).toContain("当前仅支持逐条新增");
    expect(additionDrawerSource).not.toContain("批量新增");
    expect(additionDrawerSource).not.toContain("previewOrganizationRoleRemoval");
    expect(drawerSource).not.toContain("previewOrganizationRoleAddition");
  });

  it("never auto-previews and clears preview plus password on selection and conflict", () => {
    expect(additionDrawerSource).not.toMatch(/watch\([\s\S]{0,300}previewTarget\(/u);
    expect(additionDrawerSource).toContain('v-if="canConfirmAddition"');
    expect(additionDrawerSource).toContain("resetPreview()");
    expect(additionDrawerSource).toContain("error.status === 409");
    expect(additionDrawerSource).toMatch(/error\.status === 409[\s\S]{0,200}preview\.value = null/u);
    expect(additionDrawerSource).toContain("resetPassword()");
  });

  it("keeps addition state separate and performs both reloads only after success", () => {
    expect(pageSource).toContain("roleAdditionDrawerVisible");
    expect(pageSource).toContain("roleDrawerVisible");
    expect(pageSource).toContain('@applied="handleRoleAdditionApplied"');
    expect(pageSource).toMatch(
      /handleRoleAdditionApplied[\s\S]*Promise\.all\(\[loadDirectory\(\), loadPermissionIntegrity\(\)\]\)/u
    );
  });

  it("labels preview rows as approval nodes without claiming they are current nodes", () => {
    expect(additionDrawerSource).toContain('title: "审批节点"');
    expect(additionDrawerSource).not.toContain('title: "当前节点"');
  });
});
