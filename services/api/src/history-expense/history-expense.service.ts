import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { canPerform, type BusinessAction } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import type { BoundedXlsxUpload } from "../file/bounded-xlsx";
import { exportHistoryExpenseTemplate, parseHistoryExpenseExcel } from "./history-expense-excel";
import {
  type AppendOperatingFactInput,
  type OperatingFactWriteResult,
  type OperatingImpactInput,
  OperatingLedgerService,
  type OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import {
  HISTORY_EXPENSE_PAYMENT_STATUSES,
  HISTORY_EXPENSE_PAYMENT_STATUS_LABELS,
  HISTORY_EXPENSE_REVIEW_OUTCOME_LABELS,
  HISTORY_EXPENSE_CORRECTION_SOURCE_TYPE,
  HISTORY_EXPENSE_SCENE_KEY,
  HISTORY_EXPENSE_SOURCE_TYPE,
  historyExpenseHasBlockingIssue,
  historyExpenseImportFingerprint,
  isHistoryExpenseReviewOutcome,
  normalizeHistoryExpenseRow,
  summarizeHistoryExpenseRows,
  type HistoryExpenseIssue,
  type HistoryExpensePaymentStatus,
  type HistoryExpenseSummary,
  type NormalizedHistoryExpenseRow
} from "./history-expense.domain";
import {
  type ActivateHistoryExpenseDto,
  type ConfirmHistoryExpenseDto,
  type CorrectHistoryExpenseRowDto,
  type CreateHistoryExpenseBatchDto,
  type PrecheckHistoryExpenseDto,
  type VerifyHistoryExpenseRowDto
} from "./dto/history-expense.dto";
import {
  canonicalize,
  fingerprint,
  parseAmountCents,
  textValue
} from "../operating-takeover/operating-takeover.utils";

type Tx = Prisma.TransactionClient;

const HISTORY_EXPENSE_PROFESSION = "finance";

export interface HistoryExpensePrecheckRow extends NormalizedHistoryExpenseRow {
  rowNo: number;
  duplicateStatus: "none" | "suspected" | "confirmed";
  duplicateNote: string | null;
  issues: HistoryExpenseIssue[];
}

export interface HistoryExpensePrecheckResult {
  rows: HistoryExpensePrecheckRow[];
  summary: HistoryExpenseSummary;
  zeroWrites: boolean;
  importFingerprint: string;
  blockingRows: number;
  warningRows: number;
  batchStatusCounts: Record<string, number>;
}

export interface HistoryExpenseBatchRowView {
  id: string;
  rowNo: number;
  businessRef: string | null;
  occurredAt: string | null;
  amountCents: string | null;
  paymentStatus: HistoryExpensePaymentStatus;
  paymentStatusLabel: string;
  paidAmountCents: string | null;
  costCategoryCode: string | null;
  reviewStatus: string;
  reviewStatusLabel: string;
  reviewConclusion: string | null;
  duplicateStatus: string;
  duplicateNote: string | null;
  revision: number;
  generatedFactId: string | null;
  values: Record<string, unknown>;
  issues: HistoryExpenseIssue[];
}

export interface HistoryExpenseBatchView {
  id: string;
  projectId: string;
  batchNo: string;
  sourceFileId: string | null;
  sourceFileName: string | null;
  status: string;
  statusLabel: string;
  revision: number;
  importFingerprint: string;
  totalRows: number;
  activatedRows: number;
  pendingRows: number;
  verifiedRows: number;
  createdAt: string | null;
  activatedAt: string | null;
  summary: HistoryExpenseSummary;
  confirmation: { confirmedAt: string; confirmedByUserId: string; revision: number } | null;
  canVerify: boolean;
  canConfirm: boolean;
  canActivate: boolean;
  canCorrect: boolean;
  rows: HistoryExpenseBatchRowView[];
}

export interface HistoryExpenseLedgerPort {
  replayFromSourceInTransaction(
    tx: Tx,
    input: AppendOperatingFactInput,
    actorUserId: string,
    entryKind?: "original" | "correction" | "reversal"
  ): Promise<OperatingFactWriteResult>;
}

const BATCH_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  under_review: "待核实/复核",
  partially_activated: "部分入账",
  activated: "已入账"
};

const ROW_STATUS_LABELS: Record<string, string> = {
  pending: "待核对",
  verified: "已核实待入账",
  not_occurred: "未发生",
  activated: "已入账"
};

