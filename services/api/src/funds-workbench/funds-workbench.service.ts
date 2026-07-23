import { BadRequestException, Injectable } from "@nestjs/common";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi } from "../money/decimal-money";

const FUND_SOURCES = [
  "contract_payment",
  "spot_procurement_payment",
  "expense_reimbursement",
  "loan_disbursement"
] as const;

const FUND_VIEWS = ["all", "in_progress", "pending_funds", "partial_payment", "completed"] as const;

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
  paidAmountCents: string;
  remainingAmountCents: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
};

@Injectable()
export class FundsWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  async list(actorUserId: string, input: { view?: string; source?: string }) {
    const view = this.view(input.view);
    const source = this.source(input.source);
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(actorUserId);
    const projectWhere = { projectId: { in: visibleProjectIds } };
    const [projects, payments, spotPayments, expenses] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: visibleProjectIds } },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.paymentRequest.findMany({
        where: projectWhere,
        select: {
          id: true, code: true, projectId: true, settlementId: true, sourceType: true, status: true,
          requestedAmountCents: true, paidAmountCents: true, updatedAt: true
        }
      }),
      this.prisma.spotProcurementPayment.findMany({
        where: projectWhere,
        select: {
          id: true, code: true, projectId: true, procurementId: true, status: true,
          companyPaymentAmountCents: true, paidAmountCents: true, paymentNote: true,
          payeeNameSnapshot: true, payerCompanyNameSnapshot: true, updatedAt: true
        }
      }),
      this.prisma.expenseClaim.findMany({
        where: {
          OR: [{ projectId: { in: visibleProjectIds } }, { projectId: null }],
          claimType: { in: ["reimbursement", "loan"] }
        },
        select: {
          id: true, code: true, claimType: true, status: true, projectId: true, reason: true,
          companyEntityNameSnapshot: true, paymentSubjectNameSnapshot: true, payeeNameSnapshot: true, requestedAmountCents: true,
          companyPayableAmountCents: true, fundedAmountCents: true, updatedAt: true
        }
      })
    ]);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const rows: FundRow[] = [
      ...payments.map((payment) => this.contractPaymentRow(payment, projectById)),
      ...spotPayments.map((payment) => this.spotPaymentRow(payment, projectById)),
      ...expenses.flatMap((expense) => this.expenseRows(expense, projectById))
    ];
    const formalRows = rows.filter((row) => this.isFormal(row));
    const selected = formalRows
      .filter((row) => !source || row.source === source)
      .filter((row) => this.inView(row, view))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.code.localeCompare(right.code));

    return {
      view,
      source: source ?? "all",
      items: selected,
      viewCounts: Object.fromEntries(
        FUND_VIEWS.map((candidate) => [candidate, formalRows.filter((row) => this.inView(row, candidate)).length])
      ) as Record<FundView, number>,
      sourceCounts: Object.fromEntries(
        FUND_SOURCES.map((candidate) => [candidate, formalRows.filter((row) => row.source === candidate).length])
      ) as Record<FundSource, number>
    };
  }

  private contractPaymentRow(payment: {
    id: string; code: string; projectId: string; settlementId: string | null; sourceType: string; status: string;
    requestedAmountCents: bigint; paidAmountCents: bigint; updatedAt: Date;
  }, projectById: Map<string, { id: string; code: string; name: string }>): FundRow {
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
      paid: payment.paidAmountCents,
      status: payment.status,
      updatedAt: payment.updatedAt
    });
  }

  private spotPaymentRow(payment: {
    id: string; code: string; projectId: string; procurementId: string; status: string;
    companyPaymentAmountCents: bigint; paidAmountCents: bigint; paymentNote: string | null;
    payeeNameSnapshot: string | null; payerCompanyNameSnapshot: string | null; updatedAt: Date;
  }, projectById: Map<string, { id: string; code: string; name: string }>): FundRow {
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
      paid: payment.paidAmountCents,
      status: payment.status,
      updatedAt: payment.updatedAt
    });
  }

  private expenseRows(expense: {
    id: string; code: string; claimType: string; status: string; projectId: string | null; reason: string;
    companyEntityNameSnapshot: string; paymentSubjectNameSnapshot: string | null; payeeNameSnapshot: string | null; requestedAmountCents: bigint;
    companyPayableAmountCents: bigint; fundedAmountCents: bigint; updatedAt: Date;
  }, projectById: Map<string, { id: string; code: string; name: string }>): FundRow[] {
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
        paid: expense.fundedAmountCents,
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
        paid: expense.fundedAmountCents,
        status: expense.status,
        updatedAt: expense.updatedAt
      })];
    }
    return [];
  }

  private row(input: {
    id: string; code: string; source: FundSource; project: { id: string; code: string; name: string } | null;
    sourceDocument: string; reason: string; payeeName: string | null; payerName: string | null;
    requested: bigint; paid: bigint; status: string; updatedAt: Date;
  }): FundRow {
    const remaining = input.requested > input.paid ? input.requested - input.paid : 0n;
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
      paidAmountCents: moneyCentsToApi(input.paid),
      remainingAmountCents: moneyCentsToApi(remaining),
      status: input.status,
      statusLabel: this.statusLabel(input.status, remaining),
      updatedAt: input.updatedAt.toISOString()
    };
  }

  private isFormal(row: FundRow) {
    return !["draft", "rejected", "abandoned", "invalidated", "voided"].includes(row.status);
  }

  private inView(row: FundRow, view: FundView) {
    if (view === "all") return true;
    if (view === "in_progress") return row.status === "approval_pending";
    if (view === "pending_funds") return row.remainingAmountCents !== "0" && ["approved_pending_payment", "approved_pending_disbursement", "partially_disbursed", "partially_paid"].includes(row.status);
    if (view === "partial_payment") return ["partially_paid", "partially_disbursed"].includes(row.status);
    return row.remainingAmountCents === "0" && ["paid", "settled", "disbursed", "offset_completed"].includes(row.status);
  }

  private statusLabel(status: string, remaining: bigint) {
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
