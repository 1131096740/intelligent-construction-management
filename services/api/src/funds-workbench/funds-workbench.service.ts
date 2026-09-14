import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MeService, type FundsPendingReadBudget } from "../me/me.service";
import { moneyCentsToApi } from "../money/decimal-money";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { executionHasActiveVoucher } from "../spot-procurement/spot-payment-voucher";
import { spotPaymentRefundOwnerId } from "../spot-procurement/spot-payment-refund-owner";

const FUND_SOURCES = [
  "contract_payment",
  "spot_procurement_payment",
  "expense_reimbursement",
  "incidental_expense",
  "loan_disbursement"
] as const;

const FUND_VIEWS = ["all", "pending_action", "in_progress", "pending_funds", "partial_payment", "pending_refund", "pending_evidence", "completed"] as const;
const DATABASE_IN_BATCH_SIZE = 500;
const RESPONSE_BUDGET_BYTES = 8 * 1024 * 1024;
const FUND_QUERY_ROW_BUDGET = 10_000;
const NON_FORMAL_FUND_STATUSES = [
  "draft",
  "rejected",
  "abandoned",
  "invalidated",
  "voided"
] as const;

type FundSource = (typeof FUND_SOURCES)[number];
type FundView = (typeof FUND_VIEWS)[number];

type FundRow = {
  id: string;
  code: string;
  source: FundSource;
  project: { id: string; code: string; name: string } | null;
  sourceDocument: string;
  reason: string;
  payeeName: string | null;
  payerName: string | null;
  requestedAmountCents: string;
  paidAmountCents: string | null;
  remainingAmountCents: string | null;
  status: string;
  statusLabel: string;
  pendingRefund: boolean;
  pendingEvidence: boolean;
  pendingMyAction: boolean;
  updatedAt: string;
};

@Injectable()
export class FundsWorkbenchService {
  constructor(
    private readonly me: MeService,
    private readonly operatingProjection: OperatingProjectionService
  ) {}

