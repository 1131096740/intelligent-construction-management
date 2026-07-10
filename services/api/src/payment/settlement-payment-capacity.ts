import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  moneyCentsToApi
} from "../money/decimal-money";

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
  requestedAmountCents: number | bigint;
  approvedAmountCents?: number | bigint | null;
  paidAmountCents: number | bigint;
}

export interface SettlementPaymentCapacity {
  outstandingPaymentCents: bigint;
  occupiedCents: bigint;
  remainingCents: bigint;
}

export interface ContractDueSettlement {
  id: string;
  status: string;
  amountCents: number | bigint;
  paidAmountCents?: number | bigint;
  contractVersionId?: string;
  paymentTermsVersionId: string;
  isFinal?: boolean;
  sourceType?: string | null;
  sourceTakeoverId?: string | null;
}

export interface ContractDuePaymentTermsStage {
  paymentTermsVersionId: string;
  stageType?: string;
  basis: string;
  ratioBps: number | null;
  fixedAmountCents: number | bigint | null;
  triggerAnchor?: string;
  dueDays: number;
  advanceDeductionMode?: string | null;
  advanceDeductionRatioBps?: number | null;
  advanceDeductionStartRatioBps?: number | null;
  requiresInvoice?: boolean | null;
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
  retentionWithheldCents?: number | bigint;
  retentionReleasedCents?: number | bigint;
  otherConfirmedOccupancyCents?: number | bigint;
}

export interface ContractDuePaymentCapacity {
  duePayableCents: bigint;
  occupiedCents: bigint;
  remainingCents: bigint;
  advanceDeductionCents?: bigint;
}

export interface ContractDuePaymentCapacityBigInt {
  duePayableCents: bigint;
  occupiedCents: bigint;
  remainingCents: bigint;
  advanceDeductionCents?: bigint;
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
  fixedAmountCents?: string | null;
  source: string;
  currentSettlementAmountCents: string;
  cumulativeBeforeAmountCents: string;
  cumulativeAfterAmountCents: string;
  effectiveAt: Date | null;
  expectedPayableAt: Date | null;
  paymentRule: string;
  requiresInvoice?: boolean;
  isDue: boolean;
  includableAmountCents: string;
}

export interface ContractPaymentApplicationSection {
  type: ContractPaymentApplicationSectionType;
  title: string;
  rows: ContractPaymentApplicationRow[];
}

export interface ContractPaymentApplicationPreview {
  capacity: {
    cumulativeEffectiveSettlementCents: string;
    systemCumulativeEffectiveSettlementCents?: string;
    historicalSettledCents?: string;
    duePayableCents: string;
    occupiedCents: string;
    historicalOccupiedCents?: string;
    advanceDeductionCents: string;
    maxRequestableCents: string;
  };
  advanceDeduction: {
    paidAdvanceCents: string;
    systemPaidAdvanceCents?: string;
    historicalAdvancePaidCents?: string;
    historicalAdvanceDeductedCents?: string;
    currentDeductionCents: string;
    remainingAdvanceToDeductCents: string;
  };
  historicalBalance?: {
    settledCents: string;
    approvalPendingPaymentCents: string;
    approvedPendingPaymentCents: string;
    paidCents: string;
    proxyPaidCents: string;
    advancePaidCents: string;
    advanceDeductedCents: string;
    retentionWithheldCents: string;
    retentionReleasedCents: string;
    otherConfirmedOccupancyCents: string;
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
  fixedAmountCents: bigint | null;
  sourceEffectiveAt: Date | null;
  expectedPayableAt: Date | null;
  sourcePayableAmountCents: bigint;
  amountCents: bigint;
}

export function calculateSettlementPaymentCapacity(input: {
  payableAmountCents: number | bigint;
  actualPaidAmountCents: number | bigint;
  proxyPaidAmountCents: number | bigint;
  paymentRequests: readonly SettlementCapacityPaymentRequest[];
}): SettlementPaymentCapacity {
  return calculateSettlementPaymentCapacityBigInt(input);
}

export function calculateSettlementPaymentCapacityBigInt(input: {
  payableAmountCents: number | bigint;
  actualPaidAmountCents: number | bigint;
  proxyPaidAmountCents: number | bigint;
  paymentRequests: readonly SettlementCapacityPaymentRequest[];
}): {
  outstandingPaymentCents: bigint;
  occupiedCents: bigint;
  remainingCents: bigint;
} {
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + outstandingPaymentRequestCents(payment),
    0n
  );
  const occupiedCents =
    dbMoneyToBigInt(input.actualPaidAmountCents, "实付金额") +
    dbMoneyToBigInt(input.proxyPaidAmountCents, "代付金额") +
    outstandingPaymentCents;
  const remainingCents = dbMoneyToBigInt(input.payableAmountCents, "应付金额") - occupiedCents;

