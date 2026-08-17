import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  type DetailActionReadModel,
  type ProjectExpenseApprovalDetailReadModel,
  type RoleKey
} from "@jiangkong/shared-domain";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  type FrozenApprovalNode
} from "../approval/approval-review-identity";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import { detailAction } from "../core-flow/detail-actions";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  mapBigIntMoneyFieldsToApi,
  moneyCentsToApi,
  parseMoneyCentsInput,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import { renderSimplePdf } from "../pdf/simple-pdf";
import type { ConfirmProjectExpenseReceiptDto } from "./dto/confirm-project-expense-receipt.dto";
import type { CreateProjectExpenseRequestDto } from "./dto/create-project-expense-request.dto";
import type { RecordProjectExpenseExecutionDto } from "./dto/record-project-expense-execution.dto";
import type { RecordProjectExpenseFinanceRecordDto } from "./dto/record-project-expense-finance-record.dto";
import type { RecordProjectExpensePurchaseExecutionDto } from "./dto/record-project-expense-purchase-execution.dto";
import type { ReviewProjectExpenseApprovalDto } from "./dto/review-project-expense-approval.dto";
import type { WithdrawProjectExpenseApprovalDto } from "./dto/withdraw-project-expense-approval.dto";

interface ProjectExpenseApprovalNode extends FrozenApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds?: string[];
  candidateUserIdsByRole?: Partial<Record<RoleKey, string[]>>;
  approvedRoleKeys?: RoleKey[];
}

interface ProjectExpenseApprovalCandidateRow {
  userId: string;
  roleKey: RoleKey;
}

type ProjectExpenseLedgerView = "formal_ledger" | "my_drafts" | "returned_for_revision" | "ended";

type ProjectExpenseApprovalLifecycleReadModel = ProjectExpenseApprovalDetailReadModel & {
  lifecycleKind: "formal_record";
  ledgerView: "formal_ledger" | "ended";
  lifecycleUpdatedAt: string | null;
  hasPersistentDraft: false;
  availableActions: DetailActionReadModel[];
  blockedReasons: string[];
  withdrawalContext: ProjectExpenseWithdrawalContext | null;
  reviewApprovalContext: ProjectExpenseReviewApprovalContext | null;
};

