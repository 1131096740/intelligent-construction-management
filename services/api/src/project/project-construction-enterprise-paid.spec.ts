import {
  summarizeConstructionEnterprisePaid,
  type ConstructionEnterprisePaidFact
} from "./project-construction-enterprise-paid";

function fact(
  overrides: Partial<ConstructionEnterprisePaidFact> = {}
): ConstructionEnterprisePaidFact {
  return {
    id: "fact-1",
    kind: "downstream_payment",
    counterpartyName: "下游供应商",
    occurredAt: new Date("2026-11-01T00:00:00.000Z"),
    amountCents: 100_000n,
    effectDirection: "increase",
    settlementLedgerId: "ledger-1",
    ...overrides
  };
}

describe("施工企业已付聚合口径", () => {
  it("把付下游与转我方合并为同一已付金额，并按结算账本提示超付", () => {
    const summary = summarizeConstructionEnterprisePaid(
      [
        fact({ id: "downstream", amountCents: 120_000n }),
        fact({
          id: "remittance",
          kind: "affiliate_remittance_to_company",
          counterpartyName: "我方公司",
          amountCents: 50_000n,
          settlementLedgerId: "ledger-2"
        })
      ],
      [
        {
          id: "settlement-1",
          ledgerId: "ledger-1",
          effectDirection: "increase",
          amountCents: 100_000n
        },
        {
          id: "settlement-2",
          ledgerId: "ledger-2",
          effectDirection: "increase",
          amountCents: 200_000n
        }
      ]
    );

    expect(summary).toEqual({
      downstreamCents: 120_000n,
      remittanceCents: 50_000n,
      paidCents: 170_000n,
      overpaidCents: 20_000n
    });
  });

  it("按净额累计反转与重登，不重写原始事实", () => {
    const summary = summarizeConstructionEnterprisePaid(
      [
        fact({ id: "original", amountCents: 120_000n }),
        fact({
          id: "reversal",
          amountCents: 120_000n,
          effectDirection: "decrease"
        }),
        fact({ id: "correction", amountCents: 110_000n })
      ],
      [
        {
          id: "settlement-1",
          ledgerId: "ledger-1",
          effectDirection: "increase",
          amountCents: 100_000n
        }
      ]
    );

    expect(summary.paidCents).toBe(110_000n);
    expect(summary.overpaidCents).toBe(10_000n);
  });

  it("转我方未关联结算账本时只计入已付、不虚构超付", () => {
    const summary = summarizeConstructionEnterprisePaid(
      [
        fact({
          id: "remittance",
          kind: "affiliate_remittance_to_company",
          counterpartyName: "我方公司",
          amountCents: 50_000n,
          settlementLedgerId: null
        })
      ],
      []
    );

    expect(summary.downstreamCents).toBe(0n);
    expect(summary.remittanceCents).toBe(50_000n);
    expect(summary.paidCents).toBe(50_000n);
    expect(summary.overpaidCents).toBe(0n);
  });
});
