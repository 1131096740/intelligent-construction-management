import { migrateLegacyExpenseApprovalRound } from "./expense-claim-approval-cutover";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { EXPENSE_CURRENT_ROLE_SCOPE, isPureExpenseReimbursement, supportsExpenseParallelApproval, loadExpenseApprovalRoleScopes, resolveExpenseParallelDutyIdentity } from "./expense-claim-parallel-approval";
import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";
import { ActualPurchaseBatchService } from "../actual-purchase/actual-purchase-batch.service";
import { prepareProcurementPayment } from "../general-procurement/general-procurement-payment";
import { generalProcurementActor } from "../general-procurement/general-procurement-access";
import { GENERAL_PROCUREMENT_CATEGORIES, GENERAL_PROCUREMENT_PAYMENT_CATEGORIES } from "@jiangkong/shared-domain";
import { lockMasterDataRow } from "../master-data/master-data-lifecycle";
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { chinaDateOnly, GLOBAL_BUSINESS_ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { activeApprovalNodeIndexes, hasVersionedApprovalNodes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { ApprovalProgressService } from "../approval/approval-progress.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { snapshotApprovalSignature , withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { exportBusinessLedger } from "../core-flow/business-ledger-export";
import {
  LEDGER_DATE_FORMAT,
  LEDGER_MONEY_FORMAT,
  type LedgerExcelColumn
} from "../core-flow/ledger-excel";
import {
  matchesLedgerExportQuery,
  normalizeLedgerExportQuery,
  sortLedgerRows,
  type NormalizedLedgerExportQuery
} from "../core-flow/ledger-export-query";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  appendRegisteredOperationalPayment,
  readRegisteredOperationalPayment
} from "../fund-account/registered-operational-payment";
import { formatMoneyCentsAsPlainYuan, moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import {
  missingOperatingSourceReplayService,
  type OperatingSourceAppendPort,
  OperatingSourceReplayService
} from "../operating-ledger/operating-source-replay.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { translateProjectOperatingSerializationConflict } from "../project/project-operating-constraint";
import {
  EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE,
  EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
  EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE
} from "./expense-claim-operating-source.adapter";
import { renderExpenseClaimFinalPaymentPdf } from "./expense-claim-final-payment-pdf";
import { freezeExpenseClaimEntryInTransaction } from "./expense-claim-entry.adapter";
import { assertEmployeeAdvanceBatchSource } from "./expense-claim-batch-source";
import { DEFAULT_EXPENSE_CATEGORIES, expenseCategoryKey, mergeExpenseCategories, resolveExpenseCategoryName } from "./expense-claim-category";
import { parseExpenseQuantity } from "./expense-claim-quantity";
import { projectClaimPaymentCapacity } from "./other-project-payment";
import { recordExpensePublicCashVoucher } from "./expense-public-cash-voucher";
import { EXPENSE_CLAIM_ENTRY_DEFINITION } from "./expense-claim-entry.definition";
import type { CreateExpenseClaimDto, ExpenseClaimLineDto } from "./dto/create-expense-claim.dto";
import type { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import type { EditReturnedExpenseClaimDto } from "./dto/returned-expense-claim.dto";
import type { AttachExpenseClaimAttachmentDto, RemoveExpenseClaimAttachmentDto } from "./dto/manage-expense-claim-attachment.dto";
import type { AdjustExpenseClaimPaymentSubjectDto } from "./dto/adjust-expense-claim-payment-subject.dto";
import type { RecordExpenseClaimPaymentDto } from "./dto/record-expense-claim-payment.dto";

type ExpenseClaimApprovalNode = FrozenApprovalNode & {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds: string[];
  candidateUserIdsByRole: Partial<Record<RoleKey, string[]>>;
  approvedRoleKeys?: RoleKey[];
  candidatePolicy?: string;
};

const RETIRED_EMPLOYEE_LOAN = "员工借款申请已停止办理";
const COMPREHENSIVE_ROLE: RoleKey = "comprehensive_director";
const FINAL_ROLES: RoleKey[] = ["chairman", "general_manager"];
const PAYMENT_SUBJECT_ADJUSTMENT_ROLES: RoleKey[] = ["finance_staff", "finance_director", "comprehensive_director"];
const INCIDENTAL_EXPENSE_CATEGORIES = [
  "temporary_service",
  "temporary_machinery_shift",
  "sporadic_labor",
  "other_incidental",
  ...GENERAL_PROCUREMENT_PAYMENT_CATEGORIES
] as const;
const INCIDENTAL_EXPENSE_CATEGORY_SET = new Set<string>(
  INCIDENTAL_EXPENSE_CATEGORIES
);

function expenseBearingCompanyPeriod(occurredAt: Date) {
  const day = dateOnly(chinaDateOnly(occurredAt), "项目成本归属日期");
  return { effectiveFrom: { lte: day }, OR: [{ endedAt: null }, { endedAt: { gt: day } }] };
}

async function expenseBearingCompanyOptions(tx: Prisma.TransactionClient, projectIds: string[]) {
  if (!projectIds.length) return [];
  return tx.projectParticipatingCompany.findMany({
    where: { projectId: { in: projectIds }, ...expenseBearingCompanyPeriod(new Date()) },
    select: { projectId: true, companyEntityId: true, companyNameSnapshot: true },
    orderBy: [{ companyNameSnapshot: "asc" }, { companyEntityId: "asc" }]
  });
}

async function expenseCostBearingCompanySelection(
  tx: Prisma.TransactionClient,
  input: { companyId: string | null | undefined; projectId?: string | null; linkedPurchase: boolean; occurredAt?: Date }
) {
  if (input.companyId === undefined) return;
  if (!input.projectId || input.linkedPurchase) {
    throw new BadRequestException("只有独立项目费用可以单独选择成本承担公司");
  }
  const companyId = input.companyId === null ? null : requiredText(input.companyId, "请选择成本承担公司或待归属");
  if (companyId !== null) {
    const occurredAt = input.occurredAt ?? new Date();
    const participation = await tx.projectParticipatingCompany.findFirst({
      where: { projectId: input.projectId, companyEntityId: companyId, ...expenseBearingCompanyPeriod(occurredAt) },
      select: { id: true }
    });
    if (!participation) throw new BadRequestException("请选择当前项目有效的成本承担公司");
  }
  return { costBearingCompanySpecified: true, costBearingCompanyEntityId: companyId };
}

@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: BusinessNumberingService,
    private readonly audit: AuditService,
    @Optional()
    private readonly auth?: AuthService,
    private readonly visibility?: ProjectVisibilityService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService,
    @Optional()
    private readonly projectFunding?: ProjectFundingAvailabilityService,
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService(),
    @Optional() private readonly approvalProgress?: ApprovalProgressService,
    @Optional() private readonly fundingNotifications?: ExpenseClaimFundingNotificationService,
    @Optional() private readonly actualBatches?: ActualPurchaseBatchService,
    @Optional() private readonly writeFreeze: OperationalWriteFreezeService = new OperationalWriteFreezeService()
  ) {}

  async createOptions(actorUserId: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    if (!currentUser?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
    const actorRoles = await this.loadRoleKeys(this.prisma, actorUserId);
    const canProxy = actorRoles.includes(COMPREHENSIVE_ROLE);
    const selfProjectIds = await this.selfApplicationProjectIds(this.prisma, actorUserId);
    const visibleProjectIds = canProxy
      ? await (this.visibility ?? new ProjectVisibilityService(this.prisma)).visibleProjectIds(actorUserId)
      : selfProjectIds;
    const [companyEntities, projects, activeUsers] = await Promise.all([
      this.prisma.companyEntity.findMany({
        where: { isActive: true, dataStatus: "complete" },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" }
      }),
      visibleProjectIds.length
        ? this.prisma.project.findMany({
          where: { id: { in: visibleProjectIds }, isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" }
        })
        : [],
      this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      })
    ]);
    const actor = activeUsers.find((user) => user.id === actorUserId);
    return {
      companyEntities,
      projects,
      bearingCompanyOptions: await expenseBearingCompanyOptions(this.prisma, projects.map(project => project.id)),
      selfProjectIds: selfProjectIds.filter((id) => projects.some((project) => project.id === id)),
      selfApplicantUserId: actorUserId,
      canProxy,
      entryDefinition: EXPENSE_CLAIM_ENTRY_DEFINITION,
      availableActions: ["create_expense_claim"],
      applicantUsers: canProxy ? activeUsers : actor ? [actor] : [],
      factWitnessUsers: activeUsers,
      expenseCategories: mergeExpenseCategories([]),
      incidentalExpenseCategories: [
        { key: "temporary_service", label: "非材料临时服务" },
        { key: "temporary_machinery_shift", label: "临时机械台班" },
        { key: "sporadic_labor", label: "零星用工" },
        { key: "other_incidental", label: "其他非材料临时费用" }
      ]
    };
  }

  async listMine(actorUserId: string, view?: string) {
    const normalizedView = view === "drafts" || view === "in_progress" || view === "pending_funds" ? view : "all";
    const status = normalizedView === "drafts"
      ? ["draft"]
      : normalizedView === "in_progress"
        ? ["approval_pending"]
        : normalizedView === "pending_funds"
          ? ["approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"]
          : undefined;
    const relatedIds: string[] = [];
    if (this.approvalProgress && normalizedView !== "drafts") {
      let cursor: string | undefined;
      do {
        const page = await this.approvalProgress.list(actorUserId, cursor, "expense_claim");
        relatedIds.push(...page.items.map(item => item.businessId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    const rows = await this.prisma.expenseClaim.findMany({
      where: {
        OR: [{ applicantUserId: actorUserId }, { handledByUserId: actorUserId }, ...(relatedIds.length ? [{ id: { in: relatedIds }, status: { not: "draft" } }] : [])],
        ...(status ? { status: { in: status } } : {})
      },
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }],
      select: { id: true, code: true, claimType: true, incidentalExpenseCategory: true, status: true, projectId: true, companyEntityNameSnapshot: true, applicantNameSnapshot: true, handledByNameSnapshot: true, reason: true, payeeNameSnapshot: true, requestedAmountCents: true, loanOffsetAmountCents: true, companyPayableAmountCents: true, fundedAmountCents: true, updatedAt: true }
    });
    const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
    const projects = projectIds.length
      ? await this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } })
      : [];
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    return rows.map((row) => ({
      ...row,
      project: row.projectId ? projectsById.get(row.projectId) ?? null : null,
      requestedAmountCents: moneyCentsToApi(row.requestedAmountCents),
      loanOffsetAmountCents: moneyCentsToApi(row.loanOffsetAmountCents),
      companyPayableAmountCents: moneyCentsToApi(row.companyPayableAmountCents),
      fundedAmountCents: moneyCentsToApi(row.fundedAmountCents)
    }));
  }

  /**
   * 费用与报销台账：财务、综合、公司领导与项目经理按项目可见范围跨项目查账；
   * 普通员工仍只见本人申请、经办及参与审批的记录（与原工作台口径一致）。
   * 列表与导出共用本方法与同一行级范围。
   */
  async listLedger(actorUserId: string, rawQuery?: Record<string, unknown>) {
    const normalized = normalizeLedgerExportQuery(rawQuery);
    const view = expenseLedgerView(rawQuery?.view);
    const allRows = await this.expenseLedgerRows(actorUserId);
    const filtered = this.filterExpenseLedgerRows(allRows, normalized, view);
    const page = positiveInteger(rawQuery?.page, 1);
    const pageSize = Math.min(positiveInteger(rawQuery?.pageSize, 20), 100);
    const offset = (page - 1) * pageSize;
    return {
      rows: filtered.slice(offset, offset + pageSize),
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: filtered.length === 0 ? 0 : Math.ceil(filtered.length / pageSize)
      },
      summary: {
        total: filtered.length,
        drafts: filtered.filter((row) => row.status === "draft").length,
        inProgress: filtered.filter((row) => row.status === "approval_pending").length,
        pendingFunds: filtered.filter((row) =>
          ["approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"].includes(row.status)
        ).length,
        knownAmountRows: filtered.filter((row) => row.requestedAmountCents !== null).length
      },
      filters: {
        projectId: normalized.projectId ?? null,
        dateFrom: normalized.dateFrom ?? null,
        dateTo: normalized.dateTo ?? null,
        status: normalized.status ?? null,
        keyword: normalized.keyword ?? null,
        sort: normalized.sortField
          ? `${normalized.sortField}:${normalized.sortDirection}`
          : null
      },
      columns: EXPENSE_LEDGER_COLUMNS.map((column) => ({
        key: String(column.key),
        header: column.header,
        required: Boolean(column.required)
      }))
    };
  }

  /**
   * 报销台账导出：与列表共用 `expenseLedgerRows` 的行级范围，
   * 导出全部筛选后的可见记录；普通员工导出也只含本人可见行。
   */
  async exportLedger(
    actorUserId: string,
    rawQuery?: Record<string, unknown>
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const normalized = normalizeLedgerExportQuery(rawQuery);
    const view = expenseLedgerView(rawQuery?.view);
    const allRows = await this.expenseLedgerRows(actorUserId);
    const rows = this.filterExpenseLedgerRows(allRows, normalized, view);
    return exportBusinessLedger({
      prisma: this.prisma,
      audit: this.audit,
      actorUserId,
      action: "expense_claim.ledger.export",
      businessType: "expense_claim_ledger",
      scope: "all_filtered_visible_expense_claims",
      sheetName: "费用与报销台账",
      fileNamePrefix: "费用与报销台账",
      columns: EXPENSE_LEDGER_COLUMNS,
      rows: rows.map((row) => ({
        ...row,
        projectName: row.projectName,
        requestedAmountYuan: formatMoneyCentsAsPlainYuan(BigInt(row.requestedAmountCents)),
        settledAmountYuan: formatMoneyCentsAsPlainYuan(
          BigInt(row.loanOffsetAmountCents) + BigInt(row.fundedAmountCents)
        ),
        outstandingAmountYuan: formatMoneyCentsAsPlainYuan(BigInt(row.companyPayableAmountCents)),
        updatedAtIso: row.updatedAt
      })),
      columnKeys: normalized.columnKeys,
      filters: normalized,
      visibleProjectCount: new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : [])).size
    });
  }

  private async expenseLedgerRows(actorUserId: string): Promise<ExpenseLedgerRow[]> {
    const roles = await this.loadRoleKeys(this.prisma, actorUserId);
    const canReadAcrossProjects = roles.some((role) => EXPENSE_LEDGER_GLOBAL_ROLES.has(role));
    if (!canReadAcrossProjects) {
      const mine = await this.listMine(actorUserId, "all");
      return mine.map((row) => ({
        id: row.id,
        code: row.code,
        claimType: row.claimType,
        claimTypeLabel: expenseClaimTypeLabel(row.claimType),
        categoryLabel: expenseCategoryLabel(row.claimType, row.incidentalExpenseCategory, null),
        status: row.status,
        statusLabel: expenseClaimStatusLabel(row.status),
        projectId: row.projectId,
        projectName: row.project ? `${row.project.code} · ${row.project.name}` : "公司日常",
        companyName: row.companyEntityNameSnapshot,
        applicantName: row.applicantNameSnapshot,
        handledByName: row.handledByNameSnapshot,
        reason: row.reason,
        payeeName: row.payeeNameSnapshot ?? "待确定",
        requestedAmountCents: row.requestedAmountCents,
        loanOffsetAmountCents: row.loanOffsetAmountCents,
        companyPayableAmountCents: row.companyPayableAmountCents,
        fundedAmountCents: row.fundedAmountCents,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
      }));
    }

    const visibility = this.visibility ?? new ProjectVisibilityService(this.prisma);
    const visibleProjectIds = await visibility.visibleProjectIds(actorUserId);
    const rows = await this.prisma.expenseClaim.findMany({
      where: {
        AND: [
          {
            OR: [
              { projectId: { in: visibleProjectIds } },
              // 公司日常费用不属于项目，仍属公司财务查账范围。
              { projectId: null }
            ]
          },
          // 草稿留在办理工作台；跨项目查账只读已提交记录与本人草稿。
          {
            OR: [
              { status: { not: "draft" } },
              { applicantUserId: actorUserId }
            ]
          }
        ]
      },
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        claimType: true,
        incidentalExpenseCategory: true,
        status: true,
        projectId: true,
        companyEntityNameSnapshot: true,
        applicantNameSnapshot: true,
        handledByNameSnapshot: true,
        reason: true,
        payeeNameSnapshot: true,
        requestedAmountCents: true,
        loanOffsetAmountCents: true,
        companyPayableAmountCents: true,
        fundedAmountCents: true,
        updatedAt: true
      }
    });
    if (!rows.length) return [];
    const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
    const [projects, lines] = await Promise.all([
      projectIds.length
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, code: true, name: true }
          })
        : Promise.resolve([]),
      this.prisma.expenseClaimLine.findMany({
        where: { expenseClaimId: { in: rows.map((row) => row.id) } },
        orderBy: [{ sortOrder: "asc" }],
        select: { expenseClaimId: true, expenseCategory: true }
      })
    ]);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const categoryByClaimId = new Map<string, string>();
    for (const line of lines) {
      if (!categoryByClaimId.has(line.expenseClaimId)) {
        categoryByClaimId.set(line.expenseClaimId, line.expenseCategory);
      }
    }
    return rows.map((row) => {
      const project = row.projectId ? projectById.get(row.projectId) : undefined;
      return {
        id: row.id,
        code: row.code,
        claimType: row.claimType,
        claimTypeLabel: expenseClaimTypeLabel(row.claimType),
        categoryLabel: expenseCategoryLabel(
          row.claimType,
          row.incidentalExpenseCategory,
          categoryByClaimId.get(row.id) ?? null
        ),
        status: row.status,
        statusLabel: expenseClaimStatusLabel(row.status),
        projectId: row.projectId,
        projectName: project ? `${project.code} · ${project.name}` : "公司日常",
        companyName: row.companyEntityNameSnapshot,
        applicantName: row.applicantNameSnapshot,
        handledByName: row.handledByNameSnapshot,
        reason: row.reason,
        payeeName: row.payeeNameSnapshot ?? "待确定",
        requestedAmountCents: moneyCentsToApi(row.requestedAmountCents),
        loanOffsetAmountCents: moneyCentsToApi(row.loanOffsetAmountCents),
        companyPayableAmountCents: moneyCentsToApi(row.companyPayableAmountCents),
        fundedAmountCents: moneyCentsToApi(row.fundedAmountCents),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  private filterExpenseLedgerRows(
    rows: readonly ExpenseLedgerRow[],
    query: NormalizedLedgerExportQuery,
    view: ExpenseLedgerView
  ) {
    const viewRows = rows.filter((row) => {
      if (view === "drafts") return row.status === "draft";
      if (view === "in_progress") return row.status === "approval_pending";
      if (view === "pending_funds") {
        return ["approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"].includes(row.status);
      }
      return true;
    });
    const filtered = viewRows.filter((row) =>
      matchesLedgerExportQuery(
        {
          projectId: row.projectId ?? "",
          occurredAt: row.updatedAt,
          status: `${row.statusLabel} ${row.claimTypeLabel} ${row.categoryLabel}`,
          keywordParts: [
            row.code,
            row.projectName,
            row.companyName,
            row.applicantName,
            row.handledByName,
            row.reason,
            row.payeeName,
            row.statusLabel,
            row.claimTypeLabel,
            row.categoryLabel
          ]
        },
        query
      )
    );
    return sortLedgerRows(filtered, query.sortField, query.sortDirection, {
      updatedAt: (row) => new Date(row.updatedAt),
      requestedAmountCents: (row) => Number(row.requestedAmountCents),
      code: (row) => row.code,
      projectName: (row) => row.projectName
    });
  }

  async create(actorUserId: string, input: CreateExpenseClaimDto) {
    const claimType = input.claimType;
    if (claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
    const requestedAmountCents = positiveCents(input.requestedAmountCents, "申请金额必须大于零");
    const lines = claimType === "reimbursement" ? this.lines(input.lines) : [];
    const lineAmountCents = lines.reduce((total, line) => total + positiveCents(line.amountCents, "费用明细金额必须大于零"), 0n);
    if (claimType === "reimbursement" && lineAmountCents !== requestedAmountCents) {
      throw new BadRequestException("费用明细合计必须等于申请金额");
    }
    if (claimType === "incidental_expense" && !input.projectId?.trim()) {
      throw new BadRequestException("零星费用必须选择项目");
    }
    if (claimType === "incidental_expense" && !input.payeeName?.trim()) {
      throw new BadRequestException("零星费用收款对象必填");
    }
    const incidentalExpenseCategory =
      input.incidentalExpenseCategory?.trim() || null;
    if (
      claimType === "incidental_expense" &&
      !INCIDENTAL_EXPENSE_CATEGORY_SET.has(incidentalExpenseCategory ?? "")
    ) {
      if (incidentalExpenseCategory === "sporadic_material") {
        throw new BadRequestException("材料费用必须走零星材料或材料采购流程");
      }
      throw new BadRequestException("零星费用分类不正确");
    }
    if (claimType !== "incidental_expense" && incidentalExpenseCategory) {
      throw new BadRequestException("只有零星费用可以填写零星费用分类");
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.projectId?.trim()) await lockMasterDataRow(tx, "Project", input.projectId.trim());
      await lockMasterDataRow(tx, "CompanyEntity", requiredText(input.companyEntityId, "使用单位不能为空"));
      const [actor, company, project] = await Promise.all([
        tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, name: true, phone: true, isActive: true } }),
        tx.companyEntity.findFirst({ where: { id: requiredText(input.companyEntityId, "使用单位不能为空"), isActive: true }, select: { id: true, name: true } }),
        input.projectId?.trim()
          ? tx.project.findFirst({ where: { id: input.projectId.trim(), isActive: true }, select: { id: true } })
          : Promise.resolve(null)
      ]);
      if (!actor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
      if (!company) throw new NotFoundException("使用单位不存在或已停用");
      if (input.projectId?.trim() && !project) throw new NotFoundException("项目不存在或已停用");
      const employeeAdvance = claimType === "reimbursement" && Boolean(input.actualPurchaseBatchId);
      const procurementPayment = employeeAdvance
        ? null
        : await prepareProcurementPayment(
            tx,
            this.prisma,
            actorUserId,
            input,
            requestedAmountCents,
            this.actualBatches
              ? async (client, batch) => this.actualBatches!.assertClaimCommitInTransaction(client, batch)
              : undefined
          );
      const advance = employeeAdvance
        ? await this.resolveEmployeeAdvanceSource(tx, actorUserId, input, requestedAmountCents)
        : null;
      if (procurementPayment?.existing) {
        const existing = procurementPayment.existing;
        return { id: existing.id, code: existing.code, status: existing.status, requestedAmountCents: moneyCentsToApi(existing.requestedAmountCents) };
      }
      const actorRoles = await this.loadRoleKeys(tx, actorUserId, project?.id);
      const applicant = procurementPayment ? { userId: actor.id, name: actor.name, phone: actor.phone } : await this.applicantSnapshot(tx, actor, input, actorRoles);
      if (project) {
        const projectIds = applicant.userId === actorUserId && !procurementPayment
          ? await this.selfApplicationProjectIds(tx, actorUserId)
          : await (this.visibility ?? new ProjectVisibilityService(this.prisma)).visibleProjectIdsInTransaction(tx, actorUserId);
        if (!projectIds.includes(project.id)) throw new ForbiddenException("当前账号无权选择该项目");
      }
      const costBearingCompany = await expenseCostBearingCompanySelection(tx, {
        companyId: input.costBearingCompanyEntityId, projectId: project?.id,
        linkedPurchase: Boolean(input.actualPurchaseBatchId || input.generalProcurementId)
      });
      const factWitness = await this.factWitnessSnapshot(tx, input, project?.id);
      const code = await this.numbering.allocateDaily(
        tx,
        claimType === "reimbursement" ? "BX" : "LXFY"
      );
      const claim = await tx.expenseClaim.create({
        data: {
          actualPurchaseBatchId: advance?.batch.id ?? input.actualPurchaseBatchId ?? null,
          generalProcurementId: input.generalProcurementId ?? null,
          generalProcurementRequestKey: input.generalProcurementRequestKey ?? null,
          generalProcurementFingerprint: procurementPayment?.fingerprint ?? null,
          code,
          claimType,
          incidentalExpenseCategory,
          status: "draft",
          companyEntityId: company.id,
          companyEntityNameSnapshot: company.name,
          ...costBearingCompany,
          paymentSubjectCompanyEntityId: company.id,
          paymentSubjectNameSnapshot: company.name,
          projectId: project?.id,
          factWitnessUserId: factWitness?.id ?? null,
          factWitnessNameSnapshot: factWitness?.name ?? null,
          applicantUserId: applicant.userId,
          applicantNameSnapshot: applicant.name,
          applicantPhoneSnapshot: applicant.phone,
          handledByUserId: actor.id,
          handledByNameSnapshot: actor.name,
          proxyReason: applicant.userId === actor.id ? null : "由综合部代办",
          reason: requiredText(input.reason, "事由不能为空"),
          requestedAmountCents,
          paymentMethod: optionalText(input.paymentMethod),
          payeeNameSnapshot: optionalText(input.payeeName),
          payeeAccountNameSnapshot: optionalText(input.payeeAccountName),
          payeeBankNameSnapshot: optionalText(input.payeeBankName),
          payeeBankAccountSnapshot: optionalText(input.payeeBankAccount),
          loanExpectedClearanceAt: input.loanExpectedClearanceOn ? dateOnly(input.loanExpectedClearanceOn, "预计清账日期") : null
        }
      });
      if (lines.length) {
        await tx.expenseClaimLine.createMany({
          data: await this.prepareExpenseLines(tx, claim.id, company.id, lines, advance?.sourceCategory)
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action:
          claimType === "incidental_expense"
            ? "incidental_expense.draft.create"
            : "expense_claim.draft.create",
        businessType:
          claimType === "incidental_expense"
            ? "incidental_expense"
            : "expense_claim",
        businessId: claim.id,
        metadata: {
          code,
          claimType,
          incidentalExpenseCategory,
          projectId: project?.id ?? null,
          actualPurchaseBatchId: advance?.batch.id ?? null,
          requestedAmountCents: requestedAmountCents.toString()
        }
      });
      return { id: claim.id, code, status: claim.status, requestedAmountCents: moneyCentsToApi(requestedAmountCents) };
    });
  }

  async getMine(claimId: string, actorUserId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId },
      select: {
        generalProcurementId: true, actualPurchaseBatchId: true, id: true, code: true, claimType: true, incidentalExpenseCategory: true, status: true, projectId: true, applicantUserId: true, handledByUserId: true, companyEntityId: true, companyEntityNameSnapshot: true,
        costBearingCompanySpecified: true, costBearingCompanyEntityId: true, approvalInstanceId: true,
        paymentSubjectCompanyEntityId: true, paymentSubjectNameSnapshot: true, paymentSubjectAdjustmentReason: true, paymentSubjectAdjustedAt: true, paymentSubjectAdjustedByUserId: true, paymentSubjectAdjustedByRoleKey: true,
        applicantNameSnapshot: true, applicantPhoneSnapshot: true, handledByNameSnapshot: true, proxyReason: true,
        factWitnessNameSnapshot: true, reason: true, requestedAmountCents: true, loanOffsetAmountCents: true,
        companyPayableAmountCents: true, fundedAmountCents: true, paymentMethod: true, payeeNameSnapshot: true,
        payeeAccountNameSnapshot: true, payeeBankNameSnapshot: true, payeeBankAccountSnapshot: true,
        loanExpectedClearanceAt: true, submittedAt: true, approvedAt: true, voidedAt: true, updatedAt: true
      }
    });
    if (!claim) throw new NotFoundException("费用申请不存在或当前账号无权读取");
    const instance = claim.status === "approval_pending"
      ? await this.prisma.approvalInstance.findFirst({
        where: { businessType: "expense_claim", businessId: claim.id, flowType: "expense_claim.approve", status: "in_progress" },
        orderBy: { createdAt: "desc" },
        select: { id: true, currentNodeIndex: true, frozenNodes: true, applicantUserId: true }
      })
      : null;
    const parallel = Boolean(instance && supportsExpenseParallelApproval(claim) &&
      claim.approvalInstanceId === instance.id && isParallelApprovalRound(instance.frozenNodes));
    const roleScopes = parallel ? await loadExpenseApprovalRoleScopes(this.prisma, actorUserId, claim.projectId) : undefined;
    const roles = roleScopes ? [...roleScopes.globalRoleKeys, ...roleScopes.projectRoleKeys]
      : await this.loadRoleKeys(this.prisma, actorUserId, claim.projectId ?? undefined);
    const activeIndexes = instance && (parallel || !hasVersionedApprovalNodes(instance.frozenNodes))
      ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex)
      : [];
    const nodes = instance?.frozenNodes as ExpenseClaimApprovalNode[] | undefined;
    const canConsiderIdentity = !parallel || Boolean((await this.prisma.user.findUnique({
      where: { id: actorUserId }, select: { isActive: true }
    }))?.isActive);
    const duties = activeIndexes.flatMap(index => {
      const node = nodes?.[index];
      if (!node || !canConsiderIdentity) return [];
      const identity = roleScopes ? resolveExpenseParallelDutyIdentity({ node, actorUserId, actorRoleScopes: roleScopes })
        : resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: roles });
      if (!identity) return [];
      return [{ index, name: node.name }];
    });
    const currentNode = nodes?.[duties[0]?.index ?? activeIndexes[0]] ?? null;
    const canReview = claim.claimType !== "loan" && duties.length > 0;
    const isOwner = claim.applicantUserId === actorUserId || claim.handledByUserId === actorUserId;
    const canReadExistingExpenseEvidence =
      !["draft", "rejected", "offset_completed"].includes(claim.status) &&
      (claim.handledByUserId === actorUserId ||
        roles.some((role) => ["comprehensive_director", "finance_staff", "finance_director"].includes(role)));
    const canAdjustPaymentSubject =
      claim.claimType === "reimbursement" &&
      claim.status === "approved_pending_payment" &&
      roles.some((role) => PAYMENT_SUBJECT_ADJUSTMENT_ROLES.includes(role));
    const procurementActor = claim.generalProcurementId && claim.projectId ? await generalProcurementActor(this.prisma, this.visibility ?? new ProjectVisibilityService(this.prisma), actorUserId, claim.projectId) : null;
    const canReadProcurementPayment = procurementActor && (procurementActor.globalRoleKeys.some((role) => ["chairman", "general_manager", "comprehensive_director", "finance_staff", "finance_director"].includes(role)) || procurementActor.projectRoleKeys.some((role) => ["project_manager", "finance_staff", "finance_director"].includes(role)));
    const existingDetailAccess = isOwner || duties.length > 0 || canReadExistingExpenseEvidence || Boolean(canReadProcurementPayment);
    if (!existingDetailAccess && !(claim.status !== "draft" && await this.approvalProgress?.canViewBusiness("expense_claim", claim.id, actorUserId))) throw new NotFoundException("费用申请不存在或当前账号无权读取");
    const canPayClaim = ["reimbursement", "incidental_expense"].includes(claim.claimType) &&
      ["approved_pending_payment", "partially_paid"].includes(claim.status);
    const cashAccount = canPayClaim && claim.projectId && claim.companyEntityNameSnapshot?.trim() &&
      roles.includes("comprehensive_director")
      ? await this.prisma.registeredFundAccount.findUnique({
          where: { scopeKey: "public_cash" },
          select: { publicCashCustody: { select: { currentCustodianId: true } } }
        })
      : null;
    const canRecordPublicCashPayment = cashAccount?.publicCashCustody?.currentCustodianId === actorUserId;
    const cashCostImpacts = canRecordPublicCashPayment && claim.projectId
      ? await this.prisma.operatingImpactEntry.findMany({
          where: {
            projectId: claim.projectId, impactKind: "confirmed_cost", direction: "increase", numericProtocolVersion: 1,
            fact: { sourceType: EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE, sourceBusinessId: claim.id,
              projectId: claim.projectId, entryKind: "original", status: "confirmed", evidenceLevel: "A",
              isBeforeOperatingLedgerEffectiveDate: false, adjustments: { none: { status: "confirmed" } } }
          },
          select: { id: true, description: true, amountCents: true, sourceImpactKey: true, impactSnapshot: true,
            expensePublicCashCostLinks: { select: { amountCents: true } } },
          orderBy: [{ sourceImpactKey: "asc" }, { id: "asc" }]
        })
      : [];
    const cashCostAllocationOptions = cashCostImpacts.flatMap(impact => {
      const available = (impact.amountCents ?? 0n) - impact.expensePublicCashCostLinks.reduce((sum, link) => sum + link.amountCents, 0n);
      if (available <= 0n) return [];
      const lineNumber = /^confirmed_cost:(\d+)$/u.exec(impact.sourceImpactKey)?.[1];
      const purpose = impact.impactSnapshot && typeof impact.impactSnapshot === "object" && !Array.isArray(impact.impactSnapshot)
        && typeof impact.impactSnapshot.purpose === "string" ? impact.impactSnapshot.purpose : null;
      return [{
        costImpactId: impact.id, lineNumber, description: purpose ?? impact.description, availableAmountCents: available.toString()
      }];
    });
    const [project, lines, attachments, paymentSubjectCompanyEntities, paymentExecutions, finalPaymentPdf] = await Promise.all([
      claim.projectId
        ? this.prisma.project.findUnique({ where: { id: claim.projectId }, select: { id: true, code: true, name: true } })
        : Promise.resolve(null),
      this.prisma.expenseClaimLine.findMany({
        where: { expenseClaimId: claim.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true, expenseCategory: true, occurredOn: true, purpose: true, quantity: true, receiptCount: true, amountCents: true, evidenceType: true, noEvidenceReason: true, remark: true }
      }),
      (this.prisma as unknown as {
        expenseClaimAttachment?: {
          findMany(args: {
            where: { expenseClaimId: string };
            orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
            select: Record<string, true>;
          }): Promise<Array<{
            id: string; fileId: string; category: string; expenseCategory: string | null; stage: string;
            attachedByUserId: string; frozenAt: Date | null; removedAt: Date | null; createdAt: Date;
          }>>;
        };
      }).expenseClaimAttachment?.findMany({
        where: { expenseClaimId: claim.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, fileId: true, category: true, expenseCategory: true, stage: true,
          attachedByUserId: true, frozenAt: true, removedAt: true, createdAt: true
        }
      }) ?? Promise.resolve([]),
      canAdjustPaymentSubject
        ? this.prisma.companyEntity.findMany({
          where: { isActive: true, dataStatus: "complete" },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" }
        })
        : Promise.resolve([]),
      (claim.claimType === "reimbursement" || claim.claimType === "incidental_expense")
        ? this.prisma.expenseClaimPaymentExecution.findMany({
          where: { expenseClaimId: claim.id },
          select: {
            id: true, amountCents: true, paidAt: true, paymentMethod: true, voucherFileId: true,
            recordedByUserId: true, note: true, createdAt: true,
            registeredOperationalPayment: {
              select: { id: true, actualPayerCompanyId: true, actualPayerName: true, originalDebtorCompanyId: true }
            }
          },
          orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
        })
        : Promise.resolve([]),
      this.prisma.pdfDocument.findFirst({
        where: {
          businessType: "expense_claim",
          businessId: claim.id,
          templateKey: claim.claimType === "reimbursement" ? "expense_claim_final_payment_a5" : "expense_claim_loan_final_disbursement_a5"
        },
        select: { id: true, fileId: true, createdAt: true }
      })
    ]);
    const attachmentFileIds = attachments.map((attachment) => attachment.fileId);
    const paymentExecutionIds = paymentExecutions.map((execution) => execution.id);
    const paymentRefunds = paymentExecutionIds.length
      ? await this.prisma.paymentExecutionRefund.findMany({
        where: {
          executionType: "expense_claim_payment_execution",
          expenseClaimPaymentExecutionId: { in: paymentExecutionIds }
        },
        select: {
          id: true, expenseClaimPaymentExecutionId: true, amountCents: true, receivedAt: true,
          reason: true, evidenceReference: true, accountId: true, recordedByUserId: true, createdAt: true
        },
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }]
      })
      : [];
    const refundedCents = paymentRefunds.reduce((total, refund) => total + refund.amountCents, 0n);
    const paymentCapacity = projectClaimPaymentCapacity({
      payableCents: claim.companyPayableAmountCents,
      fundedCents: claim.fundedAmountCents,
      refundedCents
    });
    const attachmentUploaderIds = [...new Set(attachments.map((attachment) => attachment.attachedByUserId))];
    const [files, attachmentUploaders] = await Promise.all([
      attachmentFileIds.length
        ? this.prisma.fileObject.findMany({
            where: { id: { in: attachmentFileIds } },
            select: { id: true, originalName: true, mimeType: true, sizeBytes: true, storageStatus: true }
          })
        : Promise.resolve([]),
      attachmentUploaderIds.length
        ? this.prisma.user.findMany({ where: { id: { in: attachmentUploaderIds } }, select: { id: true, name: true } })
        : Promise.resolve([])
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const uploaderNameById = new Map(attachmentUploaders.map((user) => [user.id, user.name]));
    const loanAccount = existingDetailAccess && claim.claimType === "loan" && claim.applicantUserId && claim.projectId
      ? await this.prisma.employeeProjectLoanAccount.findUnique({
        where: { userId_scopeKey: { userId: claim.applicantUserId, scopeKey: `project:${claim.projectId}` } },
        select: { id: true, fundedAmountCents: true, offsetAmountCents: true, repaidAmountCents: true, reservedOffsetAmountCents: true, balanceAmountCents: true }
      })
      : null;
    const [loanDisbursements, loanRepayments] = claim.claimType === "loan"
      ? await Promise.all([
        this.prisma.employeeProjectLoanEntry.findMany({
          where: { ...(loanAccount ? { loanAccountId: loanAccount.id } : {}), sourceExpenseClaimId: claim.id, entryType: "disbursement" },
          select: { id: true, amountCents: true, occurredAt: true, paymentMethod: true, voucherFileId: true, note: true },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
        }),
        loanAccount ? this.prisma.employeeLoanRepayment.findMany({
          where: { loanAccountId: loanAccount.id },
          select: { id: true, amountCents: true, repaidAt: true, paymentMethod: true, voucherFileId: true, status: true, confirmationNote: true, reversalReason: true, createdAt: true },
          orderBy: [{ repaidAt: "desc" }, { createdAt: "desc" }]
        }) : Promise.resolve([])
      ])
      : [[], []];
    const sourcePurchase = claim.actualPurchaseBatchId
      ? await this.readSourcePurchase(claim.actualPurchaseBatchId)
      : null;
    const canEditReturnedDraft = claim.claimType !== "loan" && claim.handledByUserId === actorUserId && isReturnedExpenseDraft(claim);
    const costBearingCompanyName = claim.costBearingCompanyEntityId
      ? (await this.prisma.companyEntity.findUnique({ where: { id: claim.costBearingCompanyEntityId }, select: { name: true } }))?.name ?? null
      : null;
    const { companyEntityId, voidedAt, ...displayClaim } = claim;
    return {
      ...displayClaim,
      costBearingCompanyName,
      cashCostAllocationOptions,
      bearingCompanyOptions: canEditReturnedDraft && claim.projectId && !claim.actualPurchaseBatchId && !claim.generalProcurementId
        ? await expenseBearingCompanyOptions(this.prisma, [claim.projectId]) : [],
      canEditReturnedDraft,
      canWithdrawApproval: parallel && canConsiderIdentity && !voidedAt && !claim.approvedAt &&
        claim.fundedAmountCents === 0n && claim.handledByUserId === actorUserId && instance?.applicantUserId === actorUserId,
      returnedDraftEntryDefinition: canEditReturnedDraft && claim.claimType === "reimbursement" ? EXPENSE_CLAIM_ENTRY_DEFINITION : null,
      sourcePurchase,
      ...((claim.claimType === "reimbursement" || claim.claimType === "incidental_expense") ? {
        originalDebtorCompanyId: claim.companyEntityNameSnapshot?.trim() ? companyEntityId : null
      } : {}),
      canDeleteDraft: claim.claimType !== "loan" && claim.status === "draft" && !claim.submittedAt && claim.handledByUserId === actorUserId,
      generalProcurement: claim.generalProcurementId ? await this.prisma.generalProcurement.findUnique({ where: { id: claim.generalProcurementId }, select: { id: true, code: true } }) : null,
      project,
      entrySnapshots: await this.prisma.expenseClaimEntrySnapshot.findMany({ where: { expenseClaimId: claim.id }, orderBy: [{ frozenAt: "asc" }, { id: "asc" }] }),
      requestedAmountCents: moneyCentsToApi(claim.requestedAmountCents),
      loanOffsetAmountCents: moneyCentsToApi(claim.loanOffsetAmountCents),
      companyPayableAmountCents: moneyCentsToApi(claim.companyPayableAmountCents),
      fundedAmountCents: moneyCentsToApi(claim.fundedAmountCents),
      approval: currentNode ? {
        currentNodeName: currentNode.name,
        canReview,
        requiresSelfReviewConfirmation: canReview && instance?.applicantUserId === actorUserId,
        ...(parallel ? { approvalInstanceId: instance?.id, actionableDuties: duties } : {})
      } : null,
      attachmentPermissions: { canAppendEvidence: claim.claimType !== "loan" && canReadExistingExpenseEvidence },
      paymentSubjectPermissions: { canAdjust: canAdjustPaymentSubject },
      paymentSubjectCompanyEntities,
      fundsPermissions: {
        canRecordPayment: canPayClaim && roles.includes("finance_staff"),
        canRecordPublicCashPayment,
        canRecordReimbursementPayment: claim.claimType === "reimbursement" && ["approved_pending_payment", "partially_paid"].includes(claim.status) && roles.includes("finance_staff"),
        canGenerateFinalPaymentPdf: claim.claimType === "reimbursement" && claim.status === "paid" && roles.includes("finance_staff"),
        canGenerateLoanFinalDisbursementPdf: false,
        canRecordLoanDisbursement: false,
        canRecordLoanRepayment: false,
        canConfirmLoanRepayment: false,
        canReverseLoanRepayment: false,
        canRecordRefund: claim.claimType === "incidental_expense" &&
          ["approved_pending_payment", "partially_paid", "paid"].includes(claim.status) &&
          ["finance_staff", "finance_director", "comprehensive_director"].some((role) => roles.includes(role as RoleKey)),
        canCorrectAmount: claim.claimType === "incidental_expense" &&
          ["approved_pending_payment", "partially_paid", "paid"].includes(claim.status) &&
          roles.includes("finance_director")
      },
      paymentCapacity: {
        payableCents: moneyCentsToApi(paymentCapacity.payableCents),
        fundedAmountCents: moneyCentsToApi(paymentCapacity.fundedCents),
        refundedCents: moneyCentsToApi(paymentCapacity.refundedCents),
        netPaidCents: moneyCentsToApi(paymentCapacity.netPaidCents),
        remainingPayableCents: moneyCentsToApi(paymentCapacity.remainingPayableCents),
        overpaidCents: moneyCentsToApi(paymentCapacity.overpaidCents),
        status: paymentCapacity.status,
        costConfirmed: claim.status !== "draft" && claim.companyPayableAmountCents > 0n
      },
      paymentRefunds: paymentRefunds.map((refund) => ({
        ...refund,
        amountCents: moneyCentsToApi(refund.amountCents)
      })),
      paymentExecutions: paymentExecutions.map(({ registeredOperationalPayment, ...execution }) => ({
        ...execution,
        amountCents: moneyCentsToApi(execution.amountCents),
        ...(registeredOperationalPayment ? {
          registeredFunding: {
            actualPayerCompanyId: registeredOperationalPayment.actualPayerCompanyId,
            ...(registeredOperationalPayment.actualPayerCompanyId === null ? { actualPayerKind: "public_cash" as const } : {}),
            actualPayerName: registeredOperationalPayment.actualPayerName,
            originalDebtorCompanyId: registeredOperationalPayment.originalDebtorCompanyId,
            relationshipEntryId: registeredOperationalPayment.actualPayerCompanyId !== null &&
              registeredOperationalPayment.actualPayerCompanyId !== registeredOperationalPayment.originalDebtorCompanyId
              ? registeredOperationalPayment.id
              : null
          }
        } : {})
      })),
      loanAccount: loanAccount && {
        ...loanAccount,
        fundedAmountCents: moneyCentsToApi(loanAccount.fundedAmountCents),
        offsetAmountCents: moneyCentsToApi(loanAccount.offsetAmountCents),
        repaidAmountCents: moneyCentsToApi(loanAccount.repaidAmountCents),
        reservedOffsetAmountCents: moneyCentsToApi(loanAccount.reservedOffsetAmountCents),
        balanceAmountCents: moneyCentsToApi(loanAccount.balanceAmountCents)
      },
      loanDisbursements: loanDisbursements.map((entry) => ({ ...entry, amountCents: moneyCentsToApi(entry.amountCents) })),
      loanRepayments: loanRepayments.map((repayment) => ({ ...repayment, amountCents: moneyCentsToApi(repayment.amountCents) })),
      finalPaymentPdf,
      lines: lines.map((line) => ({ ...line, amountCents: moneyCentsToApi(line.amountCents) })),
      attachments: attachments.map((attachment) => {
        const file = fileById.get(attachment.fileId);
        return {
          ...attachment,
          stage: attachment.stage === "appended" ? "post_submit_append" : attachment.stage,
          fileName: file?.originalName ?? "文件信息不可用",
          mimeType: file?.mimeType ?? "application/octet-stream",
          sizeBytes: file?.sizeBytes ?? 0,
          fileStatus: file?.storageStatus ?? "missing",
          attachedByName: uploaderNameById.get(attachment.attachedByUserId) ?? "未知用户"
        };
      })
    };
  }

  async getActionCapability(claimId: string, actorUserId: string, paymentScope?: "public_cash") {
    const detail = await this.getMine(claimId, actorUserId);
    const availableActions: string[] = [];
    const isHandler = detail.handledByUserId === actorUserId;
    if (detail.canDeleteDraft) availableActions.push("delete_expense_claim_draft");
    if (detail.canEditReturnedDraft) availableActions.push("edit_returned_expense_claim");
    if (detail.canWithdrawApproval) availableActions.push("withdraw_expense_claim");

    if (detail.claimType !== "loan" && detail.status === "draft" && isHandler) {
      availableActions.push("submit_expense_claim", "attach_expense_claim_attachment");
      if (detail.attachments.some((attachment) => !attachment.removedAt)) {
        availableActions.push("remove_expense_claim_attachment");
      }
    }
    if (detail.approval?.canReview) {
      availableActions.push("review_expense_claim");
    }
    if (detail.attachmentPermissions.canAppendEvidence) {
      availableActions.push("append_expense_claim_attachment");
    }
    if (detail.paymentSubjectPermissions.canAdjust) {
      availableActions.push("adjust_expense_claim_payment_subject");
    }
    if (paymentScope === "public_cash"
      ? detail.fundsPermissions.canRecordPublicCashPayment
      : detail.fundsPermissions.canRecordPayment) {
      availableActions.push("record_expense_claim_payment");
    }
    if (detail.fundsPermissions.canRecordPublicCashPayment) {
      availableActions.push("record_expense_claim_public_cash_payment");
    }
    if (detail.fundsPermissions.canGenerateFinalPaymentPdf) {
      availableActions.push("generate_expense_claim_final_payment_pdf");
    }
    return {
      claimId: detail.id,
      availableActions,
      removableAttachmentIds:
        detail.claimType !== "loan" && detail.status === "draft" && isHandler
          ? detail.attachments
              .filter((attachment) => !attachment.removedAt)
              .map((attachment) => attachment.id)
          : []
    };
  }

  async getRepaymentActionCapability(
    claimId: string,
    repaymentId: string,
    actorUserId: string
  ) {
    const detail = await this.getMine(claimId, actorUserId);
    const repayment = detail.loanRepayments.find(
      (candidate) => candidate.id === repaymentId
    );
    if (!repayment || !detail.loanAccount) {
      throw new NotFoundException("员工还款记录不存在或不属于当前借款账户");
    }

    return { claimId: detail.id, repaymentId: repayment.id, availableActions: [] };
  }

  async assertActionAvailable(
    claimId: string,
    actorUserId: string,
    action: string
  ) {
    const capability = await this.getActionCapability(claimId, actorUserId);
    if (!capability.availableActions.includes(action)) {
      throw new ForbiddenException("当前费用申请不允许执行该文件上传动作");
    }
  }

  async adjustPaymentSubject(claimId: string, actorUserId: string, input: AdjustExpenseClaimPaymentSubjectDto) {
    const companyEntityId = requiredText(input.companyEntityId, "实际付款主体不能为空");
    const reason = requiredText(input.reason, "调整原因不能为空");
    return translateProjectOperatingSerializationConflict(
      this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null;
        paymentSubjectCompanyEntityId: string | null; paymentSubjectNameSnapshot: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "paymentSubjectCompanyEntityId", "paymentSubjectNameSnapshot" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.claimType !== "reimbursement" || claim.status !== "approved_pending_payment") {
        throw new BadRequestException("仅已批待公司付款的费用报销可以调整实际付款主体");
      }
      const roles = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const adjustedByRoleKey = PAYMENT_SUBJECT_ADJUSTMENT_ROLES.find((role) => roles.includes(role));
      if (!adjustedByRoleKey) throw new ForbiddenException("当前岗位无权调整实际付款主体");
      await lockMasterDataRow(tx, "CompanyEntity", companyEntityId);
      const company = await tx.companyEntity.findFirst({
        where: { id: companyEntityId, isActive: true, dataStatus: "complete" },
        select: { id: true, name: true }
      });
      if (!company) throw new NotFoundException("实际付款主体不存在、未完成资料或已停用");
      if (company.id === claim.paymentSubjectCompanyEntityId) {
        throw new BadRequestException("实际付款主体未发生变化，无需调整");
      }
      const adjustedAt = new Date();
      const updated = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          paymentSubjectCompanyEntityId: company.id,
          paymentSubjectNameSnapshot: company.name,
          paymentSubjectAdjustmentReason: reason,
          paymentSubjectAdjustedAt: adjustedAt,
          paymentSubjectAdjustedByUserId: actorUserId,
          paymentSubjectAdjustedByRoleKey: adjustedByRoleKey
        },
        select: {
          id: true, paymentSubjectCompanyEntityId: true, paymentSubjectNameSnapshot: true,
          paymentSubjectAdjustmentReason: true, paymentSubjectAdjustedAt: true,
          paymentSubjectAdjustedByUserId: true, paymentSubjectAdjustedByRoleKey: true
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.payment_subject.adjust",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: {
          previousCompanyEntityId: claim.paymentSubjectCompanyEntityId,
          previousCompanyEntityName: claim.paymentSubjectNameSnapshot,
          companyEntityId: company.id,
          companyEntityName: company.name,
          reason,
          adjustedByRoleKey
        }
      });
        return updated;
      }),
      "费用申请付款主体遇到参与公司并发变化，请刷新后重试"
    );
  }

  async attachAttachment(claimId: string, actorUserId: string, input: AttachExpenseClaimAttachmentDto) {
    if (!this.files) throw new ServiceUnavailableException("费用附件服务暂不可用，请稍后重试");
    const fileId = requiredText(input.fileId, "请选择费用附件");
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; status: string; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "claimType", "status", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "draft") throw new BadRequestException("费用申请提交后不能替换已冻结附件");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以维护草稿费用附件");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      const file = await this.files!.assertFileHasNoBusinessBinding(tx, fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("费用附件必须由当前经办人本人上传");
      const attachment = await (tx as unknown as {
        expenseClaimAttachment: {
          create(args: { data: Record<string, unknown> }): Promise<{ id: string; fileId: string; category: string; expenseCategory: string | null; stage: string; createdAt: Date }>;
        };
      }).expenseClaimAttachment.create({
        data: {
          expenseClaimId: claim.id,
          fileId,
          category: input.category,
          expenseCategory: optionalText(input.expenseCategory),
          stage: "draft",
          attachedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.attach",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId, category: input.category, expenseCategory: optionalText(input.expenseCategory) }
      });
      return attachment;
    });
  }

  async appendAttachment(claimId: string, actorUserId: string, input: AttachExpenseClaimAttachmentDto) {
    if (!this.files) throw new ServiceUnavailableException("费用附件服务暂不可用，请稍后重试");
    const fileId = requiredText(input.fileId, "请选择费用附件");
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; status: string; projectId: string | null; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "claimType", "status", "projectId", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status === "draft" || claim.status === "rejected" || claim.status === "offset_completed") {
        throw new BadRequestException("当前费用申请不允许追加资料");
      }
      const roleKeys = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const canAppend =
        claim.handledByUserId === actorUserId ||
        roleKeys.some((role) => ["comprehensive_director", "finance_staff", "finance_director"].includes(role));
      if (!canAppend) throw new ForbiddenException("当前账号无权追加费用资料");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      const file = await this.files!.assertFileHasNoBusinessBinding(tx, fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("费用附件必须由追加人本人上传");
      const attachment = await (tx as unknown as {
        expenseClaimAttachment: {
          create(args: { data: Record<string, unknown> }): Promise<{ id: string; fileId: string; category: string; expenseCategory: string | null; stage: string; createdAt: Date }>;
        };
      }).expenseClaimAttachment.create({
        data: {
          expenseClaimId: claim.id,
          fileId,
          category: input.category,
          expenseCategory: optionalText(input.expenseCategory),
          stage: "appended",
          attachedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.append",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId, category: input.category, expenseCategory: optionalText(input.expenseCategory), status: claim.status }
      });
      return { ...attachment, stage: "post_submit_append" };
    });
  }

  async removeAttachment(claimId: string, attachmentId: string, actorUserId: string, input: RemoveExpenseClaimAttachmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; status: string; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "claimType", "status", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "draft") throw new BadRequestException("费用申请提交后不能移除已冻结附件");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以维护草稿费用附件");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      const attachments = await (tx as unknown as {
        expenseClaimAttachment: {
          findFirst(args: { where: { id: string; expenseClaimId: string; removedAt: null }; select: { id: true; fileId: true } }): Promise<{ id: string; fileId: string } | null>;
          update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string; removedAt: Date | null }>;
        };
      }).expenseClaimAttachment;
      const attachment = await attachments.findFirst({
        where: { id: attachmentId, expenseClaimId: claim.id, removedAt: null },
        select: { id: true, fileId: true }
      });
      if (!attachment) throw new NotFoundException("费用附件不存在或已经移除");
      const removed = await attachments.update({
        where: { id: attachment.id },
        data: { removedAt: new Date(), removedByUserId: actorUserId, removalReason: optionalText(input.reason) }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.remove",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId: attachment.fileId, reason: optionalText(input.reason) }
      });
      return removed;
    });
  }

  async deleteUnsubmittedDraft(claimId: string, actorUserId: string, expectedUpdatedAt: string) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.expenseClaim.findUnique({ where: { id: claimId }, select: { generalProcurementId: true } });
      if (source?.generalProcurementId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${source.generalProcurementId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new NotFoundException("费用草稿不存在或已删除");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以删除费用草稿");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
      if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
      if (claim.applicantUserId !== actorUserId || claim.generalProcurementId) {
        const roles = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
        if (!roles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有当前综合部主管可以办理代办草稿");
      }
      const [result] = await tx.$queryRaw<Array<{ deleted: boolean }>>(Prisma.sql`
        SELECT public.jg_delete_unsubmitted_expense_claim(${claimId}, ${actorUserId}, (${new Date(expectedUpdatedAt)}::timestamptz AT TIME ZONE 'UTC')) AS deleted
      `);
      if (!result?.deleted) throw new ConflictException("只能删除从未提交审批的草稿；内容或状态已变化，请刷新后重试");
      return { id: claimId, deleted: true };
    });
  }

  async withdrawApproval(claimId: string, actorUserId: string, expectedRoundId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ExpenseClaim" WHERE id = ${claimId} FOR UPDATE`);
      const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有原经办人可以撤回费用审批");
      await this.assertActiveExpenseActor(tx, actorUserId);
      if (claim.status !== "approval_pending" || claim.approvedAt || claim.voidedAt || claim.fundedAmountCents !== 0n ||
          !supportsExpenseParallelApproval(claim) || claim.approvalInstanceId !== expectedRoundId) {
        throw new ConflictException("费用审批已结束或轮次已变化，不能撤回");
      }
      const [round, extra] = await this.lockActiveExpenseRounds(tx, claimId);
      if (!round || extra || round.id !== expectedRoundId || !isParallelApprovalRound(round.frozenNodes)) {
        throw new ConflictException("费用审批已结束或轮次已变化，不能撤回");
      }
      if (round.applicantUserId !== actorUserId) throw new ForbiddenException("只有原提交人可以撤回费用审批");
      const releasedAmountCents = await this.reopenExpenseDraft(tx, claimId, round.id, actorUserId, "withdrawn", "撤回费用审批");
      await tx.approvalActionLog.create({
        data: { approvalInstanceId: round.id, action: "withdraw", actorUserId }
      });
      await this.audit.record(tx, {
        actorUserId, action: "expense_claim.approval.withdraw", businessType: "expense_claim", businessId: claimId,
        metadata: { approvalInstanceId: round.id, releasedAmountCents: releasedAmountCents.toString() }
      });
      return { id: claimId, status: "draft" };
    });
  }

  async editReturnedDraft(claimId: string, actorUserId: string, input: EditReturnedExpenseClaimDto) {
    const reason = requiredText(input.reason, "事由不能为空");
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.expenseClaim.findUnique({
        where: { id: claimId }, select: { generalProcurementId: true, actualPurchaseBatchId: true }
      });
      if (source?.generalProcurementId && !source.actualPurchaseBatchId) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "GeneralProcurement" WHERE id = ${source.generalProcurementId} FOR UPDATE`);
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ExpenseClaim" WHERE id = ${claimId} FOR UPDATE`);
      const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有原经办人可以修改退回的费用申请");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      await this.assertActiveExpenseActor(tx, actorUserId);
      if (!isReturnedExpenseDraft(claim) || claim.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
        throw new ConflictException("费用草稿状态或版本已变化，请刷新后重试");
      }

      let requestedAmountCents = claim.requestedAmountCents;
      if (claim.claimType === "reimbursement") {
        if (input.requestedAmountCents !== undefined) throw new BadRequestException("报销申请金额须由费用明细合计");
        if (input.lines !== undefined) {
          const lines = await this.prepareExpenseLines(tx, claimId, claim.companyEntityId, this.lines(input.lines));
          requestedAmountCents = positiveCents(lines.reduce((amount, line) => amount + line.amountCents, 0n).toString(), "费用明细合计超出申请金额范围");
          await tx.expenseClaimLine.deleteMany({ where: { expenseClaimId: claimId } });
          await tx.expenseClaimLine.createMany({ data: lines });
        }
      } else {
        if (input.lines !== undefined) throw new BadRequestException("只有费用报销可以填写费用明细");
        if (input.requestedAmountCents !== undefined) {
          requestedAmountCents = positiveCents(input.requestedAmountCents, "申请金额必须大于零");
        }
      }
      if (requestedAmountCents !== claim.requestedAmountCents && claim.generalProcurementId) {
        if (claim.actualPurchaseBatchId) {
          if (!this.actualBatches) throw new ConflictException("实际采购批次容量校验未启用，请联系管理员核对");
          await this.actualBatches.assertClaimCommitInTransaction(tx, {
            batchId: claim.actualPurchaseBatchId, amountCents: requestedAmountCents, excludeClaimId: claimId
          });
        } else {
          const procurement = await tx.generalProcurement.findUnique({ where: { id: claim.generalProcurementId } });
          if (!procurement || procurement.status !== "archived" || procurement.requestProtocolVersion !== 1 ||
              procurement.requestedAmountCents == null || procurement.projectId !== claim.projectId ||
              procurement.companyEntityId !== claim.companyEntityId || `procurement_${procurement.category}` !== claim.incidentalExpenseCategory) {
            throw new ConflictException("原综合采购申请已变化，不能修改请款金额");
          }
          const otherClaims = await tx.expenseClaim.aggregate({
            where: { generalProcurementId: claim.generalProcurementId, id: { not: claimId }, status: { not: "rejected" } },
            _sum: { requestedAmountCents: true }
          });
          if ((otherClaims._sum.requestedAmountCents ?? 0n) + requestedAmountCents > procurement.requestedAmountCents) {
            throw new ConflictException("累计请款金额超过采购批准金额，请刷新后核对剩余额度");
          }
        }
      }
      const costBearingCompany = await expenseCostBearingCompanySelection(tx, {
        companyId: input.costBearingCompanyEntityId, projectId: claim.projectId,
        linkedPurchase: Boolean(claim.actualPurchaseBatchId || claim.generalProcurementId)
      });
      const updated = await tx.expenseClaim.update({
        where: { id: claimId },
        data: { reason, requestedAmountCents, ...costBearingCompany, updatedAt: new Date(Math.max(Date.now(), claim.updatedAt.getTime() + 1)) },
        select: { id: true, status: true, updatedAt: true, requestedAmountCents: true }
      });
      await this.audit.record(tx, {
        actorUserId, action: "expense_claim.draft.edit_returned", businessType: "expense_claim", businessId: claimId,
        metadata: { previousAmountCents: claim.requestedAmountCents.toString(), requestedAmountCents: requestedAmountCents.toString() }
      });
      return { ...updated, requestedAmountCents: moneyCentsToApi(updated.requestedAmountCents) };
    });
  }

  private async assertActiveExpenseActor(tx: Prisma.TransactionClient, actorUserId: string) {
    const [actor] = await tx.$queryRaw<Array<{ isActive: boolean }>>(Prisma.sql`
      SELECT "isActive" FROM "User" WHERE id = ${actorUserId} FOR SHARE
    `);
    if (!actor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
  }

  private async lockActiveExpenseRounds(tx: Prisma.TransactionClient, claimId: string) {
    return tx.$queryRaw<Array<{ id: string; currentNodeIndex: number; frozenNodes: unknown; applicantUserId: string }>>(
      Prisma.sql`SELECT "id", "currentNodeIndex", "frozenNodes", "applicantUserId" FROM "ApprovalInstance"
        WHERE "businessType" = 'expense_claim' AND "businessId" = ${claimId}
          AND "flowType" = 'expense_claim.approve' AND status = 'in_progress'
        ORDER BY "createdAt" DESC LIMIT 2 FOR UPDATE`
    );
  }

  private async reopenExpenseDraft(
    tx: Prisma.TransactionClient, claimId: string, roundId: string, actorUserId: string, roundStatus: "withdrawn" | "returned", reason: string
  ) {
    const releasedAmountCents = await this.releaseLoanOffsetReservations(tx, claimId, actorUserId, reason);
    await tx.approvalInstance.update({ where: { id: roundId }, data: { status: roundStatus } });
    await tx.expenseClaim.update({
      where: { id: claimId },
      data: { status: "draft", approvalInstanceId: null, loanOffsetAmountCents: 0n, companyPayableAmountCents: 0n }
    });
    return releasedAmountCents;
  }

  async submit(claimId: string, actorUserId: string) {
    let approvalNoticesQueued = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; actualPurchaseBatchId: string | null; applicantUserId: string | null; companyEntityId: string; requestedAmountCents: bigint; handledByUserId: string; factWitnessUserId: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "actualPurchaseBatchId", "applicantUserId", "companyEntityId", "requestedAmountCents", "handledByUserId", "factWitnessUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以提交费用申请");
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      if (claim.status !== "draft") throw new BadRequestException("当前费用申请不可提交");
      const source = await tx.expenseClaim.findUnique({ where: { id: claim.id }, select: { generalProcurementId: true, costBearingCompanySpecified: true, costBearingCompanyEntityId: true } });
      if (source?.costBearingCompanySpecified) {
        await expenseCostBearingCompanySelection(tx, { companyId: source.costBearingCompanyEntityId, projectId: claim.projectId,
          linkedPurchase: Boolean(claim.actualPurchaseBatchId || source.generalProcurementId) });
      }
      const currentActor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
      if (!currentActor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
      if (!source?.generalProcurementId && claim.applicantUserId === actorUserId && claim.projectId) {
        await lockMasterDataRow(tx, "Project", claim.projectId);
        const project = await tx.project.findFirst({ where: { id: claim.projectId, isActive: true }, select: { id: true } });
        if (!project) throw new ForbiddenException("申请所属项目不存在或已停用");
        const projectIds = await this.selfApplicationProjectIds(tx, actorUserId);
        if (!projectIds.includes(claim.projectId)) throw new ForbiddenException("当前账号已不属于申请项目，不能提交");
      }
      if (!source?.generalProcurementId && claim.applicantUserId !== actorUserId) {
        const roles = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
        if (!roles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有综合部主管可以代办提交费用申请");
      }
      if (source?.generalProcurementId) {
        const actor = await generalProcurementActor(tx, this.visibility ?? new ProjectVisibilityService(this.prisma), actorUserId, claim.projectId!);
        if (!actor.globalRoleKeys.includes("comprehensive_director")) throw new ForbiddenException("综合采购付款仍须由当前综合部主管提交");
      }
      if (claim.actualPurchaseBatchId && this.actualBatches) {
        await this.actualBatches.assertClaimCommitInTransaction(tx, {
          batchId: claim.actualPurchaseBatchId,
          amountCents: claim.requestedAmountCents,
          excludeClaimId: claim.id
        });
      }
      const offset = await this.reserveLoanOffsets(tx, claim, actorUserId);
      const parallel = supportsExpenseParallelApproval({ ...claim, generalProcurementId: source?.generalProcurementId ?? null });
      const nodes = await this.freezeApprovalNodes(tx, claim, parallel);
      const instance = await tx.approvalInstance.create({
        data: {
          flowType: "expense_claim.approve",
          businessType: "expense_claim",
          businessId: claim.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: nodes as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });
      const attachments = (tx as unknown as {
        expenseClaimAttachment?: {
          updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
        };
      }).expenseClaimAttachment;
      if (attachments) {
        await attachments.updateMany({
          where: { expenseClaimId: claim.id, stage: "draft", removedAt: null },
          data: { stage: "approval_frozen", frozenAt: new Date() }
        });
      }
      const updated = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: "approval_pending",
          approvalInstanceId: instance.id,
          submittedAt: new Date(),
          loanOffsetAmountCents: offset.amountCents,
          companyPayableAmountCents:
            claim.claimType === "reimbursement"
              ? claim.requestedAmountCents - offset.amountCents
              : claim.claimType === "incidental_expense"
                ? claim.requestedAmountCents
                : 0n
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.submit",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { claimType: claim.claimType, approvalInstanceId: instance.id }
      });
      await freezeExpenseClaimEntryInTransaction(tx, claim.id, actorUserId, instance.id);
      if (parallel && this.fundingNotifications) {
        approvalNoticesQueued = await this.fundingNotifications.queueApprovalDuties(tx, {
          id: claim.id, projectId: claim.projectId, status: updated.status, approvalInstanceId: instance.id
        }, { id: instance.id, frozenNodes: nodes }, actorUserId);
      }
      const companyPayableAmountCents =
        claim.claimType === "reimbursement"
          ? claim.requestedAmountCents - offset.amountCents
          : claim.claimType === "incidental_expense"
            ? claim.requestedAmountCents
            : 0n;
      return { id: updated.id, status: updated.status, approvalInstanceId: instance.id, loanOffsetAmountCents: moneyCentsToApi(offset.amountCents), companyPayableAmountCents: moneyCentsToApi(companyPayableAmountCents) };
    });
    if (approvalNoticesQueued) void this.fundingNotifications?.afterCommit();
    return result;
  }

  async migrateLegacyApprovalRound(
    claimId: string,
    actorUserId: string,
    coordinates: { approvalInstanceId: string; claimUpdatedAt: Date; approvalUpdatedAt: Date }
  ) {
    if (!this.writeFreeze.isFrozen("expense")) {
      throw new ConflictException("须暂停费用写入后才能接续历史审批");
    }
    if (!this.files || !this.fundingNotifications) {
      throw new ServiceUnavailableException("费用审批接续服务暂不可用，请稍后重试");
    }
    return migrateLegacyExpenseApprovalRound(
      this.prisma, this.audit, this.files, this.fundingNotifications, claimId, actorUserId, coordinates
    );
  }

  async review(claimId: string, actorUserId: string, input: ReviewExpenseClaimDto) {
    const confirmation = await this.prepareSelfReviewConfirmation(claimId, actorUserId, input);
    let notificationQueued = false;
    const result = await translateProjectOperatingSerializationConflict(
      this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; actualPurchaseBatchId: string | null; generalProcurementId: string | null; approvalInstanceId: string | null; applicantUserId: string | null; handledByUserId: string; factWitnessUserId: string | null; requestedAmountCents: bigint; loanOffsetAmountCents: bigint; companyPayableAmountCents: bigint; approvedAt: Date | null; voidedAt: Date | null; fundedAmountCents: bigint; costBearingCompanySpecified: boolean; costBearingCompanyEntityId: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "actualPurchaseBatchId", "generalProcurementId", "approvalInstanceId", "applicantUserId", "handledByUserId", "factWitnessUserId", "requestedAmountCents", "loanOffsetAmountCents", "companyPayableAmountCents", "approvedAt", "voidedAt", "fundedAmountCents", "costBearingCompanySpecified", "costBearingCompanyEntityId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "approval_pending") throw new BadRequestException("当前费用申请不可审批");
      const instances = await this.lockActiveExpenseRounds(tx, claim.id);
      const instance = instances[0];
      if (!instance) throw new BadRequestException("费用申请审批实例不存在");
      const parallel = isParallelApprovalRound(instance.frozenNodes);
      if (parallel && (instances.length !== 1 || claim.approvalInstanceId !== instance.id || !supportsExpenseParallelApproval(claim))) {
        throw new ConflictException("费用审批轮次已变化，请刷新后重新确认");
      }
      const nodeIndex = resolveExpenseReviewNodeIndex(instance, input);
      const nodes = instance.frozenNodes as unknown as ExpenseClaimApprovalNode[];
      const node = nodes[nodeIndex];
      if (!node) throw new BadRequestException("费用申请当前审批节点不存在");
      const roleScopes = parallel ? await loadExpenseApprovalRoleScopes(tx, actorUserId, claim.projectId) : undefined;
      const roles = roleScopes ? [...roleScopes.globalRoleKeys, ...roleScopes.projectRoleKeys]
        : await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const identity = roleScopes ? resolveExpenseParallelDutyIdentity({ node, actorUserId, actorRoleScopes: roleScopes })
        : resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: roles });
      if (!identity) {
        throw new ForbiddenException("当前用户不是费用申请的冻结审批人");
      }
      if (claim.claimType === "loan") throw new GoneException(RETIRED_EMPLOYEE_LOAN);
      if (parallel && input.decision === "reject") await this.assertActiveExpenseActor(tx, actorUserId);
      const selfReview = this.selfReviewMetadata(instance.applicantUserId, actorUserId, identity, input);
      if (selfReview.isSelfReview) {
        const [current] = await tx.$queryRaw<Array<{ isActive: boolean; passwordHash: string | null }>>(Prisma.sql`
          SELECT "isActive", "passwordHash" FROM "User" WHERE "id" = ${actorUserId} FOR UPDATE
        `);
        if (!confirmation || confirmation.instanceId !== instance.id || confirmation.nodeIndex !== nodeIndex ||
            !current?.isActive || !confirmation.passwordHash || current.passwordHash !== confirmation.passwordHash) {
          throw new ConflictException("自审资格或登录凭据已变化，请刷新后重新确认");
        }
      }

      if (input.decision === "reject") {
        const comment = parallel ? requiredText(input.comment, "驳回费用申请必须填写原因") : optionalText(input.comment);
        let releasedAmountCents: bigint;
        if (parallel) {
          if (claim.approvedAt || claim.voidedAt || claim.fundedAmountCents !== 0n) {
            throw new ConflictException("费用审批已结束，不能退回");
          }
          releasedAmountCents = await this.reopenExpenseDraft(tx, claim.id, instance.id, actorUserId, "returned", "费用审批退回");
        } else {
          releasedAmountCents = await this.releaseLoanOffsetReservations(tx, claim.id, actorUserId, "审批驳回");
          await tx.expenseClaim.update({ where: { id: claim.id }, data: { status: "rejected" } });
          await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: "rejected" } });
        }
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: parallel ? "return_to_applicant" : "reject",
            actorUserId,
            comment,
            approvedRoleKey: identity.approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(parallel || selfReview.isSelfReview ? { metadata: { ...selfReview.metadata, ...(parallel ? { nodeIndex } : {}) } } : {})
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "expense_claim.approval.reject",
          businessType: "expense_claim",
          businessId: claim.id,
          metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, releasedAmountCents: releasedAmountCents.toString(), ...selfReview.metadata }
        });
        if (this.fundingNotifications) {
          notificationQueued = await this.fundingNotifications.queueApprovalCorrection(tx, claim.id, instance, actorUserId);
        }
        return { id: claim.id, status: parallel ? "draft" : "rejected" };
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, { required: true });
      const nextNodes = [...nodes];
      nextNodes[nodeIndex] = { ...node, approvedRoleKeys: [identity.approvedRoleKey] };
      const nextNodeIndex = parallel ? (activeApprovalNodeIndexes(nextNodes, nodeIndex)[0] ?? nextNodes.length)
        : nodeIndex + 1;
      const completed = nextNodeIndex >= nextNodes.length;
      const approvedAt = completed ? new Date() : null;
      if (approvedAt && claim.costBearingCompanySpecified) {
        await expenseCostBearingCompanySelection(tx, {
          companyId: claim.costBearingCompanyEntityId, projectId: claim.projectId,
          linkedPurchase: Boolean(claim.actualPurchaseBatchId || claim.generalProcurementId), occurredAt: approvedAt
        });
      }
      const postedAmountCents = completed && claim.claimType === "reimbursement"
        ? await this.postLoanOffsetReservations(tx, claim, actorUserId)
        : 0n;
      const claimUpdate = completed
        ? { status: claim.companyPayableAmountCents > 0n ? "approved_pending_payment" : "offset_completed", approvedAt }
        : { status: "approval_pending" };
      const updated = await tx.expenseClaim.update({ where: { id: claim.id }, data: claimUpdate });
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { currentNodeIndex: nextNodeIndex, frozenNodes: nextNodes as unknown as Prisma.InputJsonValue, status: completed ? "approved" : "in_progress" }
      });
      await tx.approvalActionLog.create({
        data: await withApprovalIdentity(tx, {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: optionalText(input.comment),
          approvedRoleKey: identity.approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(parallel || selfReview.isSelfReview ? { metadata: { ...selfReview.metadata, ...(parallel ? { nodeIndex } : {}) } } : {}),
          signatureFileIdSnapshot: signature.fileId,
          signatureSha256Snapshot: signature.sha256,
          signatureVersionIdSnapshot: signature.versionId
        }, signature)
      });
      if (completed && claim.actualPurchaseBatchId) {
        await this.actualBatches?.assertClaimCommitInTransaction(tx, {
          batchId: claim.actualPurchaseBatchId,
          amountCents: claim.requestedAmountCents,
          excludeClaimId: claim.id
        });
        await this.actualBatches?.confirmCostForClaimInTransaction(
          tx,
          claim.id,
          actorUserId,
          updated.approvedAt ?? new Date()
        );
      }
      if (
        completed &&
        claim.projectId &&
        (claim.claimType === "reimbursement" ||
          claim.claimType === "incidental_expense")
      ) {
        await this.appendOperatingExpenseClaimApproval(
          tx,
          claim.projectId,
          updated.id,
          actorUserId
        );
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.approval.approve",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, completed, postedAmountCents: postedAmountCents.toString(), ...selfReview.metadata }
      });
      if (completed && this.fundingNotifications) {
        notificationQueued = await this.fundingNotifications.queue(tx, updated, actorUserId);
      }
      return { id: updated.id, status: updated.status, completed, approvalInstanceId: completed ? instance.id : null };
      }),
      "费用审批遇到参与公司并发变化，请刷新后重试"
    );
    if (notificationQueued) void this.fundingNotifications?.afterCommit();
    if (result.completed && result.approvalInstanceId) {
      await this.approvalForms
        ?.generateForInstance(result.approvalInstanceId, actorUserId)
        .catch(async () => {
          await this.audit.record(this.prisma, {
            actorUserId,
            action: "expense_claim.approval_form.generation_failed",
            businessType: "expense_claim",
            businessId: claimId,
            metadata: { approvalInstanceId: result.approvalInstanceId }
          });
        });
    }
    return { id: result.id, status: result.status, completed: result.completed };
  }

  async recordReimbursementPayment(claimId: string, actorUserId: string, input: RecordExpenseClaimPaymentDto) {
    return this.recordPayment(claimId, actorUserId, input);
  }

  async recordPayment(claimId: string, actorUserId: string, input: RecordExpenseClaimPaymentDto) {
    const amountCents = positiveCents(input.amountCents, "补付金额必须大于零");
    const voucherFileId = requiredText(input.voucherFileId, "补付凭证必填");
    const paymentMethod = requiredText(input.paymentMethod, "补付方式必填");
    const paidAt = dateOnly(input.paidAt, "付款日期");
    const note = optionalText(input.note);
    if (paidAt.getTime() > Date.now()) throw new BadRequestException("付款日期不能晚于当前时间");
    if (!this.auth || !input.confirmationPassword?.trim()) throw new BadRequestException("补付登记需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    const result = await translateProjectOperatingSerializationConflict(
      this.prisma.$transaction(async (tx) => {
      const fundingScope = this.projectFunding && !input.registeredFunding
        ? await tx.expenseClaim.findUnique({
            where: { id: claimId },
            select: { id: true, claimType: true, projectId: true }
          })
        : null;
      if (this.projectFunding && !input.registeredFunding && !fundingScope?.projectId) {
        throw new BadRequestException(
          fundingScope?.claimType === "incidental_expense"
            ? "零星费用未关联项目，不能登记实际支付"
            : "报销申请未关联项目，不能登记公司补付"
        );
      }
      if (this.projectFunding && fundingScope?.projectId) {
        await this.projectFunding.lockFundingContext(
          tx,
          fundingScope.projectId
        );
      }
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; status: string; projectId: string | null; generalProcurementId: string | null; companyEntityId: string; companyEntityNameSnapshot: string; companyPayableAmountCents: bigint; fundedAmountCents: bigint }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "generalProcurementId", "companyEntityId", "companyEntityNameSnapshot", "companyPayableAmountCents", "fundedAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (
        fundingScope &&
        (fundingScope.id !== claim.id ||
          fundingScope.projectId !== claim.projectId)
      ) {
        throw new BadRequestException(
          "费用申请的项目资金范围已变化，请刷新后重试"
        );
      }
      if (
        claim.claimType !== "reimbursement" &&
        claim.claimType !== "incidental_expense"
      ) {
        throw new BadRequestException("当前费用申请不可登记实际支付");
      }
      const businessType =
        claim.claimType === "incidental_expense"
          ? "incidental_expense"
          : "expense_claim";
      const existingExecution = await tx.expenseClaimPaymentExecution.findUnique({ where: { voucherFileId } });
      const registeredSource = (executionId: string) => ({
        sourceType: "expense_claim_payment_execution" as const,
        executionId,
        actorUserId,
        projectId: claim.projectId,
        originalDebtorCompanyId: claim.companyEntityId,
        amountCents,
        paidAt,
        funding: input.registeredFunding
      });
      if (existingExecution) {
        if (
          existingExecution.expenseClaimId !== claim.id ||
          existingExecution.amountCents !== amountCents ||
          existingExecution.paidAt.getTime() !== paidAt.getTime() ||
          existingExecution.paymentMethod !== paymentMethod ||
          existingExecution.recordedByUserId !== actorUserId ||
          existingExecution.note !== note
        ) {
          throw new ConflictException(
            "该补付凭证已绑定不同的公司补付事实"
          );
        }
        const registered = await readRegisteredOperationalPayment(tx, registeredSource(existingExecution.id));
        if (!registered && this.projectFunding) {
          await this.projectFunding.allocateExecution(tx, {
            projectId: claim.projectId!,
            executionType: "expense_claim_payment_execution",
            executionId: existingExecution.id,
            businessType,
            businessId: claim.id,
            amountCents,
            occurredAt: paidAt,
            actorUserId
          });
        }
        if (!registered && claim.projectId) {
          await this.appendOperatingExpenseClaimPaymentExecution(
            tx,
            claim.projectId,
            existingExecution.id,
            actorUserId
          );
        }
        return {
          id: existingExecution.id,
          expenseClaimId: claim.id,
          paidAmountCents: moneyCentsToApi(claim.fundedAmountCents),
          status: claim.status,
          claimType: claim.claimType,
          replayed: true,
          ...(registered ? { registeredFunding: registered } : {})
        };
      }
      if (!["approved_pending_payment", "partially_paid"].includes(claim.status)) throw new BadRequestException("当前费用申请不可登记实际支付");
      const refundedBefore = await tx.paymentExecutionRefund.aggregate({
        where: {
          executionType: "expense_claim_payment_execution",
          expenseClaimExecution: { is: { expenseClaimId: claim.id } }
        },
        _sum: { amountCents: true }
      });
      const capacityBefore = projectClaimPaymentCapacity({
        payableCents: claim.companyPayableAmountCents,
        fundedCents: claim.fundedAmountCents,
        refundedCents: refundedBefore._sum?.amountCents ?? 0n
      });
      if (amountCents > capacityBefore.remainingPayableCents) throw new BadRequestException("补付金额超过当前待付金额");
      const voucher = await tx.fileObject.findUnique({ where: { id: voucherFileId }, select: { id: true, uploadedByUserId: true } });
      if (!voucher) throw new NotFoundException("补付凭证不存在");
      if (voucher.uploadedByUserId !== actorUserId) throw new BadRequestException("补付凭证必须由登记人本人上传");
      const funding = input.registeredFunding;
      const isPublicCash = funding?.scopeKey === "public_cash";
      if (this.files && !isPublicCash) {
        if (!funding && claim.claimType === "incidental_expense" && claim.generalProcurementId && claim.projectId) {
          await this.files.assertFileHasNoBusinessBinding(tx, voucherFileId, undefined, {
            claimId: claim.id, projectId: claim.projectId, actorUserId
          });
        } else {
          await this.files.assertFileHasNoBusinessBinding(tx, voucherFileId);
        }
      }
      if (funding && (!claim.projectId || !claim.companyEntityId || !claim.companyEntityNameSnapshot?.trim())) {
        throw new ConflictException("原报销债务公司或项目归属待核对，不能登记资金实付");
      }
      const execution = isPublicCash
        ? await recordExpensePublicCashVoucher(tx, { claimId: claim.id, actorUserId, amountCents, paidAt,
            paymentMethod, voucherFileId, note, previousRegistrationId: funding.expectedRegistrationId })
        : await tx.expenseClaimPaymentExecution.create({
            data: { expenseClaimId: claim.id, amountCents, paidAt, paymentMethod, voucherFileId, recordedByUserId: actorUserId, note }
          });
      const registered = funding
        ? await appendRegisteredOperationalPayment(tx, { ...registeredSource(execution.id), funding })
        : null;
      const fundingAllocation =
        !registered && this.projectFunding && claim.projectId
          ? await this.projectFunding.allocateExecution(tx, {
              projectId: claim.projectId,
              executionType:
                "expense_claim_payment_execution",
              executionId: execution.id,
              businessType,
              businessId: claim.id,
              amountCents,
              occurredAt: paidAt,
              actorUserId
            })
          : null;
      const fundedAmountCents = claim.fundedAmountCents + amountCents;
      const status = projectClaimPaymentCapacity({
        payableCents: claim.companyPayableAmountCents,
        fundedCents: fundedAmountCents,
        refundedCents: refundedBefore._sum?.amountCents ?? 0n
      }).status;
      await tx.expenseClaim.update({ where: { id: claim.id }, data: { fundedAmountCents, status } });
      if (claim.projectId) {
        await this.appendOperatingExpenseClaimPaymentExecution(
          tx,
          claim.projectId,
          execution.id,
          actorUserId
        );
      }
      await this.audit.record(tx, { actorUserId, action: claim.claimType === "incidental_expense" ? "incidental_expense.payment.record" : "expense_claim.reimbursement.payment.record", businessType, businessId: claim.id, metadata: { paymentExecutionId: execution.id, amountCents: amountCents.toString(), voucherFileId, paymentMethod, ...(registered ? { registeredFunding: registered } : {}), fundingAllocation: fundingAllocation ? { kind: fundingAllocation.kind, projectCashAmountCents: fundingAllocation.projectCashAmountCents.toString(), financingQuotaAmountCents: fundingAllocation.financingQuotaAmountCents.toString(), allocations: fundingAllocation.allocations.map((allocation) => ({ sourceType: allocation.sourceType, sourceId: allocation.sourceId, amountCents: allocation.amountCents.toString() })) } : null } });
        return { id: execution.id, expenseClaimId: claim.id, paidAmountCents: moneyCentsToApi(fundedAmountCents), status, claimType: claim.claimType, replayed: false, ...(registered ? { registeredFunding: registered } : {}) };
      }),
      "费用付款遇到参与公司并发变化，请刷新后重试"
    );
    if (result.status === "paid" && !result.replayed && result.claimType === "reimbursement") {
      await this.ensureReimbursementFinalPaymentPdf(claimId, actorUserId).catch(async () => {
        await this.audit.record(this.prisma, { actorUserId, action: "expense_claim.reimbursement.final_pdf.generation_failed", businessType: "expense_claim", businessId: claimId, metadata: {} });
      });
    }
    return {
      id: result.id,
      expenseClaimId: result.expenseClaimId,
      paidAmountCents: result.paidAmountCents,
      status: result.status,
      ...(result.registeredFunding ? { registeredFunding: result.registeredFunding } : {})
    };
  }

  async generateReimbursementFinalPaymentPdf(claimId: string, actorUserId: string) {
    return this.ensureReimbursementFinalPaymentPdf(claimId, actorUserId);
  }

  private async ensureReimbursementFinalPaymentPdf(claimId: string, actorUserId: string) {
    if (!this.files) throw new ServiceUnavailableException("费用付讫归档文件服务暂不可用，请稍后重试");
    const [claim, existingPdf, payments] = await Promise.all([
      this.prisma.expenseClaim.findUnique({
        where: { id: claimId },
        select: {
          id: true, code: true, claimType: true, status: true, companyEntityNameSnapshot: true, paymentSubjectNameSnapshot: true,
          projectId: true, applicantNameSnapshot: true, reason: true, requestedAmountCents: true, loanOffsetAmountCents: true,
          companyPayableAmountCents: true, fundedAmountCents: true
        }
      }),
      this.prisma.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claimId, templateKey: "expense_claim_final_payment_a5" } }),
      this.prisma.expenseClaimPaymentExecution.findMany({
        where: { expenseClaimId: claimId },
        select: {
          paidAt: true, paymentMethod: true, amountCents: true, note: true,
          registeredOperationalPayment: { select: { actualPayerName: true } }
        },
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
      })
    ]);
    if (!claim || claim.claimType !== "reimbursement") throw new NotFoundException("费用报销申请不存在");
    if (existingPdf) return { pdfDocumentId: existingPdf.id, fileId: existingPdf.fileId, existed: true };
    const paidAmount = payments.reduce((total, payment) => total + payment.amountCents, 0n);
    if (claim.status !== "paid" || claim.companyPayableAmountCents <= 0n || claim.fundedAmountCents !== claim.companyPayableAmountCents || paidAmount !== claim.companyPayableAmountCents) {
      throw new BadRequestException("公司补付全部完成后才能生成付讫归档 PDF");
    }
    const project = claim.projectId
      ? await this.prisma.project.findUnique({ where: { id: claim.projectId }, select: { code: true, name: true } })
      : null;
    const buffer = await renderExpenseClaimFinalPaymentPdf({
      code: claim.code,
      companyName: claim.companyEntityNameSnapshot,
      paymentSubjectName: claim.paymentSubjectNameSnapshot ?? claim.companyEntityNameSnapshot,
      projectName: project ? `${project.code} · ${project.name}` : "",
      applicantName: claim.applicantNameSnapshot,
      reason: claim.reason,
      requestedAmountCents: claim.requestedAmountCents,
      loanOffsetAmountCents: claim.loanOffsetAmountCents,
      companyPayableAmountCents: claim.companyPayableAmountCents,
      paidAmountCents: paidAmount,
      payments: payments.map(({ registeredOperationalPayment, ...payment }) => ({
        ...payment,
        ...(registeredOperationalPayment ? { actualPayerName: registeredOperationalPayment.actualPayerName } : {})
      }))
    });
    const file = await this.files.uploadPrivateFile({ originalName: `${claim.code}-expense-claim-final-payment-a5.pdf`, mimeType: "application/pdf", sizeBytes: buffer.length, uploadedByUserId: actorUserId, buffer });
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claim.id, templateKey: "expense_claim_final_payment_a5" } });
      if (duplicate) return { pdfDocumentId: duplicate.id, fileId: duplicate.fileId, existed: true };
      const pdfDocument = await tx.pdfDocument.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, templateKey: "expense_claim_final_payment_a5" } });
      const archiveRecord = await tx.archiveRecord.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, departmentScope: "finance" } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.reimbursement.final_pdf.archive", businessType: "expense_claim", businessId: claim.id, metadata: { code: claim.code, fileId: file.id, pdfDocumentId: pdfDocument.id, archiveRecordId: archiveRecord.id } });
      return { pdfDocumentId: pdfDocument.id, fileId: file.id, existed: false };
    });
  }

  private async prepareExpenseLines(
    tx: Prisma.TransactionClient, expenseClaimId: string, companyId: string, lines: ExpenseClaimLineDto[], advanceCategory?: string
  ) {
    const knownCategories = await this.companyExpenseCategories(tx, companyId);
    return lines.map((line, index) => {
      const expenseCategory = resolveExpenseCategoryName(requiredText(line.expenseCategory, "费用类别不能为空"), knownCategories);
      if (!expenseCategory) throw new BadRequestException("费用类别不能为空且最多 40 个字符");
      if (advanceCategory && expenseCategoryKey(expenseCategory) !== expenseCategoryKey(advanceCategory)) {
        throw new BadRequestException(`关联原采购报销沿用原采购类别：${advanceCategory}`);
      }
      return {
        expenseClaimId, sortOrder: index + 1, expenseCategory,
        occurredOn: dateOnly(line.occurredOn, "发生日期"),
        quantity: parseExpenseQuantity(line.quantity),
        purpose: requiredText(line.purpose, "用途说明不能为空"),
        receiptCount: receiptCount(line.receiptCount),
        amountCents: positiveCents(line.amountCents, "费用明细金额必须大于零"),
        evidenceType: line.evidenceType,
        noEvidenceReason: line.evidenceType === "none" ? requiredText(line.noEvidenceReason, "无凭证原因必填") : null,
        remark: optionalText(line.remark)
      };
    });
  }

  private lines(lines: ExpenseClaimLineDto[] | undefined) {
    if (!lines?.length) throw new BadRequestException("报销至少需要一条费用明细");
    return lines;
  }

  /**
   * #404 PUR-12：垫付报销详情带出原采购信息及附件，便于审批人核对同一成本来源。
   * 只读；原采购事实、附件与批次成本均不被报销改写。
   */
  private async readSourcePurchase(batchId: string) {
    const batch = await this.prisma.actualPurchaseBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true, kind: true, supplierName: true, status: true, totalAmountCents: true,
        effectiveTotalAmountCents: true, costVersion: true, costConfirmedAt: true,
        procurementId: true, procurementVersionId: true, projectId: true, companyEntityId: true
      }
    });
    if (!batch) return null;
    let procurementCode: string | null = null;
    let categoryLabel: string | null = batch.kind === "spot_material" ? "零星材料" : null;
    let attachmentRefs: Array<{ fileId: string; category: string }> = [];
    if (batch.kind === "general") {
      const source = await this.prisma.generalProcurement.findUnique({
        where: { id: batch.procurementId },
        select: { id: true, code: true, category: true, archiveFileId: true }
      });
      procurementCode = source?.code ?? null;
      categoryLabel = GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === source?.category)?.label ?? null;
      if (source?.archiveFileId) attachmentRefs = [{ fileId: source.archiveFileId, category: "procurement_archive" }];
    } else if (batch.kind === "spot_material") {
      const [source, version] = await Promise.all([
        this.prisma.spotProcurement.findUnique({ where: { id: batch.procurementId }, select: { id: true, code: true, currentVersionId: true } }),
        this.prisma.spotProcurementVersion.findFirst({
          where: { procurementId: batch.procurementId, id: batch.procurementVersionId ?? undefined },
          orderBy: { versionNo: "desc" },
          select: { id: true }
        })
      ]);
      procurementCode = source?.code ?? null;
      const versionId = batch.procurementVersionId ?? version?.id ?? source?.currentVersionId ?? null;
      const spotAttachments = versionId
        ? await this.prisma.spotProcurementAttachment.findMany({
            where: { versionId },
            select: { fileId: true, category: true },
            orderBy: { createdAt: "asc" }
          })
        : [];
      attachmentRefs = spotAttachments.map((item) => ({ fileId: item.fileId, category: item.category }));
    }
    const files = attachmentRefs.length
      ? await this.prisma.fileObject.findMany({
          where: { id: { in: attachmentRefs.map((item) => item.fileId) } },
          select: { id: true, originalName: true, mimeType: true, sizeBytes: true, storageStatus: true }
        })
      : [];
    const fileById = new Map(files.map((file) => [file.id, file]));
    return {
      batchId: batch.id,
      kind: batch.kind,
      supplierName: batch.supplierName,
      status: batch.status,
      totalAmountCents: moneyCentsToApi(batch.totalAmountCents),
      effectiveTotalAmountCents: moneyCentsToApi(batch.effectiveTotalAmountCents),
      costConfirmed: batch.costVersion > 0,
      costConfirmedAt: batch.costConfirmedAt,
      procurementId: batch.procurementId,
      procurementCode,
      categoryLabel,
      projectId: batch.projectId,
      companyEntityId: batch.companyEntityId,
      attachments: attachmentRefs.map((ref) => {
        const file = fileById.get(ref.fileId);
        return {
          fileId: ref.fileId,
          category: ref.category,
          fileName: file?.originalName ?? "文件信息不可用",
          mimeType: file?.mimeType ?? "application/octet-stream",
          sizeBytes: file?.sizeBytes ?? 0,
          fileStatus: file?.storageStatus ?? "missing"
        };
      })
    };
  }

  /**
   * #404 EXP-01/PUR-12：员工手工选择已有实际采购批次办理垫付报销。
   * 不做任何自动识别或金额匹配；只列同一公司、同一项目下仍可占用容量的批次，
   * 由填单人核对供应商和原采购信息后自行选择。
   */
  async selectableAdvanceBatches(
    actorUserId: string,
    filter: { companyEntityId?: string; projectId?: string }
  ) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    if (!actor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
    const companyId = filter.companyEntityId?.trim();
    if (!companyId) return { batches: [] };
    const company = await this.prisma.companyEntity.findFirst({ where: { id: companyId, isActive: true }, select: { id: true } });
    if (!company) throw new NotFoundException("使用单位不存在或已停用");
    const projectId = filter.projectId?.trim() || null;
    if (projectId) {
      const projectIds = await this.selfApplicationProjectIds(this.prisma, actorUserId);
      if (!projectIds.includes(projectId)) throw new ForbiddenException("当前账号无权选择该项目");
    }
    const rows = await this.prisma.actualPurchaseBatch.findMany({
      where: {
        OR: [
          { companyEntityId: companyId },
          { kind: "spot_material", companyEntityId: null }
        ],
        projectId,
        status: { in: ["recorded", "cost_confirmed"] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, kind: true, procurementId: true, supplierName: true, status: true, totalAmountCents: true, effectiveTotalAmountCents: true, costVersion: true }
    });
    if (!rows.length) return { batches: [] };
    const generalIds = rows.filter((row) => row.kind === "general").map((row) => row.procurementId);
    const spotIds = rows.filter((row) => row.kind === "spot_material").map((row) => row.procurementId);
    const [generalSources, spotSources] = await Promise.all([
      generalIds.length
        ? this.prisma.generalProcurement.findMany({ where: { id: { in: generalIds } }, select: { id: true, code: true, category: true } })
        : Promise.resolve([]),
      spotIds.length
        ? this.prisma.spotProcurement.findMany({ where: { id: { in: spotIds } }, select: { id: true, code: true } })
        : Promise.resolve([])
    ]);
    const generalById = new Map(generalSources.map((source) => [source.id, source]));
    const spotById = new Map(spotSources.map((source) => [source.id, source]));
    const batches = [];
    for (const row of rows) {
      const capacity = this.actualBatches ? await this.actualBatches.capacityForBatch(row.id) : null;
      if (!capacity || capacity.availableAmountCents <= 0n || capacity.suspended) continue;
      const general = generalById.get(row.procurementId);
      const spot = spotById.get(row.procurementId);
      batches.push({
        batchId: row.id,
        kind: row.kind,
        supplierName: row.supplierName,
        status: row.status,
        totalAmountCents: moneyCentsToApi(row.totalAmountCents),
        effectiveTotalAmountCents: moneyCentsToApi(row.effectiveTotalAmountCents),
        availableAmountCents: moneyCentsToApi(capacity.availableAmountCents),
        costConfirmed: row.costVersion > 0,
        procurementId: row.procurementId,
        procurementCode: general?.code ?? spot?.code ?? null,
        categoryLabel: row.kind === "spot_material"
          ? "零星材料"
          : GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === general?.category)?.label ?? null
      });
    }
    return { batches };
  }

  private async companyExpenseCategories(tx: Prisma.TransactionClient, companyEntityId: string): Promise<string[]> {
    const usage = await tx.$queryRaw<Array<{ name: string; count: number }>>(Prisma.sql`
      SELECT line."expenseCategory" AS name, COUNT(*)::int AS count
      FROM "ExpenseClaimLine" line
      JOIN "ExpenseClaim" claim ON claim."id" = line."expenseClaimId"
      WHERE claim."companyEntityId" = ${companyEntityId}
      GROUP BY line."expenseCategory"
    `);
    return [
      ...DEFAULT_EXPENSE_CATEGORIES,
      ...usage
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-Hans-CN"))
        .map((row) => row.name)
    ];
  }

  /** 公司级可复用费用类别：默认 10 类 + 本公司已用类别，同名只出现一次。 */
  async expenseCategories(actorUserId: string, companyEntityId?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    if (!actor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
    const companyId = companyEntityId?.trim();
    if (companyId) {
      const company = await this.prisma.companyEntity.findFirst({ where: { id: companyId, isActive: true }, select: { id: true } });
      if (!company) throw new NotFoundException("使用单位不存在或已停用");
    }
    const usage = await this.prisma.$queryRaw<Array<{ name: string; count: number }>>(companyId
      ? Prisma.sql`
          SELECT line."expenseCategory" AS name, COUNT(*)::int AS count
          FROM "ExpenseClaimLine" line
          JOIN "ExpenseClaim" claim ON claim."id" = line."expenseClaimId"
          WHERE claim."companyEntityId" = ${companyId}
          GROUP BY line."expenseCategory"
        `
      : Prisma.sql`
          SELECT line."expenseCategory" AS name, COUNT(*)::int AS count
          FROM "ExpenseClaimLine" line
          GROUP BY line."expenseCategory"
        `);
    return {
      categories: mergeExpenseCategories(
        usage.map((row) => ({ name: row.name, usageCount: Number(row.count) }))
      )
    };
  }

  /**
   * #404 PUR-12：员工从原采购单垫付报销只认实际采购批次这一成本来源。
   * 供应商、原采购信息与附件从批次/原申请带出；此处只校验来源身份、沿用类别
   * 并在事务内占用批次剩余可付金额，成本仍由批次确认一次。
   */
  private async resolveEmployeeAdvanceSource(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    input: CreateExpenseClaimDto,
    amountCents: bigint
  ) {
    const batchId = input.actualPurchaseBatchId?.trim();
    if (!batchId) throw new BadRequestException("请选择实际采购批次");
    const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException("实际采购批次不存在，请刷新后重选");
    let categoryLabel: string | null = null;
    if (batch.kind === "general") {
      const source = await tx.generalProcurement.findUnique({ where: { id: batch.procurementId }, select: { category: true } });
      categoryLabel = GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === source?.category)?.label ?? null;
    }
    const sourceCategory = assertEmployeeAdvanceBatchSource({
      claimType: input.claimType,
      generalProcurementId: input.generalProcurementId,
      generalProcurementRequestKey: input.generalProcurementRequestKey,
      actualPurchaseBatchId: batch.id,
      projectId: input.projectId?.trim() || undefined,
      companyEntityId: input.companyEntityId,
      applicantUserId: input.applicantUserId?.trim() || actorUserId,
      actorUserId
    }, batch, categoryLabel);
    if (this.actualBatches) {
      await this.actualBatches.assertClaimCommitInTransaction(tx, { batchId: batch.id, amountCents });
    }
    return { batch, sourceCategory };
  }

  // Company business positions apply to every active project; project positions
  // and roster membership stay local. Technical administrator alone is not a business position.
  private async selfApplicationProjectIds(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    return (this.visibility ?? new ProjectVisibilityService(this.prisma)).businessProjectIdsInTransaction(tx, userId);
  }

  private async applicantSnapshot(tx: Prisma.TransactionClient, actor: { id: string; name: string; phone: string | null; isActive: boolean }, input: CreateExpenseClaimDto, actorRoles: RoleKey[]) {
    const requestedId = input.applicantUserId?.trim();
    if (!requestedId) {
      if (!actorRoles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有综合部主管可以为无账号人员代办");
      return { userId: null, name: requiredText(input.applicantName, "无账号人员姓名必填"), phone: requiredText(input.applicantPhone, "无账号人员电话必填") };
    }
    const applicant = requestedId === actor.id ? actor : await tx.user.findUnique({ where: { id: requestedId }, select: { id: true, name: true, phone: true, isActive: true } });
    if (!applicant?.isActive) throw new NotFoundException("报销人或借款人不存在或已停用");
    if (applicant.id !== actor.id && !actorRoles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有综合部主管可以为其他系统人员代办");
    return { userId: applicant.id, name: applicant.name, phone: applicant.phone };
  }

  private async factWitnessSnapshot(tx: Prisma.TransactionClient, input: CreateExpenseClaimDto, projectId?: string) {
    if (projectId) return null;
    const witnessId = input.factWitnessUserId?.trim();
    if (!witnessId) {
      if (isPureExpenseReimbursement(input)) return null;
      throw new BadRequestException("非项目报销必须选择事实证明人");
    }
    const witness = await tx.user.findUnique({ where: { id: witnessId }, select: { id: true, name: true, isActive: true } });
    if (!witness?.isActive) throw new NotFoundException("事实证明人不存在或已停用");
    return witness;
  }

  private async freezeApprovalNodes(
    tx: Prisma.TransactionClient,
    claim: { claimType: string; projectId: string | null; factWitnessUserId: string | null; handledByUserId: string },
    parallel: boolean
  ): Promise<ExpenseClaimApprovalNode[]> {
    if (
      claim.claimType !== "reimbursement" &&
      claim.claimType !== "loan" &&
      claim.claimType !== "incidental_expense"
    ) {
      throw new BadRequestException("费用业务类型不正确");
    }
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({
        where: claim.projectId ? { OR: [{ projectId: null }, { projectId: claim.projectId }] } : { projectId: null },
        select: { userId: true, positionId: true, projectId: true }
      }),
      claim.projectId
        ? tx.projectMember.findMany({ where: { projectId: claim.projectId }, select: { userId: true, positionKey: true } })
        : Promise.resolve([])
    ]);
    const positions = assignments.length
      ? await tx.position.findMany({ where: { id: { in: [...new Set(assignments.map((item) => item.positionId))] } }, select: { id: true, key: true } })
      : [];
    const roleByPosition = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const candidatesByRole = new Map<RoleKey, Set<string>>();
    for (const assignment of assignments) {
      const role = roleByPosition.get(assignment.positionId);
      if (role && (assignment.projectId !== null || GLOBAL_BUSINESS_ROLE_KEYS.includes(role)) &&
          (!parallel || (role === "project_manager" ? assignment.projectId === claim.projectId : assignment.projectId === null))) {
        addCandidate(candidatesByRole, role, assignment.userId);
      }
    }
    for (const membership of memberships) {
      if (!parallel || membership.positionKey === "project_manager") {
        addCandidate(candidatesByRole, membership.positionKey as RoleKey, membership.userId);
      }
    }
    const candidateIds = [...new Set([...candidatesByRole.values()].flatMap((ids) => [...ids]))];
    const activeUsers = candidateIds.length
      ? await tx.user.findMany({ where: { id: { in: candidateIds }, isActive: true }, select: { id: true } })
      : [];
    const activeIds = new Set(activeUsers.map((user) => user.id));
    const node = (name: string, roleKeys: RoleKey[], selectedUserId?: string): ExpenseClaimApprovalNode => {
      const candidateUserIdsByRole = Object.fromEntries(roleKeys.map((role) => [role, [...(candidatesByRole.get(role) ?? [])].filter((id) => activeIds.has(id)).sort()])) as Partial<Record<RoleKey, string[]>>;
      const candidateUserIds = [...new Set(Object.values(candidateUserIdsByRole).flat())].sort();
      if (!parallel && !candidateUserIds.length) throw new BadRequestException(`${name}缺少当前有效审批人，请先完成组织配置`);
      return { name, mode: "any", roleKeys, candidateUserIds, candidateUserIdsByRole, ...(selectedUserId ? { selectedUserId } : {}) };
    };
    if (parallel) {
      const nodes = [
        node("综合部主管", [COMPREHENSIVE_ROLE]),
        ...(claim.projectId ? [node("项目经理", ["project_manager"])] : []),
        node("财务主管", ["finance_director"]),
        node("董事长/总经理", FINAL_ROLES)
      ];
      return nodes.map(frozen => ({
        ...frozen,
        protocolVersion: 1,
        executionMode: "parallel",
        candidatePolicy: EXPENSE_CURRENT_ROLE_SCOPE,
        roleScopesByRole: Object.fromEntries(frozen.roleKeys.map(role => [role, role === "project_manager" ? "project" : "global"]))
      }));
    }
    const witnessNode = claim.projectId
      ? node("项目经理", ["project_manager"])
      : claim.factWitnessUserId && activeIds.has(claim.factWitnessUserId)
        ? { name: "事实证明人", mode: "any" as const, roleKeys: ["employee" as RoleKey], candidateUserIds: [claim.factWitnessUserId], candidateUserIdsByRole: { employee: [claim.factWitnessUserId] }, selectedUserId: claim.factWitnessUserId }
        : null;
    if (!witnessNode) throw new BadRequestException("事实证明人不存在或已停用，请重新选择后再提交");
    return [node("综合部主管", [COMPREHENSIVE_ROLE]), witnessNode, node("财务主管", ["finance_director"]), node("董事长/总经理", FINAL_ROLES)];
  }

  private async reserveLoanOffsets(
    tx: Prisma.TransactionClient,
    claim: { id: string; claimType: string; projectId: string | null; applicantUserId: string | null; companyEntityId: string; requestedAmountCents: bigint },
    actorUserId: string
  ) {
    if (claim.claimType !== "reimbursement" || !claim.projectId || !claim.applicantUserId) return { amountCents: 0n };
    const scopeKey = `project:${claim.projectId}`;
    const accounts = await tx.$queryRaw<Array<{ id: string; balanceAmountCents: bigint; reservedOffsetAmountCents: bigint }>>(Prisma.sql`SELECT "id", "balanceAmountCents", "reservedOffsetAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "userId" = ${claim.applicantUserId} AND "scopeKey" = ${scopeKey} FOR UPDATE`);
    const account = accounts[0];
    if (!account) return { amountCents: 0n };
    const entries = await tx.employeeProjectLoanEntry.findMany({ where: { loanAccountId: account.id, entryType: "disbursement" }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true, amountCents: true } });
    const existing = await tx.expenseLoanOffsetReservation.findMany({ where: { loanAccountId: account.id, status: { in: ["reserved", "posted"] } }, select: { loanEntryId: true, amountCents: true } });
    const used = new Map<string, bigint>();
    for (const reservation of existing) {
      if (reservation.loanEntryId) used.set(reservation.loanEntryId, (used.get(reservation.loanEntryId) ?? 0n) + reservation.amountCents);
    }
    let remaining = claim.requestedAmountCents;
    const reservations: Array<{ expenseClaimId: string; loanAccountId: string; loanEntryId: string; amountCents: bigint; status: string; sequenceNo: number }> = [];
    for (const entry of entries) {
      const available = entry.amountCents - (used.get(entry.id) ?? 0n);
      if (available <= 0n || remaining <= 0n) continue;
      const amountCents = available < remaining ? available : remaining;
      reservations.push({ expenseClaimId: claim.id, loanAccountId: account.id, loanEntryId: entry.id, amountCents, status: "reserved", sequenceNo: reservations.length + 1 });
      remaining -= amountCents;
    }
    const amountCents = claim.requestedAmountCents - remaining;
    if (!reservations.length) return { amountCents: 0n };
    const historic = await tx.expenseLoanOffsetReservation.aggregate({
      where: { expenseClaimId: claim.id }, _max: { sequenceNo: true }
    });
    const previousSequence = historic._max.sequenceNo ?? 0;
    await tx.expenseLoanOffsetReservation.createMany({
      data: reservations.map(reservation => ({ ...reservation, sequenceNo: previousSequence + reservation.sequenceNo }))
    });
    await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { reservedOffsetAmountCents: account.reservedOffsetAmountCents + amountCents } });
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.reserve", businessType: "expense_claim", businessId: claim.id, metadata: { loanAccountId: account.id, amountCents: amountCents.toString(), allocationCount: reservations.length } });
    return { amountCents };
  }

  private async releaseLoanOffsetReservations(tx: Prisma.TransactionClient, expenseClaimId: string, actorUserId: string, reason: string) {
    const reservations = await tx.expenseLoanOffsetReservation.findMany({ where: { expenseClaimId, status: "reserved" }, select: { id: true, loanAccountId: true, amountCents: true } });
    if (!reservations.length) return 0n;
    const byAccount = groupReservationAmounts(reservations);
    for (const [loanAccountId, amountCents] of byAccount) {
      const accounts = await tx.$queryRaw<Array<{ id: string; reservedOffsetAmountCents: bigint }>>(Prisma.sql`SELECT "id", "reservedOffsetAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.reservedOffsetAmountCents < amountCents) throw new BadRequestException("借款冲销预留状态异常，暂不能释放");
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { reservedOffsetAmountCents: account.reservedOffsetAmountCents - amountCents } });
    }
    await tx.expenseLoanOffsetReservation.updateMany({ where: { id: { in: reservations.map((item) => item.id) }, status: "reserved" }, data: { status: "released", releasedAt: new Date(), adjustedByUserId: actorUserId, adjustmentReason: reason } });
    const amountCents = reservations.reduce((total, item) => total + item.amountCents, 0n);
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.release", businessType: "expense_claim", businessId: expenseClaimId, metadata: { amountCents: amountCents.toString(), reason } });
    return amountCents;
  }

  private async appendOperatingExpenseClaimApproval(
    tx: Prisma.TransactionClient,
    projectId: string,
    expenseClaimId: string,
    actorUserId: string
  ): Promise<void> {
    await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
      tx,
      {
        projectId,
        sourceType: EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
        sourceBusinessId: expenseClaimId
      },
      actorUserId
    );
  }

  private async appendOperatingExpenseClaimPaymentExecution(
    tx: Prisma.TransactionClient,
    projectId: string,
    paymentExecutionId: string,
    actorUserId: string
  ): Promise<void> {
    await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
      tx,
      {
        projectId,
        sourceType: EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE,
        sourceBusinessId: paymentExecutionId
      },
      actorUserId
    );
  }

  private async appendOperatingEmployeeLoanEntry(
    tx: Prisma.TransactionClient,
    projectId: string,
    loanEntryId: string,
    actorUserId: string
  ): Promise<void> {
    await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
      tx,
      {
        projectId,
        sourceType: EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE,
        sourceBusinessId: loanEntryId
      },
      actorUserId
    );
  }

  private async postLoanOffsetReservations(
    tx: Prisma.TransactionClient,
    claim: { id: string; claimType: string; projectId: string | null; applicantUserId: string | null; loanOffsetAmountCents: bigint },
    actorUserId: string
  ) {
    const reservations = await tx.expenseLoanOffsetReservation.findMany({ where: { expenseClaimId: claim.id, status: "reserved" }, orderBy: { sequenceNo: "asc" }, select: { id: true, loanAccountId: true, amountCents: true } });
    if (!reservations.length) return 0n;
    const byAccount = groupReservationAmounts(reservations);
    for (const [loanAccountId, amountCents] of byAccount) {
      const accounts = await tx.$queryRaw<Array<{ id: string; offsetAmountCents: bigint; reservedOffsetAmountCents: bigint; balanceAmountCents: bigint }>>(Prisma.sql`SELECT "id", "offsetAmountCents", "reservedOffsetAmountCents", "balanceAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.reservedOffsetAmountCents < amountCents || account.balanceAmountCents < amountCents) throw new BadRequestException("借款冲销预留状态异常，暂不能入账");
      const sequences = await tx.$queryRaw<Array<{ nextSequenceNo: bigint }>>(Prisma.sql`SELECT COALESCE(MAX("sequenceNo"), 0) + 1 AS "nextSequenceNo" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id}`);
      const accountReservations = reservations.filter((item) => item.loanAccountId === account.id);
      for (const reservation of accountReservations) {
        const entry = await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo + BigInt(accountReservations.indexOf(reservation)), entryType: "offset", amountCents: reservation.amountCents, balanceDeltaCents: -reservation.amountCents, sourceExpenseClaimId: claim.id, sourceReservationId: reservation.id, occurredAt: new Date(), createdByUserId: actorUserId } });
        if (claim.projectId) {
          await this.appendOperatingEmployeeLoanEntry(
            tx,
            claim.projectId,
            entry.id,
            actorUserId
          );
        }
      }
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { offsetAmountCents: account.offsetAmountCents + amountCents, reservedOffsetAmountCents: account.reservedOffsetAmountCents - amountCents, balanceAmountCents: account.balanceAmountCents - amountCents } });
    }
    await tx.expenseLoanOffsetReservation.updateMany({ where: { id: { in: reservations.map((item) => item.id) }, status: "reserved" }, data: { status: "posted", postedAt: new Date() } });
    const amountCents = reservations.reduce((total, item) => total + item.amountCents, 0n);
    if (amountCents !== claim.loanOffsetAmountCents) throw new BadRequestException("借款冲销预留金额与报销单不一致");
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.post", businessType: "expense_claim", businessId: claim.id, metadata: { amountCents: amountCents.toString() } });
    return amountCents;
  }

  private selfReviewMetadata(
    applicantUserId: string,
    actorUserId: string,
    identity: { representedUserId: string; viaAssignment: boolean },
    input: ReviewExpenseClaimDto
  ) {
    if (applicantUserId !== actorUserId) return { isSelfReview: false as const, metadata: {} };
    if (identity.representedUserId !== actorUserId || identity.viaAssignment) {
      throw new ForbiddenException("申请人不能通过转交或委托审批自己发起的费用申请");
    }
    const reason = input.selfReviewReason?.trim();
    if (!reason) throw new BadRequestException("审批自己发起的费用申请时，请填写自审原因");
    if (!input.confirmationPassword?.trim()) throw new BadRequestException("自审前，请输入当前密码完成二次确认");
    if (!this.auth) throw new ServiceUnavailableException("审批身份确认服务暂不可用，请稍后重试");
    return { isSelfReview: true as const, auth: this.auth, metadata: { selfReview: true, selfReviewReason: reason } };
  }

  private async prepareSelfReviewConfirmation(claimId: string, actorUserId: string, input: ReviewExpenseClaimDto) {
    if (!input.confirmationPassword?.trim()) return;
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType: "expense_claim", businessId: claimId, flowType: "expense_claim.approve", status: "in_progress" },
      orderBy: { createdAt: "desc" },
      select: { id: true, applicantUserId: true, currentNodeIndex: true, frozenNodes: true }
    });
    if (instance?.applicantUserId !== actorUserId) return;
    const claim = await this.prisma.expenseClaim.findUnique({ where: { id: claimId }, select: { status: true, projectId: true, claimType: true } });
    if (claim?.status !== "approval_pending" || claim.claimType === "loan") return;
    const nodeIndex = resolveExpenseReviewNodeIndex(instance, input);
    const nodes = instance.frozenNodes as unknown as ExpenseClaimApprovalNode[];
    const node = nodes[nodeIndex];
    if (!node) return;
    const roleScopes = isParallelApprovalRound(instance.frozenNodes)
      ? await loadExpenseApprovalRoleScopes(this.prisma, actorUserId, claim.projectId)
      : undefined;
    const roles = roleScopes ? [...roleScopes.globalRoleKeys, ...roleScopes.projectRoleKeys]
      : await this.loadRoleKeys(this.prisma, actorUserId, claim.projectId ?? undefined);
    const identity = roleScopes ? resolveExpenseParallelDutyIdentity({ node, actorUserId, actorRoleScopes: roleScopes })
      : resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: roles });
    if (!identity) return;
    const selfReview = this.selfReviewMetadata(instance.applicantUserId, actorUserId, identity, input);
    if (!selfReview.isSelfReview) return;
    const account = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { isActive: true, passwordHash: true }
    });
    await selfReview.auth.confirmPassword(actorUserId, input.confirmationPassword, { user: { findUnique: async () => account } });
    return { instanceId: instance.id, nodeIndex, passwordHash: account?.passwordHash };
  }

  private async loadRoleKeys(tx: Prisma.TransactionClient, userId: string, projectId?: string): Promise<RoleKey[]> {
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({ where: { userId, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] }, select: { positionId: true } }),
      projectId ? tx.projectMember.findMany({ where: { userId, projectId }, select: { positionKey: true } }) : Promise.resolve([])
    ]);
    const positions = assignments.length ? await tx.position.findMany({ where: { id: { in: assignments.map((item) => item.positionId) } }, select: { key: true } }) : [];
    return [...new Set([...positions.map((item) => item.key as RoleKey), ...memberships.map((item) => item.positionKey as RoleKey)])];
  }
}

