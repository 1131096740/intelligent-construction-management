import { describe, expect, it } from "vitest";

import { ACTION_REQUIRED_ROLES, canPerform } from "./permissions";

describe("necessary expense reserve permissions", () => {
  it("uses dedicated actions with frozen duty separation", () => {
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.read"]).toEqual([
      "finance_staff",
      "finance_director",
      "project_manager"
    ]);
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.prepare"]).toEqual([
      "finance_staff",
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.submit"]).toEqual([
      "finance_staff",
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.attest"]).toEqual([
      "project_manager"
    ]);
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.confirm"]).toEqual([
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["necessary_expense_reserve.return"]).toEqual([
      "finance_director"
    ]);
    expect(canPerform("necessary_expense_reserve.confirm", ["finance_staff"])).toBe(false);
    expect(canPerform("necessary_expense_reserve.attest", ["finance_director"])).toBe(false);
    expect(canPerform("necessary_expense_reserve.prepare", ["super_admin"])).toBe(false);
  });
});
