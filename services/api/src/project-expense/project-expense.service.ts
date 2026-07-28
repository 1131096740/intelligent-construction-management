import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  type DetailActionReadModel,
  type ProjectExpenseApprovalDetailReadModel,
  type RoleKey
} from "@jiangkong/shared-domain";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
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

interface ProjectExpenseApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
}

type ProjectExpenseLedgerView = "formal_ledger" | "my_drafts" | "returned_for_revision" | "ended";

type ProjectExpenseApprovalLifecycleReadModel = ProjectExpenseApprovalDetailReadModel & {
  lifecycleKind: "formal_record";
  ledgerView: "formal_ledger" | "ended";
  lifecycleUpdatedAt: string | null;
  hasPersistentDraft: false;
  availableActions: DetailActionReadModel[];
  blockedReasons: string[];
};

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
  receiptConfirmedAt: Date | null;
}

interface ApprovalInstanceLockRow {
  id: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: Prisma.JsonValue;
  applicantUserId: string;
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
      const availableActions: string[] = [];
      if (row.status === "approval_pending" && applicantUserId === actorUserId) {
        availableActions.push("withdraw");
      }
      if (
        ["approval_pending", "approved_pending_payment"].includes(row.status) &&
        !paid &&
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
        isReceiptConfirmed: Boolean(row.receiptConfirmedAt),
        purchaseExecutedAt: row.purchaseExecutedAt?.toISOString() ?? null,
        receiptConfirmedAt: row.receiptConfirmedAt?.toISOString() ?? null,
        lifecycleKind: "formal_record" as const,
        ledgerView: ended ? ("ended" as const) : ("formal_ledger" as const),
        hasPersistentDraft: false,
        availableActions,
        blockedReasons: paid
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
        applicantUserId: true,
        status: true,
        updatedAt: true
      }
    });
    if (!expense) {
      throw new NotFoundException("项目支出申请不存在");
    }

    const actorRoleKeys = await this.loadActorRoleKeys(this.prisma, actorUserId, projectId);
    const isExpenseApplicant = expense.applicantUserId === actorUserId;
    if (!isExpenseApplicant && !canPerform("project_expense.approve", actorRoleKeys)) {
      throw new ForbiddenException("无权查看该项目支出审批详情");
    }

    const instance = expense.status === "approval_pending"
      ? await this.prisma.approvalInstance.findFirst({
          where: {
            businessType: "project_expense_request",
            businessId: expense.id,
            flowType: "project_expense.approve",
            status: "in_progress"
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            currentNodeIndex: true,
            frozenNodes: true,
            applicantUserId: true
          }
        })
      : null;
    const nodes = (instance?.frozenNodes ?? []) as unknown as ProjectExpenseApprovalNode[];
    const currentNode = instance ? nodes[instance.currentNodeIndex] ?? null : null;
    const approvedRoleKey = currentNode?.roleKeys.find((role) => actorRoleKeys.includes(role)) ?? null;
    const isApprovalApplicant = instance?.applicantUserId === actorUserId;
    const isLeaderSelfReview =
      isApprovalApplicant && (approvedRoleKey === "chairman" || approvedRoleKey === "general_manager");
    const canReview = expense.status === "approval_pending" && Boolean(currentNode && approvedRoleKey);
    const disabledReason = expense.status !== "approval_pending"
      ? "当前项目支出状态不可审批"
      : !currentNode
        ? "项目支出当前审批节点不存在"
        : !approvedRoleKey
          ? "当前岗位无权审批此节点"
          : isApprovalApplicant && !isLeaderSelfReview
            ? "申请人不能审批自己发起的业务"
            : undefined;
    const reviewEnabled = canReview && (!isApprovalApplicant || isLeaderSelfReview);
    const paidAmountCents = expense.paidAmountCents ?? 0n;
    const ended = ["withdrawn", "rejected", "voided"].includes(expense.status);
    const availableActions: DetailActionReadModel[] = [];
    const blockedReasons: string[] = [];
    if (ended) {
      blockedReasons.push("项目支出申请已结束，只能查看历史记录");
    } else if (paidAmountCents > 0n || ["partially_paid", "paid"].includes(expense.status)) {
      blockedReasons.push("已有实付记录，不能删除或普通作废");
    } else if (expense.status === "approval_pending") {
      if (isExpenseApplicant) {
        availableActions.push(detailAction({
          key: "withdraw",
          label: "撤回项目支出申请",
          kind: "danger",
          roleKeys: actorRoleKeys,
          skipRoleCheck: true,
          enabled: true
        }));
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
      if (availableActions.length === 0) {
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
      currentNodeName: currentNode?.name ?? null,
      canSetApprovedAmount: Boolean(
        instance && currentNode && instance.currentNodeIndex === nodes.length - 1
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
      blockedReasons
    };
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

    const expense = await this.prisma.projectExpenseRequest.findFirst({
      where: { id: expenseRequestId, projectId, voidedAt: null },
      select: { attachmentFileId: true }
    });
    if (!expense) {
      throw new NotFoundException("项目支出申请不存在");
    }
    if (!expense.attachmentFileId) {
      throw new BadRequestException("项目支出申请未上传附件");
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
    const expenseSubtype = enumValue(input.expenseSubtype, EXPENSE_SUBTYPES, "项目支出明细类型无效");
    const paymentMethod = enumValue(input.paymentMethod, PAYMENT_METHODS, "项目支出付款方式无效");
    assertExpenseSubtypeMatchesType(expenseType, expenseSubtype);
    const paymentSubject = requiredTrimmed(input.paymentSubject, "付款主体必填");
    const reason = requiredTrimmed(input.reason, "付款事由必填");
    const requestedAmountCents = positiveMoneyCents(input.requestedAmountCents, "申请金额必须大于零");
    const attachmentFileId = input.attachmentFileId?.trim() || undefined;
    if (expenseType === "spot_purchase") {
      requiredTrimmed(input.counterpartyName, "零星采购供应商必填");
      if (!attachmentFileId) {
        throw new BadRequestException("零星采购附件必填");
      }
    }

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
      if (expenseType === "spot_purchase") {
        const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, project.id);
        if (!actorRoleKeys.includes("material_staff")) {
          throw new BadRequestException("只有物资员可以发起零星采购申请");
        }
      }

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
          frozenNodes: getProjectExpenseApprovalNodes(expenseType) as unknown as Prisma.InputJsonValue,
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

    const reviewed = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.status !== "approval_pending") {
        throw new BadRequestException("当前项目支出状态不可审批");
      }

      const instance = await this.lockApprovalInstance(tx, request.id);
      if (!instance) {
        throw new BadRequestException("项目支出审批实例不存在");
      }
      const nodes = instance.frozenNodes as unknown as ProjectExpenseApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];
      if (!currentNode) {
        throw new BadRequestException("项目支出当前审批节点不存在");
      }
      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, projectId);
      const approvedRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));
      if (!approvedRoleKey) {
        throw new BadRequestException(`当前用户不能审批项目支出节点：${currentNode.name}`);
      }

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys,
        approvedRoleKey,
        selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: this.auth
          ? (password) => this.auth!.confirmPassword(actorUserId, password)
          : undefined
      });

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
            nodeName: currentNode.name,
            approvedRoleKey,
            ...selfReview.metadata
          }
        });
        return rejected;
      }

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
          nodeName: currentNode.name,
          approvedRoleKey,
          flowCompleted,
          approvedAmountCents: flowCompleted ? moneyCentsToApi(approvedAmountCents) : undefined,
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

  async withdrawApproval(projectId: string, expenseRequestId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.status !== "approval_pending") {
        throw new BadRequestException("当前项目支出状态不可撤回");
      }
      const instance = await this.lockApprovalInstance(tx, request.id);
      if (!instance || instance.applicantUserId !== actorUserId) {
        throw new BadRequestException("只有项目支出申请人可以撤回");
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
        metadata: { projectId }
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
    const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于零");
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

    const execution = await this.prisma.$transaction(async (tx) => {
      if (this.projectFunding) {
        await this.projectFunding.lockFundingContext(tx, projectId);
      }
      const request = await this.lockExpenseRequestForExecution(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      const existingExecution = this.projectFunding
        ? await tx.projectExpenseExecution.findFirst({
            where: { voucherFileId }
          })
        : null;
      if (existingExecution) {
        if (
          existingExecution.projectExpenseRequestId !== request.id ||
          existingExecution.projectId !== request.projectId ||
          existingExecution.amountCents !== amountCents ||
          existingExecution.paidAt.getTime() !== paidAt.getTime() ||
          existingExecution.executedByUserId !== actorUserId
        ) {
          throw new BadRequestException("该项目支出付款凭证已绑定不同的实付事实");
        }
        await this.projectFunding!.allocateExecution(tx, {
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
      if (!["approved_pending_payment", "partially_paid"].includes(request.status)) {
        throw new BadRequestException("当前项目支出状态不可实付");
      }
      if (request.expenseType === "spot_purchase" && !request.purchaseExecutedAt) {
        throw new BadRequestException("零星采购执行后才能登记实付");
      }
      const approvedAmountCents = request.approvedAmountCents ?? request.requestedAmountCents;
      const remaining = approvedAmountCents - request.paidAmountCents;
      if (amountCents > remaining) {
        throw new BadRequestException(`实付金额超过剩余批准金额: ${remaining}`);
      }
      const voucherFile = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });
      if (!voucherFile) {
        throw new NotFoundException("项目支出实付凭证不存在");
      }
      if (voucherFile.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("项目支出实付凭证必须由登记人本人上传");
      }
      const newPaidAmountCents = request.paidAmountCents + amountCents;
      const status = newPaidAmountCents >= approvedAmountCents ? "paid" : "partially_paid";
      const created = await tx.projectExpenseExecution.create({
        data: {
          projectExpenseRequestId: request.id,
          projectId: request.projectId,
          amountCents,
          paidAt,
          executedByUserId: actorUserId,
          voucherFileId
        }
      });
      if (this.projectFunding) {
        await this.projectFunding.allocateExecution(tx, {
          projectId: request.projectId,
          executionType: "project_expense_execution",
          executionId: created.id,
          businessType: "project_expense_request",
          businessId: request.id,
          amountCents,
          occurredAt: paidAt,
          actorUserId
        });
      }
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
          projectId,
          executionId: created.id,
          amountCents: moneyCentsToApi(amountCents),
          voucherFileId
        }
      });
      return created;
    });

    return projectExpensePostResponseToApi(execution);
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
    const amountCents = positiveMoneyCents(input.amountCents, "财务记录金额必须大于零");
    const occurredAt = parseDate(input.occurredAt, "财务记录日期无效");
    const confirmationPassword = requiredTrimmed(input.confirmationPassword, "财务入账需要当前登录密码确认");
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense finance record");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (!["partially_paid", "paid", "payment_blocked"].includes(request.status)) {
        throw new BadRequestException("项目支出实付后才能登记财务记录");
      }
      const existingRecords = await tx.financeRecord.findMany({
        where: { projectExpenseRequestId: request.id, direction: "outflow" },
        select: { amountCents: true }
      });
      const recordedCents = sumDbMoneyToBigInt(
        existingRecords.map((record) => record.amountCents),
        "财务入账金额"
      );
      const paidAmountCents = dbMoneyToBigInt(request.paidAmountCents, "项目支出实付金额");
      const financeAmountCents = dbMoneyToBigInt(amountCents, "财务记录金额");
      const remaining = paidAmountCents - recordedCents;
      if (financeAmountCents > remaining) {
        throw new BadRequestException(`财务记录金额超过未入账实付金额: ${remaining.toString()}`);
      }
      const record = await tx.financeRecord.create({
        data: {
          projectId,
          projectExpenseRequestId: request.id,
          direction: "outflow",
          amountCents,
          occurredAt,
          createdByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.finance.record",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: {
          projectId,
          financeRecordId: record.id,
          amountCents: moneyCentsToApi(amountCents)
        }
      });
      return {
        record,
        expenseRequestId: request.id,
        financeRecordedAmountCents: recordedCents + financeAmountCents,
        paidAmountCents
      };
    });
    if (result.financeRecordedAmountCents >= result.paidAmountCents && this.files) {
      await this.ensureFinancePdfArchive(result.expenseRequestId, actorUserId).catch(() => undefined);
    }
    return projectExpensePostResponseToApi(result.record);
  }

  async confirmPurchaseReceipt(
    projectId: string,
    expenseRequestId: string,
    actorUserId: string,
    input: ConfirmProjectExpenseReceiptDto
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "收货确认需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm project expense purchase receipt");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockExpenseRequest(tx, projectId, expenseRequestId);
      if (!request) {
        throw new NotFoundException("项目支出申请不存在");
      }
      if (request.expenseType !== "spot_purchase") {
        throw new BadRequestException("只有零星采购申请可以确认收货");
      }
      if (request.applicantUserId !== actorUserId) {
        throw new BadRequestException("只有零星采购发起人可以确认收货");
      }
      if (!request.purchaseExecutedAt) {
        throw new BadRequestException("零星采购执行后才能确认收货");
      }
      if (request.receiptConfirmedAt) {
        throw new BadRequestException("零星采购已确认收货");
      }
      if (request.status !== "paid") {
        throw new BadRequestException("零星采购实付完成后才能确认收货");
      }
      const financeRecords = await tx.financeRecord.findMany({
        where: { projectExpenseRequestId: request.id, direction: "outflow" },
        select: { amountCents: true }
      });
      const financeRecordedAmountCents = sumDbMoneyToBigInt(
        financeRecords.map((record) => record.amountCents),
        "财务入账金额"
      );
      const paidAmountCents = dbMoneyToBigInt(request.paidAmountCents, "项目支出实付金额");
      if (paidAmountCents <= 0n || financeRecordedAmountCents < paidAmountCents) {
        throw new BadRequestException("零星采购财务入账完成后才能确认收货");
      }

      const confirmedAt = new Date();
      const updated = await tx.projectExpenseRequest.update({
        where: { id: request.id },
        data: {
          receiptConfirmedByUserId: actorUserId,
          receiptConfirmedAt: confirmedAt,
          receiptConfirmationNote: trimmedOrNull(input.note)
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_expense.receipt.confirm",
        businessType: "project_expense_request",
        businessId: request.id,
        metadata: {
          projectId,
          confirmedAt: confirmedAt.toISOString(),
          financeRecordedAmountCents: financeRecordedAmountCents.toString()
        }
      });
      return updated;
    });
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
    const activeFinancingCents = usageTotals.occupied + usageTotals.used;
    const amountToRelease =
      activeFinancingCents > targetFinancingCents ? activeFinancingCents - targetFinancingCents : 0n;
    if (amountToRelease === 0n) {
      return;
    }
    const releasedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      request.id,
      amountToRelease,
      "released"
    );
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

  private async lockExpenseRequestForExecution(
    tx: Prisma.TransactionClient,
    projectId: string,
    expenseRequestId: string
  ): Promise<ExpenseLockRow | null> {
    return this.lockExpenseRequest(tx, projectId, expenseRequestId);
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
        "receiptConfirmedAt"
      FROM "ProjectExpenseRequest"
      WHERE "projectId" = ${projectId} AND ("id" = ${expenseRequestId} OR "code" = ${expenseRequestId})
      LIMIT 1
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
        "applicantUserId"
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
