import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./FundExecutionWorkbenchPage.vue", import.meta.url),
  "utf8"
);
const routes = readFileSync(
  new URL("../../routes/route-records.ts", import.meta.url),
  "utf8"
);

describe("fund execution workbench structure", () => {
  it("renders only server Chinese summaries and keeps technical ids out of fields", () => {
    expect(page).toContain("银行流水候选");
    expect(page).toContain("option.summary");
    expect(page).toContain("plan.summary");
    expect(page).not.toMatch(/v-model="[^"]*(?:observationId|fundExecutionId|targetExecutionId)/u);
    expect(page).not.toContain("手填编号");
  });

  it("flattens every resolution line axis but hides classification for reversals", () => {
    expect(page).toContain("flattenClassificationPlan");
    expect(page).toContain("caseAllowsClassification");
    expect(page).toContain("反向执行沿用原分类");
    expect(page).toContain("updateFundExecutionReversalReason");
    expect(page).toContain("修改反向执行原因");
    expect(page).toContain("targetSelectionRef");
    expect(page).not.toContain("targetExecutionId");
  });

  it("treats a returned revision as an editable draft and never renders its opaque caseRef", () => {
    expect(page).not.toContain("review_returned");
    expect(page).not.toContain("{{ row.caseRef }}");
    expect(page).not.toContain("{{ selectedCase.caseRef }}");
  });

  it("does not leave a stray text node after either radio group", () => {
    expect(page).not.toMatch(/<\/t-radio-group>\s*>/u);
  });

  it("registers a role-controlled route without putting a case identifier in the URL", () => {
    expect(routes).toContain('label: "资金执行案件"');
    expect(routes).toContain('path: "/资金执行案件"');
    expect(routes).toContain('path: "资金执行案件"');
    expect(routes).not.toContain('path: "资金执行案件/:caseId"');
  });
});
