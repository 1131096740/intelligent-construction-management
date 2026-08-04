import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("./OrganizationManagementPage.vue", import.meta.url)),
  "utf8"
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../../api/organization.api.ts", import.meta.url)),
  "utf8"
);

const isolatedMutationPairs = [
  ["createOrganizationDepartment", "/organization/departments"],
  ["updateOrganizationDepartment", "/organization/departments/${encodeURIComponent(departmentId)}"],
  ["createOrganizationUser", "/organization/users"],
  ["updateOrganizationUser", "/organization/users/${encodeURIComponent(userId)}"],
  ["previewOrganizationRoleAddition", "/organization/role-additions/preview"],
  ["applyOrganizationRoleAddition", "/organization/role-additions/apply"],
  ["previewOrganizationRoleRemoval", "/organization/role-changes/preview"],
  ["previewOrganizationRoleRemovalBatch", "/organization/role-changes/batch-preview"],
  ["applyOrganizationRoleRemoval", "/organization/role-changes/apply"]
] as const;

const detachedMutationComponents = [
  "OrganizationUserCreationDrawer",
  "OrganizationRoleAdditionDrawer",
  "OrganizationRoleRemovalDrawer",
  "OrganizationBatchRoleRemovalDrawer"
] as const;

describe("organization first-release read-only isolation", () => {
  it("keeps directory and integrity reads plus an explicit manual refresh", () => {
    expect(pageSource).toContain("fetchOrganizationDirectory");
    expect(pageSource).toContain("fetchPermissionIntegrity");
    expect(pageSource).toContain('@click="refreshPage"');
    expect(pageSource).toContain("首次上线只读");
  });

  it("detaches all nine organization mutation pairs without deleting their candidate wrappers", () => {
    for (const [wrapper, route] of isolatedMutationPairs) {
      expect(apiSource).toMatch(new RegExp(`export (?:async )?function ${wrapper}\\b`, "u"));
      expect(apiSource).toContain(route);
      expect(pageSource).not.toContain(wrapper);
    }

    for (const component of detachedMutationComponents) {
      expect(pageSource).not.toContain(component);
    }
  });

  it("removes mutation controls, dialogs and operation columns from the production page", () => {
    expect(pageSource).not.toContain("<t-dialog");
    expect(pageSource).not.toContain('<template #operation');
    expect(pageSource).not.toContain('{ colKey: "operation"');
    expect(pageSource).not.toMatch(/@click="open(?:Create|Edit|Role|Batch|User)/u);
    expect(pageSource).not.toContain('@confirm="submitDialog"');
  });

  it("shows business position names without exposing internal role keys", () => {
    expect(pageSource).toContain("{{ position.name }}");
    expect(pageSource).not.toContain("{{ position.name }} · {{ position.key }}");
  });
});
