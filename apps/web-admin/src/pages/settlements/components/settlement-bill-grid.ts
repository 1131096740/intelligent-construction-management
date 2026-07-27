import type { ColumnRegular } from "@revolist/vue3-datagrid";
import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import type { SourceLineDraftMap } from "../settlement-workbench.state";

const SELECTED = "是";
const UNSELECTED = "否";

export function isSettlementSourceLineClosed(row: SettlementSourceLineReadModel) {
  if (row.remainingQuantity === null) return false;
  const remaining = Number(row.remainingQuantity);
  return Number.isFinite(remaining) && remaining <= 0;
}

export function settlementBillGridRows(
  sourceRows: readonly SettlementSourceLineReadModel[],
  drafts: SourceLineDraftMap
): JgBusinessGridRow[] {
  return sourceRows.map((row) => {
    const draft = drafts[row.id];
    return {
      rowId: row.id,
      selected: draft ? SELECTED : UNSELECTED,
      itemName: `${row.itemCode ?? ""} ${row.itemName}`.trim(),
      unit: row.unit,
      remainingQuantity: row.remainingQuantity ?? "待核对",
      calculationMode: row.calculationMode,
      closed: isSettlementSourceLineClosed(row) ? "true" : "false",
      currentQuantity: draft?.quantity ?? "",
      currentAmount: draft?.amountYuan ?? "",
      remark: draft?.remark ?? ""
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
      amountYuan: String(row.currentAmount ?? ""),
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
    readonly: ({ model }) => isClosed(model as JgBusinessGridRow)
  },
  { prop: "itemName", name: "合同清单项", size: 220, readonly: true },
  { prop: "unit", name: "单位", size: 72, readonly: true },
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
      model.calculationMode !== "manual_amount"
  },
  {
    prop: "remark",
    name: "本期备注",
    size: 180,
    readonly: ({ model }) => !isSelected(model as JgBusinessGridRow) || isClosed(model as JgBusinessGridRow)
  }
];
