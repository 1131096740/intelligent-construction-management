import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import {
  Prisma,
  type ApprovalInstance,
  type FileObject,
  type Project,
  type SpotProcurement,
  type SpotProcurementDiscrepancy,
  type SpotProcurementLine,
  type SpotProcurementPayment,
  type SpotProcurementPaymentArchive,
  type SpotProcurementPaymentArchiveFile,
  type SpotProcurementPaymentChannel,
  type SpotProcurementPaymentExecution,
  type SpotProcurementReceipt,
  type SpotProcurementRefund,
  type SpotProcurementVersion
} from "@prisma/client";
import {
  GLOBAL_BUSINESS_ROLE_KEYS,
  SPOT_PROCUREMENT_PAYMENT_STATUSES,
  SPOT_PROCUREMENT_STATUSES,
  resolveEffectiveRoleKeys,
  type DetailActionReadModel,
  type RoleKey
} from "@jiangkong/shared-domain";
import {
  approvalReviewAccessOnFrozenNode,
  pendingRoleKeysForFrozenApprovalNode
} from "../approval/approval-node-access";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import {
  detailAction,
  disabledActionReasons,
  primaryActionKey
} from "../core-flow/detail-actions";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { InvoiceLedgerService } from "../invoice-ledger/invoice-ledger.service";
import { SpotProcurementAccessService } from "./spot-procurement-access.service";
import { SpotProcurementInvoiceService } from "./spot-procurement-invoice.service";
import { SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY } from "./spot-procurement-form-renderer";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { isSpotPaymentPayerTaskComplete } from "./spot-payment-payer-task";
import { spotPaymentRefundOwnerId } from "./spot-payment-refund-owner";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const LIST_LIMIT = 200;
const LIST_SCAN_BATCH_SIZE = 200;
const LIST_SCAN_MAX_ROWS = 2_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const PAYMENT_TASK_SORT_AT = Symbol("paymentTaskSortAt");
const PAYMENT_AMOUNT_FACTS = Symbol("paymentAmountFacts");
const RESOURCE_FORBIDDEN_MESSAGE = "零星采购资源不存在或当前账号无权访问";
const PROCUREMENT_CREATE_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const PROCUREMENT_VOID_ROLES = new Set<RoleKey>([
  "project_manager",
  "finance_director"
]);
const ACTIVE_PAYMENT_STATUSES = new Set([
  "approval_pending",
  "approved",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);
const TERMINAL_PAYMENT_STATUSES = new Set([
  "invalidated",
  "voided",
  "withdrawn",
  "rejected",
  "returned"
]);
const PAYMENT_VOIDABLE_STATUSES = new Set([
  "draft",
  "approval_pending",
  "approved_pending_payment"
]);
const PAYMENT_EXECUTABLE_STATUSES = new Set([
  "approved_pending_payment",
  "partially_paid"
]);
const ROLE_LABELS: Record<string, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务人员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工"
};
const PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  approval_pending: "采购审批中",
  approved_in_progress: "采购已批，办理中",
  closed: "已办结",
  abnormally_terminated: "异常终止",
  voided: "已撤销",
  abandoned: "已放弃"
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  draft: "付款草稿",
  approval_pending: "付款审批中",
  approved: "审批已通过",
  approved_pending_payment: "已批待付",
  partially_paid: "部分已付",
  paid: "公司付款已付",
  settled: "已结清",
  returned: "已退回",
  rejected: "已驳回",
  withdrawn: "已撤回",
  voided: "已作废",
  invalidated: "已失效"
};

export interface SpotProcurementListQuery {
  projectId?: string;
  status?: string;
  keyword?: string;
  page?: string | number;
  pageSize?: string | number;
  view?: string;
  surface?: string;
}

export interface SpotProcurementPaymentListQuery {
  projectId?: string;
  status?: string;
  keyword?: string;
  view?: string;
}

export const SPOT_PAYMENT_WORKBENCH_VIEWS = ["mine", "all", "closed"] as const;
export type SpotPaymentWorkbenchView =
  (typeof SPOT_PAYMENT_WORKBENCH_VIEWS)[number];
export type SpotPaymentCurrentTask = {
  key: string;
  label: string;
  hint: string;
  priority: 400 | 300 | 200 | 0;
  scope: "personal" | "shared" | "none";
  enabled: boolean;
  disabledReason: string | null;
};
export type SpotPaymentListAmountSummary = {
  approvalAmountCents: string;
  actualPaidAmountCents: string;
  refundAmountCents: string;
  netPaidAmountCents: string;
  complete: boolean;
};

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
}

export interface UserSummary {
  id: string;
  name: string;
}

type UserNameRow = {
  id: string;
  name: string;
};

export interface ApprovalSummary {
  status: string;
  statusLabel: string;
  currentNodeName: string;
  currentRoleKeys: RoleKey[];
}

const NO_SPOT_PAYMENT_TASK: SpotPaymentCurrentTask = {
  key: "none",
  label: "无需办理",
  hint: "当前付款无需您办理",
  priority: 0,
  scope: "none",
  enabled: false,
  disabledReason: null
};

export function deriveSpotPaymentCurrentTask(input: {
  payment: Pick<
    SpotProcurementPayment,
    | "status"
    | "handlerUserId"
    | "payerCompanyEntityId"
    | "payerCompanyNameSnapshot"
  >;
  approval: Pick<
    ApprovalInstance,
    "status" | "currentNodeIndex" | "frozenNodes" | "applicantUserId"
  > | null;
  discrepancy: Pick<
    SpotProcurementDiscrepancy,
    "status" | "resolutionType"
  > | null;
  actorUserId: string;
  roleKeys: readonly RoleKey[];
  projectScopedRoleKeys: readonly RoleKey[];
  paymentMethodCount: number;
  availableActions: Array<
    Pick<DetailActionReadModel, "key" | "label" | "enabled" | "disabledReason">
  >;
}): SpotPaymentCurrentTask {
  const action = (key: string) =>
    input.availableActions.find((candidate) => candidate.key === key);
  const projectFinance = input.projectScopedRoleKeys.includes("finance_staff");
  const executionAction = action("record_execution");
  const payerRoles = [
    "finance_staff",
    "comprehensive_director",
    "finance_director"
  ] as const;
  const pendingApprovalRoleKeys = input.approval
    ? pendingRoleKeysForFrozenApprovalNode(
        input.approval.frozenNodes,
        input.approval.currentNodeIndex
      )
    : [];
  const canCompletePayerAtCurrentStage =
    input.payment.status === "draft" ||
    (input.payment.status === "approval_pending" &&
      input.approval?.status === "approval_pending" &&
      (input.approval.currentNodeIndex === 0 ||
        (input.roleKeys.includes("finance_director") &&
          pendingApprovalRoleKeys.includes("finance_director"))));
  const payerTaskComplete = isSpotPaymentPayerTaskComplete(
    input.payment,
    input.paymentMethodCount
  );

  if (
    projectFinance &&
    input.discrepancy?.status === "awaiting_refund" &&
    input.discrepancy.resolutionType === "full_refund"
  ) {
    return {
      key: "record_refund",
      label: "登记供应商退款",
      hint: "收货差异已确认整笔退款，等待项目财务登记到账",
      priority: 400,
      scope: "personal",
      enabled: true,
      disabledReason: null
    };
  }
  if (
    projectFinance &&
    executionAction?.enabled === false &&
    executionAction.disabledReason?.includes("凭证")
  ) {
    return {
      key: "view_only",
      label: "核对付款凭证异常",
      hint: executionAction.disabledReason,
      priority: 400,
      scope: "personal",
      enabled: true,
      disabledReason: null
    };
  }
  if (
    input.payment.status === "draft" &&
    input.payment.handlerUserId === input.actorUserId &&
    input.roleKeys.includes("material_staff") &&
    action("edit_draft")?.enabled
  ) {
    return {
      key: "complete_payment_draft",
      label: "完善付款草稿",
      hint: "补齐付款构成、收款信息与支撑附件后提交审批",
      priority: 300,
      scope: "personal",
      enabled: true,
      disabledReason: null
    };
  }
  if (
    canCompletePayerAtCurrentStage &&
    !payerTaskComplete &&
    input.roleKeys.some((role) =>
      payerRoles.includes(role as (typeof payerRoles)[number])
    )
  ) {
    return {
      key: "complete_payer",
      label: "补充付款主体与方式",
      hint: "付款主体或付款方式未补齐，等待有权岗位共享补录",
      priority: 200,
      scope: "shared",
      enabled: true,
      disabledReason: null
    };
  }
  if (
    input.approval?.status === "approval_pending" &&
    action("review_approval")?.enabled
  ) {
    return {
      key: "review_payment",
      label: "处理付款审批",
      hint: "当前冻结审批节点等待您处理",
      priority: 300,
      scope: "personal",
      enabled: true,
      disabledReason: null
    };
  }
  if (
    projectFinance &&
    PAYMENT_EXECUTABLE_STATUSES.has(input.payment.status) &&
    executionAction?.enabled
  ) {
    return {
      key: "record_execution",
      label: "登记公司实际付款",
      hint: "当前付款已批，等待项目财务登记实付与凭证",
      priority: 300,
      scope: "personal",
      enabled: true,
      disabledReason: null
    };
  }
  if (input.roleKeys.includes("material_director")) {
    return {
      ...NO_SPOT_PAYMENT_TASK,
      hint: "当前无需办理付款；后续需复核收货"
    };
  }
  return { ...NO_SPOT_PAYMENT_TASK };
}

