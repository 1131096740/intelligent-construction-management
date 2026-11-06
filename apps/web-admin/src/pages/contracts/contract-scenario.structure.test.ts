import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const governance = readFileSync(
  new URL("../contract-templates/ContractScenarioGovernancePage.vue", import.meta.url),
  "utf8"
);

describe("contract scenario web structure", () => {
  // CON-09 (2026-11-05 frozen specification): manual template selection
  // replaces the former recommendation/automatic-selection source assertion.
  // The real creation and selection behavior is covered by contract-grid-http.e2e.ts.
  it("keeps governance calls behind global-role checks and uses TDesign controls", () => {
    expect(governance).toContain("auth.user?.globalRoleKeys");
    expect(governance).toMatch(/if \(!canGovern\.value\)[\s\S]*return;[\s\S]*loadGovernance/u);
    expect(governance).toContain("listContractScenarioGovernance");
    expect(governance).toContain("<t-table");
    expect(governance).toContain("<t-dialog");
    expect(governance).toContain("<t-popconfirm");
    expect(governance.match(/:disabled="!canGovern/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(governance).toContain("assertCanGovern()");
    expect(governance).not.toContain("createdByUserId");
    expect(governance).toContain("if (!(await loadGovernance())) return false;");
  });
});
