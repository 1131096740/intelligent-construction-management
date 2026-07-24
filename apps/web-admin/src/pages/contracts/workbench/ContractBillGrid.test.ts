import type { ColumnRegular } from "@revolist/vue3-datagrid";
/* eslint-disable vue/one-component-per-file */
import {
  createSSRApp,
  defineComponent,
  h,
  type App
} from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import type { WorkbenchBill } from "./contract-bill-editor";
import type {
  ContractBillCandidateRow,
  ContractBillCellError
} from "./contract-bill-grid";

interface ControlHarness {
  clientRowKey: string;
  disabled: boolean;
  field: string;
  update: (value: unknown) => void;
}

const componentHarness = vi.hoisted(() => ({
  controls: [] as ControlHarness[],
  emitGridSource: undefined as ((rows: JgBusinessGridRow[]) => void) | undefined,
  gridColumns: [] as ColumnRegular[],
  gridReadonly: false,
  gridSource: [] as JgBusinessGridRow[],
  selectNextError: undefined as (() => void) | undefined
}));

vi.mock("../../../components/JgBusinessGrid.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    default: define({
      name: "JgBusinessGrid",
      props: {
        source: { type: Array, required: true },
        columns: { type: Array, required: true },
        readonly: { type: Boolean, default: false }
      },
      emits: ["update:source"],
      setup(props, { emit }) {
        componentHarness.gridSource = props.source as JgBusinessGridRow[];
        componentHarness.gridColumns = props.columns as ColumnRegular[];
        componentHarness.gridReadonly = props.readonly;
        componentHarness.emitGridSource = (rows) => emit("update:source", rows);
        return () => render("div", { "data-testid": "jg-business-grid" });
      }
    })
  };
});

import ContractBillGrid from "./ContractBillGrid.vue";

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarness();
});

function resetHarness() {
  componentHarness.controls = [];
  componentHarness.emitGridSource = undefined;
  componentHarness.gridColumns = [];
  componentHarness.gridReadonly = false;
  componentHarness.gridSource = [];
  componentHarness.selectNextError = undefined;
}

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(max-width: 767px)",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true
  };
}

async function renderGrid(options: {
  mobile?: boolean;
  rows?: ContractBillCandidateRow[];
  errors?: ContractBillCellError[];
  readonly?: boolean;
} = {}) {
  resetHarness();
  vi.stubGlobal("window", {
    matchMedia: () => mediaQuery(options.mobile ?? false)
  });
  const updates: ContractBillCandidateRow[][] = [];
  const selections: string[] = [];
  const app = createSSRApp(ContractBillGrid, {
    bill,
    rows: options.rows ?? candidateRows(20),
    errors: options.errors ?? [],
    readonly: options.readonly ?? false,
    "onUpdate:rows": (rows: ContractBillCandidateRow[]) => updates.push(rows),
    onSelectRow: (clientRowKey: string) => selections.push(clientRowKey)
  });
  registerTDesignStubs(app);
  const html = await renderToString(app);
  return { html, updates, selections };
}

function registerTDesignStubs(app: App) {
  app.component("TCard", defineComponent({
    name: "TCard",
    setup(_props, { slots }) {
      return () => h("article", [slots.title?.(), slots.default?.()]);
    }
  }));
  app.component("TAlert", defineComponent({
    name: "TAlert",
    setup(_props, { slots }) {
      return () => h("aside", slots.default?.());
    }
  }));
  app.component("TButton", defineComponent({
    name: "TButton",
    inheritAttrs: false,
    emits: ["click"],
    setup(_props, { attrs, emit, slots }) {
      if (attrs["data-action"] === "next-error") {
        componentHarness.selectNextError = () => emit("click");
      }
      return () => h("button", attrs, slots.default?.());
    }
  }));
  for (const name of ["TInput", "TSelect", "TCheckbox"]) {
    app.component(name, defineComponent({
      name,
      inheritAttrs: false,
      props: {
        disabled: { type: Boolean, default: false },
        modelValue: { type: [String, Boolean], default: "" }
      },
      emits: ["update:modelValue"],
      setup(props, { attrs, emit }) {
        const field = String(attrs["data-field"] ?? "");
        const clientRowKey = String(attrs["data-client-row-key"] ?? "");
        componentHarness.controls.push({
          clientRowKey,
          disabled: props.disabled,
          field,
          update: (value) => emit("update:modelValue", value)
        });
        return () => h("span", {
          ...attrs,
          "data-disabled": String(props.disabled),
          "data-value": String(props.modelValue)
        });
      }
    }));
  }
}