export interface ProjectExpenseWithdrawalContext {
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export interface ProjectExpenseReviewApprovalContext {
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

interface ProjectExpenseLedgerQuery {
  view?: ProjectExpenseLedgerView;
  page?: string | number;
  pageSize?: string | number;
}

const PROJECT_EXPENSE_POST_MONEY_FIELDS = [
  "requestedAmountCents",
  "approvedAmountCents",
  "paidAmountCents",
  "amountCents"
] as const;

function projectExpensePostResponseToApi<T>(value: T) {
  return mapBigIntMoneyFieldsToApi(value, PROJECT_EXPENSE_POST_MONEY_FIELDS);
}

interface ExpenseLockRow {
  id: string;
  projectId: string;
  code: string;
  expenseType: string;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  paidAmountCents: bigint;
  applicantUserId: string;
  purchaseExecutedAt: Date | null;
  receiptConfirmedByUserId: string | null;
  receiptConfirmedAt: Date | null;
  receiptConfirmationIdempotencyKey: string | null;
  receiptConfirmationNote: string | null;
  updatedAt: Date;
}

interface ProjectExpenseReceiptFactRow {
  id: string;
  projectId: string;
  receiptConfirmedByUserId: string | null;
  receiptConfirmedAt: Date | null;
  receiptConfirmationIdempotencyKey: string | null;
  receiptConfirmationNote: string | null;
  updatedAt: Date;
}

interface ProjectExpenseExecutionFactRow {
  id: string;
  idempotencyKey: string;
  projectExpenseRequestId: string;
  projectId: string;
  amountCents: bigint;
  paidAt: Date;
  executedByUserId: string;
  voucherFileId: string;
}

interface ProjectExpenseFinanceFactRow {
  id: string;
  idempotencyKey: string | null;
  projectId: string;
  projectExpenseRequestId: string | null;
  paymentRequestId: string | null;
  settlementId: string | null;
  direction: string;
  amountCents: bigint;
  occurredAt: Date;
  createdByUserId: string;
}

interface ApprovalInstanceLockRow {
  id: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: Prisma.JsonValue;
  applicantUserId: string;
  updatedAt: Date;
}

const PROJECT_EXPENSE_APPROVAL_NODES = [
  {
    name: "部门经理或项目经理",
    mode: "any",
    roleKeys: [
      "project_manager",
      "contract_director",
      "budget_director",
      "material_director",
      "engineering_director",
      "comprehensive_director"
    ]
  },
  { name: "综合部", mode: "any", roleKeys: ["comprehensive_director"] },
  { name: "财务部", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
] satisfies ProjectExpenseApprovalNode[];

const REIMBURSEMENT_APPROVAL_NODES = [
  { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
] satisfies ProjectExpenseApprovalNode[];

const PROJECT_EXPENSE_RECEIPT_CONFIRMABLE_STATUSES = new Set([
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "payment_blocked"
]);

const SPOT_PURCHASE_APPROVAL_NODES = [
  { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
] satisfies ProjectExpenseApprovalNode[];

const PROJECT_EXPENSE_READ_ROLES: readonly RoleKey[] = [
  "project_manager",
  "contract_director",
  "budget_director",
  "material_director",
  "engineering_director",
  "comprehensive_director",
  "finance_director",
  "finance_staff",
  "chairman",
  "general_manager"
];

const APPROVAL_PDF_TEMPLATE_KEY = "approval_form";
const FINANCE_PDF_TEMPLATE_KEY = "project_expense_finance_archive";
const EXPENSE_TYPES = [
  "sporadic_payment",
  "loan_reserve",
  "comprehensive_expense",
  "reimbursement",
  "spot_purchase"
] as const;
const EXPENSE_SUBTYPES = [
  "sporadic_material",
  "sporadic_machinery",
  "sporadic_labor",
  "temporary_service",
  "other_sporadic",
  "employee_loan",
  "owner_loan",
  "project_reserve",
  "travel",
  "entertainment",
  "reimbursement",
  "spot_material_purchase",
  "spot_tool_purchase",
  "spot_service_purchase",
  "spot_other_purchase"
] as const;
const PAYMENT_METHODS = ["cash", "wechat", "alipay", "bank_transfer", "other"] as const;
const SPORADIC_PAYMENT_SUBTYPES = [
  "sporadic_material",
  "sporadic_machinery",
  "sporadic_labor",
  "temporary_service",
  "other_sporadic"
] as const;
const LOAN_RESERVE_SUBTYPES = ["employee_loan", "owner_loan", "project_reserve"] as const;
const COMPREHENSIVE_EXPENSE_SUBTYPES = ["travel", "entertainment"] as const;
const REIMBURSEMENT_SUBTYPES = ["reimbursement"] as const;
const SPOT_PURCHASE_SUBTYPES = [
  "spot_material_purchase",
  "spot_tool_purchase",
  "spot_service_purchase",
  "spot_other_purchase"
] as const;

@Injectable()
export class ProjectExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly files?: FileService,
    private readonly projectFunding?: ProjectFundingAvailabilityService
  ) {}

  async list(projectId: string, actorUserId: string, query?: ProjectExpenseLedgerQuery) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) {
      throw new NotFoundException("项目不存在或已停用");
    }

    const roleKeys = await this.loadActorRoleKeys(this.prisma, actorUserId, projectId);
    const canReadAll = roleKeys.some((role) => PROJECT_EXPENSE_READ_ROLES.includes(role));
    const scopedOr: Prisma.ProjectExpenseRequestWhereInput[] = [{ applicantUserId: actorUserId }];
    if (roleKeys.includes("material_staff")) {
      scopedOr.push({ expenseType: "spot_purchase" });
    }

    const rows = await this.prisma.projectExpenseRequest.findMany({
      where: canReadAll ? { projectId } : { projectId, OR: scopedOr },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
      ...(query ? {} : { take: 100 }),
      select: {
        id: true,
        code: true,
        expenseType: true,
        expenseSubtype: true,
        paymentSubject: true,
        reason: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true,
        paymentMethod: true,
        counterpartyName: true,
        attachmentFileId: true,
        purchaseExecutedAt: true,
        receiptConfirmedAt: true,
        status: true,
        applicantUserId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const pdfBusinessIds = rows.length
      ? new Set(
          (
            await this.prisma.pdfDocument.findMany({
              where: {
                businessType: "project_expense_request",
                businessId: { in: rows.map((row) => row.id) },
                templateKey: APPROVAL_PDF_TEMPLATE_KEY
              },
              select: { businessId: true }
            })
          ).map((pdf) => pdf.businessId)
        )
      : new Set<string>();

    const mappedRows = rows.map(({ attachmentFileId, applicantUserId, ...row }) => {
      const ended = ["withdrawn", "rejected", "voided"].includes(row.status);
      const paid = row.paidAmountCents > 0n || row.status === "paid";
      const receiptConfirmed = row.receiptConfirmedAt instanceof Date;
      const availableActions: string[] = [];
      if (row.status === "approval_pending" && applicantUserId === actorUserId) {
        availableActions.push("withdraw");
      }
      if (
        ["approval_pending", "approved_pending_payment"].includes(row.status) &&
        !paid &&
        !receiptConfirmed &&
        canPerform("project_expense.void", roleKeys)
      ) {
        availableActions.push("void");
      }
      return {
        ...row,
        requestedAmountCents: moneyCentsToApi(row.requestedAmountCents),
        approvedAmountCents:
          row.approvedAmountCents === null ? null : moneyCentsToApi(row.approvedAmountCents),
        paidAmountCents: moneyCentsToApi(row.paidAmountCents),
        hasAttachment: Boolean(attachmentFileId),
        hasApprovalPdf: pdfBusinessIds.has(row.id),
        isPurchaseExecuted: Boolean(row.purchaseExecutedAt),
        isReceiptConfirmed: receiptConfirmed,
        purchaseExecutedAt: row.purchaseExecutedAt?.toISOString() ?? null,
        receiptConfirmedAt: row.receiptConfirmedAt?.toISOString() ?? null,
        lifecycleKind: "formal_record" as const,
        ledgerView: ended ? ("ended" as const) : ("formal_ledger" as const),
        hasPersistentDraft: false,
        availableActions,
        blockedReasons: receiptConfirmed
          ? ["已确认收货，不能普通作废"]
          : paid
            ? ["已有实付记录，不能删除或普通作废"]
            : [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
    const summary = {
      total: rows.length,
      approvalPending: rows.filter((row) => row.status === "approval_pending").length,
      approvedPendingPayment: rows.filter((row) =>
        ["approved_pending_payment", "partially_paid"].includes(row.status)
      ).length,
      paid: rows.filter((row) => row.status === "paid").length,
      paymentBlocked: rows.filter((row) => row.status === "payment_blocked").length,
      totalRequestedCents: moneyCentsToApi(
        sumDbMoneyToBigInt(rows.map((row) => row.requestedAmountCents), "项目支出申请合计")
      ),
      totalPaidCents: moneyCentsToApi(
        sumDbMoneyToBigInt(rows.map((row) => row.paidAmountCents), "项目支出实付合计")
      )
    };

    if (!query) {
      return { rows: mappedRows, summary };
    }

    const view = this.projectExpenseLedgerView(query.view);
    const page = this.positiveInteger(query.page, 1);
    const pageSize = Math.min(this.positiveInteger(query.pageSize, 20), 100);
    const byView = {
      formal_ledger: mappedRows.filter((row) => row.ledgerView === "formal_ledger"),
      my_drafts: [],
      returned_for_revision: [],
      ended: mappedRows.filter((row) => row.ledgerView === "ended")
    } satisfies Record<ProjectExpenseLedgerView, typeof mappedRows>;
    const selectedRows = byView[view];
    const offset = (page - 1) * pageSize;
    const formalRows = rows.filter(
      (row) => !["withdrawn", "rejected", "voided"].includes(row.status)
    );

    return {
      rows: selectedRows.slice(offset, offset + pageSize),
      summary,
      view,
      hasPersistentDraft: false,
      localUnsavedAction: "discard_local",
      pagination: {
        page,
        pageSize,
        total: selectedRows.length,
        totalPages: selectedRows.length === 0 ? 0 : Math.ceil(selectedRows.length / pageSize)
      },
      viewCounts: {
        formal_ledger: byView.formal_ledger.length,
        my_drafts: 0,
        returned_for_revision: 0,
        ended: byView.ended.length
      },
      statistics: {
        formalTotal: formalRows.length,
        pendingApproval: formalRows.filter((row) => row.status === "approval_pending").length,
        pendingPayment: formalRows.filter((row) =>
          ["approved_pending_payment", "partially_paid"].includes(row.status)
        ).length,
        paid: formalRows.filter((row) => row.status === "paid").length,
        formalRequestedAmountCents: moneyCentsToApi(
          sumDbMoneyToBigInt(
            formalRows.map((row) => row.requestedAmountCents),
            "项目支出正式台账申请合计"
          )
        ),
        formalPaidAmountCents: moneyCentsToApi(
          sumDbMoneyToBigInt(
            formalRows.map((row) => row.paidAmountCents),
            "项目支出正式台账实付合计"
          )
        )
      }
    };
  }

  async getApprovalDetail(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string
  ): Promise<ProjectExpenseApprovalLifecycleReadModel> {
    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId },
      select: {
        id: true,
        projectId: true,
        code: true,
        expenseType: true,
        expenseSubtype: true,
        paymentSubject: true,
        reason: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true,
        purchaseExecutedAt: true,
        receiptConfirmedByUserId: true,
        receiptConfirmedAt: true,
        receiptConfirmationIdempotencyKey: true,
        receiptConfirmationNote: true,
        applicantUserId: true,
        status: true,
        updatedAt: true
      }
    });
    if (!expense) {
      throw new NotFoundException("项目支出申请不存在");
    }

    const [actorRoleKeys, instances, financeRoleAccess] = await Promise.all([
      this.loadActorRoleKeys(this.prisma, actorUserId, projectId),
      expense.status === "approval_pending"
        ? this.prisma.approvalInstance.findMany({
          where: {
            businessType: "project_expense_request",
            businessId: expense.id,
            flowType: "project_expense.approve",
            status: "in_progress"
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 2,
          select: {
            id: true,
            status: true,
            currentNodeIndex: true,
            frozenNodes: true,
            applicantUserId: true,
            updatedAt: true
          }
        })
        : Promise.resolve([]),
      this.currentProjectExpenseFinanceRoleAccess(
        this.prisma,
        actorUserId,
        projectId
      )
    ]);
    const instance = instances.length === 1 ? instances[0]! : null;
    const nodes = (instance?.frozenNodes ?? []) as unknown as ProjectExpenseApprovalNode[];
    const currentNode = instance ? nodes[instance.currentNodeIndex] ?? null : null;
    const reviewIdentity = currentNode
      ? this.resolveProjectExpenseReviewIdentity(currentNode, actorUserId, actorRoleKeys)
      : null;
    const isExpenseApplicant = expense.applicantUserId === actorUserId;
    const canReadAsExpenseExecutor = canPerform(
      "project_expense.execution",
      actorRoleKeys
    );
    const canExecuteExpense =
      financeRoleAccess.actorActive &&
      financeRoleAccess.canRecordExecution;
    if (
      !isExpenseApplicant &&
      !canPerform("project_expense.approve", actorRoleKeys) &&
      !canReadAsExpenseExecutor &&
      !reviewIdentity
    ) {
      throw new ForbiddenException("无权查看该项目支出审批详情");
    }
    const paidAmountCents = expense.paidAmountCents ?? 0n;
    const financeRecords =
      paidAmountCents > 0n
        ? await this.prisma.financeRecord.findMany({
            where: {
              projectExpenseRequestId: expense.id,
              direction: "outflow"
            },
            select: { amountCents: true }
          })
        : [];
    const financeRecordedAmountCents = sumDbMoneyToBigInt(
      financeRecords.map((record) => record.amountCents),
      "项目支出财务入账金额"
    );
    if (financeRecordedAmountCents > paidAmountCents) {
      throw new ConflictException(
        "项目支出财务入账事实超过实付金额，请联系管理员核对"
      );
    }
    const financeRemainingAmountCents =
      paidAmountCents - financeRecordedAmountCents;
    const usedFinancingUsage =
      expense.status === "approval_pending" && isExpenseApplicant
        ? await this.prisma.projectExpenseFinancingQuotaUsage.findFirst({
            where: {
              projectExpenseRequestId: expense.id,
              status: "used"
            },
            select: { id: true }
          })
        : null;
    const approvedRoleKey = reviewIdentity?.approvedRoleKey ?? null;
    const isApprovalApplicant = instance?.applicantUserId === actorUserId;
    const isLeaderSelfReview =
      isApprovalApplicant &&
      reviewIdentity?.representedUserId === actorUserId &&
      reviewIdentity.viaAssignment !== true &&
      (approvedRoleKey === "chairman" || approvedRoleKey === "general_manager");
    const canReview = expense.status === "approval_pending" && Boolean(currentNode && approvedRoleKey);
    const disabledReason = expense.status !== "approval_pending"
      ? "当前项目支出状态不可审批"
      : instances.length !== 1
        ? "项目支出审批实例异常，请联系管理员处理"
        : !currentNode
        ? "项目支出当前审批节点不存在"
        : !approvedRoleKey
          ? "当前账号不是本审批节点处理人"
          : isApprovalApplicant && !isLeaderSelfReview
            ? "申请人不能审批自己发起的业务"
            : undefined;
    const reviewEnabled = canReview && (!isApprovalApplicant || isLeaderSelfReview);
    const reviewApprovalContext =
      reviewEnabled &&
      instance &&
      expense.updatedAt instanceof Date &&
      instance.updatedAt instanceof Date
        ? {
            expectedExpenseUpdatedAt: expense.updatedAt.toISOString(),
            expectedApprovalInstanceId: instance.id,
            expectedNodeIndex: instance.currentNodeIndex,
            expectedApprovalUpdatedAt: instance.updatedAt.toISOString()
          }
        : null;
    const approvedAmountCents = expense.approvedAmountCents;
    const remainingAmountCents =
      approvedAmountCents !== null && approvedAmountCents > paidAmountCents
        ? approvedAmountCents - paidAmountCents
        : 0n;
    const executionEnabled =
      canExecuteExpense &&
      ["approved_pending_payment", "partially_paid"].includes(expense.status) &&
      approvedAmountCents !== null &&
      remainingAmountCents > 0n &&
      (expense.expenseType !== "spot_purchase" ||
        expense.purchaseExecutedAt instanceof Date) &&
      expense.updatedAt instanceof Date;
    const executionContext = executionEnabled
      ? { expectedExpenseUpdatedAt: expense.updatedAt.toISOString() }
      : null;
    const financeEnabled =
      financeRoleAccess.actorActive &&
      financeRoleAccess.canRecordFinance &&
      ["partially_paid", "paid", "payment_blocked"].includes(
        expense.status
      ) &&
      paidAmountCents > 0n &&
      financeRemainingAmountCents > 0n &&
      expense.updatedAt instanceof Date;
    const financeContext = financeEnabled
      ? { expectedExpenseUpdatedAt: expense.updatedAt.toISOString() }
      : null;
    const receiptEnabled =
      expense.expenseType === "spot_purchase" &&
      isExpenseApplicant &&
      financeRoleAccess.actorActive &&
      financeRoleAccess.canConfirmReceipt &&
      expense.purchaseExecutedAt instanceof Date &&
      !(expense.receiptConfirmedAt instanceof Date) &&
      PROJECT_EXPENSE_RECEIPT_CONFIRMABLE_STATUSES.has(
        expense.status
      ) &&
      expense.updatedAt instanceof Date;
    const receiptContext = receiptEnabled
      ? { expectedExpenseUpdatedAt: expense.updatedAt.toISOString() }
      : null;
    const ended = ["withdrawn", "rejected", "voided"].includes(expense.status);
    const availableActions: DetailActionReadModel[] = [];
    const blockedReasons: string[] = [];
    const withdrawalContext =
      expense.status === "approval_pending" &&
      isExpenseApplicant &&
      instance?.applicantUserId === actorUserId &&
      !usedFinancingUsage &&
      expense.updatedAt instanceof Date &&
      instance.updatedAt instanceof Date
        ? {
            expectedExpenseUpdatedAt:
              expense.updatedAt.toISOString(),
            expectedApprovalInstanceId: instance.id,
            expectedNodeIndex: instance.currentNodeIndex,
            expectedApprovalUpdatedAt:
              instance.updatedAt.toISOString()
          }
        : null;
    if (executionEnabled) {
      availableActions.push(
        detailAction({
          key: "record_execution",
          label: "登记实付",
          kind: "primary",
          roleKeys: actorRoleKeys,
          requiredAction: "project_expense.execution",
          enabled: true
        })
      );
    }
    if (financeEnabled) {
      availableActions.push(
        detailAction({
          key: "record_finance",
          label: "财务入账",
          kind: "primary",
          roleKeys: actorRoleKeys,
          requiredAction: "project_expense.finance_record",
          enabled: true,
          requiresPassword: true,
          skipRoleCheck: true
        })
      );
    }
    if (receiptEnabled) {
      availableActions.push(
        detailAction({
          key: "confirm_receipt",
          label: "历史收货确认",
          kind: "primary",
          roleKeys: actorRoleKeys,
          requiredAction: "project_expense.receipt_confirm",
          enabled: true,
          requiresPassword: true,
          skipRoleCheck: true
        })
      );
    }
    if (expense.status === "approval_pending") {
      availableActions.push(detailAction({
        key: "review_approval",
        label: "审批项目支出",
        kind: "primary",
        roleKeys: actorRoleKeys,
        requiredAction: "project_expense.approve",
        skipRoleCheck: true,
        enabled: reviewApprovalContext !== null,
        disabledReason,
        requiresSelfReviewConfirmation: isLeaderSelfReview
      }));
    }
    if (ended) {
      blockedReasons.push("项目支出申请已结束，只能查看历史记录");
    } else if (expense.receiptConfirmedAt instanceof Date) {
      blockedReasons.push("已确认收货，不能普通作废");
    } else if (paidAmountCents > 0n || ["partially_paid", "paid"].includes(expense.status)) {
      blockedReasons.push("已有实付记录，不能删除或普通作废");
    } else if (expense.status === "approval_pending") {
      if (withdrawalContext) {
        availableActions.push(detailAction({
          key: "withdraw",
          label: "撤回项目支出申请",
          kind: "danger",
          roleKeys: actorRoleKeys,
          skipRoleCheck: true,
          enabled: true
        }));
      } else if (isExpenseApplicant && usedFinancingUsage) {
        blockedReasons.push(
          "已有实付资金占用的项目支出不能撤回"
        );
      }
      if (canPerform("project_expense.void", actorRoleKeys)) {
        availableActions.push(detailAction({
          key: "void",
          label: "作废项目支出申请",
          kind: "danger",
          roleKeys: actorRoleKeys,
          requiredAction: "project_expense.void",
          enabled: true,
          requiresComment: true
        }));
      }
      if (!availableActions.some((action) => action.enabled)) {
        blockedReasons.push("只有申请人可以撤回，或由具备作废权限的岗位结束审批中的项目支出申请");
      }
    } else if (expense.status === "approved_pending_payment") {
      if (canPerform("project_expense.void", actorRoleKeys)) {
        availableActions.push(detailAction({
          key: "void",
          label: "作废项目支出申请",
          kind: "danger",
          roleKeys: actorRoleKeys,
          requiredAction: "project_expense.void",
          enabled: true,
          requiresComment: true
        }));
      } else {
        blockedReasons.push("当前岗位无权作废已批待付的项目支出申请");
      }
    }

    return {
      id: expense.id,
      projectId: expense.projectId,
      code: expense.code,
      title: `${expense.code} · ${expense.paymentSubject}`,
      status: expense.status,
      statusLabel: projectExpenseStatusLabel(expense.status),
      expenseTypeLabel: projectExpenseTypeLabel(expense.expenseType),
      expenseSubtypeLabel: projectExpenseSubtypeLabel(expense.expenseSubtype),
      paymentSubject: expense.paymentSubject,
      reason: expense.reason,
      requestedAmountCents: moneyCentsToApi(expense.requestedAmountCents),
      approvedAmountCents:
        expense.approvedAmountCents === null ? null : moneyCentsToApi(expense.approvedAmountCents),
      paidAmountCents: moneyCentsToApi(paidAmountCents),
      remainingAmountCents: moneyCentsToApi(remainingAmountCents),
      financeRecordedAmountCents: moneyCentsToApi(
        financeRecordedAmountCents
      ),
      financeRemainingAmountCents: moneyCentsToApi(
        financeRemainingAmountCents
      ),
      receiptConfirmedAt:
        expense.receiptConfirmedAt?.toISOString() ?? null,
      receiptConfirmedByUserId:
        expense.receiptConfirmedByUserId ?? null,
      receiptConfirmationIdempotencyKey:
        expense.receiptConfirmationIdempotencyKey ?? null,
      receiptConfirmationNote:
        expense.receiptConfirmationNote ?? null,
      currentNodeName: currentNode?.name ?? null,
      canSetApprovedAmount: Boolean(
        reviewApprovalContext &&
        instance &&
        currentNode &&
        instance.currentNodeIndex === nodes.length - 1
      ),
      reviewAction: detailAction({
        key: "review",
        label: "审批项目支出",
        kind: "primary",
        roleKeys: actorRoleKeys,
        enabled: reviewEnabled,
        disabledReason,
        skipRoleCheck: true,
        requiresSelfReviewConfirmation: isLeaderSelfReview
      }),
      approvalTimeline: await approvalTimelineForBusiness(
        this.prisma,
        "project_expense_request",
        expense.id
      ),
      lifecycleKind: "formal_record",
      ledgerView: ended ? "ended" : "formal_ledger",
      lifecycleUpdatedAt: expense.updatedAt instanceof Date ? expense.updatedAt.toISOString() : null,
      hasPersistentDraft: false,
      availableActions,
      blockedReasons,
      withdrawalContext,
      reviewApprovalContext,
      executionContext,
      financeContext,
      receiptContext
    };
  }

  async getActionCapability(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string
  ) {
    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId },
      select: {
        id: true,
        projectId: true,
        expenseType: true,
        status: true,
        applicantUserId: true,
        attachmentFileId: true,
        purchaseExecutedAt: true,
        receiptConfirmedAt: true,
        paidAmountCents: true,
        voidedAt: true
      }
    });
    if (!expense) throw new NotFoundException("项目支出申请不存在");
    const roleKeys = await this.loadActorRoleKeys(this.prisma, actorUserId, projectId);
    const canReadAll = roleKeys.some((role) => PROJECT_EXPENSE_READ_ROLES.includes(role));
    const canReadGeneral = expense.applicantUserId === actorUserId || canReadAll;
    const canRead =
      canReadGeneral ||
      (expense.expenseType === "spot_purchase" && roleKeys.includes("material_staff"));
    if (!canRead) throw new ForbiddenException("无权查看该项目支出申请");

    const paid = expense.paidAmountCents > 0n || expense.status === "paid";
    const receiptConfirmed = expense.receiptConfirmedAt instanceof Date;
    const availableActions: string[] = [];
    if (
      !expense.voidedAt &&
      ["approval_pending", "approved_pending_payment"].includes(expense.status) &&
      !paid &&
      !receiptConfirmed &&
      canPerform("project_expense.void", roleKeys)
    ) {
      availableActions.push("void");
    }
    if (
      !expense.voidedAt &&
      expense.expenseType === "spot_purchase" &&
      expense.status === "approved_pending_payment" &&
      !(expense.purchaseExecutedAt instanceof Date) &&
      canPerform("project_expense.purchase_execute", roleKeys)
    ) {
      availableActions.push("record_purchase_execution");
    }
    if (!expense.voidedAt && expense.attachmentFileId) {
      availableActions.push("download_attachment");
    }
    if (!expense.voidedAt && canReadGeneral) {
      const pdf = await this.prisma.pdfDocument.findFirst({
        where: {
          businessType: "project_expense_request",
          businessId: expense.id,
          templateKey: APPROVAL_PDF_TEMPLATE_KEY
        },
        select: { id: true }
      });
      if (pdf) availableActions.push("download_approval_pdf");
    }
    return { projectId, expenseRequestId: expense.id, availableActions };
  }

  async createAttachmentDownloadTicket(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    confirmationPassword: string | undefined,
    downloadReason: string | undefined
  ) {
    if (!confirmationPassword?.trim()) {
      throw new BadRequestException("附件下载密码必填");
    }
    if (!downloadReason?.trim()) {
      throw new BadRequestException("附件下载原因必填");
    }
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense attachment download");
    }
    if (!this.files) {
      throw new Error("File service is required to create project expense attachment download ticket");
    }

    const unavailable = "项目支出附件不可下载";
    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId, voidedAt: null },
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        expenseType: true,
        attachmentFileId: true
      }
    });
    if (!expense) {
      throw new BadRequestException(unavailable);
    }
    if (!expense.attachmentFileId) {
      throw new BadRequestException(unavailable);
    }
    const roleKeys = await this.loadActorRoleKeys(
      this.prisma,
      actorUserId,
      expense.projectId
    );
    const canRead =
      expense.applicantUserId === actorUserId ||
      roleKeys.some((role) => PROJECT_EXPENSE_READ_ROLES.includes(role)) ||
      (expense.expenseType === "spot_purchase" && roleKeys.includes("material_staff"));
    if (!canRead) {
      throw new BadRequestException(unavailable);
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);
    return this.files.createDownloadTicket(expense.attachmentFileId, {
      actorUserId,
      downloadReason
    });
  }

  async createApprovalPdfDownloadTicket(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    confirmationPassword: string | undefined,
    downloadReason: string | undefined
  ) {
    if (!confirmationPassword?.trim()) {
      throw new BadRequestException("审批单下载密码必填");
    }
    if (!downloadReason?.trim()) {
      throw new BadRequestException("审批单下载原因必填");
    }
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense approval PDF download");
    }
    if (!this.files) {
      throw new Error("File service is required to create project expense approval PDF download ticket");
    }

    const unavailable = "项目支出审批单不可下载";
    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { projectId, voidedAt: null, OR: [{ id: expenseRequestId }, { code: expenseRequestId }] },
      select: { id: true, projectId: true, applicantUserId: true }
    });
    if (!expense) {
      throw new BadRequestException(unavailable);
    }
    const roleKeys = await this.loadActorRoleKeys(this.prisma, actorUserId, expense.projectId);
    const canRead =
      expense.applicantUserId === actorUserId ||
      roleKeys.some((role) => PROJECT_EXPENSE_READ_ROLES.includes(role));
    if (!canRead) {
      throw new BadRequestException(unavailable);
    }
    const pdf = await this.prisma.pdfDocument.findFirst({
      where: {
        businessType: "project_expense_request",
        businessId: expense.id,
        templateKey: APPROVAL_PDF_TEMPLATE_KEY
      },
      select: { fileId: true }
    });
    if (!pdf) {
      throw new BadRequestException(unavailable);
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);
    return this.files.createDownloadTicket(pdf.fileId, { actorUserId, downloadReason });
  }

  async create(projectId: string, actorUserId: string, input: CreateProjectExpenseRequestDto) {
    const code = requiredTrimmed(input.code, "支出单号必填");
    const expenseType = enumValue(input.expenseType, EXPENSE_TYPES, "项目支出类型无效");
    if (
      expenseType === "comprehensive_expense" ||
      expenseType === "reimbursement" ||
      expenseType === "loan_reserve"
    ) {
      throw new GoneException(
        "旧项目支出入口已停止新建，请使用费用与报销流程"
      );
    }
    const expenseSubtype = enumValue(input.expenseSubtype, EXPENSE_SUBTYPES, "项目支出明细类型无效");
    const paymentMethod = enumValue(input.paymentMethod, PAYMENT_METHODS, "项目支出付款方式无效");
    assertExpenseSubtypeMatchesType(expenseType, expenseSubtype);
    const paymentSubject = requiredTrimmed(input.paymentSubject, "付款主体必填");
    const reason = requiredTrimmed(input.reason, "付款事由必填");
    const requestedAmountCents = positiveMoneyCents(input.requestedAmountCents, "申请金额必须大于零");
    if (expenseType === "sporadic_payment") {
      throw new GoneException(
        "旧零星支出入口已停止新建，请使用零星费用支付流程"
      );
    }
    if (expenseType === "spot_purchase") {
      throw new GoneException(
        "旧零星采购入口已停止新建，请使用零星材料申请流程"
      );
    }
    const attachmentFileId = input.attachmentFileId?.trim() || undefined;

    const request = await this.prisma.$transaction(async (tx) => {
      const [project, attachmentFile] = await Promise.all([
        tx.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } }),
        attachmentFileId
          ? tx.fileObject.findUnique({
              where: { id: attachmentFileId },
              select: { id: true, uploadedByUserId: true }
            })
          : Promise.resolve(null)
      ]);
      if (!project) {
        throw new NotFoundException("项目不存在或已停用");
      }
      if (attachmentFileId && !attachmentFile) {
        throw new NotFoundException("项目支出附件不存在");
      }
      if (attachmentFile && attachmentFile.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("项目支出附件必须由申请人本人上传");
      }
      const frozenNodes = await this.freezeApprovalNodes(
        tx,
        project.id,
        expenseType,
        actorUserId
      );
      const request = await tx.projectExpenseRequest.create({
        data: {
          projectId: project.id,
          code,
          expenseType,
          expenseSubtype,
          paymentSubject,
          reason,
          requestedAmountCents,
          approvedAmountCents: null,
          paidAmountCents: 0n,
          paymentMethod,
          counterpartyName: trimmedOrNull(input.counterpartyName),
          counterpartyAccountName: trimmedOrNull(input.counterpartyAccountName),
          counterpartyBankName: trimmedOrNull(input.counterpartyBankName),
          counterpartyBankAccount: trimmedOrNull(input.counterpartyBankAccount),
          handlerUserId: input.handlerUserId?.trim() || actorUserId,
          applicantUserId: actorUserId,
          attachmentFileId,
          status: "approval_pending"
        }
      });

      await tx.approvalInstance.create({
        data: {
          flowType: "project_expense.approve",
          businessType: "project_expense_request",
          businessId: request.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.submit",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: {
          projectId: project.id,
          code,
          expenseType,
          expenseSubtype,
          requestedAmountCents: moneyCentsToApi(requestedAmountCents)
        }
      });

      return request;
    });

    return projectExpensePostResponseToApi(request);
  }

  async reviewApproval(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: ReviewProjectExpenseApprovalDto
  ) {
    if (input.decision !== "approve" && input.decision !== "reject") {
      throw new BadRequestException("项目支出审批动作无效");
    }
    if (input.decision === "reject" && !input.comment?.trim()) {
      throw new BadRequestException("驳回项目支出时必须填写审批意见");
    }
    const expectedExpenseUpdatedAt = new Date(input.expectedExpenseUpdatedAt);
    const expectedApprovalUpdatedAt = new Date(input.expectedApprovalUpdatedAt);
    const expectedApprovalInstanceId = input.expectedApprovalInstanceId?.trim();
    if (Number.isNaN(expectedExpenseUpdatedAt.getTime())) {
      throw new BadRequestException("预期项目支出版本格式不正确");
    }
    if (Number.isNaN(expectedApprovalUpdatedAt.getTime())) {
      throw new BadRequestException("预期审批版本格式不正确");
    }
    if (!expectedApprovalInstanceId) {
      throw new BadRequestException("预期审批实例不能空白");
    }
    if (!Number.isInteger(input.expectedNodeIndex) || input.expectedNodeIndex < 0) {
      throw new BadRequestException("预期审批节点格式不正确");
    }

    const reviewed = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequestById(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.status !== "approval_pending") {
        throw new ConflictException("当前项目支出已离开审批中，请刷新后重试");
      }

      const instances = await this.lockApprovalInstances(tx, request.id);
      if (instances.length === 0) {
        throw new ConflictException("项目支出审批实例不存在，请刷新后重试");
      }
      if (instances.length !== 1) {
        throw new ConflictException("项目支出审批实例异常，请联系管理员处理");
      }
      const instance = instances[0]!;
      const nodes = instance.frozenNodes as unknown as ProjectExpenseApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];
      if (!currentNode) {
        throw new BadRequestException("项目支出当前审批节点不存在");
      }
      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, projectId);
      const identityNode = input.decision === "approve"
        ? currentNode
        : { ...currentNode, approvedRoleKeys: [] };
      const identity = this.resolveProjectExpenseReviewIdentity(
        identityNode,
        actorUserId,
        actorRoleKeys
      );
      if (!identity) {
        throw new ForbiddenException(`当前账号不能处理“${currentNode.name}”项目支出审批节点`);
      }
      const approvedRoleKey = identity.approvedRoleKey;

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys:
          identity.representedUserId === actorUserId && !identity.viaAssignment
            ? Array.from(new Set([...actorRoleKeys, approvedRoleKey]))
            : actorRoleKeys,
        approvedRoleKey,
        representedUserId: identity.representedUserId,
        viaAssignment: identity.viaAssignment,
        selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: this.auth
          ? (password) => this.auth!.confirmPassword(actorUserId, password)
          : undefined
      });

      if (
        !(request.updatedAt instanceof Date) ||
        request.updatedAt.getTime() !== expectedExpenseUpdatedAt.getTime() ||
        expectedApprovalInstanceId !== instance.id ||
        input.expectedNodeIndex !== instance.currentNodeIndex ||
        !(instance.updatedAt instanceof Date) ||
        instance.updatedAt.getTime() !== expectedApprovalUpdatedAt.getTime()
      ) {
        throw new ConflictException("项目支出审批坐标已变化，请刷新页面后重试");
      }

      const auditCoordinates = {
        expectedExpenseUpdatedAt: expectedExpenseUpdatedAt.toISOString(),
        expectedApprovalInstanceId,
        expectedNodeIndex: input.expectedNodeIndex,
        expectedApprovalUpdatedAt: expectedApprovalUpdatedAt.toISOString()
      };

      if (input.decision === "reject") {
        const rejected = await tx.projectExpenseRequest.update({
          where: { id: request.id },
          data: { status: "rejected", approvedAmountCents: null }
        });
        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "rejected" }
        });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });
        await this.releaseFinancingQuotaUsage(
          tx,
          request.id,
          actorUserId,
          "project_expense.cash_pool.release.reject"
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "project_expense.approval.reject",
          businessType: "project_expense_request",
          businessId: request.id,
          metadata: {
            projectId,
            code: request.code,
            fromStatus: request.status,
            toStatus: "rejected",
            fromNodeIndex: instance.currentNodeIndex,
            toNodeIndex: null,
            nodeName: currentNode.name,
            approvedRoleKey,
            ...auditCoordinates,
            ...selfReview.metadata
          }
        });
        return rejected;
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: isGovernedFrozenApprovalNode(currentNode)
      });

      const approvedAmountCents = input.approvedAmountCents === undefined
        ? request.requestedAmountCents
        : positiveMoneyCents(input.approvedAmountCents, "批准金额必须大于零");
      if (approvedAmountCents > request.requestedAmountCents) {
        throw new BadRequestException("批准金额不能超过申请金额");
      }

      const nextNodes = [...nodes];
      const nextNode = { ...currentNode };
      const approvedRoleKeys = new Set(nextNode.approvedRoleKeys ?? []);
      approvedRoleKeys.add(approvedRoleKey);
      nextNode.approvedRoleKeys = [...approvedRoleKeys];
      nextNodes[instance.currentNodeIndex] = nextNode;
      const nextNodeIndex = instance.currentNodeIndex + 1;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      if (!flowCompleted && input.approvedAmountCents !== undefined) {
        throw new BadRequestException("批准金额只能在最终审批节点填写");
      }
      if (
        flowCompleted &&
        approvedAmountCents <
          dbMoneyToBigInt(request.paidAmountCents, "项目支出已实付金额")
      ) {
        throw new BadRequestException("批准金额不能低于已实付金额");
      }

      const updated = await tx.projectExpenseRequest.update({
        where: { id: request.id },
        data: flowCompleted
          ? { status: "approved_pending_payment", approvedAmountCents }
          : { status: "approval_pending" }
      });
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: nextNodeIndex,
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          status: flowCompleted ? "approved" : "in_progress"
        }
      });
      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: input.comment?.trim() || undefined,
          approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(isGovernedFrozenApprovalNode(currentNode)
            ? {
                signatureFileIdSnapshot: signature.fileId,
                signatureSha256Snapshot: signature.sha256,
                signatureVersionIdSnapshot: signature.versionId
              }
            : {}),
          ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
        }
      });
      if (flowCompleted) {
        await this.shrinkFinancingQuotaUsageToApprovedAmount(
          tx,
          request,
          approvedAmountCents,
          actorUserId
        );
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.approval.approve",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: {
          projectId,
          code: request.code,
          fromStatus: request.status,
          toStatus: flowCompleted ? "approved_pending_payment" : "approval_pending",
          fromNodeIndex: instance.currentNodeIndex,
          toNodeIndex: nextNodeIndex,
          nodeName: currentNode.name,
          approvedRoleKey,
          flowCompleted,
          approvedAmountCents: flowCompleted ? moneyCentsToApi(approvedAmountCents) : undefined,
          ...auditCoordinates,
          ...selfReview.metadata
        }
      });
      return updated;
    });

    if (reviewed.status === "approved_pending_payment" && this.files) {
      await this.ensureApprovalPdfArchive(reviewed.id, actorUserId).catch(() => undefined);
    }
    return reviewed;
  }

  async withdrawApproval(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: WithdrawProjectExpenseApprovalDto
  ) {
    const expectedExpenseUpdatedAt = new Date(
      input.expectedExpenseUpdatedAt
    );
    const expectedApprovalUpdatedAt = new Date(
      input.expectedApprovalUpdatedAt
    );
    if (
      Number.isNaN(expectedExpenseUpdatedAt.getTime()) ||
      Number.isNaN(expectedApprovalUpdatedAt.getTime()) ||
      !Number.isInteger(input.expectedNodeIndex) ||
      input.expectedNodeIndex < 0 ||
      !input.expectedApprovalInstanceId?.trim()
    ) {
      throw new BadRequestException(
        "项目支出撤回坐标格式不正确"
      );
    }
    const expectedApprovalInstanceId =
      input.expectedApprovalInstanceId.trim();
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequestById(
        tx,
        projectId,
        expenseRequestId
      );
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.applicantUserId !== actorUserId) {
        throw new BadRequestException(
          "只有项目支出申请人可以撤回"
        );
      }
      if (request.status !== "approval_pending") {
        throw new BadRequestException("当前项目支出状态不可撤回");
      }
      if (request.paidAmountCents > 0n) {
        throw new BadRequestException(
          "已有实付的项目支出不能撤回"
        );
      }
      const instances = await this.lockApprovalInstances(
        tx,
        request.id
      );
      if (instances.length !== 1) {
        throw new ConflictException(
          "项目支出审批实例已变化，请刷新后重试"
        );
      }
      const instance = instances[0]!;
      if (instance.applicantUserId !== actorUserId) {
        throw new ConflictException(
          "项目支出申请人与审批实例不一致，请刷新后重试"
        );
      }
      if (
        request.updatedAt.getTime() !==
          expectedExpenseUpdatedAt.getTime() ||
        instance.id !== expectedApprovalInstanceId ||
        instance.currentNodeIndex !== input.expectedNodeIndex ||
        instance.updatedAt.getTime() !==
          expectedApprovalUpdatedAt.getTime()
      ) {
        throw new ConflictException(
          "项目支出或审批坐标已变化，请刷新后重试"
        );
      }
      const financingUsage = await this.financingUsageTotals(
        tx,
        request.id
      );
      if (financingUsage.used > 0n) {
        throw new BadRequestException(
          "已有实付资金占用的项目支出不能撤回"
        );
      }
      const updated = await tx.projectExpenseRequest.update({
        where: { id: request.id },
        data: { status: "withdrawn" }
      });
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: "withdrawn" }
      });
      await tx.approvalActionLog.create({
        data: { approvalInstanceId: instance.id, action: "withdraw", actorUserId }
      });
      await this.releaseFinancingQuotaUsage(
        tx,
        request.id,
        actorUserId,
        "project_expense.cash_pool.release.withdraw"
      );
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.approval.withdraw",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: {
          projectId,
          expectedExpenseUpdatedAt:
            expectedExpenseUpdatedAt.toISOString(),
          expectedApprovalInstanceId,
          expectedNodeIndex: input.expectedNodeIndex,
          expectedApprovalUpdatedAt:
            expectedApprovalUpdatedAt.toISOString()
        }
      });
      return updated;
    });
  }

  async voidRequest(projectId: string, expenseRequestId: string, actorUserId: string, reason: string) {
    const voidReason = requiredTrimmed(reason, "作废原因必填");
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.receiptConfirmedAt) {
        throw new BadRequestException("已确认收货的项目支出不能普通作废");
      }
      if (request.paidAmountCents > 0) {
        throw new BadRequestException("已有实付的项目支出不能作废");
      }
      if (!["approval_pending", "approved_pending_payment"].includes(request.status)) {
        throw new BadRequestException("当前项目支出状态不可作废");
      }
      const updated = await tx.projectExpenseRequest.update({
        where: { id: request.id },
        data: { status: "voided", voidedAt: new Date(), voidedByUserId: actorUserId, voidReason }
      });
      const instance = await this.lockApprovalInstance(tx, request.id);
      if (instance) {
        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "voided" }
        });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "void",
            actorUserId,
            comment: voidReason
          }
        });
      }
      await this.releaseFinancingQuotaUsage(
        tx,
        request.id,
        actorUserId,
        "project_expense.cash_pool.release.void"
      );
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.void",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: { projectId, voidReason }
      });
      return updated;
    });
  }

  async recordExecution(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: RecordProjectExpenseExecutionDto
  ) {
    if (!this.files || !this.projectFunding) {
      throw new Error(
        "项目支出实付登记依赖服务暂不可用，请稍后重试或联系管理员"
      );
    }
    const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于零");
    const idempotencyKey = input.idempotencyKey?.trim().toLowerCase();
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        idempotencyKey
      )
    ) {
      throw new BadRequestException("项目支出实付幂等键必须是 UUID");
    }
    const expectedExpenseUpdatedAt = new Date(input.expectedExpenseUpdatedAt);
    if (Number.isNaN(expectedExpenseUpdatedAt.getTime())) {
      throw new BadRequestException("预期项目支出版本格式不正确");
    }
    const voucherFileId = requiredTrimmed(input.voucherFileId, "实付凭证必填");
    const paidAt = parseDate(input.paidAt, "实付日期无效");
    if (paidAt.getTime() > Date.now()) {
      throw new BadRequestException("项目支出实付日期不能晚于当前时间");
    }
    const confirmationPassword = requiredTrimmed(input.confirmationPassword, "实付登记需要当前登录密码确认");
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense execution");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);
    const fundingScope = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId },
      select: { id: true, projectId: true }
    });
    if (!fundingScope) {
      throw new NotFoundException("项目支出申请不存在");
    }
    const files = this.files;
    const projectFunding = this.projectFunding;

    try {
      const execution = await this.prisma.$transaction(
        async (tx) => {
          await projectFunding.lockFundingContext(tx, fundingScope.projectId);
          const request = await this.lockExpenseRequestById(
            tx,
            projectId,
            expenseRequestId
          );
          if (!request) {
            throw new NotFoundException("项目支出申请不存在");
          }
          if (
            fundingScope.id !== request.id ||
            fundingScope.projectId !== request.projectId
          ) {
            throw new ConflictException(
              "项目支出的项目资金范围已变化，请刷新后重试"
            );
          }
          await this.assertCurrentProjectExpenseFinanceStaff(
            tx,
            actorUserId,
            request.projectId
          );

          const executionClient = tx.projectExpenseExecution as unknown as {
            findUnique(input: {
              where: { idempotencyKey: string };
            }): Promise<ProjectExpenseExecutionFactRow | null>;
            create(input: {
              data: Record<string, unknown>;
            }): Promise<ProjectExpenseExecutionFactRow>;
          };
          const existingExecution = await executionClient.findUnique({
            where: { idempotencyKey }
          });
          if (existingExecution) {
            this.assertSameProjectExpenseExecutionFacts(existingExecution, {
              idempotencyKey,
              projectExpenseRequestId: request.id,
              projectId: request.projectId,
              amountCents,
              paidAt,
              actorUserId,
              voucherFileId
            });
            await projectFunding.allocateExecution(tx, {
              projectId: request.projectId,
              executionType: "project_expense_execution",
              executionId: existingExecution.id,
              businessType: "project_expense_request",
              businessId: request.id,
              amountCents,
              occurredAt: paidAt,
              actorUserId
            });
            return existingExecution;
          }

          if (
            request.updatedAt.getTime() !==
            expectedExpenseUpdatedAt.getTime()
          ) {
            throw new ConflictException(
              "项目支出申请已变化，请刷新后重试"
            );
          }
          if (
            !["approved_pending_payment", "partially_paid"].includes(
              request.status
            )
          ) {
            throw new BadRequestException("当前项目支出状态不可实付");
          }
          if (
            request.expenseType === "spot_purchase" &&
            !request.purchaseExecutedAt
          ) {
            throw new BadRequestException("零星采购执行后才能登记实付");
          }
          const approvedAmountCents = request.approvedAmountCents;
          if (approvedAmountCents === null) {
            throw new ConflictException(
              "项目支出缺少批准金额，不能登记实付"
            );
          }
          const remaining = approvedAmountCents - request.paidAmountCents;
          if (remaining <= 0n || amountCents > remaining) {
            throw new BadRequestException(
              `实付金额超过剩余批准金额: ${remaining > 0n ? remaining : 0n}`
            );
          }

          // FileObject 的共享 advisory/row lock 固定放在业务和资金锁之后，
          // 与其他付款写路径保持同一顺序，避免交叉死锁。
          const lockedVoucher = await files.assertFileHasNoBusinessBinding(
            tx,
            voucherFileId
          );
          if (lockedVoucher.uploadedByUserId !== actorUserId) {
            throw new ForbiddenException(
              "项目支出实付凭证必须由当前登记人上传"
            );
          }

          const newPaidAmountCents = request.paidAmountCents + amountCents;
          const status =
            newPaidAmountCents >= approvedAmountCents
              ? "paid"
              : "partially_paid";
          const created = await executionClient.create({
            data: {
              idempotencyKey,
              projectExpenseRequestId: request.id,
              projectId: request.projectId,
              amountCents,
              paidAt,
              executedByUserId: actorUserId,
              voucherFileId
            }
          });
          const fundingAllocation = await projectFunding.allocateExecution(tx, {
            projectId: request.projectId,
            executionType: "project_expense_execution",
            executionId: created.id,
            businessType: "project_expense_request",
            businessId: request.id,
            amountCents,
            occurredAt: paidAt,
            actorUserId
          });
          await tx.projectExpenseRequest.update({
            where: { id: request.id },
            data: { paidAmountCents: newPaidAmountCents, status }
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "project_expense.execution.record",
            businessType: "project_expense_request",
            businessId: request.id,
            metadata: {
              code: request.code,
              projectId: request.projectId,
              executionId: created.id,
              amountCents: moneyCentsToApi(amountCents),
              paidAt: paidAt.toISOString(),
              voucherFileId,
              idempotencyKey,
              funding: {
                kind: fundingAllocation.kind,
                projectCashAmountCents: moneyCentsToApi(
                  fundingAllocation.projectCashAmountCents
                ),
                financingQuotaAmountCents: moneyCentsToApi(
                  fundingAllocation.financingQuotaAmountCents
                ),
                allocations: fundingAllocation.allocations.map(
                  (allocation) => ({
                    sourceType: allocation.sourceType,
                    sourceId: allocation.sourceId,
                    amountCents: moneyCentsToApi(allocation.amountCents)
                  })
                )
              },
              fromStatus: request.status,
              toStatus: status
            }
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return projectExpensePostResponseToApi(execution);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = projectExpensePrismaErrorCode(error);
      const serializationConflict =
        code === "P2034" || projectExpenseRawSerializationConflict(error);
      if (code === "P2002" || serializationConflict) {
        const concurrentExecution =
          await this.resolveConcurrentProjectExpenseExecution({
            idempotencyKey,
            projectExpenseRequestId: fundingScope.id,
            projectId: fundingScope.projectId,
            amountCents,
            paidAt,
            actorUserId,
            voucherFileId
          });
        if (concurrentExecution) {
          return projectExpensePostResponseToApi(concurrentExecution);
        }
        throw new ConflictException(
          serializationConflict
            ? "项目支出实付并发冲突，请刷新后重试"
            : "项目支出实付唯一事实已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }

  private projectExpenseExecutionFactsMatch(
    existing: ProjectExpenseExecutionFactRow,
    expected: {
      idempotencyKey: string;
      projectExpenseRequestId: string;
      projectId: string;
      amountCents: bigint;
      paidAt: Date;
      actorUserId: string;
      voucherFileId: string;
    }
  ): boolean {
    return (
      existing.idempotencyKey === expected.idempotencyKey &&
      existing.projectExpenseRequestId ===
        expected.projectExpenseRequestId &&
      existing.projectId === expected.projectId &&
      existing.amountCents === expected.amountCents &&
      existing.paidAt.getTime() === expected.paidAt.getTime() &&
      existing.executedByUserId === expected.actorUserId &&
      existing.voucherFileId === expected.voucherFileId
    );
  }

  private assertSameProjectExpenseExecutionFacts(
    existing: ProjectExpenseExecutionFactRow,
    expected: Parameters<
      ProjectExpenseService["projectExpenseExecutionFactsMatch"]
    >[1]
  ): void {
    if (!this.projectExpenseExecutionFactsMatch(existing, expected)) {
      throw new ConflictException(
        "该项目支出实付幂等键已绑定不同的持久事实"
      );
    }
  }

  private async resolveConcurrentProjectExpenseExecution(input: {
    idempotencyKey: string;
    projectExpenseRequestId: string;
    projectId: string;
    amountCents: bigint;
    paidAt: Date;
    actorUserId: string;
    voucherFileId: string;
  }): Promise<ProjectExpenseExecutionFactRow | null> {
    const executionClient = this.prisma.projectExpenseExecution as unknown as {
      findUnique(args: {
        where: { idempotencyKey: string };
      }): Promise<ProjectExpenseExecutionFactRow | null>;
    };
    const existing = await executionClient.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (!existing || !this.projectExpenseExecutionFactsMatch(existing, input)) {
      return null;
    }
    return existing;
  }

  async recordPurchaseExecution(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: RecordProjectExpensePurchaseExecutionDto
  ) {
    const executedAt = parseDate(input.executedAt, "采购执行日期无效");
    if (executedAt.getTime() > Date.now()) {
      throw new BadRequestException("采购执行日期不能晚于当前时间");
    }
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "采购执行需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense purchase execution");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.expenseType !== "spot_purchase") {
        throw new BadRequestException("只有零星采购申请可以登记采购执行");
      }
      if (request.status !== "approved_pending_payment") {
        throw new BadRequestException("零星采购审批通过后才能登记采购执行");
      }
      if (request.purchaseExecutedAt) {
        throw new BadRequestException("零星采购已登记采购执行");
      }
      const updated = await tx.projectExpenseRequest.update({
        where: { id: request.id },
        data: {
          purchaseExecutedByUserId: actorUserId,
          purchaseExecutedAt: executedAt,
          purchaseExecutionNote: trimmedOrNull(input.note)
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.purchase.execute",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: { projectId, executedAt: executedAt.toISOString() }
      });
      return updated;
    });
  }

  async recordFinance(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: RecordProjectExpenseFinanceRecordDto
  ) {
    const amountCents = positiveMoneyCents(
      input.amountCents,
      "财务记录金额必须大于零"
    );
    const idempotencyKey = input.idempotencyKey?.trim().toLowerCase();
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        idempotencyKey
      )
    ) {
      throw new BadRequestException(
        "项目支出财务入账幂等键必须是 UUID"
      );
    }
    const expectedExpenseUpdatedAt = new Date(
      input.expectedExpenseUpdatedAt
    );
    if (Number.isNaN(expectedExpenseUpdatedAt.getTime())) {
      throw new BadRequestException(
        "预期项目支出版本格式不正确"
      );
    }
    const occurredAt = parseDate(input.occurredAt, "财务记录日期无效");
    if (occurredAt.getTime() > Date.now()) {
      throw new BadRequestException(
        "项目支出财务入账日期不能晚于当前时间"
      );
    }
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "财务入账需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error(
        "项目支出财务入账确认服务暂不可用，请稍后重试或联系管理员"
      );
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    const scope = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId },
      select: { id: true, projectId: true }
    });
    if (!scope) {
      throw new NotFoundException("项目支出申请不存在");
    }

    let result: {
      record: ProjectExpenseFinanceFactRow;
      expenseRequestId: string;
      financeRecordedAmountCents: bigint;
      paidAmountCents: bigint;
      requestStatus: string;
    };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const request = await this.lockExpenseRequestById(
            tx,
            projectId,
            expenseRequestId
          );
          if (!request) {
            throw new NotFoundException("项目支出申请不存在");
          }
          if (
            request.id !== scope.id ||
            request.projectId !== scope.projectId
          ) {
            throw new ConflictException(
              "项目支出财务入账范围已变化，请刷新后重试"
            );
          }
          await this.assertCurrentProjectExpenseFinanceRecorder(
            tx,
            actorUserId,
            request.projectId
          );

          const financeClient = tx.financeRecord as unknown as {
            findUnique(input: {
              where: { idempotencyKey: string };
            }): Promise<ProjectExpenseFinanceFactRow | null>;
            findMany(input: {
              where: {
                projectExpenseRequestId: string;
                direction: string;
              };
              select: { amountCents: true };
            }): Promise<Array<{ amountCents: bigint }>>;
            create(input: {
              data: Record<string, unknown>;
            }): Promise<ProjectExpenseFinanceFactRow>;
          };
          const existing = await financeClient.findUnique({
            where: { idempotencyKey }
          });
          if (existing) {
            this.assertSameProjectExpenseFinanceFacts(existing, {
              idempotencyKey,
              projectExpenseRequestId: request.id,
              projectId: request.projectId,
              amountCents,
              occurredAt,
              actorUserId
            });
            const existingRecords = await financeClient.findMany({
              where: {
                projectExpenseRequestId: request.id,
                direction: "outflow"
              },
              select: { amountCents: true }
            });
            return {
              record: existing,
              expenseRequestId: request.id,
              financeRecordedAmountCents: sumDbMoneyToBigInt(
                existingRecords.map((record) => record.amountCents),
                "财务入账金额"
              ),
              paidAmountCents: request.paidAmountCents,
              requestStatus: request.status
            };
          }

          if (
            request.updatedAt.getTime() !==
            expectedExpenseUpdatedAt.getTime()
          ) {
            throw new ConflictException(
              "项目支出申请已变化，请刷新后重试"
            );
          }
          if (
            !["partially_paid", "paid", "payment_blocked"].includes(
              request.status
            ) ||
            request.paidAmountCents <= 0n
          ) {
            throw new BadRequestException(
              "项目支出实付后才能登记财务记录"
            );
          }
          const existingRecords = await financeClient.findMany({
            where: {
              projectExpenseRequestId: request.id,
              direction: "outflow"
            },
            select: { amountCents: true }
          });
          const recordedCents = sumDbMoneyToBigInt(
            existingRecords.map((record) => record.amountCents),
            "财务入账金额"
          );
          const remaining = request.paidAmountCents - recordedCents;
          if (amountCents > remaining || remaining <= 0n) {
            throw new BadRequestException(
              `财务记录金额超过未入账实付金额: ${
                remaining > 0n ? remaining : 0n
              }`
            );
          }
          const record = await financeClient.create({
            data: {
              idempotencyKey,
              projectId: request.projectId,
              projectExpenseRequestId: request.id,
              direction: "outflow",
              amountCents,
              occurredAt,
              createdByUserId: actorUserId
            }
          });
          await tx.projectExpenseRequest.update({
            where: { id: request.id },
            data: { updatedAt: new Date() }
          });
          const financeRecordedAmountCents =
            recordedCents + amountCents;
          await this.audit.record(tx, {
            actorUserId,
            action: "project_expense.finance.record",
            businessType: "project_expense_request",
            businessId: request.id,
            metadata: {
              code: request.code,
              projectId: request.projectId,
              financeRecordId: record.id,
              idempotencyKey,
              amountCents: moneyCentsToApi(amountCents),
              occurredAt: occurredAt.toISOString(),
              financeRecordedAmountCentsBefore:
                moneyCentsToApi(recordedCents),
              financeRecordedAmountCentsAfter:
                moneyCentsToApi(financeRecordedAmountCents),
              paidAmountCents: moneyCentsToApi(
                request.paidAmountCents
              )
            }
          });
          return {
            record,
            expenseRequestId: request.id,
            financeRecordedAmountCents,
            paidAmountCents: request.paidAmountCents,
            requestStatus: request.status
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = projectExpensePrismaErrorCode(error);
      const serializationConflict =
        code === "P2034" ||
        projectExpenseRawSerializationConflict(error);
      if (code === "P2002" || serializationConflict) {
        const concurrentRecord =
          await this.resolveConcurrentProjectExpenseFinanceRecord({
            idempotencyKey,
            projectExpenseRequestId: scope.id,
            projectId: scope.projectId,
            amountCents,
            occurredAt,
            actorUserId
          });
        if (concurrentRecord) {
          const coverage =
            await this.projectExpenseFinanceCoverage(scope.id);
          result = {
            record: concurrentRecord,
            expenseRequestId: scope.id,
            ...coverage
          };
        } else {
          throw new ConflictException(
            serializationConflict
              ? "项目支出财务入账并发冲突，请刷新后重试"
              : "项目支出财务入账唯一事实已变化，请刷新后重试"
          );
        }
      } else {
        throw error;
      }
    }

    if (
      result.requestStatus === "paid" &&
      result.financeRecordedAmountCents >=
      result.paidAmountCents
    ) {
      try {
        await this.ensureFinancePdfArchive(
          result.expenseRequestId,
          actorUserId
        );
      } catch {
        throw new ServiceUnavailableException(
          "财务入账已保存，但财务归档生成未完成；请使用同一操作直接重试"
        );
      }
    }
    return projectExpensePostResponseToApi(result.record);
  }

  private projectExpenseFinanceFactsMatch(
    existing: ProjectExpenseFinanceFactRow,
    expected: {
      idempotencyKey: string;
      projectExpenseRequestId: string;
      projectId: string;
      amountCents: bigint;
      occurredAt: Date;
      actorUserId: string;
    }
  ): boolean {
    return (
      existing.idempotencyKey === expected.idempotencyKey &&
      existing.projectExpenseRequestId ===
        expected.projectExpenseRequestId &&
      existing.projectId === expected.projectId &&
      existing.paymentRequestId === null &&
      existing.settlementId === null &&
      existing.direction === "outflow" &&
      existing.amountCents === expected.amountCents &&
      existing.occurredAt.getTime() ===
        expected.occurredAt.getTime() &&
      existing.createdByUserId === expected.actorUserId
    );
  }

  private assertSameProjectExpenseFinanceFacts(
    existing: ProjectExpenseFinanceFactRow,
    expected: Parameters<
      ProjectExpenseService["projectExpenseFinanceFactsMatch"]
    >[1]
  ): void {
    if (!this.projectExpenseFinanceFactsMatch(existing, expected)) {
      throw new ConflictException(
        "该项目支出财务入账幂等键已绑定不同的持久事实"
      );
    }
  }

  private async resolveConcurrentProjectExpenseFinanceRecord(
    input: Parameters<
      ProjectExpenseService["projectExpenseFinanceFactsMatch"]
    >[1]
  ): Promise<ProjectExpenseFinanceFactRow | null> {
    const financeClient = this.prisma.financeRecord as unknown as {
      findUnique(args: {
        where: { idempotencyKey: string };
      }): Promise<ProjectExpenseFinanceFactRow | null>;
    };
    const existing = await financeClient.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (
      !existing ||
      !this.projectExpenseFinanceFactsMatch(existing, input)
    ) {
      return null;
    }
    return existing;
  }

  private async projectExpenseFinanceCoverage(
    expenseRequestId: string
  ): Promise<{
    financeRecordedAmountCents: bigint;
    paidAmountCents: bigint;
    requestStatus: string;
  }> {
    const request = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId },
      select: { paidAmountCents: true, status: true }
    });
    if (!request) {
      throw new NotFoundException("项目支出申请不存在");
    }
    const records = await this.prisma.financeRecord.findMany({
      where: {
        projectExpenseRequestId: expenseRequestId,
        direction: "outflow"
      },
      select: { amountCents: true }
    });
    return {
      financeRecordedAmountCents: sumDbMoneyToBigInt(
        records.map((record) => record.amountCents),
        "财务入账金额"
      ),
      paidAmountCents: request.paidAmountCents,
      requestStatus: request.status
    };
  }

  async confirmPurchaseReceipt(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: ConfirmProjectExpenseReceiptDto
  ) {
    const idempotencyKey = input.idempotencyKey?.trim().toLowerCase();
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        idempotencyKey
      )
    ) {
      throw new BadRequestException(
        "收货确认幂等键必须是 UUID"
      );
    }
    const expectedExpenseUpdatedAt = new Date(
      input.expectedExpenseUpdatedAt
    );
    if (Number.isNaN(expectedExpenseUpdatedAt.getTime())) {
      throw new BadRequestException(
        "预期项目支出版本格式不正确"
      );
    }
    const note = trimmedOrNull(input.note);
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "收货确认需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense purchase receipt");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    const scope = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId },
      select: { id: true, projectId: true }
    });
    if (!scope) {
      throw new NotFoundException("项目支出申请不存在");
    }

    try {
      const receipt = await this.prisma.$transaction(
        async (tx) => {
          const request = await this.lockExpenseRequestById(
            tx,
            projectId,
            expenseRequestId
          );
          if (!request) {
            throw new NotFoundException("项目支出申请不存在");
          }
          if (
            request.id !== scope.id ||
            request.projectId !== scope.projectId
          ) {
            throw new ConflictException(
              "项目支出收货确认范围已变化，请刷新后重试"
            );
          }
          await this.assertCurrentProjectExpenseReceiptConfirmer(
            tx,
            actorUserId,
            request.projectId
          );
          if (request.applicantUserId !== actorUserId) {
            throw new ForbiddenException(
              "只有零星采购发起人可以确认收货"
            );
          }

          if (
            request.receiptConfirmationIdempotencyKey ===
            idempotencyKey
          ) {
            this.assertSameProjectExpenseReceiptFacts(request, {
              idempotencyKey,
              projectExpenseRequestId: request.id,
              projectId: request.projectId,
              actorUserId,
              note
            });
            return request;
          }
          if (request.receiptConfirmedAt) {
            throw new ConflictException(
              "零星采购已由另一收货事实确认"
            );
          }
          if (
            request.updatedAt.getTime() !==
            expectedExpenseUpdatedAt.getTime()
          ) {
            throw new ConflictException(
              "项目支出申请已变化，请刷新后重试"
            );
          }
          if (request.expenseType !== "spot_purchase") {
            throw new BadRequestException(
              "只有历史零星采购申请可以确认收货"
            );
          }
          if (!request.purchaseExecutedAt) {
            throw new BadRequestException(
              "零星采购执行后才能确认收货"
            );
          }
          if (
            !PROJECT_EXPENSE_RECEIPT_CONFIRMABLE_STATUSES.has(
              request.status
            )
          ) {
            throw new BadRequestException(
              "当前项目支出状态不可确认收货"
            );
          }

          const confirmedAt = new Date();
          const updated =
            await tx.projectExpenseRequest.update({
              where: { id: request.id },
              data: {
                receiptConfirmedByUserId: actorUserId,
                receiptConfirmedAt: confirmedAt,
                receiptConfirmationIdempotencyKey:
                  idempotencyKey,
                receiptConfirmationNote: note
              }
            });
          await this.audit.record(tx, {
            actorUserId,
            action: "project_expense.receipt.confirm",
            businessType: "project_expense_request",
            businessId: request.id,
            metadata: {
              code: request.code,
              projectId: request.projectId,
              idempotencyKey,
              confirmedByUserId: actorUserId,
              confirmedAt: confirmedAt.toISOString(),
              note,
              statusAtConfirmation: request.status,
              paymentCompleted: request.status === "paid",
              expectedExpenseUpdatedAt:
                expectedExpenseUpdatedAt.toISOString()
            }
          });
          return updated;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      );
      return this.projectExpenseReceiptResponse(receipt);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = projectExpensePrismaErrorCode(error);
      const serializationConflict =
        code === "P2034" ||
        projectExpenseRawSerializationConflict(error);
      if (code === "P2002" || serializationConflict) {
        const concurrentReceipt =
          await this.resolveConcurrentProjectExpenseReceipt({
            idempotencyKey,
            projectExpenseRequestId: scope.id,
            projectId: scope.projectId,
            actorUserId,
            note
          });
        if (concurrentReceipt) {
          return this.projectExpenseReceiptResponse(
            concurrentReceipt
          );
        }
        throw new ConflictException(
          serializationConflict
            ? "项目支出收货确认并发冲突，请刷新后重试"
            : "收货确认幂等键已绑定其他持久事实"
        );
      }
      throw error;
    }
  }

  private projectExpenseReceiptFactsMatch(
    existing: ProjectExpenseReceiptFactRow,
    expected: {
      idempotencyKey: string;
      projectExpenseRequestId: string;
      projectId: string;
      actorUserId: string;
      note: string | null;
    }
  ): boolean {
    return (
      existing.id === expected.projectExpenseRequestId &&
      existing.projectId === expected.projectId &&
      existing.receiptConfirmationIdempotencyKey ===
        expected.idempotencyKey &&
      existing.receiptConfirmedByUserId === expected.actorUserId &&
      existing.receiptConfirmationNote === expected.note &&
      existing.receiptConfirmedAt instanceof Date
    );
  }

  private assertSameProjectExpenseReceiptFacts(
    existing: ProjectExpenseReceiptFactRow,
    expected: Parameters<
      ProjectExpenseService["projectExpenseReceiptFactsMatch"]
    >[1]
  ): void {
    if (!this.projectExpenseReceiptFactsMatch(existing, expected)) {
      throw new ConflictException(
        "该收货确认幂等键已绑定不同的持久事实"
      );
    }
  }

  private async resolveConcurrentProjectExpenseReceipt(
    input: Parameters<
      ProjectExpenseService["projectExpenseReceiptFactsMatch"]
    >[1]
  ): Promise<ProjectExpenseReceiptFactRow | null> {
    const receiptClient =
      this.prisma.projectExpenseRequest as unknown as {
        findFirst(args: {
          where: {
            receiptConfirmationIdempotencyKey: string;
          };
          select: Record<string, boolean>;
        }): Promise<ProjectExpenseReceiptFactRow | null>;
      };
    const existing = await receiptClient.findFirst({
      where: {
        receiptConfirmationIdempotencyKey: input.idempotencyKey
      },
      select: {
        id: true,
        projectId: true,
        receiptConfirmedByUserId: true,
        receiptConfirmedAt: true,
        receiptConfirmationIdempotencyKey: true,
        receiptConfirmationNote: true,
        updatedAt: true
      }
    });
    if (
      !existing ||
      !this.projectExpenseReceiptFactsMatch(existing, input)
    ) {
      return null;
    }
    return existing;
  }

  private projectExpenseReceiptResponse(
    receipt: ProjectExpenseReceiptFactRow
  ) {
    if (
      !receipt.receiptConfirmationIdempotencyKey ||
      !receipt.receiptConfirmedByUserId ||
      !(receipt.receiptConfirmedAt instanceof Date)
    ) {
      throw new ConflictException(
        "收货确认持久事实不完整，请联系管理员核对"
      );
    }
    return {
      projectId: receipt.projectId,
      expenseRequestId: receipt.id,
      idempotencyKey:
        receipt.receiptConfirmationIdempotencyKey,
      confirmedByUserId: receipt.receiptConfirmedByUserId,
      confirmedAt: receipt.receiptConfirmedAt.toISOString(),
      note: receipt.receiptConfirmationNote,
      updatedAt: receipt.updatedAt.toISOString()
    };
  }

  private async ensureApprovalPdfArchive(expenseRequestId: string, actorUserId: string) {
    if (!this.files) {
      throw new Error("File service is required to generate project expense approval PDF");
    }

    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { OR: [{ id: expenseRequestId }, { code: expenseRequestId }] }
    });
    if (!expense) {
      throw new NotFoundException("项目支出申请不存在");
    }
    if (expense.status !== "approved_pending_payment") {
      throw new BadRequestException("项目支出审批完成后才能生成审批单 PDF");
    }

    const existingPdf = await this.prisma.pdfDocument.findFirst({
      where: {
        businessType: "project_expense_request",
        businessId: expense.id,
        templateKey: APPROVAL_PDF_TEMPLATE_KEY
      }
    });
    if (existingPdf) {
      return { pdfDocument: existingPdf, archiveRecord: null };
    }

    const buffer = renderSimplePdf([
      projectExpenseApprovalPdfTitle(expense.expenseType),
      `单据编号：${expense.code}`,
      `支出类型：${projectExpenseTypeLabel(expense.expenseType)}`,
      `明细类型：${projectExpenseSubtypeLabel(expense.expenseSubtype)}`,
      `付款事由：${expense.paymentSubject}`,
      `用途说明：${expense.reason}`,
      `收款对象：${expense.counterpartyName ?? "未填写"}`,
      `附件状态：${expense.attachmentFileId ? "已上传" : "未上传"}`,
      `申请金额：${formatCents(expense.requestedAmountCents)} 元`,
      `批准金额：${formatCents(expense.approvedAmountCents ?? expense.requestedAmountCents)} 元`,
      `申请人：${expense.applicantUserId}`,
      `生成时间：${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${expense.code}-${APPROVAL_PDF_TEMPLATE_KEY}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.prisma.$transaction(async (tx) => {
      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "project_expense_request",
          businessId: expense.id,
          fileId: file.id,
          templateKey: APPROVAL_PDF_TEMPLATE_KEY
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "project_expense_request",
          businessId: expense.id,
          fileId: file.id,
          departmentScope: "finance"
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.approval_pdf.archive",
        businessType: "project_expense_request",
        businessId: expense.id,
        metadata: {
          code: expense.code,
          fileId: file.id,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          templateKey: APPROVAL_PDF_TEMPLATE_KEY
        }
      });
      return { pdfDocument, archiveRecord };
    });
  }

  private async ensureFinancePdfArchive(expenseRequestId: string, actorUserId: string) {
    if (!this.files) {
      throw new Error("File service is required to generate project expense finance PDF");
    }

    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { OR: [{ id: expenseRequestId }, { code: expenseRequestId }] }
    });
    if (!expense) {
      throw new NotFoundException("项目支出申请不存在");
    }
    const financeRecords = await this.prisma.financeRecord.findMany({
      where: { projectExpenseRequestId: expense.id, direction: "outflow" },
      select: { amountCents: true }
    });
    const financeRecordedAmountCents = sumDbMoneyToBigInt(
      financeRecords.map((record) => record.amountCents),
      "财务入账金额"
    );
    const paidAmountCents = dbMoneyToBigInt(expense.paidAmountCents, "项目支出实付金额");
    if (paidAmountCents <= 0n || financeRecordedAmountCents < paidAmountCents) {
      throw new BadRequestException("项目支出财务入账完成后才能生成归档 PDF");
    }

    const existingPdf = await this.prisma.pdfDocument.findFirst({
      where: {
        businessType: "project_expense_request",
        businessId: expense.id,
        templateKey: FINANCE_PDF_TEMPLATE_KEY
      }
    });
    if (existingPdf) {
      return { pdfDocument: existingPdf, archiveRecord: null };
    }

    const buffer = renderSimplePdf([
      projectExpenseFinancePdfTitle(expense.expenseType),
      `单据编号：${expense.code}`,
      `支出类型：${projectExpenseTypeLabel(expense.expenseType)}`,
      `明细类型：${projectExpenseSubtypeLabel(expense.expenseSubtype)}`,
      `付款事由：${expense.paymentSubject}`,
      `申请金额：${formatCents(expense.requestedAmountCents)} 元`,
      `批准金额：${formatCents(expense.approvedAmountCents ?? expense.requestedAmountCents)} 元`,
      `已实付金额：${formatCents(expense.paidAmountCents)} 元`,
      `财务入账金额：${formatCents(financeRecordedAmountCents)} 元`,
      `生成时间：${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${expense.code}-${FINANCE_PDF_TEMPLATE_KEY}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.prisma.$transaction(async (tx) => {
      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "project_expense_request",
          businessId: expense.id,
          fileId: file.id,
          templateKey: FINANCE_PDF_TEMPLATE_KEY
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "project_expense_request",
          businessId: expense.id,
          fileId: file.id,
          departmentScope: "finance"
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.finance_pdf.archive",
        businessType: "project_expense_request",
        businessId: expense.id,
        metadata: {
          code: expense.code,
          fileId: file.id,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          templateKey: FINANCE_PDF_TEMPLATE_KEY
        }
      });
      return { pdfDocument, archiveRecord };
    });
  }

  private async releaseFinancingQuotaUsage(
    tx: Prisma.TransactionClient,
    expenseRequestId: string,
    actorUserId: string,
    action: string
  ) {
    const releasedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      expenseRequestId,
      undefined,
      "released"
    );
    if (releasedAmountCents > 0n) {
      await this.audit.record(tx, {
        actorUserId,
        action,
        businessType: "project_expense_request",
        businessId: expenseRequestId,
        metadata: { releasedAmountCents: releasedAmountCents.toString() }
      });
    }
  }

  private async freezeApprovalNodes(
    tx: Prisma.TransactionClient,
    projectId: string,
    expenseType: (typeof EXPENSE_TYPES)[number],
    applicantUserId: string
  ): Promise<ProjectExpenseApprovalNode[]> {
    const definitions = getProjectExpenseApprovalNodes(expenseType);
    const requiredRoles: RoleKey[] = Array.from(
      new Set<RoleKey>(definitions.flatMap((node) => node.roleKeys))
    );
    const projectCandidates = await tx.$queryRaw<ProjectExpenseApprovalCandidateRow[]>(Prisma.sql`
      SELECT pm."userId", pm."positionKey" AS "roleKey"
      FROM "ProjectMember" pm
      INNER JOIN "User" u ON u."id" = pm."userId"
      WHERE pm."projectId" = ${projectId}
        AND pm."positionKey" IN (${Prisma.join(requiredRoles)})
        AND u."isActive" = TRUE
      FOR SHARE OF pm, u
    `);
    const positionedCandidates = await tx.$queryRaw<ProjectExpenseApprovalCandidateRow[]>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey"
      FROM "UserPosition" up
      INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE (up."projectId" IS NULL OR up."projectId" = ${projectId})
        AND p."key" IN (${Prisma.join(requiredRoles)})
        AND u."isActive" = TRUE
      FOR SHARE OF up, p, u
    `);
    const candidatesByRole = new Map<RoleKey, Set<string>>();
    for (const candidate of [...projectCandidates, ...positionedCandidates]) {
      if (!requiredRoles.includes(candidate.roleKey)) continue;
      const candidates = candidatesByRole.get(candidate.roleKey) ?? new Set<string>();
      candidates.add(candidate.userId);
      candidatesByRole.set(candidate.roleKey, candidates);
    }

    return definitions.map((definition) => {
      const permitsApplicantSelfReview = definition.roleKeys.every(
        (role) => role === "chairman" || role === "general_manager"
      );
      const rawCandidatesByRole = Object.fromEntries(
        definition.roleKeys.map((role) => [
          role,
          Array.from(candidatesByRole.get(role) ?? [])
            .filter((userId) => permitsApplicantSelfReview || userId !== applicantUserId)
            .sort()
        ])
      ) as Partial<Record<RoleKey, string[]>>;
      const roleMatchCount = new Map<string, number>();
      for (const role of definition.roleKeys) {
        for (const userId of rawCandidatesByRole[role] ?? []) {
          roleMatchCount.set(userId, (roleMatchCount.get(userId) ?? 0) + 1);
        }
      }
      const candidateUserIdsByRole = Object.fromEntries(
        definition.roleKeys.map((role) => [
          role,
          (rawCandidatesByRole[role] ?? []).filter(
            (userId) => roleMatchCount.get(userId) === 1
          )
        ])
      ) as Partial<Record<RoleKey, string[]>>;
      const candidateUserIds = Array.from(
        new Set(definition.roleKeys.flatMap((role) => candidateUserIdsByRole[role] ?? []))
      ).sort();
      if (!candidateUserIds.length) {
        throw new BadRequestException(
          `${definition.name}缺少当前有效且可审批的人员，请先完成组织配置`
        );
      }
      return {
        name: definition.name,
        mode: "any",
        roleKeys: [...definition.roleKeys],
        candidateUserIds,
        candidateUserIdsByRole
      };
    });
  }

  private resolveProjectExpenseReviewIdentity(
    node: ProjectExpenseApprovalNode,
    actorUserId: string,
    actorRoleKeys: RoleKey[]
  ) {
    return resolveApprovalReviewIdentity({
      node: { ...node, assignments: [] },
      actorUserId,
      actorRoleKeys
    });
  }

  private async shrinkFinancingQuotaUsageToApprovedAmount(
    tx: Prisma.TransactionClient,
    request: { id: string; requestedAmountCents: bigint; approvedAmountCents: bigint | null },
    approvedAmountCents: bigint,
    actorUserId: string
  ) {
    const usageTotals = await this.financingUsageTotals(tx, request.id);
    const cashAllocatedCents =
      dbMoneyToBigInt(request.requestedAmountCents, "项目支出申请金额") -
      usageTotals.occupied -
      usageTotals.used;
    const targetFinancingCents =
      dbMoneyToBigInt(approvedAmountCents, "项目支出批准金额") > cashAllocatedCents
        ? dbMoneyToBigInt(approvedAmountCents, "项目支出批准金额") - cashAllocatedCents
        : 0n;
    if (usageTotals.used > targetFinancingCents) {
      throw new BadRequestException("批准金额不能低于已使用融资额度与现金部分之和");
    }
    const targetOccupiedCents = targetFinancingCents - usageTotals.used;
    const amountToRelease =
      usageTotals.occupied > targetOccupiedCents
        ? usageTotals.occupied - targetOccupiedCents
        : 0n;
    if (amountToRelease === 0n) {
      return;
    }
    const releasedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      request.id,
      amountToRelease,
      "released"
    );
    if (releasedAmountCents !== amountToRelease) {
      throw new ConflictException("项目支出融资额度占用已变化，请刷新后重试");
    }
    if (releasedAmountCents > 0n) {
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.cash_pool.release.approval_amount_reduced",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: { releasedAmountCents: releasedAmountCents.toString() }
      });
    }
  }

  private async financingUsageTotals(tx: Prisma.TransactionClient, expenseRequestId: string) {
    const usages = await tx.projectExpenseFinancingQuotaUsage.findMany({
      where: { projectExpenseRequestId: expenseRequestId, status: { in: ["occupied", "used"] } },
      select: { amountCents: true, status: true }
    });
    return usages.reduce(
      (totals, usage) => ({
        occupied:
          totals.occupied +
          (usage.status === "occupied"
            ? dbMoneyToBigInt(usage.amountCents, "项目支出垫资额度占用金额")
            : 0n),
        used:
          totals.used +
          (usage.status === "used"
            ? dbMoneyToBigInt(usage.amountCents, "项目支出垫资额度使用金额")
            : 0n)
      }),
      { occupied: 0n, used: 0n }
    );
  }

  private async moveFinancingQuotaUsage(
    tx: Prisma.TransactionClient,
    expenseRequestId: string,
    amountCents: bigint | undefined,
    status: "released" | "used"
  ) {
    let remaining = amountCents;
    let moved = 0n;
    const occupiedUsages = await tx.projectExpenseFinancingQuotaUsage.findMany({
      where: { projectExpenseRequestId: expenseRequestId, status: "occupied" },
      select: { id: true, quotaId: true, projectId: true, amountCents: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    for (const usage of occupiedUsages) {
      if (remaining !== undefined && remaining <= 0n) {
        break;
      }
      const available = dbMoneyToBigInt(usage.amountCents, "项目支出垫资额度占用金额");
      const amount = remaining === undefined || available <= remaining ? available : remaining;
      if (amount <= 0n) {
        continue;
      }
      if (amount === available) {
        await tx.projectExpenseFinancingQuotaUsage.update({
          where: { id: usage.id },
          data: { status }
        });
      } else {
        await tx.projectExpenseFinancingQuotaUsage.update({
          where: { id: usage.id },
          data: { amountCents: available - amount }
        });
        await tx.projectExpenseFinancingQuotaUsage.create({
          data: {
            quotaId: usage.quotaId,
            projectExpenseRequestId: expenseRequestId,
            projectId: usage.projectId,
            amountCents: amount,
            status
          }
        });
      }
      moved += amount;
      if (remaining !== undefined) {
        remaining -= amount;
      }
    }
    return moved;
  }

  private async assertCurrentProjectExpenseFinanceStaff(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<void> {
    const access = await this.currentProjectExpenseFinanceRoleAccess(
      tx,
      actorUserId,
      projectId
    );
    if (!access.actorActive) {
      throw new ForbiddenException(
        "当前项目支出付款登记账号不存在或已停用"
      );
    }
    if (!access.canRecordExecution) {
      throw new ForbiddenException(
        "只有当前项目财务人员可以登记项目支出实付"
      );
    }
  }

  private async assertCurrentProjectExpenseFinanceRecorder(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<void> {
    const access = await this.currentProjectExpenseFinanceRoleAccess(
      tx,
      actorUserId,
      projectId
    );
    if (!access.actorActive) {
      throw new ForbiddenException(
        "当前项目支出财务入账账号不存在或已停用"
      );
    }
    if (!access.canRecordFinance) {
      throw new ForbiddenException(
        "只有当前项目财务人员或财务主管可以登记项目支出财务入账"
      );
    }
  }

  private async assertCurrentProjectExpenseReceiptConfirmer(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<void> {
    const access = await this.currentProjectExpenseFinanceRoleAccess(
      tx,
      actorUserId,
      projectId
    );
    if (!access.actorActive) {
      throw new ForbiddenException(
        "当前收货确认账号不存在或已停用"
      );
    }
    if (!access.canConfirmReceipt) {
      throw new ForbiddenException(
        "当前账号在本项目无权确认收货"
      );
    }
  }

  private async currentProjectExpenseFinanceRoleAccess(
    tx: {
      user: {
        findUnique(input: unknown): Promise<{
          id: string;
          isActive: boolean;
        } | null>;
      };
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string }>>;
      };
      projectMember: {
        findMany(input: unknown): Promise<Array<{ positionKey: string }>>;
      };
      position: {
        findMany(input: unknown): Promise<Array<{ key: string }>>;
      };
    },
    actorUserId: string,
    projectId: string
  ): Promise<{
    actorActive: boolean;
    canRecordExecution: boolean;
    canRecordFinance: boolean;
    canConfirmReceipt: boolean;
  }> {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) {
      return {
        actorActive: false,
        canRecordExecution: false,
        canRecordFinance: false,
        canConfirmReceipt: false
      };
    }

    const [projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionId: true }
      }),
      tx.projectMember.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionKey: true }
      })
    ]);
    const positionIds = [
      ...new Set(projectPositions.map((row) => row.positionId))
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { key: true }
        })
      : [];
    const projectRoleKeys = new Set([
      ...projectMembers.map((row) => row.positionKey),
      ...positions.map((row) => row.key)
    ]);
    return {
      actorActive: true,
      canRecordExecution: projectRoleKeys.has("finance_staff"),
      canRecordFinance:
        projectRoleKeys.has("finance_staff") ||
        projectRoleKeys.has("finance_director"),
      canConfirmReceipt:
        projectRoleKeys.has("employee") ||
        projectRoleKeys.has("material_staff") ||
        projectRoleKeys.has("project_manager")
    };
  }

  private async lockExpenseRequest(
    tx: Prisma.TransactionClient,
    projectId: string,
    expenseRequestId: string
  ): Promise<ExpenseLockRow | null> {
    const rows = await tx.$queryRaw<Array<ExpenseLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "code",
        "expenseType",
        "status",
        "requestedAmountCents",
        "approvedAmountCents",
        "paidAmountCents",
        "applicantUserId",
        "purchaseExecutedAt",
        "receiptConfirmedByUserId",
        "receiptConfirmedAt",
        "receiptConfirmationIdempotencyKey",
        "receiptConfirmationNote",
        "updatedAt"
      FROM "ProjectExpenseRequest"
      WHERE "projectId" = ${projectId} AND ("id" = ${expenseRequestId} OR "code" = ${expenseRequestId})
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockExpenseRequestById(
    tx: Prisma.TransactionClient,
    projectId: string,
    expenseRequestId: string
  ): Promise<ExpenseLockRow | null> {
    const rows = await tx.$queryRaw<Array<ExpenseLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "code",
        "expenseType",
        "status",
        "requestedAmountCents",
        "approvedAmountCents",
        "paidAmountCents",
        "applicantUserId",
        "purchaseExecutedAt",
        "receiptConfirmedByUserId",
        "receiptConfirmedAt",
        "receiptConfirmationIdempotencyKey",
        "receiptConfirmationNote",
        "updatedAt"
      FROM "ProjectExpenseRequest"
      WHERE "projectId" = ${projectId}
        AND "id" = ${expenseRequestId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockApprovalInstance(
    tx: Prisma.TransactionClient,
    expenseRequestId: string,
    status = "in_progress"
  ): Promise<ApprovalInstanceLockRow | null> {
    const rows = await tx.$queryRaw<Array<ApprovalInstanceLockRow>>(Prisma.sql`
      SELECT
        "id",
        "status",
        "currentNodeIndex",
        "frozenNodes",
        "applicantUserId",
        "updatedAt"
      FROM "ApprovalInstance"
      WHERE "businessType" = 'project_expense_request'
        AND "businessId" = ${expenseRequestId}
        AND "flowType" = 'project_expense.approve'
        AND "status" = ${status}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockApprovalInstances(
    tx: Prisma.TransactionClient,
    expenseRequestId: string
  ): Promise<ApprovalInstanceLockRow[]> {
    return tx.$queryRaw<Array<ApprovalInstanceLockRow>>(Prisma.sql`
      SELECT
        "id",
        "status",
        "currentNodeIndex",
        "frozenNodes",
        "applicantUserId",
        "updatedAt"
      FROM "ApprovalInstance"
      WHERE "businessType" = 'project_expense_request'
        AND "businessId" = ${expenseRequestId}
        AND "flowType" = 'project_expense.approve'
        AND "status" = 'in_progress'
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async loadActorRoleKeys(
    tx: {
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, memberPositions] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = [...new Set([...globalPositions, ...projectPositions].map((item) => item.positionId))];
    const positions = await tx.position.findMany({ where: { id: { in: positionIds } } });
    return [
      ...positions.map((position) => position.key as RoleKey),
      ...memberPositions.map((position) => position.positionKey as RoleKey)
    ];
  }

  private positiveInteger(rawValue: string | number | undefined, fallback: number) {
    const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }

  private projectExpenseLedgerView(
    value: ProjectExpenseLedgerView | undefined
  ): ProjectExpenseLedgerView {
    return value && ["formal_ledger", "my_drafts", "returned_for_revision", "ended"].includes(value)
      ? value
      : "formal_ledger";
  }
}

function requiredTrimmed(value: string | undefined, message: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function trimmedOrNull(value: string | undefined) {
  return value?.trim() || null;
}

function positiveMoneyCents(value: string, message: string): bigint {
  const cents = parseMoneyCentsInput(value, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function projectExpensePrismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function projectExpenseRawSerializationConflict(error: unknown): boolean {
  if (
    projectExpensePrismaErrorCode(error) !== "P2010" ||
    !error ||
    typeof error !== "object" ||
    !("meta" in error)
  ) {
    return false;
  }
  const meta = (error as { meta?: unknown }).meta;
  return (
    meta !== null &&
    meta !== undefined &&
    typeof meta === "object" &&
    "code" in meta &&
    (meta as { code?: unknown }).code === "40001"
  );
}

function parseDate(value: string | undefined, message: string) {
  const raw = requiredTrimmed(value, message);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(message);
  }
  return date;
}

function enumValue<T extends readonly string[]>(value: string, allowed: T, message: string): T[number] {
  if (!allowed.includes(value)) {
    throw new BadRequestException(message);
  }
  return value as T[number];
}

function assertExpenseSubtypeMatchesType(
  expenseType: (typeof EXPENSE_TYPES)[number],
  expenseSubtype: (typeof EXPENSE_SUBTYPES)[number]
) {
  const allowedSubtypes =
    expenseType === "sporadic_payment"
      ? SPORADIC_PAYMENT_SUBTYPES
      : expenseType === "loan_reserve"
        ? LOAN_RESERVE_SUBTYPES
        : expenseType === "reimbursement"
          ? REIMBURSEMENT_SUBTYPES
          : expenseType === "spot_purchase"
            ? SPOT_PURCHASE_SUBTYPES
            : COMPREHENSIVE_EXPENSE_SUBTYPES;
  if (!(allowedSubtypes as readonly string[]).includes(expenseSubtype)) {
    throw new BadRequestException("项目支出类型与明细类型不匹配");
  }
}

function getProjectExpenseApprovalNodes(expenseType: (typeof EXPENSE_TYPES)[number]) {
  if (expenseType === "reimbursement") {
    return REIMBURSEMENT_APPROVAL_NODES;
  }
  if (expenseType === "spot_purchase") {
    return SPOT_PURCHASE_APPROVAL_NODES;
  }
  return PROJECT_EXPENSE_APPROVAL_NODES;
}

function formatCents(amountCents: bigint) {
  return formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "项目支出金额")).replace(/,/g, "");
}

function projectExpenseApprovalPdfTitle(expenseType: string) {
  if (expenseType === "reimbursement") return "报销审批单";
  if (expenseType === "spot_purchase") return "零星采购审批单";
  return "项目支出审批单";
}

function projectExpenseFinancePdfTitle(expenseType: string) {
  if (expenseType === "reimbursement") return "报销财务归档单";
  if (expenseType === "spot_purchase") return "零星采购财务归档单";
  return "项目支出财务归档单";
}

function projectExpenseTypeLabel(expenseType: string) {
  if (expenseType === "sporadic_payment") return "零星付款";
  if (expenseType === "loan_reserve") return "借款备用金";
  if (expenseType === "comprehensive_expense") return "综合费用";
  if (expenseType === "reimbursement") return "报销";
  if (expenseType === "spot_purchase") return "零星采购";
  return "项目支出";
}

function projectExpenseSubtypeLabel(expenseSubtype: string) {
  if (expenseSubtype === "sporadic_material") return "零星材料";
  if (expenseSubtype === "sporadic_machinery") return "零星机械";
  if (expenseSubtype === "sporadic_labor") return "零星人工";
  if (expenseSubtype === "temporary_service") return "临时服务";
  if (expenseSubtype === "other_sporadic") return "其他零星";
  if (expenseSubtype === "employee_loan") return "员工借款";
  if (expenseSubtype === "owner_loan") return "业主借款";
  if (expenseSubtype === "project_reserve") return "项目备用金";
  if (expenseSubtype === "travel") return "差旅费";
  if (expenseSubtype === "entertainment") return "业务招待费";
  if (expenseSubtype === "reimbursement") return "报销";
  if (expenseSubtype === "spot_material_purchase") return "零星材料采购";
  if (expenseSubtype === "spot_tool_purchase") return "零星工具采购";
  if (expenseSubtype === "spot_service_purchase") return "零星服务采购";
  if (expenseSubtype === "spot_other_purchase") return "其他零星采购";
  return "其他支出";
}

function projectExpenseStatusLabel(status: string) {
  if (status === "approval_pending") return "审批中";
  if (status === "approved_pending_payment") return "审批通过待付款";
  if (status === "partially_paid") return "部分付款";
  if (status === "paid") return "已付款";
  if (status === "payment_blocked") return "付款受阻";
  if (status === "rejected") return "已驳回";
  if (status === "withdrawn") return "已撤回";
  if (status === "voided") return "已作废";
  return status;
}
