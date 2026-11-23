export interface PersonalTableSort {
  key: string;
  direction: "asc" | "desc";
}

/**
 * 台账个人列视图 v2。
 *
 * 只保存在浏览器 localStorage（按 `user.id` 分 key），不写回服务端，
 * 不改变数据含义、权限或他人设置。旧版仅含 `query + visibleColumnKeys`
 * 的数据继续可读：缺失的顺序/列宽/排序自动回落到默认值。
 */
export interface PersonalTablePreferences {
  query: string;
  visibleColumnKeys: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  sort: PersonalTableSort | null;
}

/** 写入时允许省略 v2 字段，旧页面无需一次性迁移。 */
export type PersonalTablePreferencesInput = {
  query: string;
  visibleColumnKeys: string[];
  columnOrder?: string[];
  columnWidths?: Record<string, number>;
  sort?: PersonalTableSort | null;
};

export function defaultPersonalTablePreferences(
  allColumnKeys: string[]
): PersonalTablePreferences {
  return {
    query: "",
    visibleColumnKeys: [...allColumnKeys],
    columnOrder: [...allColumnKeys],
    columnWidths: {},
    sort: null
  };
}

export function normalizeVisibleColumnKeys(
  value: unknown,
  allColumnKeys: string[]
): string[] {
  if (!Array.isArray(value)) {
    return [...allColumnKeys];
  }
  const allowed = new Set(allColumnKeys);
  const normalized = value.filter((item): item is string => typeof item === "string" && allowed.has(item));
  return normalized.length ? [...new Set(normalized)] : [...allColumnKeys];
}

/** 列顺序只接受已知列；未出现的列按默认顺序追加，避免丢列。 */
export function normalizeColumnOrder(
  value: unknown,
  allColumnKeys: string[]
): string[] {
  const allowed = new Set(allColumnKeys);
  const ordered = Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && allowed.has(item)
      )
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of ordered) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  for (const key of allColumnKeys) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}

/** 列宽只接受 60–600 的有限像素值；未知列忽略。 */
export function normalizeColumnWidths(
  value: unknown,
  allColumnKeys: string[]
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(allColumnKeys);
  const widths: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key) || typeof raw !== "number" || !Number.isFinite(raw)) continue;
    widths[key] = Math.min(600, Math.max(60, Math.round(raw)));
  }
  return widths;
}

export function normalizeTableSort(
  value: unknown,
  allColumnKeys: string[]
): PersonalTableSort | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { key, direction } = value as { key?: unknown; direction?: unknown };
  if (typeof key !== "string" || !allColumnKeys.includes(key)) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { key, direction };
}

export function readPersonalTablePreferences(
  storage: Pick<Storage, "getItem"> | null,
  storageKey: string,
  allColumnKeys: string[]
): PersonalTablePreferences {
  if (!storage) {
    return defaultPersonalTablePreferences(allColumnKeys);
  }
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "{}") as {
      query?: unknown;
      visibleColumnKeys?: unknown;
      columnOrder?: unknown;
      columnWidths?: unknown;
      sort?: unknown;
    };
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      visibleColumnKeys: normalizeVisibleColumnKeys(parsed.visibleColumnKeys, allColumnKeys),
      columnOrder: normalizeColumnOrder(parsed.columnOrder, allColumnKeys),
      columnWidths: normalizeColumnWidths(parsed.columnWidths, allColumnKeys),
      sort: normalizeTableSort(parsed.sort, allColumnKeys)
    };
  } catch {
    return defaultPersonalTablePreferences(allColumnKeys);
  }
}

export function writePersonalTablePreferences(
  storage: Pick<Storage, "setItem"> | null,
  storageKey: string,
  preferences: PersonalTablePreferencesInput
) {
  if (!storage) {
    return;
  }
  storage.setItem(storageKey, JSON.stringify(preferences));
}
