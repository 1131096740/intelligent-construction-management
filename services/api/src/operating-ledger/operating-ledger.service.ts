import { normalizeOperatingMoney, normalizeOperatingSourceSnapshot, operatingNumericSnapshot, requireLegacyOperatingCents, sameOperatingMoney, type OperatingMoneyInput } from "./operating-money-protocol";
import { repaymentOwnershipDate } from "../company-transfer/company-transfer-ownership";
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  EVIDENCE_LEVELS,
  chinaDateOnly,
  normalizeBusinessAmount,
  OPERATING_FACT_KINDS,
  OPERATING_IMPACT_KINDS,
  OPERATING_SUBJECT_KINDS,
  OPERATING_SUBJECT_ROLES,
  PRIMARY_COST_CATEGORY_CODES,
  type EvidenceLevel,
  type OperatingFactKind,
  type OperatingImpactKind,
  type OperatingSubjectKind,
  type OperatingSubjectRole,
  type PrimaryCostCategoryCode
} from "@jiangkong/shared-domain";

import { PrismaService } from "../database/prisma.service";
import { registeredPaymentInstalled } from "../database/registered-payment-catalog";
import { translateProjectOperatingSerializationConflict } from "../project/project-operating-constraint";
import { createOperatingImpactInvalidator } from "../project-close-profit/project-close-impact-invalidation";

export async function translateOperatingLedgerWriteConstraint<T>(
  operation: Promise<T>
): Promise<T> {
  return translateProjectOperatingSerializationConflict(
    operation,
    "经营账写入遇到并发状态变化，请刷新后重试"
  );
}

export const OPERATING_LEDGER_LEVELS = [
  "project",
  "construction_enterprise",
  "participating_company",
  "inter_subject"
] as const;

export type OperatingLedgerLevel = (typeof OPERATING_LEDGER_LEVELS)[number];
export type OperatingFactDirection = "inflow" | "outflow" | "neutral";
export type OperatingImpactDirection = "increase" | "decrease" | "notice";
export type OperatingFactEntryKind = "original" | "correction" | "reversal";

export interface OperatingSubjectReference {
  kind: OperatingSubjectKind;
  id: string;
}

export interface OperatingFactSubjects {
  debtor?: OperatingSubjectReference;
  creditor?: OperatingSubjectReference;
  approvedPayer?: OperatingSubjectReference;
  actualPayer?: OperatingSubjectReference;
  payee?: OperatingSubjectReference;
  costBearingCompany?: OperatingSubjectReference;
}

interface OperatingImpactCommon {
  idempotencyKey: string;
  sourceImpactKey: string;
  impactKind: OperatingImpactKind;
  direction: OperatingImpactDirection;
  subjectRole?: OperatingSubjectRole;
  subject?: OperatingSubjectReference;
  costCategoryCode?: PrimaryCostCategoryCode;
  fundPurpose?: string;
  description?: string;
  impactSnapshot?: Prisma.InputJsonObject;
  paymentExecutionId?: string;
  fundExecutionId?: string;
  fundExecutionCaseId?: string;
  executionAllocationLineId?: string;
}

interface AppendOperatingFactCommon {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceBusinessCode: string;
  sourceVersion: number;
  idempotencyKey: string;
  occurredAt: Date;
  confirmedAt: Date;
  confirmedByUserId: string;
  factKind: OperatingFactKind;
  operatingLevel: OperatingLedgerLevel;
  evidenceLevel: EvidenceLevel;
  currencyCode: string;
  direction: OperatingFactDirection;
  isBeforeOperatingLedgerEffectiveDate: boolean;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  affiliateCreditCodeSnapshot?: string;
  historicalTakeoverBatchId?: string;
  sourceSnapshot: Prisma.InputJsonObject;
  basisSnapshot?: Prisma.InputJsonObject;
  subjects: OperatingFactSubjects;
  impacts: OperatingImpactInput[];
  adjustsFactId?: string;
  paymentExecutionId?: string;
  fundExecutionId?: string;
  fundExecutionCaseId?: string;
}

export type AppendOperatingFactCorrectionInput = AppendOperatingFactInput & {
  adjustsFactId: string;
};

export type OperatingImpactInput = OperatingImpactCommon & OperatingMoneyInput;
export type AppendOperatingFactInput = AppendOperatingFactCommon & OperatingMoneyInput;

export interface OperatingFactWriteResult {
  id: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  created: boolean;
  impactIds: string[];
}

export interface OperatingSourceComparisonState {
  input: AppendOperatingFactInput;
  entryKind: OperatingFactEntryKind;
  operatingLedgerEffectiveDateSnapshot: Date;
  subjectSnapshot: Prisma.InputJsonObject;
  impactSnapshots: ReadonlyMap<string, Prisma.InputJsonObject>;
}

export type OperatingLedgerTransaction = Prisma.TransactionClient;
type OperatingFactWriteRow = Pick<
  OperatingFactWriteResult,
  "id" | "projectId" | "sourceType" | "sourceBusinessId"
>;

const OPERATING_FACT_KIND_SET = new Set<string>(OPERATING_FACT_KINDS);
const OPERATING_IMPACT_KIND_SET = new Set<string>(OPERATING_IMPACT_KINDS);
const OPERATING_SUBJECT_KIND_SET = new Set<string>(OPERATING_SUBJECT_KINDS);
const EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE = "employee_project_loan_entry";
const OPERATING_SUPPORTED_SUBJECT_KIND_SET = new Set([
  "owner",
  "construction_enterprise",
  "participating_company",
  "downstream_counterparty",
  "employee",
  "public_cash"
]);
const OPERATING_SUBJECT_ROLE_SET = new Set<string>(OPERATING_SUBJECT_ROLES);
const OPERATING_SUBJECT_KINDS_BY_ROLE: Readonly<
  Record<OperatingSubjectRole, ReadonlySet<OperatingSubjectKind>>
> = {
  debtor: new Set([
    "owner",
    "construction_enterprise",
    "participating_company",
    "employee"
  ]),
  creditor: new Set([
    "construction_enterprise",
    "participating_company",
    "downstream_counterparty"
  ]),
  approved_payer: new Set(["construction_enterprise", "participating_company"]),
  actual_payer: new Set([
    "owner",
    "construction_enterprise",
    "participating_company",
    "employee",
    "public_cash"
  ]),
  payee: new Set([
    "owner",
    "construction_enterprise",
    "participating_company",
    "downstream_counterparty",
    "employee"
  ]),
  cost_bearing_company: new Set([
    "construction_enterprise",
    "participating_company"
  ]),
  fund_holder: new Set([
    "construction_enterprise",
    "participating_company",
    "public_cash"
  ])
};
const OPERATING_SUBJECT_ROLE_LABELS: Readonly<Record<OperatingSubjectRole, string>> = {
  debtor: "债务主体",
  creditor: "债权主体",
  approved_payer: "批准付款主体",
  actual_payer: "实际付款主体",
  payee: "收款主体",
  cost_bearing_company: "成本承担公司主体",
  fund_holder: "资金持有主体"
};
const FACT_SUBJECT_ROLE_BY_PROPERTY: Readonly<
  Record<keyof OperatingFactSubjects, OperatingSubjectRole>
> = {
  debtor: "debtor",
  creditor: "creditor",
  approvedPayer: "approved_payer",
  actualPayer: "actual_payer",
  payee: "payee",
  costBearingCompany: "cost_bearing_company"
};
const EVIDENCE_LEVEL_SET = new Set<string>(EVIDENCE_LEVELS);
const PRIMARY_COST_CATEGORY_SET = new Set<string>(PRIMARY_COST_CATEGORY_CODES);
const PROFIT_DISTRIBUTION_IMPACT_KIND_SET = new Set([
  "temporary_profit_distribution",
  "final_profit_distribution",
  "profit_distribution_adjustment"
]);
const REQUIRED_FACT_SUBJECT_ROLES: Record<string, Array<keyof OperatingFactSubjects>> = {
  owner_settlement: ["debtor", "creditor"],
  owner_payment: ["actualPayer", "payee"],
  downstream_contract: ["debtor", "creditor"],
  downstream_settlement: ["debtor", "creditor"],
  downstream_payment: ["actualPayer", "payee"],
  expense: ["costBearingCompany"],
  employee_loan: ["debtor", "creditor"],
  project_wage: ["costBearingCompany", "payee"],
  construction_enterprise_deduction: ["costBearingCompany"],
  invoice: ["payee"],
  fund_movement: ["actualPayer", "payee"]
};

const WAGE_STATEMENT_OPERATING_SOURCE_TYPE = "wage_statement_version";

