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

  it("maps spot procurement write actions to the confirmed business roles", () => {
    const expectedRoles = [
      [
        "spot_procurement.create",
        ["material_staff", "material_director"]
      ],
      [
        "spot_procurement.approve",
        ["material_director", "project_manager"]
      ],
      [
        "spot_procurement.payment.submit",
        ["material_staff", "material_director"]
      ],
      [
        "spot_procurement.payment.approve",
        [
          "comprehensive_director",
          "project_manager",
          "finance_director",
          "chairman",
          "general_manager"
        ]
      ],
      [
        "spot_procurement.payment.facts.manage",
        ["finance_staff", "comprehensive_director", "finance_director"]
      ],
      ["spot_procurement.payment.execute", ["finance_staff"]],
      [
        "spot_procurement.receipt.confirm",
        ["employee", "material_staff", "material_director", "project_manager"]
      ],
      ["spot_procurement.receipt.review", ["material_director"]],
      ["spot_procurement.receipt.review_revoke", ["material_director"]],
      [
        "spot_procurement.discrepancy.create",
        ["material_staff", "material_director"]
      ],
      ["spot_procurement.refund.record", ["finance_staff"]],
      [
        "spot_procurement.invoice.append",
        [
          "material_staff",
          "material_director",
          "finance_staff",
          "finance_director"
        ]
      ],
      [
        "spot_procurement.abnormal_termination.request",
        ["material_staff", "material_director", "finance_staff"]
      ],
      [
        "spot_procurement.abnormal_termination.confirm",
        ["finance_director"]
      ],
      [
        "spot_procurement.archive.download",
        [
          "material_staff",
          "material_director",
          "comprehensive_director",
          "project_manager",
          "finance_staff",
          "finance_director",
          "chairman",
          "general_manager"
        ]
      ],
      ["spot_procurement.balance.execute", ["finance_director"]],
      [
        "spot_procurement.invoice.manage",
        [
          "material_staff",
          "material_director",
          "finance_staff",
          "finance_director"
        ]
      ],
      ["spot_procurement.invoice_exception.confirm", ["finance_director"]],
      ["spot_procurement.vat_rate.manage", ["finance_director"]],
      [
        "spot_procurement.void",
        ["project_manager", "finance_director"]
      ]
    ] as const;

    for (const [action, roles] of expectedRoles) {
      expect(ACTION_REQUIRED_ROLES[action]).toEqual(roles);
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
    expect(canPerform("settlement.approve", ["engineering_department_director"])).toBe(false);
  });
});

