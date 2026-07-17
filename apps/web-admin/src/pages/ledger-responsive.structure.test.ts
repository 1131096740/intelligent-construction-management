import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = {
  approval: readFileSync(new URL("./approval-center/ApprovalCenterPage.vue", import.meta.url), "utf8"),
  archive: readFileSync(new URL("./archives/ArchiveListPage.vue", import.meta.url), "utf8"),
  audit: readFileSync(new URL("./audit/AuditLogPage.vue", import.meta.url), "utf8"),
  delegation: readFileSync(new URL("./delegations/DelegationListPage.vue", import.meta.url), "utf8"),
  search: readFileSync(new URL("./search/GlobalSearchPage.vue", import.meta.url), "utf8")
};

describe("responsive operational ledgers", () => {
  it("registers all five pages as responsive ledgers without viewport media queries", () => {
    for (const source of Object.values(pages)) {
      expect(source).toContain("jg-responsive-ledger");
      expect(source).not.toContain("@media (max-width:");
      expect(source).not.toMatch(/overflow-x\s*:\s*(?:auto|scroll)/u);
    }
  });

  it("keeps each TDesign table inside an explicit local scroll region", () => {
    for (const source of [pages.archive, pages.audit, pages.delegation, pages.search]) {
      expect(source).toContain("jg-table-region");
      expect(source).toContain(':horizontal-scroll-affixed-bottom="true"');
    }
  });

  it("lets the approval list reflow because it has no wide data table", () => {
    expect(pages.approval).toContain("@container jg-page");
    expect(pages.approval).not.toContain("<t-table");
    expect(pages.approval).not.toContain("jg-table-region");
  });
});
