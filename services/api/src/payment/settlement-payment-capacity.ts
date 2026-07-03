import { centsToSafeNumber } from "../money/decimal-money";

export const SETTLEMENT_CAPACITY_PAYMENT_STATUSES = [
  "approval_pending",
  "in_approval",
  "approved_pending_payment",
  "partially_paid"
] as const;

export const CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES = [
  "effective",
  "partially_paid",
  "paid"
] as const;

export interface SettlementCapacityPaymentRequest {
  status: string;
  requestedAmountCents: number;
  approvedAmountCents?: number | null;
  paidAmountCents: number;
}

export interface SettlementPaymentCapacity {
  outstandingPaymentCents: number;
  occupiedCents: number;
  remainingCents: number;
}

export interface ContractDueSettlement {
  id: string;
  status: string;
  amountCents: number;
  paidAmountCents?: number;
  contractVersionId?: string;
  paymentTermsVersionId: string;
  isFinal?: boolean;
}

export interface ContractDuePaymentTermsStage {
  paymentTermsVersionId: string;
  stageType?: string;
  basis: string;
  ratioBps: number | null;
  fixedAmountCents: number | null;
  triggerAnchor?: string;
  dueDays: number;
  advanceDeductionMode?: string | null;
  advanceDeductionRatioBps?: number | null;
  advanceDeductionStartRatioBps?: number | null;
}

export interface ContractDueSettlementArchiveFile {
  settlementId: string;
  confirmedAt: Date | null;
}

export interface ContractDuePaymentRequest extends SettlementCapacityPaymentRequest {
  settlementId: string | null;
}

export interface ContractAdvancePaymentRequest extends SettlementCapacityPaymentRequest {
  paymentTermsVersionId?: string;
}

export interface ContractDuePaymentCapacity {
  duePayableCents: number;
  occupiedCents: number;
  remainingCents: number;
  advanceDeductionCents?: number;
}

export function calculateSettlementPaymentCapacity(input: {
  payableAmountCents: number;
  actualPaidAmountCents: number;
  proxyPaidAmountCents: number;
  paymentRequests: readonly SettlementCapacityPaymentRequest[];
}): SettlementPaymentCapacity {
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(outstandingPaymentRequestCents(payment)),
    0n
  );
  const occupiedCents =
    BigInt(input.actualPaidAmountCents) +
    BigInt(input.proxyPaidAmountCents) +
    outstandingPaymentCents;
  const remainingCents = BigInt(input.payableAmountCents) - occupiedCents;

  return {
    outstandingPaymentCents: centsToSafeNumber(outstandingPaymentCents),
    occupiedCents: centsToSafeNumber(occupiedCents),
    remainingCents: centsToSafeNumber(remainingCents)
  };
}

export function calculateContractDuePaymentCapacity(input: {
  asOf: Date;
  settlements: readonly ContractDueSettlement[];
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: number;
  contractAmountCents?: number;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
}): ContractDuePaymentCapacity {
  const confirmedAtBySettlement = new Map<string, Date>();
  for (const archiveFile of input.settlementArchiveFiles) {
    if (!archiveFile.confirmedAt) continue;

    const existing = confirmedAtBySettlement.get(archiveFile.settlementId);
    if (!existing || archiveFile.confirmedAt < existing) {
      confirmedAtBySettlement.set(archiveFile.settlementId, archiveFile.confirmedAt);
    }
  }

  const currentSettlementStagesByTerms = new Map<string, ContractDuePaymentTermsStage[]>();
  for (const stage of input.paymentTermsStages) {
    if (stage.basis !== "current_settlement") continue;

    const stages = currentSettlementStagesByTerms.get(stage.paymentTermsVersionId) ?? [];
    currentSettlementStagesByTerms.set(stage.paymentTermsVersionId, [...stages, stage]);
  }

  const dueSettlementBasisCentsByTerms = new Map<string, bigint>();
  const cumulativeConfirmedSettlementCentsByTerms = new Map<string, bigint>();
  const duePayableCents = input.settlements.reduce<bigint>((total, settlement) => {
    if (
      !CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES.includes(
        settlement.status as (typeof CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES)[number]
      )
    ) {
      return total;
    }

    const confirmedAt = confirmedAtBySettlement.get(settlement.id);
    if (!confirmedAt) return total;
    addMapBigInt(
      cumulativeConfirmedSettlementCentsByTerms,
      settlement.paymentTermsVersionId,
      BigInt(settlement.amountCents)
    );

    const stages = currentSettlementStagesByTerms.get(settlement.paymentTermsVersionId) ?? [];
    let hasDueStage = false;
    const settlementDueCents = stages.reduce<bigint>((stageTotal, stage) => {
      if (!isStageApplicableToSettlement(stage, settlement)) return stageTotal;
      if (!isStageDue(confirmedAt, stage.dueDays, input.asOf)) return stageTotal;
      hasDueStage = true;
      return stageTotal + contractStageAmountCents(settlement.amountCents, stage);
    }, 0n);

    if (hasDueStage) {
      addMapBigInt(
        dueSettlementBasisCentsByTerms,
        settlement.paymentTermsVersionId,
        BigInt(settlement.amountCents)
      );
    }

    return total + minBigInt(settlementDueCents, BigInt(settlement.amountCents));
  }, 0n);

  const actualPaidAmountCents = input.settlements.reduce<bigint>(
    (total, settlement) => total + BigInt(settlement.paidAmountCents ?? 0),
    0n
  );
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(outstandingPaymentRequestCents(payment)),
    0n
  );
  const advanceDeductionCents = calculateAdvanceDeductionCents({
    paidAdvanceCentsByTerms: paidAdvanceCentsByTerms(input.advancePaymentRequests ?? []),
    contractAmountCents: BigInt(input.contractAmountCents ?? 0),
    contractAmountCentsByTerms: contractAmountCentsByTerms(
      input.contractAmountCentsByPaymentTermsVersionId
    ),
    dueSettlementBasisCentsByTerms,
    cumulativeConfirmedSettlementCentsByTerms,
    paymentTermsStages: input.paymentTermsStages
  });
  const occupiedCents =
    actualPaidAmountCents +
    BigInt(input.proxyPaidAmountCents ?? 0) +
    outstandingPaymentCents;
  const remainingCents = duePayableCents - occupiedCents - advanceDeductionCents;

  return {
    duePayableCents: centsToSafeNumber(duePayableCents),
    occupiedCents: centsToSafeNumber(occupiedCents),
    remainingCents: centsToSafeNumber(remainingCents),
    ...(input.advancePaymentRequests
      ? { advanceDeductionCents: centsToSafeNumber(advanceDeductionCents) }
      : {})
  };
}

