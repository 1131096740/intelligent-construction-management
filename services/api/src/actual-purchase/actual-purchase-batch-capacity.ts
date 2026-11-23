import { BadRequestException, ConflictException } from "@nestjs/common";

/**
 * #403 批次付款容量：实际采购批次金额与付款申请分开。成本只按批次确认一次，
 * 已付只按实际实付登记；已提交未付、通过待付和部分付款的未付余额占用批次容量，
 * 草稿/驳回/撤回不占。退款回补容量；批次更正调减后不足覆盖剩余付款时暂停。
 */
export interface ActualPurchaseBatchCapacityPayment {
  requestedAmountCents: bigint;
  paidAmountCents: bigint;
  refundedAmountCents: bigint;
  countsAgainstBatch: boolean;
}

export interface ActualPurchaseBatchCapacity {
  effectiveTotalAmountCents: bigint;
  paidAmountCents: bigint;
  refundedAmountCents: bigint;
  netPaidAmountCents: bigint;
  outstandingCommittedAmountCents: bigint;
  usedAmountCents: bigint;
  availableAmountCents: bigint;
  payableNowAmountCents: bigint;
  overpaidAmountCents: bigint;
  suspended: boolean;
  suspendReason: "cost_overpaid" | "commitments_exceed_total" | null;
}

export function calculateActualPurchaseBatchCapacity(
  effectiveTotalAmountCents: bigint,
  payments: readonly ActualPurchaseBatchCapacityPayment[]
): ActualPurchaseBatchCapacity {
  if (effectiveTotalAmountCents <= 0n) {
    throw new BadRequestException("实际采购批次金额必须大于 0");
  }
  let paidAmountCents = 0n;
  let refundedAmountCents = 0n;
  let outstandingCommittedAmountCents = 0n;
  for (const payment of payments) {
    if (
      payment.paidAmountCents < 0n ||
      payment.refundedAmountCents < 0n ||
      payment.requestedAmountCents < 0n ||
      payment.refundedAmountCents > payment.paidAmountCents
    ) {
      throw new BadRequestException("批次付款金额事实不正确，请核对原付款与退款记录");
    }
    paidAmountCents += payment.paidAmountCents;
    refundedAmountCents += payment.refundedAmountCents;
    if (payment.countsAgainstBatch) {
      const paidOnPayment = payment.paidAmountCents;
      const remaining =
        payment.requestedAmountCents > paidOnPayment
          ? payment.requestedAmountCents - paidOnPayment
          : 0n;
      outstandingCommittedAmountCents += remaining;
    }
  }
  const netPaidAmountCents = paidAmountCents - refundedAmountCents;
  const usedAmountCents =
    netPaidAmountCents + outstandingCommittedAmountCents;
  const availableAmountCents =
    effectiveTotalAmountCents - usedAmountCents;
  const payableNowAmountCents =
    effectiveTotalAmountCents > netPaidAmountCents
      ? effectiveTotalAmountCents - netPaidAmountCents
      : 0n;
  const overpaidAmountCents =
    netPaidAmountCents > effectiveTotalAmountCents
      ? netPaidAmountCents - effectiveTotalAmountCents
      : 0n;
  const suspended = usedAmountCents > effectiveTotalAmountCents;
  return {
    effectiveTotalAmountCents,
    paidAmountCents,
    refundedAmountCents,
    netPaidAmountCents,
    outstandingCommittedAmountCents,
    usedAmountCents,
    availableAmountCents,
    payableNowAmountCents,
    overpaidAmountCents,
    suspended,
    suspendReason: !suspended
      ? null
      : netPaidAmountCents > effectiveTotalAmountCents
        ? "cost_overpaid"
        : "commitments_exceed_total"
  };
}

/** 提交/审批新的付款或报销申请前，确认批次仍可覆盖本次申请。 */
export function assertActualPurchaseBatchCommitment(
  capacity: ActualPurchaseBatchCapacity,
  requestedAmountCents: bigint
): void {
  if (requestedAmountCents <= 0n) {
    throw new BadRequestException("付款申请金额必须大于 0");
  }
  if (capacity.suspended) {
    throw new ConflictException(
      capacity.suspendReason === "cost_overpaid"
        ? "实际采购批次已确认金额低于已付金额，剩余付款已暂停，请先核对批次金额或退款"
        : "实际采购批次已确认金额不足以覆盖剩余付款，待付事项已暂停，请先核对批次金额"
    );
  }
  if (capacity.availableAmountCents < requestedAmountCents) {
    throw new ConflictException(
      `本次申请超过批次剩余可付金额，最多可申请 ${formatYuan(capacity.availableAmountCents)} 元`
    );
  }
}

/** 实际付款前，确认批次净实付加上本次不超过批次确认金额。 */
export function assertActualPurchaseBatchExecution(
  capacity: ActualPurchaseBatchCapacity,
  amountCents: bigint
): void {
  if (amountCents <= 0n) {
    throw new BadRequestException("实际付款金额必须大于 0");
  }
  if (capacity.suspended) {
    throw new ConflictException(
      capacity.suspendReason === "cost_overpaid"
        ? "实际采购批次已确认金额低于已付金额，剩余付款已暂停，请先核对批次金额或退款"
        : "实际采购批次已确认金额不足以覆盖剩余付款，待付事项已暂停，请先核对批次金额"
    );
  }
  if (capacity.netPaidAmountCents + amountCents > capacity.effectiveTotalAmountCents) {
    throw new ConflictException(
      `本次付款超过批次可付余额，最多可付 ${formatYuan(capacity.payableNowAmountCents)} 元`
    );
  }
}

export function formatYuan(amountCents: bigint): string {
  const negative = amountCents < 0n;
  const absolute = negative ? -amountCents : amountCents;
  const yuan = absolute / 100n;
  const cents = absolute % 100n;
  return `${negative ? "-" : ""}${yuan.toString()}.${cents.toString().padStart(2, "0")}`;
}
