import { Prisma } from "@prisma/client";
import {
  calculateSignedSettlementPaymentCapacity,
  loadSignedSettlementPaymentBasis,
  settlementAmountYuanToCents
} from "./signed-settlement-payment-capacity";

const capacity = (input: {
  confirmedCents: bigint;
  paidCents?: bigint;
  advancePaidCents?: bigint;
  outstandingCents?: bigint;
  proxyPaidCents?: bigint;
  historicalOutstandingCents?: bigint;
}) =>
  calculateSignedSettlementPaymentCapacity({
    confirmedCents: input.confirmedCents,
    paidCents: input.paidCents ?? 0n,
    advancePaidCents: input.advancePaidCents ?? 0n,
    outstandingCents: input.outstandingCents ?? 0n,
    proxyPaidCents: input.proxyPaidCents ?? 0n,
    historicalOutstandingCents: input.historicalOutstandingCents ?? 0n
  });

describe("signed settlement payment capacity (PAY-03/PAY-04/PAY-07/PAY-08)", () => {
  it("counts a paid contract advance against the cumulative settlement and shows the unsettled advance", () => {
    // 合同累计结算 20 元，已付预付款 30 元：普通结算可付为 0，未结算预付款 10 元。
    const result = capacity({ confirmedCents: 2_000n, paidCents: 3_000n, advancePaidCents: 3_000n });

    expect(result.occupiedCents).toBe(3_000n);
    expect(result.remainingCents).toBe(0n);
    expect(result.overpayCents).toBe(1_000n);
    expect(result.unsettledAdvanceCents).toBe(1_000n);
    expect(result.abnormalOverpayCents).toBe(0n);
    expect(result.suspended).toBe(true);
  });

  it("keeps an abnormal overpayment separate from the unsettled advance", () => {
    // 累计 20，预付 30，另有普通实付 20：超付 30 = 未结算预付 10 + 异常超付 20。
    const result = capacity({ confirmedCents: 2_000n, paidCents: 5_000n, advancePaidCents: 3_000n });

    expect(result.overpayCents).toBe(3_000n);
    expect(result.unsettledAdvanceCents).toBe(1_000n);
    expect(result.abnormalOverpayCents).toBe(2_000n);
  });

  it.each([
    ["NONE", 7_000n],
    ["B", 6_000n]
  ])("does not recount the historical advance in the write capacity for takeover level %s", async (takeoverLevel, historicalPaidCents) => {
    const tx = {
      signedContractSettlement: { findMany: jest.fn().mockResolvedValue([{
        id: "signed", number: "接管后结算", amountYuan: "10.0000", confirmationNo: 1n,
        reviewedAt: new Date("2026-11-24T00:00:00Z")
      }]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { findFirst: jest.fn().mockResolvedValue({
        id: "takeover", takeoverLevel, takeoverStatus: "confirmed",
        historicalBalanceConfirmedAt: new Date("2026-11-23T00:00:00Z"),
        historicalSettledCents: 6_000n, historicalPaidCents, historicalAdvancePaidCents: 1_000n
      }) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) }
    };
    await expect(loadSignedSettlementPaymentBasis(tx as never, "contract"))
      .resolves.toMatchObject({
        historicalConfirmedCents: 6_000n, confirmedCents: 7_000n, netPaidCents: 7_000n,
        advancePaidCents: 1_000n, abnormalOverpayCents: 0n, remainingCents: 0n, suspended: false
      });
  });

  it("uses the cumulative settlement rather than the latest period as the ceiling", () => {
    // 最后一期是 -30，但合同累计 70，已付 20，本次可付 50。
    const result = capacity({ confirmedCents: 7_000n, paidCents: 2_000n });

    expect(result.remainingCents).toBe(5_000n);
    expect(result.suspended).toBe(false);
  });

  it("counts every unpaid application as occupancy and suspends only while the total is over the balance", () => {
    const insufficient = capacity({
      confirmedCents: 10_000n,
      paidCents: 5_000n,
      outstandingCents: 6_000n
    });
    expect(insufficient.capacityShortfallCents).toBe(1_000n);
    expect(insufficient.suspended).toBe(true);

    const sufficient = capacity({
      confirmedCents: 10_000n,
      paidCents: 5_000n,
      outstandingCents: 4_000n
    });
    expect(sufficient.rawRemainingCents).toBe(1_000n);
    expect(sufficient.suspended).toBe(false);
  });

  it("rounds the accumulated settlement to the nearest cent with symmetric negative rounding", () => {
    expect(settlementAmountYuanToCents(new Prisma.Decimal("0.005"))).toBe(1n);
    const accumulated = new Prisma.Decimal("0.0050").plus("0.0050");
    expect(settlementAmountYuanToCents(accumulated)).toBe(1n);

    const confirmedCents = settlementAmountYuanToCents(new Prisma.Decimal("100.005"));
    expect(confirmedCents).toBe(10_001n);
    expect(capacity({ confirmedCents, paidCents: 10_001n })).toMatchObject({
      rawRemainingCents: 0n,
      remainingCents: 0n,
      overpayCents: 0n,
      suspended: false
    });
    expect(settlementAmountYuanToCents(new Prisma.Decimal("-0.005"))).toBe(-1n);
  });
});