export function calculateContractAdvancePaymentCapacity(input: {
  asOf: Date;
  contractAmountCents: number;
  contractEffectiveAt: Date | null;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  paymentRequests: readonly ContractAdvancePaymentRequest[];
}): ContractDuePaymentCapacity {
  const contractEffectiveAt = input.contractEffectiveAt;
  const duePayableCents = contractEffectiveAt
    ? input.paymentTermsStages.reduce<bigint>((total, stage) => {
        if (!isContractAdvanceStage(stage)) return total;
        if (!isStageDue(contractEffectiveAt, stage.dueDays, input.asOf)) return total;
        return total + contractStageAmountCents(input.contractAmountCents, stage);
      }, 0n)
    : 0n;
  const cappedDuePayableCents = minBigInt(
    duePayableCents,
    BigInt(Math.max(input.contractAmountCents, 0))
  );
  const actualPaidAmountCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(payment.paidAmountCents ?? 0),
    0n
  );
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(outstandingPaymentRequestCents(payment)),
    0n
  );
  const occupiedCents = actualPaidAmountCents + outstandingPaymentCents;
  const remainingCents = cappedDuePayableCents - occupiedCents;

  return {
    duePayableCents: centsToSafeNumber(cappedDuePayableCents),
    occupiedCents: centsToSafeNumber(occupiedCents),
    remainingCents: centsToSafeNumber(remainingCents)
  };
}

export function sumSafeCents(values: Array<bigint | number>): number {
  return centsToSafeNumber(
    values.reduce<bigint>((total, value) => total + BigInt(value), 0n)
  );
}

function isStageApplicableToSettlement(
  stage: ContractDuePaymentTermsStage,
  settlement: ContractDueSettlement
): boolean {
  const anchor = stage.triggerAnchor ?? "settlement_effective";
  if (anchor === "settlement_effective") {
    return true;
  }

  if (anchor === "final_settlement_effective") {
    return settlement.isFinal === true;
  }

  return false;
}

function isContractAdvanceStage(stage: ContractDuePaymentTermsStage): boolean {
  return (
    stage.stageType === "advance" &&
    stage.basis === "contract_amount" &&
    stage.triggerAnchor === "contract_effective"
  );
}