@Injectable()
export class OperatingLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private operatingLedgerWriteSecret(): string {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (!secret) {
      throw new Error(
        "OPERATING_LEDGER_DB_WRITE_SECRET 未配置，已拒绝经营账写入"
      );
    }
    return secret;
  }

  private async appendFactRow(
    tx: OperatingLedgerTransaction,
    data: Record<string, unknown>,
    actorUserId: string
  ): Promise<OperatingFactWriteRow> {
    const rows = await translateOperatingLedgerWriteConstraint(tx.$queryRaw<OperatingFactWriteRow[]>(
      Prisma.sql`
        SELECT *
        FROM public."appendOperatingFactThroughService"(
          ${operatingFactWritePayload(data)},
          ${actorUserId},
          ${this.operatingLedgerWriteSecret()}
        )
      `
    ));
    const row = rows[0];
    if (!row) throw new Error("经营账受控事实写入未返回记录");
    return row;
  }

  private async appendImpactRow(
    tx: OperatingLedgerTransaction,
    data: Record<string, unknown>,
    actorUserId: string
  ): Promise<{ id: string; createdAt?: Date }> {
    const rows = await translateOperatingLedgerWriteConstraint(tx.$queryRaw<Array<{ id: string; createdAt?: Date }>>(
      Prisma.sql`
        SELECT *
        FROM public."appendOperatingImpactThroughService"(
          ${operatingImpactWritePayload(data)},
          ${actorUserId},
          ${this.operatingLedgerWriteSecret()}
        )
      `
    ));
    const row = rows[0];
    if (!row) throw new Error("经营账受控影响分录写入未返回记录");
    return row;
  }

  async appendFromSource(
    input: AppendOperatingFactInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    return this.prisma.$transaction((tx) =>
      this.appendFromSourceInTransaction(tx, input, actorUserId)
    );
  }

  async appendFromSourceInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    return this.appendEnvelope(tx, input, actorUserId, "original");
  }

  async replayFromSourceInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string,
    entryKind: OperatingFactEntryKind = "original"
  ): Promise<OperatingFactWriteResult> {
    return this.appendEnvelope(
      tx,
      input,
      actorUserId,
      entryKind,
      "frozen_source"
    );
  }

  async appendConfirmedSourceInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string,
    entryKind: OperatingFactEntryKind = "original"
  ): Promise<OperatingFactWriteResult> {
    return this.appendEnvelope(
      tx,
      input,
      actorUserId,
      entryKind,
      "source_actor"
    );
  }

  async appendConfirmedEmployeeLoanReversalInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    const reversalOfEntryId = requiredText(
      input.sourceSnapshot.reversalOfEntryId,
      "仅员工借款还款冲销可由正式来源写入经营账"
    );
    requiredText(
      input.sourceSnapshot.sourceRepaymentId,
      "仅员工借款还款冲销可由正式来源写入经营账"
    );
    const adjustsFactId = requiredText(
      input.adjustsFactId,
      "仅员工借款还款冲销可由正式来源写入经营账"
    );
    if (
      input.sourceType !== EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE ||
      input.factKind !== "employee_loan" ||
      input.sourceSnapshot.entryType !== "reversal"
    ) {
      throw new BadRequestException("仅员工借款还款冲销可由正式来源写入经营账");
    }
    const original = await tx.operatingFact.findUnique({
      where: { id: adjustsFactId },
      select: {
        projectId: true,
        sourceType: true,
        sourceBusinessId: true,
        factKind: true,
        entryKind: true,
        amountCents: true,
        debtorSubjectKind: true,
        debtorSubjectId: true,
        creditorSubjectKind: true,
        creditorSubjectId: true,
        approvedPayerSubjectKind: true,
        approvedPayerSubjectId: true,
        actualPayerSubjectKind: true,
        actualPayerSubjectId: true,
        payeeSubjectKind: true,
        payeeSubjectId: true,
        costBearingCompanySubjectKind: true,
        costBearingCompanySubjectId: true
      }
    });
    const expectedSubjects = subjectColumns(input.subjects);
    if (
      !original ||
      original.projectId !== input.projectId ||
      original.sourceType !== EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE ||
      original.sourceBusinessId !== reversalOfEntryId ||
      original.factKind !== "employee_loan" ||
      original.entryKind !== "original" ||
      original.amountCents !== input.amountCents ||
      !sameFactSubjects(original, expectedSubjects)
    ) {
      throw new BadRequestException("员工借款还款冲销引用的原经营事实不一致");
    }
    return this.appendEnvelope(
      tx,
      input,
      actorUserId,
      "reversal",
      "source_actor"
    );
  }

  async appendFundExecutionReversalInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    const adjustsFactId = requiredText(
      input.adjustsFactId,
      "资金反向执行必须引用原经营事实"
    );
    const original = await tx.operatingFact.findUnique({
      where: { id: adjustsFactId },
      include: {
        impacts: true,
        adjustments: { select: { id: true, entryKind: true, amountCents: true } }
      }
    });
    const expectedSubjects = subjectColumns(input.subjects);
    const sourceSnapshot = input.sourceSnapshot as Record<string, unknown>;
    if (
      input.sourceType !== "fund_execution" ||
      !input.fundExecutionId ||
      !input.fundExecutionCaseId ||
      sourceSnapshot.originalOperatingFactId !== adjustsFactId ||
      !original ||
      original.projectId !== input.projectId ||
      !["payment_execution", "fund_execution"].includes(original.sourceType) ||
      original.entryKind !== "original" ||
      original.status !== "confirmed" ||
      original.factKind !== input.factKind ||
      original.operatingLevel !== input.operatingLevel ||
      original.evidenceLevel !== input.evidenceLevel ||
      requireLegacyOperatingCents(input) <= 0n ||
      requireLegacyOperatingCents(input) > requireLegacyOperatingCents(original) ||
      original.currencyCode !== input.currencyCode ||
      inverseFactDirection(original.direction) !== input.direction ||
      original.affiliateAssignmentId !== input.affiliateAssignmentId ||
      original.affiliateBusinessPartyVersionId !==
        input.affiliateBusinessPartyVersionId ||
      original.affiliateNameSnapshot !== input.affiliateNameSnapshot ||
      (original.affiliateCreditCodeSnapshot ?? null) !==
        (input.affiliateCreditCodeSnapshot ?? null) ||
      !sameFactSubjects(original, expectedSubjects)
    ) {
      throw new BadRequestException(
        "资金反向执行必须精确复制原经营事实的冻结归属与主体"
      );
    }
    return this.appendEnvelope(
      tx,
      input,
      actorUserId,
      "reversal",
      "source_actor",
      original.occurredAt,
      true
    );
  }

  async appendCorrection(
    input: AppendOperatingFactCorrectionInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    return this.prisma.$transaction((tx) =>
      this.appendEnvelope(tx, input, actorUserId, "correction")
    );
  }

  async appendCorrectionInTransaction(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactCorrectionInput,
    actorUserId: string,
    entryKind: "correction" | "reversal" = "correction"
  ): Promise<OperatingFactWriteResult> {
    return this.appendEnvelope(tx, input, actorUserId, entryKind);
  }

  async appendReversal(
    input: AppendOperatingFactCorrectionInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    return this.prisma.$transaction((tx) =>
      this.appendEnvelope(tx, input, actorUserId, "reversal")
    );
  }

  async readFacts(projectId: string, actorUserId: string) {
    return this.prisma.$transaction((tx) =>
      this.readFactsInTransaction(tx, projectId, actorUserId)
    );
  }

  async readFactsInTransaction(
    tx: OperatingLedgerTransaction,
    projectId: string,
    actorUserId: string
  ) {
    await this.assertProjectFinanceManager(tx, actorUserId, projectId);
    return tx.operatingFact.findMany({
      where: { projectId, status: "confirmed" },
      include: { impacts: true },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
    });
  }

  async assertProjectFinanceAccessInTransaction(
    tx: OperatingLedgerTransaction,
    actorUserId: string,
    projectId: string
  ): Promise<void> {
    await this.assertProjectFinanceManager(tx, actorUserId, projectId);
  }

  async materializeSourceForComparisonInTransaction(
    tx: OperatingLedgerTransaction,
    rawInput: AppendOperatingFactInput,
    entryKind: OperatingFactEntryKind = "original"
  ): Promise<OperatingSourceComparisonState> {
    const input = normalizeFactInput(rawInput);
    validateFactInput(input);
    validateOperatingMoneyScope(input, entryKind);
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { isActive: true, operatingLedgerEffectiveDate: true }
    });
    if (!project?.isActive) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }
    if (!project.operatingLedgerEffectiveDate) {
      throw new BadRequestException("项目尚未启用经营账，不能执行一致性校验");
    }
    const ownershipDate = input.numericProtocolVersion === 2 && input.sourceType === "contract_economic_review"
      ? await assertV2EconomicReviewSource(tx, input)
      : input.sourceType === "company_transfer_event" ? await repaymentOwnershipDate(tx, input) : undefined;
    const subjectSnapshot = await this.factSubjectSnapshot(tx, input, ownershipDate);
    const impactSnapshots = new Map<string, Prisma.InputJsonObject>();
    for (const impact of input.impacts) {
      impactSnapshots.set(
        impact.sourceImpactKey,
        await this.impactSnapshotWithSubject(tx, input, impact, ownershipDate)
      );
    }
    return {
      input,
      entryKind,
      operatingLedgerEffectiveDateSnapshot: project.operatingLedgerEffectiveDate,
      subjectSnapshot,
      impactSnapshots
    };
  }

  private async appendEnvelope(
    tx: OperatingLedgerTransaction,
    rawInput: AppendOperatingFactInput,
    actorUserId: string,
    entryKind: OperatingFactEntryKind,
    confirmationAuthority: "actor" | "frozen_source" | "source_actor" = "actor",
    ownershipOccurredAt: Date = rawInput.occurredAt,
    allowPartialReversal = false
  ): Promise<OperatingFactWriteResult> {
    const input = normalizeFactInput(rawInput);
    validateFactInput(input);
    validateOperatingMoneyScope(input, entryKind);
    if (input.sourceType === "company_transfer_event") ownershipOccurredAt = await repaymentOwnershipDate(tx, input) ?? ownershipOccurredAt;
    if (input.numericProtocolVersion === 2 && input.sourceType === "contract_economic_review") {
      if (confirmationAuthority === "source_actor") await this.assertActiveActor(tx, actorUserId);
      else await this.assertProjectFinanceManager(tx, actorUserId, input.projectId);
      ownershipOccurredAt = await assertV2EconomicReviewSource(tx, input);
    }
    const writeScope = await this.assertWriteScope(
      tx,
      input,
      actorUserId,
      confirmationAuthority,
      ownershipOccurredAt
    );
    const subjectSnapshot = await this.factSubjectSnapshot(
      tx,
      input,
      ownershipOccurredAt
    );

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.sourceType}:${input.sourceBusinessId}`}, 0))`
    );
    const adjustsFactId =
      entryKind === "original"
        ? null
        : requiredText(input.adjustsFactId, "更正或冲销必须引用原经营事实");
    if (entryKind !== "original" && adjustsFactId === null) {
      throw new BadRequestException("更正或冲销必须引用原经营事实");
    }
    const adjustmentTarget =
      entryKind === "original"
        ? null
        : await this.assertAdjustmentTarget(tx, input.projectId, adjustsFactId!);
    if (entryKind === "reversal" && adjustmentTarget) {
      assertReversalImpacts(
        adjustmentTarget.impacts,
        input.impacts,
        allowPartialReversal
      );
    }

    const existing = await tx.operatingFact.findUnique({
      where: {
        sourceType_sourceBusinessId: {
          sourceType: input.sourceType,
          sourceBusinessId: input.sourceBusinessId
        }
      },
      include: { impacts: true }
    });
    if (entryKind === "reversal" && adjustmentTarget && allowPartialReversal) {
      const reversedAmountCents = adjustmentTarget.adjustments
        .filter(
          (adjustment) =>
            adjustment.entryKind === "reversal" &&
            adjustment.id !== existing?.id
        )
        .reduce((total, adjustment) => total + requireLegacyOperatingCents(adjustment), 0n);
      if (reversedAmountCents + requireLegacyOperatingCents(input) > requireLegacyOperatingCents(adjustmentTarget)) {
        throw new BadRequestException("累计冲销金额不得超过原经营事实金额");
      }
    }

    const invalidateImpact = createOperatingImpactInvalidator(tx, input.projectId);
    if (existing) {
      if (
        entryKind === "reversal" &&
        !allowPartialReversal &&
        adjustmentTarget?.adjustments.some(
          (adjustment) => adjustment.entryKind === "reversal" && adjustment.id !== existing.id
        )
      ) {
        throw new BadRequestException("同一原经营事实不允许重复冲销");
      }
      assertCompatibleFact(existing, input, entryKind, writeScope.effectiveDate, subjectSnapshot);
      const impactIds = [...existing.impacts.map((impact) => impact.id)];
      for (const impact of input.impacts) {
        const result = await this.appendImpact(
          tx,
          existing.id,
          existing.projectId,
          input,
          impact,
          actorUserId,
          invalidateImpact,
          ownershipOccurredAt
        );
        if (!impactIds.includes(result.id)) impactIds.push(result.id);
      }
      return toWriteResult(existing, false, impactIds);
    }
    if (
      entryKind === "reversal" &&
      !allowPartialReversal &&
      adjustmentTarget?.adjustments.some((adjustment) => adjustment.entryKind === "reversal")
    ) {
      throw new BadRequestException("同一原经营事实不允许重复冲销");
    }

    const created = await this.appendFactRow(
      tx,
      {
        id: randomUUID(),
        projectId: input.projectId,
        sourceType: input.sourceType,
        sourceBusinessId: input.sourceBusinessId,
        sourceVersion: input.sourceVersion,
        sourceBusinessCode: input.sourceBusinessCode,
        occurredAt: input.occurredAt,
        confirmedAt: input.confirmedAt,
        affiliateAssignmentId: input.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: input.affiliateBusinessPartyVersionId,
        affiliateNameSnapshot: input.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: input.affiliateCreditCodeSnapshot,
        operatingLedgerEffectiveDateSnapshot: writeScope.effectiveDate,
        isBeforeOperatingLedgerEffectiveDate: input.isBeforeOperatingLedgerEffectiveDate,
        historicalTakeoverBatchId: input.historicalTakeoverBatchId,
        factKind: input.factKind,
        operatingLevel: input.operatingLevel,
        evidenceLevel: input.evidenceLevel,
        amountCents: input.amountCents,
        numericProtocolVersion: input.numericProtocolVersion ?? 1,
        amountYuan: input.numericProtocolVersion === 2 ? input.amountYuan : null,
        currencyCode: input.currencyCode,
        direction: input.direction,
        ...subjectColumns(input.subjects),
        subjectSnapshot,
        sourceSnapshot: input.sourceSnapshot,
        basisSnapshot: input.basisSnapshot,
        entryKind,
        adjustsFactId,
        idempotencyKey: input.idempotencyKey,
        confirmedByUserId: input.confirmedByUserId,
        status: "confirmed",
        paymentExecutionId: input.paymentExecutionId,
        fundExecutionId: input.fundExecutionId,
        fundExecutionCaseId: input.fundExecutionCaseId
      },
      actorUserId
    );

    const impactIds: string[] = [];
    for (const impact of input.impacts) {
      const result = await this.appendImpact(
        tx,
        created.id,
        created.projectId,
        input,
        impact,
        actorUserId,
        invalidateImpact,
        ownershipOccurredAt
      );
      impactIds.push(result.id);
    }
    return toWriteResult(created, true, impactIds);
  }

  private async appendImpact(
    tx: OperatingLedgerTransaction,
    factId: string,
    projectId: string,
    input: AppendOperatingFactInput,
    impact: OperatingImpactInput,
    actorUserId: string,
    invalidateImpact: ReturnType<typeof createOperatingImpactInvalidator>,
    ownershipOccurredAt: Date = input.occurredAt
  ) {
    const impactSnapshot = await this.impactSnapshotWithSubject(
      tx,
      input,
      impact,
      ownershipOccurredAt
    );
    const existing = await tx.operatingImpactEntry.findUnique({
      where: {
        sourceType_sourceBusinessId_sourceImpactKey: {
          sourceType: input.sourceType,
          sourceBusinessId: input.sourceBusinessId,
          sourceImpactKey: impact.sourceImpactKey
        }
      }
    });
    if (existing) {
      assertCompatibleImpact(existing, factId, projectId, impact, impactSnapshot);
      return existing;
    }

    const created = await this.appendImpactRow(
      tx,
      {
        id: randomUUID(),
        factId,
        projectId,
        sourceType: input.sourceType,
        sourceBusinessId: input.sourceBusinessId,
        sourceImpactKey: impact.sourceImpactKey,
        idempotencyKey: impact.idempotencyKey,
        impactKind: impact.impactKind,
        amountCents: impact.amountCents,
        numericProtocolVersion: impact.numericProtocolVersion ?? 1,
        amountYuan: impact.numericProtocolVersion === 2 ? impact.amountYuan : null,
        direction: impact.direction,
        subjectRole: impact.subjectRole,
        subjectKind: impact.subject?.kind,
        subjectId: impact.subject?.id,
        costCategoryCode: impact.costCategoryCode,
        fundPurpose: impact.fundPurpose,
        description: impact.description,
        impactSnapshot,
        paymentExecutionId: impact.paymentExecutionId,
        fundExecutionId: impact.fundExecutionId,
        fundExecutionCaseId: impact.fundExecutionCaseId,
        executionAllocationLineId: impact.executionAllocationLineId
      },
      actorUserId
    );
    const persisted = created.createdAt
      ? created
      : await tx.operatingImpactEntry.findUnique({
        where: { id: created.id },
        select: { id: true, createdAt: true }
      });
    if (!persisted?.createdAt) {
      throw new Error("经营影响写入未返回数据库创建时间，已拒绝继续项目收口失效处理");
    }
    await invalidateImpact({
      id: created.id,
      projectId,
      sourceType: input.sourceType,
      sourceBusinessId: input.sourceBusinessId,
      sourceImpactKey: impact.sourceImpactKey,
      impactKind: impact.impactKind,
      amountCents: impact.amountCents,
      numericProtocolVersion: impact.numericProtocolVersion ?? 1,
      amountYuan: impact.numericProtocolVersion === 2 ? impact.amountYuan : null,
      direction: impact.direction,
      subjectId: impact.subject?.id,
      observedAt: persisted.createdAt,
      actorUserId
    });
    return created;
  }

  private async impactSnapshotWithSubject(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    impact: OperatingImpactInput,
    ownershipOccurredAt: Date = input.occurredAt
  ): Promise<Prisma.InputJsonObject> {
    const subjectSnapshot = await this.resolveImpactSubjectSnapshot(
      tx,
      input,
      impact.subject,
      ownershipOccurredAt,
      impact.subjectRole
    );
    const snapshot = impact.impactSnapshot ?? {};
    if (!subjectSnapshot) return snapshot;
    return { ...snapshot, subjectSnapshot };
  }

  private async factSubjectSnapshot(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    ownershipOccurredAt: Date = input.occurredAt
  ): Promise<Prisma.InputJsonObject> {
    const snapshot: Record<string, unknown> = {};
    for (const [role, subject] of Object.entries(input.subjects)) {
      const subjectSnapshot = await this.resolveImpactSubjectSnapshot(
        tx,
        input,
        subject,
        ownershipOccurredAt,
        FACT_SUBJECT_ROLE_BY_PROPERTY[role as keyof OperatingFactSubjects]
      );
      if (subjectSnapshot) snapshot[role] = subjectSnapshot;
    }
    return snapshot as Prisma.InputJsonObject;
  }

  private async registeredActualCompanySnapshot(tx: OperatingLedgerTransaction, input: AppendOperatingFactInput, subject: OperatingSubjectReference, role?: OperatingSubjectRole): Promise<Prisma.InputJsonObject|null> {
    if (role !== "actual_payer" || subject.kind !== "participating_company" || input.sourceType !== "payment_execution") return null;
    if (!(await registeredPaymentInstalled(tx))) return null;
    const funding = await tx.registeredPaymentFunding.findUnique({where:{executionId:input.sourceBusinessId}});
    if (!funding) return null;
    const [execution,account] = await Promise.all([tx.paymentExecution.findUnique({where:{id:funding.executionId}}),tx.registeredFundAccount.findUnique({where:{id:funding.accountId}})]);
    const request = execution ? await tx.paymentRequest.findUnique({where:{id:execution.paymentRequestId}}) : null;
    const frozen = funding.actualPayerSnapshot;
    if (funding.actualPayerKind !== "participating_company" || funding.actualPayerId !== subject.id || account?.kind !== "company" || account.companyEntityId !== subject.id || execution?.amountCents !== input.amountCents || request?.projectId !== input.projectId || !frozen || typeof frozen !== "object" || Array.isArray(frozen) || frozen.companyEntityId !== subject.id || typeof frozen.name !== "string" || !frozen.name.trim()) throw new BadRequestException("登记资金实际付款公司必须由同一正式实付及冻结资金容器核实，不能自报免除参与资格");
    return {kind:subject.kind,id:subject.id,companyEntityId:subject.id,name:frozen.name,creditCode:typeof frozen.creditCode === "string"?frozen.creditCode:null,authority:"registered_payment_funding",accountId:account.id};
  }

  private async resolveImpactSubjectSnapshot(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    subject?: OperatingSubjectReference,
    ownershipOccurredAt: Date = input.occurredAt,
    role?: OperatingSubjectRole
  ) {
    if (!subject) return undefined;
    const registered = await this.registeredActualCompanySnapshot(tx,input,subject,role);
    if (registered) return registered;
    if (subject.kind === "construction_enterprise") {
      const assignment = await tx.projectAffiliateAssignment.findFirst({
        where: {
          id: input.affiliateAssignmentId,
          projectId: input.projectId,
          AND: [
            { effectiveFrom: { lte: ownershipOccurredAt } },
            { OR: [{ endedAt: null }, { endedAt: { gt: ownershipOccurredAt } }] }
          ]
        },
        select: {
          businessPartyId: true,
          businessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true
        }
      });
      if (!assignment || ![assignment.businessPartyId, assignment.businessPartyVersionId].includes(subject.id)) {
        throw new BadRequestException("影响分录引用的施工企业在事实日无效，请刷新后重试");
      }
      return {
        kind: subject.kind,
        id: subject.id,
        businessPartyId: assignment.businessPartyId,
        businessPartyVersionId: assignment.businessPartyVersionId,
        name: assignment.affiliateNameSnapshot,
        creditCode: assignment.affiliateCreditCodeSnapshot ?? null
      };
    }
    if (subject.kind === "participating_company") {
      const participationDate = await archivedContractOwnershipDay(tx, input) ?? ownershipOccurredAt;
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: input.projectId,
          AND: [
            { OR: [{ companyEntityId: subject.id }, { companyEntityVersionId: subject.id }] },
            { effectiveFrom: { lte: participationDate } },
            { OR: [{ endedAt: null }, { endedAt: { gt: participationDate } }] }
          ]
        },
        select: {
          companyEntityId: true,
          companyEntityVersionId: true,
          companyNameSnapshot: true,
          companyCreditCodeSnapshot: true
        }
      });
      if (!participant) {
        throw new BadRequestException("影响分录引用的我方公司未在本项目事实日参与，请刷新后重试");
      }
      return {
        kind: subject.kind,
        id: subject.id,
        companyEntityId: participant.companyEntityId,
        companyEntityVersionId: participant.companyEntityVersionId,
        name: participant.companyNameSnapshot,
        creditCode: participant.companyCreditCodeSnapshot ?? null
      };
    }
    return { kind: subject.kind, id: subject.id };
  }

  private async assertWriteScope(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    actorUserId: string,
    confirmationAuthority: "actor" | "frozen_source" | "source_actor",
    ownershipOccurredAt: Date = input.occurredAt
  ): Promise<{
    effectiveDate: Date;
  }> {
    if (confirmationAuthority === "source_actor") {
      await this.assertActiveActor(tx, actorUserId);
    } else {
      await this.assertProjectFinanceManager(tx, actorUserId, input.projectId);
    }
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        isActive: true,
        operatingLedgerEffectiveDate: true
      }
    });
    const confirmedByUserId = requiredText(
      input.confirmedByUserId,
      "正式确认人不能为空"
    );
    if (
      (confirmationAuthority === "actor" || confirmationAuthority === "source_actor") &&
      confirmedByUserId !== actorUserId
    ) {
      throw new ForbiddenException(
        confirmationAuthority === "actor"
          ? "正式确认人必须是当前财务操作人"
          : "正式确认人必须是当前业务操作人"
      );
    }
    if (confirmationAuthority === "frozen_source") {
      const sourceConfirmer = await tx.user.findUnique({
        where: { id: confirmedByUserId },
        select: { id: true }
      });
      if (!sourceConfirmer) {
        throw new BadRequestException("冻结来源的正式确认人不存在，不能执行重放");
      }
    }
    if (!project?.isActive) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }
    if (!project.operatingLedgerEffectiveDate) {
      throw new BadRequestException("项目尚未启用经营账，不能登记正式经营事实");
    }
    const archiveOwnershipDay = await archivedContractOwnershipDay(tx, input);
    const participationDate = archiveOwnershipDay ?? ownershipOccurredAt;
    const expectedBefore = (archiveOwnershipDay ? chinaDateOnly(input.occurredAt) : dateOnly(input.occurredAt)) < dateOnly(project.operatingLedgerEffectiveDate);
    if (input.isBeforeOperatingLedgerEffectiveDate !== expectedBefore) {
      throw new BadRequestException("经营事实的生效日前后属性与项目经营账生效日不一致");
    }

    const assignment = await tx.projectAffiliateAssignment.findFirst({
      where: {
        id: input.affiliateAssignmentId,
        projectId: input.projectId,
        businessPartyVersionId: input.affiliateBusinessPartyVersionId,
        AND: [
          { effectiveFrom: { lte: ownershipOccurredAt } },
          { OR: [{ endedAt: null }, { endedAt: { gt: ownershipOccurredAt } }] }
        ]
      },
      select: {
        id: true,
        businessPartyId: true,
        projectId: true,
        businessPartyVersionId: true,
        affiliateNameSnapshot: true,
        affiliateCreditCodeSnapshot: true
      }
    });
    if (!assignment) {
      throw new BadRequestException("正式经营事实引用的施工企业已失效，请刷新后重试");
    }
    if (
      assignment.affiliateNameSnapshot !== input.affiliateNameSnapshot ||
      (assignment.affiliateCreditCodeSnapshot ?? null) !== (input.affiliateCreditCodeSnapshot ?? null)
    ) {
      throw new BadRequestException("正式经营事实的施工企业快照与当前档案不一致");
    }

    for (const [role,subject] of Object.entries(input.subjects)) {
      if (!subject) continue;
      if (subject.kind === "construction_enterprise") {
        if (![assignment.businessPartyId, assignment.businessPartyVersionId].includes(subject.id)) {
          throw new BadRequestException("经营事实引用的施工企业主体与项目档案不一致");
        }
        continue;
      }
      if (subject.kind === "public_cash") {
        const funding = input.sourceType === "payment_execution" && await registeredPaymentInstalled(tx)
          ? await tx.registeredPaymentFunding.findUnique({where:{executionId:input.sourceBusinessId}})
          : null;
        const execution = funding ? await tx.paymentExecution.findUnique({where:{id:funding.executionId}}) : null;
        const account = funding ? await tx.registeredFundAccount.findUnique({where:{id:funding.accountId}}) : null;
        if (subject.id !== "public_cash" || funding?.actualPayerKind !== "public_cash" || funding.actualPayerId !== subject.id || account?.kind !== "public_cash" || account.companyEntityId !== null || execution?.amountCents !== input.amountCents) throw new BadRequestException("公共现金经营后果必须关联同一正式实付及无公司资金容器，不能用客户端标记替代");
        continue;
      }
      if (subject.kind !== "participating_company") continue;
      if (role === "actualPayer" && await this.registeredActualCompanySnapshot(tx,input,subject,"actual_payer")) continue;
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: input.projectId,
          AND: [
            { OR: [{ companyEntityId: subject.id }, { companyEntityVersionId: subject.id }] },
            { effectiveFrom: { lte: participationDate } },
            { OR: [{ endedAt: null }, { endedAt: { gt: participationDate } }] }
          ]
        },
        select: { id: true }
      });
      if (!participant) {
        throw new BadRequestException("经营事实引用的我方公司未在本项目事实日参与，请刷新后重试");
      }
    }
    return { effectiveDate: project.operatingLedgerEffectiveDate };
  }

  private async assertProjectFinanceManager(
    tx: OperatingLedgerTransaction,
    actorUserId: string,
    projectId: string
  ) {
    await this.assertActiveActor(tx, actorUserId);

    const [projectMembers, projectPositions] = await Promise.all([
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId }, select: { positionKey: true } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId }, select: { positionId: true } })
    ]);
    const positions = projectPositions.length
      ? await tx.position.findMany({
          where: { id: { in: projectPositions.map((position) => position.positionId) } },
          select: { key: true }
        })
      : [];
    const keys = [...projectMembers.map((member) => member.positionKey), ...positions.map((position) => position.key)];
    if (!keys.some((key) => key === "finance_staff" || key === "finance_director")) {
      throw new ForbiddenException("只有当前项目财务人员可以登记经营事实");
    }
  }

  private async assertActiveActor(
    tx: OperatingLedgerTransaction,
    actorUserId: string
  ): Promise<void> {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
  }

  private async assertAdjustmentTarget(
    tx: OperatingLedgerTransaction,
    projectId: string,
    adjustsFactId: string
  ) {
    const original = await tx.operatingFact.findUnique({
      where: { id: adjustsFactId },
      include: {
        impacts: true,
        adjustments: { select: { id: true, entryKind: true, amountCents: true } }
      }
    });
    if (!original) throw new NotFoundException("原经营事实不存在，请刷新后重试");
    if (original.projectId !== projectId) {
      throw new BadRequestException("更正或冲销只能引用同一项目的经营事实");
    }
    return original;
  }

}

function frozenEconomicRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("履约复核冻结依据不完整，请核对原资料");
  return value as Record<string, unknown>;
}

/** Recheck the approved source tuple, never a client assertion of approval. */
async function assertV2EconomicReviewSource(tx: OperatingLedgerTransaction, input: Extract<AppendOperatingFactInput, { numericProtocolVersion: 2 }>): Promise<Date> {
  const fail = () => { throw new BadRequestException("履约复核状态、原承诺或冻结金额已变化，请刷新后核对"); };
  const source = frozenEconomicRecord(input.sourceSnapshot);
  const baseline = frozenEconomicRecord(source.baseline);
  if (typeof source.reviewId !== "string" || typeof source.sourceRef !== "string" || typeof source.excludedDeltaYuan !== "string" || input.amountYuan === null || input.amountYuan === "0.0000") return fail();
  const delta = normalizeBusinessAmount(source.excludedDeltaYuan, { allowNegative: true });
  if (delta === null || delta === "0.0000" || new Prisma.Decimal(delta).abs().toFixed(4) !== input.amountYuan || input.impacts[0]?.direction !== (delta.startsWith("-") ? "increase" : "decrease")) return fail();
  const review = await tx.contractEconomicReview.findUnique({ where: { id: source.reviewId } });
  if (!review || review.status !== "confirmed" || !review.confirmedAt || review.projectId !== input.projectId || review.revision !== input.sourceVersion || input.sourceBusinessId !== `${review.id}:${source.sourceRef}` || ![review.leftSourceRef, review.rightSourceRef].includes(source.sourceRef) || input.confirmedByUserId !== (review.financeReviewedById ?? review.contractReviewedById) || input.occurredAt.getTime() !== review.confirmedAt.getTime() || input.confirmedAt.getTime() !== review.confirmedAt.getTime() || !Array.isArray(review.frozenSources) || review.frozenSources.length < 1 || review.frozenSources.length > 2 || review.leftSourceRef === review.rightSourceRef) return fail();
  const frozen = review.frozenSources.filter(value => value && typeof value === "object" && !Array.isArray(value) && value.ref === source.sourceRef);
  if (frozen.length !== 1) return fail();
  const document = frozenEconomicRecord(frozen[0]);
  if (document.formal !== true || !(document.coverageNumericProtocolVersion === 2 || document.numericProtocolVersion === 2) || typeof document.excludedDeltaYuan !== "string" || normalizeBusinessAmount(document.excludedDeltaYuan, { allowNegative: true }) !== delta || !sameJson(document.operatingBaseline, baseline)) return fail();
  if (typeof baseline.originalOperatingFactId !== "string" || typeof document.version !== "string") return fail();
  const original = await tx.operatingFact.findUnique({ where: { id: baseline.originalOperatingFactId } });
  const expectedType = source.sourceRef.startsWith("contract:") ? "contract_version" : source.sourceRef.startsWith("affiliate:") ? "project_affiliate_contract_fact" : null;
  if (!original || !expectedType || original.projectId !== input.projectId || original.status !== "confirmed" || original.entryKind !== "original" || original.factKind !== "downstream_contract" || original.sourceType !== expectedType || original.sourceType !== baseline.originalSourceType || original.sourceBusinessId !== baseline.originalSourceBusinessId || original.sourceBusinessId !== document.version.split(":")[0] || original.sourceVersion !== baseline.originalSourceVersion || original.numericProtocolVersion !== baseline.numericProtocolVersion || original.currencyCode !== input.currencyCode || !sameJson(original.sourceSnapshot, baseline.sourceSnapshot)) return fail();
  const originalSource = frozenEconomicRecord(original.sourceSnapshot);
  if (original.numericProtocolVersion !== 2 && (originalSource.amountNature === "uncapped" || originalSource.amountCents === null)) throw new BadRequestException("当前经营调整尚不能表达该原金额状态，请核对原资料");
  if (original.numericProtocolVersion === 2) {
    const numericFacts=frozenEconomicRecord(originalSource.numericFacts);
    const amountState=original.amountYuan===null?"unknown":"known";
    if (baseline.amountCents !== null || !Object.hasOwn(baseline,"amountYuan") || baseline.amountState!==amountState || numericFacts.protocolVersion!==2 || numericFacts.amountState!==amountState || !Object.hasOwn(numericFacts,"amountYuan") || numericFacts.amountYuan!==(original.amountYuan===null?null:original.amountYuan.toFixed(4)) || (original.amountYuan===null?baseline.amountYuan!==null:typeof baseline.amountYuan!=="string"||original.amountYuan.toFixed(4)!==baseline.amountYuan)) return fail();
  } else if (baseline.amountYuan !== null || typeof baseline.amountCents !== "string" || requireLegacyOperatingCents(original).toString() !== baseline.amountCents) return fail();
  const frozenSubjects = frozenEconomicRecord(baseline.subjects);
  const frozenDebtor = frozenEconomicRecord(frozenSubjects.debtor);
  const frozenCreditor = frozenEconomicRecord(frozenSubjects.creditor);
  if (baseline.affiliateAssignmentId !== original.affiliateAssignmentId || baseline.affiliateBusinessPartyVersionId !== original.affiliateBusinessPartyVersionId || baseline.affiliateNameSnapshot !== original.affiliateNameSnapshot || (baseline.affiliateCreditCodeSnapshot ?? null) !== original.affiliateCreditCodeSnapshot || frozenDebtor.kind !== original.debtorSubjectKind || frozenDebtor.id !== original.debtorSubjectId || frozenCreditor.kind !== original.creditorSubjectKind || frozenCreditor.id !== original.creditorSubjectId) return fail();
  if (input.affiliateAssignmentId !== original.affiliateAssignmentId || input.affiliateBusinessPartyVersionId !== original.affiliateBusinessPartyVersionId || input.affiliateNameSnapshot !== original.affiliateNameSnapshot || (input.affiliateCreditCodeSnapshot ?? null) !== original.affiliateCreditCodeSnapshot || input.subjects.debtor?.kind !== original.debtorSubjectKind || input.subjects.debtor?.id !== original.debtorSubjectId || input.subjects.creditor?.kind !== original.creditorSubjectKind || input.subjects.creditor?.id !== original.creditorSubjectId) return fail();
  return original.occurredAt;
}

