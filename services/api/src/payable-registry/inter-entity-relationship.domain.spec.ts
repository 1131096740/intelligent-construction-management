import {
  assertInterEntityReturnAmount,
  assertProxySettlementFacts,
  deriveInterEntityRelationshipBalance,
  type InterEntityRelationshipEntryInput,
  type ProxySettlementFacts
} from "./inter-entity-relationship.domain";

describe("inter-entity payable relationship domain", () => {
  const facts: ProxySettlementFacts = {
    originalDebtorCompanyId: "company-debtor",
    approvedPayerCompanyId: "company-approved",
    actualPayerCompanyId: "company-actual",
    amountCents: 10_000n,
    currencyCode: "CNY",
    paymentExecutionId: "execution-1",
    settlementCaseId: "case-1",
    voucherFileId: "file-1"
  };

  it("accepts three stable company identities and derives one equal relationship", () => {
    expect(assertProxySettlementFacts(facts)).toEqual({
      debtorCompanyId: "company-debtor",
      creditorCompanyId: "company-actual",
      approvedPayerCompanyId: "company-approved",
      amountCents: 10_000n,
      currencyCode: "CNY",
      paymentExecutionId: "execution-1",
      settlementCaseId: "case-1",
      voucherFileId: "file-1"
    });
  });

  it("fails closed when any subject is missing or actual payer equals original debtor", () => {
    expect(() => assertProxySettlementFacts({ ...facts, actualPayerCompanyId: "" })).toThrow(
      "代付往来三方主体必须使用稳定公司身份"
    );
    expect(() =>
      assertProxySettlementFacts({ ...facts, actualPayerCompanyId: facts.originalDebtorCompanyId })
    ).toThrow("实际付款主体与原债务主体一致，不应创建代付往来");
  });

  it("requires positive CNY amount and immutable execution/case/evidence references", () => {
    expect(() => assertProxySettlementFacts({ ...facts, amountCents: 0n })).toThrow(
      "代付往来金额必须大于零"
    );
    expect(() => assertProxySettlementFacts({ ...facts, currencyCode: "USD" as "CNY" })).toThrow(
      "代付往来仅支持人民币"
    );
    expect(() => assertProxySettlementFacts({ ...facts, paymentExecutionId: "" })).toThrow(
      "代付往来必须引用实际付款与核销案件"
    );
    expect(() => assertProxySettlementFacts({ ...facts, voucherFileId: "" })).toThrow(
      "代付往来必须保留付款凭证引用"
    );
  });

  it("computes remaining balance from append-only increases and decreases", () => {
    const entries: InterEntityRelationshipEntryInput[] = [
      { direction: "increase", amountCents: 10_000n },
      { direction: "decrease", amountCents: 2_500n }
    ];
    expect(deriveInterEntityRelationshipBalance(entries)).toEqual({
      increasedAmountCents: 10_000n,
      decreasedAmountCents: 2_500n,
      remainingAmountCents: 7_500n
    });
  });

  it("rejects an over-return and accepts a partial return only against the open balance", () => {
    expect(() =>
      assertInterEntityReturnAmount({
        increasedAmountCents: 10_000n,
        existingDecreasedAmountCents: 7_500n,
        requestedDecreaseAmountCents: 2_501n
      })
    ).toThrow("代付往来归还金额超过未结余额");
    expect(
      assertInterEntityReturnAmount({
        increasedAmountCents: 10_000n,
        existingDecreasedAmountCents: 7_500n,
        requestedDecreaseAmountCents: 2_500n
      })
    ).toEqual({ remainingAmountCents: 0n });
  });
});
