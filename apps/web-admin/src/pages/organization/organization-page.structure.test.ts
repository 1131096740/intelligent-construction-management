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
    expect(pageSource).toContain(':disabled="saving || roleDrawerVisible"');
    expect(pageSource).toMatch(
      /handleRoleRemovalApplied[\s\S]*refreshing\.value = true[\s\S]*finally[\s\S]*refreshing\.value = false/u
    );
  });
});