function validateOperatingMoneyScope(input: AppendOperatingFactInput, entryKind: OperatingFactEntryKind) {
  if (input.impacts.some(impact => (impact.numericProtocolVersion ?? 1) !== (input.numericProtocolVersion ?? 1))) throw new BadRequestException("经营事实与影响分录必须使用同一金额协议");
  if (input.numericProtocolVersion !== 2) return;
  if (input.sourceType === "contract_economic_review" && (input.amountYuan === null || input.amountYuan === "0.0000")) throw new BadRequestException("履约复核调整仅支持已确认的非零承诺金额");
  if (entryKind !== "original" || !["contract_version", "contract_economic_review"].includes(input.sourceType) || input.factKind !== "downstream_contract" || input.direction !== "neutral" || input.paymentExecutionId || input.fundExecutionId || input.fundExecutionCaseId || input.impacts.length !== 1 || input.impacts.some(impact => impact.numericProtocolVersion !== 2 || impact.impactKind !== "contract_commitment_reference" || impact.sourceImpactKey !== "contract_commitment_reference" || impact.subjectRole !== "debtor" || (input.amountYuan === null ? impact.direction !== "notice" : !["increase", "decrease"].includes(impact.direction)) || impact.amountYuan !== input.amountYuan || impact.paymentExecutionId || impact.fundExecutionId || impact.fundExecutionCaseId || impact.executionAllocationLineId)) throw new BadRequestException("新版合同承诺影响必须与原事实的待确定状态及金额一致，不得改作成本、实付或冲销");
}