describe("final approval OR-sign", () => {
  it("lets either chairman or general_manager perform final contract approval and payment final node", () => {
    expect(canPerform("contract.approve", ["chairman"])).toBe(true);
    expect(canPerform("contract.approve", ["general_manager"])).toBe(true);
    expect(canPerform("payment.approve", ["chairman"])).toBe(true);
    expect(canPerform("payment.approve", ["general_manager"])).toBe(true);
  });

  it("allows enhanced contract route roles before service-level node checks", () => {
    expect(canPerform("contract.approve", ["budget_director"])).toBe(true);
    expect(canPerform("contract.approve", ["project_manager"])).toBe(true);
    expect(canPerform("contract.approve", ["finance_director"])).toBe(true);
    expect(canPerform("contract.approve", ["contract_director"])).toBe(true);
  });

  it("allows every frozen new-contract route role through the coarse approval gate only", () => {
    for (const role of [
      "material_director",
      "comprehensive_director",
      "engineering_director"
    ] as const) {
      expect(canPerform("contract.approve", [role])).toBe(true);
      expect(canPerform("contract.create", [role])).toBe(false);
      expect(canPerform("contract.submit", [role])).toBe(false);
      expect(canPerform("contract.archive.upload", [role])).toBe(false);
      expect(canPerform("contract.tax_fact.confirm", [role])).toBe(false);
    }
  });

  it("allows payment approval route roles before service-level node checks", () => {
    for (const role of [
      "comprehensive_director",
      "project_manager",
      "finance_director",
      "chairman",
      "general_manager"
    ] as const) {
      expect(canPerform("payment.approve", [role])).toBe(true);
    }
  });

  it("keeps contract and budget roles outside the payment approval route", () => {
    expect(canPerform("payment.approve", ["contract_director"])).toBe(false);
    expect(canPerform("payment.approve", ["budget_director"])).toBe(false);
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
  it("admits the frozen non-project fact witness through the expense approval coarse gate", () => {
    expect(canPerform("expense_claim.approve", ["employee"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["contract_staff"])).toBe(false);
  });

  it("separates contract tax fact supplement, finance review, and contract confirmation", () => {
    expect(canPerform("contract.tax_fact.supplement", ["contract_staff"])).toBe(true);
    expect(canPerform("contract.tax_fact.finance_review", ["finance_director"])).toBe(true);
    expect(canPerform("contract.tax_fact.confirm", ["contract_director"])).toBe(true);

    expect(canPerform("contract.tax_fact.finance_review", ["contract_staff"])).toBe(false);
    expect(canPerform("contract.tax_fact.confirm", ["finance_director"])).toBe(false);
    expect(canPerform("contract.tax_fact.supplement", ["contract_director"])).toBe(false);
    expect(canPerform("contract.tax_fact.supplement", ["super_admin"])).toBe(false);
    expect(canPerform("contract.tax_fact.finance_review", ["super_admin"])).toBe(false);
    expect(canPerform("contract.tax_fact.confirm", ["super_admin"])).toBe(false);
  });

  it("limits historical payment-voucher supplementation to finance roles", () => {
    expect(canPerform("contract.takeover.payment_evidence.upload", ["finance_staff"])).toBe(true);
    expect(canPerform("contract.takeover.payment_evidence.upload", ["finance_director"])).toBe(true);
    expect(canPerform("contract.takeover.payment_evidence.upload", ["contract_staff"])).toBe(false);
    expect(canPerform("contract.takeover.payment_evidence.upload", ["contract_director"])).toBe(false);
    expect(canPerform("contract.takeover.payment_evidence.upload", ["super_admin"])).toBe(false);
  });

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

  it("only allows contract staff to create settlements", () => {
    expect(canPerform("settlement.create", ["contract_staff"])).toBe(true);
    expect(canPerform("settlement.create", ["contract_director"])).toBe(false);
    expect(canPerform("settlement.create", ["budget_staff"])).toBe(false);
    expect(canPerform("settlement.create", ["budget_director"])).toBe(false);
    expect(canPerform("settlement.create", ["project_manager"])).toBe(false);
    expect(canPerform("settlement.create", ["finance_staff"])).toBe(false);
  });

  it.each([
    "finance_staff",
    "finance_director",
    "comprehensive_director"
  ] as const)(
    "does not turn historical-contract and ledger readers into contract or settlement writers: %s",
    (role) => {
      expect(canPerform("contract.create", [role])).toBe(false);
      expect(canPerform("contract.submit", [role])).toBe(false);
      expect(canPerform("contract.archive.upload", [role])).toBe(false);
      expect(canPerform("contract.archive.confirm", [role])).toBe(false);
      expect(canPerform("contract.tax_fact.supplement", [role])).toBe(false);
      expect(canPerform("contract.tax_fact.confirm", [role])).toBe(false);
      expect(canPerform("settlement.create", [role])).toBe(false);
      expect(canPerform("settlement.archive.upload", [role])).toBe(false);
      expect(canPerform("settlement.archive.confirm", [role])).toBe(false);
    }
  );

  it("requires finance_staff (cashier) to record actual payment execution", () => {
    expect(canPerform("payment.execution", ["finance_staff"])).toBe(true);
    expect(canPerform("payment.execution", ["finance_director"])).toBe(false);
    expect(canPerform("payment.execution", ["chairman"])).toBe(false);
  });

  it("requires contract or project manager roles to create payment requests", () => {
    expect(canPerform("payment.create", ["contract_staff"])).toBe(true);
    expect(canPerform("payment.create", ["contract_director"])).toBe(true);
    expect(canPerform("payment.create", ["project_manager"])).toBe(true);
    expect(canPerform("payment.create", ["finance_staff"])).toBe(false);
    expect(canPerform("payment.create", ["employee"])).toBe(false);
  });

  it("requires finance staff or finance director to record project receipts", () => {
    expect(canPerform("project.receipt.record", ["finance_staff"])).toBe(true);
    expect(canPerform("project.receipt.record", ["finance_director"])).toBe(true);
    expect(canPerform("project.receipt.record", ["project_manager"])).toBe(false);
    expect(canPerform("project.receipt.record", ["chairman"])).toBe(false);
  });

  it("requires finance staff or finance director to record project proxy payments", () => {
    expect(canPerform("project.proxy_payment.record", ["finance_staff"])).toBe(true);
    expect(canPerform("project.proxy_payment.record", ["finance_director"])).toBe(true);
    expect(canPerform("project.proxy_payment.record", ["project_manager"])).toBe(false);
    expect(canPerform("project.proxy_payment.record", ["chairman"])).toBe(false);
  });

  it("requires budget staff or budget director to record upstream settlements", () => {
    expect(canPerform("project.upstream_settlement.record", ["budget_staff"])).toBe(true);
    expect(canPerform("project.upstream_settlement.record", ["budget_director"])).toBe(true);
    expect(canPerform("project.upstream_settlement.record", ["finance_staff"])).toBe(false);
    expect(canPerform("project.upstream_settlement.record", ["project_manager"])).toBe(false);
    expect(canPerform("project.upstream_settlement.record", ["chairman"])).toBe(false);
  });

  it("requires contract roles for project owner contract recording and confirmation", () => {
    expect(canPerform("project.owner_contract.record", ["contract_staff"])).toBe(true);
    expect(canPerform("project.owner_contract.record", ["contract_director"])).toBe(false);
    expect(canPerform("project.owner_contract.confirm", ["contract_director"])).toBe(true);
    expect(canPerform("project.owner_contract.confirm", ["contract_staff"])).toBe(false);
    expect(canPerform("project.owner_contract.record", ["finance_staff"])).toBe(false);
    expect(canPerform("project.owner_contract.confirm", ["chairman"])).toBe(false);
  });

  it("routes settlement exception quota request and approval through business roles", () => {
    expect(canPerform("project.settlement_exception_quota.request", ["project_manager"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.request", ["budget_director"])).toBe(false);
    expect(canPerform("project.settlement_exception_quota.approve", ["project_manager"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.approve", ["budget_director"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.approve", ["contract_director"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.approve", ["chairman"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.approve", ["general_manager"])).toBe(true);
    expect(canPerform("project.settlement_exception_quota.approve", ["finance_staff"])).toBe(false);
  });

  it("routes project financing quota request and approval through project and finance roles", () => {
    expect(canPerform("project.financing_quota.request", ["project_manager"])).toBe(true);
    expect(canPerform("project.financing_quota.request", ["finance_director"])).toBe(false);
    expect(canPerform("project.financing_quota.approve", ["project_manager"])).toBe(true);
    expect(canPerform("project.financing_quota.approve", ["finance_director"])).toBe(true);
    expect(canPerform("project.financing_quota.approve", ["chairman"])).toBe(true);
    expect(canPerform("project.financing_quota.approve", ["general_manager"])).toBe(true);
    expect(canPerform("project.financing_quota.approve", ["finance_staff"])).toBe(false);
  });

  it("routes project expense actions through applicant, approval, cashier, finance, and void roles", () => {
    expect(canPerform("project_expense.create", ["employee"])).toBe(true);
    expect(canPerform("project_expense.create", ["project_manager"])).toBe(true);
    expect(canPerform("project_expense.create", ["material_staff"])).toBe(true);
    expect(canPerform("project_expense.create", ["finance_staff"])).toBe(false);
    expect(canPerform("project_expense.approve", ["project_manager"])).toBe(true);
    expect(canPerform("project_expense.approve", ["comprehensive_director"])).toBe(true);
    expect(canPerform("project_expense.approve", ["finance_director"])).toBe(true);
    expect(canPerform("project_expense.approve", ["chairman"])).toBe(true);
    expect(canPerform("project_expense.approve", ["finance_staff"])).toBe(false);
    expect(canPerform("project_expense.purchase_execute", ["material_staff"])).toBe(true);
    expect(canPerform("project_expense.purchase_execute", ["material_director"])).toBe(true);
    expect(canPerform("project_expense.purchase_execute", ["finance_staff"])).toBe(false);
    expect(canPerform("project_expense.execution", ["finance_staff"])).toBe(true);
    expect(canPerform("project_expense.execution", ["finance_director"])).toBe(false);
    expect(canPerform("project_expense.finance_record", ["finance_director"])).toBe(true);
    expect(canPerform("project_expense.receipt_confirm", ["material_staff"])).toBe(true);
    expect(canPerform("project_expense.receipt_confirm", ["finance_staff"])).toBe(false);
    expect(canPerform("project_expense.void", ["project_manager"])).toBe(true);
    expect(canPerform("project_expense.void", ["employee"])).toBe(false);
  });

  it("routes new expense claims through the real applicant, comprehensive office and frozen approval roles", () => {
    expect(canPerform("expense_claim.create", ["employee"])).toBe(true);
    expect(canPerform("expense_claim.create", ["comprehensive_director"])).toBe(true);
    expect(canPerform("expense_claim.create", ["finance_staff"])).toBe(false);
    expect(canPerform("expense_claim.submit", ["employee"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["comprehensive_director"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["project_manager"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["finance_director"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["chairman"])).toBe(true);
    expect(canPerform("expense_claim.approve", ["finance_staff"])).toBe(false);
  });
});

describe("effective role resolution", () => {
  it("merges allowed global and project roles without duplicates", () => {
    const result = resolveEffectiveRoleKeys(
      ["finance_staff", "engineering_tech"],
      ["contract_staff", "employee"]
    );
    expect(result).toEqual(
      expect.arrayContaining(["finance_staff", "employee", "contract_staff"])
    );
    expect(result).toHaveLength(3);
  });

  it("does not let erroneous global project roles become effective", () => {
    expect(
      resolveEffectiveRoleKeys(["engineering_department_member", "project_manager"], [])
    ).toEqual([]);
    expect(
      resolveEffectiveRoleKeys([], ["engineering_department_member", "project_manager"])
    ).toEqual(["engineering_department_member", "project_manager"]);
  });

  it("works with only global roles", () => {
    expect(resolveEffectiveRoleKeys(["chairman"])).toEqual(["chairman"]);
  });

  it("grants access only when a project role supplies the needed position", () => {
    const globalOnly = resolveEffectiveRoleKeys(["engineering_tech"], []);
    expect(canPerform("contract.archive.confirm", globalOnly)).toBe(false);

    const withProjectRole = resolveEffectiveRoleKeys(
      ["engineering_tech"],
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
      "budget_director",
      "material_director",
      "comprehensive_director",
      "engineering_director",
      "project_manager",
      "finance_director",
      "contract_director",
      "chairman",
      "general_manager"
    ]);
  });
});
