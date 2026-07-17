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
  type SpotProcurementLine,
  type SpotProcurementPayment,
  type SpotProcurementPaymentExecution,
  type SpotProcurementVersion
} from "@prisma/client";
import {
  GLOBAL_BUSINESS_ROLE_KEYS,
  SPOT_PROCUREMENT_PAYMENT_STATUSES,
  SPOT_PROCUREMENT_STATUSES,
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
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const LIST_LIMIT = 200;
const LIST_SCAN_BATCH_SIZE = 200;
const LIST_SCAN_MAX_ROWS = 2_000;
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
  voided: "已撤销"
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
}

export interface SpotProcurementPaymentListQuery {
  projectId?: string;
  status?: string;
  keyword?: string;
}

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

  async listProcurements(
    actorUserId: string,
    query: SpotProcurementListQuery
  ) {
    const projectIds = await this.visibleProjectIdsForQuery(
      actorUserId,
      query.projectId
    );
    if (!projectIds.length) {
      return { items: [], truncated: false, limit: LIST_LIMIT };
    }
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
      : { ids: [] as string[], sourceTruncated: false };
    const where: Prisma.SpotProcurementWhereInput = {
      projectId: { in: projectIds },
      ...(status ? { status } : {}),
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
              { id: { in: keywordMatch.ids } }
            ]
          }
        : {})
    };
    const scan = await this.scanAccessibleProcurements(
      where,
      actorUserId
    );
    const truncated =
      keywordMatch.sourceTruncated ||
      scan.sourceTruncated ||
      scan.rows.length > LIST_LIMIT;
    const items = await this.procurementListItems(
      scan.rows.slice(0, LIST_LIMIT),
      actorUserId
    );

    return { items, truncated, limit: LIST_LIMIT };
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
      currentPdf
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
          templateKey: "approval_form"
        },
        orderBy: { createdAt: "desc" }
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
    const executionPaymentIds = allPayments.map((payment) => payment.id);
    const executions = executionPaymentIds.length
      ? await this.prisma.spotProcurementPaymentExecution.findMany({
          where: {
            paymentId: { in: executionPaymentIds },
            voidedAt: null
          },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }]
        })
      : [];
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
    const paymentRows = await this.paymentListItems(
      accessiblePayments,
      new Map([[project.id, project]]),
      new Map([[procurement.id, procurement]]),
      userById
    );
    const actualPaidByPaymentId = sumActiveExecutionsByPaymentId(executions);
    const paymentSummary = summarizePayments(
      accessiblePayments,
      actualPaidByPaymentId
    );
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
      executions,
      paymentSummary,
      currentPdfExists: Boolean(currentPdf)
    });
    const invoiceCoverageByProcurementId = this.invoiceLedger
      ? await this.invoiceLedger.coverageForProcurementIds([
          procurement.id
        ])
      : new Map();
    const invoiceCoverage =
      invoiceCoverageByProcurementId.get(procurement.id) ??
      invoiceCoverageUnavailable();
    const invoiceLedgerDetail = this.invoiceLedger
      ? await this.invoiceLedger.detailForProcurement(
          procurement.id
        )
      : invoiceLedgerDetailUnavailable();

    return {
      procurement: {
        id: procurement.id,
        code: procurement.code,
        project: projectSummary(project),
        supplierPartyId: procurement.supplierPartyId,
        supplierName: procurement.supplierNameSnapshot,
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
        approvedAmountCents: moneyText(procurement.approvedAmountCents),
        actualCostCents: null,
        actualCost: futureUnavailable(),
        closedAt: isoOrNull(procurement.closedAt),
        voidedAt: isoOrNull(procurement.voidedAt),
        voidReason: procurement.voidReason,
        createdAt: procurement.createdAt.toISOString(),
        updatedAt: procurement.updatedAt.toISOString()
      },
      currentVersion: versionReadModel(currentVersion),
      versions: versions.map(versionReadModel),
      lines: lines.map(lineReadModel),
      invoiceComposition: invoiceComposition(lines),
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
      paymentSummary: {
        ...paymentSummary,
        visibilityRestricted:
          accessiblePayments.length !== allPayments.length
      },
      receipt: futureUnavailable(),
      invoiceCoverage,
      invoiceLedger: invoiceLedgerDetail,
      discrepancy: futureUnavailable(),
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
        "收货确认、收货差异和发票覆盖将在代码阶段 B 开放"
      ]
    };
  }

  async listPayments(
    actorUserId: string,
    query: SpotProcurementPaymentListQuery
  ) {
    const projectIds = await this.visibleProjectIdsForQuery(
      actorUserId,
      query.projectId
    );
    if (!projectIds.length) {
      return { items: [], truncated: false, limit: LIST_LIMIT };
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
                procurementId: {
                  in: matchingProcurementIds
                }
              }
            ]
          }
        : {})
    };
    const scan = await this.scanAccessiblePayments(where, actorUserId);
    const truncated =
      keywordSourceTruncated ||
      scan.sourceTruncated ||
      scan.rows.length > LIST_LIMIT;
    const items = await this.paymentListItems(
      scan.rows.slice(0, LIST_LIMIT)
    );

    return { items, truncated, limit: LIST_LIMIT };
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
      approval
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

    const fileIds = [
      payment.supportingAttachmentFileId,
      payment.merchantPaymentProofFileId,
      ...executions.map((execution) => execution.voucherFileId)
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
    const voucher = voucherFact(activeExecutions, activeVoucherFileIds);
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
    const usesRealPaymentForm = Boolean(payment.paymentType);
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

    return {
      payment: {
        id: payment.id,
        code: payment.code,
        status: payment.status,
        statusLabel: paymentStatusLabel(payment.status),
        project: projectSummary(project),
        procurement: {
          id: procurement.id,
          code: procurement.code,
          supplierName: procurement.supplierNameSnapshot
        },
        procurementVersionId: payment.procurementVersionId,
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
        balanceOverrideReason: payment.balanceOverrideReason,
        handler: userSummary(
          payment.handlerUserId,
          userById,
          "采购经办人未读取"
        ),
        submittedAt: isoOrNull(payment.submittedAt),
        approvedAt: isoOrNull(payment.approvedAt),
        invalidatedAt: isoOrNull(payment.invalidatedAt),
        invalidatedReason: payment.invalidatedReason,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString()
      },
      procurementVersion: versionReadModel(version),
      approval: approvalSummary(approval),
      approvalTimeline: timeline,
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
      },
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
        active: execution.voidedAt === null
      })),
      evidenceFiles: this.paymentEvidenceFiles(
        payment,
        activeExecutions,
        fileById,
        userById
      ),
      invoiceCoverage,
      invoiceLedger: invoiceLedgerDetail,
      paymentInvoice,
      receipt: futureUnavailable(),
      paymentPdf: {
        available: approval?.status === "approved",
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        businessId: payment.id,
        disabledReason:
          approval?.status === "approved"
            ? null
            : "付款审批完成后才可下载正式审批单"
      },
      availableActions,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: [
        ...disabledActionReasons(availableActions),
        usesRealPaymentForm
          ? "历史结构化票据、无票确认和采购自动办结将在代码阶段 B 开放"
          : "发票覆盖、无票确认和采购自动办结将在代码阶段 B 开放"
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
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: LIST_SCAN_MAX_ROWS + 1
    });
    const sourceTruncated = versions.length > LIST_SCAN_MAX_ROWS;
    const candidateIds = [
      ...new Set(
        versions
          .slice(0, LIST_SCAN_MAX_ROWS)
          .map((version) => version.procurementId)
      )
    ];
    if (!candidateIds.length) {
      return { ids: [], sourceTruncated };
    }
    const procurements = await this.prisma.spotProcurement.findMany({
      where: {
        id: { in: candidateIds },
        projectId: { in: projectIds }
      },
      select: { id: true }
    });
    return {
      ids: procurements.map((procurement) => procurement.id),
      sourceTruncated
    };
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

    while (
      accessible.length <= LIST_LIMIT &&
      scannedRows < LIST_SCAN_MAX_ROWS
    ) {
      const batch = await this.prisma.spotProcurement.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIST_SCAN_BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (!batch.length) break;
      scannedRows += batch.length;
      const allowedIds = await this.access.accessibleProcurementIds(
        batch.map((row) => row.id),
        actorUserId
      );
      accessible.push(...batch.filter((row) => allowedIds.has(row.id)));
      if (batch.length < LIST_SCAN_BATCH_SIZE) break;
      cursorId = batch.at(-1)?.id;
      if (!cursorId) break;
      if (scannedRows >= LIST_SCAN_MAX_ROWS) {
        sourceTruncated = true;
        break;
      }
    }

    return {
      rows: accessible.slice(0, LIST_LIMIT + 1),
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

    while (
      accessible.length <= LIST_LIMIT &&
      scannedRows < LIST_SCAN_MAX_ROWS
    ) {
      const batch = await this.prisma.spotProcurementPayment.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIST_SCAN_BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (!batch.length) break;
      scannedRows += batch.length;
      const allowedIds = await this.access.accessiblePaymentIds(
        batch.map((row) => row.id),
        actorUserId
      );
      accessible.push(...batch.filter((row) => allowedIds.has(row.id)));
      if (batch.length < LIST_SCAN_BATCH_SIZE) break;
      cursorId = batch.at(-1)?.id;
      if (!cursorId) break;
      if (scannedRows >= LIST_SCAN_MAX_ROWS) {
        sourceTruncated = true;
        break;
      }
    }

    return {
      rows: accessible.slice(0, LIST_LIMIT + 1),
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
    const [projects, versions, lines, payments, approvals] =
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
          : Promise.resolve([])
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
      return [
        {
          id: row.id,
          code: row.code,
          project: projectSummary(project),
          supplierPartyId: row.supplierPartyId,
          supplierName: row.supplierNameSnapshot,
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
            invoiceCoverageUnavailable(),
          status: row.status,
          statusLabel: procurementStatusLabel(row.status),
          approval: approvalSummary(
            approvalByBusinessId.get(version.id) ?? null
          ),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        }
      ];
    });
  }

  private async paymentListItems(
    rows: SpotProcurementPayment[],
    suppliedProjects?: Map<string, ProjectSummary>,
    suppliedProcurements?: Map<string, SpotProcurement>,
    suppliedUsers?: Map<string, UserNameRow>
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
      activeExecutions
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
          select: { id: true, procurementId: true }
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
        })
      ]);
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
        activeExecutions.flatMap((execution) =>
          execution.voucherFileId ? [execution.voucherFileId] : []
        )
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
    const executionsByPaymentId = groupBy(
      activeExecutions,
      (execution) => execution.paymentId
    );
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
      const voucher = voucherFact(rowExecutions, activeVoucherFileIds);
      return [
        {
          id: row.id,
          code: row.code,
          procurement: {
            id: procurement.id,
            code: procurement.code,
            supplierName: procurement.supplierNameSnapshot
          },
          project: projectSummary(project),
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
            nonNegative(effectiveCompany - actualPaidAmountCents)
          ),
          executedSupplierBalanceAmountCents: moneyText(
            row.executedSupplierBalanceAmountCents
          ),
          canceledAmountCents: moneyText(row.canceledAmountCents),
          status: row.status,
          statusLabel: paymentStatusLabel(row.status),
          companyPaymentStatusLabel: companyPaymentStatusLabel(
            row,
            actualPaidAmountCents
          ),
          approval: approvalSummary(
            approvalByBusinessId.get(row.id) ?? null
          ),
          handler: userSummary(
            row.handlerUserId,
            userById,
            "采购经办人未读取"
          ),
          voucherStatus: voucher.status,
          voucherStatusLabel: voucher.label,
          paymentFactConsistent:
            row.paidAmountCents === actualPaidAmountCents,
          invoiceCoverage:
            invoiceCoverageByPaymentId.get(row.id) ??
            invoiceCoverageUnavailable(),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
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
    executions: SpotProcurementPaymentExecution[];
    paymentSummary: ReturnType<typeof summarizePayments>;
    currentPdfExists: boolean;
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
    const canCreatePayment = false;
    const canCreateVersion =
      !["closed", "voided"].includes(input.procurement.status) &&
      ["approved", "rejected"].includes(input.currentVersion.status) &&
      isOwner &&
      canCreate &&
      !hasActualPayment &&
      input.activePayments.length === 0;

    return [
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
        key: "create_payment",
        label: "新建后续付款申请",
        kind: "primary",
        roleKeys: input.roleKeys,
        requiredAction: "spot_procurement.payment.submit",
        enabled: canCreatePayment,
        disabledReason:
          "采购批准后，仅采购经办人可在剩余金额内创建付款"
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

function invoiceComposition(lines: SpotProcurementLine[]) {
  const modes = new Set(lines.map((line) => line.invoiceMode));
  if (modes.has("invoice") && modes.has("no_invoice")) return "mixed";
  if (modes.has("invoice")) return "invoice";
  if (modes.has("no_invoice")) return "no_invoice";
  return "unknown";
}

function versionReadModel(version: SpotProcurementVersion) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    status: version.status,
    statusLabel: versionStatusLabel(version.status),
    reason: version.reason,
    note: version.note,
    supplierPartyId: version.supplierPartyId,
    supplierName: version.supplierNameSnapshot,
    handlerUserId: version.handlerUserId,
    totalAmountCents: moneyText(version.totalAmountCents),
    changeReason: version.changeReason,
    changeSummary: version.changeSummary,
    submittedAt: isoOrNull(version.submittedAt),
    approvedAt: isoOrNull(version.approvedAt),
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString()
  };
}

function lineReadModel(line: SpotProcurementLine) {
  return {
    id: line.id,
    sortOrder: line.sortOrder,
    materialName: line.materialName,
    specification: line.specification,
    unit: line.unit,
    quantity: line.quantity.toString(),
    invoiceMode: line.invoiceMode,
    invoiceType: line.invoiceType,
    vatRateOptionId: line.vatRateOptionId,
    vatRateValue: line.vatRateValueSnapshot?.toString() ?? null,
    vatRateLabel: line.vatRateLabelSnapshot,
    unitPrice: line.unitPrice?.toString() ?? null,
    amountCents: moneyText(line.amountCents),
    usageLocation: line.usageLocation,
    note: line.note
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
    invalidated: "已失效"
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
    Pick<SpotProcurementPaymentExecution, "voucherFileId">
  >,
  activeVoucherFileIds: ReadonlySet<string>
) {
  if (!executions.length) {
    return { status: "none", label: "暂无实付凭证" } as const;
  }
  if (
    executions.every(
      (execution) =>
        Boolean(execution.voucherFileId) &&
        activeVoucherFileIds.has(execution.voucherFileId as string)
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
