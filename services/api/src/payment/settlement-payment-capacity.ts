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
  sourceType?: string | null;
}

export interface ContractAdvancePaymentRequest extends SettlementCapacityPaymentRequest {
  paymentTermsVersionId?: string;
}

export interface HistoricalContractPaymentBalance {
  paymentTermsVersionId?: string;
  balanceConfirmedAt?: Date | null;
  settledCents?: number | bigint;
  approvalPendingPaymentCents?: number | bigint;
  approvedPendingPaymentCents?: number | bigint;
  paidCents?: number | bigint;
  proxyPaidCents?: number | bigint;
  advancePaidCents?: number | bigint;
  advanceDeductedCents?: number | bigint;
  otherConfirmedOccupancyCents?: number | bigint;
}

export interface ContractDuePaymentCapacity {
  duePayableCents: number;
  occupiedCents: number;
  remainingCents: number;
  advanceDeductionCents?: number;
}

export type ContractPaymentApplicationSectionType =
  | "advance"
  | "progress"
  | "final"
  | "retention";

export interface ContractPaymentApplicationRow {
  id: string;
  settlementId: string | null;
  contractVersionId?: string;
  paymentTermsVersionId: string;
  stageId?: string;
  stageName?: string;
  triggerAnchor?: string;
  dueDays?: number;
  ratioBps?: number | null;
  fixedAmountCents?: number | null;
  source: string;
  currentSettlementAmountCents: number;
  cumulativeBeforeAmountCents: number;
  cumulativeAfterAmountCents: number;
  effectiveAt: Date | null;
  expectedPayableAt: Date | null;
  paymentRule: string;
  isDue: boolean;
  includableAmountCents: number;
}

export interface ContractPaymentApplicationSection {
  type: ContractPaymentApplicationSectionType;
  title: string;
  rows: ContractPaymentApplicationRow[];
}

export interface ContractPaymentApplicationPreview {
  capacity: {
    cumulativeEffectiveSettlementCents: number;
    systemCumulativeEffectiveSettlementCents?: number;
    historicalSettledCents?: number;
    duePayableCents: number;
    occupiedCents: number;
    historicalOccupiedCents?: number;
    advanceDeductionCents: number;
    maxRequestableCents: number;
  };
  advanceDeduction: {
    paidAdvanceCents: number;
    systemPaidAdvanceCents?: number;
    historicalAdvancePaidCents?: number;
    historicalAdvanceDeductedCents?: number;
    currentDeductionCents: number;
    remainingAdvanceToDeductCents: number;
  };
  historicalBalance?: {
    settledCents: number;
    approvalPendingPaymentCents: number;
    approvedPendingPaymentCents: number;
    paidCents: number;
    proxyPaidCents: number;
    advancePaidCents: number;
    advanceDeductedCents: number;
    otherConfirmedOccupancyCents: number;
  };
  sections: ContractPaymentApplicationSection[];
}

