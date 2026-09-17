import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import PaymentFinanceEntryForm from "./PaymentFinanceEntryForm.vue";

describe("付款财务入账统一字段", () => {
  it("使用服务端金额元数据并保留入账时间的秒值和日期时间控件", async () => {
    const field = (key: string, label: string, type: BusinessEntryFieldDefinition["type"]): BusinessEntryFieldDefinition => ({
      key, label, type, scope: "header", description: label, example: "", unit: "", precision: 2,
      required: true, permissions: { view: ["finance_staff"], edit: ["finance_staff"] },
      bulk: { enabled: false, strategy: "replace" }, excel: { column: label, paste: "single", errorLocation: "cell" },
      display: { formHint: `${label}填写提示`, gridColumn: label, mobilePriority: 1, readonlyText: label }
    });
    const definition: BusinessEntrySceneDefinition = {
      key: "payment_finance_record", entityType: "finance_record", version: 1,
      name: "财务入账", description: "原付款入账", rules: [],
      fields: [field("amountYuan", "本次财务入账金额", "money"), field("occurredAt", "本次入账发生时间", "text")]
    };
    const app = createSSRApp(PaymentFinanceEntryForm, {
      definition, amountYuan: "123.45", occurredAt: "2026-09-17 12:34:56", disabled: false
    });
    app.component("TInput", (props: Record<string, unknown>) => h("input", props));
    app.component("TDatePicker", (props: Record<string, unknown>) => h("input", {
      "data-time-picker": String(props["enable-time-picker"] !== undefined), "data-value-type": props["value-type"],
      value: props["model-value"], placeholder: props.placeholder
    }));
    for (const name of ["TSelect", "TTextarea", "TAlert"]) app.component(name, () => h("span"));
    const html = await renderToString(app);
    expect(html).toContain("本次财务入账金额");
    expect(html).toContain("本次入账发生时间");
    expect(html).toContain("2026-09-17 12:34:56");
    expect(html).toContain('data-time-picker="true"');
    expect(html).toContain('data-value-type="YYYY-MM-DD HH:mm:ss"');
    expect(html).toContain("123.45");
  });
});
