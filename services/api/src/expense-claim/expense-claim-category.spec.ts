import {
  DEFAULT_EXPENSE_CATEGORIES,
  expenseCategoryKey,
  mergeExpenseCategories,
  normalizeExpenseCategoryInput,
  resolveExpenseCategoryName
} from "./expense-claim-category";

/**
 * #404 EXP-07/EXP-08：费用类别是可复用的公司分类，不是业务流程选择器。
 * 默认 10 类；填单人可新增并用同一公司范围复用；同名不重复建项。
 * 本仓库没有独立类别字典表，复用集合由既有明细派生，因此“同名”必须有
 * 唯一的规范名，否则汇总会裂成多项。
 */
describe("expense claim categories", () => {
  it("ships the ten default categories from the specification in order", () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toEqual([
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
    ]);
  });

  it("normalizes width, surrounding and internal whitespace without changing meaning", () => {
    expect(normalizeExpenseCategoryInput("  餐 饮  ")).toBe("餐 饮");
    expect(expenseCategoryKey("  餐 饮  ")).toBe("餐饮");
    expect(expenseCategoryKey("Ｏｆｆｉｃｅ")).toBe(expenseCategoryKey("office"));
    expect(normalizeExpenseCategoryInput("")).toBe("");
  });

  it("reuses the existing canonical name instead of creating a same-name item", () => {
    const known = ["零星材料", "差旅", "餐饮"];
    expect(resolveExpenseCategoryName(" 餐饮 ", known)).toBe("餐饮");
    expect(resolveExpenseCategoryName("餐 饮", known)).toBe("餐饮");
    expect(resolveExpenseCategoryName("夜宵", known)).toBe("夜宵");
    expect(resolveExpenseCategoryName("差旅费", known)).toBe("差旅费");
  });

  it("rejects empty, over-long and control-character names", () => {
    expect(resolveExpenseCategoryName("   ", DEFAULT_EXPENSE_CATEGORIES)).toBeNull();
    expect(resolveExpenseCategoryName("类".repeat(41), DEFAULT_EXPENSE_CATEGORIES)).toBeNull();
    expect(resolveExpenseCategoryName("餐\u0007饮", DEFAULT_EXPENSE_CATEGORIES)).toBeNull();
  });

  it("merges defaults with company usage without duplicate names and keeps counts", () => {
    const merged = mergeExpenseCategories([
      { name: "餐饮", usageCount: 3 },
      { name: "夜宵", usageCount: 2 },
      { name: "差旅", usageCount: 1 }
    ]);
    expect(merged.slice(0, DEFAULT_EXPENSE_CATEGORIES.length).map((item) => item.name)).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    const dining = merged.find((item) => item.name === "餐饮")!;
    expect(dining).toEqual({ name: "餐饮", isDefault: true, usageCount: 3 });
    expect(merged.filter((item) => item.name === "餐饮")).toHaveLength(1);
    expect(merged.slice(DEFAULT_EXPENSE_CATEGORIES.length)).toEqual([
      { name: "夜宵", isDefault: false, usageCount: 2 }
    ]);
    expect(merged.find((item) => item.name === "其他")).toEqual({ name: "其他", isDefault: true, usageCount: 0 });
  });
});