@Injectable()
export class HistoryExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ProjectVisibilityService,
    private readonly audit: AuditService,
    private readonly ledger: OperatingLedgerService
  ) {}

  async capability(projectId: string, actorUserId: string) {
    const roles = await this.roles(projectId, actorUserId);
    return {
      projectId,
      paymentStatuses: HISTORY_EXPENSE_PAYMENT_STATUSES.map((value) => ({
        value,
        label: HISTORY_EXPENSE_PAYMENT_STATUS_LABELS[value]
      })),
      reviewOutcomes: (["verified", "pending", "not_occurred"] as const).map((value) => ({
        value,
        label: HISTORY_EXPENSE_REVIEW_OUTCOME_LABELS[value]
      })),
      actions: {
        manage: canPerform("history_expense.manage", roles),
        verify: canPerform("history_expense.verify", roles),
        confirm: canPerform("history_expense.confirm", roles),
        activate: canPerform("history_expense.activate", roles),
        correct: canPerform("history_expense.correct", roles)
      }
    };
  }

  async excelTemplate(projectId: string, actorUserId: string) {
    await this.authorize(projectId, actorUserId, "history_expense.manage");
    return exportHistoryExpenseTemplate();
  }

  async precheckExcel(projectId: string, actorUserId: string, file: BoundedXlsxUpload) {
    await this.authorize(projectId, actorUserId, "history_expense.manage");
    const parsed = await parseHistoryExpenseExcel(file);
    return {
      ...parsed,
      precheck: await this.precheckRows(projectId, { rows: parsed.rows })
    };
  }

  async precheck(
    projectId: string,
    actorUserId: string,
    input: PrecheckHistoryExpenseDto
  ): Promise<HistoryExpensePrecheckResult> {
    await this.authorize(projectId, actorUserId, "history_expense.manage");
    return this.precheckRows(projectId, input);
  }

  private async precheckRows(
    projectId: string,
    input: PrecheckHistoryExpenseDto
  ): Promise<HistoryExpensePrecheckResult> {
    const rows = this.inputRows(input);
    const project = await this.project(projectId);
    const existing = await this.existingRows(projectId);
    const checked = await this.evaluateRows(rows, existing, project.operatingLedgerEffectiveDate);
    return {
      ...checked,
      zeroWrites: true,
      batchStatusCounts: {}
    };
  }

  async createBatch(
    projectId: string,
    actorUserId: string,
    input: CreateHistoryExpenseBatchDto
  ): Promise<HistoryExpenseBatchView & { idempotent: boolean }> {
    await this.authorize(projectId, actorUserId, "history_expense.manage");
    const project = await this.project(projectId);
    const rows = this.inputRows(input);
    if (!rows.length) throw new BadRequestException("历史费用批次至少需要一行");
    const existing = await this.existingRows(projectId);
    const checked = await this.evaluateRows(rows, existing, project.operatingLedgerEffectiveDate);
    const importFingerprint = checked.importFingerprint;
    const existingBatch = await this.prisma.operatingTakeoverBatch.findFirst({
      where: { projectId, importFingerprint },
      select: { id: true }
    });
    if (existingBatch) {
      return { ...(await this.detail(projectId, existingBatch.id, actorUserId)), idempotent: true };
    }
    if (checked.blockingRows > 0) {
      throw new BadRequestException({
        message: "历史费用预检存在阻断项，不能生成草稿",
        summary: checked.summary,
        rows: checked.rows.filter((row) => historyExpenseHasBlockingIssue(row))
      });
    }
    const batchId = randomUUID();
    const batchNo =
      textValue(input.batchNo) ??
      `LSFY-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const sourceFileName = input.sourceFileId
      ? (
          await this.prisma.fileObject.findUnique({
            where: { id: input.sourceFileId },
            select: { originalName: true }
          })
        )?.originalName
      : null;
    if (input.sourceFileId && !sourceFileName) {
      throw new BadRequestException("来源文件不存在或已被移除");
    }
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "isActive" = true FOR UPDATE`
          );
          if (!locked.length) throw new BadRequestException("项目不存在或已停用，不能新增历史费用批次");
          const created = await tx.operatingTakeoverBatch.create({
            data: {
              id: batchId,
              projectId,
              batchNo,
              sourceFileId: input.sourceFileId ?? null,
              sourceFileName,
              sceneKeys: [HISTORY_EXPENSE_SCENE_KEY] as unknown as Prisma.InputJsonValue,
              status: "under_review",
              revision: 1,
              importFingerprint,
              totalRows: checked.rows.length,
              readyRows: checked.rows.filter((row) => !historyExpenseHasBlockingIssue(row)).length,
              blockedRows: checked.blockingRows,
              warningRows: checked.warningRows,
              createdByUserId: actorUserId
            }
          });
          for (const row of checked.rows) {
            const rowId = randomUUID();
            await tx.operatingTakeoverRow.create({
              data: {
                id: rowId,
                batchId: created.id,
                rowNo: row.rowNo,
                sceneKey: HISTORY_EXPENSE_SCENE_KEY,
                definitionVersion: 1,
                businessRef: row.businessRef,
                occurredAt: row.occurredAt,
                amountCents: row.amountCents,
                valuesSnapshot: row.values as Prisma.InputJsonObject,
                evidenceLevel: "B",
                reviewStatus: "pending",
                duplicateStatus: row.duplicateStatus,
                duplicateNote: row.duplicateNote
              }
            });
            for (const issue of row.issues) {
              await tx.operatingTakeoverIssue.create({
                data: {
                  batchId: created.id,
                  rowId,
                  code: issue.code,
                  severity: issue.severity,
                  fieldKey: issue.fieldKey ?? null,
                  message: issue.message,
                  suggestion: null
                }
              });
            }
          }
          await this.audit.record(tx, {
            actorUserId,
            action: "history_expense.batch.create",
            businessType: "operating_takeover_batch",
            businessId: created.id,
            metadata: {
              projectId,
              importFingerprint,
              totalRows: checked.rows.length,
              zeroWritesBeforeCreate: true
            }
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.prisma.operatingTakeoverBatch.findFirst({
          where: { projectId, importFingerprint },
          select: { id: true }
        });
        if (raced) {
          return { ...(await this.detail(projectId, raced.id, actorUserId)), idempotent: true };
        }
      }
      throw error;
    }
    return { ...(await this.detail(projectId, batchId, actorUserId)), idempotent: false };
  }

  async list(projectId: string, actorUserId: string) {
    await this.roles(projectId, actorUserId);
    const batches = await this.prisma.operatingTakeoverBatch.findMany({
      where: { projectId, sceneKeys: { array_contains: [HISTORY_EXPENSE_SCENE_KEY] } },
      orderBy: { createdAt: "desc" },
      include: { rows: { select: { reviewStatus: true, generatedFactId: true } }, activation: true }
    });
    return batches.map((batch) => ({
      id: batch.id,
      batchNo: batch.batchNo,
      status: batch.status,
      statusLabel: BATCH_STATUS_LABELS[batch.status] ?? batch.status,
      revision: batch.revision,
      totalRows: batch.totalRows,
      activatedRows: batch.rows.filter((row) => row.generatedFactId).length,
      pendingRows: batch.rows.filter((row) => row.reviewStatus === "pending").length,
      createdAt: batch.createdAt?.toISOString() ?? null,
      activatedAt: batch.activatedAt?.toISOString() ?? null
    }));
  }

  async detail(projectId: string, batchId: string, actorUserId: string): Promise<HistoryExpenseBatchView> {
    const roles = await this.roles(projectId, actorUserId);
    const batch = await this.prisma.operatingTakeoverBatch.findFirst({
      where: { id: batchId, projectId, sceneKeys: { array_contains: [HISTORY_EXPENSE_SCENE_KEY] } },
      include: {
        rows: { orderBy: { rowNo: "asc" }, include: { issues: { where: { status: "open" } } } },
        confirmations: { orderBy: { confirmedAt: "desc" }, take: 1 },
        activation: true
      }
    });
    if (!batch) throw new NotFoundException("历史费用批次不存在，请刷新后重试");
    const rows = batch.rows.map((row) => this.serializeRow(row));
    const summary = summarizeHistoryExpenseRows(
      rows.map((row) => ({
        reviewStatus: row.reviewStatus,
        posted: row.generatedFactId !== null,
        amountCents: BigInt(row.amountCents ?? "0"),
        paidCents: row.paidAmountCents === null ? null : BigInt(row.paidAmountCents),
        paymentStatus: row.paymentStatus,
        costCategoryCode: row.costCategoryCode
      }))
    );
    const confirmation = batch.confirmations[0] ?? null;
    const unpostedRows = batch.rows.filter((row) => !row.generatedFactId);
    const latestConfirmationMatches =
      confirmation !== null &&
      snapshotFingerprint(confirmation.snapshot) === this.unpostedFingerprint(unpostedRows);
    return {
      id: batch.id,
      projectId: batch.projectId,
      batchNo: batch.batchNo,
      sourceFileId: batch.sourceFileId,
      sourceFileName: batch.sourceFileName,
      status: batch.status,
      statusLabel: BATCH_STATUS_LABELS[batch.status] ?? batch.status,
      revision: batch.revision,
      importFingerprint: batch.importFingerprint,
      totalRows: batch.totalRows,
      activatedRows: batch.rows.filter((row) => row.generatedFactId).length,
      pendingRows: batch.rows.filter((row) => row.reviewStatus === "pending").length,
      verifiedRows: batch.rows.filter((row) => row.reviewStatus === "verified").length,
      createdAt: batch.createdAt?.toISOString() ?? null,
      activatedAt: batch.activatedAt?.toISOString() ?? null,
      summary,
      confirmation: confirmation
        ? {
            confirmedAt: confirmation.confirmedAt.toISOString(),
            confirmedByUserId: confirmation.confirmedByUserId,
            revision: confirmation.revision
          }
        : null,
      canVerify: canPerform("history_expense.verify", roles),
      canConfirm:
        canPerform("history_expense.confirm", roles) &&
        batch.status !== "activated" &&
        batch.rows.some((row) => row.reviewStatus === "verified" && !row.generatedFactId),
      canActivate:
        canPerform("history_expense.activate", roles) &&
        batch.status !== "activated" &&
        latestConfirmationMatches &&
        batch.rows.some((row) => row.reviewStatus === "verified" && !row.generatedFactId),
      canCorrect: canPerform("history_expense.correct", roles),
      rows
    };
  }

  async verifyRow(
    projectId: string,
    batchId: string,
    rowId: string,
    actorUserId: string,
    input: VerifyHistoryExpenseRowDto
  ): Promise<HistoryExpenseBatchView> {
    await this.authorize(projectId, actorUserId, "history_expense.verify");
    if (!isHistoryExpenseReviewOutcome(input.reviewOutcome)) {
      throw new BadRequestException("核实结论不正确");
    }
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockBatch(tx, projectId, batchId);
        const batch = await tx.operatingTakeoverBatch.findFirstOrThrow({
          where: { id: batchId, projectId },
          include: { rows: true }
        });
        if (batch.status === "activated") {
          throw new ConflictException("批次已全部入账，已入账事实不可改；更正请走反转+重登");
        }
        const row = batch.rows.find((item) => item.id === rowId);
        if (!row) throw new NotFoundException("历史费用行不存在，请刷新后重试");
        if (row.generatedFactId) {
          throw new ConflictException("该行已入账，已入账事实不可改；更正请走反转+重登");
        }
        if (row.revision !== input.expectedRevision) {
          throw new ConflictException("历史费用行版本已变化，请刷新后重试");
        }
        const previousValues = row.valuesSnapshot as Record<string, unknown>;
        const previousHistory = Array.isArray(previousValues._history)
          ? (previousValues._history as unknown[])
          : [];
        const historyEntry = {
          at: new Date().toISOString(),
          byUserId: actorUserId,
          reviewStatus: row.reviewStatus,
          reviewConclusion: row.reviewConclusion,
          values: previousValues
        };
        const mergedValues = {
          ...previousValues,
          ...(input.values ?? {})
        };
        const normalized = normalizeHistoryExpenseRow(mergedValues, {
          today: new Date().toISOString().slice(0, 10)
        });
        const valuesForStorage = {
          ...normalized.values,
          _history: [...previousHistory, historyEntry]
        };
        const blocking = normalized.issues.filter((entry) => entry.severity === "error");
        if (input.reviewOutcome === "verified") {
          if (blocking.length) {
            throw new BadRequestException({
              message: "该行仍有未核对字段，不能标记为已核实",
              issues: blocking
            });
          }
          if (normalized.amountCents <= 0n) {
            throw new BadRequestException("金额为0的行请标记未发生；未发生费用不入账");
          }
          if (!textValue(mergedValues.costBearingCompanyName)) {
            if (!row.occurredAt) throw new BadRequestException("请先填写发生日期");
            const participants = await tx.projectParticipatingCompany.findMany({
              where: {
                projectId,
                effectiveFrom: { lte: row.occurredAt },
                OR: [{ endedAt: null }, { endedAt: { gt: row.occurredAt } }]
              },
              select: { companyEntityId: true }
            });
            if (participants.length !== 1) {
              throw new BadRequestException("请先核对成本承担公司，再标记已核实");
            }
          }
        }
        if (input.reviewOutcome === "not_occurred") {
          if (normalized.amountCents !== 0n) {
            throw new BadRequestException("标记未发生必须填写0金额，不能把未知金额当作未发生");
          }
          if (!textValue(input.note)) {
            throw new BadRequestException("标记未发生请填写核实说明");
          }
        }
        if (input.reviewOutcome === "pending" && !textValue(input.note)) {
          throw new BadRequestException("保存待核对请填写待核对原因");
        }
        const updated = await tx.operatingTakeoverRow.updateMany({
          where: { id: rowId, batchId, revision: input.expectedRevision },
          data: {
            businessRef: normalized.businessRef,
            occurredAt: normalized.occurredAt,
            amountCents: normalized.amountCents,
            valuesSnapshot: valuesForStorage as Prisma.InputJsonObject,
            reviewStatus: input.reviewOutcome,
            reviewConclusion: textValue(input.note) ?? null,
            revision: { increment: 1 }
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("历史费用行版本已变化，请刷新后重试");
        }
        await tx.operatingTakeoverIssue.deleteMany({ where: { rowId, status: "open" } });
        for (const entry of normalized.issues) {
          await tx.operatingTakeoverIssue.create({
            data: {
              batchId,
              rowId,
              code: entry.code,
              severity: entry.severity,
              fieldKey: entry.fieldKey ?? null,
              message: entry.message
            }
          });
        }
        await this.refreshBatchCounts(tx, batchId);
        await this.audit.record(tx, {
          actorUserId,
          action: "history_expense.row.verify",
          businessType: "operating_takeover_row",
          businessId: rowId,
          metadata: {
            batchId,
            projectId,
            outcome: input.reviewOutcome,
            note: textValue(input.note) ?? null,
            expectedRevision: input.expectedRevision
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return this.detail(projectId, batchId, actorUserId);
  }

  async correctRow(
    projectId: string,
    batchId: string,
    rowId: string,
    actorUserId: string,
    input: CorrectHistoryExpenseRowDto
  ): Promise<HistoryExpenseBatchView> {
    await this.authorize(projectId, actorUserId, "history_expense.correct");
    const reason = textValue(input.reason) ?? "";
    if (!reason) throw new BadRequestException("更正已入账历史费用必须填写原因");
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockBatch(tx, projectId, batchId);
        const batch = await tx.operatingTakeoverBatch.findFirstOrThrow({
          where: { id: batchId, projectId },
          include: { rows: { orderBy: { rowNo: "asc" } } }
        });
        const original = batch.rows.find((row) => row.id === rowId);
        if (!original) throw new NotFoundException("历史费用行不存在，请刷新后重试");
        if (!original.generatedFactId) {
          throw new ConflictException("只有已入账行才能更正；待核对或未发生行请直接补资料后核实");
        }
        if (original.revision !== input.expectedRevision) {
          throw new ConflictException("历史费用行版本已变化，请刷新后重试");
        }
        const alreadyCorrected = batch.rows.find((row) => {
          const values = row.valuesSnapshot as Record<string, unknown>;
          const correction = correctionMeta(values);
          return correction?.originalRowId === original.id && row.generatedFactId !== null;
        });
        if (alreadyCorrected) {
          throw new ConflictException("该行已经更正过，请刷新后查看更正行，勿重复更正");
        }
        const project = await tx.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { operatingLedgerEffectiveDate: true, isActive: true }
        });
        if (!project.isActive) throw new BadRequestException("项目已停用，不能更正历史费用");
        if (!project.operatingLedgerEffectiveDate) {
          throw new BadRequestException("项目尚未设置经营账生效日期，不能更正历史费用");
        }
        if (!original.occurredAt || !original.amountCents || original.amountCents <= 0n) {
          throw new ConflictException("原历史费用行缺少有效发生日期或金额，不能更正");
        }
        const correctedValues = {
          ...(original.valuesSnapshot as Record<string, unknown>),
          ...input.values
        };
        const normalized = normalizeHistoryExpenseRow(correctedValues, {
          today: new Date().toISOString().slice(0, 10)
        });
        const blocking = normalized.issues.filter((entry) => entry.severity === "error");
        if (blocking.length) {
          throw new BadRequestException({
            message: "更正后的历史费用仍未通过核对，不能入账",
            issues: blocking
          });
        }
        if (normalized.amountCents <= 0n) {
          throw new BadRequestException("更正后的金额必须大于0；费用未发生请走待核对/未发生说明");
        }
        if (normalized.occurredAt >= project.operatingLedgerEffectiveDate) {
          throw new BadRequestException("更正后的发生日期不在经营账启用日前，不能作为历史费用入账");
        }
        const now = new Date();
        const newRowNo = Math.max(...batch.rows.map((row) => row.rowNo)) + 1;
        const newRowId = randomUUID();
        const storedValues = {
          ...normalized.values,
          _correction: {
            originalRowId: original.id,
            originalRowNo: original.rowNo,
            originalFactId: original.generatedFactId,
            originalAmountCents: original.amountCents.toString(),
            reason,
            correctedAt: now.toISOString(),
            correctedByUserId: actorUserId
          }
        };
        await tx.operatingTakeoverRow.create({
          data: {
            id: newRowId,
            batchId,
            rowNo: newRowNo,
            sceneKey: HISTORY_EXPENSE_SCENE_KEY,
            definitionVersion: 1,
            businessRef: normalized.businessRef,
            occurredAt: normalized.occurredAt,
            amountCents: normalized.amountCents,
            valuesSnapshot: storedValues as Prisma.InputJsonObject,
            evidenceLevel: "B",
            reviewStatus: "activated",
            reviewConclusion: `更正原行 #${original.rowNo}：${reason}`,
            duplicateStatus: "none"
          }
        });

        const originalValues = original.valuesSnapshot as Record<string, unknown>;
        const originalCompany = await this.resolveCostBearingCompany(
          tx,
          projectId,
          original.occurredAt,
          textValue(originalValues.costBearingCompanyName) ?? null
        );
        const originalPayeeName = textValue(originalValues.payeeName);
        const originalPayee = originalPayeeName
          ? await tx.businessParty.findFirst({
              where: { name: originalPayeeName, status: "active" },
              select: { id: true }
            })
          : null;
        if (originalPayeeName && !originalPayee) {
          throw new BadRequestException(`原行未找到有效收款方：${originalPayeeName}`);
        }
        const reversalAssignment = await tx.projectAffiliateAssignment.findFirst({
          where: {
            projectId,
            effectiveFrom: { lte: original.occurredAt },
            OR: [{ endedAt: null }, { endedAt: { gt: original.occurredAt } }]
          },
          orderBy: { effectiveFrom: "desc" }
        });
        if (!reversalAssignment) {
          throw new BadRequestException("原行事实日没有有效的施工企业档案，不能更正");
        }
        const reversalImpactKeys = `${HISTORY_EXPENSE_CORRECTION_SOURCE_TYPE}:reversal:${newRowId}`;
        const reversalImpacts = this.impactInputsFor({
          rowId: original.id,
          amountCents: original.amountCents,
          values: originalValues,
          costBearingCompany: originalCompany,
          payee: originalPayee,
          payerCompanyName: textValue(originalValues.payerCompanyName) ?? null,
          keyPrefix: reversalImpactKeys,
          reverse: true
        });
        const reversalInput: AppendOperatingFactInput = {
          projectId,
          sourceType: HISTORY_EXPENSE_CORRECTION_SOURCE_TYPE,
          sourceBusinessId: `${original.id}:correction:${newRowNo}:reversal`,
          sourceBusinessCode: `${batch.batchNo}-${newRowNo}-冲销`,
          sourceVersion: original.revision + 1,
          idempotencyKey: `${HISTORY_EXPENSE_CORRECTION_SOURCE_TYPE}:${original.id}:${original.revision}:reversal:${newRowNo}`,
          occurredAt: original.occurredAt,
          confirmedAt: now,
          confirmedByUserId: actorUserId,
          factKind: "expense",
          operatingLevel: "project",
          evidenceLevel: "B",
          amountCents: original.amountCents,
          currencyCode: "CNY",
          direction: "inflow",
          isBeforeOperatingLedgerEffectiveDate: true,
          affiliateAssignmentId: reversalAssignment.id,
          affiliateBusinessPartyVersionId: reversalAssignment.businessPartyVersionId,
          affiliateNameSnapshot: reversalAssignment.affiliateNameSnapshot,
          affiliateCreditCodeSnapshot: reversalAssignment.affiliateCreditCodeSnapshot ?? undefined,
          historicalTakeoverBatchId: batchId,
          sourceSnapshot: {
            batchId,
            batchNo: batch.batchNo,
            sceneKey: HISTORY_EXPENSE_SCENE_KEY,
            correction: {
              originalRowId: original.id,
              originalRowNo: original.rowNo,
              originalFactId: original.generatedFactId,
              reason,
              correctedRowId: newRowId,
              correctedRowNo: newRowNo
            },
            originalValues: canonicalize(originalValues) as Prisma.InputJsonObject
          },
          subjects: { costBearingCompany: originalCompany },
          impacts: reversalImpacts,
          adjustsFactId: original.generatedFactId
        };
        await this.ledger.replayFromSourceInTransaction(
          tx,
          reversalInput,
          actorUserId,
          "reversal"
        );

        const repostRow = {
          id: newRowId,
          rowNo: newRowNo,
          occurredAt: normalized.occurredAt,
          amountCents: normalized.amountCents,
          revision: 1,
          valuesSnapshot: storedValues as Prisma.JsonValue
        };
        const repostInput = await this.factInput(
          tx,
          projectId,
          batch,
          repostRow,
          { confirmedAt: now, confirmedByUserId: actorUserId },
          project.operatingLedgerEffectiveDate
        );
        const repostFact = await this.ledger.replayFromSourceInTransaction(
          tx,
          repostInput,
          actorUserId,
          "original"
        );
        await tx.operatingTakeoverRow.update({
          where: { id: newRowId },
          data: { generatedFactId: repostFact.id }
        });
        await this.refreshBatchCounts(tx, batchId);
        const remaining = await tx.operatingTakeoverRow.count({
          where: { batchId, generatedFactId: null, reviewStatus: { in: ["pending", "verified"] } }
        });
        if (remaining === 0) {
          await tx.operatingTakeoverBatch.update({
            where: { id: batchId },
            data: { status: "activated", activatedAt: now, activatedByUserId: actorUserId }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "history_expense.row.correct",
          businessType: "operating_takeover_row",
          businessId: original.id,
          metadata: {
            batchId,
            projectId,
            originalFactId: original.generatedFactId,
            correctedRowId: newRowId,
            correctedRowNo: newRowNo,
            originalAmountCents: original.amountCents.toString(),
            correctedAmountCents: normalized.amountCents.toString(),
            deltaCents: (normalized.amountCents - original.amountCents).toString(),
            reason
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return this.detail(projectId, batchId, actorUserId);
  }

  async confirm(
    projectId: string,
    batchId: string,
    actorUserId: string,
    input: ConfirmHistoryExpenseDto
  ): Promise<{ idempotencyKey: string; batchId: string; revision: number; confirmedAt: string }> {
    await this.authorize(projectId, actorUserId, "history_expense.confirm");
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockBatch(tx, projectId, batchId);
        const replay = await tx.operatingTakeoverConfirmation.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (replay) {
          if (replay.batchId !== batchId) {
            throw new ConflictException("复核幂等键已用于其他批次");
          }
          return {
            idempotencyKey: replay.idempotencyKey,
            batchId: replay.batchId,
            revision: replay.revision,
            confirmedAt: replay.confirmedAt.toISOString()
          };
        }
        const batch = await tx.operatingTakeoverBatch.findFirstOrThrow({
          where: { id: batchId, projectId },
          include: { rows: { orderBy: { rowNo: "asc" } } }
        });
        if (batch.revision !== input.expectedRevision) {
          throw new ConflictException("历史费用批次版本已变化，请刷新后再复核");
        }
        if (batch.status === "activated") {
          throw new ConflictException("批次已全部入账，不能重复复核");
        }
        const unposted = batch.rows.filter((row) => !row.generatedFactId);
        if (!unposted.some((row) => row.reviewStatus === "verified")) {
          throw new BadRequestException("请先逐行核实，至少一行标记为已核实后才能提交主管复核");
        }
        const sameRevision = await tx.operatingTakeoverConfirmation.findUnique({
          where: {
            batchId_profession_revision: {
              batchId,
              profession: HISTORY_EXPENSE_PROFESSION,
              revision: batch.revision
            }
          }
        });
        if (sameRevision) throw new ConflictException("该版本已经复核，请勿重复提交");
        const confirmation = await tx.operatingTakeoverConfirmation.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            batchId,
            profession: HISTORY_EXPENSE_PROFESSION,
            revision: batch.revision,
            confirmedByUserId: actorUserId,
            snapshot: {
              fingerprint: this.unpostedFingerprint(unposted),
              rowCount: unposted.length,
              pendingRowIds: unposted.filter((row) => row.reviewStatus === "pending").map((row) => row.id),
              verifiedRowIds: unposted.filter((row) => row.reviewStatus === "verified").map((row) => row.id)
            }
          }
        });
        await tx.operatingTakeoverBatch.update({
          where: { id: batchId },
          data: { revision: { increment: 1 }, status: "under_review" }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "history_expense.confirm",
          businessType: "operating_takeover_batch",
          businessId: batchId,
          metadata: {
            projectId,
            revision: batch.revision,
            pendingRows: unposted.filter((row) => row.reviewStatus === "pending").length,
            verifiedRows: unposted.filter((row) => row.reviewStatus === "verified").length,
            note: textValue(input.note) ?? null
          }
        });
        return {
          idempotencyKey: confirmation.idempotencyKey,
          batchId: confirmation.batchId,
          revision: confirmation.revision,
          confirmedAt: confirmation.confirmedAt.toISOString()
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async activate(
    projectId: string,
    batchId: string,
    actorUserId: string,
    input: ActivateHistoryExpenseDto
  ): Promise<HistoryExpenseBatchView> {
    await this.authorize(projectId, actorUserId, "history_expense.activate");
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockBatch(tx, projectId, batchId);
        const batch = await tx.operatingTakeoverBatch.findFirstOrThrow({
          where: { id: batchId, projectId },
          include: {
            rows: { orderBy: { rowNo: "asc" } },
            confirmations: { orderBy: { confirmedAt: "desc" }, take: 1 },
            activation: true
          }
        });
        if (batch.revision !== input.expectedRevision) {
          throw new ConflictException("历史费用批次版本已变化，请刷新后再入账");
        }
        const unposted = batch.rows.filter((row) => !row.generatedFactId);
        const verified = unposted.filter((row) => row.reviewStatus === "verified");
        const pending = unposted.filter((row) => row.reviewStatus === "pending");
        if (!verified.length && pending.length) {
          if (batch.activation) return;
          throw new BadRequestException("没有已核实待入账的行");
        }
        const confirmation = batch.confirmations[0];
        if (
          verified.length &&
          (!confirmation ||
            snapshotFingerprint(confirmation.snapshot) !== this.unpostedFingerprint(unposted))
        ) {
          throw new BadRequestException("主管复核后行内容已变化，请主管重新复核再入账");
        }
        const project = await tx.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { id: true, operatingLedgerEffectiveDate: true, takeoverStatus: true, isActive: true }
        });
        if (!project.isActive) throw new BadRequestException("项目已停用，不能入账");
        if (!project.operatingLedgerEffectiveDate) {
          throw new BadRequestException("项目尚未设置经营账生效日期，不能入账历史费用");
        }
        const generatedFactIds: string[] = [];
        for (const row of verified) {
          if (!row.occurredAt) throw new BadRequestException(`第 ${row.rowNo} 行缺少发生日期，不能入账`);
          if (row.occurredAt >= project.operatingLedgerEffectiveDate) {
            throw new BadRequestException(
              `第 ${row.rowNo} 行发生日期不在经营账启用日前，历史费用请按实际日期录入或走正式费用流程`
            );
          }
          const mapped = await this.factInput(
            tx,
            projectId,
            batch,
            row,
            confirmation,
            project.operatingLedgerEffectiveDate
          );
          const fact = await this.ledger.replayFromSourceInTransaction(
            tx,
            mapped,
            actorUserId,
            "original"
          );
          generatedFactIds.push(fact.id);
          await tx.operatingTakeoverRow.update({
            where: { id: row.id },
            data: { reviewStatus: "activated", generatedFactId: fact.id }
          });
        }
        const remaining = await tx.operatingTakeoverRow.count({
          where: { batchId, generatedFactId: null, reviewStatus: { in: ["pending", "verified"] } }
        });
        const allRows = await tx.operatingTakeoverRow.findMany({
          where: { batchId },
          select: { id: true, generatedFactId: true, reviewStatus: true }
        });
        const activation = batch.activation;
        const activationStatus = remaining === 0 ? "activated" : "partially_activated";
        if (activation) {
          await tx.operatingTakeoverActivation.update({
            where: { batchId },
            data: {
              revision: batch.revision,
              status: activationStatus,
              generatedFactIds: [
                ...((activation.generatedFactIds as string[]) ?? []),
                ...generatedFactIds
              ] as unknown as Prisma.InputJsonValue,
              gapRowIds: allRows
                .filter((row) => row.generatedFactId === null && row.reviewStatus === "not_occurred")
                .map((row) => row.id) as unknown as Prisma.InputJsonValue,
              activatedByUserId: actorUserId,
              activatedAt: new Date()
            }
          });
        } else {
          await tx.operatingTakeoverActivation.create({
            data: {
              idempotencyKey: `history-expense-activation:${batchId}`,
              batchId,
              revision: batch.revision,
              status: activationStatus,
              generatedFactIds: generatedFactIds as unknown as Prisma.InputJsonValue,
              gapRowIds: allRows
                .filter((row) => row.generatedFactId === null && row.reviewStatus === "not_occurred")
                .map((row) => row.id) as unknown as Prisma.InputJsonValue,
              activatedByUserId: actorUserId
            }
          });
        }
        await tx.operatingTakeoverBatch.update({
          where: { id: batchId },
          data: {
            status: activationStatus,
            activatedAt: new Date(),
            activatedByUserId: actorUserId,
            readyRows: allRows.filter((row) => row.generatedFactId !== null).length,
            blockedRows: 0
          }
        });
        if (project.takeoverStatus === "preparing") {
          await tx.project.update({
            where: { id: projectId },
            data: { takeoverStatus: "operating_with_takeover" }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "history_expense.activate",
          businessType: "operating_takeover_batch",
          businessId: batchId,
          metadata: {
            projectId,
            generatedFactIds,
            remainingPendingRows: remaining,
            status: activationStatus
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return this.detail(projectId, batchId, actorUserId);
  }

  private async factInput(
    tx: Tx,
    projectId: string,
    batch: { id: string; batchNo: string },
    row: {
      id: string;
      rowNo: number;
      occurredAt: Date | null;
      amountCents: bigint | null;
      revision: number;
      valuesSnapshot: Prisma.JsonValue;
    },
    confirmation: { confirmedAt: Date; confirmedByUserId: string },
    effectiveDate: Date
  ): Promise<AppendOperatingFactInput> {
    if (!row.occurredAt) throw new BadRequestException(`第 ${row.rowNo} 行缺少发生日期，不能入账`);
    if (row.amountCents === null || row.amountCents <= 0n) {
      throw new BadRequestException(`第 ${row.rowNo} 行金额必须大于0，未发生费用不入账`);
    }
    const values = row.valuesSnapshot as Record<string, unknown>;
    const amountCents = row.amountCents;
    const assignment = await tx.projectAffiliateAssignment.findFirst({
      where: {
        projectId,
        effectiveFrom: { lte: row.occurredAt },
        OR: [{ endedAt: null }, { endedAt: { gt: row.occurredAt } }]
      },
      orderBy: { effectiveFrom: "desc" }
    });
    if (!assignment) {
      throw new BadRequestException(`第 ${row.rowNo} 行事实日没有有效的施工企业档案，不能入账`);
    }
    const costBearingCompany = await this.resolveCostBearingCompany(
      tx,
      projectId,
      row.occurredAt,
      textValue(values.costBearingCompanyName) ?? null
    );
    const payeeName = textValue(values.payeeName);
    const payee = payeeName
      ? await tx.businessParty.findFirst({
          where: { name: payeeName, status: "active" },
          select: { id: true }
        })
      : null;
    if (payeeName && !payee) {
      throw new BadRequestException(`第 ${row.rowNo} 行未找到有效收款方：${payeeName}`);
    }
    const paymentStatus = textValue(values.paymentStatus) as HistoryExpensePaymentStatus;
    const paidCents = textValue(values.paidAmountYuan)
      ? parseAmountCents(textValue(values.paidAmountYuan))
      : null;
    const payerCompanyName = textValue(values.payerCompanyName) ?? null;
    const impacts = this.impactInputsFor({
      rowId: row.id,
      amountCents,
      values,
      costBearingCompany,
      payee,
      payerCompanyName
    });
    const sourceSnapshot: Prisma.InputJsonObject = {
      batchId: batch.id,
      batchNo: batch.batchNo,
      rowId: row.id,
      rowNo: row.rowNo,
      sceneKey: HISTORY_EXPENSE_SCENE_KEY,
      values: canonicalize(values) as Prisma.InputJsonObject,
      fact: {
        occurredAt: row.occurredAt.toISOString(),
        confirmedAt: confirmation.confirmedAt.toISOString(),
        confirmedByUserId: confirmation.confirmedByUserId,
        factKind: "expense",
        operatingLevel: "project",
        evidenceLevel: "B",
        amountCents: amountCents.toString(),
        paidAmountCents: paidCents === null ? null : paidCents.toString(),
        paymentStatus,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: row.occurredAt < effectiveDate,
        historicalTakeoverBatchId: batch.id,
        entryKind: "original",
        payerCompanyName,
        costBearingCompanyName: textValue(values.costBearingCompanyName) ?? null,
        payerSourcePending: payerCompanyName === null
      }
    };
    return {
      projectId,
      sourceType: HISTORY_EXPENSE_SOURCE_TYPE,
      sourceBusinessId: row.id,
      sourceBusinessCode: `${batch.batchNo}-${row.rowNo}`,
      sourceVersion: row.revision,
      idempotencyKey: `${HISTORY_EXPENSE_SOURCE_TYPE}:${row.id}:${row.revision}`,
      occurredAt: row.occurredAt,
      confirmedAt: confirmation.confirmedAt,
      confirmedByUserId: confirmation.confirmedByUserId,
      factKind: "expense",
      operatingLevel: "project",
      evidenceLevel: "B",
      amountCents,
      currencyCode: "CNY",
      direction: "outflow",
      isBeforeOperatingLedgerEffectiveDate: row.occurredAt < effectiveDate,
      affiliateAssignmentId: assignment.id,
      affiliateBusinessPartyVersionId: assignment.businessPartyVersionId,
      affiliateNameSnapshot: assignment.affiliateNameSnapshot,
      affiliateCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot ?? undefined,
      historicalTakeoverBatchId: batch.id,
      sourceSnapshot,
      subjects: { costBearingCompany },
      impacts
    };
  }

  private impactInputsFor(input: {
    rowId: string;
    amountCents: bigint;
    values: Record<string, unknown>;
    costBearingCompany: OperatingSubjectReference;
    payee: { id: string } | null;
    payerCompanyName: string | null;
    keyPrefix?: string;
    reverse?: boolean;
  }): OperatingImpactInput[] {
    const { rowId, amountCents, values, costBearingCompany, payee, payerCompanyName } = input;
    const keyPrefix = input.keyPrefix ?? HISTORY_EXPENSE_SOURCE_TYPE;
    const reverse = input.reverse === true;
    const direction = (value: "increase" | "decrease" | "notice") =>
      reverse
        ? value === "increase"
          ? "decrease"
          : value === "decrease"
            ? "increase"
            : "notice"
        : value;
    const costCategoryCode = textValue(values.costCategoryCode) as
      | AppendOperatingFactInput["impacts"][number]["costCategoryCode"]
      | undefined;
    const paymentStatus = textValue(values.paymentStatus) as HistoryExpensePaymentStatus;
    const paidCents = textValue(values.paidAmountYuan)
      ? parseAmountCents(textValue(values.paidAmountYuan))
      : null;
    const suffix = reverse ? ":reversal" : "";
    const impacts: OperatingImpactInput[] = [
      {
        idempotencyKey: `${keyPrefix}:${rowId}:confirmed_cost${suffix}`,
        sourceImpactKey: "confirmed_cost",
        impactKind: "confirmed_cost",
        direction: direction("increase"),
        amountCents,
        subjectRole: "cost_bearing_company",
        subject: costBearingCompany,
        ...(costCategoryCode ? { costCategoryCode } : {}),
        description: textValue(values.purpose) ?? undefined,
        impactSnapshot: { sceneKey: HISTORY_EXPENSE_SCENE_KEY, reversed: reverse }
      }
    ];
    if (paymentStatus === "unpaid") {
      impacts.push({
        idempotencyKey: `${keyPrefix}:${rowId}:payable${suffix}`,
        sourceImpactKey: "payable",
        impactKind: "payable_increase",
        direction: direction("increase"),
        amountCents,
        ...(payee
          ? {
              subjectRole: "payee" as const,
              subject: { kind: "downstream_counterparty" as const, id: payee.id }
            }
          : {}),
        description: reverse ? "冲销历史未付费用" : "历史未付费用",
        impactSnapshot: { sceneKey: HISTORY_EXPENSE_SCENE_KEY, reversed: reverse }
      });
    } else if (paymentStatus === "partially_paid") {
      const remaining = amountCents - (paidCents ?? 0n);
      if (remaining > 0n) {
        impacts.push({
          idempotencyKey: `${keyPrefix}:${rowId}:payable${suffix}`,
          sourceImpactKey: "payable",
          impactKind: "payable_increase",
          direction: direction("increase"),
          amountCents: remaining,
          ...(payee
            ? {
                subjectRole: "payee" as const,
                subject: { kind: "downstream_counterparty" as const, id: payee.id }
              }
            : {}),
          description: reverse ? "冲销历史部分付款未付余额" : "历史部分付款未付余额",
          impactSnapshot: { sceneKey: HISTORY_EXPENSE_SCENE_KEY, reversed: reverse }
        });
      }
    } else if (paymentStatus === "unknown") {
      impacts.push({
        idempotencyKey: `${keyPrefix}:${rowId}:payment_pending${suffix}`,
        sourceImpactKey: "payment_pending",
        impactKind: "evidence_gap_notice",
        direction: direction("notice"),
        amountCents,
        description: "付款状态待核对，不按已付或未付记账",
        impactSnapshot: { sceneKey: HISTORY_EXPENSE_SCENE_KEY, reversed: reverse }
      });
    }
    if (payerCompanyName === null && paymentStatus !== "unpaid") {
      impacts.push({
        idempotencyKey: `${keyPrefix}:${rowId}:payer_source_pending${suffix}`,
        sourceImpactKey: "payer_source_pending",
        impactKind: "evidence_gap_notice",
        direction: direction("notice"),
        amountCents,
        description: "付款公司/资金来源待核对",
        impactSnapshot: { sceneKey: HISTORY_EXPENSE_SCENE_KEY, reversed: reverse }
      });
    }
    return impacts;
  }

  private async resolveCostBearingCompany(
    tx: Tx,
    projectId: string,
    occurredAt: Date,
    companyName: string | null
  ): Promise<OperatingSubjectReference> {
    const where: Prisma.ProjectParticipatingCompanyWhereInput = {
      projectId,
      effectiveFrom: { lte: occurredAt },
      OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
    };
    if (companyName) {
      const company = await tx.projectParticipatingCompany.findFirst({
        where: { ...where, companyNameSnapshot: companyName },
        select: { companyEntityId: true }
      });
      if (!company) throw new BadRequestException(`事实日未找到成本承担公司：${companyName}`);
      return { kind: "participating_company", id: company.companyEntityId };
    }
    const participants = await tx.projectParticipatingCompany.findMany({
      where,
      select: { companyEntityId: true }
    });
    if (participants.length !== 1) {
      throw new BadRequestException("成本承担公司待核对，请补全到具体公司后再入账");
    }
    return { kind: "participating_company", id: participants[0]!.companyEntityId };
  }

  private async evaluateRows(
    rows: NormalizedHistoryExpenseRow[],
    existing: Array<{
      sceneKey: string;
      businessRef: string | null;
      occurredAt: Date | null;
      amountCents: bigint | null;
      generatedFactId: string | null;
    }>,
    effectiveDate: Date | null
  ): Promise<HistoryExpensePrecheckResult> {
    const fingerprintsInWorkbook = new Map<string, number>();
    const output: HistoryExpensePrecheckRow[] = [];
    for (const [index, normalized] of rows.entries()) {
      const issues = [...normalized.issues];
      let duplicateStatus: HistoryExpensePrecheckRow["duplicateStatus"] = "none";
      let duplicateNote: string | null = null;
      const duplicateRowNo = fingerprintsInWorkbook.get(normalized.fingerprint);
      if (duplicateRowNo !== undefined) {
        duplicateStatus = "confirmed";
        duplicateNote = `与第 ${duplicateRowNo} 行完全重复`;
        issues.push({
          code: "duplicate_in_workbook",
          severity: "error",
          fieldKey: "businessRef",
          message: `该行与本次导入第 ${duplicateRowNo} 行完全重复，请删除重复行`
        });
      }
      fingerprintsInWorkbook.set(normalized.fingerprint, index + 1);
      const exact = existing.find(
        (row) =>
          row.occurredAt &&
          row.occurredAt.toISOString().slice(0, 10) ===
            normalized.occurredAt.toISOString().slice(0, 10) &&
          row.amountCents === normalized.amountCents &&
          row.businessRef === normalized.businessRef
      );
      const sameBusinessRef = existing.find(
        (row) => row.businessRef && row.businessRef === normalized.businessRef
      );
      if (exact) {
        duplicateStatus = "confirmed";
        duplicateNote = "与既有历史费用批次完全重复";
        issues.push({
          code: exact.generatedFactId ? "already_posted_duplicate" : "duplicate_in_existing_batch",
          severity: "error",
          fieldKey: "businessRef",
          message: exact.generatedFactId
            ? "该行已入账，不能再次导入；更正请走反转+重登"
            : "该行已在既有历史费用批次中，重复导入不会新增"
        });
      } else if (sameBusinessRef) {
        duplicateStatus = "suspected";
        duplicateNote = "业务整理编号已在既有批次出现，请人工说明";
        issues.push({
          code: "business_ref_reused",
          severity: "warning",
          fieldKey: "businessRef",
          message: "业务整理编号已在既有历史费用批次出现，请在核实说明中确认是否同一事实"
        });
      }
      if (
        effectiveDate &&
        normalized.occurredAt >= effectiveDate
      ) {
        issues.push({
          code: "post_effective_history_expense",
          severity: "error",
          fieldKey: "occurredAt",
          message: "发生日期不在经营账启用日前，请走正式费用流程"
        });
      }
      output.push({
        ...normalized,
        rowNo: index + 1,
        duplicateStatus,
        duplicateNote,
        issues
      });
    }
    const summary = summarizeHistoryExpenseRows(
      output.map((row) => ({
        reviewStatus: "pending",
        posted: false,
        amountCents: row.amountCents,
        paidCents: row.paidCents,
        paymentStatus: row.paymentStatus,
        costCategoryCode: row.costCategoryCode
      }))
    );
    return {
      rows: output,
      summary,
      zeroWrites: true,
      importFingerprint: historyExpenseImportFingerprint(output),
      blockingRows: output.filter((row) => row.issues.some((issue) => issue.severity === "error")).length,
      warningRows: output.filter((row) => row.issues.some((issue) => issue.severity === "warning")).length,
      batchStatusCounts: {}
    };
  }

  private inputRows(input: PrecheckHistoryExpenseDto): NormalizedHistoryExpenseRow[] {
    if (!Array.isArray(input.rows) || !input.rows.length) {
      throw new BadRequestException("历史费用批次至少需要一行");
    }
    if (input.rows.length > 500) throw new BadRequestException("单次历史费用导入最多500行");
    return input.rows.map((row) => {
      if (!row || typeof row.values !== "object" || Array.isArray(row.values)) {
        throw new BadRequestException("历史费用行必须是业务字段对象");
      }
      return normalizeHistoryExpenseRow(row.values, {
        today: new Date().toISOString().slice(0, 10)
      });
    });
  }

  private async existingRows(projectId: string) {
    return this.prisma.operatingTakeoverRow.findMany({
      where: { batch: { projectId, sceneKeys: { array_contains: [HISTORY_EXPENSE_SCENE_KEY] } } },
      select: {
        sceneKey: true,
        businessRef: true,
        occurredAt: true,
        amountCents: true,
        generatedFactId: true
      }
    });
  }

  private async project(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isActive: true },
      select: { id: true, operatingLedgerEffectiveDate: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    return project;
  }

  private async roles(projectId: string, actorUserId: string) {
    await this.project(projectId);
    return this.visibility.effectiveRoleKeys(actorUserId, projectId);
  }

  private async authorize(projectId: string, actorUserId: string, action: BusinessAction) {
    const roles = await this.roles(projectId, actorUserId);
    if (!canPerform(action, roles)) {
      throw new ForbiddenException(`当前岗位无权办理历史费用（${action}）`);
    }
    return roles;
  }

  private async lockBatch(tx: Tx, projectId: string, batchId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "OperatingTakeoverBatch" WHERE "id" = ${batchId} AND "projectId" = ${projectId} FOR UPDATE`
    );
    if (!rows.length) throw new NotFoundException("历史费用批次不存在，请刷新后重试");
  }

  private async refreshBatchCounts(tx: Tx, batchId: string) {
    const rows = await tx.operatingTakeoverRow.findMany({
      where: { batchId },
      select: { reviewStatus: true, generatedFactId: true }
    });
    await tx.operatingTakeoverBatch.update({
      where: { id: batchId },
      data: {
        revision: { increment: 1 },
        totalRows: rows.length,
        readyRows: rows.filter((row) => ["verified", "activated"].includes(row.reviewStatus)).length,
        blockedRows: rows.filter((row) => row.reviewStatus === "pending").length,
        warningRows: 0,
        status: rows.some((row) => row.generatedFactId) ? "partially_activated" : "under_review"
      }
    });
  }

  private unpostedFingerprint(
    rows: ReadonlyArray<{
      id: string;
      revision: number;
      reviewStatus: string;
      valuesSnapshot: Prisma.JsonValue;
      amountCents: bigint | null;
    }>
  ): string {
    return fingerprint(
      rows
        .map((row) => ({
          id: row.id,
          revision: row.revision,
          reviewStatus: row.reviewStatus,
          amountCents: row.amountCents?.toString() ?? null,
          values: row.valuesSnapshot
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );
  }

  private serializeRow(row: {
    id: string;
    rowNo: number;
    businessRef: string | null;
    occurredAt: Date | null;
    amountCents: bigint | null;
    valuesSnapshot: Prisma.JsonValue;
    reviewStatus: string;
    reviewConclusion: string | null;
    duplicateStatus: string;
    duplicateNote: string | null;
    revision: number;
    generatedFactId: string | null;
    issues: Array<{ code: string; severity: string; fieldKey: string | null; message: string }>;
  }): HistoryExpenseBatchRowView {
    const values = (row.valuesSnapshot ?? {}) as Record<string, unknown>;
    const paymentStatus = (
      ["paid", "unpaid", "partially_paid", "unknown"].includes(textValue(values.paymentStatus) ?? "")
        ? textValue(values.paymentStatus)
        : "unknown"
    ) as HistoryExpensePaymentStatus;
    return {
      id: row.id,
      rowNo: row.rowNo,
      businessRef: row.businessRef,
      occurredAt: row.occurredAt?.toISOString().slice(0, 10) ?? null,
      amountCents: row.amountCents?.toString() ?? null,
      paymentStatus,
      paymentStatusLabel: HISTORY_EXPENSE_PAYMENT_STATUS_LABELS[paymentStatus],
      paidAmountCents: textValue(values.paidAmountYuan)
        ? (
            normalizeHistoryExpenseRow(values, {
              today: new Date().toISOString().slice(0, 10)
            }).paidCents ?? null
          )?.toString() ?? null
        : null,
      costCategoryCode: textValue(values.costCategoryCode) ?? null,
      reviewStatus: row.reviewStatus,
      reviewStatusLabel: ROW_STATUS_LABELS[row.reviewStatus] ?? row.reviewStatus,
      reviewConclusion: row.reviewConclusion,
      duplicateStatus: row.duplicateStatus,
      duplicateNote: row.duplicateNote,
      revision: row.revision,
      generatedFactId: row.generatedFactId,
      values,
      issues: row.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity === "error" ? "error" : "warning",
        fieldKey: issue.fieldKey ?? undefined,
        message: issue.message
      }))
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }
}

function correctionMeta(values: Record<string, unknown>): {
  originalRowId?: string;
  originalFactId?: string;
} | null {
  const correction = values._correction;
  if (!correction || typeof correction !== "object" || Array.isArray(correction)) {
    return null;
  }
  return correction as { originalRowId?: string; originalFactId?: string };
}

function snapshotFingerprint(value: Prisma.JsonValue): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fingerprintValue = (value as Record<string, Prisma.JsonValue>).fingerprint;
  return typeof fingerprintValue === "string" ? fingerprintValue : undefined;
}
