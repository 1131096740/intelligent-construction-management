import { describe, expect, it } from "vitest";
import {
  contractSettlementModeLabel,
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
});