function resolveExpenseReviewNodeIndex(
  instance: { id: string; frozenNodes: unknown; currentNodeIndex: number },
  input: ReviewExpenseClaimDto
) {
  if (!hasVersionedApprovalNodes(instance.frozenNodes)) {
    if (input.approvalInstanceId !== undefined || input.approvalDutyIndex !== undefined) {
      throw new ConflictException("费用审批轮次已变化，请刷新后重新确认");
    }
    return instance.currentNodeIndex;
  }
  const indexes = activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex);
  if (input.approvalInstanceId !== instance.id || input.approvalDutyIndex === undefined ||
      !indexes.includes(input.approvalDutyIndex)) {
    throw new ConflictException("费用审批职责已办理或已变化，请刷新后重新确认");
  }
  return input.approvalDutyIndex;
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  return value.trim();
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "文字不能为空白");
}

function addCandidate(candidatesByRole: Map<RoleKey, Set<string>>, role: RoleKey, userId: string) {
  const candidates = candidatesByRole.get(role) ?? new Set<string>();
  candidates.add(userId);
  candidatesByRole.set(role, candidates);
}

function groupReservationAmounts(reservations: Array<{ loanAccountId: string; amountCents: bigint }>) {
  const grouped = new Map<string, bigint>();
  for (const reservation of reservations) {
    grouped.set(reservation.loanAccountId, (grouped.get(reservation.loanAccountId) ?? 0n) + reservation.amountCents);
  }
  return grouped;
}

