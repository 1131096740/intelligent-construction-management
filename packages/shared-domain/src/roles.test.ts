import { describe, expect, it } from "vitest";
import { BUSINESS_APPROVAL_ROLES, ROLE_KEYS } from "./roles";

describe("role constants", () => {
  it("includes leadership and department roles required by the approval loop", () => {
    expect(ROLE_KEYS).toEqual(
      expect.arrayContaining([
        "chairman",
        "general_manager",
        "contract_director",
        "contract_staff",
        "finance_director",
        "finance_staff",
        "budget_director",
        "project_manager",
        "super_admin"
      ])
    );
  });

  it("excludes super admin from business approval roles", () => {
    expect(BUSINESS_APPROVAL_ROLES).toContain("chairman");
    expect(BUSINESS_APPROVAL_ROLES).not.toContain("super_admin");
  });
});