@Injectable()
export class SpotProcurementReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectVisibility: ProjectVisibilityService,
    private readonly access: SpotProcurementAccessService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly invoiceLedger?: InvoiceLedgerService,
    private readonly paymentInvoices?: SpotProcurementInvoiceService
  ) {}

  async capabilities(actorUserId: string, projectId: string) {
    const normalizedProjectId = requiredQueryText(projectId, "请选择采购项目");
    const visibleProjectIds =
      await this.projectVisibility.visibleProjectIds(actorUserId);
    if (!visibleProjectIds.includes(normalizedProjectId)) {
      throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    }
    const project = await this.prisma.project.findFirst({
      where: { id: normalizedProjectId, isActive: true },
      select: { id: true }
    });
    if (!project) {
      throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    }

    const roleKeys = await this.projectVisibility.effectiveRoleKeys(
      actorUserId,
      normalizedProjectId
    );
    const enabled = this.pilot.isEnabled(normalizedProjectId);
    const canCreate =
      enabled && roleKeys.some((role) => PROCUREMENT_CREATE_ROLES.has(role));
    const canExecutePayment =
      enabled &&
      roleKeys.includes("finance_staff") &&
      (await this.hasProjectScopedRole(
        actorUserId,
        normalizedProjectId,
        "finance_staff"
      ));
    const unavailableReason = !enabled
      ? "零星采购未对当前项目开放"
      : !canCreate
        ? "当前账号不是本项目物资员或物资主管"
        : null;
    const handlerOptions =
      enabled && canCreate
        ? await this.eligibleHandlerOptions(normalizedProjectId)
        : [];

    return {
      projectId: normalizedProjectId,
      enabled,
      canCreate,
      canExecutePayment,
      unavailableReason,
      handlerOptions
    };
  }

  async createProjectOptions(actorUserId: string): Promise<ProjectSummary[]> {
    const visibleProjectIds =
      await this.projectVisibility.visibleProjectIds(actorUserId);
    if (!visibleProjectIds.length) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: visibleProjectIds }, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
    const options = await Promise.all(
      projects.map(async (project) => ({
        project,
        roleKeys: await this.projectVisibility.effectiveRoleKeys(
          actorUserId,
          project.id
        )
      }))
    );

    return options
      .filter(
        ({ project, roleKeys }) =>
          this.pilot.isEnabled(project.id) &&
          roleKeys.some((role) => PROCUREMENT_CREATE_ROLES.has(role))
      )
      .map(({ project }) => project);
  }

  async listProcurements(
    actorUserId: string,
    query: SpotProcurementListQuery
  ) {
    const projectIds = await this.visibleProjectIdsForQuery(
      actorUserId,
      query.projectId
    );
    const pagination = listPagination(query.page, query.pageSize);
    const view = lifecycleView(query.view);
    const surface = query.surface === "receipt" ? "receipt" : "procurement";
    if (!projectIds.length) return emptyPagedList(pagination, view);
    const status = optionalQueryText(query.status);
    if (
      status &&
      !SPOT_PROCUREMENT_STATUSES.includes(
        status as (typeof SPOT_PROCUREMENT_STATUSES)[number]
      )
    ) {
      throw new BadRequestException("零星采购状态筛选值不正确");
    }
    const keyword = optionalQueryText(query.keyword);
    const keywordMatch = keyword
      ? await this.procurementIdsMatchingVersionKeyword(projectIds, keyword)
      : [];
    const where: Prisma.SpotProcurementWhereInput = {
      projectId: { in: projectIds },
      ...(keyword
        ? {
            OR: [
              { code: { contains: keyword, mode: "insensitive" } },
              {
                supplierNameSnapshot: {
                  contains: keyword,
                  mode: "insensitive"
                }
              },
              { id: { in: keywordMatch } }
            ]
          }
        : {})
    };
    const accessible = await this.scanAccessibleProcurements(where, actorUserId);
    const lifecycleRows = accessible.rows.filter((row) =>
      view === "ended" ? row.status === "abandoned" : row.status !== "abandoned"
    );
    const surfaceRows = surface === "receipt"
      ? lifecycleRows.filter((row) => ["approved_in_progress", "closed"].includes(row.status))
      : lifecycleRows;
    const filteredRows = status
      ? surfaceRows.filter((row) => row.status === status)
      : surfaceRows;
    const pageRows = filteredRows.slice(pagination.skip, pagination.skip + pagination.pageSize);
    const items = await this.procurementListItems(
      pageRows,
      actorUserId
    );

    return {
      items,
      view,
      surface,
      pagination: paginationResult(pagination, filteredRows.length),
      statistics: statusCounts(surfaceRows)
    };
  }

  async getProcurement(procurementId: string, actorUserId: string) {
    const procurement = await this.prisma.spotProcurement.findUnique({
      where: { id: procurementId }
    });
    if (
      !procurement ||
      (await this.access.resolveProcurementViewAccess(
        procurement.id,
        actorUserId
      )) !== "allowed"
    ) {
      throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    }
    if (!procurement.currentVersionId) {
      throw new ConflictException("零星采购缺少当前版本，请联系管理员核对");
    }

    const [
      project,
      versions,
      lines,
      attachments,
      allPayments,
      currentPdf,
      receipt,
      discrepancy,
      refunds
    ] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: procurement.projectId },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.spotProcurementVersion.findMany({
        where: { procurementId: procurement.id },
        orderBy: [{ versionNo: "desc" }, { id: "desc" }]
      }),
      this.prisma.spotProcurementLine.findMany({
        where: { versionId: procurement.currentVersionId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementAttachment.findMany({
        where: { versionId: procurement.currentVersionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementPayment.findMany({
        where: { procurementId: procurement.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      this.prisma.pdfDocument.findFirst({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: procurement.currentVersionId,
          templateKey: {
            in: [
              SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
              "approval_form"
            ]
          }
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.spotProcurementReceipt.findUnique({
        where: { procurementId: procurement.id },
        select: {
          id: true,
          status: true,
          currentRevisionNo: true,
          handlerUserId: true,
          firstSubmittedAt: true,
          submittedAt: true,
          lockedAt: true,
          invalidatedAt: true
        }
      }),
      this.prisma.spotProcurementDiscrepancy.findFirst({
        where: {
          procurementId: procurement.id,
          procurementVersionId: procurement.currentVersionId,
          invalidatedAt: null
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      this.prisma.spotProcurementRefund.findMany({
        where: { procurementId: procurement.id },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }]
      })
    ]);
    if (!project) {
      throw new ConflictException("零星采购所属项目不存在，请联系管理员核对");
    }
    const currentVersion = versions.find(
      (version) => version.id === procurement.currentVersionId
    );
    if (!currentVersion) {
      throw new ConflictException("零星采购当前版本不存在，请联系管理员核对");
    }

    const receiptWorkflowFacts = receipt
      ? await this.receiptWorkflowFacts(
          receipt.id,
          receipt.currentRevisionNo
        )
      : null;

    const [approvalInstances, accessiblePaymentIds] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: { in: versions.map((version) => version.id) }
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      }),
      this.access.accessiblePaymentIds(
        allPayments.map((payment) => payment.id),
        actorUserId
      )
    ]);
    const accessiblePayments = allPayments.filter((payment) =>
      accessiblePaymentIds.has(payment.id)
    );
    const accessiblePaymentIdSet = new Set(
      accessiblePayments.map((payment) => payment.id)
    );
    const accessibleRefunds = refunds.filter(
      (refund) =>
        refund.paymentId !== null && accessiblePaymentIdSet.has(refund.paymentId)
    );
    const executionPaymentIds = accessiblePayments.map((payment) => payment.id);
    const [executionHistory, reservations, paymentArchives] = executionPaymentIds.length
      ? await Promise.all([
          this.prisma.spotProcurementPaymentExecution.findMany({
            where: { paymentId: { in: executionPaymentIds } },
            orderBy: [{ paidAt: "asc" }, { id: "asc" }]
          }),
          this.prisma.supplierBalanceReservation.findMany({
            where: { paymentId: { in: executionPaymentIds } },
            orderBy: { paymentId: "asc" }
          }),
          this.prisma.spotProcurementPaymentArchive.findMany({
            where: { paymentId: { in: executionPaymentIds } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          })
        ])
      : [[], [], []];
    const executions = executionHistory.filter(
      (execution) => execution.voidedAt === null
    );
    const fileIds = attachments.map((attachment) => attachment.fileId);
    const files = fileIds.length
      ? await this.prisma.fileObject.findMany({
          where: { id: { in: fileIds } }
        })
      : [];
    const userIds = new Set<string>([
      procurement.applicantUserId,
      procurement.handlerUserId,
      ...versions.map((version) => version.createdByUserId),
      ...attachments.map((attachment) => attachment.uploadedByUserId),
      ...accessiblePayments.map((payment) => payment.handlerUserId)
    ]);
    const users = await this.loadUsers([...userIds]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const fileById = new Map(files.map((file) => [file.id, file]));
    const approvalByBusinessId = latestApprovalByBusinessId(
      approvalInstances,
      SPOT_PROCUREMENT_BUSINESS_TYPES.application
    );
    const currentApproval = approvalByBusinessId.get(currentVersion.id) ?? null;
    const roleKeys = await this.projectVisibility.effectiveRoleKeys(
      actorUserId,
      procurement.projectId
    );
    const paymentRows = (
      await this.paymentListItems(
        accessiblePayments,
        actorUserId,
        new Map([[project.id, project]]),
        new Map([[procurement.id, procurement]]),
        userById
      )
    ).map(stripPaymentInternalFacts);
    const actualPaidByPaymentId = sumActiveExecutionsByPaymentId(executions);
    const paymentSummary = summarizePayments(
      accessiblePayments,
      actualPaidByPaymentId
    );
    const realPaymentSummary = summarizeRealPaymentFacts(
      accessiblePayments,
      actualPaidByPaymentId,
      accessibleRefunds
    );
    const currentPaymentId = uniqueVisibleCurrentPaymentId(
      allPayments,
      accessiblePaymentIds
    );
    const usesRealProcurementForm = isRealProcurementForm(currentVersion);
    const currentApprovalTimeline = await approvalTimelineForBusiness(
      this.prisma,
      SPOT_PROCUREMENT_BUSINESS_TYPES.application,
      currentVersion.id
    );
    const availableActions = this.procurementActions({
      procurement,
      currentVersion,
      currentApproval,
      roleKeys,
      actorUserId,
      activePayments: allPayments.filter((payment) =>
        ACTIVE_PAYMENT_STATUSES.has(payment.status)
      ),
      allPayments,
      executions,
      executionHistory,
      paymentSummary,
      currentPdfExists: Boolean(currentPdf),
      versions,
      approvalInstances,
      receipt,
      discrepancy,
      refunds,
      reservations,
      paymentArchives
    });
    const invoiceCoverageByProcurementId =
      !usesRealProcurementForm && this.invoiceLedger
      ? await this.invoiceLedger.coverageForProcurementIds([
          procurement.id
        ])
      : new Map();
    const invoiceCoverage =
      invoiceCoverageByProcurementId.get(procurement.id) ??
      invoiceCoverageUnavailable();
    const invoiceLedgerDetail =
      !usesRealProcurementForm && this.invoiceLedger
      ? await this.invoiceLedger.detailForProcurement(
          procurement.id
        )
      : invoiceLedgerDetailUnavailable();

    const realReceipt = usesRealProcurementForm
      ? receiptReadSummary(
          receipt,
          discrepancy,
          executions.some((execution) => execution.voidedAt === null),
          receiptWorkflowFacts
            ? {
                ...receiptWorkflowFacts,
                actorUserId,
                refundCount: refunds.length
              }
            : undefined
        )
      : futureUnavailable();

    return {
      procurement: {
        id: procurement.id,
        code: procurement.code,
        project: projectSummary(project),
        applicant: userSummary(
          procurement.applicantUserId,
          userById,
          "采购申请人未读取"
        ),
        handler: userSummary(
          procurement.handlerUserId,
          userById,
          "采购经办人未读取"
        ),
        status: procurement.status,
        statusLabel: procurementStatusLabel(procurement.status),
        closedAt: isoOrNull(procurement.closedAt),
        voidedAt: isoOrNull(procurement.voidedAt),
        voidReason: procurement.voidReason,
        abandonedAt: isoOrNull(procurement.abandonedAt),
        abandonReason: procurement.abandonReason,
        createdAt: procurement.createdAt.toISOString(),
        updatedAt: procurement.updatedAt.toISOString(),
        ...(usesRealProcurementForm
          ? {
              form: "real_application",
              payment: {
                paymentId: currentPaymentId,
                ...realPaymentSummary
              }
            }
          : {
              form: "legacy",
              supplierPartyId: procurement.supplierPartyId,
              supplierName: procurement.supplierNameSnapshot,
              approvedAmountCents: moneyText(procurement.approvedAmountCents),
              actualCostCents: null,
              actualCost: futureUnavailable()
            })
      },
      currentVersion: versionReadModel(currentVersion, usesRealProcurementForm),
      versions: versions.map((version) =>
        versionReadModel(version, isRealProcurementForm(version))
      ),
      lines: lines.map((line) => lineReadModel(line, usesRealProcurementForm)),
      attachments: attachments.flatMap((attachment) => {
        const file = fileById.get(attachment.fileId);
        if (!file) return [];
        return [
          evidenceFileReadModel(
            file,
            userById,
            attachment.category,
            attachment.id,
            true
          )
        ];
      }),
      approval: approvalSummary(currentApproval),
      approvalTimeline: currentApprovalTimeline,
      payments: paymentRows,
      paymentSummary: usesRealProcurementForm
        ? {
            paymentId: currentPaymentId,
            ...realPaymentSummary,
            visibilityRestricted:
              accessiblePayments.length !== allPayments.length
          }
        : {
            ...paymentSummary,
            visibilityRestricted:
              accessiblePayments.length !== allPayments.length
          },
      receipt: realReceipt,
      ...(usesRealProcurementForm
        ? {
            discrepancy: discrepancyReadSummary(discrepancy, accessibleRefunds),
            invoice: await this.realProcurementInvoiceSummary(accessiblePayments)
          }
        : {
            invoiceComposition: invoiceComposition(lines),
            invoiceCoverage,
            invoiceLedger: invoiceLedgerDetail,
            discrepancy: futureUnavailable()
          }),
      applicationPdf: {
        available: currentApproval?.status === "approved",
        generated: Boolean(currentPdf),
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
        businessId: currentVersion.id,
        disabledReason:
          currentApproval?.status === "approved"
            ? null
            : "采购审批完成后才可下载正式审批单"
      },
      availableActions,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: [
        ...disabledActionReasons(availableActions),
        ...(usesRealProcurementForm
          ? []
          : ["收货确认、收货差异和发票覆盖将在代码阶段 B 开放"])
      ]
    };
  }

  private async receiptWorkflowFacts(
    receiptId: string,
    currentRevisionNo: number
  ) {
    const [
      revision,
      activeDelegation,
      review,
      pdfDocument,
      line,
      photo,
      invoiceAllocation,
      noInvoiceConfirmation,
      invoiceException
    ] = await Promise.all([
      this.prisma.spotProcurementReceiptRevision.findUnique({
        where: {
          receiptId_revisionNo: {
            receiptId,
            revisionNo: currentRevisionNo
          }
        },
        select: {
          submittedAt: true,
          note: true,
          actualCostCents: true
        }
      }),
      this.prisma.spotProcurementReceiptDelegation.findFirst({
        where: { receiptId, revokedAt: null },
        orderBy: [{ delegatedAt: "desc" }, { id: "desc" }],
        select: {
          delegatorUserId: true,
          delegateUserId: true,
          scope: true
        }
      }),
      this.prisma.spotProcurementReceiptReview.findFirst({
        where: { receiptId },
        orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
        select: { id: true }
      }),
      this.prisma.pdfDocument.findFirst({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: receiptId
        },
        select: { id: true }
      }),
      this.prisma.spotProcurementReceiptLine.findFirst({
        where: {
          receiptId,
          receiptRevisionNo: currentRevisionNo
        },
        select: { id: true }
      }),
      this.prisma.spotProcurementReceiptPhoto.findFirst({
        where: {
          receiptId,
          receiptRevisionNo: currentRevisionNo
        },
        select: { id: true }
      }),
      this.prisma.invoiceAllocation.findFirst({
        where: { receiptId },
        select: { id: true }
      }),
      this.prisma.noInvoiceConfirmation.findFirst({
        where: { receiptId },
        select: { id: true }
      }),
      this.prisma.invoiceExceptionConfirmation.findFirst({
        where: { receiptId },
        select: { id: true }
      })
    ]);
    return {
      currentRevisionSubmittedAt: revision?.submittedAt ?? null,
      activeDelegation,
      hasReview: Boolean(review),
      hasPdf: Boolean(pdfDocument),
      hasInvoiceFact: Boolean(
        invoiceAllocation ||
          noInvoiceConfirmation ||
          invoiceException
      ),
      hasDraftContent: Boolean(
        line ||
          photo ||
          revision?.note ||
          (revision?.actualCostCents ?? 0n) !== 0n
      )
    };
  }

  async listPayments(
    actorUserId: string,
    query: SpotProcurementPaymentListQuery
  ) {
    const view = paymentWorkbenchView(query.view);
    const projectIds = await this.visibleProjectIdsForQuery(
      actorUserId,
      query.projectId
    );
    if (!projectIds.length) {
      return {
        view,
        items: [],
        viewCounts: { mine: 0, all: 0, closed: 0 },
        amountSummary: null,
        truncated: false,
        limit: LIST_LIMIT
      };
    }
    const status = optionalQueryText(query.status);
    if (
      status &&
      !SPOT_PROCUREMENT_PAYMENT_STATUSES.includes(
        status as (typeof SPOT_PROCUREMENT_PAYMENT_STATUSES)[number]
      )
    ) {
      throw new BadRequestException("零星采购付款状态筛选值不正确");
    }
    const keyword = optionalQueryText(query.keyword);
    const matchingProcurements = keyword
      ? await this.prisma.spotProcurement.findMany({
          where: {
            projectId: { in: projectIds },
            OR: [
              { code: { contains: keyword, mode: "insensitive" } },
              {
                supplierNameSnapshot: {
                  contains: keyword,
                  mode: "insensitive"
                }
              }
            ]
          },
          select: { id: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: LIST_SCAN_MAX_ROWS + 1
        })
      : [];
    const keywordSourceTruncated =
      matchingProcurements.length > LIST_SCAN_MAX_ROWS;
    const matchingProcurementIds = matchingProcurements
      .slice(0, LIST_SCAN_MAX_ROWS)
      .map((row) => row.id);
    const where: Prisma.SpotProcurementPaymentWhereInput = {
      projectId: { in: projectIds },
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { code: { contains: keyword, mode: "insensitive" } },
              {
                payeeNameSnapshot: {
                  contains: keyword,
                  mode: "insensitive"
                }
              },
              {
                merchantNameSnapshot: {
                  contains: keyword,
                  mode: "insensitive"
                }
              },
              {
                procurementId: {
                  in: matchingProcurementIds
                }
              }
            ]
          }
        : {})
    };
    const scan = await this.scanAccessiblePayments(where, actorUserId);
    const roleContextByProjectId = await this.paymentRoleContexts(
      actorUserId,
      projectIds
    );
    const projected = await this.paymentListItems(
      scan.rows,
      actorUserId,
      undefined,
      undefined,
      undefined,
      roleContextByProjectId
    );
    const mine = projected.filter(
      (item) => item.currentTask.enabled && item.currentTask.scope !== "none"
    );
    const closed = projected.filter((item) =>
      ["settled", "voided", "invalidated"].includes(item.status)
    );
    const selected = view === "mine" ? mine : view === "closed" ? closed : projected;
    selected.sort(comparePaymentWorkbenchItems);
    const sourceTruncated = keywordSourceTruncated || scan.sourceTruncated;
    const truncated = sourceTruncated || selected.length > LIST_LIMIT;
    const amountSummary =
      view === "all" &&
      [...roleContextByProjectId.values()].some((context) =>
        context.effectiveRoleKeys.some((role) =>
          ["finance_staff", "finance_director"].includes(role)
        )
      )
        ? paymentAmountSummary(projected, !sourceTruncated)
        : null;
    const items = selected.slice(0, LIST_LIMIT).map(stripPaymentInternalFacts);

    return {
      view,
      items,
      viewCounts: {
        mine: mine.length,
        all: projected.length,
        closed: closed.length
      },
      amountSummary,
      truncated,
      limit: LIST_LIMIT
    };
  }

  async getPayment(paymentId: string, actorUserId: string) {
    const payment = await this.prisma.spotProcurementPayment.findUnique({
      where: { id: paymentId }
    });
    if (
      !payment ||
      (await this.access.resolvePaymentViewAccess(payment.id, actorUserId)) !==
        "allowed"
    ) {
      throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    }

    const [
      procurement,
      version,
      project,
      executions,
      reservations,
      approval,
      paymentLines,
      procurementMaterials,
      paymentChannels,
      paymentMethods,
      paymentAttachments,
      receipt,
      discrepancy,
      refundDiscrepancies,
      refundOwnerCandidates,
      refunds,
      approvalOriginal,
      archives
    ] = await Promise.all([
      this.prisma.spotProcurement.findUnique({
        where: { id: payment.procurementId }
      }),
      this.prisma.spotProcurementVersion.findUnique({
        where: { id: payment.procurementVersionId }
      }),
      this.prisma.project.findFirst({
        where: { id: payment.projectId },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.spotProcurementPaymentExecution.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }]
      }),
      this.prisma.supplierBalanceReservation.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      this.prisma.approvalInstance.findFirst({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id
        },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.spotProcurementPaymentLine.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementLine.findMany({
        where: { versionId: payment.procurementVersionId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementPaymentChannel.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementPaymentMethodOption.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementPaymentAttachment.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      this.prisma.spotProcurementReceipt.findUnique({
        where: { procurementId: payment.procurementId },
        select: {
          id: true,
          status: true,
          currentRevisionNo: true,
          firstSubmittedAt: true,
          submittedAt: true,
          lockedAt: true
        }
      }),
      this.prisma.spotProcurementDiscrepancy.findFirst({
        where: {
          procurementId: payment.procurementId,
          procurementVersionId: payment.procurementVersionId,
          invalidatedAt: null
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      this.prisma.spotProcurementDiscrepancy.findMany({
        where: {
          procurementId: payment.procurementId,
          procurementVersionId: payment.procurementVersionId
        },
        select: {
          id: true,
          procurementId: true,
          procurementVersionId: true
        }
      }),
      this.prisma.spotProcurementPayment.findMany({
        where: {
          procurementId: payment.procurementId,
          procurementVersionId: payment.procurementVersionId
        },
        select: {
          id: true,
          procurementId: true,
          procurementVersionId: true,
          status: true,
          createdAt: true
        }
      }),
      this.prisma.spotProcurementRefund.findMany({
        where: {
          procurementId: payment.procurementId,
          OR: [{ paymentId: payment.id }, { paymentId: null }]
        },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }]
      }),
      this.prisma.pdfDocument.findFirst({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          templateKey: {
            in: [
              SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
              "approval_form"
            ]
          }
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.spotProcurementPaymentArchive.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ versionNo: "desc" }, { id: "desc" }]
      })
    ]);
    if (
      !procurement ||
      !version ||
      !project ||
      procurement.projectId !== payment.projectId ||
      version.procurementId !== payment.procurementId
    ) {
      throw new ConflictException("零星采购付款关联事实不完整，请联系管理员核对");
    }

    const executionVouchers = executions.length
      ? await this.prisma.spotProcurementPaymentExecutionVoucher.findMany({
          where: {
            paymentExecutionId: { in: executions.map((execution) => execution.id) }
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        })
      : [];

    const fileIds = [
      payment.supportingAttachmentFileId,
      payment.merchantPaymentProofFileId,
      ...executions.map((execution) => execution.voucherFileId),
      ...paymentAttachments.map((attachment) => attachment.fileId),
      ...executionVouchers.map((voucher) => voucher.fileId)
    ].filter((fileId): fileId is string => Boolean(fileId));
    const userIds = [
      payment.handlerUserId,
      payment.createdByUserId,
      procurement.applicantUserId,
      ...executions.flatMap((execution) => [
        execution.executedByUserId,
        execution.voidedByUserId
      ])
    ].filter((userId): userId is string => Boolean(userId));
    const [files, users, timeline, roleKeys] = await Promise.all([
      fileIds.length
        ? this.prisma.fileObject.findMany({
            where: { id: { in: [...new Set(fileIds)] } }
          })
        : Promise.resolve([]),
      this.loadUsers([...new Set(userIds)]),
      approvalTimelineForBusiness(
        this.prisma,
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        payment.id
      ),
      this.projectVisibility.effectiveRoleKeys(
        actorUserId,
        payment.projectId
      )
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const fileById = new Map(files.map((file) => [file.id, file]));
    const refundDiscrepancyById = new Map(
      refundDiscrepancies.map((refundDiscrepancy) => [
        refundDiscrepancy.id,
        refundDiscrepancy
      ])
    );
    const paymentRefunds = refunds.filter(
      (refund) =>
        refundOwnerPaymentId(
          refund,
          refundDiscrepancyById.get(refund.discrepancyId) ?? null,
          refundOwnerCandidates
        ) === payment.id
    );
    const taskDiscrepancy = paymentTaskDiscrepancy(
      payment,
      discrepancy,
      refundOwnerCandidates
    );
    const activeExecutions = executions.filter(
      (execution) => execution.voidedAt === null
    );
    const actualPaidAmountCents = activeExecutions.reduce(
      (total, execution) => total + execution.amountCents,
      0n
    );
    const activeVoucherFileIds = new Set(
      files
        .filter((file) => file.storageStatus === "active")
        .map((file) => file.id)
    );
    const voucherFilesByExecutionId = groupBy(
      executionVouchers,
      (executionVoucher) => executionVoucher.paymentExecutionId
    );
    const voucher = voucherFact(
      activeExecutions,
      activeVoucherFileIds,
      voucherFilesByExecutionId
    );
    const effectiveCompanyPaymentAmountCents = nonNegative(
      payment.companyPaymentAmountCents -
        payment.canceledCompanyPaymentAmountCents
    );
    const remainingCompanyPaymentAmountCents = nonNegative(
      effectiveCompanyPaymentAmountCents - actualPaidAmountCents
    );
    const isProjectFinanceStaff =
      roleKeys.includes("finance_staff") &&
      (await this.hasProjectScopedRole(
        actorUserId,
        payment.projectId,
        "finance_staff"
      ));
    const availableActions = this.paymentActions({
      payment,
      approval,
      roleKeys,
      actorUserId,
      remainingCompanyPaymentAmountCents,
      isProjectFinanceStaff,
      paymentFactConsistent:
        payment.paidAmountCents === actualPaidAmountCents,
      voucherFactConsistent: voucher.status !== "anomaly"
    });
    const currentTask = deriveSpotPaymentCurrentTask({
      payment,
      approval,
      discrepancy: taskDiscrepancy,
      actorUserId,
      roleKeys,
      projectScopedRoleKeys: isProjectFinanceStaff
        ? ["finance_staff"]
        : [],
      paymentMethodCount: paymentMethods.length,
      availableActions
    });
    const usesRealPaymentForm = isRealPaymentForm(payment, version);
    const invoiceCoverageByPaymentId =
      !usesRealPaymentForm && this.invoiceLedger
        ? await this.invoiceLedger.coverageForPaymentIds([payment.id])
        : new Map();
    const invoiceCoverage =
      invoiceCoverageByPaymentId.get(payment.id) ??
      invoiceCoverageUnavailable();
    const invoiceLedgerDetail =
      !usesRealPaymentForm && this.invoiceLedger
        ? await this.invoiceLedger.detailForPayment(payment.id)
        : invoiceLedgerDetailUnavailable();
    const paymentInvoice =
      usesRealPaymentForm && this.paymentInvoices
        ? await this.paymentInvoices.summary(payment.id)
        : null;
    const materialIds = paymentLines.map((line) => line.procurementLineId);
    const materials = materialIds.length
      ? await this.prisma.spotProcurementLine.findMany({
          where: { id: { in: materialIds } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        })
      : [];
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const archiveFiles = archives.length
      ? await this.prisma.spotProcurementPaymentArchiveFile.findMany({
          where: { archiveId: { in: archives.map((archive) => archive.id) } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        })
      : [];
    const archiveFilesByArchiveId = groupBy(archiveFiles, (archiveFile) => archiveFile.archiveId);
    const realPaymentFacts = usesRealPaymentForm
      ? realPaymentFactReadModel(payment, actualPaidAmountCents, paymentRefunds)
      : null;
    const payerManagement = usesRealPaymentForm
      ? payerManagementReadModel({
          payment,
          approval,
          roleKeys,
          activeExecutionCount: activeExecutions.length
        })
      : null;

    return {
      payment: {
        id: payment.id,
        code: payment.code,
        status: payment.status,
        statusLabel: paymentStatusLabel(payment.status),
        project: projectSummary(project),
        procurement: {
          id: procurement.id,
          code: procurement.code
        },
        procurementVersionId: payment.procurementVersionId,
        handler: userSummary(
          payment.handlerUserId,
          userById,
          "采购经办人未读取"
        ),
        submittedAt: isoOrNull(payment.submittedAt),
        approvedAt: isoOrNull(payment.approvedAt),
        invalidatedAt: isoOrNull(payment.invalidatedAt),
        invalidatedReason: payment.invalidatedReason,
        draftOrigin: payment.draftOrigin ?? "legacy_unknown",
        sourcePaymentId: payment.sourcePaymentId,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        ...(usesRealPaymentForm
          ? {
              form: "real_payment",
              paymentType: payment.paymentType,
              paymentTypeLabel: paymentTypeLabel(payment.paymentType),
              merchantName: payment.merchantNameSnapshot,
              merchantPayeeMismatchNote: payment.merchantPayeeMismatchNote,
              payerCompanyName: payment.payerCompanyNameSnapshot,
              payee: {
                name: payment.payeeNameSnapshot,
                accountName: payment.payeeAccountNameSnapshot,
                primaryChannel: paymentChannels
                  .filter((channel) => channel.isPrimary)
                  .map(maskedPaymentChannelReadModel)
                  .at(0) ?? null
              },
              ...realPaymentFacts!,
              paymentFactConsistent:
                payment.paidAmountCents === actualPaidAmountCents,
              voucherStatus: voucher.status,
              voucherStatusLabel: voucher.label,
              payerManagement
            }
          : {
              form: "legacy",
              supplierName: procurement.supplierNameSnapshot,
              settlementAmountCents: moneyText(payment.settlementAmountCents),
              supplierBalanceAmountCents: moneyText(
                payment.supplierBalanceAmountCents
              ),
              companyPaymentAmountCents: moneyText(
                payment.companyPaymentAmountCents
              ),
              effectiveCompanyPaymentAmountCents: moneyText(
                effectiveCompanyPaymentAmountCents
              ),
              paidAmountCents: moneyText(actualPaidAmountCents),
              remainingCompanyPaymentAmountCents: moneyText(
                remainingCompanyPaymentAmountCents
              ),
              paymentFactConsistent:
                payment.paidAmountCents === actualPaidAmountCents,
              voucherStatus: voucher.status,
              voucherStatusLabel: voucher.label,
              executedSupplierBalanceAmountCents: moneyText(
                payment.executedSupplierBalanceAmountCents
              ),
              canceledAmountCents: moneyText(payment.canceledAmountCents),
              canceledCompanyPaymentAmountCents: moneyText(
                payment.canceledCompanyPaymentAmountCents
              ),
              canceledSupplierBalanceAmountCents: moneyText(
                payment.canceledSupplierBalanceAmountCents
              ),
              paymentPath: payment.paymentPath,
              paymentPathLabel: paymentPathLabel(payment.paymentPath),
              paymentMethod: payment.paymentMethod,
              paymentMethodLabel: paymentMethodLabel(payment.paymentMethod),
              payeeName: payment.payeeNameSnapshot,
              payeeAccountName: payment.payeeAccountNameSnapshot,
              payeeBankName: payment.payeeBankNameSnapshot,
              payeeBankAccountLast4: bankAccountLast4(
                payment.payeeBankAccountSnapshot
              ),
              expectedPaymentAt: isoOrNull(payment.expectedPaymentAt),
              paymentNote: payment.paymentNote,
              balanceOverrideReason: payment.balanceOverrideReason
            })
      },
      procurementVersion: versionReadModel(version, isRealProcurementForm(version)),
      approval: approvalSummary(approval),
      approvalTimeline: timeline,
      ...(usesRealPaymentForm
        ? {
            materials: paymentLines.map((line) => ({
              id: line.id,
              procurementLineId: line.procurementLineId,
              sortOrder: line.sortOrder,
              materialName:
                materialById.get(line.procurementLineId)?.materialName ?? "材料未读取",
              specification:
                materialById.get(line.procurementLineId)?.specification ?? null,
              unit: materialById.get(line.procurementLineId)?.unit ?? "—",
              approvedQuantity: line.approvedQuantitySnapshot.toString(),
              paymentQuantity: line.paymentQuantity.toString(),
              unitPrice: line.unitPrice.toString(),
              amountCents: moneyText(line.amountCents),
              expectedInvoiceCondition: line.expectedInvoiceCondition,
              vatRateOptionId: line.vatRateOptionId,
              vatRateValue: line.vatRateValueSnapshot?.toString() ?? null,
              vatRateLabel: line.vatRateLabelSnapshot
            })),
            procurementMaterials: procurementMaterials.map((line) => ({
              id: line.id,
              sortOrder: line.sortOrder,
              materialName: line.materialName,
              specification: line.specification,
              unit: line.unit,
              approvedQuantity: line.quantity.toString(),
              note: line.note
            })),
            paymentMethods: paymentMethods.map((method) => ({
              value: method.paymentMethod,
              label: paymentMethodLabel(method.paymentMethod)
            })),
            paymentChannels: paymentChannels.map(maskedPaymentChannelReadModel),
            receipt: receiptReadSummary(
              receipt,
              discrepancy,
              activeExecutions.length > 0
            ),
            discrepancy: discrepancyReadSummary(discrepancy, paymentRefunds),
            approvalOriginal: approvalOriginal
              ? {
                  documentId: approvalOriginal.id,
                  fileId: approvalOriginal.fileId,
                  templateKey: approvalOriginal.templateKey,
                  createdAt: approvalOriginal.createdAt.toISOString(),
                  immutable: true
                }
              : null,
            archives: archiveReadModels(archives, archiveFilesByArchiveId),
            archiveStatus: archiveStatusReadModel(
              payment,
              approvalOriginal,
              archives.at(0) ?? null
            )
          }
        : {
            composition: {
              settlementAmountCents: moneyText(payment.settlementAmountCents),
              supplierBalanceAmountCents: moneyText(
                payment.supplierBalanceAmountCents
              ),
              companyPaymentAmountCents: moneyText(
                payment.companyPaymentAmountCents
              )
            },
            companyPayment: {
        status: payment.status,
        statusLabel: companyPaymentStatusLabel(
          payment,
          actualPaidAmountCents
        ),
        approvedAmountCents: moneyText(
          effectiveCompanyPaymentAmountCents
        ),
        paidAmountCents: moneyText(actualPaidAmountCents),
        remainingAmountCents: moneyText(
          remainingCompanyPaymentAmountCents
        ),
        paymentFactConsistent:
          payment.paidAmountCents === actualPaidAmountCents,
        voucherStatus: voucher.status,
        voucherStatusLabel: voucher.label
            },
            balanceExecution: {
        requestedAmountCents: moneyText(
          payment.supplierBalanceAmountCents
        ),
        executedAmountCents: moneyText(
          payment.executedSupplierBalanceAmountCents
        ),
        reservationStatus: reservations[0]?.status ?? null
            }
          }),
      executions: executions.map((execution) => ({
        id: execution.id,
        amountCents: moneyText(execution.amountCents),
        paidAt: execution.paidAt.toISOString(),
        paymentMethod: execution.paymentMethod,
        paymentMethodLabel: paymentMethodLabel(execution.paymentMethod),
        executedBy: userSummary(
          execution.executedByUserId,
          userById,
          "付款登记人未读取"
        ),
        voucherFileId: execution.voucherFileId,
        voucherFileName:
          (execution.voucherFileId
            ? fileById.get(execution.voucherFileId)?.originalName
            : null) ?? "付款凭证未读取",
        voidedAt: isoOrNull(execution.voidedAt),
        voidReason: execution.voidReason,
        active: execution.voidedAt === null,
        vouchers: executionVouchers
          .filter((voucher) => voucher.paymentExecutionId === execution.id)
          .map((voucher) => ({
            id: voucher.id,
            fileId: voucher.fileId,
            sortOrder: voucher.sortOrder
          }))
      })),
      evidenceFiles: usesRealPaymentForm
        ? paymentAttachments.flatMap((attachment) => {
            const file = fileById.get(attachment.fileId);
            return file
              ? [
                  evidenceFileReadModel(
                    file,
                    userById,
                    attachment.category,
                    attachment.id,
                    true
                  )
                ]
              : [];
          })
        : this.paymentEvidenceFiles(
            payment,
            activeExecutions,
            fileById,
            userById
          ),
      ...(usesRealPaymentForm
        ? { invoice: paymentInvoice ?? realInvoiceSummaryUnavailable() }
        : {
            invoiceCoverage,
            invoiceLedger: invoiceLedgerDetail,
            paymentInvoice,
            receipt: futureUnavailable()
          }),
      paymentPdf: {
        available: approval?.status === "approved",
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        businessId: payment.id,
        disabledReason:
          approval?.status === "approved"
            ? null
            : "付款审批完成后才可下载正式审批单"
      },
      currentTask,
      availableActions,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: [
        ...disabledActionReasons(availableActions),
        ...(usesRealPaymentForm
          ? []
          : ["发票覆盖、无票确认和采购自动办结将在代码阶段 B 开放"])
      ]
    };
  }

  private async procurementIdsMatchingVersionKeyword(
    projectIds: string[],
    keyword: string
  ) {
    const versions = await this.prisma.spotProcurementVersion.findMany({
      where: {
        OR: [
          { reason: { contains: keyword, mode: "insensitive" } },
          { note: { contains: keyword, mode: "insensitive" } }
        ]
      },
      select: { procurementId: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    const candidateIds = [
      ...new Set(
        versions
          .map((version) => version.procurementId)
      )
    ];
    if (!candidateIds.length) {
      return [];
    }
    const procurements = await this.prisma.spotProcurement.findMany({
      where: {
        id: { in: candidateIds },
        projectId: { in: projectIds }
      },
      select: { id: true }
    });
    return procurements.map((procurement) => procurement.id);
  }

  private async visibleProjectIdsForQuery(
    actorUserId: string,
    requestedProjectId?: string
  ) {
    const visibleProjectIds =
      await this.projectVisibility.visibleProjectIds(actorUserId);
    const projectId = optionalQueryText(requestedProjectId);
    return projectId
      ? visibleProjectIds.filter((visibleId) => visibleId === projectId)
      : visibleProjectIds;
  }

  private async scanAccessibleProcurements(
    where: Prisma.SpotProcurementWhereInput,
    actorUserId: string
  ) {
    const accessible: SpotProcurement[] = [];
    let cursorId: string | undefined;
    let scannedRows = 0;
    let sourceTruncated = false;

    while (scannedRows < LIST_SCAN_MAX_ROWS) {
      const remainingRows = LIST_SCAN_MAX_ROWS - scannedRows;
      const take =
        remainingRows <= LIST_SCAN_BATCH_SIZE
          ? remainingRows + 1
          : LIST_SCAN_BATCH_SIZE;
      const batch = await this.prisma.spotProcurement.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (!batch.length) break;
      const scannedBatch = batch.slice(0, remainingRows);
      scannedRows += scannedBatch.length;
      const allowedIds = await this.access.accessibleProcurementIds(
        scannedBatch.map((row) => row.id),
        actorUserId
      );
      accessible.push(
        ...scannedBatch.filter((row) => allowedIds.has(row.id))
      );
      if (batch.length > remainingRows) {
        sourceTruncated = true;
        break;
      }
      if (batch.length < take) break;
      cursorId = scannedBatch.at(-1)?.id;
      if (!cursorId) break;
    }

    return {
      rows: accessible,
      sourceTruncated
    };
  }

  private async scanAccessiblePayments(
    where: Prisma.SpotProcurementPaymentWhereInput,
    actorUserId: string
  ) {
    const accessible: SpotProcurementPayment[] = [];
    let cursorId: string | undefined;
    let scannedRows = 0;
    let sourceTruncated = false;

    while (scannedRows < LIST_SCAN_MAX_ROWS) {
      const remainingRows = LIST_SCAN_MAX_ROWS - scannedRows;
      const take =
        remainingRows <= LIST_SCAN_BATCH_SIZE
          ? remainingRows + 1
          : LIST_SCAN_BATCH_SIZE;
      const batch = await this.prisma.spotProcurementPayment.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (!batch.length) break;
      const scannedBatch = batch.slice(0, remainingRows);
      scannedRows += scannedBatch.length;
      const allowedIds = await this.access.accessiblePaymentIds(
        scannedBatch.map((row) => row.id),
        actorUserId
      );
      accessible.push(
        ...scannedBatch.filter((row) => allowedIds.has(row.id))
      );
      if (batch.length > remainingRows) {
        sourceTruncated = true;
        break;
      }
      if (batch.length < take) break;
      cursorId = scannedBatch.at(-1)?.id;
      if (!cursorId) break;
    }

    return {
      rows: accessible,
      sourceTruncated
    };
  }

  private async procurementListItems(
    rows: SpotProcurement[],
    actorUserId: string
  ) {
    if (!rows.length) return [];
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const versionIds = rows
      .map((row) => row.currentVersionId)
      .filter((id): id is string => Boolean(id));
    const procurementIds = rows.map((row) => row.id);
    const [
      projects,
      versions,
      lines,
      payments,
      approvals,
      receipts,
      discrepancies,
      refunds
    ] =
      await Promise.all([
        this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, code: true, name: true }
        }),
        this.prisma.spotProcurementVersion.findMany({
          where: { id: { in: versionIds } }
        }),
        this.prisma.spotProcurementLine.findMany({
          where: { versionId: { in: versionIds } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        }),
        this.prisma.spotProcurementPayment.findMany({
          where: { procurementId: { in: procurementIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        }),
        versionIds.length
          ? this.prisma.approvalInstance.findMany({
              where: {
                businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
                businessId: { in: versionIds }
              },
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
            })
          : Promise.resolve([]),
        this.prisma.spotProcurementReceipt.findMany({
          where: { procurementId: { in: procurementIds } },
          select: {
            id: true,
            procurementId: true,
            status: true,
            currentRevisionNo: true,
            firstSubmittedAt: true,
            submittedAt: true,
            lockedAt: true
          }
        }),
        this.prisma.spotProcurementDiscrepancy.findMany({
          where: {
            procurementId: { in: procurementIds },
            invalidatedAt: null
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        }),
        this.prisma.spotProcurementRefund.findMany({
          where: { procurementId: { in: procurementIds } },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }]
        })
      ]);
    const [accessiblePaymentIds, activeExecutions] = await Promise.all([
      this.access.accessiblePaymentIds(
        payments.map((payment) => payment.id),
        actorUserId
      ),
      payments.length
        ? this.prisma.spotProcurementPaymentExecution.findMany({
            where: {
              paymentId: { in: payments.map((payment) => payment.id) },
              voidedAt: null
            }
          })
        : Promise.resolve([])
    ]);
    const actualPaidByPaymentId =
      sumActiveExecutionsByPaymentId(activeExecutions);
    const userIds = [
      ...new Set(
        rows.flatMap((row) => [row.applicantUserId, row.handlerUserId])
      )
    ];
    const users = await this.loadUsers(userIds);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const userById = new Map(users.map((user) => [user.id, user]));
    const approvalByBusinessId = latestApprovalByBusinessId(
      approvals,
      SPOT_PROCUREMENT_BUSINESS_TYPES.application
    );
    const linesByVersionId = groupBy(lines, (line) => line.versionId);
    const paymentsByProcurementId = groupBy(
      payments.filter((payment) => accessiblePaymentIds.has(payment.id)),
      (payment) => payment.procurementId
    );
    const allPaymentsByProcurementId = groupBy(
      payments,
      (payment) => payment.procurementId
    );
    const receiptByProcurementId = new Map(
      receipts.map((receipt) => [receipt.procurementId, receipt])
    );
    const discrepancyByProcurementId = new Map<string, (typeof discrepancies)[number]>();
    for (const discrepancy of discrepancies) {
      if (!discrepancyByProcurementId.has(discrepancy.procurementId)) {
        discrepancyByProcurementId.set(discrepancy.procurementId, discrepancy);
      }
    }
    const invoiceCoverageByProcurementId = this.invoiceLedger
      ? await this.invoiceLedger.coverageForProcurementIds(
          rows.map((row) => row.id)
        )
      : new Map();

    return rows.flatMap((row) => {
      const project = projectById.get(row.projectId);
      const version = row.currentVersionId
        ? versionById.get(row.currentVersionId)
        : undefined;
      if (!project || !version) return [];
      const rowLines = linesByVersionId.get(version.id) ?? [];
      const visiblePayments = paymentsByProcurementId.get(row.id) ?? [];
      const allRowPayments = allPaymentsByProcurementId.get(row.id) ?? [];
      const isRealApplication = isRealProcurementForm(version);
      const realPayment = summarizeRealPaymentFacts(
        visiblePayments,
        actualPaidByPaymentId,
        refunds.filter(
          (refund) =>
            refund.procurementId === row.id &&
            refund.paymentId !== null &&
            accessiblePaymentIds.has(refund.paymentId)
        )
      );
      const currentPaymentId = uniqueVisibleCurrentPaymentId(
        allRowPayments,
        accessiblePaymentIds
      );
      return [
        {
          id: row.id,
          code: row.code,
          project: projectSummary(project),
          reason: version.reason,
          applicant: userSummary(
            row.applicantUserId,
            userById,
            "采购申请人未读取"
          ),
          handler: userSummary(
            row.handlerUserId,
            userById,
            "采购经办人未读取"
          ),
          status: row.status,
          statusLabel: procurementStatusLabel(row.status),
          approval: approvalSummary(
            approvalByBusinessId.get(version.id) ?? null
          ),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          ...(isRealApplication
            ? {
                form: "real_application",
                applicationDepartment: version.applicationDepartmentSnapshot,
                applicationName: version.applicationNameSnapshot,
                purchaserName: version.purchaserNameSnapshot,
                purchaserDepartment: version.purchaserDepartmentNameSnapshot,
                requestedArrivalAt: version.requestedArrivalAt.toISOString(),
                payment: {
                  paymentId: currentPaymentId,
                  ...realPayment,
                  visibilityRestricted:
                    visiblePayments.length !== allRowPayments.length
                },
                receipt: receiptReadSummary(
                  receiptByProcurementId.get(row.id) ?? null,
                  discrepancyByProcurementId.get(row.id) ?? null,
                  visiblePayments.some(
                    (payment) =>
                      (actualPaidByPaymentId.get(payment.id) ?? 0n) > 0n
                  )
                )
              }
            : {
                form: "legacy",
                supplierPartyId: row.supplierPartyId,
                supplierName: row.supplierNameSnapshot,
                approvedAmountCents: moneyText(row.approvedAmountCents),
                currentTotalAmountCents: moneyText(version.totalAmountCents),
                actualCostCents: null,
                actualCost: futureUnavailable(),
                invoiceComposition: invoiceComposition(rowLines),
                payment: {
                  ...summarizePayments(visiblePayments, actualPaidByPaymentId),
                  visibilityRestricted:
                    visiblePayments.length !== allRowPayments.length
                },
                receipt: futureUnavailable(),
                invoiceCoverage:
                  invoiceCoverageByProcurementId.get(row.id) ??
                  invoiceCoverageUnavailable()
              })
        }
      ];
    });
  }

  private async paymentListItems(
    rows: SpotProcurementPayment[],
    actorUserId: string,
    suppliedProjects?: Map<string, ProjectSummary>,
    suppliedProcurements?: Map<string, SpotProcurement>,
    suppliedUsers?: Map<string, UserNameRow>,
    suppliedRoleContexts?: Map<
      string,
      { effectiveRoleKeys: RoleKey[]; projectScopedRoleKeys: RoleKey[] }
    >
  ) {
    if (!rows.length) return [];
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const procurementIds = [...new Set(rows.map((row) => row.procurementId))];
    const versionIds = [
      ...new Set(rows.map((row) => row.procurementVersionId))
    ];
    const [
      loadedProjects,
      loadedProcurements,
      loadedVersions,
      approvals,
      loadedUsers,
      activeExecutions,
      paymentLines,
      paymentMethods,
      paymentInvoices,
      receipts,
      refunds,
      discrepancies,
      refundOwnerCandidates,
      roleContextByProjectId
    ] =
      await Promise.all([
        suppliedProjects
          ? Promise.resolve([])
          : this.prisma.project.findMany({
              where: { id: { in: projectIds } },
              select: { id: true, code: true, name: true }
            }),
        suppliedProcurements
          ? Promise.resolve([])
          : this.prisma.spotProcurement.findMany({
              where: { id: { in: procurementIds } }
            }),
        this.prisma.spotProcurementVersion.findMany({
          where: { id: { in: versionIds } },
          select: { id: true, procurementId: true, totalAmountCents: true }
        }),
        this.prisma.approvalInstance.findMany({
          where: {
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: { in: rows.map((row) => row.id) }
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
        }),
        suppliedUsers
          ? Promise.resolve([])
          : this.loadUsers([
              ...new Set(rows.map((row) => row.handlerUserId))
            ]),
        this.prisma.spotProcurementPaymentExecution.findMany({
          where: {
            paymentId: { in: rows.map((row) => row.id) },
            voidedAt: null
          }
        }),
        this.prisma.spotProcurementPaymentLine.findMany({
          where: { paymentId: { in: rows.map((row) => row.id) } },
          select: { paymentId: true, expectedInvoiceCondition: true }
        }),
        this.prisma.spotProcurementPaymentMethodOption.findMany({
          where: { paymentId: { in: rows.map((row) => row.id) } },
          select: { paymentId: true }
        }),
        this.prisma.spotProcurementPaymentInvoice.findMany({
          where: { paymentId: { in: rows.map((row) => row.id) } },
          select: { paymentId: true, fileId: true, status: true }
        }),
        this.prisma.spotProcurementReceipt.findMany({
          where: { procurementId: { in: procurementIds } },
          select: {
            id: true,
            procurementId: true,
            status: true,
            currentRevisionNo: true,
            firstSubmittedAt: true,
            submittedAt: true,
            lockedAt: true
          }
        }),
        this.prisma.spotProcurementRefund.findMany({
          where: { procurementId: { in: procurementIds } },
          select: {
            discrepancyId: true,
            procurementId: true,
            paymentId: true,
            amountCents: true,
            receivedAt: true
          }
        }),
        this.prisma.spotProcurementDiscrepancy.findMany({
          where: {
            procurementVersionId: { in: versionIds }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        }),
        this.prisma.spotProcurementPayment.findMany({
          where: {
            procurementVersionId: { in: versionIds }
          },
          select: {
            id: true,
            procurementId: true,
            procurementVersionId: true,
            status: true,
            createdAt: true
          }
        }),
        suppliedRoleContexts
          ? Promise.resolve(suppliedRoleContexts)
          : this.paymentRoleContexts(actorUserId, projectIds)
      ]);
    const executionVouchers = activeExecutions.length
      ? await this.prisma.spotProcurementPaymentExecutionVoucher.findMany({
          where: {
            paymentExecutionId: {
              in: activeExecutions.map((execution) => execution.id)
            }
          },
          select: { paymentExecutionId: true, fileId: true }
        })
      : [];
    const projectById =
      suppliedProjects ??
      new Map(loadedProjects.map((project) => [project.id, project]));
    const procurementById =
      suppliedProcurements ??
      new Map(
        loadedProcurements.map((procurement) => [
          procurement.id,
          procurement
        ])
      );
    const versionById = new Map(
      loadedVersions.map((version) => [version.id, version])
    );
    const userById =
      suppliedUsers ??
      new Map(loadedUsers.map((user) => [user.id, user]));
    const approvalByBusinessId = latestApprovalByBusinessId(
      approvals,
      SPOT_PROCUREMENT_BUSINESS_TYPES.payment
    );
    const voucherFileIds = [
      ...new Set(
        [
          ...activeExecutions.flatMap((execution) =>
            execution.voucherFileId ? [execution.voucherFileId] : []
          ),
          ...executionVouchers.map((voucher) => voucher.fileId)
        ]
      )
    ];
    const voucherFiles = voucherFileIds.length
      ? await this.prisma.fileObject.findMany({
          where: { id: { in: voucherFileIds } },
          select: { id: true, storageStatus: true }
        })
      : [];
    const activeVoucherFileIds = new Set(
      voucherFiles
        .filter((file) => file.storageStatus === "active")
        .map((file) => file.id)
    );
    const voucherFilesByExecutionId = groupBy(
      executionVouchers,
      (executionVoucher) => executionVoucher.paymentExecutionId
    );
    const executionsByPaymentId = groupBy(
      activeExecutions,
      (execution) => execution.paymentId
    );
    const paymentLinesByPaymentId = groupBy(
      paymentLines,
      (line) => line.paymentId
    );
    const paymentMethodsByPaymentId = groupBy(
      paymentMethods,
      (method) => method.paymentId
    );
    const paymentInvoicesByPaymentId = groupBy(
      paymentInvoices,
      (invoice) => invoice.paymentId
    );
    const receiptByProcurementId = new Map(
      receipts.map((receipt) => [receipt.procurementId, receipt])
    );
    const discrepancyByCoordinate = new Map<
      string,
      (typeof discrepancies)[number]
    >();
    const discrepancyById = new Map(
      discrepancies.map((discrepancy) => [discrepancy.id, discrepancy])
    );
    for (const discrepancy of discrepancies) {
      const coordinate = procurementVersionCoordinate(
        discrepancy.procurementId,
        discrepancy.procurementVersionId
      );
      if (
        !discrepancy.invalidatedAt &&
        !discrepancyByCoordinate.has(coordinate)
      ) {
        discrepancyByCoordinate.set(coordinate, discrepancy);
      }
    }
    const paymentsByVersionCoordinate = groupBy(
      refundOwnerCandidates,
      (payment) =>
        procurementVersionCoordinate(
          payment.procurementId,
          payment.procurementVersionId
        )
    );
    const paymentIds = new Set(rows.map((payment) => payment.id));
    const refundsByPaymentId = new Map<
      string,
      Array<(typeof refunds)[number]>
    >();
    for (const refund of refunds) {
      const discrepancy = discrepancyById.get(refund.discrepancyId);
      const ownerPaymentId = refundOwnerPaymentId(
        refund,
        discrepancy ?? null,
        discrepancy
          ? paymentsByVersionCoordinate.get(
              procurementVersionCoordinate(
                discrepancy.procurementId,
                discrepancy.procurementVersionId
              )
            ) ?? []
          : []
      );
      if (!ownerPaymentId || !paymentIds.has(ownerPaymentId)) continue;
      const grouped = refundsByPaymentId.get(ownerPaymentId) ?? [];
      grouped.push(refund);
      refundsByPaymentId.set(ownerPaymentId, grouped);
    }
    const invoiceCoverageByPaymentId = this.invoiceLedger
      ? await this.invoiceLedger.coverageForPaymentIds(
          rows.map((row) => row.id)
        )
      : new Map();

    return rows.flatMap((row) => {
      const project = projectById.get(row.projectId);
      const procurement = procurementById.get(row.procurementId);
      const version = versionById.get(row.procurementVersionId);
      if (
        !project ||
        !procurement ||
        !version ||
        procurement.projectId !== row.projectId ||
        version.procurementId !== row.procurementId
      ) {
        throw new ConflictException(
          "零星采购付款关联事实不完整，请联系管理员核对"
        );
      }
      const effectiveCompany = nonNegative(
        row.companyPaymentAmountCents -
          row.canceledCompanyPaymentAmountCents
      );
      const rowExecutions = executionsByPaymentId.get(row.id) ?? [];
      const actualPaidAmountCents = rowExecutions.reduce(
        (total, execution) => total + execution.amountCents,
        0n
      );
      const voucher = voucherFact(
        rowExecutions,
        activeVoucherFileIds,
        voucherFilesByExecutionId
      );
      const rowRefunds = refundsByPaymentId.get(row.id) ?? [];
      const discrepancy =
        discrepancyByCoordinate.get(
          procurementVersionCoordinate(
            row.procurementId,
            row.procurementVersionId
          )
        ) ?? null;
      const taskDiscrepancy = paymentTaskDiscrepancy(
        row,
        discrepancy,
        paymentsByVersionCoordinate.get(
          procurementVersionCoordinate(
            row.procurementId,
            row.procurementVersionId
          )
        ) ?? []
      );
      const realPayment = isRealPaymentForm(row, version);
      const approval = approvalByBusinessId.get(row.id) ?? null;
      const roleContext = roleContextByProjectId.get(row.projectId) ?? {
        effectiveRoleKeys: [] as RoleKey[],
        projectScopedRoleKeys: [] as RoleKey[]
      };
      const remainingCompanyPaymentAmountCents = nonNegative(
        effectiveCompany - actualPaidAmountCents
      );
      const availableActions = this.paymentActions({
        payment: row,
        approval,
        roleKeys: roleContext.effectiveRoleKeys,
        actorUserId,
        remainingCompanyPaymentAmountCents,
        isProjectFinanceStaff:
          roleContext.projectScopedRoleKeys.includes("finance_staff"),
        paymentFactConsistent: row.paidAmountCents === actualPaidAmountCents,
        voucherFactConsistent: voucher.status !== "anomaly"
      });
      const currentTask = deriveSpotPaymentCurrentTask({
        payment: row,
        approval,
        discrepancy: taskDiscrepancy,
        actorUserId,
        roleKeys: roleContext.effectiveRoleKeys,
        projectScopedRoleKeys: roleContext.projectScopedRoleKeys,
        paymentMethodCount:
          paymentMethodsByPaymentId.get(row.id)?.length ?? 0,
        availableActions
      });
      return [
        {
          [PAYMENT_TASK_SORT_AT]: paymentTaskFactAt(
            row,
            approval,
            currentTask,
            taskDiscrepancy,
            voucher.status === "anomaly"
              ? earliestVoucherAnomalyAt(
                  rowExecutions,
                  activeVoucherFileIds,
                  voucherFilesByExecutionId
                )
              : null
          ),
          [PAYMENT_AMOUNT_FACTS]: {
            approvalAmountCents: row.approvalAmountCents,
            actualPaidAmountCents,
            refundAmountCents: rowRefunds.reduce(
              (total, refund) => total + refund.amountCents,
              0n
            )
          },
          id: row.id,
          code: row.code,
          procurement: {
            id: procurement.id,
            code: procurement.code
          },
          project: projectSummary(project),
          status: row.status,
          statusLabel: paymentStatusLabel(row.status),
          draftOrigin: row.draftOrigin ?? "legacy_unknown",
          sourcePaymentId: row.sourcePaymentId,
          companyPaymentStatusLabel: companyPaymentStatusLabel(
            row,
            actualPaidAmountCents
          ),
          approval: approvalSummary(approval),
          currentTask,
          handler: userSummary(
            row.handlerUserId,
            userById,
            "采购经办人未读取"
          ),
          voucherStatus: voucher.status,
          voucherStatusLabel: voucher.label,
          paymentFactConsistent:
            row.paidAmountCents === actualPaidAmountCents,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          ...(realPayment
            ? {
                form: "real_payment",
                paymentType: row.paymentType,
                paymentTypeLabel: paymentTypeLabel(row.paymentType),
                payerCompanyName: row.payerCompanyNameSnapshot,
                merchantName: row.merchantNameSnapshot,
                payee: {
                  name: row.payeeNameSnapshot,
                  accountName: row.payeeAccountNameSnapshot,
                  accountNumberLast4: bankAccountLast4(
                    row.payeeBankAccountSnapshot
                  )
                },
                ...realPaymentFactReadModel(
                  row,
                  actualPaidAmountCents,
                  rowRefunds
                ),
                receipt: receiptReadSummary(
                  receiptByProcurementId.get(row.procurementId) ?? null,
                  null,
                  rowExecutions.length > 0
                ),
                invoice: paymentInvoiceListSummary(
                  paymentLinesByPaymentId.get(row.id) ?? [],
                  paymentInvoicesByPaymentId.get(row.id) ?? []
                )
              }
            : {
                form: "legacy",
                supplierName: procurement.supplierNameSnapshot,
                paymentPath: row.paymentPath,
                paymentPathLabel: paymentPathLabel(row.paymentPath),
                payeeName: row.payeeNameSnapshot,
                settlementAmountCents: moneyText(row.settlementAmountCents),
                supplierBalanceAmountCents: moneyText(
                  row.supplierBalanceAmountCents
                ),
                companyPaymentAmountCents: moneyText(
                  row.companyPaymentAmountCents
                ),
                effectiveCompanyPaymentAmountCents: moneyText(effectiveCompany),
                paidAmountCents: moneyText(actualPaidAmountCents),
                remainingCompanyPaymentAmountCents: moneyText(
                  remainingCompanyPaymentAmountCents
                ),
                executedSupplierBalanceAmountCents: moneyText(
                  row.executedSupplierBalanceAmountCents
                ),
                canceledAmountCents: moneyText(row.canceledAmountCents),
                invoiceCoverage:
                  invoiceCoverageByPaymentId.get(row.id) ??
                  invoiceCoverageUnavailable()
              })
        }
      ];
    });
  }

  private procurementActions(input: {
    procurement: SpotProcurement;
    currentVersion: SpotProcurementVersion;
    currentApproval: ApprovalInstance | null;
    roleKeys: RoleKey[];
    actorUserId: string;
    activePayments: SpotProcurementPayment[];
    allPayments: SpotProcurementPayment[];
    executions: SpotProcurementPaymentExecution[];
    executionHistory: SpotProcurementPaymentExecution[];
    paymentSummary: ReturnType<typeof summarizePayments>;
    currentPdfExists: boolean;
    versions: SpotProcurementVersion[];
    approvalInstances: ApprovalInstance[];
    receipt: Pick<
      SpotProcurementReceipt,
      "status" | "firstSubmittedAt" | "submittedAt" | "invalidatedAt"
    > | null;
    discrepancy: SpotProcurementDiscrepancy | null;
    refunds: SpotProcurementRefund[];
    reservations: Array<{ status: string }>;
    paymentArchives: SpotProcurementPaymentArchive[];
  }): DetailActionReadModel[] {
    const isOwner =
      input.actorUserId === input.procurement.applicantUserId ||
      input.actorUserId === input.procurement.handlerUserId;
    const canCreate = input.roleKeys.some((role) =>
      PROCUREMENT_CREATE_ROLES.has(role)
    );
    const reviewAccess =
      input.currentApproval?.status === "approval_pending"
        ? approvalReviewAccessOnFrozenNode(
            input.currentApproval.frozenNodes,
            input.currentApproval.currentNodeIndex,
            input.roleKeys,
            input.actorUserId,
            input.currentApproval.applicantUserId,
            false
          )
        : null;
    const canReview =
      Boolean(reviewAccess?.canAct) &&
      input.currentApproval?.applicantUserId !== input.actorUserId;
    const hasActualPayment = input.executions.some(
      (execution) => execution.voidedAt === null
    );
    const canVoid =
      input.procurement.status !== "closed" &&
      input.procurement.status !== "voided" &&
      input.roleKeys.some((role) => PROCUREMENT_VOID_ROLES.has(role)) &&
      !hasActualPayment &&
      input.activePayments.length === 0;
    const hasActivePayment = input.allPayments.some(
      (payment) =>
        payment.status === "draft" || ACTIVE_PAYMENT_STATUSES.has(payment.status)
    );
    const hasRecreatableSource = input.allPayments.some(
      (payment) =>
        payment.procurementVersionId === input.currentVersion.id &&
        payment.status === "invalidated" &&
        payment.submittedAt === null
    );
    const canCreatePayment =
      input.procurement.status === "approved_in_progress" &&
      input.currentVersion.status === "approved" &&
      input.actorUserId === input.procurement.handlerUserId &&
      canCreate &&
      !hasActivePayment &&
      hasRecreatableSource;
    const canCreateVersion =
      !["closed", "voided"].includes(input.procurement.status) &&
      ["approved", "rejected"].includes(input.currentVersion.status) &&
      isOwner &&
      canCreate &&
      !hasActualPayment &&
      input.activePayments.length === 0;
    const hasApprovalHistory =
      input.versions.some((version) => version.submittedAt !== null) ||
      input.approvalInstances.some(
        (approval) =>
          approval.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.application
      );
    const formalBlocker = procurementAbandonmentBlocker(input);
    const canAbandon =
      input.procurement.status === "draft" &&
      input.currentVersion.status === "draft" &&
      input.actorUserId === input.procurement.handlerUserId &&
      canCreate &&
      formalBlocker === null;

    return [
      detailAction({
        key: hasApprovalHistory
          ? "abandon_application"
          : "delete_pristine_draft",
        label: hasApprovalHistory ? "放弃采购申请" : "删除采购草稿",
        kind: "danger",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.create",
        enabled: canAbandon,
        disabledReason:
          formalBlocker ??
          "只有保留物资岗位的当前采购经办人可放弃采购草稿",
        requiresComment: hasApprovalHistory
      }),
      detailAction({
        key: "edit_draft",
        label: "编辑采购草稿",
        kind: "normal",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.create",
        enabled:
          input.procurement.status === "draft" &&
          input.currentVersion.status === "draft" &&
          isOwner &&
          canCreate,
        disabledReason: "只有当前草稿的申请人或经办人可以编辑"
      }),
      detailAction({
        key: "submit_approval",
        label: "提交采购审批",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.create",
        enabled:
          input.procurement.status === "draft" &&
          input.currentVersion.status === "draft" &&
          isOwner &&
          canCreate,
        disabledReason: "采购草稿完整后由申请人或经办人提交"
      }),
      detailAction({
        key: "review_approval",
        label: "处理采购审批",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.approve",
        skipRoleCheck: true,
        enabled: canReview,
        disabledReason: reviewAccess?.canAct
          ? "申请人不能审批自己发起的采购"
          : "当前账号不是本审批节点处理人"
      }),
      detailAction({
        key: "withdraw_approval",
        label: "撤回采购审批",
        kind: "normal",
        roleKeys: input.roleKeys,
        enabled:
          input.procurement.status === "approval_pending" &&
          input.actorUserId === input.procurement.applicantUserId,
        disabledReason: "只有采购申请人可在审批中撤回"
      }),
      detailAction({
        key: "create_payment_draft",
        label: "重新创建付款草稿",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled: canCreatePayment,
        disabledReason:
          "只有采购批准、原草稿已放弃且不存在活动付款时，当前采购经办人才可重新创建"
      }),
      detailAction({
        key: "create_version",
        label: "创建采购修订版本",
        kind: "normal",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.create",
        enabled: canCreateVersion,
        disabledReason:
          "仅当前申请人或经办人可在无活动付款、无实际付款时修订已批准或已驳回版本"
      }),
      detailAction({
        key: "void_procurement",
        label: "撤销采购",
        kind: "danger",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.void",
        enabled: canVoid,
        disabledReason: "办结、已付款或仍有活动付款时不能撤销",
        requiresComment: true
      }),
      detailAction({
        key: "download_application_pdf",
        label: "下载采购审批单",
        kind: "normal",
        roleKeys: input.roleKeys,
        enabled:
          input.currentApproval?.status === "approved" &&
          input.currentPdfExists,
        disabledReason:
          input.currentApproval?.status === "approved"
            ? "正式采购审批单尚未生成，请稍后重试"
            : "采购审批完成后才可下载正式审批单",
        requiresPassword: true
      })
    ];
  }

  private paymentActions(input: {
    payment: SpotProcurementPayment;
    approval: ApprovalInstance | null;
    roleKeys: RoleKey[];
    actorUserId: string;
    remainingCompanyPaymentAmountCents: bigint;
    isProjectFinanceStaff: boolean;
    paymentFactConsistent: boolean;
    voucherFactConsistent: boolean;
  }): DetailActionReadModel[] {
    const isHandler = input.actorUserId === input.payment.handlerUserId;
    const reviewAccess =
      input.approval?.status === "approval_pending"
        ? approvalReviewAccessOnFrozenNode(
            input.approval.frozenNodes,
            input.approval.currentNodeIndex,
            input.roleKeys,
            input.actorUserId,
            input.approval.applicantUserId,
            false
          )
        : null;
    const canVoid =
      PAYMENT_VOIDABLE_STATUSES.has(input.payment.status) &&
      input.roleKeys.some((role) => PROCUREMENT_VOID_ROLES.has(role));
    const canExecute =
      PAYMENT_EXECUTABLE_STATUSES.has(input.payment.status) &&
      input.remainingCompanyPaymentAmountCents > 0n &&
      input.isProjectFinanceStaff &&
      input.paymentFactConsistent &&
      input.voucherFactConsistent;

    return [
      detailAction({
        key: "abandon_payment_draft",
        label: "放弃付款草稿",
        kind: "danger",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled: input.payment.status === "draft" && isHandler,
        disabledReason: "只有当前采购经办人可放弃尚未提交的付款草稿",
        requiresComment: true
      }),
      detailAction({
        key: "edit_draft",
        label: "编辑付款草稿",
        kind: "normal",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled: input.payment.status === "draft" && isHandler,
        disabledReason: "只有采购经办人可以编辑付款草稿"
      }),
      detailAction({
        key: "submit_approval",
        label: "提交付款审批",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled: input.payment.status === "draft" && isHandler,
        disabledReason:
          "付款构成与支撑附件完整后由采购经办人提交"
      }),
      detailAction({
        key: "review_approval",
        label: "处理付款审批",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.approve",
        skipRoleCheck: true,
        enabled: Boolean(reviewAccess?.canReview),
        disabledReason: reviewAccess?.canAct
          ? "当前审批需要先确认本人申请的复核风险"
          : "当前账号不是本付款审批节点处理人",
        requiresSelfReviewConfirmation:
          reviewAccess?.requiresSelfReviewConfirmation ?? false
      }),
      detailAction({
        key: "withdraw_approval",
        label: "撤回付款审批",
        kind: "normal",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled:
          input.payment.status === "approval_pending" && isHandler,
        disabledReason: "只有采购经办人可以撤回审批中的付款申请"
      }),
      detailAction({
        key: "record_execution",
        label: "登记公司实际付款",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.execute",
        enabled: canExecute,
        disabledReason:
          !input.paymentFactConsistent
            ? "付款累计与实际执行记录不一致，请先由管理员核对，禁止继续登记实付"
            : !input.voucherFactConsistent
              ? "已有实际付款缺少有效凭证，请先核对凭证事实，禁止继续登记实付"
              : "仅当前项目财务人员可对已批待付或部分已付申请登记实付",
        requiresPassword: true,
        requiresFile: true
      }),
      detailAction({
        key: "void_payment",
        label: "作废付款申请",
        kind: "danger",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.void",
        enabled: canVoid,
        disabledReason: "仅项目经理或财务主管可在付款执行前作废",
        requiresComment: true
      }),
      detailAction({
        key: "download_payment_pdf",
        label: "下载付款审批单",
        kind: "normal",
        roleKeys: input.roleKeys,
        enabled: input.approval?.status === "approved",
        disabledReason: "付款审批完成后才可下载正式审批单",
        requiresPassword: true
      })
    ];
  }

  private paymentEvidenceFiles(
    payment: SpotProcurementPayment,
    executions: SpotProcurementPaymentExecution[],
    fileById: Map<string, FileObject>,
    userById: Map<string, UserNameRow>
  ) {
    const references = [
      payment.supportingAttachmentFileId
        ? {
            id: `support:${payment.id}`,
            fileId: payment.supportingAttachmentFileId,
            purpose: "付款支撑附件"
          }
        : null,
      payment.merchantPaymentProofFileId
        ? {
            id: `merchant-proof:${payment.id}`,
            fileId: payment.merchantPaymentProofFileId,
            purpose: "商家付款证明"
          }
        : null,
      ...executions.flatMap((execution) =>
        execution.voucherFileId
          ? [
              {
                id: `voucher:${execution.id}`,
                fileId: execution.voucherFileId,
                purpose: "公司实际付款凭证"
              }
            ]
          : []
      )
    ].filter(
      (
        reference
      ): reference is { id: string; fileId: string; purpose: string } =>
        Boolean(reference)
    );
    return references.flatMap((reference) => {
      const file = fileById.get(reference.fileId);
      if (!file) return [];
      return [
        evidenceFileReadModel(
          file,
          userById,
          reference.purpose,
          reference.id,
          true
        )
      ];
    });
  }

  private async realProcurementInvoiceSummary(
    payments: SpotProcurementPayment[]
  ) {
    const payment = payments.find((candidate) => isRealPaymentForm(candidate));
    if (!payment || !this.paymentInvoices) {
      return realInvoiceSummaryUnavailable();
    }
    return this.paymentInvoices.summary(payment.id);
  }

  private async loadUsers(userIds: string[]) {
    return userIds.length
      ? this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true }
        })
      : [];
  }

  private async eligibleHandlerOptions(projectId: string) {
    const eligibleRoleKeys = [...PROCUREMENT_CREATE_ROLES];
    const positions = await this.prisma.position.findMany({
      where: { key: { in: eligibleRoleKeys } },
      select: { id: true, key: true }
    });
    const roleKeyByPositionId = new Map(
      positions.map((position) => [
        position.id,
        position.key as RoleKey
      ])
    );
    const [assignments, memberships] = await Promise.all([
      positions.length
        ? this.prisma.userPosition.findMany({
            where: {
              positionId: { in: positions.map((position) => position.id) },
              OR: [{ projectId: null }, { projectId }]
            },
            select: {
              userId: true,
              positionId: true,
              projectId: true
            }
          })
        : Promise.resolve([]),
      this.prisma.projectMember.findMany({
        where: {
          projectId,
          positionKey: { in: eligibleRoleKeys }
        },
        select: { userId: true, positionKey: true }
      })
    ]);
    const roleKeysByUserId = new Map<string, Set<RoleKey>>();
    for (const assignment of assignments) {
      const roleKey = roleKeyByPositionId.get(assignment.positionId);
      if (!roleKey) continue;
      if (
        assignment.projectId === null &&
        !GLOBAL_BUSINESS_ROLE_KEYS.includes(roleKey)
      ) {
        continue;
      }
      const roleKeys =
        roleKeysByUserId.get(assignment.userId) ?? new Set<RoleKey>();
      roleKeys.add(roleKey);
      roleKeysByUserId.set(assignment.userId, roleKeys);
    }
    for (const membership of memberships) {
      const roleKey = membership.positionKey as RoleKey;
      if (!PROCUREMENT_CREATE_ROLES.has(roleKey)) continue;
      const roleKeys =
        roleKeysByUserId.get(membership.userId) ?? new Set<RoleKey>();
      roleKeys.add(roleKey);
      roleKeysByUserId.set(membership.userId, roleKeys);
    }
    const userIds = [...roleKeysByUserId.keys()];
    if (!userIds.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, name: true }
    });
    return users
      .map((user) => ({
        id: user.id,
        name: user.name,
        roleKeys: [...(roleKeysByUserId.get(user.id) ?? [])].sort()
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, "zh-CN") ||
          left.id.localeCompare(right.id)
      );
  }

  private async paymentRoleContexts(
    actorUserId: string,
    projectIds: string[]
  ) {
    const [assignments, memberships] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: {
          userId: actorUserId,
          OR: [{ projectId: null }, { projectId: { in: projectIds } }]
        },
        select: { positionId: true, projectId: true }
      }),
      this.prisma.projectMember.findMany({
        where: { userId: actorUserId, projectId: { in: projectIds } },
        select: { projectId: true, positionKey: true }
      })
    ]);
    const positionIds = [
      ...new Set(assignments.map((assignment) => assignment.positionId))
    ];
    const positions = positionIds.length
      ? await this.prisma.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const positionKeyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalRoleKeys = assignments
      .filter((assignment) => assignment.projectId === null)
      .map((assignment) => positionKeyById.get(assignment.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const contexts = new Map<
      string,
      { effectiveRoleKeys: RoleKey[]; projectScopedRoleKeys: RoleKey[] }
    >();
    for (const projectId of projectIds) {
      const projectScopedRoleKeys = [
        ...assignments
          .filter((assignment) => assignment.projectId === projectId)
          .map((assignment) => positionKeyById.get(assignment.positionId))
          .filter((role): role is RoleKey => Boolean(role)),
        ...memberships
          .filter((membership) => membership.projectId === projectId)
          .map((membership) => membership.positionKey as RoleKey)
      ];
      contexts.set(projectId, {
        effectiveRoleKeys: resolveEffectiveRoleKeys(
          globalRoleKeys,
          projectScopedRoleKeys
        ),
        projectScopedRoleKeys: [...new Set(projectScopedRoleKeys)]
      });
    }
    return contexts;
  }

  private async hasProjectScopedRole(
    actorUserId: string,
    projectId: string,
    roleKey: RoleKey
  ) {
    const [assignments, memberships] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionId: true }
      }),
      this.prisma.projectMember.findMany({
        where: { userId: actorUserId, projectId, positionKey: roleKey },
        select: { id: true },
        take: 1
      })
    ]);
    if (memberships.length) return true;
    if (!assignments.length) return false;
    const position = await this.prisma.position.findFirst({
      where: {
        id: { in: assignments.map((assignment) => assignment.positionId) },
        key: roleKey
      },
      select: { id: true }
    });
    return Boolean(position);
  }
}

function approvalSummary(
  approval: ApprovalInstance | null | undefined
): ApprovalSummary {
  if (!approval) {
    return {
      status: "not_started",
      statusLabel: "尚未发起审批",
      currentNodeName: "尚未发起审批",
      currentRoleKeys: []
    };
  }
  const currentRoleKeys =
    approval.status === "approval_pending"
      ? pendingRoleKeysForFrozenApprovalNode(
          approval.frozenNodes,
          approval.currentNodeIndex
        )
      : [];
  const currentNodeName =
    approval.status === "approval_pending"
      ? frozenNodeName(approval)
      : approval.status === "approved"
        ? "审批完成"
        : approvalStatusLabel(approval.status);
  return {
    status: approval.status,
    statusLabel: approvalStatusLabel(approval.status),
    currentNodeName,
    currentRoleKeys
  };
}

function paymentWorkbenchView(value?: string): SpotPaymentWorkbenchView {
  const normalized = optionalQueryText(value) ?? "mine";
  if (
    !SPOT_PAYMENT_WORKBENCH_VIEWS.includes(
      normalized as SpotPaymentWorkbenchView
    )
  ) {
    throw new BadRequestException("零星采购付款工作台视图不正确");
  }
  return normalized as SpotPaymentWorkbenchView;
}

function procurementVersionCoordinate(
  procurementId: string,
  procurementVersionId: string
) {
  return `${procurementId}\u0000${procurementVersionId}`;
}

type RefundOwnerPayment = Pick<
  SpotProcurementPayment,
  "id" | "procurementId" | "procurementVersionId" | "status" | "createdAt"
>;

function refundOwnerPaymentId(
  refund: Pick<
    SpotProcurementRefund,
    "discrepancyId" | "procurementId" | "paymentId"
  >,
  discrepancy: Pick<
    SpotProcurementDiscrepancy,
    "id" | "procurementId" | "procurementVersionId"
  > | null,
  payments: RefundOwnerPayment[]
) {
  if (refund.paymentId !== null) return refund.paymentId;
  if (
    !discrepancy ||
    discrepancy.id !== refund.discrepancyId ||
    discrepancy.procurementId !== refund.procurementId
  ) {
    return null;
  }
  return spotPaymentRefundOwnerId(discrepancy, payments);
}

function paymentTaskDiscrepancy(
  payment: Pick<SpotProcurementPayment, "id">,
  discrepancy: SpotProcurementDiscrepancy | null,
  payments: RefundOwnerPayment[]
) {
  if (
    discrepancy?.status !== "awaiting_refund" ||
    discrepancy.resolutionType !== "full_refund"
  ) {
    return discrepancy;
  }
  return spotPaymentRefundOwnerId(discrepancy, payments) === payment.id
    ? discrepancy
    : null;
}

function paymentTaskFactAt(
  payment: SpotProcurementPayment,
  approval: ApprovalInstance | null,
  currentTask: SpotPaymentCurrentTask,
  discrepancy: SpotProcurementDiscrepancy | null,
  voucherAnomalyAt: Date | null
) {
  if (currentTask.key === "record_refund") {
    return discrepancy?.updatedAt ?? discrepancy?.createdAt ?? payment.updatedAt;
  }
  if (currentTask.key === "view_only" && voucherAnomalyAt) {
    return voucherAnomalyAt;
  }
  if (currentTask.key === "review_payment") {
    return approval?.updatedAt ?? payment.updatedAt;
  }
  if (currentTask.key === "record_execution") {
    return payment.approvedAt ?? payment.updatedAt;
  }
  if (currentTask.key === "complete_payment_draft") {
    return payment.createdAt;
  }
  return payment.updatedAt;
}

function earliestVoucherAnomalyAt(
  executions: Array<
    Pick<
      SpotProcurementPaymentExecution,
      "id" | "paidAt" | "createdAt" | "voucherFileId"
    >
  >,
  activeVoucherFileIds: ReadonlySet<string>,
  voucherFilesByExecutionId: ReadonlyMap<
    string,
    Array<{ fileId: string }>
  >
) {
  return executions
    .filter(
      (execution) =>
        !executionHasActiveVoucher(
          execution,
          activeVoucherFileIds,
          voucherFilesByExecutionId
        )
    )
    .reduce<Date | null>((earliest, execution) => {
      const factAt = execution.paidAt ?? execution.createdAt;
      return !earliest || factAt.getTime() < earliest.getTime()
        ? factAt
        : earliest;
    }, null);
}

function comparePaymentWorkbenchItems(
  left: {
    id: string;
    currentTask: SpotPaymentCurrentTask;
    [PAYMENT_TASK_SORT_AT]: Date;
  },
  right: {
    id: string;
    currentTask: SpotPaymentCurrentTask;
    [PAYMENT_TASK_SORT_AT]: Date;
  }
) {
  return (
    right.currentTask.priority - left.currentTask.priority ||
    left[PAYMENT_TASK_SORT_AT].getTime() -
      right[PAYMENT_TASK_SORT_AT].getTime() ||
    left.id.localeCompare(right.id)
  );
}

function stripPaymentInternalFacts<
  T extends {
    id: string;
    status: string;
    currentTask: SpotPaymentCurrentTask;
    [PAYMENT_TASK_SORT_AT]: Date;
    [PAYMENT_AMOUNT_FACTS]: {
      approvalAmountCents: bigint;
      actualPaidAmountCents: bigint;
      refundAmountCents: bigint;
    };
  }
>(item: T): {
  id: string;
  status: string;
  currentTask: SpotPaymentCurrentTask;
  [key: string]: unknown;
} {
  const {
    [PAYMENT_TASK_SORT_AT]: _taskSortAt,
    [PAYMENT_AMOUNT_FACTS]: _amountFacts,
    ...readModel
  } = item;
  void _taskSortAt;
  void _amountFacts;
  return readModel;
}

function paymentAmountSummary(
  items: Array<{
    [PAYMENT_AMOUNT_FACTS]: {
      approvalAmountCents: bigint;
      actualPaidAmountCents: bigint;
      refundAmountCents: bigint;
    };
  }>,
  complete: boolean
): SpotPaymentListAmountSummary {
  const totals = items.reduce(
    (sum, item) => ({
      approvalAmountCents:
        sum.approvalAmountCents +
        item[PAYMENT_AMOUNT_FACTS].approvalAmountCents,
      actualPaidAmountCents:
        sum.actualPaidAmountCents +
        item[PAYMENT_AMOUNT_FACTS].actualPaidAmountCents,
      refundAmountCents:
        sum.refundAmountCents + item[PAYMENT_AMOUNT_FACTS].refundAmountCents
    }),
    {
      approvalAmountCents: 0n,
      actualPaidAmountCents: 0n,
      refundAmountCents: 0n
    }
  );
  return {
    approvalAmountCents: totals.approvalAmountCents.toString(),
    actualPaidAmountCents: totals.actualPaidAmountCents.toString(),
    refundAmountCents: totals.refundAmountCents.toString(),
    netPaidAmountCents: (
      totals.actualPaidAmountCents - totals.refundAmountCents
    ).toString(),
    complete
  };
}

function frozenNodeName(approval: ApprovalInstance) {
  if (!Array.isArray(approval.frozenNodes)) return "审批节点未读取";
  const node = approval.frozenNodes[approval.currentNodeIndex];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return "审批节点未读取";
  }
  const name = (node as { name?: unknown }).name;
  if (typeof name === "string" && name.trim()) return name;
  const roleKeys = pendingRoleKeysForFrozenApprovalNode(
    approval.frozenNodes,
    approval.currentNodeIndex
  );
  return roleKeys.map((role) => ROLE_LABELS[role] ?? "审批岗位未读取").join("、");
}

function approvalStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approval_pending: "审批中",
    approved: "审批通过",
    rejected: "已驳回",
    returned: "已退回",
    withdrawn: "已撤回",
    voided: "已作废"
  };
  return labels[status] ?? "审批状态未读取";
}

