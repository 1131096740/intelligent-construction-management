import { ConflictException, Injectable } from "@nestjs/common";
import { canonicalize, fingerprint } from "./operating-takeover.utils";

export type HistoricalFinancialEvidenceLevel = "A" | "B" | "C";
export type HistoricalFinancialRowKind =
  | "payable"
  | "payment_execution"
  | "settlement_allocation"
  | "inter_entity_relationship"
  | "fund_movement"
  | "opening_balance";

export interface HistoricalPaymentExecutionTarget {
  id: string;
  idempotencyKey: string;
  voucherFileId: string;
  amountCents: bigint;
  paidAt: Date;
  payerCompanyEntityId: string;
}

export interface HistoricalPayableTarget {
  payableRef: string;
  sourceType: string;
  sourceAggregateId: string;
  sourceLineId: string;
  confirmedVersionId: string;
  debtorCompanyId: string;
  payeeSubjectType: string;
  payeeSubjectId: string;
  beneficiaryProjectId: string;
  grossAmountCents: bigint;
}

export interface HistoricalSettlementAllocationTarget {
  id: string;
  settlementCaseId: string;
  paymentExecutionId: string;
  payableRef: string;
  sourceType: string;
  sourceAggregateId: string;
  sourceLineId: string;
  confirmedVersionId: string;
  debtorCompanyId: string;
  payeeSubjectType: string;
  payeeSubjectId: string;
  beneficiaryProjectId: string;
  amountCents: bigint;
  currencyCode: string;
  paymentIdempotencyKey: string;
  paymentVoucherFileId: string;
  paymentPaidAt: Date;
  payerCompanyEntityId: string;
}

export interface HistoricalRelationshipTarget {
  id: string;
  payloadFingerprint: string;
  originalDebtorCompanyId: string;
  creditorCompanyId: string;
  amountCents: bigint;
  currencyCode: string;
}

export interface HistoricalFundMovementTarget {
  id: string;
  payloadFingerprint: string;
  sourceProjectId: string;
  beneficiaryProjectId: string;
  sourceCompanyEntityId: string;
  beneficiaryCompanyEntityId: string;
  amountCents: bigint;
  paymentExecutionId?: string | null;
}

export interface HistoricalOpeningBalanceTarget {
  axis: "payable" | "relationship" | "fund";
  subjectKey: string;
  counterpartyKey: string;
  categoryCode: string;
  period: string;
  grossAmountCents: bigint;
  evidenceReference: string;
}

export interface HistoricalFinancialTakeoverRow {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceCoordinate: string;
  normalizedRowHash: string;
  kind: HistoricalFinancialRowKind;
  evidenceLevel: HistoricalFinancialEvidenceLevel;
  amountCents: bigint;
  currencyCode: string;
  asOfDate: Date;
  paymentExecution?: HistoricalPaymentExecutionTarget;
  payable?: HistoricalPayableTarget;
  settlementAllocation?: HistoricalSettlementAllocationTarget;
  relationship?: HistoricalRelationshipTarget;
  fundMovement?: HistoricalFundMovementTarget;
  openingBalance?: HistoricalOpeningBalanceTarget;
  gapReason?: string;
  legacyDedupeRefs?: {
    projectProxyPaymentId?: string;
    projectAffiliatePaymentFactId?: string;
  };
}

export type HistoricalFinancialMappingDecision = "LINK" | "OPENING_BALANCE" | "GAP";

export interface HistoricalFinancialTakeoverMapping {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceCoordinate: string;
  normalizedRowHash: string;
  kind: HistoricalFinancialRowKind;
  evidenceLevel: HistoricalFinancialEvidenceLevel;
  amountCents: bigint;
  currencyCode: string;
  asOfDate: Date;
  decision: HistoricalFinancialMappingDecision;
  targetKind: Exclude<HistoricalFinancialRowKind, "opening_balance"> | "historical_opening_balance" | null;
  targetRef: string | null;
  targetFingerprint: string | null;
  targetSnapshot: Record<string, unknown>;
  sourceDuplicateGroupKey: string;
  bankDuplicateGroupKey: string | null;
  payableDuplicateGroupKey: string | null;
  movementDuplicateGroupKey: string | null;
  openingBalanceDuplicateGroupKey: string | null;
  conflictGroupKeys: string[];
  legacyDedupeRefs: {
    projectProxyPaymentId: string | null;
    projectAffiliatePaymentFactId: string | null;
  };
  mappingFingerprint: string;
}

