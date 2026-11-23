import { BadRequestException } from "@nestjs/common";
import type { LedgerExcelColumn } from "./ledger-excel";

/**
 * 台账导出筛选参数。
 *
 * 导出必须接受与列表相同的业务筛选（项目/日期/状态/关键字），
 * 由服务端对「全部可见记录」过滤后再生成 Excel，而不是只导当前页，
 * 也不能因为导出绕过行级可见性。
 */
export interface LedgerExportFilters {
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  keyword?: string;
}

export interface LedgerExportQuery extends LedgerExportFilters {
  /** 当前显示的列 key（顺序即导出顺序）；必要列始终补回。 */
  columns?: readonly string[];
  /** 排序白名单字段，例如 `confirmedAt:desc`。 */
  sort?: string;
}

export interface NormalizedLedgerExportQuery {
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  keyword?: string;
  columnKeys?: string[];
  sortField?: string;
  sortDirection: "asc" | "desc";
}

const SHANGHAI_DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** 业务日期按 Asia/Shanghai 自然日比较，避免 UTC 边界错位。 */
export function shanghaiDateKey(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return SHANGHAI_DATE_KEY.format(date);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalDate(value: unknown, field: string): string | undefined {
  const text = optionalText(value);
  if (text === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || shanghaiDateKey(`${text}T00:00:00+08:00`) !== text) {
    throw new BadRequestException(`${field}须为 YYYY-MM-DD 日期`);
  }
  return text;
}

function parseColumnKeys(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value.join(",") : optionalText(value);
  if (raw === undefined) return undefined;
  const keys = raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return [...new Set(keys)];
}

function parseSort(value: unknown): Pick<NormalizedLedgerExportQuery, "sortField" | "sortDirection"> {
  const text = optionalText(value);
  if (text === undefined) return { sortDirection: "desc" };
  const [field, direction] = text.split(":");
  return {
    sortField: field || undefined,
    sortDirection: direction === "asc" ? "asc" : "desc"
  };
}

/** 只接受约定字段；未知字段忽略，不改变数据含义与权限。 */
export function normalizeLedgerExportQuery(
  raw: Record<string, unknown> | undefined
): NormalizedLedgerExportQuery {
  const value = raw ?? {};
  const query: NormalizedLedgerExportQuery = {
    sortDirection: parseSort(value.sort).sortDirection
  };
  const projectId = optionalText(value.projectId);
  if (projectId) query.projectId = projectId;
  const dateFrom = optionalDate(value.dateFrom, "开始日期");
  if (dateFrom) query.dateFrom = dateFrom;
  const dateTo = optionalDate(value.dateTo, "结束日期");
  if (dateTo) query.dateTo = dateTo;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new BadRequestException("开始日期不能晚于结束日期");
  }
  const status = optionalText(value.status);
  if (status) query.status = status;
  const keyword = optionalText(value.keyword);
  if (keyword) query.keyword = keyword;
  const columnKeys = parseColumnKeys(value.columns);
  if (columnKeys) query.columnKeys = columnKeys;
  const sort = parseSort(value.sort);
  if (sort.sortField) query.sortField = sort.sortField;
  return query;
}

export function hasLedgerExportFilters(query: NormalizedLedgerExportQuery): boolean {
  return Boolean(
    query.projectId || query.dateFrom || query.dateTo || query.status || query.keyword
  );
}

export interface LedgerFilterableRow {
  projectId: string;
  occurredAt: Date | string | null;
  status: string;
  keywordParts: ReadonlyArray<string | null | undefined>;
}

/**
 * 与列表一致的业务筛选：项目、日期区间、状态（包含匹配）与关键字。
 * 调用方必须先完成行级可见性过滤；本函数不扩大读取范围。
 */
export function matchesLedgerExportQuery(
  row: LedgerFilterableRow,
  query: NormalizedLedgerExportQuery
): boolean {
  if (query.projectId && row.projectId !== query.projectId) return false;
  if (query.dateFrom || query.dateTo) {
    const key = shanghaiDateKey(row.occurredAt);
    if (key === null) return false;
    if (query.dateFrom && key < query.dateFrom) return false;
    if (query.dateTo && key > query.dateTo) return false;
  }
  if (query.status && !row.status.includes(query.status)) return false;
  if (query.keyword) {
    const haystack = row.keywordParts
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
    if (!haystack.includes(query.keyword)) return false;
  }
  return true;
}

/**
 * 解析导出列：按用户当前显示顺序导出；必要列即使被隐藏也补回，
 * 未知列忽略，绝不把技术字段带进业务导出。
 */
export function resolveLedgerExportColumns<Row extends Record<string, unknown>>(
  columns: readonly LedgerExcelColumn<Row>[],
  requestedKeys: readonly string[] | undefined
): LedgerExcelColumn<Row>[] {
  const byKey = new Map(columns.map((column) => [String(column.key), column]));
  // 未提供列参数时，按台账完整列导出（与列表默认显示一致）。
  if (requestedKeys === undefined) return [...columns];
  const selected: LedgerExcelColumn<Row>[] = [];
  const seen = new Set<string>();
  for (const key of requestedKeys ?? []) {
    const column = byKey.get(key);
    if (!column || seen.has(String(column.key))) continue;
    seen.add(String(column.key));
    selected.push(column);
  }
  for (const column of columns) {
    const key = String(column.key);
    if (!column.required || seen.has(key)) continue;
    seen.add(key);
    const canonicalIndex = columns.indexOf(column);
    const insertAt = selected.findIndex(
      (candidate) => columns.indexOf(candidate) > canonicalIndex
    );
    if (insertAt === -1) selected.push(column);
    else selected.splice(insertAt, 0, column);
  }
  return selected;
}

/** 按白名单字段排序；未知字段保持原顺序（通常为服务端默认顺序）。 */
export function sortLedgerRows<Row>(
  rows: readonly Row[],
  field: string | undefined,
  direction: "asc" | "desc",
  accessors: Readonly<Record<string, (row: Row) => string | number | Date | null>>
): Row[] {
  if (!field) return [...rows];
  const accessor = accessors[field];
  if (!accessor) return [...rows];
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = accessor(left);
    const b = accessor(right);
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (a instanceof Date && b instanceof Date) {
      return (a.getTime() - b.getTime()) * factor;
    }
    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * factor;
    }
    return String(a).localeCompare(String(b), "zh-CN") * factor;
  });
}
