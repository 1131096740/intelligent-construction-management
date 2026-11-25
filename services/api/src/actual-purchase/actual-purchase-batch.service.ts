import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeBusinessAmount, normalizeBusinessQuantity, type RoleKey } from "@jiangkong/shared-domain";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { parseMoneyCentsInput, moneyCentsToApi } from "../money/decimal-money";
import { requiredPastChinaDate, chinaDateOnly } from "@jiangkong/shared-domain";
import {
  occurredBeforeEffectiveDate,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { appendPaymentFinancialFunding } from "../payment/payment-financial-funding";
import {
  assertActualPurchaseBatchCommitment,
  assertActualPurchaseBatchExecution,
  calculateActualPurchaseBatchCapacity,
  type ActualPurchaseBatchCapacity,
  type ActualPurchaseBatchCapacityPayment
} from "./actual-purchase-batch-capacity";
import { ActualPurchaseBatchNotificationService } from "./actual-purchase-batch-notification.service";
import type {
  CreateActualPurchaseBatchDto,
  CreateBatchSpotPaymentDto,
  ConfirmActualPurchaseBatchCorrectionDto,
  RecordActualPurchaseBatchRefundDto,
  RequestActualPurchaseBatchCorrectionDto,
  UpdateActualPurchaseBatchDto
} from "./actual-purchase-batch.dto";

export const ACTUAL_PURCHASE_BATCH_SOURCE_TYPE = "actual_purchase_batch";
const FINANCE_ROLES = ["finance_staff", "finance_director", "comprehensive_director"] as const;
const BATCH_SPOT_ACTIVE_STATUSES = ["approval_pending", "approved", "approved_pending_payment", "partially_paid", "paid", "settled"] as const;
const BATCH_CLAIM_ACTIVE_STATUSES = ["approval_pending", "approved_pending_payment", "partially_paid", "paid", "offset_completed"] as const;
type BatchCostCategoryCode = "material" | "project_daily_expense" | "site_construction_and_measures" | "other_project_cost";
const BATCH_COST_CATEGORY_BY_PROCUREMENT = {
  procurement_office_supplies: "project_daily_expense",
  procurement_construction_tools: "site_construction_and_measures",
  procurement_gifts: "project_daily_expense",
  procurement_logistics: "project_daily_expense",
  procurement_meals: "project_daily_expense",
  procurement_utilities: "project_daily_expense",
  procurement_other: "other_project_cost"
} as const;

interface BatchRow {
  id: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  kind: string;
  procurementId: string;
  procurementVersionId: string | null;
  projectId: string | null;
  companyEntityId: string | null;
  supplierName: string;
  totalAmountCents: bigint;
  effectiveTotalAmountCents: bigint;
  status: string;
  costVersion: number;
  costConfirmedAt: Date | null;
  costConfirmedByUserId: string | null;
  costFactId: string | null;
  note: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ActualPurchaseBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: OperatingLedgerService,
    private readonly auth: AuthService,
    private readonly notifications?: ActualPurchaseBatchNotificationService
  ) {}

  private fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item), "utf8").digest("hex");
  }

  private text(value: unknown, label: string): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new BadRequestException(`请填写${label}`);
    return text;
  }

  private optional(value: unknown): string | null {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
  }

  private async actorRoles(tx: Prisma.TransactionClient, actorUserId: string, projectId: string | null): Promise<RoleKey[]> {
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, isActive: true } });
    if (!user?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
    const globalAssignments = await tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null }, select: { positionId: true } });
    const globalPositions = await tx.position.findMany({ where: { id: { in: globalAssignments.map((row) => row.positionId) } }, select: { key: true } });
    const roles = new Set<string>(globalPositions.map((row) => row.key));
    if (projectId) {
      const projectAssignments = await tx.userPosition.findMany({ where: { userId: actorUserId, projectId }, select: { positionId: true } });
      const projectPositions = await tx.position.findMany({ where: { id: { in: projectAssignments.map((row) => row.positionId) } }, select: { key: true } });
      for (const row of projectPositions) roles.add(row.key);
      const members = await tx.projectMember.findMany({ where: { userId: actorUserId, projectId }, select: { positionKey: true } });
      for (const member of members) roles.add(member.positionKey);
    }
    return [...roles] as RoleKey[];
  }

  private async requireAnyRole(tx: Prisma.TransactionClient, actorUserId: string, projectId: string | null, allowed: readonly string[], message: string): Promise<RoleKey[]> {
    const roles = await this.actorRoles(tx, actorUserId, projectId);
    if (!roles.some((role) => allowed.includes(role))) throw new ForbiddenException(message);
    return roles;
  }

  private normalizeLines(lines: CreateActualPurchaseBatchDto["lines"]) {
    return lines.map((line, index) => {
      const materialName = this.text(line.materialName, `第${index + 1}行实际采购事项`);
      let quantity: string | null;
      let unitPrice: string | null;
      try {
        quantity = line.quantity?.trim() ? normalizeBusinessQuantity(line.quantity.trim()) : null;
        unitPrice = line.unitPrice?.trim() ? normalizeBusinessAmount(line.unitPrice.trim()) : null;
      } catch (error) {
        throw new BadRequestException(`第${index + 1}行实际采购数量或单价：${error instanceof Error ? error.message : "请填写有效数值"}`);
      }
      const amountCents = line.amountCents?.trim()
        ? parseMoneyCentsInput(line.amountCents, `第${index + 1}行实际金额`, `第${index + 1}行实际金额必须按分填写为 0 或更大的整数`)
        : null;
      return {
        sortOrder: index + 1,
        materialName,
        specification: this.optional(line.specification),
        unit: this.optional(line.unit),
        quantity: quantity ? new Prisma.Decimal(quantity) : null,
        unitPrice: unitPrice ? new Prisma.Decimal(unitPrice) : null,
        amountCents,
        note: this.optional(line.note)
      };
    });
  }

  private async loadSpotProcurement(tx: Prisma.TransactionClient, procurementId: string) {
    const procurement = await tx.spotProcurement.findUnique({ where: { id: procurementId }, select: { id: true, projectId: true, currentVersionId: true, status: true, code: true } });
    if (!procurement) throw new NotFoundException("零星材料采购申请不存在");
    if (procurement.status !== "approved_in_progress" || !procurement.currentVersionId) throw new ConflictException("零星材料采购未完成审批，不能记录实际采购批次");
    const version = await tx.spotProcurementVersion.findUnique({ where: { id: procurement.currentVersionId } });
    if (!version || version.status !== "approved") throw new ConflictException("零星材料采购批准版本已变化，请刷新后重试");
    return { procurement, version };
  }

  async create(actorUserId: string, input: CreateActualPurchaseBatchDto) {
    const totalAmountCents = parseMoneyCentsInput(input.totalAmountCents, "实际采购总金额", "实际采购总金额必须按分填写为大于 0 的整数");
    if (totalAmountCents <= 0n) throw new BadRequestException("实际采购总金额必须大于 0");
    const supplierName = this.text(input.supplierName, "实际供应商名称");
    const lines = this.normalizeLines(input.lines);
    const fingerprint = this.fingerprint({ actorUserId, input: { ...input, supplierName, totalAmountCents: totalAmountCents.toString(), lines: lines.map((line) => ({ ...line, quantity: line.quantity?.toString() ?? null, unitPrice: line.unitPrice?.toString() ?? null, amountCents: line.amountCents?.toString() ?? null })) } });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`actual-purchase-batch:${input.idempotencyKey}`}, 0))::text AS "lockResult"`);
      const existing = await tx.actualPurchaseBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) throw new ConflictException("重复提交的实际采购批次内容不一致，请刷新后核对");
        return this.detailView(tx, existing);
      }
      let projectId: string | null;
      let companyEntityId: string | null;
      let procurementVersionId: string | null = null;
      if (input.kind === "spot_material") {
        const { procurement, version } = await this.loadSpotProcurement(tx, input.procurementId);
        const roles = await this.requireAnyRole(tx, actorUserId, procurement.projectId, ["material_staff", "material_director"], "只有项目物资员或物资部主管可以记录实际采购批次");
        if (actorUserId !== version.handlerUserId && !roles.includes("material_director")) throw new ForbiddenException("只有采购经办人或物资部主管可以记录实际采购批次");
        projectId = procurement.projectId;
        companyEntityId = null;
        procurementVersionId = version.id;
      } else {
        await this.requireAnyRole(tx, actorUserId, null, ["comprehensive_director"], "只有综合部主管可以记录综合采购实际批次");
        const procurement = await tx.generalProcurement.findUnique({ where: { id: input.procurementId } });
        if (!procurement) throw new NotFoundException("综合采购申请不存在");
        if (procurement.requestProtocolVersion !== 2) throw new ConflictException("历史综合采购请沿用原付款入口");
        if (!["approved_pending_procurement", "archived"].includes(procurement.status)) throw new ConflictException("综合采购申请未完成审批，不能记录实际采购批次");
        projectId = procurement.projectId;
        companyEntityId = this.text(input.companyEntityId ?? procurement.companyEntityId, "费用承担公司");
        const company = await tx.companyEntity.findFirst({ where: { id: companyEntityId, isActive: true }, select: { id: true } });
        if (!company) throw new BadRequestException("费用承担公司不存在或已停用");
      }
      const row = await tx.actualPurchaseBatch.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: fingerprint,
          kind: input.kind,
          procurementId: input.procurementId,
          procurementVersionId,
          projectId,
          companyEntityId,
          supplierName,
          totalAmountCents,
          effectiveTotalAmountCents: totalAmountCents,
          status: "recorded",
          note: this.optional(input.note),
          createdByUserId: actorUserId,
          lines: { createMany: { data: lines } }
        }
      });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.create", businessType: "actual_purchase_batch", businessId: row.id, metadata: { kind: row.kind, procurementId: row.procurementId, supplierName, totalAmountCents: totalAmountCents.toString(), lineCount: lines.length } });
      return this.detailView(tx, row);
    });
  }

  async update(actorUserId: string, batchId: string, input: UpdateActualPurchaseBatchDto) {
    const totalAmountCents = parseMoneyCentsInput(input.totalAmountCents, "实际采购总金额", "实际采购总金额必须按分填写为大于 0 的整数");
    if (totalAmountCents <= 0n) throw new BadRequestException("实际采购总金额必须大于 0");
    const lines = this.normalizeLines(input.lines as CreateActualPurchaseBatchDto["lines"]);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      await this.requireAnyRole(tx, actorUserId, batch.projectId, batch.kind === "spot_material" ? ["material_staff", "material_director"] : ["comprehensive_director"], "当前账号不能修改实际采购批次");
      if (batch.costVersion > 0) throw new ConflictException("实际采购批次成本已确认，请从统一更正入口办理");
      const [spotPayments, claims] = await Promise.all([
        tx.spotProcurementPayment.count({ where: { actualPurchaseBatchId: batchId } }),
        tx.expenseClaim.count({ where: { actualPurchaseBatchId: batchId } })
      ]);
      if (spotPayments + claims > 0) throw new ConflictException("实际采购批次已关联付款，不能直接修改，请新增批次或办理更正");
      const supplierName = this.text(input.supplierName, "实际供应商名称");
      await tx.actualPurchaseBatchLine.deleteMany({ where: { batchId } });
      const updated = await tx.actualPurchaseBatch.update({
        where: { id: batchId },
        data: { supplierName, totalAmountCents, effectiveTotalAmountCents: totalAmountCents, note: this.optional(input.note), lines: { createMany: { data: lines } } }
      });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.update", businessType: "actual_purchase_batch", businessId: batchId, metadata: { supplierName, totalAmountCents: totalAmountCents.toString(), lineCount: lines.length } });
      return this.detailView(tx, updated);
    });
  }

  async list(actorUserId: string, query: { procurementId?: string; kind?: string }) {
    const rows = await this.prisma.actualPurchaseBatch.findMany({ where: { ...(query.procurementId ? { procurementId: query.procurementId } : {}), ...(query.kind ? { kind: query.kind } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
    const visible: BatchRow[] = [];
    for (const row of rows) {
      const roles = await this.actorRoles(this.prisma as unknown as Prisma.TransactionClient, actorUserId, row.projectId);
      if (row.createdByUserId === actorUserId || roles.some((role) => ["comprehensive_director", "finance_staff", "finance_director", "material_director", "chairman", "general_manager", "project_manager"].includes(role))) visible.push(row);
    }
    return { items: await Promise.all(visible.map((row) => this.detailView(this.prisma as unknown as Prisma.TransactionClient, row))) };
  }

  async detail(actorUserId: string, batchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId}`);
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      const roles = await this.actorRoles(tx, actorUserId, batch.projectId);
      if (batch.createdByUserId !== actorUserId && !roles.some((role) => ["comprehensive_director", "finance_staff", "finance_director", "material_director", "chairman", "general_manager", "project_manager"].includes(role))) throw new ForbiddenException("当前账号无权查看该实际采购批次");
      return this.detailView(tx, batch);
    });
  }

  private batchView(row: BatchRow) {
    return {
      id: row.id,
      kind: row.kind,
      procurementId: row.procurementId,
      procurementVersionId: row.procurementVersionId,
      projectId: row.projectId,
      companyEntityId: row.companyEntityId,
      supplierName: row.supplierName,
      totalAmountCents: moneyCentsToApi(row.totalAmountCents),
      effectiveTotalAmountCents: moneyCentsToApi(row.effectiveTotalAmountCents),
      status: row.status,
      costVersion: row.costVersion,
      costConfirmedAt: row.costConfirmedAt,
      costConfirmedByUserId: row.costConfirmedByUserId,
      note: row.note,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private async detailView(tx: Prisma.TransactionClient, row: BatchRow) {
    const [lines, spotPayments, claims, corrections] = await Promise.all([
      tx.actualPurchaseBatchLine.findMany({ where: { batchId: row.id }, orderBy: { sortOrder: "asc" } }),
      tx.spotProcurementPayment.findMany({ where: { actualPurchaseBatchId: row.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      tx.expenseClaim.findMany({ where: { actualPurchaseBatchId: row.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      tx.actualPurchaseBatchCorrection.findMany({ where: { batchId: row.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    ]);
    const spotPaymentIds = spotPayments.map((payment) => payment.id);
    const claimIds = claims.map((claim) => claim.id);
    const [spotExecutions, claimExecutions] = await Promise.all([
      spotPaymentIds.length
        ? tx.spotProcurementPaymentExecution.findMany({ where: { paymentId: { in: spotPaymentIds } }, select: { id: true, paymentId: true, amountCents: true, paidAt: true, voidedAt: true } })
        : Promise.resolve([] as Array<{ id: string; paymentId: string; amountCents: bigint; paidAt: Date; voidedAt: Date | null }>),
      claimIds.length
        ? tx.expenseClaimPaymentExecution.findMany({ where: { expenseClaimId: { in: claimIds } }, select: { id: true, expenseClaimId: true, amountCents: true, paidAt: true } })
        : Promise.resolve([] as Array<{ id: string; expenseClaimId: string; amountCents: bigint; paidAt: Date }>)
    ]);
    const spotExecutionPayment = new Map(spotExecutions.map((execution) => [execution.id, execution.paymentId]));
    const claimExecutionClaim = new Map(claimExecutions.map((execution) => [execution.id, execution.expenseClaimId]));
    const spotExecutionsByPayment = new Map<string, Array<{ id: string; amountCents: bigint; paidAt: Date; voidedAt: Date | null }>>();
    for (const execution of spotExecutions) {
      const list = spotExecutionsByPayment.get(execution.paymentId) ?? [];
      list.push({ id: execution.id, amountCents: execution.amountCents, paidAt: execution.paidAt, voidedAt: execution.voidedAt });
      spotExecutionsByPayment.set(execution.paymentId, list);
    }
    const claimExecutionsByClaim = new Map<string, Array<{ id: string; amountCents: bigint; paidAt: Date }>>();
    for (const execution of claimExecutions) {
      const list = claimExecutionsByClaim.get(execution.expenseClaimId) ?? [];
      list.push({ id: execution.id, amountCents: execution.amountCents, paidAt: execution.paidAt });
      claimExecutionsByClaim.set(execution.expenseClaimId, list);
    }
    const [spotRefunds, claimRefunds] = await Promise.all([
      spotExecutions.length
        ? tx.paymentExecutionRefund.findMany({
            where: { executionType: "spot_procurement_payment_execution", spotProcurementPaymentExecutionId: { in: spotExecutions.map((execution) => execution.id) } },
            select: { id: true, amountCents: true, receivedAt: true, reason: true, recordedByUserId: true, accountId: true, spotProcurementPaymentExecutionId: true },
            orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }]
          })
        : Promise.resolve([] as Array<{ id: string; amountCents: bigint; receivedAt: Date; reason: string; recordedByUserId: string; accountId: string | null; spotProcurementPaymentExecutionId: string | null }>),
      claimExecutions.length
        ? tx.paymentExecutionRefund.findMany({
            where: { executionType: "expense_claim_payment_execution", expenseClaimPaymentExecutionId: { in: claimExecutions.map((execution) => execution.id) } },
            select: { id: true, amountCents: true, receivedAt: true, reason: true, recordedByUserId: true, accountId: true, expenseClaimPaymentExecutionId: true },
            orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }]
          })
        : Promise.resolve([] as Array<{ id: string; amountCents: bigint; receivedAt: Date; reason: string; recordedByUserId: string; accountId: string | null; expenseClaimPaymentExecutionId: string | null }>)
    ]);
    const capacity = await this.calculateCapacityInTransaction(tx, row);
    return {
      ...this.batchView(row),
      lines: lines.map((line) => ({
        id: line.id,
        sortOrder: line.sortOrder,
        materialName: line.materialName,
        specification: line.specification,
        unit: line.unit,
        quantity: line.quantity?.toString() ?? null,
        unitPrice: line.unitPrice?.toString() ?? null,
        amountCents: line.amountCents?.toString() ?? null,
        note: line.note
      })),
      payments: [
        ...spotPayments.map((payment) => ({
          id: payment.id,
          paymentKind: "spot_procurement_payment" as const,
          code: payment.code,
          merchantName: payment.merchantNameSnapshot,
          requestedAmountCents: payment.approvalAmountCents.toString(),
          paidAmountCents: payment.paidAmountCents.toString(),
          refundedAmountCents: capacity.refundsByPayment.get(payment.id)?.toString() ?? "0",
          status: payment.status,
          executions: (spotExecutionsByPayment.get(payment.id) ?? [])
            .filter((execution) => execution.voidedAt === null)
            .map((execution) => ({
              id: execution.id,
              amountCents: execution.amountCents.toString(),
              paidAt: execution.paidAt,
              refundableAmountCents: (execution.amountCents - (spotRefunds.filter((refund) => refund.spotProcurementPaymentExecutionId === execution.id).reduce((sum, refund) => sum + refund.amountCents, 0n))).toString()
            }))
        })),
        ...claims.map((claim) => ({
          id: claim.id,
          paymentKind: "expense_claim" as const,
          code: claim.code,
          merchantName: claim.payeeNameSnapshot ?? claim.applicantNameSnapshot,
          requestedAmountCents: claim.requestedAmountCents.toString(),
          paidAmountCents: claim.fundedAmountCents.toString(),
          refundedAmountCents: capacity.refundsByPayment.get(claim.id)?.toString() ?? "0",
          status: claim.status,
          executions: (claimExecutionsByClaim.get(claim.id) ?? []).map((execution) => ({
            id: execution.id,
            amountCents: execution.amountCents.toString(),
            paidAt: execution.paidAt,
            refundableAmountCents: (execution.amountCents - (claimRefunds.filter((refund) => refund.expenseClaimPaymentExecutionId === execution.id).reduce((sum, refund) => sum + refund.amountCents, 0n))).toString()
          }))
        }))
      ].sort((left, right) => left.code.localeCompare(right.code)),
      capacity: {
        paidAmountCents: capacity.capacity.paidAmountCents.toString(),
        refundedAmountCents: capacity.capacity.refundedAmountCents.toString(),
        netPaidAmountCents: capacity.capacity.netPaidAmountCents.toString(),
        outstandingCommittedAmountCents: capacity.capacity.outstandingCommittedAmountCents.toString(),
        availableAmountCents: capacity.capacity.availableAmountCents.toString(),
        payableNowAmountCents: capacity.capacity.payableNowAmountCents.toString(),
        overpaidAmountCents: capacity.capacity.overpaidAmountCents.toString(),
        suspended: capacity.capacity.suspended,
        suspendReason: capacity.capacity.suspendReason
      },
      costContribution: {
        originalTotalAmountCents: row.totalAmountCents.toString(),
        effectiveTotalAmountCents: row.effectiveTotalAmountCents.toString(),
        confirmedCostAmountCents: row.costVersion > 0 ? row.effectiveTotalAmountCents.toString() : "0",
        costVersion: row.costVersion,
        note: row.costVersion > 0 ? "整批成本只按首个付款/报销确认一次；多付退款只改净付款与容量，不减已确认采购成本" : "首批付款或垫付报销通过时确认整批成本"
      },
      refunds: [
        ...spotRefunds.map((refund) => ({
          id: refund.id,
          executionType: "spot_procurement_payment_execution" as const,
          executionId: refund.spotProcurementPaymentExecutionId,
          paymentId: refund.spotProcurementPaymentExecutionId ? spotExecutionPayment.get(refund.spotProcurementPaymentExecutionId) ?? null : null,
          amountCents: refund.amountCents.toString(),
          receivedAt: refund.receivedAt,
          reason: refund.reason,
          accountId: refund.accountId,
          recordedByUserId: refund.recordedByUserId
        })),
        ...claimRefunds.map((refund) => ({
          id: refund.id,
          executionType: "expense_claim_payment_execution" as const,
          executionId: refund.expenseClaimPaymentExecutionId,
          paymentId: refund.expenseClaimPaymentExecutionId ? claimExecutionClaim.get(refund.expenseClaimPaymentExecutionId) ?? null : null,
          amountCents: refund.amountCents.toString(),
          receivedAt: refund.receivedAt,
          reason: refund.reason,
          accountId: refund.accountId,
          recordedByUserId: refund.recordedByUserId
        }))
      ].sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime()),
      corrections: corrections.map((correction) => ({
        id: correction.id,
        status: correction.status,
        originalTotalAmountCents: correction.originalTotalAmountCents.toString(),
        correctedTotalAmountCents: correction.correctedTotalAmountCents.toString(),
        correctionDeltaCents: correction.correctionDeltaCents.toString(),
        reason: correction.reason,
        requestedByUserId: correction.requestedByUserId,
        confirmedByUserId: correction.confirmedByUserId,
        confirmedAt: correction.confirmedAt,
        createdAt: correction.createdAt
      }))
    };
  }

  private async calculateCapacityInTransaction(tx: Prisma.TransactionClient, row: BatchRow) {
    const [spotPayments, claims] = await Promise.all([
      tx.spotProcurementPayment.findMany({
        where: { actualPurchaseBatchId: row.id },
        select: { id: true, status: true, approvalAmountCents: true, paidAmountCents: true }
      }),
      tx.expenseClaim.findMany({
        where: { actualPurchaseBatchId: row.id },
        select: { id: true, status: true, requestedAmountCents: true, fundedAmountCents: true }
      })
    ]);
    const spotIds = spotPayments.map((payment) => payment.id);
    const claimIds = claims.map((claim) => claim.id);
    const [spotRefunds, claimRefunds] = await Promise.all([
      spotIds.length
        ? tx.paymentExecutionRefund.findMany({
            where: { executionType: "spot_procurement_payment_execution", spotExecution: { paymentId: { in: spotIds } } },
            select: { amountCents: true, spotExecution: { select: { paymentId: true } } }
          })
        : Promise.resolve([] as Array<{ amountCents: bigint; spotExecution: { paymentId: string } | null }>),
      claimIds.length
        ? tx.paymentExecutionRefund.findMany({
            where: { executionType: "expense_claim_payment_execution", expenseClaimExecution: { expenseClaimId: { in: claimIds } } },
            select: { amountCents: true, expenseClaimExecution: { select: { expenseClaimId: true } } }
          })
        : Promise.resolve([] as Array<{ amountCents: bigint; expenseClaimExecution: { expenseClaimId: string } | null }>)
    ]);
    const refundsByPayment = new Map<string, bigint>();
    for (const refund of spotRefunds) {
      const paymentId = refund.spotExecution?.paymentId;
      if (paymentId) refundsByPayment.set(paymentId, (refundsByPayment.get(paymentId) ?? 0n) + refund.amountCents);
    }
    for (const refund of claimRefunds) {
      const claimId = refund.expenseClaimExecution?.expenseClaimId;
      if (claimId) refundsByPayment.set(claimId, (refundsByPayment.get(claimId) ?? 0n) + refund.amountCents);
    }
    const capacityPayments: ActualPurchaseBatchCapacityPayment[] = [
      ...spotPayments.map((payment) => ({
        requestedAmountCents: payment.approvalAmountCents,
        paidAmountCents: payment.paidAmountCents,
        refundedAmountCents: refundsByPayment.get(payment.id) ?? 0n,
        countsAgainstBatch: (BATCH_SPOT_ACTIVE_STATUSES as readonly string[]).includes(payment.status)
      })),
      ...claims.map((claim) => ({
        requestedAmountCents: claim.requestedAmountCents,
        paidAmountCents: claim.fundedAmountCents,
        refundedAmountCents: refundsByPayment.get(claim.id) ?? 0n,
        countsAgainstBatch: (BATCH_CLAIM_ACTIVE_STATUSES as readonly string[]).includes(claim.status)
      }))
    ];
    const capacity = calculateActualPurchaseBatchCapacity(row.effectiveTotalAmountCents, capacityPayments);
    return { capacity, refundsByPayment };
  }

  private async calculateCapacity(
    tx: Prisma.TransactionClient,
    batchId: string,
    options: { excludeSpotPaymentId?: string; excludeClaimId?: string } = {}
  ): Promise<ActualPurchaseBatchCapacity> {
    const row = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
    if (!row) throw new NotFoundException("实际采购批次不存在");
    const result = await this.calculateCapacityInTransaction(tx, row);
    if (!options.excludeSpotPaymentId && !options.excludeClaimId) return result.capacity;
    const spotPayments = await tx.spotProcurementPayment.findMany({ where: { actualPurchaseBatchId: batchId }, select: { id: true, status: true, approvalAmountCents: true, paidAmountCents: true } });
    const claims = await tx.expenseClaim.findMany({ where: { actualPurchaseBatchId: batchId }, select: { id: true, status: true, requestedAmountCents: true, fundedAmountCents: true } });
    const payments: ActualPurchaseBatchCapacityPayment[] = [
      ...spotPayments.filter((payment) => payment.id !== options.excludeSpotPaymentId).map((payment) => ({
        requestedAmountCents: payment.approvalAmountCents,
        paidAmountCents: payment.paidAmountCents,
        refundedAmountCents: result.refundsByPayment.get(payment.id) ?? 0n,
        countsAgainstBatch: (BATCH_SPOT_ACTIVE_STATUSES as readonly string[]).includes(payment.status)
      })),
      ...claims.filter((claim) => claim.id !== options.excludeClaimId).map((claim) => ({
        requestedAmountCents: claim.requestedAmountCents,
        paidAmountCents: claim.fundedAmountCents,
        refundedAmountCents: result.refundsByPayment.get(claim.id) ?? 0n,
        countsAgainstBatch: (BATCH_CLAIM_ACTIVE_STATUSES as readonly string[]).includes(claim.status)
      }))
    ];
    return calculateActualPurchaseBatchCapacity(row.effectiveTotalAmountCents, payments);
  }

  async assertSpotPaymentCommitInTransaction(tx: Prisma.TransactionClient, paymentId: string, requestedAmountCents: bigint) {
    const payment = await tx.spotProcurementPayment.findUnique({ where: { id: paymentId }, select: { actualPurchaseBatchId: true } });
    if (!payment?.actualPurchaseBatchId) return;
    const capacity = await this.calculateCapacity(tx, payment.actualPurchaseBatchId, { excludeSpotPaymentId: paymentId });
    assertActualPurchaseBatchCommitment(capacity, requestedAmountCents);
  }

  async assertSpotPaymentExecutionInTransaction(tx: Prisma.TransactionClient, paymentId: string, amountCents: bigint) {
    const payment = await tx.spotProcurementPayment.findUnique({ where: { id: paymentId }, select: { actualPurchaseBatchId: true } });
    if (!payment?.actualPurchaseBatchId) return;
    const capacity = await this.calculateCapacity(tx, payment.actualPurchaseBatchId);
    assertActualPurchaseBatchExecution(capacity, amountCents);
  }

  /** 只读容量快照：供垫付报销选择现有采购批次时展示剩余可付金额。 */
  async capacityForBatch(batchId: string) {
    return this.prisma.$transaction((tx) => this.calculateCapacity(tx, batchId));
  }

  async assertClaimCommitInTransaction(tx: Prisma.TransactionClient, input: { batchId: string; amountCents: bigint; excludeClaimId?: string }) {
    const capacity = await this.calculateCapacity(tx, input.batchId, { excludeClaimId: input.excludeClaimId });
    assertActualPurchaseBatchCommitment(capacity, input.amountCents);
  }

  /** 首批付款/报销审批通过时确认整批实际成本；重复调用不产生第二笔成本。 */
  async confirmCostForSpotPaymentInTransaction(tx: Prisma.TransactionClient, paymentId: string, actorUserId: string, confirmedAt = new Date()) {
    const payment = await tx.spotProcurementPayment.findUnique({ where: { id: paymentId }, select: { actualPurchaseBatchId: true } });
    if (!payment?.actualPurchaseBatchId) return;
    await this.confirmBatchCostInTransaction(tx, payment.actualPurchaseBatchId, actorUserId, confirmedAt);
  }

  async confirmCostForClaimInTransaction(tx: Prisma.TransactionClient, claimId: string, actorUserId: string, confirmedAt = new Date()) {
    const claim = await tx.expenseClaim.findUnique({ where: { id: claimId }, select: { actualPurchaseBatchId: true } });
    if (!claim?.actualPurchaseBatchId) return;
    await this.confirmBatchCostInTransaction(tx, claim.actualPurchaseBatchId, actorUserId, confirmedAt);
  }

  private async confirmBatchCostInTransaction(tx: Prisma.TransactionClient, batchId: string, actorUserId: string, confirmedAt: Date) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
    const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("实际采购批次不存在");
    if (batch.costVersion > 0) return;
    const factId = await this.appendBatchCostFactInTransaction(tx, batch, actorUserId, batch.totalAmountCents, confirmedAt);
    await tx.actualPurchaseBatch.update({
      where: { id: batch.id },
      data: { status: "cost_confirmed", costVersion: 1, costConfirmedAt: confirmedAt, costConfirmedByUserId: actorUserId, costFactId: factId }
    });
    await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.cost.confirm", businessType: "actual_purchase_batch", businessId: batch.id, metadata: { totalAmountCents: batch.totalAmountCents.toString(), costFactId: factId } });
  }

  private async appendBatchCostFactInTransaction(tx: Prisma.TransactionClient, batch: BatchRow, actorUserId: string, amountCents: bigint, occurredAt: Date): Promise<string | null> {
    if (!batch.projectId) return null;
    const affiliate = await readAffiliateSnapshot(tx, { projectId: batch.projectId, occurredAt });
    const effectiveDate = await readOperatingLedgerEffectiveDate(tx, batch.projectId);
    const company = batch.kind === "general"
      ? { kind: "participating_company" as const, id: this.text(batch.companyEntityId, "费用承担公司") }
      : { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId };
    const costCategoryCode: BatchCostCategoryCode = batch.kind === "spot_material" ? "material" : await this.generalCostCategory(tx, batch);
    const input = {
      projectId: batch.projectId,
      sourceType: ACTUAL_PURCHASE_BATCH_SOURCE_TYPE,
      sourceBusinessId: batch.id,
      sourceBusinessCode: `实际采购批次/${batch.supplierName}/${batch.id.slice(0, 8)}`,
      sourceVersion: 1,
      idempotencyKey: `${ACTUAL_PURCHASE_BATCH_SOURCE_TYPE}:${batch.id}:cost`,
      occurredAt,
      confirmedAt: occurredAt,
      confirmedByUserId: actorUserId,
      factKind: "expense" as const,
      operatingLevel: batch.kind === "general" ? "participating_company" as const : "project" as const,
      evidenceLevel: "A" as const,
      amountCents,
      currencyCode: "CNY",
      direction: "outflow" as const,
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(occurredAt, effectiveDate),
      affiliateAssignmentId: affiliate.assignmentId,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name,
      ...(affiliate.creditCode ? { affiliateCreditCodeSnapshot: affiliate.creditCode } : {}),
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        batchId: batch.id,
        kind: batch.kind,
        procurementId: batch.procurementId,
        procurementVersionId: batch.procurementVersionId,
        supplierName: batch.supplierName,
        totalAmountCents: batch.totalAmountCents.toString(),
        affiliate: { assignmentId: affiliate.assignmentId, businessPartyVersionId: affiliate.businessPartyVersionId, name: affiliate.name, ...(affiliate.creditCode ? { creditCode: affiliate.creditCode } : {}) }
      }),
      basisSnapshot: sourceJson({ authority: "actual_purchase_batch", batchId: batch.id }),
      subjects: { costBearingCompany: company },
      impacts: [
        {
          idempotencyKey: `${ACTUAL_PURCHASE_BATCH_SOURCE_TYPE}:${batch.id}:cost:confirmed_cost`,
          sourceImpactKey: "confirmed_cost",
          impactKind: "confirmed_cost" as const,
          amountCents,
          direction: "increase" as const,
          subjectRole: "cost_bearing_company" as const,
          subject: company,
          costCategoryCode,
          description: "实际采购批次确认采购成本"
        }
      ]
    };
    const result = await this.ledger.appendConfirmedSourceInTransaction(tx, input, actorUserId, "original");
    return result.id;
  }

  private async generalCostCategory(tx: Prisma.TransactionClient, batch: BatchRow): Promise<Exclude<BatchCostCategoryCode, "material">> {
    const procurement = await tx.generalProcurement.findUnique({ where: { id: batch.procurementId }, select: { category: true } });
    const category = procurement?.category ?? "";
    return (BATCH_COST_CATEGORY_BY_PROCUREMENT as Record<string, Exclude<BatchCostCategoryCode, "material">>)[category] ?? "other_project_cost";
  }

  async requestCorrection(actorUserId: string, batchId: string, input: RequestActualPurchaseBatchCorrectionDto) {
    const correctedTotalAmountCents = parseMoneyCentsInput(input.correctedTotalAmountCents, "更正后实际采购金额", "更正后实际采购金额必须按分填写为大于 0 的整数");
    if (correctedTotalAmountCents <= 0n) throw new BadRequestException("更正后实际采购金额必须大于 0");
    const reason = this.text(input.reason, "更正原因");
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      await this.requireAnyRole(tx, actorUserId, batch.projectId, FINANCE_ROLES, "只有财务人员或综合部主管可以发起实际采购批次更正");
      if (batch.costVersion <= 0) throw new ConflictException("实际采购批次成本尚未确认，请先按首批付款确认成本");
      if (correctedTotalAmountCents === batch.effectiveTotalAmountCents) throw new BadRequestException("更正后金额与原金额相同，无需更正");
      const fingerprint = this.fingerprint({ kind: "correction", batchId, actorUserId, correctedTotalAmountCents: correctedTotalAmountCents.toString(), reason });
      const existing = await tx.actualPurchaseBatchCorrection.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) throw new ConflictException("更正登记幂等键已用于不同请求，请查询原结果");
        return this.correctionView(existing);
      }
      const open = await tx.actualPurchaseBatchCorrection.findFirst({ where: { batchId, status: "pending_confirm" }, select: { id: true } });
      if (open) throw new ConflictException("该实际采购批次已有待财务主管确认的更正");
      const originalSnapshot = { batchId, totalAmountCents: batch.totalAmountCents.toString(), effectiveTotalAmountCents: batch.effectiveTotalAmountCents.toString(), costVersion: batch.costVersion, costFactId: batch.costFactId };
      const correction = await tx.actualPurchaseBatchCorrection.create({
        data: {
          batchId,
          idempotencyKey: input.idempotencyKey,
          status: "pending_confirm",
          originalTotalAmountCents: batch.effectiveTotalAmountCents,
          correctedTotalAmountCents,
          correctionDeltaCents: correctedTotalAmountCents - batch.effectiveTotalAmountCents,
          reason,
          originalSnapshot: originalSnapshot as Prisma.InputJsonValue,
          reversalSnapshot: { reversesCostFactId: batch.costFactId, amountCents: batch.effectiveTotalAmountCents.toString() } as Prisma.InputJsonValue,
          correctionSnapshot: { correctedTotalAmountCents: correctedTotalAmountCents.toString() } as Prisma.InputJsonValue,
          requestedByUserId: actorUserId,
          payloadFingerprint: fingerprint
        }
      });
      const position = await tx.position.findUnique({ where: { key: "finance_director" }, select: { id: true } });
      const financeDirectors = position
        ? await tx.userPosition.findMany({ where: { positionId: position.id, projectId: null }, select: { userId: true } })
        : [];
      const activeRecipients = financeDirectors.length
        ? await tx.user.findMany({ where: { id: { in: financeDirectors.map((row) => row.userId) }, isActive: true }, select: { id: true } })
        : [];
      const round = await tx.approvalInstance.create({
        data: {
          flowType: "actual_purchase_batch_correction.confirm",
          businessType: "actual_purchase_batch_correction",
          businessId: correction.id,
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: actorUserId,
          frozenNodes: [{ name: "财务主管确认实际采购更正", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: [], protocolVersion: 1 }] as unknown as Prisma.InputJsonValue
        }
      });
      await this.notifications?.queueCorrectionInTransaction(tx, {
        roundId: round.id,
        batchId,
        correctionId: correction.id,
        supplierName: batch.supplierName,
        originalTotalAmountCents: batch.effectiveTotalAmountCents.toString(),
        correctedTotalAmountCents: correctedTotalAmountCents.toString(),
        reason,
        actorUserId,
        recipientIds: activeRecipients.map((row) => row.id)
      });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.correction.request", businessType: "actual_purchase_batch", businessId: batchId, metadata: { correctionId: correction.id, approvalInstanceId: round.id, originalTotalAmountCents: batch.effectiveTotalAmountCents.toString(), correctedTotalAmountCents: correctedTotalAmountCents.toString(), reason, correctionRecipients: activeRecipients.length } });
      return this.correctionView(correction);
    });
    void this.notifications?.dispatchQueued().catch(() => undefined);
    return result;
  }

  async confirmCorrection(actorUserId: string, batchId: string, correctionId: string, input: ConfirmActualPurchaseBatchCorrectionDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      const roles = await this.requireAnyRole(tx, actorUserId, batch.projectId, ["finance_director"], "只有财务主管可以确认实际采购批次更正");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatchCorrection" WHERE "id" = ${correctionId} FOR UPDATE`);
      const correction = await tx.actualPurchaseBatchCorrection.findUnique({ where: { id: correctionId } });
      if (!correction || correction.batchId !== batchId) throw new NotFoundException("实际采购批次更正不存在");
      if (correction.status === "confirmed") {
        if (correction.confirmationKey !== input.confirmationKey) throw new ConflictException("该更正已由其他确认键确认，请刷新后核对");
        return this.correctionView(correction);
      }
      const selfReview = correction.requestedByUserId === actorUserId;
      if (selfReview) {
        if (!this.optional(input.selfReviewReason)) throw new BadRequestException("本人发起并确认更正时必须填写自审原因");
        const password = this.text(input.confirmationPassword, "当前登录密码");
        await this.auth.confirmPassword(actorUserId, password);
      }
      const duplicate = await tx.actualPurchaseBatchCorrection.findUnique({ where: { confirmationKey: input.confirmationKey } });
      if (duplicate) throw new ConflictException("确认键已用于其他更正，请刷新后核对");
      const confirmedAt = new Date();
      const delta = correction.correctionDeltaCents;
      const factId = await this.appendBatchCorrectionFactInTransaction(tx, batch, correction.id, delta, actorUserId, confirmedAt);
      const updated = await tx.actualPurchaseBatchCorrection.update({
        where: { id: correction.id },
        data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt, confirmationKey: input.confirmationKey, selfReviewReason: this.optional(input.selfReviewReason), reviewNote: this.optional(input.reviewNote) }
      });
      await tx.approvalInstance.updateMany({
        where: { businessType: "actual_purchase_batch_correction", businessId: correction.id, status: "approval_pending" },
        data: { status: "approved", currentNodeIndex: 1, frozenNodes: [{ name: "财务主管确认实际采购更正", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"], protocolVersion: 1 }] as unknown as Prisma.InputJsonValue }
      });
      await tx.actualPurchaseBatch.update({
        where: { id: batch.id },
        data: { effectiveTotalAmountCents: correction.correctedTotalAmountCents, costVersion: batch.costVersion + 1, costConfirmedAt: confirmedAt, costConfirmedByUserId: actorUserId, ...(factId ? { costFactId: batch.costFactId ?? factId } : {}) }
      });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.correction.confirm", businessType: "actual_purchase_batch", businessId: batch.id, metadata: { correctionId: correction.id, originalTotalAmountCents: correction.originalTotalAmountCents.toString(), correctedTotalAmountCents: correction.correctedTotalAmountCents.toString(), deltaCents: delta.toString(), roles: roles.join(","), selfReview } });
      return this.correctionView(updated);
    });
  }

  private async appendBatchCorrectionFactInTransaction(tx: Prisma.TransactionClient, batch: BatchRow, correctionId: string, deltaCents: bigint, actorUserId: string, confirmedAt: Date): Promise<string | null> {
    if (!batch.projectId || !batch.costFactId) return null;
    const affiliate = await readAffiliateSnapshot(tx, { projectId: batch.projectId, occurredAt: confirmedAt });
    const effectiveDate = await readOperatingLedgerEffectiveDate(tx, batch.projectId);
    const company = batch.kind === "general"
      ? { kind: "participating_company" as const, id: this.text(batch.companyEntityId, "费用承担公司") }
      : { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId };
    const costCategoryCode: BatchCostCategoryCode = batch.kind === "spot_material" ? "material" : await this.generalCostCategory(tx, batch);
    const amountCents = deltaCents < 0n ? -deltaCents : deltaCents;
    const direction = deltaCents < 0n ? "inflow" as const : "outflow" as const;
    const impactDirection = deltaCents < 0n ? "decrease" as const : "increase" as const;
    const input = {
      projectId: batch.projectId,
      sourceType: ACTUAL_PURCHASE_BATCH_SOURCE_TYPE,
      sourceBusinessId: `${batch.id}:correction:${correctionId}`,
      sourceBusinessCode: `实际采购批次更正/${batch.supplierName}/${correctionId.slice(0, 8)}`,
      sourceVersion: 2,
      idempotencyKey: `${ACTUAL_PURCHASE_BATCH_SOURCE_TYPE}:${correctionId}:correction`,
      adjustsFactId: batch.costFactId,
      occurredAt: confirmedAt,
      confirmedAt,
      confirmedByUserId: actorUserId,
      factKind: "expense" as const,
      operatingLevel: batch.kind === "general" ? "participating_company" as const : "project" as const,
      evidenceLevel: "A" as const,
      amountCents,
      currencyCode: "CNY",
      direction,
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(confirmedAt, effectiveDate),
      affiliateAssignmentId: affiliate.assignmentId,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name,
      ...(affiliate.creditCode ? { affiliateCreditCodeSnapshot: affiliate.creditCode } : {}),
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        batchId: batch.id,
        correctionId,
        originalOperatingFactId: batch.costFactId,
        deltaCents: deltaCents.toString()
      }),
      basisSnapshot: sourceJson({ authority: "actual_purchase_batch_correction", batchId: batch.id, correctionId }),
      subjects: { costBearingCompany: company },
      impacts: [
        {
          idempotencyKey: `${ACTUAL_PURCHASE_BATCH_SOURCE_TYPE}:${correctionId}:correction:confirmed_cost`,
          sourceImpactKey: "confirmed_cost",
          impactKind: "confirmed_cost" as const,
          amountCents,
          direction: impactDirection,
          subjectRole: "cost_bearing_company" as const,
          subject: company,
          costCategoryCode,
          description: deltaCents < 0n ? "实际采购批次更正调减采购成本" : "实际采购批次更正调增采购成本"
        }
      ]
    };
    const result = await this.ledger.appendConfirmedSourceInTransaction(tx, input, actorUserId, "correction");
    return result.id;
  }

  async createSpotPayment(actorUserId: string, batchId: string, input: CreateBatchSpotPaymentDto) {
    const requestedAmountCents = parseMoneyCentsInput(input.requestedAmountCents, "本次付款申请金额", "本次付款申请金额必须按分填写为大于 0 的整数");
    if (requestedAmountCents <= 0n) throw new BadRequestException("本次付款申请金额必须大于 0");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActualPurchaseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      if (batch.kind !== "spot_material") throw new ConflictException("综合采购批次请从报销/付款入口发起");
      const { procurement, version } = await this.loadSpotProcurement(tx, batch.procurementId);
      const roles = await this.requireAnyRole(tx, actorUserId, procurement.projectId, ["material_staff", "material_director"], "只有项目物资员或物资部主管可以发起采购付款");
      if (actorUserId !== version.handlerUserId && !roles.includes("material_director")) throw new ForbiddenException("只有采购经办人或物资部主管可以发起采购付款");
      const capacity = await this.calculateCapacity(tx, batchId);
      assertActualPurchaseBatchCommitment(capacity, requestedAmountCents);
      if (new Set(input.paymentMethods).size !== input.paymentMethods.length) throw new BadRequestException("拟付款方式不能重复");
      if (input.channels.filter((channel) => channel.isPrimary).length !== 1) throw new BadRequestException("必须且只能选择一个主收款渠道");
      const payeeName = input.paymentType === "handler_reimbursement" ? this.text((await tx.user.findUnique({ where: { id: actorUserId }, select: { name: true } }))?.name, "采购经办人姓名") : this.text(input.payeeName, "收款对象");
      const merchantPayeeMismatchNote = input.paymentType === "handler_reimbursement" ? "经办人垫付后报回" : batch.supplierName === payeeName ? null : this.text(input.merchantPayeeMismatchNote, "实际商户与收款对象不一致说明");
      const primary = input.channels.find((channel) => channel.isPrimary)!;
      if (!input.paymentMethods.includes(primary.channelType)) throw new BadRequestException("主收款渠道必须属于已选择的拟付款方式");
      const merchant = batch.supplierName;
      const { code } = await this.nextSpotPaymentCode(tx, procurement.code, version.versionNo, procurement.id);
      const payment = await tx.spotProcurementPayment.create({
        data: {
          projectId: procurement.projectId,
          procurementId: procurement.id,
          procurementVersionId: version.id,
          actualPurchaseBatchId: batch.id,
          code,
          status: "draft",
          settlementAmountCents: requestedAmountCents,
          supplierBalanceAmountCents: 0n,
          companyPaymentAmountCents: requestedAmountCents,
          paidAmountCents: 0n,
          executedSupplierBalanceAmountCents: 0n,
          canceledAmountCents: 0n,
          canceledCompanyPaymentAmountCents: 0n,
          canceledSupplierBalanceAmountCents: 0n,
          paymentPath: input.paymentType === "company_direct" ? "supplier_direct" : "handler_reimbursement",
          paymentMethod: primary.channelType,
          paymentType: input.paymentType,
          merchantNameSnapshot: merchant,
          merchantPayeeMismatchNote,
          payeeNameSnapshot: payeeName,
          payeeAccountNameSnapshot: this.optional(primary.accountName),
          payeeBankNameSnapshot: this.optional(primary.bankName),
          payeeBankAccountSnapshot: this.optional(primary.accountNumber),
          approvalAmountCents: requestedAmountCents,
          handlerUserId: version.handlerUserId,
          createdByUserId: actorUserId,
          draftOrigin: "actual_purchase_batch",
          paymentNote: null
        }
      });
      const channels = [];
      for (const [index, channel] of input.channels.entries()) {
        channels.push(await tx.spotProcurementPaymentChannel.create({
          data: {
            paymentId: payment.id,
            sortOrder: index + 1,
            channelType: channel.channelType,
            accountNameSnapshot: this.optional(channel.accountName),
            accountNumberSnapshot: this.optional(channel.accountNumber),
            bankNameSnapshot: this.optional(channel.bankName),
            channelNote: this.optional(channel.note),
            isPrimary: channel.isPrimary
          }
        }));
      }
      await tx.spotProcurementPaymentMethodOption.createMany({
        data: input.paymentMethods.map((paymentMethod, index) => ({ paymentId: payment.id, paymentMethod, sortOrder: index + 1 }))
      });
      await tx.spotProcurementPayment.update({ where: { id: payment.id }, data: { primaryPaymentChannelId: channels.find((channel) => channel.isPrimary)?.id ?? null } });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.spot_payment.create", businessType: "actual_purchase_batch", businessId: batch.id, metadata: { paymentId: payment.id, code, requestedAmountCents: requestedAmountCents.toString(), batchTotalAmountCents: batch.effectiveTotalAmountCents.toString() } });
      return { id: payment.id, code, status: "draft", batchId: batch.id, requestedAmountCents: moneyCentsToApi(requestedAmountCents), settlementAmountCents: moneyCentsToApi(payment.settlementAmountCents) };
    });
  }

  private async nextSpotPaymentCode(tx: Prisma.TransactionClient, procurementCode: string, versionNo: number, procurementId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${procurementId} FOR UPDATE`);
    const prefix = `${procurementCode}-V${versionNo}-P`;
    const rows = await tx.spotProcurementPayment.findMany({ where: { procurementId }, select: { code: true } });
    let highest = 0;
    for (const row of rows) {
      if (!row.code.startsWith(prefix)) continue;
      const suffix = row.code.slice(prefix.length);
      if (!/^\d+$/u.test(suffix)) continue;
      highest = Math.max(highest, Number(suffix));
    }
    return { code: `${prefix}${String(highest + 1).padStart(3, "0")}` };
  }

  async recordRefund(actorUserId: string, batchId: string, input: RecordActualPurchaseBatchRefundDto) {
    const amountCents = parseMoneyCentsInput(input.amountCents, "退款金额", "退款金额必须按分填写为大于 0 的整数");
    if (amountCents <= 0n) throw new BadRequestException("退款金额必须大于 0");
    const reason = this.text(input.reason, "退款原因");
    const receivedAt = requiredPastChinaDate(input.receivedAt, "退款到账日期");
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("实际采购批次不存在");
      await this.requireAnyRole(tx, actorUserId, batch.projectId, FINANCE_ROLES, "只有财务人员或综合部主管可以登记实际收到的退款");
      if (!batch.projectId) throw new ConflictException("公司日常采购批次退款需由财务在资金账户登记后处理");
      const execution = input.executionType === "spot_procurement_payment_execution"
        ? await tx.spotProcurementPaymentExecution.findFirst({ where: { id: input.executionId, voidedAt: null }, select: { id: true, paymentId: true, amountCents: true, paidAt: true } })
        : await tx.expenseClaimPaymentExecution.findFirst({ where: { id: input.executionId }, select: { id: true, expenseClaimId: true, amountCents: true, paidAt: true } });
      if (!execution) throw new NotFoundException("待退款的实付记录不存在");
      const belongsToBatch = input.executionType === "spot_procurement_payment_execution"
        ? (await tx.spotProcurementPayment.findUnique({ where: { id: (execution as { paymentId: string }).paymentId }, select: { actualPurchaseBatchId: true } }))?.actualPurchaseBatchId === batchId
        : (await tx.expenseClaim.findUnique({ where: { id: (execution as { expenseClaimId: string }).expenseClaimId }, select: { actualPurchaseBatchId: true } }))?.actualPurchaseBatchId === batchId;
      if (!belongsToBatch) throw new NotFoundException("待退款的实付记录不属于该实际采购批次");
      const fingerprint = this.fingerprint({ kind: "actual_purchase_batch_refund", batchId, executionType: input.executionType, executionId: input.executionId, actorUserId, amountCents: amountCents.toString(), receivedAt: chinaDateOnly(receivedAt), reason, accountId: this.optional(input.accountId) });
      const existing = await tx.paymentExecutionRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) throw new ConflictException("退款登记幂等键已用于不同请求，请查询原结果");
        return { id: existing.id, amountCents: existing.amountCents.toString(), replayed: true };
      }
      const refunded = await tx.paymentExecutionRefund.aggregate({
        where: input.executionType === "spot_procurement_payment_execution"
          ? { executionType: input.executionType, spotProcurementPaymentExecutionId: execution.id }
          : { executionType: input.executionType, expenseClaimPaymentExecutionId: execution.id },
        _sum: { amountCents: true }
      });
      const already = refunded._sum.amountCents ?? 0n;
      if (already + amountCents > execution.amountCents) throw new BadRequestException(`累计退款不得超过原实付 ${moneyCentsToApi(execution.amountCents)} 分`);
      const accountId = this.text(input.accountId, "实际收款的资金账户");
      const refundId = randomUUID();
      const funding = await appendPaymentFinancialFunding(tx, {
        kind: "payment_refund",
        direction: "credit",
        accountId,
        projectId: batch.projectId,
        executionId: execution.id,
        referenceId: refundId,
        reason,
        occurredOn: chinaDateOnly(receivedAt),
        amountCents,
        actorUserId,
        actorRoles: await this.actorRoles(tx, actorUserId, batch.projectId)
      });
      const refund = await tx.paymentExecutionRefund.create({
        data: {
          id: refundId,
          idempotencyKey: input.idempotencyKey,
          executionType: input.executionType,
          ...(input.executionType === "spot_procurement_payment_execution"
            ? { spotProcurementPaymentExecutionId: execution.id }
            : { expenseClaimPaymentExecutionId: execution.id }),
          projectId: batch.projectId,
          accountId,
          fundRegistrationId: funding.registrationId,
          amountCents,
          receivedAt,
          reason,
          evidenceReference: this.optional(input.evidenceReference),
          recordedByUserId: actorUserId,
          payloadFingerprint: fingerprint
        }
      });
      await this.audit.record(tx, { actorUserId, action: "actual_purchase_batch.refund.record", businessType: "actual_purchase_batch", businessId: batchId, metadata: { refundId: refund.id, executionType: input.executionType, executionId: execution.id, amountCents: amountCents.toString(), accountId } });
      return { id: refund.id, amountCents: moneyCentsToApi(amountCents), replayed: false };
    });
  }

  private correctionView(row: { id: string; status: string; originalTotalAmountCents: bigint; correctedTotalAmountCents: bigint; correctionDeltaCents: bigint; reason: string; requestedByUserId: string; confirmedByUserId: string | null; confirmedAt: Date | null; createdAt: Date }) {
    return {
      id: row.id,
      status: row.status,
      originalTotalAmountCents: moneyCentsToApi(row.originalTotalAmountCents),
      correctedTotalAmountCents: moneyCentsToApi(row.correctedTotalAmountCents),
      correctionDeltaCents: moneyCentsToApi(row.correctionDeltaCents),
      reason: row.reason,
      requestedByUserId: row.requestedByUserId,
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt
    };
  }
}