@Injectable()
export class HistoricalFinancialTakeoverAdapter {
  map(row: HistoricalFinancialTakeoverRow): HistoricalFinancialTakeoverMapping {
    assertBase(row);
    const sourceDuplicateGroupKey = `source:${fingerprint({
      projectId: row.projectId,
      sourceType: row.sourceType,
      sourceBusinessId: row.sourceBusinessId,
      sourceVersion: row.sourceVersion,
      sourceCoordinate: row.sourceCoordinate
    })}`;
    const legacyDedupeRefs = {
      projectProxyPaymentId: row.legacyDedupeRefs?.projectProxyPaymentId ?? null,
      projectAffiliatePaymentFactId: row.legacyDedupeRefs?.projectAffiliatePaymentFactId ?? null
    };

    if (row.evidenceLevel === "C") {
      if (!text(row.gapReason)) throw new ConflictException("C 级历史资金行必须说明待核对原因");
      return finalize(row, {
        decision: "GAP",
        targetKind: null,
        targetRef: null,
        targetFingerprint: null,
        targetSnapshot: { gapReason: text(row.gapReason) },
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey: null,
        payableDuplicateGroupKey: null,
        movementDuplicateGroupKey: null,
        openingBalanceDuplicateGroupKey: null,
        legacyDedupeRefs
      });
    }

    if (row.evidenceLevel === "B") {
      if (row.kind !== "opening_balance" || !row.openingBalance) {
        throw new ConflictException("B 级历史资金只允许建立可证明的期初毛额余额");
      }
      if (row.paymentExecution || row.payable || row.settlementAllocation || row.relationship || row.fundMovement) {
        throw new ConflictException("B 级期初余额不得携带付款、核销、往来或 movement 正式身份");
      }
      const balance = row.openingBalance;
      if (balance.grossAmountCents <= 0n || balance.grossAmountCents !== row.amountCents) {
        throw new ConflictException("B 级期初余额必须是与来源行一致的正数毛额");
      }
      for (const value of [balance.subjectKey, balance.counterpartyKey, balance.categoryCode, balance.period, balance.evidenceReference]) {
        if (!text(value)) throw new ConflictException("B 级期初余额缺少受控主体、相对方、类别、期间或证据");
      }
      const targetSnapshot = canonicalize({
        axis: balance.axis,
        subjectKey: balance.subjectKey,
        counterpartyKey: balance.counterpartyKey,
        categoryCode: balance.categoryCode,
        period: balance.period,
        grossAmountCents: balance.grossAmountCents,
        currencyCode: row.currencyCode,
        evidenceReference: balance.evidenceReference,
        asOfDate: row.asOfDate
      }) as Record<string, unknown>;
      const targetFingerprint = fingerprint(targetSnapshot);
      const openingBalanceDuplicateGroupKey = `opening:${fingerprint({
        projectId: row.projectId,
        axis: balance.axis,
        subjectKey: balance.subjectKey,
        counterpartyKey: balance.counterpartyKey,
        categoryCode: balance.categoryCode,
        period: balance.period,
        currencyCode: row.currencyCode
      })}`;
      return finalize(row, {
        decision: "OPENING_BALANCE",
        targetKind: "historical_opening_balance",
        targetRef: openingBalanceDuplicateGroupKey,
        targetFingerprint,
        targetSnapshot,
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey: null,
        payableDuplicateGroupKey: balance.axis === "payable" ? openingBalanceDuplicateGroupKey : null,
        movementDuplicateGroupKey: balance.axis === "fund" ? openingBalanceDuplicateGroupKey : null,
        openingBalanceDuplicateGroupKey,
        legacyDedupeRefs
      });
    }

    if (row.kind === "opening_balance") {
      throw new ConflictException("A 级必须逐笔链接正式事实，不能降格为期初汇总");
    }
    if (row.openingBalance) throw new ConflictException("A 级逐笔事实不得同时携带期初余额");

    if (row.kind === "payment_execution") {
      const payment = row.paymentExecution;
      if (!payment) throw new ConflictException("A 级付款必须引用既有 PaymentExecution");
      assertAmount(row.amountCents, payment.amountCents, "PaymentExecution");
      const targetSnapshot = canonicalize(payment) as Record<string, unknown>;
      const targetFingerprint = fingerprint(targetSnapshot);
      const bankDuplicateGroupKey = bankGroup(payment);
      return finalize(row, {
        decision: "LINK",
        targetKind: "payment_execution",
        targetRef: payment.id,
        targetFingerprint,
        targetSnapshot,
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey,
        payableDuplicateGroupKey: null,
        movementDuplicateGroupKey: null,
        openingBalanceDuplicateGroupKey: null,
        legacyDedupeRefs
      });
    }

    if (row.kind === "payable") {
      const payable = row.payable;
      if (!payable) throw new ConflictException("A 级应付必须绑定封闭 payable 身份");
      assertAmount(row.amountCents, payable.grossAmountCents, "payable");
      if (payable.beneficiaryProjectId !== row.projectId) throw new ConflictException("payable 项目与历史接管项目不一致");
      const targetSnapshot = canonicalize(payable) as Record<string, unknown>;
      const targetFingerprint = fingerprint(targetSnapshot);
      const payableDuplicateGroupKey = `payable:${fingerprint({ payableRef: payable.payableRef, sourceType: payable.sourceType, sourceAggregateId: payable.sourceAggregateId, sourceLineId: payable.sourceLineId })}`;
      return finalize(row, {
        decision: "LINK",
        targetKind: "payable",
        targetRef: payable.payableRef,
        targetFingerprint,
        targetSnapshot,
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey: null,
        payableDuplicateGroupKey,
        movementDuplicateGroupKey: null,
        openingBalanceDuplicateGroupKey: null,
        legacyDedupeRefs
      });
    }

    if (row.kind === "settlement_allocation") {
      const allocation = row.settlementAllocation;
      if (!allocation) throw new ConflictException("A 级核销必须引用既有已确认 PayableSettlementAllocation");
      assertAmount(row.amountCents, allocation.amountCents, "PayableSettlementAllocation");
      if (allocation.beneficiaryProjectId !== row.projectId) throw new ConflictException("核销分配项目与历史接管项目不一致");
      const targetSnapshot = canonicalize(allocation) as Record<string, unknown>;
      const targetFingerprint = fingerprint(targetSnapshot);
      const bankDuplicateGroupKey = bankGroup({
        id: allocation.paymentExecutionId,
        idempotencyKey: allocation.paymentIdempotencyKey,
        voucherFileId: allocation.paymentVoucherFileId,
        amountCents: allocation.amountCents,
        paidAt: allocation.paymentPaidAt,
        payerCompanyEntityId: allocation.payerCompanyEntityId
      });
      const payableDuplicateGroupKey = `payable:${fingerprint({
        payableRef: allocation.payableRef,
        sourceType: allocation.sourceType,
        sourceAggregateId: allocation.sourceAggregateId,
        sourceLineId: allocation.sourceLineId
      })}`;
      return finalize(row, {
        decision: "LINK",
        targetKind: "settlement_allocation",
        targetRef: allocation.id,
        targetFingerprint,
        targetSnapshot,
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey,
        payableDuplicateGroupKey,
        movementDuplicateGroupKey: null,
        openingBalanceDuplicateGroupKey: null,
        legacyDedupeRefs
      });
    }

    if (row.kind === "inter_entity_relationship") {
      const relationship = row.relationship;
      if (!relationship) throw new ConflictException("A 级往来必须引用既有正式往来记录");
      assertAmount(row.amountCents, relationship.amountCents, "往来");
      const targetSnapshot = canonicalize(relationship) as Record<string, unknown>;
      const targetFingerprint = fingerprint(targetSnapshot);
      return finalize(row, {
        decision: "LINK",
        targetKind: "inter_entity_relationship",
        targetRef: relationship.id,
        targetFingerprint,
        targetSnapshot,
        sourceDuplicateGroupKey,
        bankDuplicateGroupKey: null,
        payableDuplicateGroupKey: null,
        movementDuplicateGroupKey: `movement:${fingerprint({ kind: row.kind, id: relationship.id })}`,
        openingBalanceDuplicateGroupKey: null,
        legacyDedupeRefs
      });
    }

    const movement = row.fundMovement;
    if (!movement) throw new ConflictException("A 级 fund movement 必须引用既有正式 movement");
    assertAmount(row.amountCents, movement.amountCents, "fund movement");
    if (movement.sourceProjectId !== row.projectId && movement.beneficiaryProjectId !== row.projectId) {
      throw new ConflictException("fund movement 未覆盖历史接管项目");
    }
    const targetSnapshot = canonicalize(movement) as Record<string, unknown>;
    const targetFingerprint = fingerprint(targetSnapshot);
    const linkedPayment = row.paymentExecution;
    if ((movement.paymentExecutionId ?? null) !== (linkedPayment?.id ?? null)) {
      throw new ConflictException("fund movement 与 PaymentExecution 链接不一致");
    }
    if (linkedPayment) assertAmount(row.amountCents, linkedPayment.amountCents, "PaymentExecution");
    return finalize(row, {
      decision: "LINK",
      targetKind: "fund_movement",
      targetRef: movement.id,
      targetFingerprint,
      targetSnapshot,
      sourceDuplicateGroupKey,
      bankDuplicateGroupKey: linkedPayment ? bankGroup(linkedPayment) : null,
      payableDuplicateGroupKey: null,
      movementDuplicateGroupKey: `movement:${fingerprint({ kind: row.kind, id: movement.id })}`,
      openingBalanceDuplicateGroupKey: null,
      legacyDedupeRefs
    });
  }
}

