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

export interface JgBusinessGridFocus {
  rowIndex: number;
  colIndex: number;
}

function validPasteFocus(focus: JgBusinessGridFocus | null): JgBusinessGridFocus | null {
  return focus
    && Number.isSafeInteger(focus.rowIndex)
    && focus.rowIndex >= 0
    && Number.isSafeInteger(focus.colIndex)
    && focus.colIndex >= 0
    ? focus
    : null;
}

export function resolveJgBusinessGridPasteFocus(
  path: readonly EventTarget[],
  fallback: JgBusinessGridFocus | null
): JgBusinessGridFocus | null {
  for (const target of path) {
    const getAttribute = (target as { getAttribute?: (name: string) => string | null }).getAttribute;
    if (typeof getAttribute !== "function") continue;
    const row = getAttribute.call(target, "data-rgrow");
    const column = getAttribute.call(target, "data-rgcol");
    if (row === null || column === null) continue;
    return validPasteFocus({ rowIndex: Number(row), colIndex: Number(column) })
      ?? validPasteFocus(fallback);
  }
  return validPasteFocus(fallback);
}

export function parseJgBusinessGridClipboardText(text: string): string[][] | null {
  if (!text) return null;
  const rows = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (rows.at(-1) === "") rows.pop();
  return rows.length > 0 ? rows.map((row) => row.split("\t")) : null;
}

export function expandJgBusinessGridPaste(
  rows: readonly JgBusinessGridRow[],
  columns: readonly JgBusinessGridColumn[],
  focus: JgBusinessGridFocus,
  parsed: readonly (readonly string[])[]
): JgBusinessGridRow[] | null {
  if (
    !Number.isSafeInteger(focus.rowIndex)
    || focus.rowIndex < 0
    || focus.rowIndex >= rows.length
    || !Number.isSafeInteger(focus.colIndex)
    || focus.colIndex < 0
    || parsed.length === 0
    || parsed.some((row) => !Array.isArray(row))
    || focus.rowIndex + parsed.length <= rows.length
  ) {
    return null;
  }
  const widestRow = Math.max(...parsed.map((row) => row.length));
  const targetedColumns = columns.slice(focus.colIndex, focus.colIndex + widestRow);
  if (
    targetedColumns.length === 0
    || targetedColumns.some((column) => typeof column.readonly === "function")
  ) {
    return null;
  }
  const readonlyBoundary = targetedColumns.findIndex((column) => column.readonly === true);

  const rowShape = Object.fromEntries(
    [...new Set([
      ...rows.flatMap((row) => Object.keys(row)),
      ...columns.flatMap((column) => typeof column.prop === "string" ? [column.prop] : [])
    ])].map((key) => [key, ""])
  ) as JgBusinessGridRow;
  const result = rows.map((row) => ({ ...row }));
  while (result.length < focus.rowIndex + parsed.length) result.push({ ...rowShape });

  parsed.forEach((values, rowOffset) => {
    const rowIndex = focus.rowIndex + rowOffset;
    const patch: JgBusinessGridRow = {};
    values.forEach((value, columnOffset) => {
      if (readonlyBoundary >= 0 && columnOffset >= readonlyBoundary) return;
      const column = columns[focus.colIndex + columnOffset];
      if (!column || typeof column.prop !== "string") return;
      patch[column.prop] = value;
    });
    result[rowIndex] = { ...result[rowIndex], ...patch };
  });
  return result;
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

  const candidatePatches = Object.entries(detail.data)
    .map(([index, patch]) => ({ index: Number(index), patch }))
    .filter(({ index }) => Number.isSafeInteger(index) && index >= 0);
  const maximumIndex = rows.length + candidatePatches.length - 1;
  const patches = candidatePatches
    .filter(({ index }) => index <= maximumIndex)
    .sort((left, right) => left.index - right.index);
  const result = rows.map((row) => ({ ...row }));
  const rowShape = Object.fromEntries(
    [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => [key, ""])
  ) as JgBusinessGridRow;
  const highestIndex = patches.at(-1)?.index;
  if (highestIndex !== undefined) {
    while (result.length <= highestIndex) result.push({ ...rowShape });
  }
  for (const { index, patch } of patches) {
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    ) as JgBusinessGridRow;
    result[index] = { ...result[index], ...definedPatch };
  }
  return result;
}