function latestApprovalByBusinessId(
  approvals: ApprovalInstance[],
  businessType: string
) {
  const result = new Map<string, ApprovalInstance>();
  for (const approval of approvals) {
    if (
      approval.businessType === businessType &&
      !result.has(approval.businessId)
    ) {
      result.set(approval.businessId, approval);
    }
  }
  return result;
}

function summarizePayments(
  payments: SpotProcurementPayment[],
  actualPaidByPaymentId: ReadonlyMap<string, bigint> = new Map()
) {
  const active = payments.filter((payment) =>
    ACTIVE_PAYMENT_STATUSES.has(payment.status)
  );
  const sum = (
    selector: (payment: SpotProcurementPayment) => bigint
  ): string =>
    active.reduce((total, payment) => total + selector(payment), 0n).toString();
  return {
    paymentCount: active.length,
    activeSettlementAmountCents: sum(
      (payment) => payment.settlementAmountCents
    ),
    companyPaymentAmountCents: sum(
      (payment) => payment.companyPaymentAmountCents
    ),
    paidAmountCents: sum(
      (payment) => actualPaidByPaymentId.get(payment.id) ?? 0n
    ),
    supplierBalanceAmountCents: sum(
      (payment) => payment.supplierBalanceAmountCents
    ),
    executedSupplierBalanceAmountCents: sum(
      (payment) => payment.executedSupplierBalanceAmountCents
    ),
    canceledAmountCents: sum((payment) => payment.canceledAmountCents),
    statusLabel: aggregatePaymentStatusLabel(active)
  };
}

