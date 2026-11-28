import { describe, expect, it } from "vitest";
import { signedChangeBalanceWarning } from "./signed-change-balance";

const facts = {
  effectiveAmountYuan: "10500.0000",
  totalEffectiveSettlementYuan: "1000.0000",
  cumulativePaidYuan: "500.0000"
};

describe("signed change registration balance warning", () => {
  it("stays quiet while the prospective amount covers settled and paid balances", () => {
    expect(signedChangeBalanceWarning(facts, "0")).toBeNull();
    expect(signedChangeBalanceWarning(facts, "-9500.0000")).toBeNull();
    expect(signedChangeBalanceWarning(facts, "-9500.0001")).toMatchObject({ belowSettled: true, belowPaid: false });
  });

  it("names only the balances that the prospective amount falls below", () => {
    expect(signedChangeBalanceWarning(facts, "-9600.0000")).toMatchObject({
      belowSettled: true,
      belowPaid: false,
      message: expect.stringContaining("累计生效结算 1000.0000 元")
    });
    expect(signedChangeBalanceWarning(
      { ...facts, totalEffectiveSettlementYuan: "300.0000", cumulativePaidYuan: "2000.0000" },
      "-9000.0000"
    )).toMatchObject({
      belowSettled: false,
      belowPaid: true,
      message: expect.stringContaining("累计实付 2000.0000 元")
    });
    const both = signedChangeBalanceWarning(facts, "-10300.0000");
    expect(both).toMatchObject({ belowSettled: true, belowPaid: true });
    expect(both?.message).toContain("累计生效结算 1000.0000 元、累计实付 500.0000 元");
    expect(both?.message).toContain("仍可如实登记");
  });

  it("does not invent a total for an unlimited framework contract or invalid input", () => {
    expect(signedChangeBalanceWarning({ ...facts, effectiveAmountYuan: null }, "-1")).toBeNull();
    expect(signedChangeBalanceWarning(facts, "")).toBeNull();
    expect(signedChangeBalanceWarning(facts, "abc")).toBeNull();
    expect(signedChangeBalanceWarning({ ...facts, totalEffectiveSettlementYuan: "bad" }, "-1")).toBeNull();
  });
});