function normalizeFactInput(input: AppendOperatingFactInput): AppendOperatingFactInput {
  const common: AppendOperatingFactCommon = input;
  return {
    ...common,
    ...normalizeOperatingMoney(input),
    ...(input.numericProtocolVersion === 2 ? { sourceSnapshot: normalizeOperatingSourceSnapshot(input) } : {}),
    projectId: requiredText(input.projectId, "项目不能为空"),
    sourceType: requiredText(input.sourceType, "来源类型不能为空"),
    sourceBusinessId: requiredText(input.sourceBusinessId, "来源业务主键不能为空"),
    sourceBusinessCode: requiredText(input.sourceBusinessCode, "来源业务编号不能为空"),
    idempotencyKey: requiredText(input.idempotencyKey, "经营事实幂等键不能为空"),
    confirmedByUserId: requiredText(input.confirmedByUserId, "正式确认人不能为空"),
    currencyCode: requiredText(input.currencyCode, "原币种不能为空"),
    affiliateAssignmentId: requiredText(input.affiliateAssignmentId, "施工企业档案不能为空"),
    affiliateBusinessPartyVersionId: requiredText(input.affiliateBusinessPartyVersionId, "施工企业版本不能为空"),
    affiliateNameSnapshot: requiredText(input.affiliateNameSnapshot, "施工企业名称快照不能为空"),
    affiliateCreditCodeSnapshot: optionalText(input.affiliateCreditCodeSnapshot),
    historicalTakeoverBatchId: optionalText(input.historicalTakeoverBatchId),
    subjects: normalizeFactSubjects(input.subjects),
    impacts: input.impacts.map(normalizeImpactInput),
    adjustsFactId: optionalText(input.adjustsFactId),
    paymentExecutionId: optionalText(input.paymentExecutionId),
    fundExecutionId: optionalText(input.fundExecutionId),
    fundExecutionCaseId: optionalText(input.fundExecutionCaseId)
  };
}