function aggregatePaymentStatusLabel(payments: SpotProcurementPayment[]) {
  if (!payments.length) return "未申请付款";
  if (payments.every((payment) => payment.status === "settled")) return "已结清";
  if (payments.some((payment) => payment.status === "partially_paid")) {
    return "部分已付";
  }
  if (payments.some((payment) => payment.status === "paid")) {
    return "公司付款已付";
  }
  if (
    payments.some((payment) => payment.status === "approved_pending_payment")
  ) {
    return "已批待付";
  }
  if (payments.some((payment) => payment.status === "approval_pending")) {
    return "付款审批中";
  }
  return "付款草稿";
}

function isRealProcurementForm(
  version: Pick<SpotProcurementVersion, "totalAmountCents">
) {
  return version.totalAmountCents === null;
}

function isRealPaymentForm(
  payment: Pick<SpotProcurementPayment, "paymentType" | "status">,
  version?: Pick<SpotProcurementVersion, "totalAmountCents">
) {
  if (payment.paymentType) {
    return true;
  }

  return (
    payment.status === "draft" &&
    version !== undefined &&
    isRealProcurementForm(version)
  );
}

function summarizeRealPaymentFacts(
  payments: SpotProcurementPayment[],
  actualPaidByPaymentId: ReadonlyMap<string, bigint>,
  refunds: Array<Pick<SpotProcurementRefund, "paymentId" | "amountCents">>
) {
  const captured = payments.filter(
    (payment) => isCurrentPayment(payment) && Boolean(payment.paymentType)
  );
  if (!captured.length) {
    return {
      status: "pending_determination",
      statusLabel: "付款金额待确定",
      approvalAmountCents: null,
      actualPaidAmountCents: null,
      refundAmountCents: null,
      netPaidAmountCents: null,
      remainingAmountCents: null
    };
  }
  const approvalAmountCents = captured.reduce(
    (total, payment) => total + payment.approvalAmountCents,
    0n
  );
  const actualPaidAmountCents = captured.reduce(
    (total, payment) =>
      total + (actualPaidByPaymentId.get(payment.id) ?? 0n),
    0n
  );
  const paymentIds = new Set(captured.map((payment) => payment.id));
  const refundAmountCents = refunds.reduce(
    (total, refund) =>
      refund.paymentId && paymentIds.has(refund.paymentId)
        ? total + refund.amountCents
        : total,
    0n
  );
  return {
    status: aggregateRealPaymentStatus(captured),
    statusLabel: aggregateRealPaymentStatusLabel(captured),
    approvalAmountCents: approvalAmountCents.toString(),
    actualPaidAmountCents: actualPaidAmountCents.toString(),
    refundAmountCents: refundAmountCents.toString(),
    netPaidAmountCents: (actualPaidAmountCents - refundAmountCents).toString(),
    remainingAmountCents: nonNegative(
      approvalAmountCents - actualPaidAmountCents
    ).toString()
  };
}

