export interface ContractChangeApprovalInput {
  changeType: string;
  amountLimitType: string;
  changeAmountCents: bigint | null;
  originalBaseAmountCents: bigint | null;
  cumulativeIncreaseCents: bigint;
  cumulativeDecreaseCents: bigint;
}

export function evaluateContractChangeApproval(input: ContractChangeApprovalInput) {
  if (input.changeType === "original") {
    return { enhanced: false, reasons: [] as string[] };
  }
  const amountChanged = (input.changeAmountCents ?? 0n) > 0n;
  const unlimitedTriggered = input.amountLimitType === "unlimited" && amountChanged;
  const base = input.originalBaseAmountCents ?? 0n;
  const thresholdTriggered =
    base > 0n &&
    (input.cumulativeIncreaseCents * 10n > base ||
      input.cumulativeDecreaseCents * 10n > base);
  return {
    enhanced: unlimitedTriggered || thresholdTriggered,
    reasons: [
      ...(unlimitedTriggered ? ["unlimited_amount_change"] : []),
      ...(thresholdTriggered ? ["cumulative_change_strictly_over_ten_percent"] : [])
    ]
  };
}
