import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const companyEntities = readPage("./company-entities/CompanyEntityListPage.vue");
const partyList = readPage("./business-parties/BusinessPartyListPage.vue");
const partyDetail = readPage("./business-parties/BusinessPartyEditorPage.vue");

describe("stage D master-data readonly isolation", () => {
  it("keeps company entities readable while removing every production write trigger", () => {
    expect(companyEntities).toContain("fetchCompanyEntityManagement");
    expect(companyEntities).toContain("CompanyEntityHistoryDrawer");
    expect(companyEntities).toContain("上线准备期间暂为只读");
    expect(companyEntities).not.toMatch(
      /CompanyEntityFormDrawer|SensitiveActionDialog|updateCompanyEntityStatus|openCreate|openEdit|openStatus|confirmStatus/
    );
  });

  it("keeps business-party search readable without a create trigger", () => {
    expect(partyList).toContain("listBusinessParties");
    expect(partyList).toContain("上线准备期间暂为只读");
    expect(partyList).not.toMatch(
      /createBusinessParty|createParty|创建合作单位|创建档案/
    );
  });

  it("keeps business-party history readable without version or upload triggers", () => {
    expect(partyDetail).toContain("getBusinessParty");
    expect(partyDetail).toContain("上线准备期间暂为只读");
    expect(partyDetail).not.toMatch(
      /uploadPrivateFile|createBusinessPartyVersion|createVersion|onAttachmentFile|type="file"|新建档案版本|新增附件/
    );
  });
});