  async list(actorUserId: string, input: { view?: string; source?: string }) {
    const view = this.view(input.view);
    const source = this.source(input.source);
    const snapshot = await this.operatingProjection.readFundsCompatibilitySnapshot(
        actorUserId,
        {},
        async (tx, visibleProjectIds, context) => {
          const queryBudget = new FundsQueryBudget();
          const pendingBusinessIds = await this.me.getFundsPendingBusinessIdsInTransaction(
            tx,
            actorUserId,
            visibleProjectIds,
            context.readAt,
            queryBudget
          );
          const pendingContractPaymentIds = new Set(
            pendingBusinessIds.contractPaymentIds
          );
          const pendingSpotPaymentIds = new Set(
            pendingBusinessIds.spotPaymentIds
          );
          const narrowSpotPaymentIds = fundSourceEnabled(
            "spot_procurement_payment",
            source,
            view
          )
            ? await readNarrowSpotPaymentIds(
                tx,
                view,
                visibleProjectIds,
                queryBudget
              )
            : null;
          const databaseCounts = await countFundsViewsInTransaction(
            tx,
            visibleProjectIds,
            source,
            pendingContractPaymentIds,
            pendingSpotPaymentIds,
            context.moneyComplete,
            context.sourceReferenceTotals,
            queryBudget
          );
          const status = fundStatusWhere(view);
          const payments = fundSourceEnabled("contract_payment", source, view) &&
              (view !== "pending_action" || pendingContractPaymentIds.size > 0)
              ? await collectFundsInBatches(visibleProjectIds, queryBudget, (ids, _index, remaining) => tx.paymentRequest.findMany({
              where: {
                projectId: { in: ids },
                status,
                ...(view === "pending_action"
                  ? { id: { in: [...pendingContractPaymentIds] } }
                  : {})
              },
              select: {
                id: true, code: true, projectId: true, settlementId: true, sourceType: true, status: true,
                requestedAmountCents: true, updatedAt: true
              },
              take: remaining + 1
            }))
              : [];
          const spotPayments = fundSourceEnabled("spot_procurement_payment", source, view) &&
              (view !== "pending_action" || pendingSpotPaymentIds.size > 0) &&
              (narrowSpotPaymentIds === null || narrowSpotPaymentIds.paymentIds.size > 0)
              ? await collectFundsInBatches(visibleProjectIds, queryBudget, (ids, _index, remaining) => tx.spotProcurementPayment.findMany({
              where: {
                projectId: { in: ids },
                status,
                ...(view === "pending_action"
                  ? { id: { in: [...pendingSpotPaymentIds] } }
                  : narrowSpotPaymentIds
                    ? { id: { in: [...narrowSpotPaymentIds.paymentIds] } }
                    : {})
              },
              select: {
                id: true, code: true, projectId: true, procurementId: true, procurementVersionId: true, status: true, createdAt: true,
                companyPaymentAmountCents: true, paymentNote: true,
                payeeNameSnapshot: true, payerCompanyNameSnapshot: true, updatedAt: true
              },
              take: remaining + 1
            }))
              : [];
          const expenses = expenseClaimTypes(source, view).length
              ? await collectFundsInBatches(visibleProjectIds.length ? visibleProjectIds : [null], queryBudget,
              (ids, index, remaining) => tx.expenseClaim.findMany({
                where: {
                  OR: [
                    ...ids.filter((id): id is string => id !== null).length
                      ? [{ projectId: { in: ids.filter((id): id is string => id !== null) } }]
                      : [],
                    ...(index === 0 ? [{ projectId: null }] : [])
                  ],
                  claimType: { in: expenseClaimTypes(source, view) },
                  status
                },
                select: {
                  id: true, code: true, claimType: true, status: true, projectId: true, reason: true,
                  companyEntityNameSnapshot: true, paymentSubjectNameSnapshot: true, payeeNameSnapshot: true, requestedAmountCents: true,
                  companyPayableAmountCents: true, fundedAmountCents: true, updatedAt: true
                },
                take: remaining + 1
              }))
              : [];
          const referencedProjectIds = [...new Set([
            ...payments.map((payment) => payment.projectId),
            ...spotPayments.map((payment) => payment.projectId),
            ...expenses.map((expense) => expense.projectId)
          ].filter((projectId): projectId is string => Boolean(projectId)))];
          const projects = await collectFundsInBatches(
            referencedProjectIds,
            queryBudget,
            (ids, _index, remaining) => tx.project.findMany({
              where: { id: { in: ids } },
              select: { id: true, code: true, name: true },
              take: remaining + 1
            })
          );
          const awaitingRefundDiscrepancies = spotPayments.length && narrowSpotPaymentIds === null
              ? await collectFundsInBatches(
                [...new Set(spotPayments.map((payment) => payment.procurementVersionId))],
                queryBudget,
                (ids, _index, remaining) => tx.spotProcurementDiscrepancy.findMany({
                  where: {
                    status: "awaiting_refund",
                    resolutionType: "full_refund",
                    invalidatedAt: null,
                    procurementVersionId: { in: ids }
                  },
                  select: { procurementId: true, procurementVersionId: true },
                  take: remaining + 1
                })
              )
            : [];
          const spotPaymentIds = spotPayments.map((payment) => payment.id);
          const executions = spotPaymentIds.length && narrowSpotPaymentIds === null
            ? await collectFundsInBatches(spotPaymentIds, queryBudget, (ids, _index, remaining) =>
              tx.spotProcurementPaymentExecution.findMany({
                where: { paymentId: { in: ids }, voidedAt: null },
                select: { id: true, paymentId: true, voucherFileId: true },
                take: remaining + 1
              }))
            : [];
          const executionVouchers = executions.length
            ? await collectFundsInBatches(executions.map((execution) => execution.id), queryBudget, (ids, _index, remaining) =>
              tx.spotProcurementPaymentExecutionVoucher.findMany({
                where: { paymentExecutionId: { in: ids } },
                select: { paymentExecutionId: true, fileId: true },
                take: remaining + 1
              }))
            : [];
          const voucherFileIds = [...new Set([
            ...executions.map((execution) => execution.voucherFileId),
            ...executionVouchers.map((voucher) => voucher.fileId)
          ].filter((fileId): fileId is string => Boolean(fileId)))];
          const activeVoucherFileIds = voucherFileIds.length
            ? new Set((await collectFundsInBatches(voucherFileIds, queryBudget, (ids, _index, remaining) =>
              tx.fileObject.findMany({
                where: { id: { in: ids }, storageStatus: "active" },
                select: { id: true },
                take: remaining + 1
              }))).map((file) => file.id))
            : new Set<string>();
          return {
            projects,
            payments,
            spotPayments,
            expenses,
            awaitingRefundDiscrepancies,
            executions,
            executionVouchers,
            activeVoucherFileIds,
            pendingContractPaymentIds,
            pendingSpotPaymentIds,
            narrowRefundPaymentIds: narrowSpotPaymentIds?.refundPaymentIds ?? new Set<string>(),
            narrowEvidencePaymentIds: narrowSpotPaymentIds?.evidencePaymentIds ?? new Set<string>(),
            databaseCounts
          };
        }
      );
    const projection = snapshot;
    const {
      projects,
      payments,
      spotPayments,
      expenses,
      awaitingRefundDiscrepancies,
      executions,
      executionVouchers,
      activeVoucherFileIds,
      pendingContractPaymentIds,
      pendingSpotPaymentIds,
      narrowRefundPaymentIds,
      narrowEvidencePaymentIds,
      databaseCounts
    } = snapshot.additional;
    const pendingRefundSpotPaymentIds = new Set([
      ...narrowRefundPaymentIds,
      ...awaitingRefundDiscrepancies
        .map((discrepancy) => spotPaymentRefundOwnerId(discrepancy, spotPayments))
        .filter((paymentId): paymentId is string => Boolean(paymentId))
    ]);
    const vouchersByExecutionId = new Map<string, Array<{ fileId: string }>>();
    for (const voucher of executionVouchers) {
      vouchersByExecutionId.set(voucher.paymentExecutionId, [
        ...(vouchersByExecutionId.get(voucher.paymentExecutionId) ?? []),
        { fileId: voucher.fileId }
      ]);
    }
    const pendingEvidenceSpotPaymentIds = new Set([
      ...narrowEvidencePaymentIds,
      ...executions
        .filter((execution) => !executionHasActiveVoucher(execution, activeVoucherFileIds, vouchersByExecutionId))
        .map((execution) => execution.paymentId)
    ]);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const projectedPaidBySourceId = new Map(
      projection.sourceReferenceTotals.map((row) => [
        row.sourceReferenceId,
        BigInt(row.confirmedProjectOutflowCents)
      ])
    );
    const projectedPaid = (sourceId: string, projectId: string | null) =>
      !projection.integrity.moneyComplete || !projectId
        ? null
        : projectedPaidBySourceId.get(sourceId) ?? 0n;
    const rows: FundRow[] = [
      ...payments.map((payment) => this.contractPaymentRow(
        payment,
        projectedPaid(payment.id, payment.projectId),
        projectById,
        pendingContractPaymentIds.has(payment.id)
      )),
      ...spotPayments.map((payment) => this.spotPaymentRow(
        payment,
        projectedPaid(payment.id, payment.projectId),
        projectById,
        pendingRefundSpotPaymentIds.has(payment.id),
        pendingEvidenceSpotPaymentIds.has(payment.id),
        pendingSpotPaymentIds.has(payment.id)
      )),
      ...expenses.flatMap((expense) => this.expenseRows(
        expense,
        expense.projectId === null && ["reimbursement", "loan"].includes(expense.claimType)
          ? expense.fundedAmountCents
          : projectedPaid(expense.id, expense.projectId),
        projectById
      ))
    ];
    const formalRows = rows.filter((row) => this.isFormal(row));
    const sourceRows = formalRows.filter((row) => !source || row.source === source);
    const selected = sourceRows
      .filter((row) => this.inView(row, view))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.code.localeCompare(right.code));

