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
});