  return {
    outstandingPaymentCents,
    occupiedCents,
    remainingCents
  };
}

export function calculateContractDuePaymentCapacity(input: {
  asOf: Date;
  settlements: readonly ContractDueSettlement[];
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: number | bigint;
  contractAmountCents?: number | bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number | bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacity {
  return calculateContractDuePaymentCapacityBigInt(input);
}

export function calculateContractDuePaymentCapacityBigInt(input: {
  asOf: Date;
  settlements: readonly ContractDueSettlement[];
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: number | bigint;
  contractAmountCents?: number | bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number | bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacityBigInt {
  const historicalBalance = normalizeHistoricalBalance(input.historicalBalance);
  const capacityHistoricalBalance = historicalBalanceRepresentedBySettlements(
    input.settlements,
    historicalBalance
  );
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

    const confirmedAt =
      confirmedAtBySettlement.get(settlement.id) ??
      historicalInitialSettlementConfirmedAt(settlement, historicalBalance);
    if (!confirmedAt) return total;
    addMapBigInt(
      cumulativeConfirmedSettlementCentsByTerms,
      settlement.paymentTermsVersionId,
      dbMoneyToBigInt(settlement.amountCents, "结算金额")
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
        dbMoneyToBigInt(settlement.amountCents, "结算金额")
      );
    }

    return total + minBigInt(
      settlementDueCents,
      dbMoneyToBigInt(settlement.amountCents, "结算金额")
    );
  }, 0n);
  const actualPaidAmountCents =
    input.settlements.reduce<bigint>(
      (total, settlement) =>
        total + dbMoneyToBigInt(settlement.paidAmountCents ?? 0, "结算已付金额"),
      0n
    ) +
    input.paymentRequests.reduce<bigint>(
      (total, payment) =>
        payment.settlementId === null
          ? total + dbMoneyToBigInt(payment.paidAmountCents ?? 0, "合同到期付款实付金额")
          : total,
      0n
    );
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + outstandingPaymentRequestCents(payment),
    0n
  );
  const paidAdvanceCentsForCapacity = paidAdvanceCentsByTerms(input.advancePaymentRequests ?? []);
  const paidAdvanceCentsForCapacityWithHistory = withHistoricalAdvancePaid(
    paidAdvanceCentsForCapacity,
    capacityHistoricalBalance
  );
  const advanceDeductionCents = calculateAdvanceDeductionCents({
    paidAdvanceCentsByTerms: paidAdvanceCentsForCapacityWithHistory,
    historicalAdvanceDeductedCentsByTerms: historicalAdvanceDeductedCentsByTerms(
      capacityHistoricalBalance
    ),
    contractAmountCents: dbMoneyToBigInt(input.contractAmountCents ?? 0, "合同金额"),
    contractAmountCentsByTerms: contractAmountCentsByTerms(
      input.contractAmountCentsByPaymentTermsVersionId
    ),
    dueSettlementBasisCentsByTerms,
    cumulativeConfirmedSettlementCentsByTerms,
    paymentTermsStages: input.paymentTermsStages
  });
  const occupiedCents =
    actualPaidAmountCents +
    dbMoneyToBigInt(input.proxyPaidAmountCents ?? 0, "项目代付金额") +
    outstandingPaymentCents +
    historicalOccupiedCents(capacityHistoricalBalance);
  const remainingCents = duePayableCents - occupiedCents - advanceDeductionCents;

  return {
    duePayableCents,
    occupiedCents,
    remainingCents,
    ...(input.advancePaymentRequests
      ? { advanceDeductionCents }
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
  proxyPaidAmountCents?: number | bigint;
  contractAmountCents?: number | bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, number | bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractPaymentApplicationPreview {
  const historicalBalance = normalizeHistoricalBalance(input.historicalBalance);
  const capacityHistoricalBalance = historicalBalanceRepresentedBySettlements(
    input.settlements,
    historicalBalance
  );
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

    const confirmedAt =
      confirmedAtBySettlement.get(settlement.id) ??
      historicalInitialSettlementConfirmedAt(settlement, historicalBalance);
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
      const includableAmountCents = moneyCentsToApi(
        isDue
          ? minBigInt(contractStageAmountCents(settlement.amountCents, stage), settlementAmountCents)
          : 0n
      );
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
        fixedAmountCents:
          stage.fixedAmountCents === null
            ? null
            : moneyCentsToApi(dbMoneyToBigInt(stage.fixedAmountCents, "固定付款金额")),
        source: settlement.code ?? settlement.id,
        currentSettlementAmountCents: moneyCentsToApi(settlementAmountCents),
        cumulativeBeforeAmountCents: moneyCentsToApi(before),
        cumulativeAfterAmountCents: moneyCentsToApi(cumulativeEffectiveSettlementCents),
        effectiveAt: confirmedAt,
        expectedPayableAt,
        paymentRule: paymentRuleLabel(stage),
        requiresInvoice: stage.requiresInvoice === true,
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
    const contractAmountCents = contractAmountCentsForTerms(
      {
        contractAmountCents: dbMoneyToBigInt(input.contractAmountCents ?? 0, "合同金额"),
        contractAmountCentsByTerms: contractAmountCentsByTerms(
          input.contractAmountCentsByPaymentTermsVersionId
        )
      },
      stage.paymentTermsVersionId
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
      fixedAmountCents:
        stage.fixedAmountCents === null
          ? null
          : moneyCentsToApi(dbMoneyToBigInt(stage.fixedAmountCents, "固定付款金额")),
      source: "合同生效",
      currentSettlementAmountCents: "0",
      cumulativeBeforeAmountCents: moneyCentsToApi(cumulativeEffectiveSettlementCents),
      cumulativeAfterAmountCents: moneyCentsToApi(cumulativeEffectiveSettlementCents),
      effectiveAt,
      expectedPayableAt,
      paymentRule: paymentRuleLabel(stage),
      requiresInvoice: stage.requiresInvoice === true,
      isDue,
      includableAmountCents: moneyCentsToApi(
        isDue ? contractStageAmountCents(contractAmountCents, stage) : 0n
      )
    });
  }

  const capacity = calculateContractDuePaymentCapacityBigInt({
    ...input,
    advancePaymentRequests: input.advancePaymentRequests ?? []
  });
  const systemPaidAdvanceCents = [
    ...paidAdvanceCentsByTerms(input.advancePaymentRequests ?? []).values()
  ].reduce(
    (total, amount) => total + amount,
    0n
  );
  const paidAdvanceCents = systemPaidAdvanceCents + historicalBalance.advancePaidCents;
  const currentDeductionCents = capacity.advanceDeductionCents ?? 0n;
  const hasHistorical = hasHistoricalBalance(historicalBalance);
  const systemCumulativeEffectiveSettlementCents = cumulativeEffectiveSettlementCents;
  const totalCumulativeEffectiveSettlementCents =
    cumulativeEffectiveSettlementCents + capacityHistoricalBalance.settledCents;
  const historicalSettledCents = capacityHistoricalBalance.settledCents;
  const historicalOccupiedAmountCents = historicalOccupiedCents(capacityHistoricalBalance);
  const historicalAdvanceDeductedCents = capacityHistoricalBalance.advanceDeductedCents;
  const remainingAdvanceToDeductCents = maxBigInt(
    paidAdvanceCents - historicalAdvanceDeductedCents - currentDeductionCents,
    0n
  );

  return {
    capacity: {
      cumulativeEffectiveSettlementCents: moneyCentsToApi(totalCumulativeEffectiveSettlementCents),
      ...(hasHistorical
        ? {
            systemCumulativeEffectiveSettlementCents: moneyCentsToApi(systemCumulativeEffectiveSettlementCents),
            historicalSettledCents: moneyCentsToApi(historicalSettledCents),
            historicalOccupiedCents: moneyCentsToApi(historicalOccupiedAmountCents)
          }
        : {}),
      duePayableCents: moneyCentsToApi(capacity.duePayableCents),
      occupiedCents: moneyCentsToApi(capacity.occupiedCents),
      advanceDeductionCents: moneyCentsToApi(currentDeductionCents),
      maxRequestableCents: moneyCentsToApi(maxBigInt(capacity.remainingCents, 0n))
    },
    advanceDeduction: {
      paidAdvanceCents: moneyCentsToApi(paidAdvanceCents),
      ...(hasHistorical
        ? {
            systemPaidAdvanceCents: moneyCentsToApi(systemPaidAdvanceCents),
            historicalAdvancePaidCents: moneyCentsToApi(historicalBalance.advancePaidCents),
            historicalAdvanceDeductedCents: moneyCentsToApi(historicalAdvanceDeductedCents)
          }
        : {}),
      currentDeductionCents: moneyCentsToApi(currentDeductionCents),
      remainingAdvanceToDeductCents: moneyCentsToApi(remainingAdvanceToDeductCents)
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
  amountCents: bigint;
  sections: readonly ContractPaymentApplicationSection[];
  existingAllocations?: readonly {
    sourceRowId: string;
    amountCents: bigint;
  }[];
}): ContractDuePaymentExecutionAllocation[] {
  const executionAmountCents = dbMoneyToBigInt(input.amountCents, "登记实付金额");
  if (executionAmountCents <= 0n) {
    throw new Error("登记实付金额必须大于 0，不能分摊零金额或负数付款。");
  }

  const allocatedCentsByRow = new Map<string, bigint>();
  for (const allocation of input.existingAllocations ?? []) {
    const allocationAmountCents = dbMoneyToBigInt(
      allocation.amountCents,
      "既有实付分摊金额"
    );
    addMapBigInt(
      allocatedCentsByRow,
      allocation.sourceRowId,
      allocationAmountCents > 0n ? allocationAmountCents : 0n
    );
  }

  let remainingToAllocate = executionAmountCents;
  let totalAvailable = 0n;
  const allocations: ContractDuePaymentExecutionAllocation[] = [];

  for (const section of input.sections) {
    if (section.type === "advance") continue;

    for (const row of section.rows) {
      if (!row.isDue || !row.settlementId) continue;

      const includableAmountCents = BigInt(row.includableAmountCents);
      const rowAvailable =
        (includableAmountCents > 0n ? includableAmountCents : 0n) -
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
        fixedAmountCents:
          row.fixedAmountCents === null || row.fixedAmountCents === undefined
            ? null
            : BigInt(row.fixedAmountCents),
        sourceEffectiveAt: row.effectiveAt,
        expectedPayableAt: row.expectedPayableAt,
        sourcePayableAmountCents: BigInt(row.includableAmountCents),
        amountCents: amount
      });
      remainingToAllocate -= amount;
    }
  }

  if (remainingToAllocate > 0n) {
    throw new Error(
      `登记实付金额超过当前可分摊的到期应付款，当前最多可分摊 ${formatMoneyCentsAsYuan(
        totalAvailable
      )} 元。`
    );
  }

  return allocations;
}