const bill: WorkbenchBill = {
  id: "bill-1",
  billKey: "materials",
  name: "材料清单",
  revision: 7,
  taxMode: "multiple_rate",
  defaultTaxRatePercent: "13",
  schemaSnapshot: {
    columns: [
      { key: "itemName", label: "名称", required: true },
      { key: "taxInclusiveAmount", label: "含税金额" },
      { key: "brand", label: "品牌", required: true },
      { key: "route", label: "运输路线" }
    ]
  },
  rows: []
};

function candidateRows(count: number): ContractBillCandidateRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    clientRowKey: `client-${index + 1}`,
    rowKey: `server-${index + 1}`,
    itemCode: `A-${index + 1}`,
    itemName: `材料 ${index + 1}`,
    specification: "HRB400",
    unit: "吨",
    quantity: "1.123",
    unitPrice: "2.345",
    taxRatePercent: "9",
    taxRateSource: "row_override",
    precisionPolicy: "legacy",
    initialQuantity: "1.123",
    initialUnitPrice: "2.345",
    initialTaxRatePercent: "9",
    isProvisional: index === 0,
    settlementBasis: "实测实量",
    customData: {
      brand: `品牌 ${index + 1}`,
      route: "一号线",
      legacyNote: "保留的历史字段"
    }
  }));
}

describe("ContractBillGrid", () => {
  it("renders one desktop grid and round-trips the complete candidate set", async () => {
    const rows = candidateRows(20);
    const rendered = await renderGrid({ rows, readonly: true });

    expect(rendered.html.match(/data-testid="jg-business-grid"/gu)).toHaveLength(1);
    expect(componentHarness.gridReadonly).toBe(true);
    expect(componentHarness.gridSource).toHaveLength(20);
    expect(componentHarness.gridSource[0]).toMatchObject({
      clientRowKey: "client-1",
      itemCode: "A-1",
      brand: "品牌 1"
    });

    const editedGridRows = componentHarness.gridSource.map((row, index) => (
      index === 0 ? { ...row, itemName: "修改后的钢筋", brand: "新品牌" } : { ...row }
    ));
    componentHarness.emitGridSource?.(editedGridRows);

    expect(rendered.updates.at(-1)).toHaveLength(20);
    expect(rendered.updates.at(-1)?.[0]).toEqual({
      ...rows[0],
      itemName: "修改后的钢筋",
      customData: {
        brand: "新品牌",
        route: "一号线",
        legacyNote: "保留的历史字段"
      }
    });
    expect(rendered.updates.at(-1)?.[19]).toEqual(rows[19]);
  });

  it("renders mobile cards for every editable core and custom field using the same row type", async () => {
    const rows = candidateRows(2);
    const rendered = await renderGrid({ mobile: true, rows });

    expect(rendered.html).not.toContain("data-testid=\"jg-business-grid\"");
    expect(rendered.html).toContain("第 1 行");
    expect(new Set(componentHarness.controls.map((control) => control.field))).toEqual(new Set([
      "itemCode",
      "itemName",
      "specification",
      "unit",
      "quantity",
      "unitPrice",
      "taxRateSource",
      "taxRatePercent",
      "isProvisional",
      "settlementBasis",
      "brand",
      "route"
    ]));

    const itemName = componentHarness.controls.find(
      (control) => control.field === "itemName" && control.clientRowKey === "client-1"
    );
    expect(itemName).toBeDefined();
    itemName?.update("移动端修改");

    expect(rendered.updates.at(-1)).toHaveLength(2);
    expect(rendered.updates.at(-1)?.[0]).toEqual({ ...rows[0], itemName: "移动端修改" });
    expect(rendered.updates.at(-1)?.[1]).toEqual(rows[1]);
  });

  it("marks structured error cells and cycles the next-error row event", async () => {
    const errors: ContractBillCellError[] = [
      { clientRowKey: "client-1", field: "quantity", message: "数量错误" },
      { clientRowKey: "client-2", field: "brand", message: "请填写品牌" }
    ];
    const rendered = await renderGrid({ rows: candidateRows(2), errors });

    expect(rendered.html).toContain("共 2 处需修正");
    expect(rendered.html).toContain("数量错误");
    const quantityColumn = componentHarness.gridColumns.find(
      (column) => column.prop === "quantity"
    );
    const firstCell = quantityColumn?.cellProperties?.({
      model: componentHarness.gridSource[0],
      prop: "quantity"
    } as never);
    expect(firstCell).toMatchObject({
      "aria-invalid": "true",
      "data-cell-error": "client-1:quantity",
      title: "数量错误"
    });

    componentHarness.selectNextError?.();
    componentHarness.selectNextError?.();
    expect(rendered.selections).toEqual(["client-1", "client-2"]);
  });

  it("disables every mobile editor in readonly mode", async () => {
    await renderGrid({ mobile: true, rows: candidateRows(1), readonly: true });

    expect(componentHarness.controls.length).toBeGreaterThan(0);
    expect(componentHarness.controls.every((control) => control.disabled)).toBe(true);
  });
});