function finalize(
  row: HistoricalFinancialTakeoverRow,
  mapped: Omit<HistoricalFinancialTakeoverMapping,
    "projectId" | "sourceType" | "sourceBusinessId" | "sourceVersion" | "sourceCoordinate" |
    "normalizedRowHash" | "kind" | "evidenceLevel" | "amountCents" | "currencyCode" | "asOfDate" |
    "conflictGroupKeys" | "mappingFingerprint">
): HistoricalFinancialTakeoverMapping {
  const conflictGroupKeys = [
    mapped.sourceDuplicateGroupKey,
    mapped.bankDuplicateGroupKey,
    mapped.payableDuplicateGroupKey,
    mapped.movementDuplicateGroupKey,
    mapped.openingBalanceDuplicateGroupKey
  ].filter((value): value is string => value !== null).sort();
  const base = {
    projectId: row.projectId,
    sourceType: row.sourceType,
    sourceBusinessId: row.sourceBusinessId,
    sourceVersion: row.sourceVersion,
    sourceCoordinate: row.sourceCoordinate,
    normalizedRowHash: row.normalizedRowHash.toLowerCase(),
    kind: row.kind,
    evidenceLevel: row.evidenceLevel,
    amountCents: row.amountCents,
    currencyCode: row.currencyCode,
    asOfDate: row.asOfDate,
    ...mapped,
    conflictGroupKeys
  };
  return { ...base, mappingFingerprint: fingerprint(base) };
}

