import { describe, expect, it } from "vitest";
import {
  ACTION_REQUIRED_ROLES,
  BUSINESS_ACTIONS,
  canPerform,
  FINAL_APPROVAL_ROLES,
  isFinalApprovalAction,
  missingRolesFor,
  resolveEffectiveRoleKeys
} from "./permissions";

describe("permission policy table", () => {
  it("defines required roles for every business action", () => {
    for (const action of BUSINESS_ACTIONS) {
      expect(ACTION_REQUIRED_ROLES[action].length).toBeGreaterThan(0);
    }
  });

  it("never grants any business action to super_admin", () => {
    for (const action of BUSINESS_ACTIONS) {
      expect(ACTION_REQUIRED_ROLES[action]).not.toContain("super_admin");
      expect(canPerform(action, ["super_admin"])).toBe(false);
    }
  });

  it("keeps chairman/general_manager out of settlement approval", () => {
    expect(ACTION_REQUIRED_ROLES["settlement.approve"]).not.toContain("chairman");
    expect(ACTION_REQUIRED_ROLES["settlement.approve"]).not.toContain(
      "general_manager"
    );
    expect(canPerform("settlement.approve", ["chairman"])).toBe(false);
  });

  it("allows settlement approval route roles before service-level node checks", () => {
    for (const role of [
      "material_staff",
      "material_director",
      "engineering_foreman",
      "engineering_director",
      "engineering_tech",
      "contract_director",
      "budget_director",
      "project_manager",
      "finance_director"
    ] as const) {
      expect(canPerform("settlement.approve", [role])).toBe(true);
    }
  });
});

describe("final approval OR-sign", () => {
  it("lets either chairman or general_manager perform final contract approval and payment final node", () => {
    expect(canPerform("contract.approve", ["chairman"])).toBe(true);
    expect(canPerform("contract.approve", ["general_manager"])).toBe(true);
    expect(canPerform("payment.approve", ["chairman"])).toBe(true);
    expect(canPerform("payment.approve", ["general_manager"])).toBe(true);
  });

  it("rejects non-leadership roles from contract final approval", () => {
    expect(canPerform("contract.approve", ["contract_director"])).toBe(false);
  });

  it("allows payment approval route roles before service-level node checks", () => {
    for (const role of [
      "project_manager",
      "contract_director",
      "budget_director",
      "finance_director",
      "chairman",
      "general_manager"
    ] as const) {
      expect(canPerform("payment.approve", [role])).toBe(true);
    }
  });

  it("flags final approval actions and only those", () => {
    expect(isFinalApprovalAction("contract.approve")).toBe(true);
    expect(isFinalApprovalAction("payment.approve")).toBe(false);
    expect(isFinalApprovalAction("contract.seal")).toBe(false);
    expect(isFinalApprovalAction("settlement.approve")).toBe(false);
  });

  it("requires both leadership roles in the OR set", () => {
    expect(FINAL_APPROVAL_ROLES).toEqual(["chairman", "general_manager"]);
  });
});

describe("role-specific gates", () => {
  it("allows contract staff and directors to create and submit contract drafts", () => {
    expect(canPerform("contract.create", ["contract_staff"])).toBe(true);
    expect(canPerform("contract.submit", ["contract_staff"])).toBe(true);
    expect(canPerform("contract.create", ["contract_director"])).toBe(true);
    expect(canPerform("contract.submit", ["contract_director"])).toBe(true);
    expect(canPerform("contract.create", ["project_manager"])).toBe(false);
  });

  it("requires comprehensive_director for seal approval", () => {
    expect(canPerform("contract.seal", ["comprehensive_director"])).toBe(true);
    expect(canPerform("contract.seal", ["contract_staff"])).toBe(false);
  });

  it("requires contract_director to confirm archives", () => {
    expect(canPerform("contract.archive.confirm", ["contract_director"])).toBe(true);
    expect(canPerform("settlement.archive.confirm", ["contract_director"])).toBe(true);
    expect(canPerform("contract.archive.confirm", ["contract_staff"])).toBe(false);
  });

  it("requires contract_staff to upload archive files", () => {
    expect(canPerform("contract.archive.upload", ["contract_staff"])).toBe(true);
    expect(canPerform("settlement.archive.upload", ["contract_staff"])).toBe(true);
    expect(canPerform("contract.archive.upload", ["contract_director"])).toBe(false);
  });

  it("requires finance_staff (cashier) to record actual payment execution", () => {
    expect(canPerform("payment.execution", ["finance_staff"])).toBe(true);
    expect(canPerform("payment.execution", ["finance_director"])).toBe(false);
    expect(canPerform("payment.execution", ["chairman"])).toBe(false);
  });
});

describe("effective role resolution", () => {
  it("merges global and project roles without duplicates", () => {
    const result = resolveEffectiveRoleKeys(
      ["finance_staff", "employee"],
      ["contract_staff", "employee"]
    );
    expect(result).toEqual(
      expect.arrayContaining(["finance_staff", "employee", "contract_staff"])
    );
    expect(result).toHaveLength(3);
  });

  it("works with only global roles", () => {
    expect(resolveEffectiveRoleKeys(["chairman"])).toEqual(["chairman"]);
  });

  it("grants access only when a project role supplies the needed position", () => {
    const globalOnly = resolveEffectiveRoleKeys(["employee"], []);
    expect(canPerform("contract.archive.confirm", globalOnly)).toBe(false);

    const withProjectRole = resolveEffectiveRoleKeys(
      ["employee"],
      ["contract_director"]
    );
    expect(canPerform("contract.archive.confirm", withProjectRole)).toBe(true);
  });
});

describe("missingRolesFor", () => {
  it("returns empty when the user can already perform the action", () => {
    expect(missingRolesFor("payment.execution", ["finance_staff"])).toEqual([]);
  });

  it("lists the accepted roles when the user lacks permission", () => {
    expect(missingRolesFor("contract.approve", ["employee"])).toEqual([
      "chairman",
      "general_manager"
    ]);
  });
});
