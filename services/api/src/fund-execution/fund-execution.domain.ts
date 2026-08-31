export const EXECUTION_ALLOCATION_AXES = [
  "payable",
  "project_fund",
  "relationship",
  "operating"
] as const;

export type ExecutionAllocationAxis = (typeof EXECUTION_ALLOCATION_AXES)[number];
export type ExecutionAllocationAxisStatus = "applied" | "not_applicable";

export type ExecutionAllocationAxisConsequence = Readonly<{
  id: string;
  sequence: number;
  consequenceType: string;
  consequenceIdentity: string;
  sliceIdentity: string | null;
  amountCents: bigint;
  consequenceFingerprint: string;
}>;

export type ExecutionAllocationAxisEffect = Readonly<{
  id: string;
  axis: ExecutionAllocationAxis;
  status: ExecutionAllocationAxisStatus;
  amountCents: bigint;
  consequences: readonly ExecutionAllocationAxisConsequence[];
}>;

export type ReverseExecutionAxisEffectPlan = Readonly<{
  originalAxisEffectId: string;
  axis: ExecutionAllocationAxis;
  status: ExecutionAllocationAxisStatus;
  amountCents: bigint;
  consequences: readonly Readonly<{
    originalConsequenceId: string;
    sequence: number;
    consequenceType: string;
    consequenceIdentity: string;
    sliceIdentity: string | null;
    amountCents: bigint;
  }>[];
}>;

export type FundExecutionApprovalDelegation = Readonly<{
  fromUserId: string;
  toUserId: string;
}>;

export type FundExecutionConfirmationSeparationInput = Readonly<{
  confirmerUserId: string;
  handledByUserId: string;
  paymentExecutedByUserId: string;
  finalApprovalActorUserId: string;
  finalApprovalRepresentedUserId: string | null;
  delegations: readonly FundExecutionApprovalDelegation[];
}>;

export function assertFundExecutionConfirmationSeparation(
  input: FundExecutionConfirmationSeparationInput
) {
  const confirmerIdentities = delegationIdentityClosure(
    [input.confirmerUserId],
    input.delegations
  );
  const prohibitedIdentities = delegationIdentityClosure(
    [
      input.handledByUserId,
      input.paymentExecutedByUserId,
      input.finalApprovalActorUserId,
      input.finalApprovalRepresentedUserId
    ].filter((userId): userId is string => Boolean(userId)),
    input.delegations
  );
  if ([...confirmerIdentities].some((userId) => prohibitedIdentities.has(userId))) {
    throw new Error(
      "资金执行确认人必须与经办、付款执行和最终审批自然人分离"
    );
  }
}

function delegationIdentityClosure(
  seedUserIds: readonly string[],
  delegations: readonly FundExecutionApprovalDelegation[]
) {
  const identities = new Set(seedUserIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const delegation of delegations) {
      if (
        identities.has(delegation.fromUserId) &&
        !identities.has(delegation.toUserId)
      ) {
        identities.add(delegation.toUserId);
        changed = true;
      }
      if (
        identities.has(delegation.toUserId) &&
        !identities.has(delegation.fromUserId)
      ) {
        identities.add(delegation.fromUserId);
        changed = true;
      }
    }
  }
  return identities;
}

export function planReverseExecutionAxisEffects(
  originalEffects: readonly ExecutionAllocationAxisEffect[],
  reverseAmountCents: bigint
): readonly ReverseExecutionAxisEffectPlan[] {
  if (reverseAmountCents <= 0n) {
    throw new Error("反向执行金额必须大于零");
  }
  const axes = originalEffects.map(({ axis }) => axis);
  if (
    originalEffects.length !== EXECUTION_ALLOCATION_AXES.length ||
    new Set(axes).size !== EXECUTION_ALLOCATION_AXES.length ||
    EXECUTION_ALLOCATION_AXES.some((axis) => !axes.includes(axis))
  ) {
    throw new Error("反向执行必须完整复制原分配的四个效果轴");
  }

  return originalEffects.map((effect) => {
    if (effect.status === "not_applicable") {
      if (effect.amountCents !== 0n || effect.consequences.length !== 0) {
        throw new Error("原不适用轴不得携带金额或正式后果");
      }
      return {
        originalAxisEffectId: effect.id,
        axis: effect.axis,
        status: effect.status,
        amountCents: 0n,
        consequences: []
      };
    }
    if (
      effect.amountCents !== reverseAmountCents ||
      effect.consequences.length === 0
    ) {
      throw new Error("当前反向计划必须完整复制原轴金额及正式后果");
    }
    const consequenceAmountCents = effect.consequences.reduce(
      (total, consequence, index) => {
        if (
          consequence.sequence !== index + 1 ||
          !consequence.id.trim() ||
          !consequence.consequenceType.trim() ||
          !consequence.consequenceIdentity.trim() ||
          !consequence.consequenceFingerprint.trim() ||
          consequence.amountCents <= 0n
        ) {
          throw new Error("原效果轴缺少完整有序的 canonical 后果");
        }
        return total + consequence.amountCents;
      },
      0n
    );
    if (consequenceAmountCents !== effect.amountCents) {
      throw new Error("原效果轴后果金额与轴金额不一致");
    }
    return {
      originalAxisEffectId: effect.id,
      axis: effect.axis,
      status: effect.status,
      amountCents: reverseAmountCents,
      consequences: effect.consequences.map((consequence) => ({
        originalConsequenceId: consequence.id,
        sequence: consequence.sequence,
        consequenceType: consequence.consequenceType,
        consequenceIdentity: consequence.consequenceIdentity,
        sliceIdentity: consequence.sliceIdentity,
        amountCents: consequence.amountCents
      }))
    };
  });
}