function bankGroup(payment: HistoricalPaymentExecutionTarget): string {
  return `bank:${fingerprint({
    idempotencyKey: payment.idempotencyKey,
    voucherFileId: payment.voucherFileId,
    amountCents: payment.amountCents,
    paidAt: payment.paidAt,
    payerCompanyEntityId: payment.payerCompanyEntityId
  })}`;
}

function assertBase(row: HistoricalFinancialTakeoverRow): void {
  for (const value of [row.projectId, row.sourceType, row.sourceBusinessId, row.sourceCoordinate, row.currencyCode]) {
    if (!text(value)) throw new ConflictException("历史应付与资金接管行缺少稳定来源坐标");
  }
  if (!Number.isSafeInteger(row.sourceVersion) || row.sourceVersion < 1) throw new ConflictException("历史来源版本无效");
  if (!/^[0-9a-f]{64}$/i.test(row.normalizedRowHash)) throw new ConflictException("历史来源行 hash 无效");
  if (row.amountCents <= 0n) throw new ConflictException("历史接管金额必须为正数");
  if (!(row.asOfDate instanceof Date) || Number.isNaN(row.asOfDate.getTime())) throw new ConflictException("历史接管基准日无效");
}

function assertAmount(sourceAmount: bigint, targetAmount: bigint, label: string): void {
  if (sourceAmount !== targetAmount) throw new ConflictException(`${label} 金额与历史来源行不一致`);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
