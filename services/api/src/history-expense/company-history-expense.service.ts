import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { canPerform, type BusinessAction, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma, type CompanyHistoryExpenseBatch, type CompanyHistoryExpenseFact, type CompanyHistoryExpenseRow } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { BoundedXlsxUpload } from "../file/bounded-xlsx";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { CompanyEntityAccess } from "../company-entity/company-entity-access";
import { PrismaService } from "../database/prisma.service";
import type {
  ActivateHistoryExpenseDto, ConfirmHistoryExpenseDto, CorrectHistoryExpenseRowDto,
  CreateHistoryExpenseBatchDto, PrecheckHistoryExpenseDto, VerifyHistoryExpenseRowDto
} from "./dto/history-expense.dto";
import type { HistoryExpenseBatchRowView, HistoryExpenseBatchView } from "./history-expense.service";
import {
  HISTORY_EXPENSE_PAYMENT_STATUSES, HISTORY_EXPENSE_PAYMENT_STATUS_LABELS, HISTORY_EXPENSE_REVIEW_OUTCOME_LABELS,
  normalizeHistoryExpenseRow, summarizeHistoryExpenseRows, type HistoryExpenseIssue, type HistoryExpensePaymentStatus,
  type NormalizedHistoryExpenseRow
} from "./history-expense.domain";
import { exportHistoryExpenseTemplate, parseHistoryExpenseExcel } from "./history-expense-excel";
import { evaluateHistoryExpenseRows, normalizeHistoryExpenseInputRows } from "./history-expense-precheck";
import { textValue } from "../operating-takeover/operating-takeover.utils";

type Tx = Prisma.TransactionClient;
const readRoles: readonly RoleKey[] = ["comprehensive_director", "finance_staff", "finance_director"];
type Company = { id: string; name: string; isActive: boolean; currentVersionNo: number; unifiedSocialCreditCode: string | null };
type Batch = CompanyHistoryExpenseBatch & { rows: CompanyHistoryExpenseRow[] };
type SealedCompany = Company & { unifiedSocialCreditCode: string };
type AccountingTotals = { costCents: string; paidCents: string; outstandingCents: string; unknownPaymentCostCents: string };
type CompanyBatchView = Omit<HistoryExpenseBatchView, "projectId"> & { projectId: null; companyEntityId: string };
const statusLabels = {
  under_review: "待核实/复核", partially_activated: "部分入账", activated: "已入账"
} as const;

