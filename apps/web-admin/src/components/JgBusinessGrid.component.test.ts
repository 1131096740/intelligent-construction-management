/* eslint-disable vue/one-component-per-file */
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editors } from "@revolist/vue3-datagrid";
import {
  JG_BUSINESS_SEARCH_SELECT_EDITOR,
  type JgBusinessGridRow
} from "./jg-business-grid.config";

const harness = vi.hoisted(() => ({
  editors: {} as Editors,
  emitEdit: undefined as ((detail: unknown) => void) | undefined
}));

vi.mock("@revolist/vue3-datagrid", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "RevoGridStub",
      props: { editors: { type: Object, default: () => ({}) } },
      emits: ["afteredit", "afterfocus"],
      setup(props, { emit }) {
        harness.editors = props.editors as Editors;
        harness.emitEdit = (detail) => emit("afteredit", { detail });
        return () => h("div");
      }
    }),
    VGridVueEditor: vi.fn(() => "business-select-editor")
  };
});

import JgBusinessGrid from "./JgBusinessGrid.vue";

beforeEach(() => {
  harness.editors = {};
  harness.emitEdit = undefined;
});

describe("JgBusinessGrid editor registry", () => {
  it("registers the opt-in business selector without changing ordinary text edits", async () => {
    const source = [{ name: "原值" }];
    const updates: JgBusinessGridRow[][] = [];
    await renderToString(createSSRApp(JgBusinessGrid, {
      source,
      columns: [{ prop: "name", name: "名称" }],
      "onUpdate:source": (value: JgBusinessGridRow[]) => updates.push(value)
    }));

    expect(harness.editors[JG_BUSINESS_SEARCH_SELECT_EDITOR]).toBe("business-select-editor");
    harness.emitEdit?.({ rowIndex: 0, prop: "name", val: "新值" });
    expect(updates).toEqual([[{ name: "新值" }]]);
    expect(source).toEqual([{ name: "原值" }]);
  });
});
