import {
  assertActualPurchaseBatchCommitment,
  assertActualPurchaseBatchExecution,
  calculateActualPurchaseBatchCapacity,
  formatYuan,
  type ActualPurchaseBatchCapacityPayment
} from "./actual-purchase-batch-capacity";

function payment(
  requestedAmountCents: bigint,
  paidAmountCents = 0n,
  refundedAmountCents = 0n,
  countsAgainstBatch = true
): ActualPurchaseBatchCapacityPayment {
  return {
    requestedAmountCents,
    paidAmountCents,
    refundedAmountCents,
    countsAgainstBatch
  };
}

describe("实际采购批次付款容量", () => {
  it("10k 批次首申 3k：占用 3k，可再申请 7k，不暂停", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [payment(3_000n)]);
    expect(capacity.netPaidAmountCents).toBe(0n);
    expect(capacity.outstandingCommittedAmountCents).toBe(3_000n);
    expect(capacity.availableAmountCents).toBe(7_000n);
    expect(capacity.suspended).toBe(false);
    expect(capacity.suspendReason).toBeNull();
  });

  it("首笔 3k 通过并实付后成本仍按批次 10k，已有实付只按 3k 计；第二批 7k 正好用尽", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [
      payment(3_000n, 3_000n),
      payment(7_000n)
    ]);
    expect(capacity.paidAmountCents).toBe(3_000n);
    expect(capacity.outstandingCommittedAmountCents).toBe(7_000n);
    expect(capacity.availableAmountCents).toBe(0n);
    expect(capacity.suspended).toBe(false);
  });

  it("草稿/驳回/撤回不占容量", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [
      payment(3_000n, 0n, 0n, false),
      payment(4_000n, 0n, 0n, false)
    ]);
    expect(capacity.outstandingCommittedAmountCents).toBe(0n);
    expect(capacity.availableAmountCents).toBe(10_000n);
  });

  it("更正为 8k 且已占 3k+7k 时暂停，不可再付", () => {
    const capacity = calculateActualPurchaseBatchCapacity(8_000n, [
      payment(3_000n, 3_000n),
      payment(7_000n)
    ]);
    expect(capacity.suspended).toBe(true);
    expect(capacity.suspendReason).toBe("commitments_exceed_total");
    expect(capacity.availableAmountCents).toBe(-2_000n);
    expect(() => assertActualPurchaseBatchExecution(capacity, 1n)).toThrow("暂停");
  });

  it("退款回补容量：已付 3k 退 2k 后净付 1k，可再付 9k", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [
      payment(3_000n, 3_000n, 2_000n)
    ]);
    expect(capacity.netPaidAmountCents).toBe(1_000n);
    expect(capacity.availableAmountCents).toBe(9_000n);
    expect(capacity.suspended).toBe(false);
  });

  it("更正到低于已付时如实显示超付并暂停", () => {
    const capacity = calculateActualPurchaseBatchCapacity(2_000n, [
      payment(3_000n, 3_000n)
    ]);
    expect(capacity.overpaidAmountCents).toBe(1_000n);
    expect(capacity.suspended).toBe(true);
    expect(capacity.suspendReason).toBe("cost_overpaid");
    expect(() => assertActualPurchaseBatchCommitment(capacity, 1n)).toThrow("低于已付金额");
  });

  it("只能申请不超过剩余可付金额", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [payment(3_000n)]);
    expect(() => assertActualPurchaseBatchCommitment(capacity, 7_001n)).toThrow("最多可申请 70.00 元");
    expect(() => assertActualPurchaseBatchCommitment(capacity, 7_000n)).not.toThrow();
  });

  it("实付不得超过批次净已付上限，跨付款累计计算", () => {
    const capacity = calculateActualPurchaseBatchCapacity(10_000n, [
      payment(3_000n, 3_000n),
      payment(5_000n, 0n)
    ]);
    expect(() => assertActualPurchaseBatchExecution(capacity, 7_001n)).toThrow("最多可付 70.00 元");
    expect(() => assertActualPurchaseBatchExecution(capacity, 7_000n)).not.toThrow();
  });

  it("金额格式化为两位小数", () => {
    expect(formatYuan(10_000n)).toBe("100.00");
    expect(formatYuan(-2_500n)).toBe("-25.00");
  });
});