    const response = {
      view,
      source: source ?? "all",
      items: selected,
      viewCounts: databaseCounts?.viewCounts ?? Object.fromEntries(
        FUND_VIEWS.map((candidate) => [candidate, sourceRows.filter((row) => this.inView(row, candidate)).length])
      ) as Record<FundView, number>,
      sourceCounts: databaseCounts?.sourceCounts ?? Object.fromEntries(
        FUND_SOURCES.map((candidate) => [candidate, formalRows.filter((row) => row.source === candidate).length])
      ) as Record<FundSource, number>
    };
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > RESPONSE_BUDGET_BYTES) {
      throw new PayloadTooLargeException("资金工作台响应超出安全预算，请收窄视图或来源筛选");
    }
    return response;
  }

  private contractPaymentRow(payment: {
    id: string; code: string; projectId: string; settlementId: string | null; sourceType: string; status: string;
    requestedAmountCents: bigint; updatedAt: Date;
  }, paidAmountCents: bigint | null, projectById: Map<string, { id: string; code: string; name: string }>, pendingMyAction: boolean): FundRow {
    return this.row({
      id: payment.id,
      code: payment.code,
      source: "contract_payment",
      project: projectById.get(payment.projectId) ?? null,
      sourceDocument: payment.settlementId ? "合同结算付款" : payment.sourceType === "contract_advance" ? "合同预付款" : "合同付款",
      reason: "合同付款申请",
      payeeName: null,
      payerName: null,
      requested: payment.requestedAmountCents,
      paid: paidAmountCents,
      status: payment.status,
      pendingMyAction,
      updatedAt: payment.updatedAt
    });
  }

  private spotPaymentRow(payment: {
    id: string; code: string; projectId: string; procurementId: string; procurementVersionId: string; status: string; createdAt: Date;
    companyPaymentAmountCents: bigint; paymentNote: string | null;
    payeeNameSnapshot: string | null; payerCompanyNameSnapshot: string | null; updatedAt: Date;
  }, paidAmountCents: bigint | null, projectById: Map<string, { id: string; code: string; name: string }>, pendingRefund: boolean, pendingEvidence: boolean, pendingMyAction: boolean): FundRow {
    return this.row({
      id: payment.id,
      code: payment.code,
      source: "spot_procurement_payment",
      project: projectById.get(payment.projectId) ?? null,
      sourceDocument: "零星材料付款",
      reason: payment.paymentNote || "零星材料采购付款",
      payeeName: payment.payeeNameSnapshot,
      payerName: payment.payerCompanyNameSnapshot,
      requested: payment.companyPaymentAmountCents,
      paid: paidAmountCents,
      status: payment.status,
      pendingRefund,
      pendingEvidence,
      pendingMyAction,
      updatedAt: payment.updatedAt
    });
  }

  private expenseRows(expense: {
    id: string; code: string; claimType: string; status: string; projectId: string | null; reason: string;
    companyEntityNameSnapshot: string; paymentSubjectNameSnapshot: string | null; payeeNameSnapshot: string | null; requestedAmountCents: bigint;
    companyPayableAmountCents: bigint; updatedAt: Date;
  }, paidAmountCents: bigint | null, projectById: Map<string, { id: string; code: string; name: string }>): FundRow[] {
    const project = expense.projectId ? projectById.get(expense.projectId) ?? null : null;
    if (expense.claimType === "reimbursement" && expense.companyPayableAmountCents > 0n) {
      return [this.row({
        id: expense.id,
        code: expense.code,
        source: "expense_reimbursement",
        project,
        sourceDocument: "费用报销补付",
        reason: expense.reason,
        payeeName: expense.payeeNameSnapshot,
        payerName: expense.paymentSubjectNameSnapshot ?? expense.companyEntityNameSnapshot,
        requested: expense.companyPayableAmountCents,
        paid: paidAmountCents,
        status: expense.status,
        updatedAt: expense.updatedAt
      })];
    }
    if (
      expense.claimType === "incidental_expense" &&
      expense.companyPayableAmountCents > 0n
    ) {
      return [this.row({
        id: expense.id,
        code: expense.code,
        source: "incidental_expense",
        project,
        sourceDocument: "零星费用实际付款",
        reason: expense.reason,
        payeeName: expense.payeeNameSnapshot,
        payerName: expense.paymentSubjectNameSnapshot ?? expense.companyEntityNameSnapshot,
        requested: expense.companyPayableAmountCents,
        paid: paidAmountCents,
        status: expense.status,
        updatedAt: expense.updatedAt
      })];
    }
    if (expense.claimType === "loan") {
      return [this.row({
        id: expense.id,
        code: expense.code,
        source: "loan_disbursement",
        project,
        sourceDocument: "员工借款放款",
        reason: expense.reason,
        payeeName: expense.payeeNameSnapshot,
        payerName: expense.companyEntityNameSnapshot,
        requested: expense.requestedAmountCents,
        paid: paidAmountCents,
        status: expense.status,
        updatedAt: expense.updatedAt
      })];
    }
    return [];
  }

  private row(input: {
    id: string; code: string; source: FundSource; project: { id: string; code: string; name: string } | null;
    sourceDocument: string; reason: string; payeeName: string | null; payerName: string | null;
    requested: bigint; paid: bigint | null; status: string; pendingRefund?: boolean; pendingEvidence?: boolean; pendingMyAction?: boolean; updatedAt: Date;
  }): FundRow {
    const remaining = input.paid === null
      ? null
      : input.requested > input.paid ? input.requested - input.paid : 0n;
    return {
      id: input.id,
      code: input.code,
      source: input.source,
      project: input.project,
      sourceDocument: input.sourceDocument,
      reason: input.reason,
      payeeName: input.payeeName,
      payerName: input.payerName,
      requestedAmountCents: moneyCentsToApi(input.requested),
      paidAmountCents: input.paid === null ? null : moneyCentsToApi(input.paid),
      remainingAmountCents: remaining === null ? null : moneyCentsToApi(remaining),
      status: input.status,
      statusLabel: this.statusLabel(input.status, remaining, input.pendingRefund ?? false, input.pendingEvidence ?? false),
      pendingRefund: input.pendingRefund ?? false,
      pendingEvidence: input.pendingEvidence ?? false,
      pendingMyAction: input.pendingMyAction ?? false,
      updatedAt: input.updatedAt.toISOString()
    };
  }

  private isFormal(row: FundRow) {
    return !(NON_FORMAL_FUND_STATUSES as readonly string[]).includes(row.status);
  }

  private inView(row: FundRow, view: FundView) {
    if (view === "all") return true;
    if (view === "pending_action") return row.pendingMyAction && !row.pendingRefund && !row.pendingEvidence;
    if (view === "in_progress") return row.status === "approval_pending";
    if (view === "pending_funds") return !row.pendingRefund && !row.pendingEvidence && row.remainingAmountCents !== "0" && ["approved_pending_payment", "approved_pending_disbursement", "partially_disbursed", "partially_paid"].includes(row.status);
    if (view === "partial_payment") return !row.pendingRefund && !row.pendingEvidence && ["partially_paid", "partially_disbursed"].includes(row.status);
    if (view === "pending_refund") return row.pendingRefund;
    if (view === "pending_evidence") return !row.pendingRefund && row.pendingEvidence;
    return !row.pendingRefund && !row.pendingEvidence && row.remainingAmountCents === "0" && ["paid", "settled", "disbursed", "offset_completed"].includes(row.status);
  }

  private statusLabel(status: string, remaining: bigint | null, pendingRefund: boolean, pendingEvidence: boolean) {
    if (pendingRefund) return "待退款处理";
    if (pendingEvidence) return "待补票据";
    if (status === "approval_pending") return "审批中";
    if (remaining === 0n && ["paid", "settled", "disbursed", "offset_completed"].includes(status)) return "已完成";
    if (["partially_paid", "partially_disbursed"].includes(status)) return "部分支付";
    if (["approved_pending_payment", "approved_pending_disbursement"].includes(status)) return "已批待付";
    return status;
  }

  private source(value?: string): FundSource | undefined {
    if (!value || value === "all") return undefined;
    if ((FUND_SOURCES as readonly string[]).includes(value)) return value as FundSource;
    throw new BadRequestException("资金来源筛选值无效");
  }

  private view(value?: string): FundView {
    if (!value) return "all";
    if ((FUND_VIEWS as readonly string[]).includes(value)) return value as FundView;
    throw new BadRequestException("资金工作台视图值无效");
  }
}

