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

export interface OperatingImpactInput {
  idempotencyKey: string;
  sourceImpactKey: string;
  impactKind: OperatingImpactKind;
  amountCents: bigint;
  direction: OperatingImpactDirection;
  subjectRole?: OperatingSubjectRole;
  subject?: OperatingSubjectReference;
  costCategoryCode?: PrimaryCostCategoryCode;
  fundPurpose?: string;
  description?: string;
  impactSnapshot?: Prisma.InputJsonObject;
}

export interface AppendOperatingFactInput {
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
  amountCents: bigint;
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
}

export interface AppendOperatingFactCorrectionInput extends AppendOperatingFactInput {
  adjustsFactId: string;
}

export interface OperatingFactWriteResult {
  id: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  created: boolean;
  impactIds: string[];
}

export type OperatingLedgerTransaction = Prisma.TransactionClient;
type OperatingFactWriteRow = Pick<
  OperatingFactWriteResult,
  "id" | "projectId" | "sourceType" | "sourceBusinessId"
>;

const OPERATING_FACT_KIND_SET = new Set<string>(OPERATING_FACT_KINDS);
const OPERATING_IMPACT_KIND_SET = new Set<string>(OPERATING_IMPACT_KINDS);
const OPERATING_SUBJECT_KIND_SET = new Set<string>(OPERATING_SUBJECT_KINDS);
const OPERATING_SUPPORTED_SUBJECT_KIND_SET = new Set([
  "construction_enterprise",
  "participating_company"
]);
const OPERATING_SUBJECT_ROLE_SET = new Set<string>(OPERATING_SUBJECT_ROLES);
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
  downstream_settlement: ["debtor", "creditor"],
  downstream_payment: ["actualPayer", "payee"],
  expense: ["costBearingCompany"],
  employee_loan: ["debtor", "creditor"],
  project_wage: ["costBearingCompany", "payee"],
  construction_enterprise_deduction: ["costBearingCompany"],
  invoice: ["payee"],
  fund_movement: ["actualPayer", "payee"]
};

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
    const rows = await tx.$queryRaw<OperatingFactWriteRow[]>(
      Prisma.sql`
        SELECT *
        FROM public."appendOperatingFactThroughService"(
          ${operatingFactWritePayload(data)},
          ${actorUserId},
          ${this.operatingLedgerWriteSecret()}
        )
      `
    );
    const row = rows[0];
    if (!row) throw new Error("经营账受控事实写入未返回记录");
    return row;
  }

  private async appendImpactRow(
    tx: OperatingLedgerTransaction,
    data: Record<string, unknown>,
    actorUserId: string
  ): Promise<{ id: string }> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT *
        FROM public."appendOperatingImpactThroughService"(
          ${operatingImpactWritePayload(data)},
          ${actorUserId},
          ${this.operatingLedgerWriteSecret()}
        )
      `
    );
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

  async appendCorrection(
    input: AppendOperatingFactCorrectionInput,
    actorUserId: string
  ): Promise<OperatingFactWriteResult> {
    return this.prisma.$transaction((tx) =>
      this.appendEnvelope(tx, input, actorUserId, "correction")
    );
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

  private async appendEnvelope(
    tx: OperatingLedgerTransaction,
    rawInput: AppendOperatingFactInput,
    actorUserId: string,
    entryKind: OperatingFactEntryKind
  ): Promise<OperatingFactWriteResult> {
    const input = normalizeFactInput(rawInput);
    validateFactInput(input);
    const writeScope = await this.assertWriteScope(tx, input, actorUserId);
    const subjectSnapshot = await this.factSubjectSnapshot(tx, input);

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
      assertReversalImpacts(adjustmentTarget.impacts, input.impacts);
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

    if (existing) {
      if (
        entryKind === "reversal" &&
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
          actorUserId
        );
        if (!impactIds.includes(result.id)) impactIds.push(result.id);
      }
      return toWriteResult(existing, false, impactIds);
    }
    if (
      entryKind === "reversal" &&
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
        status: "confirmed"
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
        actorUserId
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
    actorUserId: string
  ) {
    const impactSnapshot = await this.impactSnapshotWithSubject(tx, input, impact);
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

    return this.appendImpactRow(
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
        direction: impact.direction,
        subjectRole: impact.subjectRole,
        subjectKind: impact.subject?.kind,
        subjectId: impact.subject?.id,
        costCategoryCode: impact.costCategoryCode,
        fundPurpose: impact.fundPurpose,
        description: impact.description,
        impactSnapshot
      },
      actorUserId
    );
  }

  private async impactSnapshotWithSubject(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    impact: OperatingImpactInput
  ): Promise<Prisma.InputJsonObject> {
    const subjectSnapshot = await this.resolveImpactSubjectSnapshot(tx, input, impact.subject);
    const snapshot = impact.impactSnapshot ?? {};
    if (!subjectSnapshot) return snapshot;
    return { ...snapshot, subjectSnapshot };
  }

  private async factSubjectSnapshot(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput
  ): Promise<Prisma.InputJsonObject> {
    const snapshot: Record<string, unknown> = {};
    for (const [role, subject] of Object.entries(input.subjects)) {
      const subjectSnapshot = await this.resolveImpactSubjectSnapshot(
        tx,
        input,
        subject
      );
      if (subjectSnapshot) snapshot[role] = subjectSnapshot;
    }
    return snapshot as Prisma.InputJsonObject;
  }

  private async resolveImpactSubjectSnapshot(
    tx: OperatingLedgerTransaction,
    input: AppendOperatingFactInput,
    subject?: OperatingSubjectReference
  ) {
    if (!subject) return undefined;
    if (subject.kind === "construction_enterprise") {
      const assignment = await tx.projectAffiliateAssignment.findFirst({
        where: {
          id: input.affiliateAssignmentId,
          projectId: input.projectId,
          AND: [
            { effectiveFrom: { lte: input.occurredAt } },
            { OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }] }
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
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: input.projectId,
          AND: [
            { OR: [{ companyEntityId: subject.id }, { companyEntityVersionId: subject.id }] },
            { effectiveFrom: { lte: input.occurredAt } },
            { OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }] }
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
    actorUserId: string
  ): Promise<{
    effectiveDate: Date;
  }> {
    await this.assertProjectFinanceManager(tx, actorUserId, input.projectId);
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        isActive: true,
        operatingLedgerEffectiveDate: true
      }
    });
    if (requiredText(input.confirmedByUserId, "正式确认人不能为空") !== actorUserId) {
      throw new ForbiddenException("正式确认人必须是当前财务操作人");
    }
    if (!project?.isActive) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }
    if (!project.operatingLedgerEffectiveDate) {
      throw new BadRequestException("项目尚未启用经营账，不能登记正式经营事实");
    }
    const expectedBefore = dateOnly(input.occurredAt) < dateOnly(project.operatingLedgerEffectiveDate);
    if (input.isBeforeOperatingLedgerEffectiveDate !== expectedBefore) {
      throw new BadRequestException("经营事实的生效日前后属性与项目经营账生效日不一致");
    }

    const assignment = await tx.projectAffiliateAssignment.findFirst({
      where: {
        id: input.affiliateAssignmentId,
        projectId: input.projectId,
        businessPartyVersionId: input.affiliateBusinessPartyVersionId,
        AND: [
          { effectiveFrom: { lte: input.occurredAt } },
          { OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }] }
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

    for (const subject of Object.values(input.subjects)) {
      if (!subject) continue;
      if (subject.kind === "construction_enterprise") {
        if (![assignment.businessPartyId, assignment.businessPartyVersionId].includes(subject.id)) {
          throw new BadRequestException("经营事实引用的施工企业主体与项目档案不一致");
        }
        continue;
      }
      if (subject.kind !== "participating_company") continue;
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: input.projectId,
          AND: [
            { OR: [{ companyEntityId: subject.id }, { companyEntityVersionId: subject.id }] },
            { effectiveFrom: { lte: input.occurredAt } },
            { OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }] }
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
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");

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

  private async assertAdjustmentTarget(
    tx: OperatingLedgerTransaction,
    projectId: string,
    adjustsFactId: string
  ) {
    const original = await tx.operatingFact.findUnique({
      where: { id: adjustsFactId },
      include: {
        impacts: true,
        adjustments: { select: { id: true, entryKind: true } }
      }
    });
    if (!original) throw new NotFoundException("原经营事实不存在，请刷新后重试");
    if (original.projectId !== projectId) {
      throw new BadRequestException("更正或冲销只能引用同一项目的经营事实");
    }
    return original;
  }

}

function normalizeFactInput(input: AppendOperatingFactInput): AppendOperatingFactInput {
  return {
    ...input,
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
    adjustsFactId: optionalText(input.adjustsFactId)
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
  return {
    ...impact,
    idempotencyKey: requiredText(impact.idempotencyKey, "影响分录幂等键不能为空"),
    sourceImpactKey: requiredText(impact.sourceImpactKey, "来源影响键不能为空"),
    subject: normalizeSubjectReference(impact.subject, "影响分录主体不能为空"),
    fundPurpose: optionalText(impact.fundPurpose),
    description: optionalText(impact.description)
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
    amountCents: bigint;
    direction: string;
    subjectRole: string | null;
    subjectKind: string | null;
    subjectId: string | null;
    costCategoryCode: string | null;
    fundPurpose: string | null;
  }>,
  reversalImpacts: OperatingImpactInput[]
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
      originalImpact.amountCents !== reversalImpact.amountCents ||
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
  if (input.amountCents < 0n || (input.factKind !== "historical_gap" && input.amountCents === 0n)) {
    throw new BadRequestException("经营事实金额必须使用不小于零的整数分");
  }
  if (!input.sourceSnapshot || typeof input.sourceSnapshot !== "object" || Array.isArray(input.sourceSnapshot)) {
    throw new BadRequestException("经营事实必须保留来源快照");
  }
  for (const subject of Object.values(input.subjects)) {
    if (subject && !OPERATING_SUPPORTED_SUBJECT_KIND_SET.has(subject.kind)) {
      throw new BadRequestException("当前经营账尚未接入该主体种类，不能登记正式事实");
    }
  }
  for (const role of REQUIRED_FACT_SUBJECT_ROLES[input.factKind] ?? []) {
    if (!input.subjects[role]) {
      throw new BadRequestException(`事实种类${input.factKind}必须填写${role}主体`);
    }
  }
  if (!input.impacts.length) throw new BadRequestException("经营事实至少需要一笔影响分录");
  for (const impact of input.impacts) validateImpactInput(impact);
  if (input.evidenceLevel === "C" && input.impacts.some((impact) => impact.impactKind !== "evidence_gap_notice")) {
    throw new BadRequestException("C级证据只能登记缺口提示，不能产生正式经营影响");
  }
}

function validateImpactInput(impact: OperatingImpactInput) {
  requiredText(impact.idempotencyKey, "影响分录幂等键不能为空");
  requiredText(impact.sourceImpactKey, "来源影响键不能为空");
  if (!OPERATING_IMPACT_KIND_SET.has(impact.impactKind)) throw new BadRequestException("影响种类不正确");
  if (!new Set(["increase", "decrease", "notice"]).has(impact.direction)) {
    throw new BadRequestException("影响分录方向不正确");
  }
  if (impact.amountCents < 0n || (impact.impactKind !== "evidence_gap_notice" && impact.amountCents === 0n)) {
    throw new BadRequestException("影响分录金额必须使用不小于零的整数分");
  }
  if (impact.impactKind === "evidence_gap_notice" && impact.direction !== "notice") {
    throw new BadRequestException("C级缺口提示必须使用notice方向");
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
  if (impact.impactSnapshot !== undefined &&
      (typeof impact.impactSnapshot !== "object" || impact.impactSnapshot === null || Array.isArray(impact.impactSnapshot))) {
    throw new BadRequestException("影响分录快照格式不正确");
  }
  if (impact.costCategoryCode && !PRIMARY_COST_CATEGORY_SET.has(impact.costCategoryCode)) {
    throw new BadRequestException("影响分录成本分类不正确");
  }
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
    amountCents: bigint;
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
    existing.amountCents === input.amountCents,
    existing.currencyCode === input.currencyCode,
    existing.direction === input.direction,
    existing.entryKind === entryKind,
    existing.adjustsFactId === (entryKind === "original" ? null : input.adjustsFactId),
    existing.confirmedByUserId === input.confirmedByUserId,
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
    amountCents: bigint;
    direction: string;
    subjectRole: string | null;
    subjectKind: string | null;
    subjectId: string | null;
    costCategoryCode: string | null;
    fundPurpose: string | null;
    description: string | null;
    impactSnapshot: Prisma.JsonValue;
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
    existing.amountCents !== impact.amountCents ||
    existing.direction !== impact.direction ||
    (existing.subjectRole ?? null) !== (impact.subjectRole ?? null) ||
    (existing.subjectKind ?? null) !== (impact.subject?.kind ?? null) ||
    (existing.subjectId ?? null) !== (impact.subject?.id ?? null) ||
    (existing.costCategoryCode ?? null) !== (impact.costCategoryCode ?? null) ||
    (existing.fundPurpose ?? null) !== (impact.fundPurpose ?? null) ||
    (existing.description ?? null) !== (impact.description ?? null) ||
    !sameJson(existing.impactSnapshot, impactSnapshot)
  ) {
    throw new BadRequestException("同一来源影响键已登记不同分录，不能覆盖原分录");
  }
}

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
      ${data.status}::text
    )::public."OperatingLedgerFactWritePayload"
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
      ${jsonbWriteValue(data.impactSnapshot)}
    )::public."OperatingLedgerImpactWritePayload"
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
