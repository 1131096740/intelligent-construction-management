import { describe, expect, it } from "vitest";
import {
  expenseSubtypeLabel,
  projectExpenseApprovalDetailPath,
  expenseTypeLabel,
  expenseTypeOptions,
  subtypeOptionsFor
} from "./project-expense.config";

describe("project expense page configuration", () => {
  it("exposes reimbursement as a first-class business type", () => {
    expect(expenseTypeOptions.map((option) => option.label)).toEqual([
      "零星付款",
      "借款/备用金",
      "综合费用",
      "报销申请",
      "零星采购"
    ]);
  });

  it("keeps the P0-7C comprehensive expense subtypes minimal", () => {
    expect(subtypeOptionsFor("comprehensive_expense").map((option) => option.label)).toEqual([
      "差旅",
      "招待"
    ]);
  });

  it("uses a single reimbursement subtype for the reimbursement loop", () => {
    expect(subtypeOptionsFor("reimbursement").map((option) => option.label)).toEqual(["报销"]);
  });

  it("uses purchase categories for the spot purchase loop", () => {
    expect(subtypeOptionsFor("spot_purchase").map((option) => option.label)).toEqual([
      "零星材料采购",
      "工具/辅材采购",
      "临时服务采购",
      "其他零星采购"
    ]);
  });

  it("returns Chinese labels instead of leaking enum values", () => {
    expect(expenseTypeLabel("comprehensive_expense")).toBe("综合费用");
    expect(expenseTypeLabel("reimbursement")).toBe("报销申请");
    expect(expenseTypeLabel("spot_purchase")).toBe("零星采购");
    expect(expenseSubtypeLabel("travel")).toBe("差旅");
    expect(expenseSubtypeLabel("entertainment")).toBe("招待");
    expect(expenseSubtypeLabel("reimbursement")).toBe("报销");
    expect(expenseSubtypeLabel("spot_material_purchase")).toBe("零星材料采购");
  });

  it("builds the independent project expense approval detail path", () => {
    expect(projectExpenseApprovalDetailPath("project-1", "expense-1")).toBe(
      "/项目支出/project-1/expense-1"
    );
  });

  it("keeps the legacy spot purchase option identifiable for pilot routing", () => {
    expect(expenseTypeOptions.find((option) => option.value === "spot_purchase"))
      .toEqual(expect.objectContaining({ label: "零星采购" }));
  });
});
