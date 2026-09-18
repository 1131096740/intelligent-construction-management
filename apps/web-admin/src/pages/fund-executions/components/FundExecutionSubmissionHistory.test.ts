import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";

import FundExecutionSubmissionHistory from "./FundExecutionSubmissionHistory.vue";

describe("FundExecutionSubmissionHistory", () => {
  it("按冻结定义展示每次提交且不泄露技术标识", async () => {
    const html = await renderToString(createSSRApp({
      render: () => h(FundExecutionSubmissionHistory, {
        snapshots: [{
          id: "a04f6c0f-56ab-4dbf-b96d-968c31ff91b4",
          frozenAt: "2026-09-17T08:00:00.000Z",
          definitionVersion: 1,
          definitionSnapshot: {
            key: "fund_execution.case", entityType: "fund_execution_case", name: "资金办理", description: "测试", version: 1, rules: [],
            fields: [
              { key: "reason", label: "办理说明", type: "long_text", description: "", example: "", scope: "header", unit: "", precision: 0, required: true, permissions: { view: ["finance_staff"], edit: ["finance_staff"] }, display: { formHint: "", gridColumn: "办理说明", mobilePriority: 1, readonlyText: "" }, excel: { column: "办理说明", paste: "single", errorLocation: "cell" }, bulk: { enabled: false, strategy: "append" } },
              { key: "direction", label: "资金方向", type: "single_select", description: "", example: "", scope: "header", unit: "", precision: 0, required: true, readOnly: true, options: [{ value: "inflow", label: "入账" }], permissions: { view: ["finance_staff"], edit: ["finance_staff"] }, display: { formHint: "", gridColumn: "资金方向", mobilePriority: 1, readonlyText: "" }, excel: { column: "资金方向", paste: "single", errorLocation: "cell" }, bulk: { enabled: false, strategy: "append" } }
            ]
          },
          valuesSnapshot: { reason: "公司项目资金到账", direction: "inflow" }
        }]
      })
    }));

    expect(html).toContain("第 1 次提交");
    expect(html).toContain("公司项目资金到账");
    expect(html).toContain("入账");
    expect(html).not.toContain("a04f6c0f-56ab-4dbf-b96d-968c31ff91b4");
    expect(html).not.toContain("fund_execution.case");
  });
});