@Injectable()
export class CompanyHistoryExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly companyAccess: CompanyEntityAccess,
    private readonly audit: AuditService
  ) {}

  async capability(companyEntityId: string, actorUserId: string) {
    const roles = await this.authorize(actorUserId);
    const company = await this.company(this.prisma, companyEntityId, false);
    return {
      projectId: null, companyEntityId, companyName: company.name,
      paymentStatuses: HISTORY_EXPENSE_PAYMENT_STATUSES.map(value => ({ value, label: HISTORY_EXPENSE_PAYMENT_STATUS_LABELS[value] })),
      reviewOutcomes: (["verified", "pending", "not_occurred"] as const).map(value => ({
        value, label: HISTORY_EXPENSE_REVIEW_OUTCOME_LABELS[value]
      })),
      actions: {
        manage: company.isActive && canPerform("history_expense.manage", roles),
        verify: company.isActive && canPerform("history_expense.verify", roles),
        confirm: company.isActive && canPerform("history_expense.confirm", roles),
        activate: company.isActive && canPerform("history_expense.activate", roles),
        correct: company.isActive && canPerform("history_expense.correct", roles)
      }
    };
  }

  async excelTemplate(companyEntityId: string, actorUserId: string) {
    await this.authorize(actorUserId, "history_expense.manage");
    await this.company(this.prisma, companyEntityId, true);
    return exportHistoryExpenseTemplate("company");
  }

  async precheckExcel(companyEntityId: string, actorUserId: string, file: BoundedXlsxUpload) {
    await this.authorize(actorUserId, "history_expense.manage");
    const company = await this.company(this.prisma, companyEntityId, true);
    const parsed = await parseHistoryExpenseExcel(file);
    return { ...parsed, precheck: await this.precheckRows(this.prisma, company, { rows: parsed.rows }) };
  }

  async createBatch(companyEntityId: string, actorUserId: string, input: CreateHistoryExpenseBatchDto) {
    if (input.sourceFileId) throw new BadRequestException("公司日常历史费用请在各行填写已有依据");
    const result = await this.prisma.$transaction(async tx => {
      const company = await this.lockCompany(tx, companyEntityId, actorUserId, "history_expense.manage");
      const checked = await this.precheckRows(tx, company, input);
      const existing = await tx.companyHistoryExpenseBatch.findUnique({
        where: { companyEntityId_importFingerprint: { companyEntityId, importFingerprint: checked.importFingerprint } },
        select: { id: true }
      });
      if (existing) return { id: existing.id, idempotent: true };
      if (checked.blockingRows) throw new BadRequestException({
        message: "历史费用预检存在阻断项，不能生成草稿", rows: checked.rows.filter(row => row.issues.some(issue => issue.severity === "error"))
          .map(row => ({ rowNo: row.rowNo, issues: row.issues }))
      });
      const id = randomUUID();
      const batchNo = textValue(input.batchNo) ?? `GSFY-${id.slice(0, 8).toUpperCase()}`;
      if (await tx.companyHistoryExpenseBatch.findUnique({ where: { companyEntityId_batchNo: { companyEntityId, batchNo } } })) {
        throw new ConflictException("公司历史费用批次号已存在");
      }
      await tx.companyHistoryExpenseBatch.create({
        data: { id, companyEntityId, batchNo, importFingerprint: checked.importFingerprint, createdByUserId: actorUserId,
          rows: { create: checked.rows.map(row => ({
            ...rowData(row), rowNo: row.rowNo, duplicateStatus: row.duplicateStatus, duplicateNote: row.duplicateNote
          })) }
        }
      });
      await this.recordAudit(tx, actorUserId, companyEntityId, id, "create", { rowCount: checked.rows.length });
      return { id, idempotent: false };
    });
    return { ...await this.detail(companyEntityId, result.id, actorUserId), idempotent: result.idempotent };
  }

  async list(companyEntityId: string, actorUserId: string) {
    await this.authorize(actorUserId);
    await this.company(this.prisma, companyEntityId, false);
    const batches = await this.prisma.companyHistoryExpenseBatch.findMany({
      where: { companyEntityId }, orderBy: { createdAt: "desc" },
      include: { rows: { select: { reviewStatus: true } } }
    });
    return batches.map(batchView);
  }

  async detail(companyEntityId: string, batchId: string, actorUserId: string): Promise<CompanyBatchView> {
    const { roles, company, batch, activated } = await this.prisma.$transaction(async tx => ({
      roles: await this.authorize(actorUserId, undefined, tx),
      company: await this.company(tx, companyEntityId, false),
      batch: await this.batch(tx, companyEntityId, batchId),
      activated: await tx.companyHistoryExpenseFact.findMany({
        where: { batchId, companyEntityId, entryKind: { in: ["original", "replacement"] } },
        select: { id: true, rowId: true }
      })
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const view = batchView(batch);
    const correctedIds = new Set(batch.rows.flatMap(row => row.correctedRowId ? [row.correctedRowId] : []));
    const factByRow = new Map(activated.map(fact => [fact.rowId, fact.id]));
    const rows = batch.rows.map(row => serializeRow(row, factByRow.get(row.id) ?? null, correctedIds.has(row.id)));
    return {
      ...view, projectId: null, companyEntityId, rows,
      sourceFileId: null, sourceFileName: null, importFingerprint: batch.importFingerprint,
      summary: summarizeHistoryExpenseRows(batch.rows.filter(row => !correctedIds.has(row.id)).map(row => ({
        ...row, posted: row.reviewStatus === "activated"
      }))),
      confirmation: batch.confirmedAt && batch.confirmedByUserId && batch.confirmedRevision !== null
        ? { confirmedAt: batch.confirmedAt.toISOString(), confirmedByUserId: batch.confirmedByUserId, revision: batch.confirmedRevision }
        : null,
      canVerify: company.isActive && canPerform("history_expense.verify", roles),
      canConfirm: company.isActive && view.verifiedRows > 0 && canPerform("history_expense.confirm", roles),
      canActivate: company.isActive && view.verifiedRows > 0 && batch.confirmedRevision === batch.revision && canPerform("history_expense.activate", roles),
      canCorrect: company.isActive && canPerform("history_expense.correct", roles)
    };
  }

  async ledger(companyEntityId: string, actorUserId: string) {
    await this.authorize(actorUserId);
    const company = await this.company(this.prisma, companyEntityId, false);
    const [totals] = await this.prisma.$queryRaw<AccountingTotals[]>(Prisma.sql`
      SELECT
        coalesce(sum("costCents"), 0)::text AS "costCents",
        coalesce(sum("paidCents"), 0)::text AS "paidCents",
        coalesce(sum("outstandingCents"), 0)::text AS "outstandingCents",
        coalesce(sum("costCents") FILTER (WHERE "paymentStatus" = 'unknown'), 0)::text AS "unknownPaymentCostCents"
      FROM "CompanyHistoryExpenseFact" WHERE "companyEntityId" = ${companyEntityId}
    `);
    return { projectId: null, companyEntityId, companyName: company.name, ...totals! };
  }

  async verifyRow(companyEntityId: string, batchId: string, rowId: string, actorUserId: string, input: VerifyHistoryExpenseRowDto) {
    await this.prisma.$transaction(async tx => {
      await this.authorize(actorUserId, "history_expense.verify", tx);
      const company = await this.lockCompanyRow(tx, companyEntityId);
      const batch = await this.lockBatch(tx, companyEntityId, batchId);
      const row = requireRow(batch, rowId, input.expectedRevision);
      if (row.reviewStatus === "activated") throw new ConflictException("已入账费用请使用更正");
      const note = textValue(input.note);
      if (input.reviewOutcome !== "verified" && !note) throw new BadRequestException("请填写核实说明");
      const normalized = companyRow(company.name, {
        ...jsonObject(row.valuesSnapshot), costBearingCompanyName: company.name, ...input.values
      });
      const blockers = normalized.issues.filter(issue => issue.severity === "error");
      if (blockers.length) throw new BadRequestException({ message: "费用行仍有未核对字段", issues: blockers });
      if (input.reviewOutcome === "not_occurred" && normalized.amountCents !== 0n) throw new BadRequestException("未发生费用金额必须为0");
      if (input.reviewOutcome === "verified" && normalized.amountCents === 0n) throw new BadRequestException("金额为0的行请标记未发生");
      if (input.reviewOutcome === "verified" && row.duplicateStatus === "suspected" && !note) {
        throw new BadRequestException("业务编号已在其他批次出现，请填写重复核对说明");
      }
      await tx.companyHistoryExpenseRow.update({ where: { id: rowId }, data: {
        ...rowData(normalized), reviewStatus: input.reviewOutcome, reviewConclusion: note, revision: { increment: 1 }
      } });
      await tx.companyHistoryExpenseBatch.update({ where: { id: batchId }, data: { revision: { increment: 1 } } });
      await this.recordAudit(tx, actorUserId, companyEntityId, batchId, "verify", {
        rowId, expectedRevision: input.expectedRevision, outcome: input.reviewOutcome, note, previous: row.valuesSnapshot
      });
    });
    return this.detail(companyEntityId, batchId, actorUserId);
  }

  async confirm(companyEntityId: string, batchId: string, actorUserId: string, input: ConfirmHistoryExpenseDto) {
    return this.prisma.$transaction(async tx => {
      await this.lockCompany(tx, companyEntityId, actorUserId, "history_expense.confirm");
      const batch = await this.lockBatch(tx, companyEntityId, batchId);
      const receipt = await tx.companyHistoryExpenseBatch.findUnique({
        where: { confirmationKey: input.idempotencyKey },
        select: { id: true, confirmedRevision: true, confirmedAt: true, confirmedByUserId: true }
      });
      if (receipt) {
        if (receipt.id !== batchId || receipt.confirmedRevision !== input.expectedRevision || receipt.confirmedByUserId !== actorUserId) {
          throw new ConflictException("本次复核凭据已用于其他操作");
        }
        return { batchId, revision: input.expectedRevision, idempotencyKey: input.idempotencyKey, confirmedAt: receipt.confirmedAt };
      }
      requireBatchRevision(batch, input.expectedRevision);
      if (!batch.rows.some(row => row.reviewStatus === "verified")) throw new BadRequestException("没有已核实待入账的费用");
      const confirmedAt = new Date();
      await tx.companyHistoryExpenseBatch.update({ where: { id: batchId }, data: {
        confirmedRevision: batch.revision, confirmationKey: input.idempotencyKey, confirmedAt, confirmedByUserId: actorUserId
      } });
      await this.recordAudit(tx, actorUserId, companyEntityId, batchId, "confirm", {
        revision: batch.revision, note: textValue(input.note), confirmationKey: input.idempotencyKey
      });
      return { batchId, revision: batch.revision, idempotencyKey: input.idempotencyKey, confirmedAt };
    });
  }

  async activate(companyEntityId: string, batchId: string, actorUserId: string, input: ActivateHistoryExpenseDto) {
    await this.prisma.$transaction(async tx => {
      const company = sealCompany(await this.lockCompany(tx, companyEntityId, actorUserId, "history_expense.activate"));
      const batch = await this.lockBatch(tx, companyEntityId, batchId);
      requireBatchRevision(batch, input.expectedRevision);
      const verified = batch.rows.filter(row => row.reviewStatus === "verified");
      if (!verified.length || batch.confirmedRevision !== batch.revision) {
        throw new ConflictException("请先复核当前批次内容，再将已核实行入账");
      }
      const refs = [...new Set(verified.map(row => row.businessRef))];
      const posted = await tx.companyHistoryExpenseFact.findMany({
        where: { companyEntityId, entryKind: { in: ["original", "replacement"] }, businessRef: { in: refs } },
        select: { businessRef: true, occurredAt: true, costCents: true }
      });
      const sourceKeys = new Set(posted.map(fact => identityKey(fact.businessRef, fact.occurredAt, fact.costCents)));
      for (const row of verified) {
        const key = identityKey(row.businessRef, row.occurredAt, row.amountCents);
        if (sourceKeys.has(key)) throw new ConflictException("发现已入账的重复费用，请查看原批次并按需更正");
        sourceKeys.add(key);
        await tx.companyHistoryExpenseFact.create({ data: postedData(row, company, actorUserId, "original", null) });
      }
      await tx.companyHistoryExpenseRow.updateMany({
        where: { id: { in: verified.map(row => row.id) } }, data: { reviewStatus: "activated" }
      });
      await tx.companyHistoryExpenseBatch.update({ where: { id: batchId }, data: {
        activatedAt: batch.activatedAt ?? new Date(), revision: { increment: 1 }
      } });
      await this.recordAudit(tx, actorUserId, companyEntityId, batchId, "activate", { rowIds: verified.map(row => row.id) });
    });
    return this.detail(companyEntityId, batchId, actorUserId);
  }

  async correctRow(companyEntityId: string, batchId: string, rowId: string, actorUserId: string, input: CorrectHistoryExpenseRowDto) {
    const reason = textValue(input.reason);
    if (!reason) throw new BadRequestException("请填写更正原因");
    await this.prisma.$transaction(async tx => {
      const company = sealCompany(await this.lockCompany(tx, companyEntityId, actorUserId, "history_expense.correct"));
      const batch = await this.lockBatch(tx, companyEntityId, batchId);
      const row = requireRow(batch, rowId, input.expectedRevision);
      if (row.reviewStatus !== "activated") throw new ConflictException("只有已入账行可以更正");
      if (batch.rows.some(item => item.correctedRowId === rowId)) throw new ConflictException("该行已更正，请查看后续更正行");
      const original = await tx.companyHistoryExpenseFact.findFirst({
        where: { rowId, batchId, companyEntityId, entryKind: { in: ["original", "replacement"] } }
      });
      if (!original) throw new ConflictException("原费用入账记录缺失");
      const normalized = companyRow(company.name, {
        ...jsonObject(row.valuesSnapshot), costBearingCompanyName: company.name, ...input.values
      });
      if (normalized.issues.some(issue => issue.severity === "error") || normalized.amountCents <= 0n) {
        throw new BadRequestException({ message: "请核对更正内容及费用金额", issues: normalized.issues });
      }
      const matchingEntries = await tx.companyHistoryExpenseFact.findMany({
        where: { companyEntityId, businessRef: normalized.businessRef!, occurredAt: normalized.occurredAt,
          costCents: normalized.amountCents, id: { not: original.id }, entryKind: { in: ["original", "replacement"] } },
        select: { id: true, adjustments: { where: { entryKind: "reversal" }, select: { id: true } } }
      });
      if (matchingEntries.some(entry => !entry.adjustments.length)) throw new ConflictException("更正结果与另一笔已入账费用重复");
      const latestRow = batch.rows.at(-1)!;
      const corrected = await tx.companyHistoryExpenseRow.create({ data: {
        ...rowData(normalized), batchId, rowNo: latestRow.rowNo + 1, correctedRowId: rowId,
        reviewStatus: "activated", reviewConclusion: reason, duplicateStatus: "none"
      } });
      await tx.companyHistoryExpenseFact.createMany({ data: [
        reversalData(original, corrected.id, actorUserId),
        postedData(corrected, company, actorUserId, "replacement", original.id)
      ] });
      await tx.companyHistoryExpenseBatch.update({ where: { id: batchId }, data: { revision: { increment: 1 } } });
      await this.recordAudit(tx, actorUserId, companyEntityId, batchId, "correct", {
        rowId, correctedRowId: corrected.id, originalFactId: original.id, reason
      });
    });
    return this.detail(companyEntityId, batchId, actorUserId);
  }

  async precheck(companyEntityId: string, actorUserId: string, input: PrecheckHistoryExpenseDto) {
    await this.authorize(actorUserId, "history_expense.manage");
    const company = await this.company(this.prisma, companyEntityId, true);
    return this.precheckRows(this.prisma, company, input);
  }

  private async precheckRows(tx: Tx, company: { id: string; name: string }, input: PrecheckHistoryExpenseDto) {
    const rows = normalizeHistoryExpenseInputRows(input, (values, options) => companyRow(company.name, values, options));
    const existing = await tx.companyHistoryExpenseRow.findMany({
      where: { batch: { companyEntityId: company.id }, businessRef: { in: rows.flatMap(row => row.businessRef ? [row.businessRef] : []) } },
      select: { businessRef: true, occurredAt: true, amountCents: true, reviewStatus: true }
    });
    return {
      ...evaluateHistoryExpenseRows(rows, existing.map(row => ({
        ...row, generatedFactId: row.reviewStatus === "activated" ? "posted" : null
      })), null),
      projectId: null,
      companyEntityId: company.id
    };
  }

  private async lockCompany(tx: Tx, companyEntityId: string, actorUserId: string, action: BusinessAction) {
    await this.authorize(actorUserId, action, tx);
    return this.lockCompanyRow(tx, companyEntityId);
  }

  private async lockCompanyRow(tx: Tx, companyEntityId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CompanyEntity" WHERE "id" = ${companyEntityId} FOR UPDATE`);
    return this.company(tx, companyEntityId, true);
  }

  private async batch(tx: Tx, companyEntityId: string, batchId: string) {
    const batch = await tx.companyHistoryExpenseBatch.findFirst({
      where: { id: batchId, companyEntityId }, include: { rows: { orderBy: { rowNo: "asc" } } }
    });
    if (!batch) throw new NotFoundException("公司历史费用批次不存在");
    return batch;
  }

  private async lockBatch(tx: Tx, companyEntityId: string, batchId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "CompanyHistoryExpenseBatch"
      WHERE "id" = ${batchId} AND "companyEntityId" = ${companyEntityId} FOR UPDATE
    `);
    return this.batch(tx, companyEntityId, batchId);
  }

  private recordAudit(tx: Tx, actorUserId: string, companyEntityId: string, batchId: string,
    action: "create" | "verify" | "confirm" | "activate" | "correct", metadata: Prisma.InputJsonObject) {
    return this.audit.record(tx, {
      actorUserId, action: `company_history_expense.${action}`,
      businessType: "company_history_expense_batch", businessId: batchId,
      metadata: { ...metadata, companyEntityId, projectId: null }
    });
  }

  private async authorize(actorUserId: string, action?: BusinessAction, tx?: Tx) {
    let roles: RoleKey[];
    try {
      roles = tx
        ? await this.roles.resolveActiveRoleScopesInTransaction(tx, actorUserId)
        : await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前账号没有公司日常历史费用权限");
    }
    if (action ? !canPerform(action, roles) : !readRoles.some(role => roles.includes(role))) {
      throw new ForbiddenException("当前岗位无权办理公司日常历史费用");
    }
    await this.companyAccess.assertCanRead(actorUserId, tx);
    return roles;
  }

  private async company(tx: Tx, companyEntityId: string, activeOnly: boolean) {
    const company = await tx.companyEntity.findFirst({
      where: { id: companyEntityId, dataStatus: "complete", ...(activeOnly ? { isActive: true } : {}) },
      select: { id: true, name: true, isActive: true, currentVersionNo: true, unifiedSocialCreditCode: true }
    });
    if (!company) throw new NotFoundException("承担公司不存在，或公司资料未启用");
    return company;
  }
}

function companyRow(companyName: string, values: Record<string, unknown>, options?: { today?: string }) {
  const suppliedName = textValue(values.costBearingCompanyName);
  const row = normalizeHistoryExpenseRow({ ...values, costBearingCompanyName: companyName }, options);
  if (suppliedName && suppliedName !== companyName) {
    row.issues.push({
      code: "company_scope_mismatch", severity: "error", fieldKey: "costBearingCompanyName",
      message: "表中承担公司与所选公司不同，请将不同承担公司的费用分批导入"
    });
  }
  return row;
}


function rowData(row: NormalizedHistoryExpenseRow) {
  return {
    businessRef: row.businessRef!, occurredAt: row.occurredAt, amountCents: row.amountCents, paidCents: row.paidCents,
    paymentStatus: row.paymentStatus, costCategoryCode: row.costCategoryCode!,
    valuesSnapshot: row.values as Prisma.InputJsonObject, issues: row.issues as Prisma.InputJsonValue
  };
}

function jsonObject(value: Prisma.JsonValue) {
  return value as Prisma.JsonObject;
}

function identityKey(ref: string, day: Date, amount: bigint) {
  return JSON.stringify([ref, day.toISOString(), amount.toString()]);
}

function sealCompany(company: Company): SealedCompany {
  if (company.currentVersionNo < 1 || !company.unifiedSocialCreditCode) {
    throw new ConflictException("承担公司资料尚未核实完整，暂不能入账");
  }
  return { ...company, unifiedSocialCreditCode: company.unifiedSocialCreditCode };
}

function postedData(row: CompanyHistoryExpenseRow, company: SealedCompany, actorUserId: string,
  entryKind: "original" | "replacement", adjustsFactId: string | null) {
  return {
    batchId: row.batchId, rowId: row.id, companyEntityId: company.id, companyNameSnapshot: company.name,
    companyCreditCodeSnapshot: company.unifiedSocialCreditCode, companyVersionNoSnapshot: company.currentVersionNo,
    entryKind, adjustsFactId, businessRef: row.businessRef, occurredAt: row.occurredAt,
    costCategoryCode: row.costCategoryCode, costCents: row.amountCents, paidCents: row.paidCents,
    outstandingCents: row.paymentStatus === "unknown" ? null : row.amountCents - (row.paidCents ?? 0n),
    paymentStatus: row.paymentStatus, valuesSnapshot: jsonObject(row.valuesSnapshot), actorUserId
  };
}

function reversalData(original: CompanyHistoryExpenseFact, rowId: string, actorUserId: string) {
  const { id, createdAt, ...snapshot } = original;
  void createdAt;
  return {
    ...snapshot, rowId, entryKind: "reversal", adjustsFactId: id, actorUserId, costCents: -original.costCents,
    paidCents: original.paidCents === null ? null : -original.paidCents,
    outstandingCents: original.outstandingCents === null ? null : -original.outstandingCents,
    valuesSnapshot: jsonObject(original.valuesSnapshot)
  };
}

function requireRow(batch: Batch, rowId: string, revision: number) {
  const row = batch.rows.find(item => item.id === rowId);
  if (!row) throw new NotFoundException("历史费用行不存在，请刷新后重试");
  if (row.revision !== revision) throw new ConflictException("历史费用行版本已变化，请刷新后重试");
  return row;
}

function requireBatchRevision(batch: Batch, revision: number) {
  if (batch.revision !== revision) throw new ConflictException("历史费用批次已变化，请刷新后重试");
}

function batchView(batch: CompanyHistoryExpenseBatch & { rows: Array<{ reviewStatus: string }> }) {
  const pendingRows = batch.rows.filter(row => row.reviewStatus === "pending").length;
  const verifiedRows = batch.rows.filter(row => row.reviewStatus === "verified").length;
  const status = batch.activatedAt ? pendingRows + verifiedRows > 0 ? "partially_activated" : "activated" : "under_review";
  return {
    id: batch.id, batchNo: batch.batchNo, status, statusLabel: statusLabels[status], revision: batch.revision,
    totalRows: batch.rows.length, activatedRows: batch.rows.filter(row => row.reviewStatus === "activated").length,
    pendingRows, verifiedRows, createdAt: batch.createdAt.toISOString(), activatedAt: batch.activatedAt?.toISOString() ?? null
  };
}

function serializeRow(row: CompanyHistoryExpenseRow, factId: string | null, corrected: boolean): HistoryExpenseBatchRowView {
  const paymentStatus = row.paymentStatus as HistoryExpensePaymentStatus;
  const reviewLabels: Record<string, string> = {
    pending: "待核对", verified: "已核实待入账", not_occurred: "未发生", activated: "已入账"
  };
  return {
    id: row.id, rowNo: row.rowNo, businessRef: row.businessRef, occurredAt: row.occurredAt.toISOString().slice(0, 10),
    amountCents: row.amountCents.toString(), paymentStatus, paymentStatusLabel: HISTORY_EXPENSE_PAYMENT_STATUS_LABELS[paymentStatus],
    paidAmountCents: row.paidCents?.toString() ?? null, costCategoryCode: row.costCategoryCode,
    reviewStatus: corrected ? "corrected" : row.reviewStatus, reviewStatusLabel: corrected ? "已更正" : reviewLabels[row.reviewStatus]!,
    reviewConclusion: row.reviewConclusion, duplicateStatus: row.duplicateStatus, duplicateNote: row.duplicateNote,
    revision: row.revision, generatedFactId: factId, values: jsonObject(row.valuesSnapshot),
    issues: row.issues as HistoryExpenseIssue[]
  };
}
