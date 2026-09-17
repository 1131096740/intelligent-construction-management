/* eslint-disable vue/one-component-per-file */
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it, vi } from "vitest";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const grid = vi.hoisted(() => ({ edit: undefined as ((detail: unknown) => void) | undefined, columns: [] as Array<{ name: string }> }));
// Only the third-party grid boundary is substituted; both application adapters run.
vi.mock("@revolist/vue3-datagrid", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { columns: { type: Array, default: () => [] } },
      emits: ["afteredit", "afterfocus"],
      setup(props, { emit }) {
        grid.columns = props.columns as Array<{ name: string }>;
        grid.edit = (detail) => emit("afteredit", { detail });
        return () => h("div");
      }
    }),
    VGridVueEditor: vi.fn(() => "external-select-editor")
  };
});
import BusinessEntryGrid from "./BusinessEntryGrid.vue";
import ExpenseClaimLineEditor from "../pages/expense-claims/components/ExpenseClaimLineEditor.vue";

it("编辑尚未创建业务单据的本地草稿行不会丢行或伪造正式目标", async () => {
  const definition: BusinessEntrySceneDefinition = {
    key: "expense_claim.application", entityType: "expense_claim", name: "费用明细", description: "费用", version: 1,
    fields: [{
      key: "amountYuan", label: "费用金额", type: "money", scope: "line", unit: "元", precision: 2,
      description: "费用金额", example: "0.01", required: true, permissions: { view: [], edit: [] },
      display: { formHint: "请填写金额", gridColumn: "费用金额", mobilePriority: 1, readonlyText: "费用金额" },
      excel: { column: "费用金额", paste: "multi", errorLocation: "cell" },
      bulk: { enabled: true, maxRows: 200, strategy: "append" }
    }], rules: []
  };
  const original: BusinessEntryDraftPayload[] = [{ sceneKey: definition.key, definitionVersion: 1, values: { amountYuan: "1.00" } }];
  const updates: BusinessEntryDraftPayload[][] = [];
  const app = createSSRApp(BusinessEntryGrid, { definition, modelValue: original, "onUpdate:modelValue": (value: BusinessEntryDraftPayload[]) => updates.push(value) });
  app.component("TAlert", defineComponent({ setup: () => () => h("aside") }));
  await renderToString(app);
  grid.edit!({ rowIndex: 0, prop: "amountYuan", val: "0.01" });
  expect(updates).toEqual([[{ sceneKey: definition.key, definitionVersion: 1, values: { amountYuan: "0.01" } }]]);
  expect(original[0].values.amountYuan).toBe("1.00");
  expect(updates[0][0]).not.toHaveProperty("target");
});

it("费用明细桌面编辑使用后台字段列名并保留精确元值", async () => {
  const definition: BusinessEntrySceneDefinition = {
    key: "expense_claim.application", entityType: "expense_claim", name: "费用申请", description: "费用", version: 2,
    fields: [{
      key: "amountYuan", label: "发生金额", type: "money", scope: "line", unit: "元", precision: 2,
      description: "费用金额", example: "0.01", required: true, permissions: { view: [], edit: [] },
      display: { formHint: "请填写金额", gridColumn: "发生金额", mobilePriority: 1, readonlyText: "发生金额" },
      excel: { column: "发生金额", paste: "multi", errorLocation: "cell" },
      bulk: { enabled: true, maxRows: 200, strategy: "append" }
    }], rules: []
  };
  const updates: Array<Array<{ amountYuan: string }>> = [];
  const app = createSSRApp(ExpenseClaimLineEditor, {
    definition,
    modelValue: [{ expenseCategory: "交通", occurredOn: "2026-09-17", purpose: "办事", receiptCount: "1", amountYuan: "1.00", evidenceType: "invoice", noEvidenceReason: "", remark: "" }],
    "onUpdate:modelValue": (value: Array<{ amountYuan: string }>) => updates.push(value)
  });
  app.component("TButton", defineComponent({ setup: (_props, { slots }) => () => h("button", slots.default?.()) }));
  app.component("TAlert", defineComponent({ setup: () => () => h("aside") }));
  await renderToString(app);
  expect(grid.columns.map((column) => column.name)).toEqual(["发生金额 *"]);
  grid.edit!({ rowIndex: 0, prop: "amountYuan", val: "0.01" });
  expect(updates[0][0].amountYuan).toBe("0.01");
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  try {
    const mobile = createSSRApp(ExpenseClaimLineEditor, {
      definition,
      modelValue: [{ expenseCategory: "交通", occurredOn: "2026-09-17", purpose: "办事", receiptCount: "1", amountYuan: "0.01", evidenceType: "invoice", noEvidenceReason: "", remark: "" }]
    });
    for (const name of ["TButton", "TCard", "TAlert"]) {
      mobile.component(name, defineComponent({ setup: (_props, { slots }) => () => h("section", slots.default?.()) }));
    }
    for (const name of ["TInput", "TTextarea", "TSelect", "TDatePicker"]) {
      mobile.component(name, defineComponent({ props: { modelValue: { type: String, default: "" } }, setup: (props) => () => h("input", { value: props.modelValue }) }));
    }
    const html = await renderToString(mobile);
    expect(html).toContain("费用申请移动业务卡片");
    expect(html).toContain("发生金额");
    expect(html).toContain('value="0.01"');
  } finally { vi.unstubAllGlobals(); }
});
