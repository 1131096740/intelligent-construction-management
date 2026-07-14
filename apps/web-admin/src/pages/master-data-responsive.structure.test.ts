import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const partyList = readFileSync(
  new URL("./business-parties/BusinessPartyListPage.vue", import.meta.url),
  "utf8"
);
const roster = readFileSync(new URL("./projects/ProjectRosterPage.vue", import.meta.url), "utf8");
const organization = readFileSync(
  new URL("./organization/OrganizationManagementPage.vue", import.meta.url),
  "utf8"
);
const drawerFiles = [
  "OrganizationRoleRemovalDrawer.vue",
  "OrganizationRoleAdditionDrawer.vue",
  "OrganizationBatchRoleRemovalDrawer.vue",
  "OrganizationUserCreationDrawer.vue"
];
const drawers = drawerFiles.map((file) =>
  readFileSync(new URL(`./organization/components/${file}`, import.meta.url), "utf8")
);

describe("responsive master data and organization workspace", () => {
  it("keeps party and roster ledgers inside local TDesign table regions", () => {
    for (const source of [partyList, roster]) {
      expect(source).toContain("jg-responsive-ledger");
      expect(source).toContain("jg-table-region");
      expect(source).toContain(':horizontal-scroll-affixed-bottom="true"');
      expect(source).toMatch(/jg-table-region[\s\S]*?<t-table/u);
      expect(source).not.toContain("@media (max-width:");
    }
  });

  it("delegates organization overflow to its three table regions", () => {
    expect(organization).toContain("jg-responsive-workspace");
    expect(organization).toContain('data-jg-scroll-owner="child"');
    expect(organization.match(/jg-table-region/g)?.length).toBeGreaterThanOrEqual(3);
    expect(organization).toContain("@container jg-page (max-width: 1100px)");
  });

  it("keeps drawer tables local and lets drawer controls reflow", () => {
    for (const source of drawers) {
      expect(source).toContain("container-name: organization-drawer");
    }
    for (const source of drawers.slice(0, 3)) {
      expect(source).toContain("jg-table-region");
      expect(source).toContain(':horizontal-scroll-affixed-bottom="true"');
    }
  });
});
