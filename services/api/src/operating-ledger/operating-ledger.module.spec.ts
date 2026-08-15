import {
  createOperatingSourceRegistry,
  OPERATING_SOURCE_TYPES
} from "./operating-ledger.module";

describe("OperatingLedgerModule formal source registry", () => {
  it("registers the POL-06 expense and loan sources without treating FinanceRecord as an economic fact", () => {
    const registry = createOperatingSourceRegistry();

    expect(registry.list().map((adapter) => adapter.sourceType).sort()).toEqual(
      [...OPERATING_SOURCE_TYPES].sort()
    );
    expect(OPERATING_SOURCE_TYPES).toEqual([
      "project_upstream_settlement",
      "settlement",
      "payment_execution",
      "project_proxy_payment",
      "expense_claim_approval",
      "expense_claim_payment_execution",
      "employee_project_loan_entry"
    ]);
    expect(() => registry.assertComplete()).not.toThrow();
    expect(() => registry.require("finance_record")).toThrow(
      "缺少经营来源适配器"
    );
  });
});
