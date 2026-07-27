import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import { describe, expect, it } from "vitest";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import {
  isSettlementSourceLineClosed,
  settlementBillGridColumns,
  settlementBillGridRows,
  settlementDraftsFromBillGridRows
} from "./settlement-bill-grid";

function sourceRow(overrides: Partial<SettlementSourceLineReadModel> = {}): SettlementSourceLineReadModel {
  return {
    id: "line-1",
    billId: "bill-1",
    billKey: "materials",
    billName: "材料清单",
    rowKey: "row-1",
    sortOrder: 1,
    itemCode: "A-1",
    itemName: "钢筋",
    specification: null,
    unit: "吨",
    quantity: "10",
    unitPrice: "2000",
    taxRatePercent: "13",
    taxExclusiveUnitPrice: "1769.9115",
    pricingFactStatus: "confirmed",
    calculationAvailable: true,
    submissionBlocker: null,
    amountRole: "included",
    pricingMode: "tax_inclusive",
    calculationMode: "normal_auto",
    contractAmountCents: "2000000",
    settledQuantity: "2",
    previousSettledQuantity: "2",
    remainingQuantity: "8",
    settledAmountCents: "400000",
    remainingAmountCents: "1600000",
    provisional: false,
    settlementBasis: null,
    exception: null,
    exceptions: [],
    ...overrides
  };
}

function isReadonly(column: ColumnRegular, model: JgBusinessGridRow) {
  expect(typeof column.readonly).toBe("function");
  return (column.readonly as (props: { model: JgBusinessGridRow }) => boolean)({ model });
}

describe("settlement bill grid adapter", () => {
  it("round-trips selected rows only and preserves each draft field", () => {
    const rows = settlementBillGridRows([
      sourceRow(),
      sourceRow({ id: "line-2", itemName: "水泥", calculationMode: "manual_amount" })
    ], {
      "line-2": { quantity: "", amountYuan: "3200.50", remark: "暂估" }
    });

    expect(rows[0]).toMatchObject({
      selected: "否",
      currentQuantity: "",
      currentAmount: "待后端核算",
      billName: "材料清单",
      previousSettledQuantity: "2"
    });
    expect(rows[1]).toMatchObject({ selected: "是", currentAmount: "3200.50", remark: "暂估" });
    expect(settlementDraftsFromBillGridRows(rows)).toEqual({
      "line-2": { quantity: "", amountYuan: "3200.50", remark: "暂估" }
    });
  });

  it("makes settled rows read-only and only permits manual amount input for selected manual rows", () => {
    const normal = settlementBillGridRows([sourceRow()], {})[0]!;
    const manual = settlementBillGridRows([
      sourceRow({ calculationMode: "manual_amount" })
    ], { "line-1": { quantity: "", amountYuan: "100", remark: "" } })[0]!;
    const closed = settlementBillGridRows([sourceRow({ remainingQuantity: "0" })], {})[0]!;
    const quantity = settlementBillGridColumns.find((column) => column.prop === "currentQuantity")!;
    const amount = settlementBillGridColumns.find((column) => column.prop === "currentAmount")!;
    const selected = settlementBillGridColumns.find((column) => column.prop === "selected")!;
    const itemName = settlementBillGridColumns.find((column) => column.prop === "itemName")!;

    expect(isSettlementSourceLineClosed(sourceRow({ remainingQuantity: "0.00" }))).toBe(true);
    expect(isSettlementSourceLineClosed(sourceRow({ remainingQuantity: null }))).toBe(false);
    expect(isReadonly(quantity, normal)).toBe(true);
    expect(isReadonly(amount, manual)).toBe(false);
    expect(isReadonly(amount, { ...normal, selected: "是" })).toBe(true);
    expect(isReadonly(selected, closed)).toBe(true);
    expect(selected.pin).toBe("colPinStart");
    expect(itemName.pin).toBe("colPinStart");
  });
});