function fundSourceEnabled(
  candidate: FundSource,
  source: FundSource | undefined,
  view: FundView
): boolean {
  if (source && candidate !== source) return false;
  if (["pending_refund", "pending_evidence"].includes(view)) {
    return candidate === "spot_procurement_payment";
  }
  if (view === "pending_action") {
    return candidate === "contract_payment" || candidate === "spot_procurement_payment";
  }
  return true;
}

function expenseClaimTypes(
  source: FundSource | undefined,
  view: FundView
): string[] {
  if (view === "pending_action" || view === "pending_refund" || view === "pending_evidence") {
    return [];
  }
  if (source === "expense_reimbursement") return ["reimbursement"];
  if (source === "incidental_expense") return ["incidental_expense"];
  if (source === "loan_disbursement") return ["loan"];
  if (source) return [];
  return ["reimbursement", "incidental_expense", "loan"];
}

function fundStatusWhere(view: FundView): string | { in?: string[]; notIn?: string[] } {
  if (view === "in_progress") return "approval_pending";
  if (view === "pending_funds") {
    return { in: [
      "approved_pending_payment",
      "approved_pending_disbursement",
      "partially_disbursed",
      "partially_paid"
    ] };
  }
  if (view === "partial_payment") {
    return { in: ["partially_paid", "partially_disbursed"] };
  }
  if (view === "completed") {
    return { in: ["paid", "settled", "disbursed", "offset_completed"] };
  }
  return { notIn: [...NON_FORMAL_FUND_STATUSES] };
}

