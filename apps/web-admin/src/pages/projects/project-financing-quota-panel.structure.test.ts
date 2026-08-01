import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("./ProjectOperatingOverviewPage.vue", import.meta.url),
  "utf8"
);
const panelSource = readFileSync(
  new URL("./components/ProjectFinancingQuotaPanel.vue", import.meta.url),
  "utf8"
);
const apiSource = readFileSync(
  new URL("../../api/project-financing-quota.api.ts", import.meta.url),
  "utf8"
);

describe("project financing quota F0 workbench", () => {
  it("loads the project-scoped read model and mounts the dedicated panel", () => {
    expect(pageSource).toContain("fetchProjectFinancingQuotaWorkbench");
    expect(pageSource).toContain("<ProjectFinancingQuotaPanel");
    expect(pageSource).toContain(":workbench=\"financingQuotaWorkbench\"");
    expect(pageSource).toContain("createProjectOverviewRequestOwner");
    expect(pageSource).toContain("overviewRequestOwner.begin()");
    expect(pageSource).toContain("overviewRequestOwner.isCurrent(requestOwner)");
  });

  it("shows the fixed funding order and immutable usage facts without client role inference", () => {
    expect(panelSource).toContain("自有资金优先");
    expect(panelSource).toContain("垫资额度补足");
    expect(panelSource).toContain("usageGroups");
    expect(panelSource).not.toContain("auth.user");
    expect(panelSource).not.toContain("fetch(");
  });

  it("renders the backend status label without overriding rejected or terminated history", () => {
    expect(panelSource).toContain("{{ row.statusLabel }}");
    expect(panelSource).not.toContain('row.isExpired ? "已过期" : row.statusLabel');
    expect(panelSource).toContain('status === "approved" && isExpired');
  });

  it("labels every canonical funding-allocation business type", () => {
    expect(panelSource).toContain('project_expense_request: "项目支出"');
    expect(panelSource).toContain('spot_procurement_payment: "零星采购付款"');
    expect(panelSource).toContain('expense_claim: "费用报销 / 借款"');
    expect(panelSource).toContain('incidental_expense: "零星费用"');
  });

  it("shows immutable termination facts instead of falling back to the approver", () => {
    expect(apiSource).toContain("terminatedByName: string | null");
    expect(panelSource).toContain("row.status === 'terminated'");
    expect(panelSource).toContain("终止人：");
    expect(panelSource).toContain("终止时间：");
    expect(panelSource).toContain("终止原因：");
  });
});
