import { describe, expect, it } from "vitest";
import {
  contractSettlementModeLabel,
  directPaymentAmountNature,
  suggestedContractSettlementMode
} from "./contract-settlement-mode";

describe("contract settlement mode", () => {
  it("only suggests direct payment for a generic contract without a bill", () => {
    expect(suggestedContractSettlementMode({
      contractTypeKey: "generic_contract",
      hasBill: false
    })).toBe("direct_payment");
    expect(suggestedContractSettlementMode({
      contractTypeKey: "generic_contract",
      hasBill: true
    })).toBe("settlement_required");
    expect(suggestedContractSettlementMode({
      contractTypeKey: "material_purchase",
      hasBill: false
    })).toBe("settlement_required");
  });

  it("labels the two business choices", () => {
    expect(contractSettlementModeLabel("settlement_required")).toBe("需要结算");
    expect(contractSettlementModeLabel("direct_payment")).toBe("按合同直接付款");
  });

  it("derives direct-payment amount nature from the explicit limit flag, not from a zero amount", () => {
    expect(
      directPaymentAmountNature({
        amountLimitType: "capped",
        amountCents: 0n
      })
    ).toBe("fixed_limit");
    expect(
      directPaymentAmountNature({
        amountLimitType: "unlimited",
        amountCents: 9_999_999n
      })
    ).toBe("unlimited_total");
  });
});