async function countFundsViewsInTransaction(
  tx: Prisma.TransactionClient,
  projectIds: string[],
  source: FundSource | undefined,
  pendingContractPaymentIds: ReadonlySet<string>,
  pendingSpotPaymentIds: ReadonlySet<string>,
  moneyComplete: boolean,
  sourceReferenceTotals: Array<{
    sourceReferenceId: string;
    confirmedProjectOutflowCents: string;
  }>,
  budget: FundsQueryBudget
): Promise<{
  viewCounts: Record<FundView, number>;
  sourceCounts: Record<FundSource, number>;
} | null> {
  const projectedOutflowsJson = JSON.stringify(sourceReferenceTotals);
  const pendingContractSql = pendingContractPaymentIds.size
    ? Prisma.sql`payment.id IN (${Prisma.join([...pendingContractPaymentIds])})`
    : Prisma.sql`FALSE`;
  const pendingSpotSql = pendingSpotPaymentIds.size
    ? Prisma.sql`payment.id IN (${Prisma.join([...pendingSpotPaymentIds])})`
    : Prisma.sql`FALSE`;
  const selectedSourceSql = source
    ? Prisma.sql`source = ${source}`
    : Prisma.sql`TRUE`;
  const rows = await tx.$queryRaw<Array<Record<FundView | FundSource, bigint>>>(Prisma.sql`
    WITH projected_outflows AS (
      SELECT
        value."sourceReferenceId" AS id,
        value."confirmedProjectOutflowCents"::bigint AS "paidCents"
      FROM jsonb_to_recordset(${projectedOutflowsJson}::jsonb) AS value(
        "sourceReferenceId" text,
        "confirmedProjectOutflowCents" text
      )
    ), ranked_refund_payments AS (
      SELECT
        payment.id,
        payment."procurementId",
        payment."procurementVersionId",
        ROW_NUMBER() OVER (
          PARTITION BY payment."procurementId", payment."procurementVersionId"
          ORDER BY
            CASE
              WHEN payment.status IN ('partially_paid', 'paid', 'settled') THEN 2
              WHEN payment.status IN ('voided', 'invalidated') THEN 0
              ELSE 1
            END DESC,
            payment."createdAt" DESC,
            payment.id DESC
        ) AS rank
      FROM "SpotProcurementPayment" AS payment
      WHERE payment."projectId" IN (${Prisma.join(projectIds.length ? projectIds : [""])})
        AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
    ), refund_payments AS (
      SELECT ranked.id
      FROM ranked_refund_payments AS ranked
      WHERE ranked.rank = 1
        AND EXISTS (
          SELECT 1
          FROM "SpotProcurementDiscrepancy" AS discrepancy
          WHERE discrepancy."procurementId" = ranked."procurementId"
            AND discrepancy."procurementVersionId" = ranked."procurementVersionId"
            AND discrepancy.status = 'awaiting_refund'
            AND discrepancy."resolutionType" = 'full_refund'
            AND discrepancy."invalidatedAt" IS NULL
        )
    ), evidence_payments AS (
      SELECT DISTINCT payment.id
      FROM "SpotProcurementPayment" AS payment
      JOIN "SpotProcurementPaymentExecution" AS execution
        ON execution."paymentId" = payment.id
       AND execution."voidedAt" IS NULL
      WHERE payment."projectId" IN (${Prisma.join(projectIds.length ? projectIds : [""])})
        AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
        AND NOT EXISTS (SELECT 1 FROM refund_payments AS refund WHERE refund.id = payment.id)
        AND NOT EXISTS (
          SELECT 1
          FROM "SpotProcurementPaymentExecutionVoucher" AS voucher
          JOIN "FileObject" AS file
            ON file.id = voucher."fileId"
           AND file."storageStatus" = 'active'
          WHERE voucher."paymentExecutionId" = execution.id
        )
        AND (
          EXISTS (
            SELECT 1
            FROM "SpotProcurementPaymentExecutionVoucher" AS voucher
            WHERE voucher."paymentExecutionId" = execution.id
          )
          OR execution."voucherFileId" IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM "FileObject" AS legacy_file
            WHERE legacy_file.id = execution."voucherFileId"
              AND legacy_file."storageStatus" = 'active'
          )
        )
    ), normalized AS (
      SELECT
        'contract_payment'::text AS source,
        payment.status,
        CASE WHEN ${moneyComplete}
          THEN GREATEST(payment."requestedAmountCents" - COALESCE(projected."paidCents", 0), 0)
          ELSE NULL END AS remaining,
        FALSE AS "pendingRefund",
        FALSE AS "pendingEvidence",
        (${pendingContractSql}) AS "pendingMyAction"
      FROM "PaymentRequest" AS payment
      LEFT JOIN projected_outflows AS projected ON projected.id = payment.id
      WHERE payment."projectId" IN (${Prisma.join(projectIds.length ? projectIds : [""])})
        AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
      UNION ALL
      SELECT
        'spot_procurement_payment'::text AS source,
        payment.status,
        CASE WHEN ${moneyComplete}
          THEN GREATEST(payment."companyPaymentAmountCents" - COALESCE(projected."paidCents", 0), 0)
          ELSE NULL END AS remaining,
        EXISTS (SELECT 1 FROM refund_payments AS refund WHERE refund.id = payment.id),
        EXISTS (SELECT 1 FROM evidence_payments AS evidence WHERE evidence.id = payment.id),
        (${pendingSpotSql})
      FROM "SpotProcurementPayment" AS payment
      LEFT JOIN projected_outflows AS projected ON projected.id = payment.id
      WHERE payment."projectId" IN (${Prisma.join(projectIds.length ? projectIds : [""])})
        AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
      UNION ALL
      SELECT
        CASE claim."claimType"
          WHEN 'reimbursement' THEN 'expense_reimbursement'
          WHEN 'incidental_expense' THEN 'incidental_expense'
          ELSE 'loan_disbursement'
        END AS source,
        claim.status,
        CASE WHEN claim."projectId" IS NULL AND claim."claimType" IN ('reimbursement', 'loan')
          THEN GREATEST(
            CASE WHEN claim."claimType" = 'loan'
              THEN claim."requestedAmountCents" ELSE claim."companyPayableAmountCents" END
              - claim."fundedAmountCents", 0)
          WHEN ${moneyComplete} AND claim."projectId" IS NOT NULL
          THEN GREATEST(
            CASE WHEN claim."claimType" = 'loan'
              THEN claim."requestedAmountCents" ELSE claim."companyPayableAmountCents" END
              - COALESCE(projected."paidCents", 0),
            0
          )
          ELSE NULL END AS remaining,
        FALSE,
        FALSE,
        FALSE
      FROM "ExpenseClaim" AS claim
      LEFT JOIN projected_outflows AS projected ON projected.id = claim.id
      WHERE (claim."projectId" IS NULL OR claim."projectId" IN (${Prisma.join(projectIds.length ? projectIds : [""])}))
        AND claim."claimType" IN ('reimbursement', 'incidental_expense', 'loan')
        AND (
          claim."claimType" = 'loan'
          OR claim."companyPayableAmountCents" > 0
        )
        AND claim.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
    )
    SELECT
      COUNT(*) FILTER (WHERE ${selectedSourceSql})::bigint AS "all",
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql}
          AND "pendingMyAction" AND NOT "pendingRefund" AND NOT "pendingEvidence"
      )::bigint AS pending_action,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql} AND status = 'approval_pending'
      )::bigint AS in_progress,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql}
          AND NOT "pendingRefund" AND NOT "pendingEvidence"
          AND remaining IS DISTINCT FROM 0
          AND status IN (
            'approved_pending_payment', 'approved_pending_disbursement',
            'partially_disbursed', 'partially_paid'
          )
      )::bigint AS pending_funds,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql}
          AND NOT "pendingRefund" AND NOT "pendingEvidence"
          AND status IN ('partially_paid', 'partially_disbursed')
      )::bigint AS partial_payment,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql} AND "pendingRefund"
      )::bigint AS pending_refund,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql} AND NOT "pendingRefund" AND "pendingEvidence"
      )::bigint AS pending_evidence,
      COUNT(*) FILTER (
        WHERE ${selectedSourceSql}
          AND NOT "pendingRefund" AND NOT "pendingEvidence"
          AND remaining = 0
          AND status IN ('paid', 'settled', 'disbursed', 'offset_completed')
      )::bigint AS completed,
      COUNT(*) FILTER (WHERE source = 'contract_payment')::bigint AS contract_payment,
      COUNT(*) FILTER (WHERE source = 'spot_procurement_payment')::bigint AS spot_procurement_payment,
      COUNT(*) FILTER (WHERE source = 'expense_reimbursement')::bigint AS expense_reimbursement,
      COUNT(*) FILTER (WHERE source = 'incidental_expense')::bigint AS incidental_expense,
      COUNT(*) FILTER (WHERE source = 'loan_disbursement')::bigint AS loan_disbursement
    FROM normalized
  `);
  budget.consume(rows.length);
  const row = rows[0];
  if (!row) return null;
  const sourceCounts = Object.fromEntries(FUND_SOURCES.map((fundSource) => [
    fundSource,
    Number(row[fundSource] ?? 0n)
  ])) as Record<FundSource, number>;
  budget.ensureFormalTotalWithinBudget(
    Object.values(sourceCounts).reduce((total, count) => total + count, 0)
  );
  return {
    viewCounts: Object.fromEntries(FUND_VIEWS.map((fundView) => [
      fundView,
      Number(row[fundView] ?? 0n)
    ])) as Record<FundView, number>,
    sourceCounts
  };
}

