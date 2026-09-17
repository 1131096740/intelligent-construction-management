/* eslint-disable vue/one-component-per-file */
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import ExpenseClaimApplicationFields from "./ExpenseClaimApplicationFields.vue";

describe("费用申请统一字段", () => {
  it("使用服务端标题和金额定义，不显示其他步骤或明细字段", async () => {
    const base = {
      description: "填写说明", example: "示例", scope: "header" as const,
      unit: "", precision: 0, required: true,
      permissions: { view: [], edit: [] },
      display: { formHint: "请填写", gridColumn: "字段", mobilePriority: 1, readonlyText: "已提交" },
      excel: { column: "字段", paste: "single" as const, errorLocation: "cell" as const },
      bulk: { enabled: true, maxRows: 200, strategy: "append" as const }
    };
    const definition: BusinessEntrySceneDefinition = {
      key: "expense_claim.application", entityType: "expense_claim", name: "费用申请", description: "申请", version: 7,
      fields: [
        { ...base, key: "reason", label: "本次费用用途", type: "long_text" },
        { ...base, key: "requestedAmountYuan", label: "本次申请金额", type: "money", unit: "元", precision: 2 },
        { ...base, key: "companyEntityId", label: "其他步骤单位", type: "company" },
        { ...base, key: "purpose", label: "明细用途", type: "text", scope: "line" }
      ], rules: []
    };
    const changes: unknown[] = [];
    const controls = new Map<string, (value: string) => void>();
    const app = createSSRApp(ExpenseClaimApplicationFields, {
      definition, modelValue: { reason: "交通费", requestedAmountYuan: "123.45" },
      "onUpdate:modelValue": (value: unknown) => changes.push(value)
    });
    for (const name of ["TInput", "TTextarea", "TSelect", "TDatePicker"]) {
      app.component(name, defineComponent({
        props: { modelValue: { type: String, default: "" } }, emits: ["update:modelValue"],
        setup: (props, { attrs, emit }) => {
          controls.set(String(attrs["data-field"]), (value) => emit("update:modelValue", value));
          return () => h("input", { value: props.modelValue });
        }
      }));
    }
    const html = await renderToString(app);
    expect(html).toContain("本次费用用途");
    expect(html).toContain("本次申请金额");
    expect(html).toContain("123.45");
    expect(html).toContain("交通费");
    expect(html).not.toContain("其他步骤单位");
    expect(html).not.toContain("明细用途");
    controls.get("requestedAmountYuan")!("0.01");
    expect(changes).toEqual([{ reason: "交通费", requestedAmountYuan: "0.01" }]);
  });
});
