/* eslint-disable vue/one-component-per-file */
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import ExpenseClaimPayeeFields from "./ExpenseClaimPayeeFields.vue";

function definition(): BusinessEntrySceneDefinition {
  const base = {
    description: "", example: "合成收款对象", scope: "header" as const, unit: "", precision: 0,
    required: false, permissions: { view: [], edit: [] },
    display: { formHint: "请填写", gridColumn: "字段", mobilePriority: 1, readonlyText: "已提交" },
    excel: { column: "字段", paste: "single" as const, errorLocation: "cell" as const },
    bulk: { enabled: true, maxRows: 200, strategy: "append" as const }
  };
  return { key: "expense_claim.application", entityType: "expense_claim", name: "费用申请", description: "申请", version: 1,
    fields: [
      { ...base, key: "payeeName", label: "收款对象", type: "text" },
      { ...base, key: "payeeBankAccount", label: "收款账号", type: "text" },
      { ...base, key: "loanExpectedClearanceOn", label: "预计清账日期", type: "date" }
    ], rules: [] };
}

async function render(isIncidental: boolean, isLoan = false) {
  const source = definition();
  const app = createSSRApp(ExpenseClaimPayeeFields, {
    definition: source, isIncidental, isLoan,
    modelValue: { payeeName: "", payeeAccountName: "", payeeBankName: "", payeeBankAccount: "", loanExpectedClearanceOn: "" }
  });
  for (const name of ["TInput", "TDatePicker"]) app.component(name, defineComponent({ setup: () => () => h("input") }));
  const html = await renderToString(app);
  expect(source.fields.every(field => !field.required)).toBe(true);
  return html;
}

describe("费用收款必填提示", () => {
  it("零星费用标明收款对象必填，不把银行账号变成必填", async () => {
    const html = await render(true);
    expect(html).toMatch(/收款对象 \*/);
    expect(html).not.toMatch(/收款账号 \*/);
    expect(html).not.toContain("预计清账日期");
  });
  it.each([false, true])("报销及借款保留原收款对象可选规则，借款=%s", async isLoan => {
    const html = await render(false, isLoan);
    expect(html).not.toMatch(/收款对象 \*/);
    if (isLoan) expect(html).toMatch(/预计清账日期 \*/);
  });
});
