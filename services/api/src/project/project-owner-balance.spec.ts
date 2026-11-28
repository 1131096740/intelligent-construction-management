import { resolveOwnerSettlementAdjustment, summarizeProjectOwnerBalance, type OwnerBalancePosting } from "./project-owner-balance";

const posting = (kind: OwnerBalancePosting["kind"], amountYuan: string, ownerId = "owner",
  constructionEnterpriseId = "enterprise"): OwnerBalancePosting => ({ kind, amountYuan, ownerId, constructionEnterpriseId });

describe("owner settlement and collection balances", () => {
  it.each([
    ["100", "80.0000", "0.0000"],
    ["10", "0.0000", "10.0000"]
  ])("allocates a receipt of 20 against a later settlement of %s", (settlement, outstandingYuan, advanceYuan) => {
    expect(summarizeProjectOwnerBalance([posting("receipt", "20"), posting("settlement", settlement)])).toEqual({
      settlementYuan: settlement + ".0000", receivedYuan: "20.0000", outstandingYuan, advanceYuan
    });
  });

  it("keeps collection unchanged after a signed settlement reduction at four-place precision", () => {
    expect(summarizeProjectOwnerBalance([
      posting("settlement", "20.0001"), posting("receipt", "19.9999"), posting("settlement", "-0.0003")
    ])).toEqual({ settlementYuan: "19.9998", receivedYuan: "19.9999", outstandingYuan: "0.0000", advanceYuan: "0.0001" });
  });

  it("does not settle one owner's receivable or another contractor's receivable with an unrelated advance", () => {
    expect(summarizeProjectOwnerBalance([
      posting("settlement", "10", "owner-a"), posting("receipt", "5", "owner-b"),
      posting("settlement", "3", "owner-b", "enterprise-b")
    ])).toEqual({ settlementYuan: "13.0000", receivedYuan: "5.0000", outstandingYuan: "13.0000", advanceYuan: "5.0000" });
  });

  it("keeps a receipt outside income before any owner settlement", () => {
    expect(summarizeProjectOwnerBalance([posting("receipt", "0.0001")])).toEqual({
      settlementYuan: "0.0000", receivedYuan: "0.0001", outstandingYuan: "0.0000", advanceYuan: "0.0001"
    });
  });
});

describe("owner settlement adjustment", () => {
  it("keeps the signed four-place value and derives a positive posting amount", () => {
    expect(resolveOwnerSettlementAdjustment("100.0001", "-99.9999")).toEqual({
      amountYuan: "-99.9999",
      postingAmountYuan: "99.9999",
      direction: "decrease",
      cumulativeYuan: "0.0002"
    });
    expect(resolveOwnerSettlementAdjustment("0.0000", "0.0001")).toEqual({
      amountYuan: "0.0001",
      postingAmountYuan: "0.0001",
      direction: "increase",
      cumulativeYuan: "0.0001"
    });
  });

  it("accepts cancellation to zero and refuses a further decrease against the new cumulative amount", () => {
    const cancellation = resolveOwnerSettlementAdjustment("10.0000", "-10");
    expect(cancellation.cumulativeYuan).toBe("0.0000");
    expect(() => resolveOwnerSettlementAdjustment(cancellation.cumulativeYuan, "-0.0001"))
      .toThrow("业主累计结算不能低于零");
  });

  it.each(["", "0", "-0.0000", "1.23456", "1e2"])("rejects an invalid or zero adjustment (%j)", amountYuan => {
    expect(() => resolveOwnerSettlementAdjustment("0.0000", amountYuan)).toThrow();
  });
});
