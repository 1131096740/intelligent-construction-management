import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./BusinessPartyCreatePage.vue", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");

describe("business-party creation entry", () => {
  it("exposes one guarded formal route and the system configuration menu item", () => {
    expect(routes).toContain('path: "business-parties/new"');
    expect(routes).toContain("businessPartyCreateRoleKeys");
    expect(routes).toContain('label: "合作单位档案"');
    expect(routes).toContain('path: "/business-parties"');
    expect(routes).not.toContain('path: "合作单位档案/新建"');
  });

  it("uses the fixed server-owned two-field form and the complete fail-closed chain", () => {
    for (const marker of [
      "issueBusinessEntryCreateTarget",
      "fetchBusinessEntryDefinition",
      "issueBusinessEntrySubmissionTarget",
      "validateBusinessEntryDraft",
      "freezeBusinessEntrySnapshot",
      "submitBusinessPartyCreation",
      "async function readFreshDefinition(",
      "const definition = await fetchBusinessEntryDefinition(",
      "function assertFreshDefinition(",
      "async function runCreate()",
      "const definition = await readFreshDefinition();",
      "useUnsavedChangesGuard",
      "createSingleFlight",
      "readBusinessPartyRecoveryEnvelope",
      "router.replace"
    ]) {
      expect(page).toContain(marker);
    }
    expect(page).toContain("统一社会信用代码");
    expect(page).toContain("确认创建");
    expect(page).not.toMatch(/主体类型|organization.*t-(?:input|select)/u);
  });
});
