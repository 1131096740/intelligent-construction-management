import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./BusinessPartyCreatePage.vue", import.meta.url), "utf8");
const list = readFileSync(new URL("./BusinessPartyListPage.vue", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");

describe("business-party creation entry", () => {
  it("keeps the server-gated create chain and recovery boundary visible", () => {
    for (const token of [
      "issueBusinessEntryCreateTarget",
      "fetchBusinessEntryDefinition",
      "validateBusinessEntryDraft",
      "createBusinessParty",
      "businessPartyCreateRecovery",
      "useUnsavedChangesGuard"
    ]) {
      expect(page).toContain(token);
    }
    expect(page).toContain("router.replace");
    expect(page).toContain("结果确认中");
  });

  it("renders only name and optional unified social credit code", () => {
    expect(page).toMatch(/label="名称"/u);
    expect(page).toMatch(/label="统一社会信用代码"/u);
    expect(page).not.toContain("label=\"主体类型\"");
    expect(page).not.toContain("v-model=\"form.type\"");
  });

  it("uses design tokens for new page layout styles", () => {
    expect(page).not.toMatch(/(?:gap|padding|margin|font-size|border-radius):\s*\d+(?:px|rem|em)/u);
    expect(page).toContain("var(--jg-space-");
    expect(page).toContain("var(--jg-font-");
    expect(page).toContain("var(--jg-radius-");
  });

  it("exposes one capability-gated list entry and both new-route spellings", () => {
    expect(list).toContain("新建合作单位");
    expect(list).toContain("issueBusinessEntryCreateTarget");
    expect(routes).toContain('path: "合作单位档案/新建"');
    expect(routes).toContain('path: "business-parties/new"');
  });
});