async function readNarrowSpotPaymentIds(
  tx: Prisma.TransactionClient,
  view: FundView,
  projectIds: string[],
  budget: FundsQueryBudget
): Promise<{
  paymentIds: Set<string>;
  refundPaymentIds: Set<string>;
  evidencePaymentIds: Set<string>;
} | null> {
  if (view !== "pending_refund" && view !== "pending_evidence") return null;
  if (!projectIds.length) {
    return {
      paymentIds: new Set(),
      refundPaymentIds: new Set(),
      evidencePaymentIds: new Set()
    };
  }
  const refundRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH ranked_payments AS (
      SELECT
        payment.id,
        payment."procurementId",
        payment."procurementVersionId",
        ROW_NUMBER() OVER (
          PARTITION BY payment."procurementId", payment."procurementVersionId"
          ORDER BY
            CASE
              WHEN payment.status IN ('partially_paid', 'paid', 'settled') THEN 2
              WHEN payment.status IN ('voided', 'invalidated') THEN 0
              ELSE 1
            END DESC,
            payment."createdAt" DESC,
            payment.id DESC
        ) AS rank
      FROM "SpotProcurementPayment" AS payment
      WHERE payment."projectId" IN (${Prisma.join(projectIds)})
        AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
    )
    SELECT ranked.id
    FROM ranked_payments AS ranked
    WHERE ranked.rank = 1
      AND EXISTS (
        SELECT 1
        FROM "SpotProcurementDiscrepancy" AS discrepancy
        WHERE discrepancy."procurementId" = ranked."procurementId"
          AND discrepancy."procurementVersionId" = ranked."procurementVersionId"
          AND discrepancy.status = 'awaiting_refund'
          AND discrepancy."resolutionType" = 'full_refund'
          AND discrepancy."invalidatedAt" IS NULL
      )
    ORDER BY ranked.id ASC
    LIMIT ${budget.remaining() + 1}
  `);
  budget.consume(refundRows.length);
  const refundPaymentIds = new Set(refundRows.map((row) => row.id));
  if (view === "pending_refund") {
    return {
      paymentIds: refundPaymentIds,
      refundPaymentIds,
      evidencePaymentIds: new Set()
    };
  }
  const evidenceRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT payment.id
    FROM "SpotProcurementPayment" AS payment
    JOIN "SpotProcurementPaymentExecution" AS execution
      ON execution."paymentId" = payment.id
     AND execution."voidedAt" IS NULL
    WHERE payment."projectId" IN (${Prisma.join(projectIds)})
      AND payment.status NOT IN (${Prisma.join([...NON_FORMAL_FUND_STATUSES])})
      ${refundPaymentIds.size
        ? Prisma.sql`AND payment.id NOT IN (${Prisma.join([...refundPaymentIds])})`
        : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1
        FROM "SpotProcurementPaymentExecutionVoucher" AS voucher
        JOIN "FileObject" AS file
          ON file.id = voucher."fileId"
         AND file."storageStatus" = 'active'
        WHERE voucher."paymentExecutionId" = execution.id
      )
      AND (
        EXISTS (
          SELECT 1
          FROM "SpotProcurementPaymentExecutionVoucher" AS voucher
          WHERE voucher."paymentExecutionId" = execution.id
        )
        OR execution."voucherFileId" IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM "FileObject" AS legacy_file
          WHERE legacy_file.id = execution."voucherFileId"
            AND legacy_file."storageStatus" = 'active'
        )
      )
    ORDER BY payment.id ASC
    LIMIT ${budget.remaining() + 1}
  `);
  budget.consume(evidenceRows.length);
  const evidencePaymentIds = new Set(evidenceRows.map((row) => row.id));
  return {
    paymentIds: evidencePaymentIds,
    refundPaymentIds,
    evidencePaymentIds
  };
}

async function collectFundsInBatches<T, R>(
  values: readonly T[],
  budget: FundsQueryBudget,
  read: (batch: T[], batchIndex: number, remaining: number) => Promise<R[]>
): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < values.length; index += DATABASE_IN_BATCH_SIZE) {
    const page = await read(
      values.slice(index, index + DATABASE_IN_BATCH_SIZE),
      index / DATABASE_IN_BATCH_SIZE,
      budget.remaining()
    );
    budget.consume(page.length);
    result.push(...page);
  }
  return result;
}

class FundsQueryBudget implements FundsPendingReadBudget {
  private used = 0;

  remaining(): number {
    return FUND_QUERY_ROW_BUDGET - this.used;
  }

  consume(rowCount: number): void {
    if (rowCount > this.remaining()) {
      throw new PayloadTooLargeException(
        "资金工作台读取记录超出安全预算，请收窄视图或来源筛选"
      );
    }
    this.used += rowCount;
  }

  ensureFormalTotalWithinBudget(rowCount: number): void {
    if (rowCount > FUND_QUERY_ROW_BUDGET) {
      throw new PayloadTooLargeException(
        "资金工作台正式来源记录超出安全预算，请收窄可见项目范围"
      );
    }
  }
}
