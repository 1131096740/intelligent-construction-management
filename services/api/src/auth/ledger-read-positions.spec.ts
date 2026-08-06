import {
  LEDGER_READ_POSITION_KEYS,
  PROJECT_OVERVIEW_READ_POSITION_KEYS
} from "./ledger-read-positions";

describe("ledger read position policy", () => {
  it("gives every global business position read access without making local staff global", () => {
    expect(LEDGER_READ_POSITION_KEYS).toEqual([
      "chairman",
      "general_manager",
      "engineering_department_director",
      "finance_staff",
      "finance_director",
      "contract_director",
      "budget_director",
      "material_director",
      "comprehensive_director",
      "super_admin",
      "project_manager",
      "contract_staff",
      "budget_staff",
      "material_staff",
      "engineering_department_member",
      "engineering_director",
      "engineering_foreman",
      "engineering_tech",
      "employee"
    ]);
  });

  it("admits the summary employee into the ledger gate without granting project overview", () => {
    expect(LEDGER_READ_POSITION_KEYS).toContain("employee");
    expect(PROJECT_OVERVIEW_READ_POSITION_KEYS).not.toContain("employee");
  });

  it("keeps the project overview to management read roles and the project manager", () => {
    expect(PROJECT_OVERVIEW_READ_POSITION_KEYS).toEqual([
      "chairman",
      "general_manager",
      "engineering_department_director",
      "finance_staff",
      "finance_director",
      "contract_director",
      "budget_director",
      "material_director",
      "comprehensive_director",
      "super_admin",
      "project_manager"
    ]);
  });
});
