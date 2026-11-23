/**
 * 历史接管的历史资金事实摘要。
 *
 * 历史实付/收款只解释“接管前已经发生过什么”，不会再次扣减启用时的
 * 现金或公司资金期初；这里只做事实汇总与待核对提示，不产生退款动作。
 */
export type TakeoverMoneyRelationship = "inside" | "outside" | "upward";

export type TakeoverOverpaymentKind =
  | "none"
  | "unsettled_advance"
  | "pending_verification";

export interface TakeoverMoneySummary {
  relationship: TakeoverMoneyRelationship;
  historicalPaidCents: bigint;
  historicalSettledCents: bigint;
  historicalReceiptsCents: bigint;
  /** 表内/表外：已付超过累计结算的部分。 */
  historicalOverpaidCents: bigint;
  historicalOverpaymentKind: TakeoverOverpaymentKind;
  historicalOverpaymentLabel: string;
  /** 对上：施工企业付我方的历史实收超过累计结算的部分。 */
  historicalOverReceivedCents: bigint;
  historicalOverReceivedPendingVerification: boolean;
}

export function summarizeTakeoverMoney(input: {
  relationship: TakeoverMoneyRelationship;
  paidCents: bigint;
  settledCents: bigint;
  excessTreatment?: string | null;
}): TakeoverMoneySummary {
  const paidCents = input.paidCents < 0n ? 0n : input.paidCents;
  const settledCents = input.settledCents < 0n ? 0n : input.settledCents;
  const overpaidCents =
    input.relationship === "upward" || paidCents <= settledCents
      ? 0n
      : paidCents - settledCents;
  const kind: TakeoverOverpaymentKind =
    overpaidCents === 0n
      ? "none"
      : input.excessTreatment === "historical_advance"
        ? "unsettled_advance"
        : "pending_verification";
  const receiptsCents =
    input.relationship === "upward" ? paidCents : 0n;
  const overReceivedCents =
    input.relationship === "upward" && receiptsCents > settledCents
      ? receiptsCents - settledCents
      : 0n;
  return {
    relationship: input.relationship,
    historicalPaidCents: paidCents,
    historicalSettledCents: settledCents,
    historicalReceiptsCents: receiptsCents,
    historicalOverpaidCents: overpaidCents,
    historicalOverpaymentKind: kind,
    historicalOverpaymentLabel:
      kind === "none"
        ? "未超付"
        : kind === "unsettled_advance"
          ? "未结算预付款"
          : "超付，性质待核对",
    historicalOverReceivedCents: overReceivedCents,
    historicalOverReceivedPendingVerification: overReceivedCents > 0n
  };
}