function uniqueVisibleCurrentPaymentId(
  payments: readonly SpotProcurementPayment[],
  accessiblePaymentIds: ReadonlySet<string>
) {
  const currentPayments = payments.filter(isCurrentPayment);
  if (currentPayments.length !== 1) return null;
  const [currentPayment] = currentPayments;
  return currentPayment && accessiblePaymentIds.has(currentPayment.id)
    ? currentPayment.id
    : null;
}

function isCurrentPayment(payment: SpotProcurementPayment) {
  return (
    !TERMINAL_PAYMENT_STATUSES.has(payment.status) &&
    payment.invalidatedAt === null
  );
}

function realPaymentFactReadModel(
  payment: SpotProcurementPayment,
  actualPaidAmountCents: bigint,
  refunds: Array<Pick<SpotProcurementRefund, "amountCents">>
) {
  if (!payment.paymentType) {
    return {
      approvalAmountCents: null,
      actualPaidAmountCents: null,
      refundAmountCents: null,
      netPaidAmountCents: null,
      remainingAmountCents: null
    };
  }
  const refundAmountCents = refunds.reduce(
    (total, refund) => total + refund.amountCents,
    0n
  );
  const approvalAmountCents = payment.approvalAmountCents;
  return {
    approvalAmountCents: approvalAmountCents.toString(),
    actualPaidAmountCents: actualPaidAmountCents.toString(),
    refundAmountCents: refundAmountCents.toString(),
    netPaidAmountCents: (actualPaidAmountCents - refundAmountCents).toString(),
    remainingAmountCents: nonNegative(
      approvalAmountCents - actualPaidAmountCents
    ).toString()
  };
}