function normalizeFactSubjects(subjects: OperatingFactSubjects): OperatingFactSubjects {
  return {
    debtor: normalizeSubjectReference(subjects.debtor, "债务主体不能为空"),
    creditor: normalizeSubjectReference(subjects.creditor, "债权主体不能为空"),
    approvedPayer: normalizeSubjectReference(subjects.approvedPayer, "审批付款主体不能为空"),
    actualPayer: normalizeSubjectReference(subjects.actualPayer, "实际付款主体不能为空"),
    payee: normalizeSubjectReference(subjects.payee, "收款主体不能为空"),
    costBearingCompany: normalizeSubjectReference(subjects.costBearingCompany, "成本承担公司不能为空")
  };
}

function normalizeImpactInput(impact: OperatingImpactInput): OperatingImpactInput {
  const common: OperatingImpactCommon = impact;
  return {
    ...common,
    ...normalizeOperatingMoney(impact),
    ...(impact.numericProtocolVersion === 2 ? { impactSnapshot: { ...impact.impactSnapshot, numericFacts: operatingNumericSnapshot(normalizeOperatingMoney(impact) as Extract<OperatingMoneyInput, { numericProtocolVersion: 2 }>) } } : {}),
    idempotencyKey: requiredText(impact.idempotencyKey, "影响分录幂等键不能为空"),
    sourceImpactKey: requiredText(impact.sourceImpactKey, "来源影响键不能为空"),
    subject: normalizeSubjectReference(impact.subject, "影响分录主体不能为空"),
    fundPurpose: optionalText(impact.fundPurpose),
    description: optionalText(impact.description),
    paymentExecutionId: optionalText(impact.paymentExecutionId),
    fundExecutionId: optionalText(impact.fundExecutionId),
    fundExecutionCaseId: optionalText(impact.fundExecutionCaseId),
    executionAllocationLineId: optionalText(impact.executionAllocationLineId)
  };
}

function normalizeSubjectReference(
  subject: OperatingSubjectReference | undefined,
  message: string
): OperatingSubjectReference | undefined {
  if (!subject) return undefined;
  return { ...subject, id: requiredText(subject.id, message) };
}

function optionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertReversalImpacts(
  originalImpacts: Array<{
    sourceImpactKey: string;
    impactKind: string;
    amountCents: bigint | null;
    direction: string;
    subjectRole: string | null;
    subjectKind: string | null;
    subjectId: string | null;
    costCategoryCode: string | null;
    fundPurpose: string | null;
  }>,
  reversalImpacts: OperatingImpactInput[],
  allowPartialReversal = false
) {
  const originalKeys = new Set(originalImpacts.map((impact) => impact.sourceImpactKey));
  const reversalKeys = new Set(reversalImpacts.map((impact) => impact.sourceImpactKey));
  if (
    originalKeys.size !== originalImpacts.length ||
    reversalKeys.size !== reversalImpacts.length ||
    originalKeys.size !== reversalKeys.size ||
    [...originalKeys].some((key) => !reversalKeys.has(key))
  ) {
    throw new BadRequestException("冲销必须覆盖原经营事实的全部影响分录");
  }
  for (const reversalImpact of reversalImpacts) {
    const originalImpact = originalImpacts.find(
      (impact) => impact.sourceImpactKey === reversalImpact.sourceImpactKey
    );
    if (!originalImpact) {
      throw new BadRequestException("冲销必须逐笔引用原经营影响分录");
    }
    if (
      originalImpact.impactKind !== reversalImpact.impactKind ||
      (allowPartialReversal
        ? requireLegacyOperatingCents(reversalImpact) <= 0n ||
          requireLegacyOperatingCents(reversalImpact) > requireLegacyOperatingCents(originalImpact)
        : originalImpact.amountCents !== reversalImpact.amountCents) ||
      inverseImpactDirection(originalImpact.direction) !== reversalImpact.direction ||
      (originalImpact.subjectRole ?? null) !== (reversalImpact.subjectRole ?? null) ||
      (originalImpact.subjectKind ?? null) !== (reversalImpact.subject?.kind ?? null) ||
      (originalImpact.subjectId ?? null) !== (reversalImpact.subject?.id ?? null) ||
      (originalImpact.costCategoryCode ?? null) !== (reversalImpact.costCategoryCode ?? null) ||
      (originalImpact.fundPurpose ?? null) !== (reversalImpact.fundPurpose ?? null)
    ) {
      throw new BadRequestException("冲销分录必须使用原分录金额并登记反向影响");
    }
  }
}

function inverseImpactDirection(direction: string): string {
  if (direction === "increase") return "decrease";
  if (direction === "decrease") return "increase";
  return "notice";
}

function inverseFactDirection(direction: string): string {
  if (direction === "inflow") return "outflow";
  if (direction === "outflow") return "inflow";
  return "neutral";
}

function validateFactInput(input: AppendOperatingFactInput) {
  requiredText(input.projectId, "项目不能为空");
  requiredText(input.sourceType, "来源类型不能为空");
  requiredText(input.sourceBusinessId, "来源业务主键不能为空");
  requiredText(input.sourceBusinessCode, "来源业务编号不能为空");
  requiredText(input.idempotencyKey, "经营事实幂等键不能为空");
  requiredText(input.confirmedByUserId, "正式确认人不能为空");
  requiredText(input.affiliateAssignmentId, "施工企业档案不能为空");
  requiredText(input.affiliateBusinessPartyVersionId, "施工企业版本不能为空");
  requiredText(input.affiliateNameSnapshot, "施工企业名称快照不能为空");
  validateDate(input.occurredAt, "业务发生时间");
  validateDate(input.confirmedAt, "正式确认时间");
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) {
    throw new BadRequestException("来源版本必须是正整数");
  }
  if (!OPERATING_FACT_KIND_SET.has(input.factKind)) throw new BadRequestException("事实种类不正确");
  if (!OPERATING_LEDGER_LEVELS.includes(input.operatingLevel)) throw new BadRequestException("经营层级不正确");
  if (!EVIDENCE_LEVEL_SET.has(input.evidenceLevel)) throw new BadRequestException("证据等级不正确");
  if ((input.evidenceLevel === "C") !== (input.factKind === "historical_gap")) {
    throw new BadRequestException("C级证据只能进入历史资料缺口，不能直接进入正式经营账");
  }
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new BadRequestException("原币种必须使用三位大写代码");
  if (!new Set(["inflow", "outflow", "neutral"]).has(input.direction)) {
    throw new BadRequestException("经营事实方向不正确");
  }
  if (
    input.numericProtocolVersion !== 2 && (input.amountCents < 0n ||
    (!["historical_gap", "downstream_contract"].includes(input.factKind) && input.amountCents === 0n))
  ) {
    throw new BadRequestException("经营事实金额必须使用不小于零的整数分");
  }
  if (!input.sourceSnapshot || typeof input.sourceSnapshot !== "object" || Array.isArray(input.sourceSnapshot)) {
    throw new BadRequestException("经营事实必须保留来源快照");
  }
  for (const [property, subject] of Object.entries(input.subjects) as Array<
    [keyof OperatingFactSubjects, OperatingSubjectReference | undefined]
  >) {
    if (subject && !OPERATING_SUPPORTED_SUBJECT_KIND_SET.has(subject.kind)) {
      throw new BadRequestException("当前经营账尚未接入该主体种类，不能登记正式事实");
    }
    if (subject) validateSubjectRoleKind(FACT_SUBJECT_ROLE_BY_PROPERTY[property], subject);
  }
  for (const role of requiredFactSubjectRoles(input)) {
    if (!input.subjects[role]) {
      throw new BadRequestException(`事实种类${input.factKind}必须填写${role}主体`);
    }
  }
  if (isWageStatementProjectWage(input)) {
    if (input.subjects.payee || input.subjects.creditor) {
      throw new BadRequestException("工资经营事实不得伪造单一收款或债权主体");
    }
    const debtor = input.subjects.debtor;
    const costBearingCompany = input.subjects.costBearingCompany;
    if (
      !debtor ||
      !costBearingCompany ||
      debtor.kind !== "participating_company" ||
      costBearingCompany.kind !== "participating_company" ||
      debtor.id !== costBearingCompany.id
    ) {
      throw new BadRequestException("工资经营事实的债务与成本承担主体必须是同一劳动关系公司");
    }
  }
  if (!input.impacts.length) throw new BadRequestException("经营事实至少需要一笔影响分录");
  for (const impact of input.impacts) validateImpactInput(impact);
  if (input.evidenceLevel === "C" && input.impacts.some((impact) => impact.impactKind !== "evidence_gap_notice")) {
    throw new BadRequestException("C级证据只能登记缺口提示，不能产生正式经营影响");
  }
}

function isWageStatementProjectWage(input: AppendOperatingFactInput): boolean {
  return input.sourceType === WAGE_STATEMENT_OPERATING_SOURCE_TYPE && input.factKind === "project_wage";
}

function requiredFactSubjectRoles(input: AppendOperatingFactInput): Array<keyof OperatingFactSubjects> {
  if (isWageStatementProjectWage(input)) return ["debtor", "costBearingCompany"];
  return REQUIRED_FACT_SUBJECT_ROLES[input.factKind] ?? [];
}

