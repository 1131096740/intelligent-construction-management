import { describe, expect, it } from "vitest";
import {
  canExportContractSettlementLedger,
  canManageContractRecords,
  canManageHistoricalContractTakeovers,
  canManageSettlementRecords,
  canReadHistoricalContractTakeovers,
  canUploadHistoricalPaymentVoucher
} from "./business-readonly-access";

describe("business read-only access", () => {
  it.each([
    "finance_staff",
    "finance_director",
    "comprehensive_director"
  ] as const)(
    "gives %s ledger/takeover reads and exports without contract or settlement maintenance",
    (roleKey) => {
      expect(canReadHistoricalContractTakeovers([roleKey])).toBe(true);
      expect(canExportContractSettlementLedger([roleKey])).toBe(true);
      expect(canManageHistoricalContractTakeovers([roleKey])).toBe(false);
      expect(canManageContractRecords([roleKey])).toBe(false);
      expect(canManageSettlementRecords([roleKey])).toBe(false);
      expect(canUploadHistoricalPaymentVoucher([roleKey])).toBe(
        roleKey === "finance_staff" || roleKey === "finance_director"
      );
    }
  );

  it("preserves contract department maintenance and excludes unrelated readers from export", () => {
    expect(canManageHistoricalContractTakeovers(["contract_staff"])).toBe(true);
    expect(canManageContractRecords(["contract_director"])).toBe(true);
    expect(canManageSettlementRecords(["contract_staff"])).toBe(true);
    expect(canExportContractSettlementLedger(["contract_staff"])).toBe(true);
    expect(canExportContractSettlementLedger(["budget_staff"])).toBe(false);
    expect(canReadHistoricalContractTakeovers(["budget_director"])).toBe(false);
    expect(canUploadHistoricalPaymentVoucher(["contract_staff"])).toBe(false);
  });
});
