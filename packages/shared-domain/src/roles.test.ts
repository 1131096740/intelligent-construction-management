import { describe, expect, it } from "vitest";
import {
  BUSINESS_APPROVAL_ROLES,
  CONTRACT_DRAFT_PRIVATE_READ_ROLES,
  CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS,
  CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS,
  CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS,
  CONTRACT_SUMMARY_VIEW_ROLE_KEYS,
  GLOBAL_BUSINESS_ROLE_KEYS,
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  GLOBAL_USER_POSITION_ROLE_KEYS,
  DUAL_SCOPE_ROLE_KEYS,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  ROLE_KEYS
} from "./roles";

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
        "engineering_department_member",
        "engineering_department_director",
        "super_admin"
      ])
    );
  });

  it("excludes super admin from business approval roles", () => {
    expect(BUSINESS_APPROVAL_ROLES).toContain("chairman");
    expect(BUSINESS_APPROVAL_ROLES).not.toContain("super_admin");
  });

  it("keeps company engineering membership project-scoped", () => {
    expect(GLOBAL_BUSINESS_ROLE_KEYS).toContain("engineering_department_director");
    expect(GLOBAL_USER_POSITION_ROLE_KEYS).toContain("contract_staff");
    expect(DUAL_SCOPE_ROLE_KEYS).toEqual(["contract_staff"]);
    expect(GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS).not.toContain("contract_staff");
    expect(GLOBAL_BUSINESS_ROLE_KEYS).not.toContain("engineering_department_member");
    expect(GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS).toContain("super_admin");
  });

  it("keeps historical contract reads and ledger exports on the exact approved positions", () => {
    expect(HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director",
      "comprehensive_director"
    ]);
    expect(CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director",
      "comprehensive_director"
    ]);
    expect(GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS).toEqual(
      expect.arrayContaining([
        "finance_staff",
        "finance_director",
        "comprehensive_director"
      ])
    );
  });

  it("maps every role to exactly one contract read-visibility group", () => {
    const global = new Set(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS);
    const project = new Set(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS);
    for (const role of ROLE_KEYS) {
      const hits = [global.has(role), project.has(role)].filter(Boolean).length;
      expect(
        hits,
        `role ${role} must appear in at most one full-view group`
      ).toBeLessThanOrEqual(1);
    }
    expect(global.size).toBe(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS.length);
    expect(project.size).toBe(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS.length);
  });

  it("places employee only in the summary group, never in full-view groups", () => {
    const global = new Set(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS);
    const project = new Set(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS);
    expect(global.has("employee")).toBe(false);
    expect(project.has("employee")).toBe(false);
    expect(CONTRACT_SUMMARY_VIEW_ROLE_KEYS).toEqual(["employee"]);
    expect(new Set(CONTRACT_SUMMARY_VIEW_ROLE_KEYS).size).toBe(1);
  });

  it("keeps summary roles disjoint from every full-view group", () => {
    const summary = new Set(CONTRACT_SUMMARY_VIEW_ROLE_KEYS);
    expect(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS.some((role) => summary.has(role))).toBe(false);
    expect(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS.some((role) => summary.has(role))).toBe(false);
    expect([...CONTRACT_DRAFT_PRIVATE_READ_ROLES].some((role) => summary.has(role))).toBe(false);
  });

  it("keeps the draft-private read set to the exact global draft roles", () => {
    expect([...CONTRACT_DRAFT_PRIVATE_READ_ROLES].sort()).toEqual([
      "contract_director",
      "super_admin"
    ]);
    expect(CONTRACT_DRAFT_PRIVATE_READ_ROLES).not.toContain("employee");
  });

  it("covers the spec global full-view positions exactly", () => {
    expect(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS).toEqual(
      expect.arrayContaining([
        "chairman",
        "general_manager",
        "contract_director",
        "material_director",
        "finance_director",
        "finance_staff",
        "comprehensive_director",
        "budget_director",
        "engineering_department_director",
        "super_admin"
      ])
    );
    expect(new Set(CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS).size).toBe(10);
  });

  it("covers the spec project full-view positions exactly", () => {
    expect(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS).toEqual(
      expect.arrayContaining([
        "contract_staff",
        "material_staff",
        "budget_staff",
        "project_manager",
        "engineering_department_member",
        "engineering_director",
        "engineering_foreman",
        "engineering_tech"
      ])
    );
    expect(new Set(CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS).size).toBe(8);
  });
});