function aggregateRealPaymentStatus(payments: SpotProcurementPayment[]) {
  if (payments.some((payment) => payment.status === "settled")) {
    return "settled";
  }
  if (payments.some((payment) => payment.status === "paid")) return "paid";
  if (payments.some((payment) => payment.status === "partially_paid")) {
    return "partially_paid";
  }
  if (
    payments.some((payment) => payment.status === "approved_pending_payment")
  ) {
    return "approved_pending_payment";
  }
  if (payments.some((payment) => payment.status === "approval_pending")) {
    return "approval_pending";
  }
  return payments.at(0)?.status ?? "pending_determination";
}

function aggregateRealPaymentStatusLabel(payments: SpotProcurementPayment[]) {
  return paymentStatusLabel(aggregateRealPaymentStatus(payments));
}

function paymentTypeLabel(value: string | null) {
  if (value === "company_direct") return "公司直付";
  if (value === "handler_reimbursement") return "经办人垫付报回";
  return "付款类型待确认";
}

function maskedPaymentChannelReadModel(
  channel: Pick<
    SpotProcurementPaymentChannel,
    | "id"
    | "sortOrder"
    | "channelType"
    | "accountNameSnapshot"
    | "accountNumberSnapshot"
    | "bankNameSnapshot"
    | "channelNote"
    | "isPrimary"
  >
) {
  return {
    id: channel.id,
    sortOrder: channel.sortOrder,
    channelType: channel.channelType,
    channelTypeLabel: paymentMethodLabel(channel.channelType),
    accountName: channel.accountNameSnapshot,
    accountNumberLast4: bankAccountLast4(channel.accountNumberSnapshot),
    bankName: channel.bankNameSnapshot,
    note: channel.channelNote,
    primary: channel.isPrimary
  };
}

