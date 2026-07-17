import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const ledgerPages = [
  "ContractNumberRulePage.vue",
  "ContractScenarioGovernancePage.vue",
  "ContractTemplateListPage.vue",
  "StandardClauseLibraryPage.vue"
];

const workspacePages = ["ContractTemplateEditorPage.vue", "LayoutTemplateEditorPage.vue"];

describe("contract template responsive governance", () => {
  it.each(ledgerPages)("keeps %s page chrome outside a local table scroller", (name) => {
    const source = readPage(name);
    expect(source).toContain("jg-responsive-ledger");
    expect(source).toContain("jg-table-region");
    expect(source).toContain("horizontal-scroll-affixed-bottom");
    expect(source).not.toMatch(/\.page\s*\{[^}]*overflow-x\s*:\s*(?:auto|scroll)/su);
  });

  it.each(workspacePages)("keeps %s actions outside its professional scroll owner", (name) => {
    const source = readPage(name);
    expect(source).toContain("jg-responsive-workspace");
    expect(source).toContain("jg-workspace-scroll");
    expect(source).not.toMatch(/\.page\s*\{[^}]*overflow-x\s*:\s*(?:auto|scroll)/su);
  });

  it("keeps the ten-column business-template editor aligned at compact widths", () => {
    const source = readPage("ContractTemplateEditorPage.vue");
    expect(source).toContain("row-editor-list jg-workspace-scroll");
    expect(source).toContain("row-editor jg-workspace-scroll__content--standard");
    expect(source).toContain("grid-template-columns: repeat(10");
    expect(source).not.toMatch(/@media[^}]+\.row-editor/su);
  });

  it("responds to the preview drawer width instead of the browser viewport", () => {
    const source = readFileSync(
      new URL("../../components/ContractTemplateUsagePreviewDrawer.vue", import.meta.url),
      "utf8"
    );
    expect(source).toContain("container-name: jg-template-preview");
    expect(source).toContain("@container jg-template-preview");
    expect(source).not.toContain("@media (max-width: 720px)");
  });
});
