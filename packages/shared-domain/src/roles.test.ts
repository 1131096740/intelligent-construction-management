import { describe, expect, it } from "vitest";
import {
  BUSINESS_APPROVAL_ROLES,
  CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS,
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
});
