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
      ':disabled="saving || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible"'
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
