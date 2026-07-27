import type { ColumnRegular } from "@revolist/vue3-datagrid";
import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import {
  settlementQuantityProgress,
  type SourceLineDraftMap
} from "../settlement-workbench.state";

const SELECTED = "是";
const UNSELECTED = "否";

export function isSettlementSourceLineClosed(row: SettlementSourceLineReadModel) {
  if (row.remainingQuantity === null) return false;
  const remaining = Number(row.remainingQuantity);
  return Number.isFinite(remaining) && remaining <= 0;
}

export function settlementBillGridRows(
  sourceRows: readonly SettlementSourceLineReadModel[],
  drafts: SourceLineDraftMap,
  previewAmounts: Readonly<Record<string, string>> = {}
): JgBusinessGridRow[] {
  return sourceRows.map((row) => {
    const draft = drafts[row.id];
    const quantity = draft?.quantity || (row.calculationMode === "manual_amount" ? "0" : "");
    const progress = draft
      ? settlementQuantityProgress(row.quantity, row.previousSettledQuantity, quantity)
      : { cumulative: row.previousSettledQuantity, remaining: row.remainingQuantity };
    return {
      rowId: row.id,
      selected: draft ? SELECTED : UNSELECTED,
      billName: row.billName,
      itemName: `${row.itemCode ?? ""} ${row.itemName}`.trim(),
      calculationMode: row.calculationMode === "normal_auto" ? "自动计价" : "手工金额",
      unit: row.unit,
      contractQuantity: row.quantity ?? "待核对",
      contractUnitPrice: row.unitPrice === null
        ? "待确认"
        : `${row.unitPrice} 元（${row.pricingMode === "tax_inclusive" ? "含税" : "不含税"}）`,
      previousSettledQuantity: row.previousSettledQuantity ?? "待核对",
      cumulativeQuantity: progress.cumulative ?? "待核对",
      remainingQuantity: progress.remaining ?? "待核对",
      closed: isSettlementSourceLineClosed(row) ? "true" : "false",
      currentQuantity: draft?.quantity ?? "",
      currentAmount: row.calculationMode === "manual_amount"
        ? draft?.amountYuan ?? ""
        : previewAmounts[row.id] ?? "待后端核算",
      remark: draft?.remark ?? "",
      exception: String(Array.isArray(row.exceptions) ? row.exceptions.length : row.exception ? 1 : 0)
    };
  });
}

export function settlementDraftsFromBillGridRows(
  rows: readonly JgBusinessGridRow[]
): SourceLineDraftMap {
  const next: SourceLineDraftMap = {};
  for (const row of rows) {
    const rowId = row.rowId ?? "";
    if (!rowId || String(row.selected).trim() !== SELECTED) continue;
    next[rowId] = {
      quantity: String(row.currentQuantity ?? ""),
      amountYuan: row.calculationMode === "手工金额" ? String(row.currentAmount ?? "") : "",
      remark: String(row.remark ?? "")
    };
  }
  return next;
}

function isSelected(model: JgBusinessGridRow) {
  return String(model.selected ?? "").trim() === SELECTED;
}

function isClosed(model: JgBusinessGridRow) {
  return model.closed === "true";
}

export const settlementBillGridColumns: ColumnRegular[] = [
  {
    prop: "selected",
    name: "选择（填写是/否）",
    size: 120,
    pin: "colPinStart",
    readonly: ({ model }) => isClosed(model as JgBusinessGridRow)
  },
  { prop: "itemName", name: "合同清单项", size: 220, pin: "colPinStart", readonly: true },
  { prop: "billName", name: "原清单分组", size: 140, readonly: true },
  { prop: "calculationMode", name: "计价方式", size: 110, readonly: true },
  { prop: "unit", name: "单位", size: 72, readonly: true },
  { prop: "contractQuantity", name: "合同数量", size: 110, readonly: true },
  { prop: "contractUnitPrice", name: "合同单价", size: 160, readonly: true },
  { prop: "previousSettledQuantity", name: "前期已结算", size: 120, readonly: true },
  { prop: "remainingQuantity", name: "剩余可结算", size: 120, readonly: true },
  {
    prop: "currentQuantity",
    name: "本期数量",
    size: 130,
    readonly: ({ model }) => !isSelected(model as JgBusinessGridRow) || isClosed(model as JgBusinessGridRow)
  },
  {
    prop: "currentAmount",
    name: "本期金额（手工金额）",
    size: 160,
    readonly: ({ model }) => !isSelected(model as JgBusinessGridRow) ||
      isClosed(model as JgBusinessGridRow) ||
      model.calculationMode !== "手工金额"
  },
  {
    prop: "remark",
    name: "本期备注",
    size: 180,
    readonly: ({ model }) => !isSelected(model as JgBusinessGridRow) || isClosed(model as JgBusinessGridRow)
  },
  { prop: "cumulativeQuantity", name: "累计结算", size: 110, readonly: true },
  { prop: "exception", name: "异常数", size: 80, readonly: true }
];