function validateImpactInput(impact: OperatingImpactInput) {
  requiredText(impact.idempotencyKey, "影响分录幂等键不能为空");
  requiredText(impact.sourceImpactKey, "来源影响键不能为空");
  if (!OPERATING_IMPACT_KIND_SET.has(impact.impactKind)) throw new BadRequestException("影响种类不正确");
  if (!new Set(["increase", "decrease", "notice"]).has(impact.direction)) {
    throw new BadRequestException("影响分录方向不正确");
  }
  if (
    impact.numericProtocolVersion !== 2 && (impact.amountCents < 0n ||
    (!["evidence_gap_notice", "contract_commitment_reference"].includes(impact.impactKind) && impact.amountCents === 0n))
  ) {
    throw new BadRequestException("影响分录金额必须使用不小于零的整数分");
  }
  if (
    ["evidence_gap_notice", "invoice_reference"].includes(
      impact.impactKind
    ) &&
    impact.direction !== "notice"
  ) {
    throw new BadRequestException("资料依据提示必须使用notice方向");
  }
  if (
    ["confirmed_cost", "estimated_clearing_expense"].includes(impact.impactKind) &&
    !impact.costCategoryCode
  ) {
    throw new BadRequestException("成本影响必须填写一级成本分类");
  }
  if (
    PROFIT_DISTRIBUTION_IMPACT_KIND_SET.has(impact.impactKind) &&
    impact.subject?.kind !== "participating_company"
  ) {
    throw new BadRequestException("盈亏分配影响只能关联项目参与公司");
  }
  if (impact.subject && !OPERATING_SUBJECT_KIND_SET.has(impact.subject.kind)) {
    throw new BadRequestException("影响分录主体种类不正确");
  }
  if (impact.subject && !OPERATING_SUPPORTED_SUBJECT_KIND_SET.has(impact.subject.kind)) {
    throw new BadRequestException("当前经营账尚未接入该影响主体种类，不能登记正式分录");
  }
  if (impact.subject) requiredText(impact.subject.id, "影响分录主体不能为空");
  if (impact.subjectRole && !OPERATING_SUBJECT_ROLE_SET.has(impact.subjectRole)) {
    throw new BadRequestException("影响分录主体角色不正确");
  }
  if (impact.subjectRole && !impact.subject) {
    throw new BadRequestException("影响分录指定主体角色时必须同时指定主体");
  }
  if (impact.subjectRole && impact.subject) {
    validateSubjectRoleKind(impact.subjectRole, impact.subject);
  }
  if (impact.impactSnapshot !== undefined &&
      (typeof impact.impactSnapshot !== "object" || impact.impactSnapshot === null || Array.isArray(impact.impactSnapshot))) {
    throw new BadRequestException("影响分录快照格式不正确");
  }
  if (impact.costCategoryCode && !PRIMARY_COST_CATEGORY_SET.has(impact.costCategoryCode)) {
    throw new BadRequestException("影响分录成本分类不正确");
  }
}

function validateSubjectRoleKind(
  role: OperatingSubjectRole,
  subject: OperatingSubjectReference
): void {
  if (!OPERATING_SUBJECT_KINDS_BY_ROLE[role].has(subject.kind)) {
    throw new BadRequestException(
      `${OPERATING_SUBJECT_ROLE_LABELS[role]}只能是${allowedSubjectKindsLabel(
        OPERATING_SUBJECT_KINDS_BY_ROLE[role]
      )}`
    );
  }
}

function allowedSubjectKindsLabel(kinds: ReadonlySet<OperatingSubjectKind>): string {
  const labels: Partial<Record<OperatingSubjectKind, string>> = {
    owner: "业主",
    construction_enterprise: "施工企业",
    participating_company: "我方公司",
    downstream_counterparty: "下游相对方",
    employee: "员工",
    public_cash: "公共现金"
  };
  return [...kinds].map((kind) => labels[kind] ?? kind).join("或");
}

function assertCompatibleFact(
  existing: {
    id: string;
    projectId: string;
    occurredAt: Date;
    confirmedAt: Date;
    sourceVersion: number;
    sourceBusinessCode: string;
    affiliateAssignmentId: string;
    affiliateBusinessPartyVersionId: string;
    affiliateNameSnapshot: string;
    affiliateCreditCodeSnapshot: string | null;
    operatingLedgerEffectiveDateSnapshot: Date;
    isBeforeOperatingLedgerEffectiveDate: boolean;
    historicalTakeoverBatchId: string | null;
    factKind: string;
    operatingLevel: string;
    evidenceLevel: string;
    amountCents: bigint | null;
    numericProtocolVersion?: number;
    amountYuan?: Prisma.Decimal | string | null;
    currencyCode: string;
    direction: string;
    debtorSubjectKind: string | null;
    debtorSubjectId: string | null;
    creditorSubjectKind: string | null;
    creditorSubjectId: string | null;
    approvedPayerSubjectKind: string | null;
    approvedPayerSubjectId: string | null;
    actualPayerSubjectKind: string | null;
    actualPayerSubjectId: string | null;
    payeeSubjectKind: string | null;
    payeeSubjectId: string | null;
    costBearingCompanySubjectKind: string | null;
    costBearingCompanySubjectId: string | null;
    subjectSnapshot: Prisma.JsonValue;
    sourceSnapshot: Prisma.JsonValue;
    basisSnapshot: Prisma.JsonValue | null;
    entryKind: string;
    adjustsFactId: string | null;
    confirmedByUserId: string;
    paymentExecutionId?: string | null;
    fundExecutionId?: string | null;
    fundExecutionCaseId?: string | null;
  },
  input: AppendOperatingFactInput,
  entryKind: OperatingFactEntryKind,
  effectiveDate: Date,
  subjectSnapshot: Prisma.InputJsonObject
) {
  const expectedSubjects = subjectColumns(input.subjects);
  const scalarMatches = [
    existing.projectId === input.projectId,
    existing.occurredAt.getTime() === input.occurredAt.getTime(),
    existing.confirmedAt.getTime() === input.confirmedAt.getTime(),
    existing.sourceVersion === input.sourceVersion,
    existing.sourceBusinessCode === input.sourceBusinessCode,
    existing.affiliateAssignmentId === input.affiliateAssignmentId,
    existing.affiliateBusinessPartyVersionId === input.affiliateBusinessPartyVersionId,
    existing.affiliateNameSnapshot === input.affiliateNameSnapshot,
    (existing.affiliateCreditCodeSnapshot ?? null) === (input.affiliateCreditCodeSnapshot ?? null),
    dateOnly(existing.operatingLedgerEffectiveDateSnapshot) === dateOnly(effectiveDate),
    existing.isBeforeOperatingLedgerEffectiveDate === input.isBeforeOperatingLedgerEffectiveDate,
    (existing.historicalTakeoverBatchId ?? null) === (input.historicalTakeoverBatchId ?? null),
    existing.factKind === input.factKind,
    existing.operatingLevel === input.operatingLevel,
    existing.evidenceLevel === input.evidenceLevel,
    sameOperatingMoney(existing, input),
    existing.currencyCode === input.currencyCode,
    existing.direction === input.direction,
    existing.entryKind === entryKind,
    existing.adjustsFactId === (entryKind === "original" ? null : input.adjustsFactId),
    existing.confirmedByUserId === input.confirmedByUserId,
    (existing.paymentExecutionId ?? null) === (input.paymentExecutionId ?? null),
    (existing.fundExecutionId ?? null) === (input.fundExecutionId ?? null),
    (existing.fundExecutionCaseId ?? null) === (input.fundExecutionCaseId ?? null),
    (existing.debtorSubjectKind ?? null) === (expectedSubjects.debtorSubjectKind ?? null),
    (existing.debtorSubjectId ?? null) === (expectedSubjects.debtorSubjectId ?? null),
    (existing.creditorSubjectKind ?? null) === (expectedSubjects.creditorSubjectKind ?? null),
    (existing.creditorSubjectId ?? null) === (expectedSubjects.creditorSubjectId ?? null),
    (existing.approvedPayerSubjectKind ?? null) === (expectedSubjects.approvedPayerSubjectKind ?? null),
    (existing.approvedPayerSubjectId ?? null) === (expectedSubjects.approvedPayerSubjectId ?? null),
    (existing.actualPayerSubjectKind ?? null) === (expectedSubjects.actualPayerSubjectKind ?? null),
    (existing.actualPayerSubjectId ?? null) === (expectedSubjects.actualPayerSubjectId ?? null),
    (existing.payeeSubjectKind ?? null) === (expectedSubjects.payeeSubjectKind ?? null),
    (existing.payeeSubjectId ?? null) === (expectedSubjects.payeeSubjectId ?? null),
    (existing.costBearingCompanySubjectKind ?? null) === (expectedSubjects.costBearingCompanySubjectKind ?? null),
    (existing.costBearingCompanySubjectId ?? null) === (expectedSubjects.costBearingCompanySubjectId ?? null),
    sameJson(existing.subjectSnapshot, subjectSnapshot),
    sameJson(existing.sourceSnapshot, input.sourceSnapshot),
    sameJson(existing.basisSnapshot ?? null, input.basisSnapshot ?? null)
  ];
  if (scalarMatches.some((matches) => !matches)) {
    throw new BadRequestException("同一来源已登记不同的经营事实，不能覆盖原事实");
  }
}