function receiptReadSummary(
  receipt:
    | (Pick<
        SpotProcurementReceipt,
        | "id"
        | "status"
        | "currentRevisionNo"
        | "firstSubmittedAt"
        | "submittedAt"
        | "lockedAt"
      > &
        Partial<
          Pick<
            SpotProcurementReceipt,
            "handlerUserId" | "invalidatedAt"
          >
        >)
    | null,
  discrepancy: Pick<SpotProcurementDiscrepancy, "status"> | null,
  openedByActualPayment = false,
  workflowFacts?: {
    actorUserId: string;
    currentRevisionSubmittedAt: Date | null;
    activeDelegation: {
      delegatorUserId: string;
      delegateUserId: string;
      scope: string;
    } | null;
    hasReview: boolean;
    hasPdf: boolean;
    hasInvoiceFact: boolean;
    hasDraftContent: boolean;
    refundCount: number;
  }
) {
  if (!receipt) {
    return {
      available: false,
      status: "not_created",
      statusLabel: "尚未生成收货单",
      openAfterActualPayment: openedByActualPayment,
      blockedReason: openedByActualPayment
        ? null
        : "待财务登记实际付款后开放收货确认",
      currentRevisionNo: null,
      firstSubmittedAt: null,
      submittedAt: null,
      lockedAt: null
    };
  }
  return {
    available: true,
    id: receipt.id,
    status: receipt.status,
    statusLabel: receiptStatusLabel(receipt.status),
    openAfterActualPayment: openedByActualPayment,
    blockedReason: openedByActualPayment
      ? null
      : "待财务登记实际付款后开放收货确认",
    currentRevisionNo: receipt.currentRevisionNo,
    firstSubmittedAt: isoOrNull(receipt.firstSubmittedAt),
    submittedAt: isoOrNull(receipt.submittedAt),
    lockedAt: isoOrNull(receipt.lockedAt),
    discrepancyStatus: discrepancy?.status ?? null,
    ...(workflowFacts
      ? {
          workflow: receiptWorkflowReadModel({
            receipt,
            discrepancy,
            openedByActualPayment,
            ...workflowFacts
          })
        }
      : {})
  };
}

function receiptWorkflowReadModel(input: {
  receipt: Pick<
    SpotProcurementReceipt,
    | "status"
    | "currentRevisionNo"
    | "firstSubmittedAt"
    | "submittedAt"
  > &
    Partial<
      Pick<
        SpotProcurementReceipt,
        "handlerUserId" | "invalidatedAt"
      >
    >;
  discrepancy: Pick<SpotProcurementDiscrepancy, "status"> | null;
  openedByActualPayment: boolean;
  actorUserId: string;
  currentRevisionSubmittedAt: Date | null;
  activeDelegation: {
    delegatorUserId: string;
    delegateUserId: string;
    scope: string;
  } | null;
  hasReview: boolean;
  hasPdf: boolean;
  hasInvoiceFact: boolean;
  hasDraftContent: boolean;
  refundCount: number;
}) {
  const isHandler =
    input.actorUserId === input.receipt.handlerUserId;
  const isActiveDelegate = Boolean(
    input.activeDelegation &&
      input.activeDelegation.delegatorUserId ===
        input.receipt.handlerUserId &&
      input.activeDelegation.delegateUserId ===
        input.actorUserId &&
      input.activeDelegation.scope === "receipt_confirmation"
  );
  const blocker = !input.openedByActualPayment
    ? "待财务登记实际付款后开放收货确认"
    : input.receipt.invalidatedAt
      ? "收货单已失效，只能查看历史"
      : input.receipt.status !== "draft" ||
          input.receipt.firstSubmittedAt !== null ||
          input.receipt.submittedAt !== null ||
          input.currentRevisionSubmittedAt !== null
        ? "只能重置从未提交的当前收货草稿"
        : input.hasReview
          ? "收货单已形成主管复核记录"
          : input.hasPdf
            ? "收货单已形成正式 PDF 或归档证据"
            : input.hasInvoiceFact
              ? "收货单已形成发票或无票业务事实"
              : input.discrepancy
                ? "收货单已形成差异或补货事实"
                : input.refundCount > 0
                  ? "收货单已关联退款事实"
                  : !isHandler && !isActiveDelegate
                    ? "只有采购经办人或当前有效受托人可以重置收货草稿"
                    : !input.hasDraftContent
                      ? "当前收货草稿尚未填写，无需重置"
                      : null;
  const stage = !input.openedByActualPayment
    ? "waiting_payment"
    : input.receipt.status === "submitted"
      ? "awaiting_supervisor_review"
      : input.receipt.status === "draft" &&
          input.receipt.firstSubmittedAt === null &&
          input.currentRevisionSubmittedAt === null
        ? input.hasDraftContent
          ? "reset_unsubmitted_receipt"
          : "fill_receipt"
        : "readonly_history";
  const stageLabels: Record<string, string> = {
    waiting_payment: "等待实际付款",
    fill_receipt: "填写收货",
    reset_unsubmitted_receipt: "可重置未提交收货",
    awaiting_supervisor_review: "待物资主管复核",
    readonly_history: "只读历史"
  };
  return {
    stage,
    stageLabel: stageLabels[stage],
    resetAction: {
      key: "reset_receipt_draft",
      label: "重置未提交收货",
      enabled: blocker === null,
      disabledReason: blocker,
      expectedRevision: input.receipt.currentRevisionNo
    }
  };
}

function receiptStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "待确认收货",
    submitted: "待物资主管复核",
    returned: "已退回收货确认",
    approved: "收货已复核",
    review_revoked: "收货复核已撤销",
    closed: "已办结"
  };
  return labels[status] ?? "收货状态未读取";
}

function discrepancyReadSummary(
  discrepancy: SpotProcurementDiscrepancy | null,
  refunds: Array<Pick<SpotProcurementRefund, "amountCents" | "receivedAt">>
) {
  if (!discrepancy) {
    return {
      status: "none",
      statusLabel: "无待处理收货差异",
      nextStep: null,
      refund: null
    };
  }
  const refund = refunds.at(-1) ?? null;
  return {
    status: discrepancy.status,
    statusLabel: discrepancyStatusLabel(discrepancy.status),
    resolutionType: discrepancy.resolutionType,
    replenishedAt: isoOrNull(discrepancy.replenishedAt),
    refundExpectedAmountCents: discrepancy.refundExpectedAmountCents.toString(),
    nextStep:
      discrepancy.status === "pending_resolution"
        ? "请由经办人选择商户补货，或由财务登记退款"
        : null,
    refund: refund
      ? {
          amountCents: refund.amountCents.toString(),
          receivedAt: refund.receivedAt.toISOString()
        }
      : null
  };
}

function discrepancyStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_resolution: "待处理少货差异",
    replenishment_pending: "待商户补货",
    resolved: "差异已处理",
    refunded: "已退款"
  };
  return labels[status] ?? "差异状态未读取";
}