export interface ContractDuePaymentExecutionAllocation {
  sourceRowId: string;
  settlementId: string;
  contractVersionId: string | null;
  paymentTermsVersionId: string;
  stageType: Exclude<ContractPaymentApplicationSectionType, "advance">;
  stageId: string | null;
  stageName: string | null;
  triggerAnchor: string | null;
  dueDays: number | null;
  ratioBps: number | null;
  fixedAmountCents: number | null;
  sourceEffectiveAt: Date | null;
  expectedPayableAt: Date | null;
  sourcePayableAmountCents: number;
  amountCents: number;
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
  contractAmountCents?: number | bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number | bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacity {
  const historicalBalance = normalizeHistoricalBalance(input.historicalBalance);
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
  const actualPaidAmountCents =
    input.settlements.reduce<bigint>(
      (total, settlement) => total + BigInt(settlement.paidAmountCents ?? 0),
      0n
    ) +
    input.paymentRequests.reduce<bigint>(
      (total, payment) =>
        payment.settlementId === null ? total + BigInt(payment.paidAmountCents ?? 0) : total,
      0n
    );
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(outstandingPaymentRequestCents(payment)),
    0n
  );
  const paidAdvanceCentsForCapacity = paidAdvanceCentsByTerms(input.advancePaymentRequests ?? []);
  const paidAdvanceCentsForCapacityWithHistory = withHistoricalAdvancePaid(
    paidAdvanceCentsForCapacity,
    historicalBalance
  );
  const advanceDeductionCents = calculateAdvanceDeductionCents({
    paidAdvanceCentsByTerms: paidAdvanceCentsForCapacityWithHistory,
    historicalAdvanceDeductedCentsByTerms: historicalAdvanceDeductedCentsByTerms(historicalBalance),
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
    outstandingPaymentCents +
    historicalOccupiedCents(historicalBalance);
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

export function buildContractPaymentApplicationPreview(input: {
  asOf: Date;
  contractEffectiveAt?: Date | null;
  settlements: readonly (ContractDueSettlement & {
    code?: string;
    periodLabel?: string;
  })[];
  paymentTermsStages: readonly (ContractDuePaymentTermsStage & {
    id?: string;
    name?: string;
  })[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: number;
  contractAmountCents?: number | bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number | bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractPaymentApplicationPreview {
  const historicalBalance = normalizeHistoricalBalance(input.historicalBalance);
  const confirmedAtBySettlement = earliestConfirmedAtBySettlement(input.settlementArchiveFiles);
  const effectiveSettlements = input.settlements.filter((settlement) =>
    CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES.includes(
      settlement.status as (typeof CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES)[number]
    )
  );
  const hasFinalEffectiveSettlement = effectiveSettlements.some((settlement) => settlement.isFinal === true);
  const sectionsByType = new Map<
    ContractPaymentApplicationSectionType,
    ContractPaymentApplicationSection
  >();
  const stageIndexesByKey = new Map<string, number>();
  let cumulativeEffectiveSettlementCents = 0n;
  const dueSettlementBasisCentsByTerms = new Map<string, bigint>();
  const cumulativeConfirmedSettlementCentsByTerms = new Map<string, bigint>();

  for (const settlement of effectiveSettlements) {
    const before = cumulativeEffectiveSettlementCents;
    const settlementAmountCents = BigInt(settlement.amountCents);
    cumulativeEffectiveSettlementCents += settlementAmountCents;

    const confirmedAt = confirmedAtBySettlement.get(settlement.id) ?? null;
    if (confirmedAt) {
      addMapBigInt(
        cumulativeConfirmedSettlementCentsByTerms,
        settlement.paymentTermsVersionId,
        settlementAmountCents
      );
    }

    const currentSettlementStages = input.paymentTermsStages.filter(
      (stage) =>
        stage.paymentTermsVersionId === settlement.paymentTermsVersionId &&
        stage.basis === "current_settlement"
    );
    const hasDueStage = currentSettlementStages.some(
      (stage) =>
        confirmedAt &&
        isStageApplicableToSettlement(stage, settlement) &&
        isStageDue(confirmedAt, stage.dueDays, input.asOf)
    );
    if (hasDueStage) {
      addMapBigInt(
        dueSettlementBasisCentsByTerms,
        settlement.paymentTermsVersionId,
        settlementAmountCents
      );
    }

    for (const stage of currentSettlementStages) {
      const sectionType = paymentApplicationSectionType(stage);
      if (!sectionType) continue;
      if ((sectionType === "final" || sectionType === "retention") && !hasFinalEffectiveSettlement) {
        continue;
      }
      if (!isStageApplicableToSettlement(stage, settlement)) {
        continue;
      }

      const isDue = !!confirmedAt && isStageDue(confirmedAt, stage.dueDays, input.asOf);
      const expectedPayableAt = confirmedAt ? addDays(confirmedAt, stage.dueDays) : null;
      const includableAmountCents = isDue
        ? centsToSafeNumber(
            minBigInt(contractStageAmountCents(settlement.amountCents, stage), settlementAmountCents)
          )
        : 0;
      const stageIndex = stageIndexFor(stageIndexesByKey, settlement.paymentTermsVersionId, stage);
      const section = getPaymentApplicationSection(sectionsByType, sectionType);
      section.rows.push({
        id: `${settlement.id}:${sectionType}:${stageIndex}`,
        settlementId: settlement.id,
        contractVersionId: settlement.contractVersionId,
        paymentTermsVersionId: settlement.paymentTermsVersionId,
        stageId: stage.id,
        stageName: stage.name,
        triggerAnchor: stage.triggerAnchor,
        dueDays: stage.dueDays,
        ratioBps: stage.ratioBps,
        fixedAmountCents: stage.fixedAmountCents,
        source: settlement.code ?? settlement.id,
        currentSettlementAmountCents: settlement.amountCents,
        cumulativeBeforeAmountCents: centsToSafeNumber(before),
        cumulativeAfterAmountCents: centsToSafeNumber(cumulativeEffectiveSettlementCents),
        effectiveAt: confirmedAt,
        expectedPayableAt,
        paymentRule: paymentRuleLabel(stage),
        isDue,
        includableAmountCents
      });
    }
  }

  for (const stage of input.paymentTermsStages) {
    if (!isContractAdvanceStage(stage)) continue;

    const section = getPaymentApplicationSection(sectionsByType, "advance");
    const effectiveAt = input.contractEffectiveAt ?? null;
    const expectedPayableAt = effectiveAt ? addDays(effectiveAt, stage.dueDays) : null;
    const isDue = !!effectiveAt && isStageDue(effectiveAt, stage.dueDays, input.asOf);
    const contractAmountCents = centsToSafeNumber(
      contractAmountCentsForTerms(
        {
          contractAmountCents: BigInt(input.contractAmountCents ?? 0),
          contractAmountCentsByTerms: contractAmountCentsByTerms(
            input.contractAmountCentsByPaymentTermsVersionId
          )
        },
        stage.paymentTermsVersionId
      )
    );
    const stageIndex = stageIndexFor(stageIndexesByKey, stage.paymentTermsVersionId, stage);
    section.rows.push({
      id: `contract:${stage.paymentTermsVersionId}:advance:${stageIndex}`,
      settlementId: null,
      contractVersionId: undefined,
      paymentTermsVersionId: stage.paymentTermsVersionId,
      stageId: stage.id,
      stageName: stage.name,
      triggerAnchor: stage.triggerAnchor,
      dueDays: stage.dueDays,
      ratioBps: stage.ratioBps,
      fixedAmountCents: stage.fixedAmountCents,
      source: "合同生效",
      currentSettlementAmountCents: 0,
      cumulativeBeforeAmountCents: centsToSafeNumber(cumulativeEffectiveSettlementCents),
      cumulativeAfterAmountCents: centsToSafeNumber(cumulativeEffectiveSettlementCents),
      effectiveAt,
      expectedPayableAt,
      paymentRule: paymentRuleLabel(stage),
      isDue,
      includableAmountCents: isDue
        ? centsToSafeNumber(contractStageAmountCents(contractAmountCents, stage))
        : 0
    });
  }

  const capacity = calculateContractDuePaymentCapacity({
    ...input,
    advancePaymentRequests: input.advancePaymentRequests ?? []
  });
  const systemPaidAdvanceCents = centsToSafeNumber(
    [...paidAdvanceCentsByTerms(input.advancePaymentRequests ?? []).values()].reduce(
      (total, amount) => total + amount,
      0n
    )
  );
  const paidAdvanceCents = centsToSafeNumber(
    BigInt(systemPaidAdvanceCents) + historicalBalance.advancePaidCents
  );
  const currentDeductionCents = capacity.advanceDeductionCents ?? 0;
  const hasHistorical = hasHistoricalBalance(historicalBalance);
  const systemCumulativeEffectiveSettlementCents = centsToSafeNumber(
    cumulativeEffectiveSettlementCents
  );
  const totalCumulativeEffectiveSettlementCents = centsToSafeNumber(
    cumulativeEffectiveSettlementCents + historicalBalance.settledCents
  );
  const historicalSettledCents = centsToSafeNumber(historicalBalance.settledCents);
  const historicalOccupiedAmountCents = centsToSafeNumber(historicalOccupiedCents(historicalBalance));
  const historicalAdvanceDeductedCents = centsToSafeNumber(
    historicalBalance.advanceDeductedCents
  );
  const remainingAdvanceToDeductCents = Math.max(
    paidAdvanceCents - historicalAdvanceDeductedCents - currentDeductionCents,
    0
  );

  return {
    capacity: {
      cumulativeEffectiveSettlementCents: totalCumulativeEffectiveSettlementCents,
      ...(hasHistorical
        ? {
            systemCumulativeEffectiveSettlementCents,
            historicalSettledCents,
            historicalOccupiedCents: historicalOccupiedAmountCents
          }
        : {}),
      duePayableCents: capacity.duePayableCents,
      occupiedCents: capacity.occupiedCents,
      advanceDeductionCents: currentDeductionCents,
      maxRequestableCents: Math.max(capacity.remainingCents, 0)
    },
    advanceDeduction: {
      paidAdvanceCents,
      ...(hasHistorical
        ? {
            systemPaidAdvanceCents,
            historicalAdvancePaidCents: centsToSafeNumber(historicalBalance.advancePaidCents),
            historicalAdvanceDeductedCents
          }
        : {}),
      currentDeductionCents,
      remainingAdvanceToDeductCents
    },
    ...(hasHistorical
      ? {
          historicalBalance: historicalBalanceReadModel(historicalBalance)
        }
      : {}),
    sections: paymentApplicationSectionOrder
      .map((type) => sectionsByType.get(type))
      .filter((section): section is ContractPaymentApplicationSection => !!section && section.rows.length > 0)
  };
}

export function allocateContractDuePaymentExecution(input: {
  amountCents: number;
  sections: readonly ContractPaymentApplicationSection[];
  existingAllocations?: readonly {
    sourceRowId: string;
    amountCents: number;
  }[];
}): ContractDuePaymentExecutionAllocation[] {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Contract due payment execution amount must be greater than zero");
  }

  const allocatedCentsByRow = new Map<string, bigint>();
  for (const allocation of input.existingAllocations ?? []) {
    addMapBigInt(
      allocatedCentsByRow,
      allocation.sourceRowId,
      BigInt(Math.max(allocation.amountCents, 0))
    );
  }

  let remainingToAllocate = BigInt(input.amountCents);
  let totalAvailable = 0n;
  const allocations: ContractDuePaymentExecutionAllocation[] = [];

  for (const section of input.sections) {
    if (section.type === "advance") continue;

    for (const row of section.rows) {
      if (!row.isDue || !row.settlementId) continue;

      const rowAvailable =
        BigInt(Math.max(row.includableAmountCents, 0)) -
        (allocatedCentsByRow.get(row.id) ?? 0n);
      if (rowAvailable <= 0n) continue;

      totalAvailable += rowAvailable;
      if (remainingToAllocate <= 0n) continue;

      const amount = minBigInt(rowAvailable, remainingToAllocate);
      allocations.push({
        sourceRowId: row.id,
        settlementId: row.settlementId,
        contractVersionId: row.contractVersionId ?? null,
        paymentTermsVersionId: row.paymentTermsVersionId,
        stageType: section.type,
        stageId: row.stageId ?? null,
        stageName: row.stageName ?? null,
        triggerAnchor: row.triggerAnchor ?? null,
        dueDays: row.dueDays ?? null,
        ratioBps: row.ratioBps ?? null,
        fixedAmountCents: row.fixedAmountCents ?? null,
        sourceEffectiveAt: row.effectiveAt,
        expectedPayableAt: row.expectedPayableAt,
        sourcePayableAmountCents: row.includableAmountCents,
        amountCents: centsToSafeNumber(amount)
      });
      remainingToAllocate -= amount;
    }
  }

  if (remainingToAllocate > 0n) {
    throw new Error(
      `Contract due payment execution exceeds allocatable due rows: ${centsToSafeNumber(
        totalAvailable
      )}`
    );
  }

  return allocations;
}

export function calculateContractAdvancePaymentCapacity(input: {
  asOf: Date;
  contractAmountCents: number;
  contractEffectiveAt: Date | null;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  paymentRequests: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacity {
  const historicalBalance = normalizeHistoricalBalance(input.historicalBalance);
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
  const historicalAdvanceOccupancyCents =
    historicalBalance.advancePaidCents +
    historicalBalance.approvalPendingPaymentCents +
    historicalBalance.approvedPendingPaymentCents +
    historicalBalance.otherConfirmedOccupancyCents;
  const occupiedCents =
    actualPaidAmountCents + outstandingPaymentCents + historicalAdvanceOccupancyCents;
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

interface NormalizedHistoricalContractPaymentBalance {
  paymentTermsVersionId?: string;
  balanceConfirmedAt: Date | null;
  settledCents: bigint;
  approvalPendingPaymentCents: bigint;
  approvedPendingPaymentCents: bigint;
  paidCents: bigint;
  proxyPaidCents: bigint;
  advancePaidCents: bigint;
  advanceDeductedCents: bigint;
  otherConfirmedOccupancyCents: bigint;
}

function normalizeHistoricalBalance(
  value: HistoricalContractPaymentBalance | undefined
): NormalizedHistoricalContractPaymentBalance {
  const empty = {
    paymentTermsVersionId: undefined,
    balanceConfirmedAt: null,
    settledCents: 0n,
    approvalPendingPaymentCents: 0n,
    approvedPendingPaymentCents: 0n,
    paidCents: 0n,
    proxyPaidCents: 0n,
    advancePaidCents: 0n,
    advanceDeductedCents: 0n,
    otherConfirmedOccupancyCents: 0n
  };

  if (!value?.balanceConfirmedAt) {
    return empty;
  }

  return {
    paymentTermsVersionId: value.paymentTermsVersionId,
    balanceConfirmedAt: value.balanceConfirmedAt,
    settledCents: nonNegativeBigIntCents(value.settledCents ?? 0),
    approvalPendingPaymentCents: nonNegativeBigIntCents(
      value.approvalPendingPaymentCents ?? 0
    ),
    approvedPendingPaymentCents: nonNegativeBigIntCents(
      value.approvedPendingPaymentCents ?? 0
    ),
    paidCents: nonNegativeBigIntCents(value.paidCents ?? 0),
    proxyPaidCents: nonNegativeBigIntCents(value.proxyPaidCents ?? 0),
    advancePaidCents: nonNegativeBigIntCents(value.advancePaidCents ?? 0),
    advanceDeductedCents: nonNegativeBigIntCents(value.advanceDeductedCents ?? 0),
    otherConfirmedOccupancyCents: nonNegativeBigIntCents(
      value.otherConfirmedOccupancyCents ?? 0
    )
  };
}

function hasHistoricalBalance(balance: NormalizedHistoricalContractPaymentBalance): boolean {
  return (
    !!balance.balanceConfirmedAt &&
    [
      balance.settledCents,
      balance.approvalPendingPaymentCents,
      balance.approvedPendingPaymentCents,
      balance.paidCents,
      balance.proxyPaidCents,
      balance.advancePaidCents,
      balance.advanceDeductedCents,
      balance.otherConfirmedOccupancyCents
    ].some((amount) => amount > 0n)
  );
}

function historicalBalanceReadModel(balance: NormalizedHistoricalContractPaymentBalance) {
  return {
    settledCents: centsToSafeNumber(balance.settledCents),
    approvalPendingPaymentCents: centsToSafeNumber(balance.approvalPendingPaymentCents),
    approvedPendingPaymentCents: centsToSafeNumber(balance.approvedPendingPaymentCents),
    paidCents: centsToSafeNumber(balance.paidCents),
    proxyPaidCents: centsToSafeNumber(balance.proxyPaidCents),
    advancePaidCents: centsToSafeNumber(balance.advancePaidCents),
    advanceDeductedCents: centsToSafeNumber(balance.advanceDeductedCents),
    otherConfirmedOccupancyCents: centsToSafeNumber(balance.otherConfirmedOccupancyCents)
  };
}

function historicalOccupiedCents(balance: NormalizedHistoricalContractPaymentBalance): bigint {
  return (
    balance.paidCents +
    balance.approvalPendingPaymentCents +
    balance.approvedPendingPaymentCents +
    balance.proxyPaidCents +
    balance.otherConfirmedOccupancyCents
  );
}

function withHistoricalAdvancePaid(
  paidAdvanceCentsByTermsValue: ReadonlyMap<string, bigint>,
  balance: NormalizedHistoricalContractPaymentBalance
): ReadonlyMap<string, bigint> {
  const totals = new Map(paidAdvanceCentsByTermsValue);
  if (balance.paymentTermsVersionId && balance.advancePaidCents > 0n) {
    addMapBigInt(totals, balance.paymentTermsVersionId, balance.advancePaidCents);
  }

  return totals;
}

function historicalAdvanceDeductedCentsByTerms(
  balance: NormalizedHistoricalContractPaymentBalance
): ReadonlyMap<string, bigint> {
  const totals = new Map<string, bigint>();
  if (balance.paymentTermsVersionId && balance.advanceDeductedCents > 0n) {
    totals.set(balance.paymentTermsVersionId, balance.advanceDeductedCents);
  }

  return totals;
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
  historicalAdvanceDeductedCentsByTerms?: ReadonlyMap<string, bigint>;
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
    (total, [paymentTermsVersionId, scheduledCents]) => {
      const cappedScheduledCents = minBigInt(
        scheduledCents,
        input.paidAdvanceCentsByTerms.get(paymentTermsVersionId) ?? 0n
      );
      const alreadyDeductedCents =
        input.historicalAdvanceDeductedCentsByTerms?.get(paymentTermsVersionId) ?? 0n;
      const remainingDeductionCents = cappedScheduledCents - alreadyDeductedCents;
      return total + (remainingDeductionCents > 0n ? remainingDeductionCents : 0n);
    },
    0n
  );
}

const paymentApplicationSectionOrder = ["advance", "progress", "final", "retention"] as const;

function earliestConfirmedAtBySettlement(
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[]
): ReadonlyMap<string, Date> {
  const confirmedAtBySettlement = new Map<string, Date>();
  for (const archiveFile of settlementArchiveFiles) {
    if (!archiveFile.confirmedAt) continue;

    const existing = confirmedAtBySettlement.get(archiveFile.settlementId);
    if (!existing || archiveFile.confirmedAt < existing) {
      confirmedAtBySettlement.set(archiveFile.settlementId, archiveFile.confirmedAt);
    }
  }

  return confirmedAtBySettlement;
}

function paymentApplicationSectionType(
  stage: ContractDuePaymentTermsStage
): ContractPaymentApplicationSectionType | null {
  if (stage.stageType === "advance") return "advance";
  if (stage.stageType === "final") return "final";
  if (stage.stageType === "retention") return "retention";
  if (stage.stageType === "progress" || stage.stageType === undefined || stage.stageType === "other") {
    return "progress";
  }

  return null;
}

function getPaymentApplicationSection(
  sectionsByType: Map<ContractPaymentApplicationSectionType, ContractPaymentApplicationSection>,
  type: ContractPaymentApplicationSectionType
): ContractPaymentApplicationSection {
  const existing = sectionsByType.get(type);
  if (existing) return existing;

  const section = {
    type,
    title: paymentApplicationSectionTitle(type),
    rows: []
  };
  sectionsByType.set(type, section);
  return section;
}

function paymentApplicationSectionTitle(type: ContractPaymentApplicationSectionType): string {
  const titles: Record<ContractPaymentApplicationSectionType, string> = {
    advance: "预付款",
    progress: "进度款",
    final: "竣工款",
    retention: "质保金"
  };

  return titles[type];
}

function stageIndexFor(
  stageIndexesByKey: Map<string, number>,
  paymentTermsVersionId: string,
  stage: ContractDuePaymentTermsStage & { id?: string }
): number {
  const key = `${paymentTermsVersionId}:${stage.stageType ?? "progress"}:${stage.id ?? stage.basis}:${stage.dueDays}`;
  const existing = stageIndexesByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const index = [...stageIndexesByKey.keys()].filter((item) =>
    item.startsWith(`${paymentTermsVersionId}:${stage.stageType ?? "progress"}:`)
  ).length;
  stageIndexesByKey.set(key, index);
  return index;
}

function paymentRuleLabel(stage: ContractDuePaymentTermsStage): string {
  return `${stageAmountRuleLabel(stage)} · ${Math.max(stage.dueDays, 0)}天`;
}

function stageAmountRuleLabel(stage: ContractDuePaymentTermsStage): string {
  if (stage.fixedAmountCents !== null) {
    return `固定${stage.fixedAmountCents}分`;
  }

  if (stage.ratioBps === null) {
    return "未配置比例";
  }

  return `${stage.ratioBps / 100}%`;
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
  values: Readonly<Record<string, number | bigint>> | undefined
): ReadonlyMap<string, bigint> {
  const totals = new Map<string, bigint>();
  if (!values) {
    return totals;
  }

  for (const [termsId, amountCents] of Object.entries(values)) {
    totals.set(termsId, nonNegativeBigIntCents(amountCents));
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

function nonNegativeBigIntCents(value: bigint | number): bigint {
  const cents = BigInt(value);
  return cents > 0n ? cents : 0n;
}

function isStageDue(confirmedAt: Date, dueDays: number, asOf: Date): boolean {
  const dueAt = addDays(confirmedAt, dueDays);
  return dueAt <= asOf;
}

function addDays(value: Date, days: number): Date {
  const nonNegativeDueDays = Math.max(days, 0);
  return new Date(value.getTime() + nonNegativeDueDays * 24 * 60 * 60 * 1000);
}

function contractStageAmountCents(
  settlementAmountCents: number | bigint,
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
