export interface ContractIncreaseLimitInput {
  originalAmountCents: bigint | null;
  historicalPositiveIncreaseCents: bigint;
  proposedChangeCents: bigint;
  unlimitedFramework?: boolean;
}

export interface ContractIncreaseLimitResult {
  allowed: boolean;
  skipped: boolean;
  positiveIncreaseAfterChangeCents: bigint;
  reason: string | null;
}

export function evaluateContractIncreaseLimit(
  input: ContractIncreaseLimitInput
): ContractIncreaseLimitResult {
  const proposedPositive = input.proposedChangeCents > 0n
    ? input.proposedChangeCents
    : 0n;
  const positiveIncreaseAfterChangeCents =
    input.historicalPositiveIncreaseCents + proposedPositive;

  if (input.unlimitedFramework) {
    return {
      allowed: true,
      skipped: true,
      positiveIncreaseAfterChangeCents,
      reason: null
    };
  }
  if (input.originalAmountCents === null) {
    return {
      allowed: false,
      skipped: false,
      positiveIncreaseAfterChangeCents,
      reason: "历史合同尚未确认历史变更基线，请先由合同部主管补录后再发起合同变更"
    };
  }
  if (input.originalAmountCents <= 0n || input.historicalPositiveIncreaseCents < 0n) {
    return {
      allowed: false,
      skipped: false,
      positiveIncreaseAfterChangeCents,
      reason: "原合同金额或历史累计增项事实异常，暂不能发起合同变更"
    };
  }
  const allowed = positiveIncreaseAfterChangeCents * 10n <= input.originalAmountCents;
  return {
    allowed,
    skipped: false,
    positiveIncreaseAfterChangeCents,
    reason: allowed ? null : "累计增项已超过原合同 10%，必须新签合同"
  };
}