export function calculateContractAdvancePaymentCapacity(input: {
  asOf: Date;
  contractAmountCents: number | bigint;
  contractEffectiveAt: Date | null;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  paymentRequests: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacity {
  return calculateContractAdvancePaymentCapacityBigInt(input);
}

export function calculateContractAdvancePaymentCapacityBigInt(input: {
  asOf: Date;
  contractAmountCents: number | bigint;
  contractEffectiveAt: Date | null;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  paymentRequests: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}): ContractDuePaymentCapacityBigInt {
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
    nonNegativeBigIntCents(input.contractAmountCents, "合同金额")
  );
  const actualPaidAmountCents = input.paymentRequests.reduce<bigint>(
    (total, payment) =>
      total + dbMoneyToBigInt(payment.paidAmountCents ?? 0, "预付款实付金额"),
    0n
  );
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + outstandingPaymentRequestCents(payment),
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
    duePayableCents: cappedDuePayableCents,
    occupiedCents,
    remainingCents
  };
}

export function sumMoneyCents(values: Array<bigint | number>): bigint {
  return values.reduce<bigint>(
    (total, value) => total + dbMoneyToBigInt(value, "金额合计"),
    0n
  );
}

function isHistoricalInitialSettlement(settlement: ContractDueSettlement): boolean {
  return settlement.sourceType === "historical_takeover" || !!settlement.sourceTakeoverId;
}

