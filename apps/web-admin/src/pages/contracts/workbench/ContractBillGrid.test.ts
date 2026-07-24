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
  kind: string;
  options: unknown[];
  update: (value: unknown) => void;
  value: unknown;
}

const componentHarness = vi.hoisted(() => ({
  controls: [] as ControlHarness[],
  emitGridSource: undefined as ((rows: JgBusinessGridRow[]) => void) | undefined,
  focusGridRow: undefined as ((rowIndex: number) => void) | undefined,
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
      emits: ["update:source", "focus-row"],
      setup(props, { emit }) {
        componentHarness.gridSource = props.source as JgBusinessGridRow[];
        componentHarness.gridColumns = props.columns as ColumnRegular[];
        componentHarness.gridReadonly = props.readonly;
        componentHarness.emitGridSource = (rows) => emit("update:source", rows);
        componentHarness.focusGridRow = (rowIndex) => emit("focus-row", rowIndex);
        return () => render("div", { "data-testid": "jg-business-grid" });
      }
    })
  };
});

import ContractBillGrid, {
  advanceContractBillErrorCursor
} from "./ContractBillGrid.vue";

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarness();
});

function resetHarness() {
  componentHarness.controls = [];
  componentHarness.emitGridSource = undefined;
  componentHarness.focusGridRow = undefined;
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
  bill?: WorkbenchBill;
} = {}) {
  resetHarness();
  vi.stubGlobal("window", {
    matchMedia: () => mediaQuery(options.mobile ?? false)
  });
  const updates: ContractBillCandidateRow[][] = [];
  const selections: string[] = [];
  const app = createSSRApp(ContractBillGrid, {
    bill: options.bill ?? bill,
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
        modelValue: { type: [String, Boolean], default: "" },
        options: { type: Array, default: () => [] }
      },
      emits: ["update:modelValue"],
      setup(props, { attrs, emit }) {
        const field = String(attrs["data-field"] ?? "");
        const clientRowKey = String(attrs["data-client-row-key"] ?? "");
        componentHarness.controls.push({
          clientRowKey,
          disabled: props.disabled,
          field,
          kind: name,
          options: props.options,
          update: (value) => emit("update:modelValue", value),
          value: props.modelValue
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
      { key: "route", label: "运输路线" },
      { key: "fuelIncluded", label: "是否含燃油", type: "boolean", required: true },
      { key: "operatorIncluded", label: "是否带操作人员", type: "boolean", required: true }
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
      fuelIncluded: index === 0 ? "true" : "false",
      operatorIncluded: "false",
      legacyNote: "保留的历史字段"
    }
  }));
}