function archiveReadModels(
  archives: SpotProcurementPaymentArchive[],
  filesByArchiveId: ReadonlyMap<string, SpotProcurementPaymentArchiveFile[]>
) {
  return archives.map((archive) => ({
    id: archive.id,
    versionNo: archive.versionNo,
    trigger: archive.archiveTrigger,
    status: archive.status,
    generatedPackageFileId: archive.generatedPackageFileId,
    createdAt: archive.createdAt.toISOString(),
    files: (filesByArchiveId.get(archive.id) ?? []).map((file) => ({
      id: file.id,
      fileId: file.fileId,
      role: file.fileRole,
      sortOrder: file.sortOrder
    }))
  }));
}

function archiveStatusReadModel(
  payment: Pick<SpotProcurementPayment, "factsFrozenAt">,
  approvalOriginal: Pick<FileObject, "id"> | null,
  latestArchive: Pick<SpotProcurementPaymentArchive, "id" | "versionNo" | "status" | "createdAt"> | null
) {
  if (!payment.factsFrozenAt) {
    return {
      status: "not_ready",
      label: "付款审批完成后生成归档包",
      canRetry: false,
      latestVersionNo: null
    };
  }
  if (!approvalOriginal) {
    return {
      status: "waiting_approval_original",
      label: "待生成不可变付款审批原件",
      canRetry: false,
      latestVersionNo: null
    };
  }
  if (!latestArchive) {
    return {
      status: "pending_generation",
      label: "待生成付款归档包",
      canRetry: true,
      latestVersionNo: null
    };
  }
  return {
    status: latestArchive.status,
    label: latestArchive.status === "generated" ? "归档包已生成" : "归档包待重试",
    canRetry: latestArchive.status !== "generated",
    latestVersionNo: latestArchive.versionNo,
    latestGeneratedAt: latestArchive.createdAt.toISOString()
  };
}

function payerManagementReadModel(input: {
  payment: SpotProcurementPayment;
  approval: ApprovalInstance | null;
  roleKeys: RoleKey[];
  activeExecutionCount: number;
}) {
  const canManage = input.roleKeys.some((role) =>
    ["finance_staff", "comprehensive_director", "finance_director"].includes(role)
  );
  if (!canManage) {
    return {
      visible: false,
      enabled: false,
      disabledReason: "当前账号不是付款主体维护岗位",
      requiresReapproval: false
    };
  }
  if (input.activeExecutionCount) {
    return {
      visible: true,
      enabled: false,
      disabledReason: "已发生实际付款，不能再调整付款主体",
      requiresReapproval: false
    };
  }
  if (!["draft", "approval_pending"].includes(input.payment.status)) {
    return {
      visible: true,
      enabled: false,
      disabledReason: "付款审批完成后不能再调整付款主体",
      requiresReapproval: false
    };
  }
  if (!input.approval) {
    return {
      visible: true,
      enabled: true,
      disabledReason: null,
      requiresReapproval: false
    };
  }
  const pendingRoles = pendingRoleKeysForFrozenApprovalNode(
    input.approval.frozenNodes,
    input.approval.currentNodeIndex
  );
  const financeDirectorNode =
    pendingRoles.includes("finance_director") &&
    input.roleKeys.includes("finance_director");
  if (financeDirectorNode) {
    return {
      visible: true,
      enabled: true,
      disabledReason: null,
      requiresReapproval: true
    };
  }
  if (input.approval.currentNodeIndex === 0) {
    return {
      visible: true,
      enabled: true,
      disabledReason: null,
      requiresReapproval: false
    };
  }
  return {
    visible: true,
    enabled: false,
    disabledReason: "综合部主管审批完成后，仅财务主管可在本节点调整付款主体",
    requiresReapproval: false
  };
}

function realInvoiceSummaryUnavailable() {
  return {
    status: "not_required",
    statusLabel: "尚未填写付款材料票据条件",
    activeCount: 0,
    invoices: []
  };
}

function paymentInvoiceListSummary(
  lines: Array<{ expectedInvoiceCondition: string }>,
  invoices: Array<{ status: string }>
) {
  const activeCount = invoices.filter(
    (invoice) => invoice.status === "active"
  ).length;
  const expectsInvoice = lines.some(
    (line) => line.expectedInvoiceCondition !== "no_invoice"
  );
  if (!expectsInvoice) {
    return { status: "not_required", statusLabel: "无需发票", activeCount };
  }
  return activeCount
    ? { status: "uploaded", statusLabel: "已上传发票", activeCount }
    : { status: "pending", statusLabel: "待补发票", activeCount };
}

function invoiceComposition(lines: SpotProcurementLine[]) {
  const modes = new Set(lines.map((line) => line.invoiceMode));
  if (modes.has("invoice") && modes.has("no_invoice")) return "mixed";
  if (modes.has("invoice")) return "invoice";
  if (modes.has("no_invoice")) return "no_invoice";
  return "unknown";
}

function versionReadModel(
  version: SpotProcurementVersion,
  realApplication = isRealProcurementForm(version)
) {
  const common = {
    id: version.id,
    versionNo: version.versionNo,
    status: version.status,
    statusLabel: versionStatusLabel(version.status),
    reason: version.reason,
    note: version.note,
    handlerUserId: version.handlerUserId,
    changeReason: version.changeReason,
    changeSummary: version.changeSummary,
    submittedAt: isoOrNull(version.submittedAt),
    approvedAt: isoOrNull(version.approvedAt),
    abandonedAt: isoOrNull(version.abandonedAt),
    abandonReason: version.abandonReason,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString()
  };
  return realApplication
    ? {
        ...common,
        applicationDepartment: version.applicationDepartmentSnapshot,
        applicationName: version.applicationNameSnapshot,
        purchaserName: version.purchaserNameSnapshot,
        purchaserDepartment: version.purchaserDepartmentNameSnapshot,
        requestedArrivalAt: version.requestedArrivalAt.toISOString()
      }
    : {
        ...common,
        supplierPartyId: version.supplierPartyId,
        supplierName: version.supplierNameSnapshot,
        totalAmountCents: moneyText(version.totalAmountCents)
      };
}

function lineReadModel(line: SpotProcurementLine, realApplication = false) {
  const common = {
    id: line.id,
    sortOrder: line.sortOrder,
    materialName: line.materialName,
    specification: line.specification,
    unit: line.unit,
    quantity: line.quantity.toString(),
    note: line.note
  };
  return realApplication
    ? common
    : {
        ...common,
    invoiceMode: line.invoiceMode,
    invoiceType: line.invoiceType,
    vatRateOptionId: line.vatRateOptionId,
    vatRateValue: line.vatRateValueSnapshot?.toString() ?? null,
    vatRateLabel: line.vatRateLabelSnapshot,
    unitPrice: line.unitPrice?.toString() ?? null,
    amountCents: moneyText(line.amountCents),
    usageLocation: line.usageLocation,
      };
}

function evidenceFileReadModel(
  file: FileObject,
  userById: Map<string, UserNameRow>,
  purpose: string,
  recordId: string,
  canDownload: boolean
) {
  return {
    recordId,
    fileId: file.id,
    fileName: file.originalName,
    purpose,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    status: file.storageStatus,
    statusLabel:
      file.storageStatus === "active" ? "可用" : "已失效",
    uploadedByName:
      userById.get(file.uploadedByUserId)?.name ?? "上传人未读取",
    uploadedAt: file.createdAt.toISOString(),
    confirmedByName: null,
    confirmedAt: null,
    canDownload:
      canDownload && file.storageStatus === "active",
    disabledReason:
      file.storageStatus === "active"
        ? null
        : "文件已失效，不能下载"
  };
}

function futureUnavailable() {
  return {
    available: false,
    status: "not_available",
    label: "代码阶段 B 完成后开放"
  } as const;
}

function invoiceCoverageUnavailable() {
  return futureUnavailable();
}

function invoiceLedgerDetailUnavailable() {
  return {
    available: false,
    currentCoordinates: null,
    invoices: [],
    allocations: [],
    noInvoiceConfirmations: [],
    invoiceExceptions: []
  } as const;
}

function projectSummary(
  project: Pick<Project, "id" | "code" | "name"> | ProjectSummary
): ProjectSummary {
  return { id: project.id, code: project.code, name: project.name };
}

function userSummary(
  userId: string,
  userById: Map<string, UserNameRow>,
  fallback: string
): UserSummary {
  return { id: userId, name: userById.get(userId)?.name ?? fallback };
}

function procurementStatusLabel(status: string) {
  return PROCUREMENT_STATUS_LABELS[status] ?? "采购状态未读取";
}

function procurementAbandonmentBlocker(input: {
  procurement: SpotProcurement;
  currentVersion: SpotProcurementVersion;
  allPayments: SpotProcurementPayment[];
  executionHistory: SpotProcurementPaymentExecution[];
  approvalInstances: ApprovalInstance[];
  receipt: Pick<
    SpotProcurementReceipt,
    "status" | "firstSubmittedAt" | "submittedAt" | "invalidatedAt"
  > | null;
  discrepancy: SpotProcurementDiscrepancy | null;
  refunds: SpotProcurementRefund[];
  reservations: Array<{ status: string }>;
  paymentArchives: SpotProcurementPaymentArchive[];
}) {
  if (
    input.procurement.status !== "draft" ||
    input.currentVersion.status !== "draft"
  ) {
    return "当前采购应使用撤销或异常终止";
  }
  if (
    input.allPayments.some(
      (payment) =>
        payment.submittedAt !== null ||
        !["draft", "invalidated"].includes(payment.status)
    ) ||
    input.approvalInstances.some(
      (approval) =>
        approval.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment
    )
  ) {
    return "已形成正式付款申请，不能放弃";
  }
  if (input.executionHistory.length > 0) {
    return "已发生实际付款历史，不能放弃";
  }
  if (input.reservations.some((reservation) => reservation.status === "executed")) {
    return "已执行供应商余额抵扣，不能放弃";
  }
  if (
    input.receipt &&
    input.receipt.invalidatedAt === null &&
    (input.receipt.firstSubmittedAt !== null ||
      input.receipt.submittedAt !== null ||
      input.receipt.status !== "draft")
  ) {
    return "收货单已提交或生效，不能放弃";
  }
  if (input.discrepancy) return "已形成收货差异事实，不能放弃";
  if (input.refunds.length > 0) return "已形成退款事实，不能放弃";
  if (input.paymentArchives.length > 0) return "已形成归档证据，不能放弃";
  return null;
}

function paymentStatusLabel(status: string) {
  return PAYMENT_STATUS_LABELS[status] ?? "付款状态未读取";
}

function versionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    approval_pending: "审批中",
    approved: "审批通过",
    returned: "已退回",
    withdrawn: "已撤回",
    invalidated: "已失效",
    abandoned: "已放弃"
  };
  return labels[status] ?? "版本状态未读取";
}

function companyPaymentStatusLabel(
  payment: Pick<
    SpotProcurementPayment,
    | "status"
    | "companyPaymentAmountCents"
    | "canceledCompanyPaymentAmountCents"
  >,
  actualPaidAmountCents: bigint
) {
  const approved = nonNegative(
    payment.companyPaymentAmountCents -
      payment.canceledCompanyPaymentAmountCents
  );
  if (approved === 0n) return "无需公司付款";
  if (actualPaidAmountCents === 0n) {
    return payment.status === "approved_pending_payment"
      ? "已批待付"
      : "尚未实际付款";
  }
  if (actualPaidAmountCents < approved) return "部分已付";
  return "已付";
}

function sumActiveExecutionsByPaymentId(
  executions: SpotProcurementPaymentExecution[]
) {
  const result = new Map<string, bigint>();
  for (const execution of executions) {
    if (execution.voidedAt !== null) continue;
    result.set(
      execution.paymentId,
      (result.get(execution.paymentId) ?? 0n) + execution.amountCents
    );
  }
  return result;
}

function voucherFact(
  executions: Array<
    Pick<SpotProcurementPaymentExecution, "id" | "voucherFileId">
  >,
  activeVoucherFileIds: ReadonlySet<string>,
  voucherFilesByExecutionId: ReadonlyMap<
    string,
    Array<{ fileId: string }>
  >
) {
  if (!executions.length) {
    return { status: "none", label: "暂无实付凭证" } as const;
  }
  if (
    executions.every(
      (execution) =>
        executionHasActiveVoucher(
          execution,
          activeVoucherFileIds,
          voucherFilesByExecutionId
        )
    )
  ) {
    return {
      status: "complete",
      label: "已上传实际付款凭证"
    } as const;
  }
  return {
    status: "anomaly",
    label: "实付记录的凭证缺失或已失效"
  } as const;
}

function executionHasActiveVoucher(
  execution: Pick<
    SpotProcurementPaymentExecution,
    "id" | "voucherFileId"
  >,
  activeVoucherFileIds: ReadonlySet<string>,
  voucherFilesByExecutionId: ReadonlyMap<
    string,
    Array<{ fileId: string }>
  >
) {
  const associatedVouchers =
    voucherFilesByExecutionId.get(execution.id) ?? [];
  if (associatedVouchers.length) {
    return associatedVouchers.some((voucher) =>
      activeVoucherFileIds.has(voucher.fileId)
    );
  }
  return Boolean(
    execution.voucherFileId &&
      activeVoucherFileIds.has(execution.voucherFileId)
  );
}

function paymentPathLabel(value: string | null) {
  if (value === "supplier_direct") return "公司直付供应商";
  if (value === "handler_reimbursement") return "经办人垫付报回";
  return "待确认支付路径";
}

function paymentMethodLabel(value: string | null) {
  const labels: Record<string, string> = {
    cash: "现金",
    wechat: "微信",
    alipay: "支付宝",
    bank_transfer: "银行转账",
    other: "其他"
  };
  return value ? labels[value] ?? "付款方式未读取" : "未选择";
}

function bankAccountLast4(value: string | null) {
  const normalized = value?.replace(/\s+/gu, "") ?? "";
  return normalized ? normalized.slice(-4) : null;
}

function moneyText(value: bigint | null) {
  return value?.toString() ?? "—";
}

function nonNegative(value: bigint) {
  return value > 0n ? value : 0n;
}

function isoOrNull(value: Date | null) {
  return value?.toISOString() ?? null;
}

function requiredQueryText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(message);
  }
  return value.trim();
}

function optionalQueryText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

interface ListPagination {
  page: number;
  pageSize: number;
  skip: number;
}

function listPagination(pageValue: unknown, pageSizeValue: unknown): ListPagination {
  const page = positiveInteger(pageValue, 1, "页码");
  const pageSize = positiveInteger(pageSizeValue, DEFAULT_PAGE_SIZE, "每页条数");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException(`每页最多查询 ${MAX_PAGE_SIZE} 条记录`);
  }
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function positiveInteger(value: unknown, fallback: number, label: string) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${label}必须为正整数`);
  }
  return parsed;
}

function lifecycleView(value: unknown): "active" | "ended" {
  const normalized = optionalQueryText(value) ?? "active";
  if (normalized !== "active" && normalized !== "ended") {
    throw new BadRequestException("生命周期视图筛选值不正确");
  }
  return normalized;
}

function paginationResult(pagination: ListPagination, total: number) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize)
  };
}

function emptyPagedList(pagination: ListPagination, view: "active" | "ended") {
  return {
    items: [],
    view,
    pagination: paginationResult(pagination, 0),
    statistics: { total: 0, byStatus: {} as Record<string, number> }
  };
}

function statusCounts(rows: Array<{ status: string }>) {
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return { total: rows.length, byStatus };
}

function groupBy<T>(
  rows: T[],
  key: (row: T) => string
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    const group = grouped.get(value) ?? [];
    group.push(row);
    grouped.set(value, group);
  }
  return grouped;
}