function historicalInitialSettlementConfirmedAt(
  settlement: ContractDueSettlement,
  balance: NormalizedHistoricalContractPaymentBalance
): Date | null {
  if (!isHistoricalInitialSettlement(settlement)) return null;

  return balance.balanceConfirmedAt;
}

function historicalBalanceRepresentedBySettlements(
  settlements: readonly ContractDueSettlement[],
  balance: NormalizedHistoricalContractPaymentBalance
): NormalizedHistoricalContractPaymentBalance {
  if (!settlements.some(isHistoricalInitialSettlement)) {
    return balance;
  }

  return {
    ...balance,
    settledCents: 0n,
    paidCents: 0n
  };
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
  retentionWithheldCents: bigint;
  retentionReleasedCents: bigint;
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
    retentionWithheldCents: 0n,
    retentionReleasedCents: 0n,
    otherConfirmedOccupancyCents: 0n
  };

  if (!value?.balanceConfirmedAt) {
    return empty;
  }

  return {
    paymentTermsVersionId: value.paymentTermsVersionId,
    balanceConfirmedAt: value.balanceConfirmedAt,
    settledCents: nonNegativeBigIntCents(value.settledCents ?? 0, "历史已结算金额"),
    approvalPendingPaymentCents: nonNegativeBigIntCents(
      value.approvalPendingPaymentCents ?? 0,
      "历史审批中付款金额"
    ),
    approvedPendingPaymentCents: nonNegativeBigIntCents(
      value.approvedPendingPaymentCents ?? 0,
      "历史已批待付金额"
    ),
    paidCents: nonNegativeBigIntCents(value.paidCents ?? 0, "历史已付金额"),
    proxyPaidCents: nonNegativeBigIntCents(value.proxyPaidCents ?? 0, "历史代付金额"),
    advancePaidCents: nonNegativeBigIntCents(
      value.advancePaidCents ?? 0,
      "历史预付款已付金额"
    ),
    advanceDeductedCents: nonNegativeBigIntCents(
      value.advanceDeductedCents ?? 0,
      "历史预付款已扣回金额"
    ),
    retentionWithheldCents: nonNegativeBigIntCents(
      value.retentionWithheldCents ?? 0,
      "历史质保金扣留金额"
    ),
    retentionReleasedCents: nonNegativeBigIntCents(
      value.retentionReleasedCents ?? 0,
      "历史质保金释放金额"
    ),
    otherConfirmedOccupancyCents: nonNegativeBigIntCents(
      value.otherConfirmedOccupancyCents ?? 0,
      "历史其他确认占用金额"
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
      balance.retentionWithheldCents,
      balance.retentionReleasedCents,
      balance.otherConfirmedOccupancyCents
    ].some((amount) => amount > 0n)
  );
}

