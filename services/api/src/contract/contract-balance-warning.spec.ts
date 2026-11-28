import { assessContractBalance, formatContractBalanceYuan, readContractBalancePosition } from "./contract-balance-warning";

function fixture() {
  const tx = {
    settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement", amountCents: 100_000n }]) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([{ id: "payment" }]) },
    paymentExecution: { findMany: jest.fn().mockResolvedValue([{ amountCents: 30_000n }, { amountCents: 20_000n }]) },
    projectProxyPayment: { findMany: jest.fn().mockResolvedValue([{ amountCents: 5_000n }]) },
    contractTakeover: { findFirst: jest.fn().mockResolvedValue({
      historicalSettledCents: 10_000n, historicalPaidCents: 3_000n, historicalProxyPaidCents: 2_000n
    }) }
  };
  return { tx, client: tx as never };
}

describe("contract balance warning", () => {
  it("sums effective settlements, executions, proxy payments and confirmed takeover balances", async () => {
    const { tx, client } = fixture();
    await expect(readContractBalancePosition(client, "contract")).resolves.toEqual({
      totalEffectiveSettlementCents: 110_000n,
      cumulativePaidCents: 60_000n
    });
    expect(tx.settlement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contractId: "contract", status: { in: ["effective", "partially_paid", "paid"] } }
    }));
    expect(tx.paymentExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { paymentRequestId: { in: ["payment"] } }
    }));
    expect(tx.projectProxyPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { settlementId: { in: ["settlement"] }, voidedAt: null }
    }));
  });

  it("does not invent a settlement or payment warning for an unlimited framework total", async () => {
    const { tx, client } = fixture();
    tx.contractTakeover.findFirst.mockResolvedValue(null);
    const position = await readContractBalancePosition(client, "contract");
    expect(assessContractBalance(null, position)).toEqual({ belowSettled: false, belowPaid: false, labels: [] });
  });

  it("marks exactly the balances that exceed the prospective contract amount", async () => {
    expect(assessContractBalance("100.0123", {
      totalEffectiveSettlementCents: 10_000n, cumulativePaidCents: 10_000n
    })).toEqual({ belowSettled: false, belowPaid: false, labels: [] });
    expect(assessContractBalance("100.0123", {
      totalEffectiveSettlementCents: 10_002n, cumulativePaidCents: 9_000n
    })).toEqual({ belowSettled: true, belowPaid: false, labels: ["累计生效结算"] });
    expect(assessContractBalance("100.0123", {
      totalEffectiveSettlementCents: 9_000n, cumulativePaidCents: 10_002n
    })).toEqual({ belowSettled: false, belowPaid: true, labels: ["累计实付"] });
    expect(assessContractBalance("100.0123", {
      totalEffectiveSettlementCents: 10_002n, cumulativePaidCents: 10_002n
    })).toEqual({ belowSettled: true, belowPaid: true, labels: ["累计生效结算", "累计实付"] });
  });

  it("formats integer cents as four-decimal business yuan", () => {
    expect(formatContractBalanceYuan(100_012n)).toBe("1000.1200");
    expect(formatContractBalanceYuan(0n)).toBe("0.0000");
  });
});
