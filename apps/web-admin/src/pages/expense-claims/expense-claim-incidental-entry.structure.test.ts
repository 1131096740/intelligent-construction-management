import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("零星费用既有 Web 入口", () => {
  it("创建抽屉提供零星费用和四个既有分类", () => {
    const source = readPage("./components/ExpenseClaimCreateDrawer.vue");

    expect(source).toContain('<t-radio value="incidental_expense">');
    expect(source).toContain("零星费用");
    expect(source).toContain('field.key === "incidentalExpenseCategory"');
    expect(source).toContain(":options=\"incidentalExpenseCategoryOptions\"");
    expect(source).toContain('incidentalExpenseCategory: form.claimType === "incidental_expense" && form.incidentalExpenseCategory ? form.incidentalExpenseCategory : undefined');
  });

  it("详情把零星费用与费用报销分开显示", () => {
    const source = readPage("./ExpenseClaimDetailPage.vue");

    expect(source).toContain('incidental_expense: "零星费用"');
    expect(source).toContain('label="零星费用分类"');
    expect(source).toContain("incidentalExpenseCategoryLabel(detail.incidentalExpenseCategory)");
  });
});
