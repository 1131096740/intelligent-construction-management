import {
  createPol05OperatingSourceRegistry,
  POL05_OPERATING_SOURCE_TYPES
} from "./operating-ledger.module";

describe("OperatingLedgerModule POL-05 registry", () => {
  it("registers the complete formal source catalog without treating FinanceRecord as an economic fact", () => {
    const registry = createPol05OperatingSourceRegistry();

    expect(registry.list().map((adapter) => adapter.sourceType).sort()).toEqual(
      [...POL05_OPERATING_SOURCE_TYPES].sort()
    );
    expect(POL05_OPERATING_SOURCE_TYPES).toEqual([
      "project_upstream_settlement",
      "settlement",
      "payment_execution",
      "project_proxy_payment"
    ]);
    expect(() => registry.assertComplete()).not.toThrow();
    expect(() => registry.require("finance_record")).toThrow(
      "缺少经营来源适配器"
    );
  });
});