describe("ContractBillGrid", () => {
  it("renders one desktop grid and round-trips the complete candidate set", async () => {
    const rows = candidateRows(20);
    rows[0] = {
      ...rows[0]!,
      customData: {
        ...rows[0]!.customData,
        clientRowKey: "polluted-client-key",
        itemName: "被污染的名称"
      }
    };
    const rendered = await renderGrid({ rows, readonly: true });

    expect(rendered.html.match(/data-testid="jg-business-grid"/gu)).toHaveLength(1);
    expect(componentHarness.gridReadonly).toBe(true);
    expect(componentHarness.gridSource).toHaveLength(20);
    expect(componentHarness.gridSource[0]).toMatchObject({
      clientRowKey: "client-1",
      itemCode: "A-1",
      itemName: "材料 1",
      brand: "品牌 1",
      fuelIncluded: "true"
    });
    expect(componentHarness.gridSource[0]).not.toHaveProperty("legacyNote");

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
        fuelIncluded: "true",
        operatorIncluded: "false",
        clientRowKey: "polluted-client-key",
        itemName: "被污染的名称",
        legacyNote: "保留的历史字段"
      }
    });
    expect(rendered.updates.at(-1)?.[19]).toEqual(rows[19]);

    componentHarness.focusGridRow?.(7);
    expect(rendered.selections).toEqual(["client-8"]);
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
      "route",
      "fuelIncluded",
      "operatorIncluded"
    ]));
    expect(componentHarness.controls.filter(
      (control) => control.field === "fuelIncluded" || control.field === "operatorIncluded"
    ).every((control) => control.kind === "TSelect")).toBe(true);

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

    const first = advanceContractBillErrorCursor(0, "", errors);
    const changed = advanceContractBillErrorCursor(first.nextIndex, first.signature, [
      { clientRowKey: "client-2", field: "brand", message: "新的首项" },
      { clientRowKey: "client-1", field: "quantity", message: "新的第二项" }
    ]);
    expect(changed.error).toMatchObject({ clientRowKey: "client-2", field: "brand" });
    expect(changed.nextIndex).toBe(1);
  });

  it("preserves facts and marks cells when desktop constrained values are invalid", async () => {
    const rows = candidateRows(1);
    const rendered = await renderGrid({ rows });
    componentHarness.emitGridSource?.([{
      ...componentHarness.gridSource[0]!,
      taxRateSource: "任意税率",
      isProvisional: "maybe",
      fuelIncluded: "有"
    }]);

    expect(rendered.updates.at(-1)?.[0]).toEqual(rows[0]);
    for (const field of ["taxRateSource", "isProvisional", "fuelIncluded"]) {
      const column = componentHarness.gridColumns.find((candidate) => candidate.prop === field);
      expect(column?.cellProperties?.({
        model: componentHarness.gridSource[0],
        prop: field
      } as never)).toMatchObject({
        "aria-invalid": "true",
        "data-cell-error": `client-1:${field}`
      });
    }

    componentHarness.emitGridSource?.([{
      ...componentHarness.gridSource[0]!,
      taxRateSource: "version_default",
      isProvisional: "false",
      fuelIncluded: "否"
    }]);
    expect(rendered.updates.at(-1)?.[0]).toMatchObject({
      taxRateSource: "version_default",
      taxRatePercent: "13",
      isProvisional: false,
      customData: expect.objectContaining({ fuelIncluded: "false" })
    });
  });

  it("allows an optional boolean custom column to stay blank while required boolean stays enforced", async () => {
    const optionalBooleanBill: WorkbenchBill = {
      ...bill,
      schemaSnapshot: {
        columns: [
          {
            key: "fuelIncluded",
            label: "是否含燃油",
            type: "boolean",
            required: true
          },
          {
            key: "optionalFlag",
            label: "可选标记",
            type: "boolean",
            required: false
          }
        ]
      }
    };
    const rows = candidateRows(1);
    rows[0] = {
      ...rows[0]!,
      customData: {
        ...rows[0]!.customData,
        optionalFlag: ""
      }
    };
    const rendered = await renderGrid({ rows, bill: optionalBooleanBill });

    componentHarness.emitGridSource?.([{
      ...componentHarness.gridSource[0]!,
      itemName: "只修改名称"
    }]);

    expect(rendered.updates.at(-1)?.[0]?.itemName).toBe("只修改名称");
    expect(rendered.updates.at(-1)?.[0]?.customData).not.toHaveProperty("optionalFlag");
    const optionalColumn = componentHarness.gridColumns.find(
      (column) => column.prop === "optionalFlag"
    );
    expect(optionalColumn?.cellProperties?.({
      model: componentHarness.gridSource[0],
      prop: "optionalFlag"
    } as never)).toBeUndefined();

    componentHarness.emitGridSource?.([{
      ...componentHarness.gridSource[0]!,
      fuelIncluded: ""
    }]);

    expect(rendered.updates.at(-1)?.[0]?.customData).toMatchObject({
      fuelIncluded: "true"
    });
    const requiredColumn = componentHarness.gridColumns.find(
      (column) => column.prop === "fuelIncluded"
    );
    expect(requiredColumn?.cellProperties?.({
      model: componentHarness.gridSource[0],
      prop: "fuelIncluded"
    } as never)).toMatchObject({
      "aria-invalid": "true",
      "data-cell-error": "client-1:fuelIncluded"
    });
    expect(optionalColumn?.cellProperties?.({
      model: componentHarness.gridSource[0],
      prop: "optionalFlag"
    } as never)).toBeUndefined();
  });

  it("uses explicit mobile boolean tri-state controls without coercing unset to false", async () => {
    const triStateBill: WorkbenchBill = {
      ...bill,
      schemaSnapshot: {
        columns: [
          {
            key: "fuelIncluded",
            label: "是否含燃油",
            type: "boolean",
            required: true
          },
          {
            key: "optionalFlag",
            label: "可选标记",
            type: "boolean",
            required: false
          }
        ]
      }
    };
    const rows = candidateRows(1);
    const customData = { ...rows[0]!.customData };
    delete customData.fuelIncluded;
    rows[0] = {
      ...rows[0]!,
      customData: {
        ...customData,
        optionalFlag: "true"
      }
    };
    const rendered = await renderGrid({
      mobile: true,
      rows,
      bill: triStateBill
    });

    const requiredControl = componentHarness.controls.find(
      (control) => control.field === "fuelIncluded"
    );
    const optionalControl = componentHarness.controls.find(
      (control) => control.field === "optionalFlag"
    );
    expect(requiredControl).toMatchObject({
      kind: "TSelect",
      value: "",
      disabled: false
    });
    expect(requiredControl?.options).toEqual([
      { label: "未设置", value: "" },
      { label: "是", value: "true" },
      { label: "否", value: "false" }
    ]);
    expect(optionalControl).toMatchObject({
      kind: "TSelect",
      value: "true",
      disabled: false
    });
    expect(rendered.html).not.toContain("清单校验未通过");

    requiredControl?.update("false");
    expect(rendered.updates.at(-1)?.[0]?.customData).toMatchObject({
      fuelIncluded: "false"
    });

    optionalControl?.update("");
    expect(rendered.updates.at(-1)?.[0]?.customData).not.toHaveProperty("optionalFlag");

    await renderGrid({
      mobile: true,
      rows,
      bill: triStateBill,
      readonly: true
    });
    expect(componentHarness.controls.filter(
      (control) => control.field === "fuelIncluded" || control.field === "optionalFlag"
    ).every((control) => control.kind === "TSelect" && control.disabled)).toBe(true);
  });

  it("uses the existing unlimited-framework quantity label and optional rule", async () => {
    const unlimitedBill: WorkbenchBill = {
      ...bill,
      pricingNature: "framework",
      amountLimitType: "unlimited"
    };
    const rendered = await renderGrid({
      mobile: true,
      rows: candidateRows(1),
      bill: unlimitedBill
    });

    expect(rendered.html).toContain("预计数量");
    expect(rendered.html).not.toContain("预计数量 *");
    await renderGrid({ rows: candidateRows(1), bill: unlimitedBill });
    const quantity = componentHarness.gridColumns.find((column) => column.prop === "quantity");
    expect(quantity?.name).toBe("预计数量");
  });

  it("disables every mobile editor in readonly mode", async () => {
    await renderGrid({ mobile: true, rows: candidateRows(1), readonly: true });

    expect(componentHarness.controls.length).toBeGreaterThan(0);
    expect(componentHarness.controls.every((control) => control.disabled)).toBe(true);
  });
});
