import { describe, expect, it } from "vitest";
import {
  expenseSubtypeLabel,
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
      "报销申请"
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

  it("returns Chinese labels instead of leaking enum values", () => {
    expect(expenseTypeLabel("comprehensive_expense")).toBe("综合费用");
    expect(expenseTypeLabel("reimbursement")).toBe("报销申请");
    expect(expenseSubtypeLabel("travel")).toBe("差旅");
    expect(expenseSubtypeLabel("entertainment")).toBe("招待");
    expect(expenseSubtypeLabel("reimbursement")).toBe("报销");
  });
});