function historicalBalanceReadModel(balance: NormalizedHistoricalContractPaymentBalance) {
  return {
    settledCents: moneyCentsToApi(balance.settledCents),
    approvalPendingPaymentCents: moneyCentsToApi(balance.approvalPendingPaymentCents),
    approvedPendingPaymentCents: moneyCentsToApi(balance.approvedPendingPaymentCents),
    paidCents: moneyCentsToApi(balance.paidCents),
    proxyPaidCents: moneyCentsToApi(balance.proxyPaidCents),
    advancePaidCents: moneyCentsToApi(balance.advancePaidCents),
    advanceDeductedCents: moneyCentsToApi(balance.advanceDeductedCents),
    retentionWithheldCents: moneyCentsToApi(balance.retentionWithheldCents),
    retentionReleasedCents: moneyCentsToApi(balance.retentionReleasedCents),
    otherConfirmedOccupancyCents: moneyCentsToApi(balance.otherConfirmedOccupancyCents)
  };
}

function historicalOccupiedCents(balance: NormalizedHistoricalContractPaymentBalance): bigint {
  return (
    balance.paidCents +
    balance.approvalPendingPaymentCents +
    balance.approvedPendingPaymentCents +
    balance.proxyPaidCents +
    (balance.retentionWithheldCents > balance.retentionReleasedCents
      ? balance.retentionWithheldCents - balance.retentionReleasedCents
      : 0n) +
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
      throw new Error(`预付款扣回方式不受支持：${mode}。请检查合同付款条款后再发起付款。`);
    }

    if (stage.advanceDeductionRatioBps === null || stage.advanceDeductionRatioBps === undefined) {
      throw new Error("预付款扣回比例未填写，不能计算本次可付款金额。请先补齐合同付款条款。");
    }
    const ratioBps = stage.advanceDeductionRatioBps;
    if (ratioBps <= 0) {
      throw new Error("预付款扣回比例必须大于 0，不能计算本次可付款金额。");
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
        throw new Error("预付款条件扣回缺少起扣比例，不能计算本次可付款金额。请先补齐合同付款条款。");
      }
      const startRatioBps = stage.advanceDeductionStartRatioBps;
      const startAmountCents =
        (contractAmountCentsForTerms(input, stage.paymentTermsVersionId) *
          BigInt(startRatioBps)) /
        10000n;
      const cumulativeConfirmedSettlementCents =
        input.cumulativeConfirmedSettlementCentsByTerms.get(stage.paymentTermsVersionId) ?? 0n;
      if (cumulativeConfirmedSettlementCents < startAmountCents) {
        return totals;
      }
    }

    const scheduledCents = (dueSettlementBasisCents * BigInt(ratioBps)) / 10000n;
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

    const paidAmountCents = dbMoneyToBigInt(payment.paidAmountCents ?? 0, "预付款实付金额");
    addMapBigInt(
      totals,
      payment.paymentTermsVersionId,
      paidAmountCents > 0n ? paidAmountCents : 0n
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
    totals.set(termsId, nonNegativeBigIntCents(amountCents, "付款条款版本合同金额"));
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

function nonNegativeBigIntCents(value: bigint | number, fieldName: string): bigint {
  const cents = dbMoneyToBigInt(value, fieldName);
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
    const fixedAmountCents = dbMoneyToBigInt(stage.fixedAmountCents, "固定付款金额");
    return fixedAmountCents > 0n ? fixedAmountCents : 0n;
  }

  if (stage.ratioBps === null) {
    return 0n;
  }

  const ratioBps = stage.ratioBps > 0 ? stage.ratioBps : 0;
  return (dbMoneyToBigInt(settlementAmountCents, "结算金额") * BigInt(ratioBps)) / 10000n;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function outstandingPaymentRequestCents(payment: SettlementCapacityPaymentRequest): bigint {
  const requestedAmountCents = dbMoneyToBigInt(payment.requestedAmountCents, "付款申请金额");
  const paidAmountCents = dbMoneyToBigInt(payment.paidAmountCents, "已付金额");
  if (["approval_pending", "in_approval"].includes(payment.status)) {
    const outstanding = requestedAmountCents - paidAmountCents;
    return outstanding > 0n ? outstanding : 0n;
  }

  if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
    const approvedAmountCents = dbMoneyToBigInt(
      payment.approvedAmountCents ?? payment.requestedAmountCents,
      "批准金额"
    );
    const outstanding = approvedAmountCents - paidAmountCents;
    return outstanding > 0n ? outstanding : 0n;
  }

  return 0n;
}
