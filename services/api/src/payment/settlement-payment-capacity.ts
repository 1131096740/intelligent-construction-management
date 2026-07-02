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
}

export interface ContractDueSettlementArchiveFile {
  settlementId: string;
  confirmedAt: Date | null;
}

export interface ContractDuePaymentRequest extends SettlementCapacityPaymentRequest {
  settlementId: string;
}

export interface ContractDuePaymentCapacity {
  duePayableCents: number;
  occupiedCents: number;
  remainingCents: number;
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

    const stages = currentSettlementStagesByTerms.get(settlement.paymentTermsVersionId) ?? [];
    const settlementDueCents = stages.reduce<bigint>((stageTotal, stage) => {
      if (!isStageApplicableToSettlement(stage, settlement)) return stageTotal;
      if (!isStageDue(confirmedAt, stage.dueDays, input.asOf)) return stageTotal;
      return stageTotal + contractStageAmountCents(settlement.amountCents, stage);
    }, 0n);

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
  const occupiedCents =
    actualPaidAmountCents +
    BigInt(input.proxyPaidAmountCents ?? 0) +
    outstandingPaymentCents;
  const remainingCents = duePayableCents - occupiedCents;

  return {
    duePayableCents: centsToSafeNumber(duePayableCents),
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
