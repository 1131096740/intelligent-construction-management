import type { ColumnRegular } from "@revolist/vue3-datagrid";

export type JgBusinessGridRow = Record<string, string>;

export const JG_BUSINESS_SEARCH_SELECT_EDITOR = "jg-business-search-select";

export interface JgBusinessGridColumn extends ColumnRegular {
  businessSelectOptions?: ReadonlyArray<{ label: string; value: string }>;
  businessSelectMultiple?: boolean;
}

export interface JgBusinessGridCellEdit {
  rowIndex: number;
  prop: string;
  val: unknown;
}

export interface JgBusinessGridRangeEdit {
  data: Record<number, Partial<JgBusinessGridRow>>;
}

export function applyJgBusinessGridEdit(
  rows: readonly JgBusinessGridRow[],
  detail: JgBusinessGridCellEdit | JgBusinessGridRangeEdit
): JgBusinessGridRow[] {
  if ("rowIndex" in detail) {
    return rows.map((row, index) => index === detail.rowIndex
      ? { ...row, [detail.prop]: String(detail.val ?? "") }
      : { ...row });
  }

  return rows.map((row, index) => {
    const patch = Object.fromEntries(
      Object.entries(detail.data[index] ?? {}).filter(([, value]) => value !== undefined)
    ) as JgBusinessGridRow;
    return { ...row, ...patch };
  });
}