function assertCompatibleImpact(
  existing: {
    id: string;
    factId: string;
    projectId: string;
    impactKind: string;
    amountCents: bigint | null;
    numericProtocolVersion?: number;
    amountYuan?: Prisma.Decimal | string | null;
    direction: string;
    subjectRole: string | null;
    subjectKind: string | null;
    subjectId: string | null;
    costCategoryCode: string | null;
    fundPurpose: string | null;
    description: string | null;
    impactSnapshot: Prisma.JsonValue;
    paymentExecutionId?: string | null;
    fundExecutionId?: string | null;
    fundExecutionCaseId?: string | null;
    executionAllocationLineId?: string | null;
  },
  factId: string,
  projectId: string,
  impact: OperatingImpactInput,
  impactSnapshot: Prisma.InputJsonObject
) {
  if (
    existing.factId !== factId ||
    existing.projectId !== projectId ||
    existing.impactKind !== impact.impactKind ||
    !sameOperatingMoney(existing, impact) ||
    existing.direction !== impact.direction ||
    (existing.subjectRole ?? null) !== (impact.subjectRole ?? null) ||
    (existing.subjectKind ?? null) !== (impact.subject?.kind ?? null) ||
    (existing.subjectId ?? null) !== (impact.subject?.id ?? null) ||
    (existing.costCategoryCode ?? null) !== (impact.costCategoryCode ?? null) ||
    (existing.fundPurpose ?? null) !== (impact.fundPurpose ?? null) ||
    (existing.description ?? null) !== (impact.description ?? null) ||
    (existing.paymentExecutionId ?? null) !== (impact.paymentExecutionId ?? null) ||
    (existing.fundExecutionId ?? null) !== (impact.fundExecutionId ?? null) ||
    (existing.fundExecutionCaseId ?? null) !== (impact.fundExecutionCaseId ?? null) ||
    (existing.executionAllocationLineId ?? null) !==
      (impact.executionAllocationLineId ?? null) ||
    !sameJson(existing.impactSnapshot, impactSnapshot)
  ) {
    throw new BadRequestException("同一来源影响键已登记不同分录，不能覆盖原分录");
  }
}

/** Only a real immutable Archive2 can select the new Date-column day domain.
 * Review sources arrive here only after assertV2EconomicReviewSource completed;
 * this re-reads its immutable original and requires the exact same A/B/X binding.
 * Assignment DateTime periods continue using ownershipOccurredAt, never this day.
 */
async function archivedContractOwnershipDay(tx: OperatingLedgerTransaction, input: AppendOperatingFactInput): Promise<Date | null> {
  if (input.numericProtocolVersion !== 2 || !["contract_version", "contract_economic_review"].includes(input.sourceType)) return null;
  let source: unknown = input.sourceSnapshot;
  let versionId = input.sourceBusinessId;
  let originalInstant = input.occurredAt;
  let sourceVersion = input.sourceVersion;
  if (input.sourceType === "contract_economic_review") {
    const baseline = archiveObject(input.sourceSnapshot.baseline);
    if (typeof baseline.originalOperatingFactId !== "string") throw new BadRequestException("履约复核缺少原事实来源");
    const original = await tx.operatingFact.findUnique({ where: { id: baseline.originalOperatingFactId } });
    if (!original || original.projectId !== input.projectId || original.sourceType !== "contract_version") return null;
    source = original.sourceSnapshot; versionId = original.sourceBusinessId; originalInstant = original.occurredAt; sourceVersion = original.sourceVersion;
  }
  const snapshot = archiveObject(source);
  const archive = await tx.contractArchiveFile.findFirst({ where: { contractVersionId: versionId, archiveProtocolVersion: 2, status: "confirmed" } });
  if (!archive || archive.archiveProtocolVersion !== 2) {
    if (snapshot.archiveAuthorityId !== undefined || snapshot.archiveAuthoritySha256 !== undefined || snapshot.sourceBasisSha256 !== undefined) throw new BadRequestException("归档标记不能代替真实持久归档来源");
    return null;
  }
  const authority = archiveObject(archive.authoritySnapshot), basis = archiveObject(authority.sourceBasis);
  const locator = archiveObject(basis.sourceLocator), businessTime = archiveObject(basis.businessTime);
  if (!archive.confirmedAt || authority.projectId !== input.projectId || authority.contractVersionId !== versionId || locator.sourceVersion !== sourceVersion
    || snapshot.archiveAuthorityId !== archive.id || snapshot.archiveAuthoritySha256 !== archive.authoritySha256 || snapshot.sourceBasisSha256 !== authority.sourceBasisSha256
    || !sameJson(snapshot.sourceBasis, basis) || originalInstant.getTime() !== archive.confirmedAt.getTime() || businessTime.businessDay !== chinaDateOnly(archive.confirmedAt)) throw new BadRequestException("经营归属必须绑定真实归档权威及原发生时刻");
  return new Date(`${chinaDateOnly(archive.confirmedAt)}T00:00:00.000Z`);
}
function archiveObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}

function subjectColumns(subjects: OperatingFactSubjects) {
  return {
    debtorSubjectKind: subjects.debtor?.kind,
    debtorSubjectId: subjects.debtor?.id,
    creditorSubjectKind: subjects.creditor?.kind,
    creditorSubjectId: subjects.creditor?.id,
    approvedPayerSubjectKind: subjects.approvedPayer?.kind,
    approvedPayerSubjectId: subjects.approvedPayer?.id,
    actualPayerSubjectKind: subjects.actualPayer?.kind,
    actualPayerSubjectId: subjects.actualPayer?.id,
    payeeSubjectKind: subjects.payee?.kind,
    payeeSubjectId: subjects.payee?.id,
    costBearingCompanySubjectKind: subjects.costBearingCompany?.kind,
    costBearingCompanySubjectId: subjects.costBearingCompany?.id
  };
}

function sameFactSubjects(
  original: Record<keyof ReturnType<typeof subjectColumns>, string | null>,
  expected: ReturnType<typeof subjectColumns>
): boolean {
  return (Object.keys(expected) as Array<keyof typeof expected>).every(
    (key) => (original[key] ?? null) === (expected[key] ?? null)
  );
}

function toWriteResult(
  fact: { id: string; projectId: string; sourceType: string; sourceBusinessId: string },
  created: boolean,
  impactIds: string[]
): OperatingFactWriteResult {
  return {
    id: fact.id,
    projectId: fact.projectId,
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    created,
    impactIds
  };
}

function operatingFactWritePayload(data: Record<string, unknown>): Prisma.Sql {
  return Prisma.sql`
    ROW(
      ${data.id}::text,
      ${data.projectId}::text,
      ${data.sourceType}::text,
      ${data.sourceBusinessId}::text,
      ${data.sourceVersion}::integer,
      ${data.sourceBusinessCode}::text,
      ${data.occurredAt}::timestamptz,
      ${data.confirmedAt}::timestamptz,
      ${data.affiliateAssignmentId}::text,
      ${data.affiliateBusinessPartyVersionId}::text,
      ${data.affiliateNameSnapshot}::text,
      ${data.affiliateCreditCodeSnapshot}::text,
      ${data.operatingLedgerEffectiveDateSnapshot}::date,
      ${data.isBeforeOperatingLedgerEffectiveDate}::boolean,
      ${data.historicalTakeoverBatchId}::text,
      ${data.factKind}::text,
      ${data.operatingLevel}::text,
      ${data.evidenceLevel}::text,
      ${data.amountCents}::bigint,
      ${data.currencyCode}::text,
      ${data.direction}::text,
      ${data.debtorSubjectKind}::text,
      ${data.debtorSubjectId}::text,
      ${data.creditorSubjectKind}::text,
      ${data.creditorSubjectId}::text,
      ${data.approvedPayerSubjectKind}::text,
      ${data.approvedPayerSubjectId}::text,
      ${data.actualPayerSubjectKind}::text,
      ${data.actualPayerSubjectId}::text,
      ${data.payeeSubjectKind}::text,
      ${data.payeeSubjectId}::text,
      ${data.costBearingCompanySubjectKind}::text,
      ${data.costBearingCompanySubjectId}::text,
      ${jsonbWriteValue(data.subjectSnapshot)},
      ${jsonbWriteValue(data.sourceSnapshot)},
      ${jsonbWriteValue(data.basisSnapshot)},
      ${data.entryKind}::text,
      ${data.adjustsFactId}::text,
      ${data.idempotencyKey}::text,
      ${data.confirmedByUserId}::text,
      ${data.status}::text,
      ${data.paymentExecutionId}::text,
      ${data.fundExecutionId}::text,
      ${data.fundExecutionCaseId}::text
      ${data.numericProtocolVersion === 2 ? Prisma.sql`, ${data.numericProtocolVersion}::integer, ${data.amountYuan}::numeric` : Prisma.empty}
    )${data.numericProtocolVersion === 2 ? Prisma.sql`::public."OperatingLedgerFactWritePayloadV2"` : Prisma.sql`::public."OperatingLedgerFactWritePayload"`}
  `;
}

function operatingImpactWritePayload(data: Record<string, unknown>): Prisma.Sql {
  return Prisma.sql`
    ROW(
      ${data.id}::text,
      ${data.factId}::text,
      ${data.projectId}::text,
      ${data.sourceType}::text,
      ${data.sourceBusinessId}::text,
      ${data.sourceImpactKey}::text,
      ${data.idempotencyKey}::text,
      ${data.impactKind}::text,
      ${data.amountCents}::bigint,
      ${data.direction}::text,
      ${data.subjectRole}::text,
      ${data.subjectKind}::text,
      ${data.subjectId}::text,
      ${data.costCategoryCode}::text,
      ${data.fundPurpose}::text,
      ${data.description}::text,
      ${jsonbWriteValue(data.impactSnapshot)},
      ${data.paymentExecutionId}::text,
      ${data.fundExecutionId}::text,
      ${data.fundExecutionCaseId}::text,
      ${data.executionAllocationLineId}::text
      ${data.numericProtocolVersion === 2 ? Prisma.sql`, ${data.numericProtocolVersion}::integer, ${data.amountYuan}::numeric` : Prisma.empty}
    )${data.numericProtocolVersion === 2 ? Prisma.sql`::public."OperatingLedgerImpactWritePayloadV2"` : Prisma.sql`::public."OperatingLedgerImpactWritePayload"`}
  `;
}

function jsonbWriteValue(value: unknown): Prisma.Sql {
  if (value === null || value === undefined) return Prisma.sql`NULL::jsonb`;
  return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  return value.trim();
}

function validateDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestException(`${label}格式不正确`);
  }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
