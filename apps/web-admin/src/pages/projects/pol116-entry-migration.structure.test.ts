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
    expect(clearing).toContain(":definition=\"activeConfirmationDefinition\"");
    expect(clearing).toContain('availableActions.includes("clearing.confirm")');
    expect(clearing).not.toContain("冻结业务快照 JSON");
    expect(clearing).not.toContain("来源事件版本 ID");
    expect(clearing).not.toContain("本次分配金额（分）");
    expect(clearing).not.toContain("{{ detail.projectId }}");
    expect(clearing).not.toContain("{{ detail.constructionEnterpriseAssignmentId }}");
    expect(clearing).not.toContain("{{ detail.authoritySnapshotRef }}");
    expect(clearing).not.toContain("authority case");
    expect(clearing).not.toContain("客户端 JSON");
    expect(clearing).toContain("已按系统权威资料冻结");
    expect(clearing).toContain("这里只选择当前有效的业务选项");
  });

  it("migrates stage basis and distribution rows while retaining server actions", () => {
    const close = read("./components/ProjectCloseProfitPanel.vue");
    expect(close).toContain("<BusinessEntryForm");
    expect(close).toContain("<BusinessEntryGrid");
    expect(close).toContain(":definition=\"PROJECT_TEMPORARY_PROFIT_DISTRIBUTION_ENTRY_DEFINITION\"");
    expect(close).toContain('availableActions.includes("confirm_distribution")');
    expect(close).not.toContain("<span>参与公司</span>");
    expect(close).not.toContain("<span>暂分金额（元）</span>");
  });

  it("preserves the project-close basis prompt used by the real browser workflow", () => {
    expect(PROJECT_CLOSE_BASIS_ENTRY_DEFINITION.fields[0]?.display.formHint).toBe(
      "请说明核对范围、依据和结论；系统会与本次经营快照一起冻结"
    );
  });
});
