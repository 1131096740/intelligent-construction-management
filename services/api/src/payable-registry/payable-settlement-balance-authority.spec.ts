import {
  loadPayableSettlementAllocationTotals,
  payableSettlementAllocationTotalsFor
} from "./payable-settlement-balance-authority";

describe("共享应付核销余额权威", () => {
  it("同时纳入已确认 #220、Claim-backed PaymentExecution 与 confirmed FundExecution", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        payableRef: "payable-1",
        confirmedAmountCents: 7_000n,
        activeAmountCents: 9_000n
      }
    ]);

    const totals = await loadPayableSettlementAllocationTotals(
      { $queryRaw: queryRaw },
      ["payable-1", "payable-1"],
      { excludeSettlementCaseId: "current-case" }
    );

    expect(payableSettlementAllocationTotalsFor(totals, "payable-1")).toEqual({
      confirmedAmountCents: 7_000n,
      activeAmountCents: 9_000n
    });
    expect(payableSettlementAllocationTotalsFor(totals, "missing")).toEqual({
      confirmedAmountCents: 0n,
      activeAmountCents: 0n
    });
    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[] };
    const sql = query.strings.join(" ");
    expect(sql).toContain('"PayableSettlementCase"');
    expect(sql.match(/"BankTransactionClaim"/g)).toHaveLength(2);
    expect(sql.match(/"ExecutionAllocationLine"/g)).toHaveLength(2);
    expect(sql).toContain('"FundExecutionCase"');
    expect(sql).toContain('IS DISTINCT FROM');
  });
});
