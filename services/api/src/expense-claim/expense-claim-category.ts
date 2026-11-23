/**
 * #404 EXP-07/EXP-08 费用类别复用。
 *
 * 本仓库没有独立类别字典表；公司级复用集合由既有报销明细派生：
 * 默认 10 类 + 本公司已用类别。为了让“汇总”不在同名变体上裂开，
 * 所有写入都先经过同一规范名：优先复用默认/已用类别，避免重复建同名项。
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "零星材料",
  "水电",
  "零星机械",
  "零星人工",
  "差旅",
  "餐饮",
  "后勤",
  "办公用品",
  "车辆使用费",
  "其他"
] as const;

const MAX_EXPENSE_CATEGORY_LENGTH = 40;
// eslint-disable-next-line no-control-regex -- Reject literal control characters in expense category names.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** 展示用规范名：全半角统一、去掉首尾空白、内部连续空白折叠为一个。 */
export function normalizeExpenseCategoryInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 比较用规范键：忽略全部空白与拉丁大小写，只用于判断“同名”。 */
export function expenseCategoryKey(input: string): string {
  return normalizeExpenseCategoryInput(input)
    .replace(/\s+/gu, "")
    .toLowerCase();
}

/**
 * 返回可安全写入的类别名：空、超长、控制字符或纯空白返回 null；
 * 与已有序列表中某项同名时返回既有项，避免新建同名类别。
 */
export function resolveExpenseCategoryName(
  input: string,
  known: readonly string[]
): string | null {
  const display = normalizeExpenseCategoryInput(input);
  if (!display || CONTROL_CHARACTER.test(display)) return null;
  if ([...display].length > MAX_EXPENSE_CATEGORY_LENGTH) return null;
  const key = expenseCategoryKey(display);
  if (!key) return null;
  const existing = known.find((item) => expenseCategoryKey(item) === key);
  return existing ? normalizeExpenseCategoryInput(existing) : display;
}

export interface ExpenseCategoryUsage {
  name: string;
  usageCount: number;
}

export interface ExpenseCategoryOption {
  name: string;
  isDefault: boolean;
  usageCount: number;
}

/**
 * 合并默认类别与公司已用类别：默认项固定在前并保留顺序，
 * 非默认项按使用次数降序、同次数按名称排序；同名只出现一次。
 */
export function mergeExpenseCategories(
  used: readonly ExpenseCategoryUsage[]
): ExpenseCategoryOption[] {
  const usageByKey = new Map<string, number>();
  const displayByKey = new Map<string, string>();
  for (const item of used) {
    const key = expenseCategoryKey(item.name);
    if (!key) continue;
    usageByKey.set(key, (usageByKey.get(key) ?? 0) + item.usageCount);
    if (!displayByKey.has(key)) displayByKey.set(key, normalizeExpenseCategoryInput(item.name));
  }
  const defaults = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
    name,
    isDefault: true,
    usageCount: usageByKey.get(expenseCategoryKey(name)) ?? 0
  }));
  const defaultKeys = new Set(DEFAULT_EXPENSE_CATEGORIES.map((name) => expenseCategoryKey(name)));
  const extras = [...displayByKey.entries()]
    .filter(([key]) => !defaultKeys.has(key))
    .map(([key, name]) => ({
      name,
      isDefault: false,
      usageCount: usageByKey.get(key) ?? 0
    }))
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, "zh-Hans-CN"));
  return [...defaults, ...extras];
}
