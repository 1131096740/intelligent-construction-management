import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const companyEntities = readPage("./company-entities/CompanyEntityListPage.vue");
const partyList = readPage("./business-parties/BusinessPartyListPage.vue");
const partyDetail = readPage("./business-parties/BusinessPartyEditorPage.vue");

describe("authorized master-data maintenance and preserved reads", () => {
  it("keeps company history readable and gates restored maintenance by server capability", () => {
    expect(companyEntities).toContain("fetchCompanyEntityManagement");
    expect(companyEntities).toContain("CompanyEntityHistoryDrawer");
    expect(companyEntities).toContain("fetchCompanyEntityManagementCapability");
    expect(companyEntities).toContain('v-if="canMaintain"');
    expect(companyEntities).toContain("saveCompanyStatusWithCapability");
  });

  it("keeps business-party search readable", () => {
    expect(partyList).toContain("listBusinessParties");
  });

  it("keeps business-party history readable and restores only approved maintenance", () => {
    expect(partyDetail).toContain("getBusinessParty");
    expect(partyDetail).toContain("getBusinessPartyMaintenanceCapability");
    expect(partyDetail).toContain("savePartyVersionWithCapability");
    expect(partyDetail).not.toMatch(
      /uploadPrivateFile|onAttachmentFile|type="file"|新增附件/
    );
  });
});
