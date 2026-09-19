import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROJECT_CLOSE_BASIS_ENTRY_DEFINITION } from "./components/project-close-entry-definitions";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("POL-19D unified user entry migration", () => {
  it("uses unified field adapters for construction-enterprise facts and generic takeover", () => {
    expect(read("./ProjectOperatingOverviewPage.vue")).toContain("<BusinessEntryForm");
    const takeover = read("./ProjectOperatingTakeoverPage.vue");
    expect(takeover).toContain("<BusinessEntryForm");
    expect(takeover).not.toContain("粘贴 JSON 数组");
  });

  it("keeps sensitive wage preparation behind server capabilities and aggregate previews", () => {
    const wage = read("../wage/WageStatementWorkbenchPage.vue");
    expect(wage).toContain("fetchWageStatementCapabilities");
    expect(wage).toContain("capability.canPrepare");
    expect(wage).toContain("positionCategoryCount");
    expect(wage).not.toContain("employeeName");
  });

  it("migrates clearing fields while retaining the original confirmation capability", () => {
    const clearing = read("../clearing/ClearingWorkbenchPage.vue");
    expect(clearing).toContain("<BusinessEntryForm");
    expect(clearing).toContain('availableActions.includes("clearing.confirm")');
  });

  it("migrates stage basis and distribution rows while retaining server actions", () => {
    const close = read("./components/ProjectCloseProfitPanel.vue");
    expect(close).toContain("<BusinessEntryForm");
    expect(close).toContain("<BusinessEntryGrid");
    expect(close).toContain('availableActions.includes("confirm_distribution")');
  });

  it("preserves the project-close basis prompt used by the real browser workflow", () => {
    expect(PROJECT_CLOSE_BASIS_ENTRY_DEFINITION.fields[0]?.display.formHint).toBe(
      "请说明核对范围、依据和结论；系统会与本次经营快照一起冻结"
    );
  });
});
