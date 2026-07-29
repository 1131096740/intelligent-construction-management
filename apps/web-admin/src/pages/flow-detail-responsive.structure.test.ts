import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const partyEditor = readPage("./business-parties/BusinessPartyEditorPage.vue");
const expenseDetail = readPage("./projects/ProjectExpenseApprovalDetailPage.vue");
const projectOverview = readPage("./projects/ProjectOperatingOverviewPage.vue");
const settings = readPage("./settings/SettingsPage.vue");

describe("responsive forms and detail pages", () => {
  it("uses content-container reflow instead of viewport media queries", () => {
    expect(partyEditor).toContain("jg-responsive-flow");
    expect(settings).toContain("jg-responsive-flow");
    expect(expenseDetail).toContain("jg-responsive-detail");
    expect(projectOverview).toContain("jg-responsive-detail");

    for (const source of [partyEditor, settings, expenseDetail, projectOverview]) {
      expect(source).toContain("@container jg-page");
      expect(source).not.toContain("@media (max-width:");
      expect(source).not.toMatch(/overflow-x\s*:\s*(?:auto|scroll)/u);
    }
  });

  it("keeps the party history table local while its form and attachments reflow", () => {
    expect(partyEditor).toContain("jg-table-region jg-table-region--standard");
    expect(partyEditor).toContain(':horizontal-scroll-affixed-bottom="true"');
    expect(partyEditor).toContain("@container jg-page (max-width: 1100px)");
    expect(partyEditor).toContain("@container jg-page (max-width: 620px)");
  });

  it("keeps all three project data tables as separate shared scroll owners", () => {
    expect(projectOverview.match(/expense-table-wrap jg-workspace-scroll/g)?.length).toBe(3);
    expect(projectOverview).toContain("min-width: var(--jg-layout-ledger-table-wide-min-width)");
    expect(projectOverview).toContain("min-width: var(--jg-layout-ledger-table-min-width)");
    expect(projectOverview).not.toMatch(/min-width\s*:\s*(?:1180|920)px/u);
  });

  it("reflows settings and expense facts without hiding fields or actions", () => {
    expect(settings).toContain("@container jg-page (max-width: 840px)");
    expect(settings).toContain(".account-grid");
    expect(settings).toContain(".dictionary-grid");
    expect(expenseDetail).toContain(".summary-grid");
    expect(expenseDetail).toContain(".review-buttons");
  });
});