function isReturnedExpenseDraft(claim: {
  claimType: string; projectId: string | null; actualPurchaseBatchId: string | null; generalProcurementId: string | null;
  status: string; submittedAt: Date | null; approvalInstanceId: string | null; approvedAt: Date | null; voidedAt: Date | null; fundedAmountCents: bigint;
}): boolean {
  return supportsExpenseParallelApproval(claim) && claim.status === "draft" && Boolean(claim.submittedAt) &&
    !claim.approvalInstanceId && !claim.approvedAt && !claim.voidedAt && claim.fundedAmountCents === 0n;
}

function positiveCents(value: unknown, message: string) {
  if (typeof value !== "string") throw new BadRequestException(message);
  const cents = parseMoneyCentsInput(value, message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function receiptCount(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new BadRequestException("单据张数必须在 0 到 10000 之间");
  }
  return value;
}

function dateOnly(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new BadRequestException(`${field}格式不正确`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field}格式不正确`);
  return date;
}

type ExpenseLedgerView = "all" | "drafts" | "in_progress" | "pending_funds";

type ExpenseLedgerRow = {
  id: string;
  code: string;
  claimType: string;
  claimTypeLabel: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  projectId: string | null;
  projectName: string;
  companyName: string;
  applicantName: string;
  handledByName: string;
  reason: string;
  payeeName: string;
  requestedAmountCents: string;
  loanOffsetAmountCents: string;
  companyPayableAmountCents: string;
  fundedAmountCents: string;
  updatedAt: string;
};

/** 可跨项目查账的岗位：财务、综合、公司领导与项目经理。 */
const EXPENSE_LEDGER_GLOBAL_ROLES = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "finance_staff",
  "finance_director",
  "comprehensive_director",
  "project_manager"
]);

const EXPENSE_LEDGER_COLUMNS: LedgerExcelColumn<Record<string, unknown>>[] = [
  { header: "报销编号", key: "code", width: 20, required: true },
  { header: "项目或使用单位", key: "projectName", width: 26, required: true },
  { header: "报销单位", key: "companyName", width: 24, required: true },
  { header: "报销人/借款人", key: "applicantName", width: 16, required: true },
  { header: "业务类型", key: "claimTypeLabel", width: 14 },
  { header: "费用类别", key: "categoryLabel", width: 16 },
  { header: "事由", key: "reason", width: 32 },
  { header: "收款对象", key: "payeeName", width: 20 },
  {
    header: "申请金额（元）",
    key: "requestedAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum",
    required: true
  },
  {
    header: "已付款/冲销（元）",
    key: "settledAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum"
  },
  {
    header: "待付金额（元）",
    key: "outstandingAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum"
  },
  { header: "状态", key: "statusLabel", width: 16 },
  { header: "经办人", key: "handledByName", width: 14 },
  { header: "更新时间", key: "updatedAtIso", width: 16, kind: "date", numFmt: LEDGER_DATE_FORMAT }
];

function expenseLedgerView(value: unknown): ExpenseLedgerView {
  return value === "drafts" || value === "in_progress" || value === "pending_funds"
    ? value
    : "all";
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function expenseClaimTypeLabel(value: string): string {
  return value === "loan"
    ? "借款申请"
    : value === "incidental_expense"
      ? "零星费用付款"
      : "费用报销";
}

function expenseClaimStatusLabel(value: string): string {
  return ({
    draft: "草稿",
    approval_pending: "审批中",
    approved_pending_payment: "待公司付款",
    partially_paid: "部分公司付款",
    approved_pending_disbursement: "待放款",
    partially_disbursed: "部分放款",
    disbursed: "已放款",
    offset_completed: "借款冲销完成",
    rejected: "已驳回"
  } as Record<string, string>)[value] ?? "待确认状态";
}

const INCIDENTAL_EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  temporary_service: "非材料临时服务",
  temporary_machinery_shift: "临时机械台班",
  sporadic_labor: "零星用工",
  other_incidental: "其他非材料临时费用"
};

function expenseCategoryLabel(
  claimType: string,
  incidentalExpenseCategory: string | null,
  lineCategory: string | null
): string {
  if (claimType === "incidental_expense") {
    return incidentalExpenseCategory
      ? INCIDENTAL_EXPENSE_CATEGORY_LABELS[incidentalExpenseCategory] ?? "待确认类别"
      : "待确认类别";
  }
  return lineCategory ?? "待确定";
}
