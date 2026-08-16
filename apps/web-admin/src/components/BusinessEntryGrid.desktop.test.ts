/* eslint-disable vue/one-component-per-file */
import type { JgBusinessGridColumn, JgBusinessGridRow } from "./jg-business-grid.config";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { JG_BUSINESS_SEARCH_SELECT_EDITOR } from "./jg-business-grid.config";

const harness = vi.hoisted(() => ({
  columns: [] as JgBusinessGridColumn[],
  emitSource: undefined as ((rows: JgBusinessGridRow[]) => void) | undefined,
  source: [] as JgBusinessGridRow[]
}));

vi.mock("./JgBusinessGrid.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    default: define({
      name: "JgBusinessGrid",
      props: {
        columns: { type: Array, required: true },
        source: { type: Array, required: true }
      },
      emits: ["update:source"],
      setup(props, { emit }) {
        harness.columns = props.columns as JgBusinessGridColumn[];
        harness.source = props.source as JgBusinessGridRow[];
        harness.emitSource = (rows) => emit("update:source", rows);
        return () => render("div", { "data-testid": "business-grid" });
      }
    })
  };
});

import BusinessEntryGrid from "./BusinessEntryGrid.vue";

const roles = ["finance_staff"] as const;
const fieldBase = {
  description: "业务字段",
  example: "示例",
  scope: "line" as const,
  unit: "",
  precision: 0,
  required: true,
  permissions: { view: roles, edit: roles },
  bulk: { enabled: true, maxRows: 10, strategy: "append" as const },
  display: {
    formHint: "请填写",
    gridColumn: "业务字段",
    mobilePriority: 1,
    readonlyText: "按提交快照展示"
  }
};
const definition: BusinessEntrySceneDefinition = {
  key: "expense_line",
  entityType: "operating_takeover_row",
  name: "费用明细",
  description: "费用明细录入",
  version: 3,
  fields: [
    {
      ...fieldBase,
      key: "companyId",
      label: "我方公司",
      type: "company",
      excel: { column: "我方公司", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "status",
      label: "办理状态",
      type: "single_select",
      options: [
        { label: "待办理", value: "pending" },
        { label: "已完成", value: "completed" }
      ],
      excel: { column: "办理状态", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "completionNote",
      label: "完成说明",
      type: "text",
      visibleWhen: { fieldKey: "status", operator: "eq", value: "completed" },
      excel: { column: "完成说明", paste: "multi", errorLocation: "cell" }
    }
  ],
  rules: []
};
const target = { entityType: "operating_takeover_row", entityId: "project-1" };

beforeEach(() => {
  harness.columns = [];
  harness.emitSource = undefined;
  harness.source = [];
});

describe("BusinessEntryGrid desktop adapter", () => {
  it("opts business references and enums into searchable label/value editing", async () => {
    const updates: BusinessEntryDraftPayload[][] = [];
    const app = createSSRApp(BusinessEntryGrid, {
      definition,
      optionsByField: {
        companyId: [{ label: "我方一公司", value: "company-internal-1" }]
      },
      modelValue: [
        {
          sceneKey: definition.key,
          definitionVersion: definition.version,
          target,
          values: { companyId: "company-internal-1", status: "pending" }
        },
        {
          sceneKey: definition.key,
          definitionVersion: definition.version,
          target,
          values: { companyId: "unknown-company-id", status: "unknown_status" }
        }
      ],
      "onUpdate:modelValue": (value: BusinessEntryDraftPayload[]) => updates.push(value)
    });
    app.component("TAlert", defineComponent({
      name: "TAlert",
      setup() {
        return () => h("aside");
      }
    }));

    await renderToString(app);

    expect(harness.source).toEqual([
      { companyId: "我方一公司", status: "待办理" },
      { companyId: "未识别的业务对象", status: "未识别的业务选项" }
    ]);
    expect(JSON.stringify(harness.source)).not.toContain("unknown-company-id");
    expect(JSON.stringify(harness.source)).not.toContain("unknown_status");
    expect(harness.columns.map((column) => column.prop)).toEqual(["companyId", "status"]);
    expect(harness.columns[0]).toMatchObject({
      editor: JG_BUSINESS_SEARCH_SELECT_EDITOR,
      businessSelectOptions: [{ label: "我方一公司", value: "company-internal-1" }]
    });
    expect(harness.columns[1]).toMatchObject({
      editor: JG_BUSINESS_SEARCH_SELECT_EDITOR,
      businessSelectOptions: definition.fields[1]!.options
    });

    harness.emitSource?.([
      { companyId: "我方一公司", status: "待办理" },
      { companyId: "未识别的业务对象", status: "未识别的业务选项" }
    ]);
    expect(updates[0]?.map((draft) => draft.values)).toEqual([
      { companyId: "company-internal-1", status: "pending" },
      { companyId: "unknown-company-id", status: "unknown_status" }
    ]);
  });

  it("keeps business references in the searchable selector when no options are available", async () => {
    const app = createSSRApp(BusinessEntryGrid, {
      definition,
      modelValue: [{
        sceneKey: definition.key,
        definitionVersion: definition.version,
        target,
        values: { companyId: "unknown-company-id", status: "pending" }
      }]
    });
    app.component("TAlert", defineComponent({
      name: "TAlert",
      setup() {
        return () => h("aside");
      }
    }));

    await renderToString(app);

    expect(harness.columns[0]).toMatchObject({
      editor: JG_BUSINESS_SEARCH_SELECT_EDITOR,
      businessSelectOptions: []
    });
  });
});