function calculateAdvanceDeductionCents(input: {
  paidAdvanceCentsByTerms: ReadonlyMap<string, bigint>;
  contractAmountCents: bigint;
  contractAmountCentsByTerms: ReadonlyMap<string, bigint>;
  dueSettlementBasisCentsByTerms: ReadonlyMap<string, bigint>;
  cumulativeConfirmedSettlementCentsByTerms: ReadonlyMap<string, bigint>;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
}): bigint {
  const scheduledDeductionCentsByTerms = input.paymentTermsStages.reduce<Map<string, bigint>>((totals, stage) => {
    if (!isContractAdvanceStage(stage)) return totals;
    const mode = stage.advanceDeductionMode ?? "none";
    if (mode === "none") return totals;
    if (mode !== "per_settlement_ratio" && mode !== "after_cumulative_settlement_ratio") {
      throw new Error(`Unsupported advance deduction mode: ${mode}`);
    }

    if (stage.advanceDeductionRatioBps === null || stage.advanceDeductionRatioBps === undefined) {
      throw new Error("Advance deduction ratio is required for active deduction mode");
    }
    const ratioBps = stage.advanceDeductionRatioBps;
    if (ratioBps <= 0) {
      throw new Error("Advance deduction ratio must be greater than zero");
    }

    const paidAdvanceCents = input.paidAdvanceCentsByTerms.get(stage.paymentTermsVersionId) ?? 0n;
    const dueSettlementBasisCents =
      input.dueSettlementBasisCentsByTerms.get(stage.paymentTermsVersionId) ?? 0n;
    if (paidAdvanceCents <= 0n || dueSettlementBasisCents <= 0n) {
      return totals;
    }

    if (mode === "after_cumulative_settlement_ratio") {
      if (
        stage.advanceDeductionStartRatioBps === null ||
        stage.advanceDeductionStartRatioBps === undefined
      ) {
        throw new Error("Advance deduction start ratio is required for conditional deduction mode");
      }
      const startRatioBps = stage.advanceDeductionStartRatioBps;
      const startAmountCents =
        (contractAmountCentsForTerms(input, stage.paymentTermsVersionId) *
          BigInt(Math.max(startRatioBps, 0))) /
        10000n;
      const cumulativeConfirmedSettlementCents =
        input.cumulativeConfirmedSettlementCentsByTerms.get(stage.paymentTermsVersionId) ?? 0n;
      if (cumulativeConfirmedSettlementCents < startAmountCents) {
        return totals;
      }
    }

    const scheduledCents = (dueSettlementBasisCents * BigInt(Math.max(ratioBps, 0))) / 10000n;
    addMapBigInt(totals, stage.paymentTermsVersionId, scheduledCents);
    return totals;
  }, new Map<string, bigint>());

  return [...scheduledDeductionCentsByTerms.entries()].reduce<bigint>(
    (total, [paymentTermsVersionId, scheduledCents]) =>
      total +
      minBigInt(
        scheduledCents,
        input.paidAdvanceCentsByTerms.get(paymentTermsVersionId) ?? 0n
      ),
    0n
  );
}

function paidAdvanceCentsByTerms(
  paymentRequests: readonly ContractAdvancePaymentRequest[]
): ReadonlyMap<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const payment of paymentRequests) {
    if (!payment.paymentTermsVersionId) {
      continue;
    }

    addMapBigInt(
      totals,
      payment.paymentTermsVersionId,
      BigInt(Math.max(payment.paidAmountCents ?? 0, 0))
    );
  }

  return totals;
}

function contractAmountCentsByTerms(
  values: Readonly<Record<string, number>> | undefined
): ReadonlyMap<string, bigint> {
  const totals = new Map<string, bigint>();
  if (!values) {
    return totals;
  }

  for (const [termsId, amountCents] of Object.entries(values)) {
    totals.set(termsId, BigInt(Math.max(amountCents, 0)));
  }

  return totals;
}

function contractAmountCentsForTerms(
  input: {
    contractAmountCents: bigint;
    contractAmountCentsByTerms: ReadonlyMap<string, bigint>;
  },
  paymentTermsVersionId: string
): bigint {
  return input.contractAmountCentsByTerms.get(paymentTermsVersionId) ?? input.contractAmountCents;
}

function addMapBigInt(map: Map<string, bigint>, key: string, amount: bigint): void {
  map.set(key, (map.get(key) ?? 0n) + amount);
}

function isStageDue(confirmedAt: Date, dueDays: number, asOf: Date): boolean {
  const nonNegativeDueDays = Math.max(dueDays, 0);
  const dueAt = new Date(confirmedAt.getTime() + nonNegativeDueDays * 24 * 60 * 60 * 1000);
  return dueAt <= asOf;
}

function contractStageAmountCents(
  settlementAmountCents: number,
  stage: ContractDuePaymentTermsStage
): bigint {
  if (stage.fixedAmountCents !== null) {
    return BigInt(Math.max(stage.fixedAmountCents, 0));
  }

  if (stage.ratioBps === null) {
    return 0n;
  }

  return (BigInt(settlementAmountCents) * BigInt(Math.max(stage.ratioBps, 0))) / 10000n;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function outstandingPaymentRequestCents(payment: SettlementCapacityPaymentRequest): number {
  if (["approval_pending", "in_approval"].includes(payment.status)) {
    return Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0);
  }

  if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
    return Math.max(
      (payment.approvedAmountCents ?? payment.requestedAmountCents) - payment.paidAmountCents,
      0
    );
  }

  return 0;
}
