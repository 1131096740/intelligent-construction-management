import { describe, expect, it } from "vitest";
import {
  canExportContractSettlementLedger,
  canConfirmHistoricalContractFacts,
  canConfirmHistoricalFinanceFacts,
  canEditHistoricalContractFacts,
  canEditHistoricalFinanceFacts,
  canManageContractRecords,
  canManageHistoricalContractTakeovers,
  canManageSettlementRecords,
  canReadHistoricalContractTakeovers,
  canReviewHistoricalTakeoverCorrection,
  canSubmitHistoricalTakeoverCorrection,
  canWithdrawHistoricalTakeoverConfirmation,
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

  it("keeps contract and finance takeover actions on their own side", () => {
    expect(canEditHistoricalContractFacts(["contract_staff"])).toBe(true);
    expect(canConfirmHistoricalContractFacts(["contract_director"])).toBe(true);
    expect(canEditHistoricalContractFacts(["finance_director"])).toBe(false);
    expect(canConfirmHistoricalContractFacts(["super_admin"])).toBe(false);

    expect(canEditHistoricalFinanceFacts(["finance_staff"])).toBe(true);
    expect(canConfirmHistoricalFinanceFacts(["finance_director"])).toBe(true);
    expect(canEditHistoricalFinanceFacts(["contract_director"])).toBe(false);
    expect(canConfirmHistoricalFinanceFacts(["super_admin"])).toBe(false);
  });

  it("requires the matching side director for withdrawal and correction review", () => {
    expect(
      canWithdrawHistoricalTakeoverConfirmation(["contract_director"], "contract")
    ).toBe(true);
    expect(
      canWithdrawHistoricalTakeoverConfirmation(["contract_director"], "finance")
    ).toBe(false);
    expect(
      canWithdrawHistoricalTakeoverConfirmation(["finance_director"], "finance")
    ).toBe(true);

    expect(
      canSubmitHistoricalTakeoverCorrection(["contract_staff"], "contract")
    ).toBe(true);
    expect(
      canSubmitHistoricalTakeoverCorrection(["contract_staff"], "finance")
    ).toBe(false);
    expect(
      canReviewHistoricalTakeoverCorrection(["finance_director"], "finance")
    ).toBe(true);
    expect(
      canReviewHistoricalTakeoverCorrection(["finance_director"], "contract")
    ).toBe(false);
    expect(
      canReviewHistoricalTakeoverCorrection(["super_admin"], "contract")
    ).toBe(false);
  });
});
