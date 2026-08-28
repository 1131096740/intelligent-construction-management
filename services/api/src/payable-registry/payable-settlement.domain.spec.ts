import { assertAllocationSetMatchesPaymentExecution } from "./payable-settlement.domain";

describe("generic payable settlement allocation", () => {
  const execution = {
    id: "execution-1",
    amountCents: 10_000n,
    currencyCode: "CNY",
    approvedPayerCompanyId: "company-1",
    actualPayerCompanyId: "company-1"
  } as const;

  it("accepts a multi-line allocation only when its exact immutable totals and three-party identities match the existing execution", () => {
    expect(() =>
      assertAllocationSetMatchesPaymentExecution(execution, [
        {
          payableRef: "payable-1",
          amountCents: 4_000n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        },
        {
          payableRef: "payable-2",
          amountCents: 6_000n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        }
      ])
    ).not.toThrow();
  });

  it("fails closed when the same execution attempts to settle different payees even if the total matches", () => {
    expect(() =>
      assertAllocationSetMatchesPaymentExecution(execution, [
        {
          payableRef: "payable-1",
          amountCents: 4_000n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        },
        {
          payableRef: "payable-2",
          amountCents: 6_000n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-2",
          currencyCode: "CNY"
        }
      ])
    ).toThrow("同一实际付款的核销行收款方必须一致");
  });

  it("includes existing approved execution allocations in exact amount conservation", () => {
    expect(() =>
      assertAllocationSetMatchesPaymentExecution(
        execution,
        [{
          payableRef: "payable-1",
          amountCents: 7_000n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        }],
        { otherAllocatedAmountCents: 3_000n }
      )
    ).not.toThrow();

    expect(() =>
      assertAllocationSetMatchesPaymentExecution(
        execution,
        [{
          payableRef: "payable-1",
          amountCents: 6_999n,
          debtorCompanyId: "company-1",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        }],
        { otherAllocatedAmountCents: 3_000n }
      )
    ).toThrow("核销与其他付款用途合计必须精确等于实际付款金额");
  });

  it("allows a controlled proxy payment when the original debtor and actual payer differ", () => {
    expect(() =>
      assertAllocationSetMatchesPaymentExecution(
        {
          ...execution,
          approvedPayerCompanyId: "company-approved",
          actualPayerCompanyId: "company-actual"
        },
        [{
          payableRef: "payable-1",
          amountCents: 10_000n,
          debtorCompanyId: "company-debtor",
          payeeSubjectType: "business_party",
          payeeSubjectId: "party-version-1",
          currencyCode: "CNY"
        }],
        {
          allowInterEntityProxy: true,
          expectedOriginalDebtorCompanyId: "company-debtor"
        }
      )
    ).not.toThrow();
  });
});
