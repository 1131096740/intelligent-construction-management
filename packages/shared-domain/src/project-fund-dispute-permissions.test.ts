import { describe, expect, it } from "vitest";

import { ACTION_REQUIRED_ROLES, canPerform } from "./permissions";

describe("project fund dispute permissions", () => {
  it("uses dedicated actions with frozen duty separation", () => {
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.read"]).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director",
      "project_manager"
    ]);
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.prepare"]).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.submit"]).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.attest"]).toEqual([
      "project_manager",
      "contract_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.confirm"]).toEqual([
      "finance_director"
    ]);
    expect(ACTION_REQUIRED_ROLES["project_fund_dispute.return"]).toEqual([
      "finance_director"
    ]);
    expect(canPerform("project_fund_dispute.confirm", ["finance_staff"])).toBe(false);
    expect(canPerform("project_fund_dispute.attest", ["finance_director"])).toBe(false);
    expect(canPerform("project_fund_dispute.prepare", ["super_admin"])).toBe(false);
  });
});
