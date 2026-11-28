import { describe, expect, it } from "vitest";
import {
  NAVIGATION_ENTRY_ACCESS,
  navigationEntryRoleKeys,
  visibleNavigationEntryKeys,
  type NavigationEntryKey
} from "./navigation-access";
import { ROLE_KEYS, type RoleKey } from "./roles";

const visible = (...roles: RoleKey[]) => new Set(visibleNavigationEntryKeys(roles));

describe("navigation entry access matrix", () => {
  it("每一条固定入口都有可解析的岗位集合，且岗位均来自后端岗位表", () => {
    for (const entry of Object.keys(NAVIGATION_ENTRY_ACCESS) as NavigationEntryKey[]) {
      const roles = navigationEntryRoleKeys(entry);
      if (roles === null) continue;
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) expect(ROLE_KEYS).toContain(role);
    }
  });

  it("普通员工不获得管理、审计、档案、资金、工资与项目经营入口", () => {
    const employee = visible("employee");
    for (const denied of [
      "archives",
      "audit_logs",
      "employee_management",
      "wage_assumption",
      "fund_account",
      "project_workbench",
      "company_entity",
      "correction_center",
      "company_transfer_ledger",
      "fund_execution_cases"
    ] as NavigationEntryKey[]) {
      expect(employee.has(denied)).toBe(false);
    }
    for (const allowed of [
      "home",
      "approval_center",
      "spot_procurement_workbench",
      "receipt_confirmation_workbench",
      "expense_claim_workbench",
      "ledger_contract",
      "ledger_settlement",
      "ledger_payment"
    ] as NavigationEntryKey[]) {
      expect(employee.has(allowed)).toBe(true);
    }
  });

  it("合同岗看到合同、用章与合同台账，但不获得财务、审计与组织管理入口", () => {
    const contractStaff = visible("contract_staff");
    for (const allowed of [
      "contract_workbench",
      "historical_contract_takeover",
      "contract_template_library",
      "correction_center",
      "company_transfer_ledger",
      "ledger_contract",
      "archives"
    ] as NavigationEntryKey[]) {
      expect(contractStaff.has(allowed)).toBe(true);
    }
    for (const denied of [
      "fund_account",
      "wage_assumption",
      "payable_settlement_workbench",
      "audit_logs",
      "employee_management",
      "project_workbench"
    ] as NavigationEntryKey[]) {
      expect(contractStaff.has(denied)).toBe(false);
    }
  });

  it("财务岗看到资金、工资与应付核销，但不获得审计与组织管理入口", () => {
    const finance = visible("finance_staff");
    for (const allowed of [
      "fund_account",
      "fund_handling_workbench",
      "wage_assumption",
      "payable_settlement_workbench",
      "project_workbench",
      "archives",
      "ledger_payment"
    ] as NavigationEntryKey[]) {
      expect(finance.has(allowed)).toBe(true);
    }
    for (const denied of ["audit_logs", "employee_management"] as NavigationEntryKey[]) {
      expect(finance.has(denied)).toBe(false);
    }
    expect(finance.has("company_entity")).toBe(true);
  });

  it("董事长看到审计、档案与组织管理，但技术管理员不因技术身份获得业务动作入口", () => {
    const chairman = visible("chairman");
    for (const allowed of ["audit_logs", "archives", "employee_management", "company_entity"] as NavigationEntryKey[]) {
      expect(chairman.has(allowed)).toBe(true);
    }
    const superAdmin = visible("super_admin");
    expect(superAdmin.has("audit_logs")).toBe(true);
    expect(superAdmin.has("employee_management")).toBe(true);
    for (const actionOnly of [
      "wage_assumption",
      "payable_settlement_workbench",
      "fund_handling_workbench",
      "historical_contract_takeover"
    ] as NavigationEntryKey[]) {
      expect(superAdmin.has(actionOnly)).toBe(false);
    }
  });

  it("兼岗取并集，不重复，也不越过任一单岗的边界", () => {
    const union = visibleNavigationEntryKeys(["finance_staff", "contract_staff"]);
    expect(new Set(union).size).toBe(union.length);
    const finance = visible("finance_staff");
    const contract = visible("contract_staff");
    for (const key of union) expect(finance.has(key) || contract.has(key)).toBe(true);
    for (const key of [...finance, ...contract]) expect(union).toContain(key);
    expect(union).toContain("fund_account");
    expect(union).toContain("contract_workbench");
    expect(union).not.toContain("audit_logs");
  });

  it("未登录或空岗位不获得任何受限入口，只保留公开入口", () => {
    const anonymous = new Set(visibleNavigationEntryKeys([]));
    expect(anonymous.has("home")).toBe(true);
    expect(anonymous.has("approval_center")).toBe(true);
    expect(anonymous.has("contract_workbench")).toBe(false);
    expect(anonymous.has("audit_logs")).toBe(false);
  });
});
