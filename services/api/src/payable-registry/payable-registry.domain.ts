import { ConflictException } from "@nestjs/common";

export type PayableSettlementBalance = Readonly<{
  remainingPayableCents: bigint;
  overSettledAmountCents: bigint;
  settlementReconciliationRequired: boolean;
}>;

export function derivePayableSettlementBalance(input: Readonly<{
  effectiveAmountCents: bigint;
  validSettledAmountCents: bigint;
}>): PayableSettlementBalance {
  const effectiveAmountCents = nonNegativeCents(input.effectiveAmountCents, "应付有效金额");
  const validSettledAmountCents = nonNegativeCents(input.validSettledAmountCents, "有效已核销金额");
  const remainingPayableCents = effectiveAmountCents > validSettledAmountCents
    ? effectiveAmountCents - validSettledAmountCents
    : 0n;
  const overSettledAmountCents = validSettledAmountCents > effectiveAmountCents
    ? validSettledAmountCents - effectiveAmountCents
    : 0n;
  return Object.freeze({
    remainingPayableCents,
    overSettledAmountCents,
    settlementReconciliationRequired: overSettledAmountCents > 0n
  });
}

export function assertPayableCanAcceptAllocation(
  balance: PayableSettlementBalance,
  allocationAmountCents: bigint
) {
  const amount = positiveCents(allocationAmountCents, "核销金额");
  if (balance.settlementReconciliationRequired) {
    throw new ConflictException("该应付已超额核销，必须先完成核对");
  }
  if (amount > balance.remainingPayableCents) {
    throw new ConflictException("核销金额超过应付有效余额");
  }
}

function nonNegativeCents(value: bigint, label: string) {
  if (value < 0n) throw new ConflictException(`${label}不能为负数`);
  return value;
}

function positiveCents(value: bigint, label: string) {
  if (value <= 0n) throw new ConflictException(`${label}必须大于零`);
  return value;
}
