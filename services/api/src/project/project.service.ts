import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  moneyCentsToApi,
  outstandingMoneyRequestCentsBigInt,
  parseMoneyCents,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "../payment/contract-takeover-balance";
import {
  calculateContractDuePaymentCapacityBigInt,
  calculateSettlementPaymentCapacityBigInt,
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES
} from "../payment/settlement-payment-capacity";
import type {
  RecordProjectProxyPaymentDto,
  ProjectProxyPaymentType
} from "./dto/record-project-proxy-payment.dto";
import type { ConfirmProjectOwnerContractDto } from "./dto/confirm-project-owner-contract.dto";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { RecordProjectOwnerContractDto } from "./dto/record-project-owner-contract.dto";
import type { RecordProjectReceiptDto, ProjectReceiptSourceType } from "./dto/record-project-receipt.dto";
import type { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import type { RequestProjectFinancingQuotaDto } from "./dto/request-project-financing-quota.dto";
import type { RequestSettlementExceptionQuotaDto } from "./dto/request-settlement-exception-quota.dto";
import type { ReviewProjectFinancingQuotaDto } from "./dto/review-project-financing-quota.dto";
import type { ReviewSettlementExceptionQuotaDto } from "./dto/review-settlement-exception-quota.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";

const UPSTREAM_SETTLEMENT_GAP =
  "缺少对上结算/业主审定台账，当前经营收入和毛利为实际收款与总包代付发生口径。";
const FINANCING_LIMIT_GAP = "缺少项目垫资额度台账，当前可用资金未包含批准垫资额度。";
const FUNDS_OVERVIEW_POSITIONS = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
]);
const PROJECT_OPTION_POSITIONS = new Set<RoleKey>([
  ...FUNDS_OVERVIEW_POSITIONS,
  "contract_staff",
  "contract_director",
  "budget_staff",
  "budget_director"
]);
const ROSTER_ALL_PROJECT_ROLES = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "project_manager",
  "contract_director",
  "budget_director",
  "finance_director",
  "material_director",
  "engineering_director",
  "comprehensive_director"
]);
const ROLE_LABELS: Record<RoleKey, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "工长",
  engineering_tech: "工程技术部",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};
const RECEIPT_SOURCE_LABELS: Record<ProjectReceiptSourceType, string> = {
  general_contractor_payment: "总包付款",
  owner_direct_payment: "甲方直付",
  other: "其他"
};
const PROXY_PAYMENT_TYPE_LABELS: Record<ProjectProxyPaymentType, string> = {
  material: "材料",
  equipment: "机械",
  labor: "劳务",
  professional_subcontract: "专业分包",
  other: "其他"
};
const EFFECTIVE_SETTLEMENT_STATUSES = new Set(["effective", "partially_paid", "paid"]);
interface SettlementExceptionQuotaApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
}

const SETTLEMENT_EXCEPTION_QUOTA_APPROVAL_NODES: SettlementExceptionQuotaApprovalNode[] = [
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "合同/预算负责人", mode: "any", roleKeys: ["contract_director", "budget_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
];
const PROJECT_FINANCING_QUOTA_APPROVAL_NODES: SettlementExceptionQuotaApprovalNode[] = [
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
];

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService
  ) {}

  async createProject(actorUserId: string, input: CreateProjectDto) {
    const code = requiredTrimmed(input.code, "Project code is required");
    const name = requiredTrimmed(input.name, "Project name is required");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: { code, name },
          select: { id: true, code: true, name: true }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "project.create",
          businessType: "project",
          businessId: project.id,
          metadata: { code, name }
        });

        return project;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("Project code already exists");
      }
      throw error;
    }
  }

  async updateProject(projectId: string, actorUserId: string, input: UpdateProjectDto) {
    const name = requiredTrimmed(input.name, "Project name is required");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.update({
          where: { id: projectId },
          data: { name },
          select: { id: true, code: true, name: true }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "project.update",
          businessType: "project",
          businessId: project.id,
          metadata: { name }
        });

        return project;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("Project not found");
      }
      throw error;
    }
  }

  async listActiveOptions(userId: string) {
    const [globalUserPositions, projectUserPositions, projectMemberPositions] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalUserPositions, ...projectUserPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const hasGlobalProjectOptionAccess = globalUserPositions.some((position) =>
      isProjectOptionPosition(positionKeyById.get(position.positionId))
    );

    if (hasGlobalProjectOptionAccess) {
      return this.findActiveProjectOptions();
    }

    const visibleProjectIds = unique([
      ...projectUserPositions
        .filter((position) => isProjectOptionPosition(positionKeyById.get(position.positionId)))
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMemberPositions
        .filter((position) => isProjectOptionPosition(position.positionKey as RoleKey))
        .map((position) => position.projectId)
    ]);

    if (!visibleProjectIds.length) {
      return [];
    }

    return this.findActiveProjectOptions({ id: { in: visibleProjectIds } });
  }

  async listContractCreateOptions(userId: string) {
    const [globalUserPositions, projectUserPositions, projectMemberPositions, activeProjects] =
      await Promise.all([
        this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
        this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
        this.prisma.projectMember.findMany({ where: { userId } }),
        this.prisma.project.findMany({
          where: { isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: [{ code: "asc" }, { name: "asc" }]
        })
      ]);
    const positionIds = Array.from(
      new Set([...globalUserPositions, ...projectUserPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalUserPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));

    return activeProjects.filter((project) => {
      const projectRoleKeys = [
        ...projectUserPositions
          .filter((position) => position.projectId === project.id)
          .map((position) => positionKeyById.get(position.positionId))
          .filter((role): role is RoleKey => Boolean(role)),
        ...projectMemberPositions
          .filter((member) => member.projectId === project.id)
          .map((member) => member.positionKey as RoleKey)
      ];
      return canPerform("contract.create", resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys));
    });
  }

  private findActiveProjectOptions(extraWhere: object = {}) {
    return this.prisma.project.findMany({
      where: { isActive: true, ...extraWhere },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  }

  async listRoster(userId: string) {
    const [globalUserPositions, projectUserPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } })
    ]);
    const positionIds = unique([...globalUserPositions, ...projectUserPositions].map((position) => position.positionId));
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const canSeeAllProjects = globalUserPositions.some((position) =>
      ROSTER_ALL_PROJECT_ROLES.has(positionKeyById.get(position.positionId) as RoleKey)
    );
    const scopedProjectIds = unique([
      ...projectUserPositions.map((position) => position.projectId).filter((id): id is string => !!id),
      ...projectMembers.map((member) => member.projectId)
    ]);

    if (!canSeeAllProjects && !scopedProjectIds.length) return [];

    const projects = await this.prisma.project.findMany({
      where: { isActive: true, ...(canSeeAllProjects ? {} : { id: { in: scopedProjectIds } }) },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
    const projectIds = projects.map((project) => project.id);
    if (!projectIds.length) return [];

    const memberRows = await this.prisma.projectMember.findMany({ where: { projectId: { in: projectIds } } });
    const userIds = unique(memberRows.map((member) => member.userId));
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { id: true, name: true, phone: true }
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const rolesByProjectUser = new Map<string, Set<RoleKey>>();
    const addRole = (projectId: string, rowUserId: string, roleKey: RoleKey | undefined) => {
      if (!roleKey) return;
      const key = `${projectId}:${rowUserId}`;
      const next = new Set(rolesByProjectUser.get(key));
      next.add(roleKey);
      rolesByProjectUser.set(key, next);
    };

    memberRows.forEach((member) => addRole(member.projectId, member.userId, member.positionKey as RoleKey));

    return Array.from(rolesByProjectUser.entries())
      .map(([key, roleKeys]) => {
        const [projectId, rowUserId] = key.split(":");
        const project = projectById.get(projectId);
        const user = userById.get(rowUserId);
        if (!project || !user) return null;
        const positions = Array.from(roleKeys);
        return {
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          userId: user.id,
          name: user.name,
          phone: user.phone ?? "",
          positionKeys: positions,
          positionNames: positions.map((role) => ROLE_LABELS[role] ?? role)
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => `${left.projectCode}-${left.name}`.localeCompare(`${right.projectCode}-${right.name}`, "zh-CN"));
  }

  async getOperatingFundsOverview(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true, code: true, name: true }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const [
      contracts,
      settlements,
      payments,
      financeRecords,
      projectReceipts,
      projectProxyPayments,
      projectUpstreamSettlements,
      projectFinancingQuotas,
      projectExpenseRequests
    ] = await Promise.all([
      this.prisma.contract.findMany({
        where: { projectId, voidedAt: null },
        select: { id: true }
      }),
      this.prisma.settlement.findMany({
        where: { projectId },
        select: { status: true, amountCents: true, payableAmountCents: true }
      }),
      this.prisma.paymentRequest.findMany({
        where: { projectId },
        select: {
          id: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      this.prisma.financeRecord.findMany({
        where: { projectId, direction: "outflow" },
        select: { amountCents: true }
      }),
      this.prisma.projectReceipt.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      this.prisma.projectProxyPayment.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      this.prisma.projectUpstreamSettlement.findMany({
        where: { projectId, voidedAt: null },
        select: { approvedAmountCents: true }
      }),
      this.prisma.projectFinancingQuota.findMany({
        where: { projectId, status: "approved", validUntil: { gte: new Date() } },
        select: { id: true, amountCents: true }
      }),
      this.prisma.projectExpenseRequest.findMany({
        where: { projectId, voidedAt: null },
        select: {
          id: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      })
    ]);
    const contractIds = contracts.map((contract) => contract.id);
    const paymentIds = payments.map((payment) => payment.id);
    const expenseRequestIds = projectExpenseRequests.map((request) => request.id);
    const contractVersions = contractIds.length
      ? await this.prisma.contractVersion.findMany({
          where: { contractId: { in: contractIds }, status: "effective" },
          select: { contractId: true, versionNo: true, amountCents: true }
        })
      : [];
    const latestEffectiveContractVersions = latestByContract(contractVersions);
    const effectiveSettlements = settlements.filter((settlement) => settlement.status === "effective");
    const executions = paymentIds.length
      ? await this.prisma.paymentExecution.findMany({
          where: { paymentRequestId: { in: paymentIds } },
          select: { amountCents: true }
        })
      : [];
    const expenseExecutions = expenseRequestIds.length
      ? await this.prisma.projectExpenseExecution.findMany({
          where: { projectExpenseRequestId: { in: expenseRequestIds } },
          select: { amountCents: true }
        })
      : [];
    const financingQuotaIds = projectFinancingQuotas.map((quota) => quota.id);
    const [paymentFinancingUsages, expenseFinancingUsages] = financingQuotaIds.length
      ? await Promise.all([
          this.prisma.projectFinancingQuotaUsage.findMany({
            where: { quotaId: { in: financingQuotaIds }, status: { in: ["occupied", "used"] } },
            select: { quotaId: true, amountCents: true }
          }),
          this.prisma.projectExpenseFinancingQuotaUsage.findMany({
            where: { quotaId: { in: financingQuotaIds }, status: { in: ["occupied", "used"] } },
            select: { quotaId: true, amountCents: true }
          })
        ])
      : [[], []];
    const financingUsageByQuotaId = [...paymentFinancingUsages, ...expenseFinancingUsages].reduce(
      (totals, usage) => {
        totals.set(
          usage.quotaId,
          (totals.get(usage.quotaId) ?? 0n) +
            dbMoneyToBigInt(usage.amountCents, "垫资额度占用金额")
        );
        return totals;
      },
      new Map<string, bigint>()
    );
    const actualReceiptsCents = sumDbMoneyToBigInt(
      projectReceipts.map((receipt) => receipt.amountCents),
      "项目实收金额"
    );
    const proxyPaymentCents = sumDbMoneyToBigInt(
      projectProxyPayments.map((payment) => payment.amountCents),
      "项目代付金额"
    );
    const upstreamSettlementCents = sumDbMoneyToBigInt(
      projectUpstreamSettlements.map((settlement) => settlement.approvedAmountCents),
      "对上结算金额"
    );
    const availableFinancingCents = sumDbMoneyToBigInt(
      projectFinancingQuotas.map((quota) => {
        const available =
          dbMoneyToBigInt(quota.amountCents, "项目垫资额度") -
          (financingUsageByQuotaId.get(quota.id) ?? 0n);
        return available > 0n ? available : 0n;
      }),
      "项目可用垫资额度"
    );
    const actualPaidCents = sumDbMoneyToBigInt(
      [
        ...executions.map((execution) => execution.amountCents),
        ...expenseExecutions.map((execution) => execution.amountCents)
      ],
      "项目实付金额"
    );
    const operatingIncomeCents = projectUpstreamSettlements.length
      ? upstreamSettlementCents
      : actualReceiptsCents + proxyPaymentCents;
    const operatingCostCents = actualPaidCents + proxyPaymentCents;
    const projectRequests = [...payments, ...projectExpenseRequests];
    const approvalPendingOccupancyCents = sumDbMoneyToBigInt(
      projectRequests
        .filter((request) => request.status === "approval_pending")
        .map((request) => request.requestedAmountCents),
      "审批中资金占用"
    );
    const approvedPendingPaymentCents = projectRequests
      .filter((request) =>
        ["approved_pending_payment", "partially_paid"].includes(request.status)
      )
      .reduce<bigint>(
        (total, request) => total + outstandingMoneyRequestCentsBigInt(request),
        0n
      );
    const availableFundsCents =
      actualReceiptsCents -
      actualPaidCents -
      approvalPendingOccupancyCents -
      approvedPendingPaymentCents +
      availableFinancingCents;
    const dataGaps = [
      ...(projectUpstreamSettlements.length ? [] : [UPSTREAM_SETTLEMENT_GAP]),
      ...(projectFinancingQuotas.length ? [] : [FINANCING_LIMIT_GAP])
    ];

    return {
      project,
      cash: {
        actualReceiptsCents: projectMoneyToApi(actualReceiptsCents),
        availableFundsCents: projectMoneyToApi(availableFundsCents),
        actualPaidCents: projectMoneyToApi(actualPaidCents),
        approvalPendingOccupancyCents: projectMoneyToApi(approvalPendingOccupancyCents),
        approvedPendingPaymentCents: projectMoneyToApi(approvedPendingPaymentCents),
        financeRecordedOutflowCents: projectMoneyToApi(
          sumDbMoneyToBigInt(
            financeRecords.map((record) => record.amountCents),
            "财务入账流出金额"
          )
        )
      },
      business: {
        effectiveContractAmountCents: projectMoneyToApi(
          sumDbMoneyToBigInt(
            latestEffectiveContractVersions.map((version) => version.amountCents),
            "生效合同金额"
          )
        ),
        effectiveSettlementAmountCents: projectMoneyToApi(
          sumDbMoneyToBigInt(
            effectiveSettlements.map((settlement) => settlement.amountCents),
            "生效结算金额"
          )
        ),
        payableSettlementAmountCents: projectMoneyToApi(
          sumDbMoneyToBigInt(
            effectiveSettlements.map((settlement) => settlement.payableAmountCents),
            "结算应付金额"
          )
        ),
        operatingIncomeCents: projectMoneyToApi(operatingIncomeCents),
        operatingCostCents: projectMoneyToApi(operatingCostCents),
        grossProfitCents: projectMoneyToApi(operatingIncomeCents - operatingCostCents)
      },
      counts: {
        contracts: contracts.length,
        settlements: settlements.length,
        payments: payments.length
      },
      dataGaps
    };
  }

  async recordReceipt(projectId: string, actorUserId: string, input: RecordProjectReceiptDto) {
    const amountCents = normalizePositiveMoneyCents(input.amountCents, "Receipt amount must be greater than zero");
    const receivedAt = parseReceiptDate(input.receivedAt);
    const payerName = requiredTrimmed(input.payerName, "Receipt payer is required");
    const sourceType = normalizeSourceType(input.sourceType);
    const voucherFileId = requiredTrimmed(input.voucherFileId, "Receipt voucher file is required");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Receipt confirmation password is required"
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;

    if (!this.auth) {
      throw new Error("Auth service is required to confirm project receipt");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("Project not found");
      }

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("Receipt voucher file not found");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("Receipt voucher file must be uploaded by the recorder");
      }

      const receipt = await tx.projectReceipt.create({
        data: {
          projectId: project.id,
          receivedAt,
          amountCents,
          payerName,
          sourceType,
          description,
          voucherFileId,
          recordedByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.receipt.record",
        businessType: "project_receipt",
        businessId: receipt.id,
        metadata: {
          projectId: project.id,
          receiptId: receipt.id,
          amountCents: moneyCentsToApi(amountCents),
          sourceType,
          payerName,
          voucherFileId
        }
      });

      return toReceiptReadModel(receipt);
    });
  }

  async recordProxyPayment(projectId: string, actorUserId: string, input: RecordProjectProxyPaymentDto) {
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "总包代付金额必须大于 0"
    );
    const paidAt = parseProxyPaymentDate(input.paidAt);
    const generalContractorName = requiredTrimmed(
      input.generalContractorName,
      "请填写总包单位"
    );
    const paidTargetName = requiredTrimmed(input.paidTargetName, "请填写代付对象");
    const paymentType = normalizeProxyPaymentType(input.paymentType);
    const voucherFileId = requiredTrimmed(input.voucherFileId, "请上传总包代付凭证");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码后再登记总包代付"
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;
    const requestedContractId = optionalTrimmed(input.contractId);
    const requestedSettlementId = optionalTrimmed(input.settlementId);

    if (!this.auth) {
      throw new Error("总包代付确认服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      }

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("代付凭证不存在，请重新上传");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("只能使用本人上传的代付凭证");
      }

      let linkedContractId = requestedContractId ?? null;
      let linkedSettlementId = requestedSettlementId ?? null;
      let contractDueCapacityChecked = false;

      if (requestedContractId) {
        const contract = await tx.contract.findFirst({
          where: {
            projectId: project.id,
            voidedAt: null,
            OR: [
              { id: requestedContractId },
              { code: requestedContractId },
              { temporaryCode: requestedContractId }
            ]
          },
          select: { id: true }
        });

        if (!contract) {
          throw new NotFoundException("关联合同不属于当前项目，请重新选择");
        }

        linkedContractId = contract.id;
      }

      if (requestedSettlementId) {
        const settlement = await tx.settlement.findFirst({
          where: {
            projectId: project.id,
            OR: [{ id: requestedSettlementId }, { code: requestedSettlementId }]
          },
          select: {
            id: true,
            contractId: true,
            status: true
          }
        });

        if (!settlement) {
          throw new NotFoundException("关联合同结算不属于当前项目，请重新选择");
        }

        if (!EFFECTIVE_SETTLEMENT_STATUSES.has(settlement.status)) {
          throw new BadRequestException("关联合同结算尚未归档生效，不能登记总包代付");
        }

        if (linkedContractId && settlement.contractId !== linkedContractId) {
          throw new BadRequestException("关联合同结算与所选合同不一致，请重新选择");
        }

        linkedSettlementId = settlement.id;
        linkedContractId = settlement.contractId;
        await this.assertContractDueProxyPaymentCapacity(tx, linkedContractId, amountCents);
        contractDueCapacityChecked = true;

        const lockedSettlement = await tx.settlement.findFirst({
          where: {
            id: settlement.id,
            status: { in: [...EFFECTIVE_SETTLEMENT_STATUSES] }
          },
          select: {
            id: true,
            payableAmountCents: true,
            paidAmountCents: true
          }
        });

        if (!lockedSettlement) {
          throw new BadRequestException("关联合同结算尚未归档生效，不能登记总包代付");
        }

        const [existingProxyPayments, paymentRequests] = await Promise.all([
          tx.projectProxyPayment.findMany({
            where: { settlementId: lockedSettlement.id, voidedAt: null },
            select: { amountCents: true }
          }),
          tx.paymentRequest.findMany({
            where: {
              settlementId: lockedSettlement.id,
              status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES] }
            },
            select: {
              status: true,
              requestedAmountCents: true,
              approvedAmountCents: true,
              paidAmountCents: true
            }
          })
        ]);
        const proxyPaidCents = sumDbMoneyToBigInt(
          existingProxyPayments.map((payment) => payment.amountCents),
          "项目代付金额"
        );
        const capacity = calculateSettlementPaymentCapacityBigInt({
          payableAmountCents: lockedSettlement.payableAmountCents,
          actualPaidAmountCents: lockedSettlement.paidAmountCents,
          proxyPaidAmountCents: proxyPaidCents,
          paymentRequests
        });

        if (dbMoneyToBigInt(amountCents, "本次总包代付金额") > capacity.remainingCents) {
          throw new BadRequestException(
            `本次总包代付超过结算剩余可付金额，当前最多可代付 ${formatMoneyCentsAsYuan(
              capacity.remainingCents > 0n ? capacity.remainingCents : 0n
            )} 元`
          );
        }
      }

      if (linkedContractId && !contractDueCapacityChecked) {
        await this.assertContractDueProxyPaymentCapacity(tx, linkedContractId, amountCents);
      }

      const proxyPayment = await tx.projectProxyPayment.create({
        data: {
          projectId: project.id,
          paidAt,
          amountCents,
          generalContractorName,
          paidTargetName,
          paymentType,
          description,
          voucherFileId,
          recordedByUserId: actorUserId,
          contractId: linkedContractId,
          settlementId: linkedSettlementId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.proxy_payment.record",
        businessType: "project_proxy_payment",
        businessId: proxyPayment.id,
        metadata: {
          projectId: project.id,
          proxyPaymentId: proxyPayment.id,
          amountCents: moneyCentsToApi(amountCents),
          paymentType,
          generalContractorName,
          paidTargetName,
          voucherFileId,
          contractId: linkedContractId,
          settlementId: linkedSettlementId
        }
      });

      return toProxyPaymentReadModel(proxyPayment);
    });
  }

  private async historicalBalanceForProxyPaymentContract(
    tx: Prisma.TransactionClient,
    contractId: string
  ) {
    const clients = tx as unknown as {
      contract?: {
        findUnique(args: {
          where: { id: string };
          select: { source: true };
        }): Promise<{ source?: string | null } | null>;
      };
      contractTakeover?: {
        findFirst(args: {
          where: { contractId: string };
          select: typeof CONTRACT_TAKEOVER_BALANCE_SELECT;
        }): Promise<ContractTakeoverBalanceRow | null>;
      };
    };

    const [contract, takeover] = await Promise.all([
      clients.contract?.findUnique
        ? clients.contract.findUnique({
            where: { id: contractId },
            select: { source: true }
          })
        : Promise.resolve(null),
      clients.contractTakeover?.findFirst
        ? clients.contractTakeover.findFirst({
            where: { contractId },
            select: CONTRACT_TAKEOVER_BALANCE_SELECT
          })
        : Promise.resolve(null)
    ]);

    if (takeover) {
      if (takeover.takeoverStatus !== "confirmed") {
        throw new BadRequestException("历史合同接管尚未主管确认，不能登记总包代付");
      }
      if (!takeover.historicalBalanceConfirmedAt) {
        throw new BadRequestException("历史接管余额尚未确认，不能登记总包代付");
      }
      return toHistoricalContractPaymentBalance(takeover);
    }

    if (contract?.source === "historical_takeover") {
      throw new BadRequestException("历史合同接管记录缺失或尚未确认，不能登记总包代付");
    }

    return undefined;
  }

  private async assertContractDueProxyPaymentCapacity(
    tx: Prisma.TransactionClient,
    contractId: string,
    amountCents: bigint
  ): Promise<void> {
    const clients = tx as unknown as {
      $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T>;
      settlement?: {
        findMany?: (args: {
          where: { contractId: string; status: { in: string[] } };
          select: {
            id: true;
            status: true;
            amountCents: true;
            paidAmountCents: true;
            contractVersionId: true;
            isFinal: true;
            paymentTermsVersionId: true;
          };
        }) => Promise<
          Array<{
            id: string;
            status: string;
            amountCents: number;
            paidAmountCents: number;
            contractVersionId?: string;
            isFinal: boolean;
            paymentTermsVersionId: string;
          }>
        >;
      };
      paymentTermsStage?: {
        findMany: (args: {
          where: {
            paymentTermsVersionId: { in: string[] };
            OR: Array<{ basis?: string; stageType?: string }>;
          };
          select: {
            paymentTermsVersionId: true;
            stageType: true;
            basis: true;
            ratioBps: true;
            fixedAmountCents: true;
            triggerAnchor: true;
            dueDays: true;
            advanceDeductionMode: true;
            advanceDeductionRatioBps: true;
            advanceDeductionStartRatioBps: true;
          };
        }) => Promise<
          Array<{
            paymentTermsVersionId: string;
            stageType: string;
            basis: string;
            ratioBps: number | null;
            fixedAmountCents: number | null;
            triggerAnchor: string;
            dueDays: number;
            advanceDeductionMode: string | null;
            advanceDeductionRatioBps: number | null;
            advanceDeductionStartRatioBps: number | null;
          }>
        >;
      };
      contractVersion?: {
        findMany: (args: {
          where: { id: { in: string[] } };
          select: { id: true; amountCents: true };
        }) => Promise<Array<{ id: string; amountCents: number | bigint }>>;
      };
      settlementArchiveFile?: {
        findMany: (args: {
          where: { settlementId: { in: string[] }; status: string; confirmedAt: { not: null } };
          select: { settlementId: true; confirmedAt: true };
        }) => Promise<Array<{ settlementId: string; confirmedAt: Date | null }>>;
      };
    };

    if (
      !clients.$queryRaw ||
      !clients.settlement?.findMany ||
      !clients.paymentTermsStage ||
      !clients.settlementArchiveFile
    ) {
      throw new Error("总包代付容量检查服务暂不可用，请稍后重试或联系管理员");
    }

    await clients.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${contractId}
      FOR UPDATE
    `);

    await clients.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Settlement"
      WHERE "contractId" = ${contractId}
        AND "status" IN (${Prisma.join([...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES])})
      FOR UPDATE
    `);
    const historicalBalance = await this.historicalBalanceForProxyPaymentContract(tx, contractId);

    const contractSettlements = await clients.settlement.findMany({
      where: {
        contractId,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        paidAmountCents: true,
        contractVersionId: true,
        isFinal: true,
        paymentTermsVersionId: true
      }
    });
    const settlementIds = contractSettlements.map((settlement) => settlement.id);
    const paymentTermsVersionIds = [
      ...new Set([
        ...contractSettlements.map((settlement) => settlement.paymentTermsVersionId),
        ...(historicalBalance?.paymentTermsVersionId ? [historicalBalance.paymentTermsVersionId] : [])
      ])
    ];

    if (!paymentTermsVersionIds.length) {
      throw new BadRequestException("当前合同没有可用于总包代付的有效结算或历史期初余额，请先核对结算归档和接管余额");
    }

    const [
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests,
      advancePaymentRequests,
      proxyPayments,
      contractVersion
    ] = await Promise.all([
      clients.paymentTermsStage.findMany({
        where: {
          paymentTermsVersionId: { in: paymentTermsVersionIds },
          OR: [{ basis: "current_settlement" }, { stageType: "advance" }]
        },
        select: {
          paymentTermsVersionId: true,
          stageType: true,
          basis: true,
          ratioBps: true,
          fixedAmountCents: true,
          triggerAnchor: true,
          dueDays: true,
          advanceDeductionMode: true,
          advanceDeductionRatioBps: true,
          advanceDeductionStartRatioBps: true
        }
      }),
      clients.settlementArchiveFile.findMany({
        where: {
          settlementId: { in: settlementIds },
          status: "confirmed",
          confirmedAt: { not: null }
        },
        select: { settlementId: true, confirmedAt: true }
      }),
      tx.paymentRequest.findMany({
        where: {
          contractId,
          sourceType: { in: ["settlement", "contract_due"] },
          status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES, "paid"] }
        },
        select: {
          settlementId: true,
          sourceType: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      tx.paymentRequest.findMany({
        where: {
          contractId,
          sourceType: "contract_advance",
          paymentTermsVersionId: { in: paymentTermsVersionIds },
          paidAmountCents: { gt: 0 }
        },
        select: {
          paymentTermsVersionId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      tx.projectProxyPayment.findMany({
        where: {
          voidedAt: null,
          OR: [{ contractId }, { settlementId: { in: settlementIds } }]
        },
        select: { amountCents: true }
      }),
      clients.contractVersion
        ? clients.contractVersion.findMany({
            where: {
              id: {
                in: [
                  ...new Set(
                    contractSettlements
                      .map((settlement) => settlement.contractVersionId)
                      .filter(Boolean)
                  )
                ] as string[]
              }
            },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([])
    ]);
    const amountByVersionId = new Map(contractVersion.map((version) => [version.id, version.amountCents]));
    const fallbackContractAmountCents = sumDbMoneyToBigInt(
      contractSettlements.map((settlement) => settlement.amountCents),
      "合同结算金额"
    );
    const contractAmountCentsByPaymentTermsVersionId = contractSettlements.reduce<Record<string, number | bigint>>(
      (amountByTermsId, settlement) => ({
        ...amountByTermsId,
        [settlement.paymentTermsVersionId]:
          (settlement.contractVersionId
            ? amountByVersionId.get(settlement.contractVersionId)
            : undefined) ?? fallbackContractAmountCents
      }),
      {}
    );

    const capacity = calculateContractDuePaymentCapacityBigInt({
      asOf: new Date(),
      settlements: contractSettlements,
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests,
      proxyPaidAmountCents: sumDbMoneyToBigInt(
        proxyPayments.map((payment) => payment.amountCents),
        "项目代付金额"
      ),
      contractAmountCents: fallbackContractAmountCents,
      contractAmountCentsByPaymentTermsVersionId,
      advancePaymentRequests,
      historicalBalance
    });

    if (dbMoneyToBigInt(amountCents, "本次总包代付金额") > capacity.remainingCents) {
      throw new BadRequestException(
        `本次总包代付超过合同当前可代付金额，当前最多可代付 ${formatMoneyCentsAsYuan(
          capacity.remainingCents > 0n ? capacity.remainingCents : 0n
        )} 元`
      );
    }
  }

  async recordUpstreamSettlement(
    projectId: string,
    actorUserId: string,
    input: RecordProjectUpstreamSettlementDto
  ) {
    const reportedAmountCents = normalizePositiveMoneyCents(
      input.reportedAmountCents,
      "Upstream settlement reported amount must be greater than zero"
    );
    const approvedAmountCents = normalizePositiveMoneyCents(
      input.approvedAmountCents,
      "Upstream settlement approved amount must be greater than zero"
    );
    const settledAt = parseUpstreamSettlementDate(input.settledAt);
    const approvingPartyName = requiredTrimmed(
      input.approvingPartyName,
      "Upstream settlement approving party is required"
    );
    const periodLabel = requiredTrimmed(input.periodLabel, "Upstream settlement period is required");
    const isFinal = input.isFinal === true;
    const voucherFileId = requiredTrimmed(input.voucherFileId, "Upstream settlement voucher file is required");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Upstream settlement confirmation password is required"
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;

    if (!this.auth) {
      throw new Error("Auth service is required to confirm upstream settlement");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("Project not found");
      }

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("Upstream settlement voucher file not found");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("Upstream settlement voucher file must be uploaded by the recorder");
      }

      const upstreamSettlement = await tx.projectUpstreamSettlement.create({
        data: {
          projectId: project.id,
          settledAt,
          reportedAmountCents,
          approvedAmountCents,
          approvingPartyName,
          periodLabel,
          isFinal,
          description,
          voucherFileId,
          recordedByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.upstream_settlement.record",
        businessType: "project_upstream_settlement",
        businessId: upstreamSettlement.id,
        metadata: {
          projectId: project.id,
          upstreamSettlementId: upstreamSettlement.id,
          reportedAmountCents: moneyCentsToApi(reportedAmountCents),
          approvedAmountCents: moneyCentsToApi(approvedAmountCents),
          approvingPartyName,
          periodLabel,
          isFinal,
          voucherFileId
        }
      });

      return toUpstreamSettlementReadModel(upstreamSettlement);
    });
  }

  async recordOwnerContract(
    projectId: string,
    actorUserId: string,
    input: RecordProjectOwnerContractDto
  ) {
    const ownerName = requiredTrimmed(input.ownerName, "Project owner is required");
    const contractName = requiredTrimmed(input.contractName, "Project owner contract name is required");
    const contractCode = requiredTrimmed(input.contractCode, "Project owner contract code is required");
    const signedAt = parseOwnerContractDate(input.signedAt);
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "Project owner contract amount must be greater than zero"
    );
    const taxRateBps = normalizeRequiredBps(
      input.taxRateBps,
      "Project owner contract tax rate is required"
    );
    const pricingMethod = requiredTrimmed(input.pricingMethod, "Project owner contract pricing method is required");
    const paymentTermsSummary = requiredTrimmed(
      input.paymentTermsSummary,
      "Project owner contract payment terms summary is required"
    );
    const retentionSummary = requiredTrimmed(
      input.retentionSummary,
      "Project owner contract retention summary is required"
    );
    const fileId = requiredTrimmed(input.fileId, "Project owner contract file is required");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        });

        if (!project) {
          throw new NotFoundException("Project not found");
        }

        const existing = await tx.projectOwnerContract.findFirst({
          where: { projectId: project.id, contractCode, voidedAt: null },
          select: { id: true }
        });

        if (existing) {
          throw new BadRequestException("Project owner contract code already exists");
        }

        const existingFile = await tx.projectOwnerContract.findFirst({
          where: { fileId, voidedAt: null },
          select: { id: true }
        });

        if (existingFile) {
          throw new BadRequestException("Project owner contract file already exists");
        }

        const file = await tx.fileObject.findUnique({
          where: { id: fileId },
          select: { id: true, uploadedByUserId: true }
        });

        if (!file) {
          throw new NotFoundException("Project owner contract file not found");
        }

        if (file.uploadedByUserId !== actorUserId) {
          throw new BadRequestException("Project owner contract file must be uploaded by the recorder");
        }

        const ownerContract = await tx.projectOwnerContract.create({
          data: {
            projectId: project.id,
            ownerName,
            contractName,
            contractCode,
            signedAt,
            amountCents,
            taxRateBps,
            pricingMethod,
            paymentTermsSummary,
            retentionSummary,
            fileId,
            recordedByUserId: actorUserId,
            status: "pending_confirm"
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "project.owner_contract.record",
          businessType: "project_owner_contract",
          businessId: ownerContract.id,
          metadata: {
            projectId: project.id,
            ownerContractId: ownerContract.id,
            amountCents: moneyCentsToApi(amountCents),
            ownerName,
            contractName,
            contractCode,
            fileId
          }
        });

        return toOwnerContractReadModel(ownerContract);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("Project owner contract already exists");
      }
      throw error;
    }
  }

  async confirmOwnerContract(
    projectId: string,
    ownerContractId: string,
    actorUserId: string,
    input: ConfirmProjectOwnerContractDto
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Project owner contract confirmation password is required"
    );

    if (!this.auth) {
      throw new Error("Auth service is required to confirm project owner contract");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date();
      const updated = await tx.projectOwnerContract.updateMany({
        where: {
          id: ownerContractId,
          projectId,
          status: "pending_confirm",
          voidedAt: null
        },
        data: {
          status: "effective",
          confirmedByUserId: actorUserId,
          confirmedAt
        }
      });

      if (updated.count !== 1) {
        throw new BadRequestException("Project owner contract is not pending confirmation");
      }

      const confirmed = await tx.projectOwnerContract.findUnique({
        where: { id: ownerContractId }
      });
      if (!confirmed) {
        throw new InternalServerErrorException("Project owner contract confirmation was not persisted");
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "project.owner_contract.confirm",
        businessType: "project_owner_contract",
        businessId: confirmed.id,
        metadata: {
          projectId,
          ownerContractId: confirmed.id,
          amountCents: projectMoneyToApi(confirmed.amountCents),
          confirmedAt: confirmedAt.toISOString()
        }
      });

      return toOwnerContractReadModel(confirmed);
    });
  }

  async requestSettlementExceptionQuota(
    projectId: string,
    actorUserId: string,
    input: RequestSettlementExceptionQuotaDto
  ) {
    const contractId = requiredTrimmed(input.contractId, "Settlement exception quota contract is required");
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "Settlement exception quota amount must be greater than zero"
    );
    const reason = requiredTrimmed(input.reason, "Settlement exception quota reason is required");
    const validUntil = parseFutureDate(
      input.validUntil,
      "Settlement exception quota valid until date is invalid",
      "Settlement exception quota valid until date must be in the future"
    );
    const attachmentFileId = requiredTrimmed(
      input.attachmentFileId,
      "Settlement exception quota attachment file is required"
    );

    return this.prisma.$transaction(async (tx) => {
      const [project, contract, file] = await Promise.all([
        tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        }),
        tx.contract.findFirst({
          where: { id: contractId, projectId, voidedAt: null },
          select: { id: true }
        }),
        tx.fileObject.findUnique({
          where: { id: attachmentFileId },
          select: { id: true, uploadedByUserId: true }
        })
      ]);

      if (!project) {
        throw new NotFoundException("Project not found");
      }
      if (!contract) {
        throw new NotFoundException("Settlement exception quota contract not found");
      }
      if (!file) {
        throw new NotFoundException("Settlement exception quota attachment file not found");
      }
      if (file.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("Settlement exception quota attachment file must be uploaded by the requester");
      }

      const quota = await tx.projectSettlementExceptionQuota.create({
        data: {
          projectId: project.id,
          contractId: contract.id,
          amountCents,
          reason,
          validUntil,
          attachmentFileId,
          requestedByUserId: actorUserId,
          status: "approval_pending"
        }
      });

      await tx.approvalInstance.create({
        data: {
          flowType: "settlement_exception_quota.approve",
          businessType: "project_settlement_exception_quota",
          businessId: quota.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: SETTLEMENT_EXCEPTION_QUOTA_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.settlement_exception_quota.request",
        businessType: "project_settlement_exception_quota",
        businessId: quota.id,
        metadata: {
          projectId: project.id,
          contractId: contract.id,
          amountCents: moneyCentsToApi(amountCents),
          validUntil: validUntil.toISOString(),
          attachmentFileId
        }
      });

      return toSettlementExceptionQuotaReadModel(quota);
    });
  }

  async reviewSettlementExceptionQuota(
    projectId: string,
    quotaId: string,
    actorUserId: string,
    input: ReviewSettlementExceptionQuotaDto
  ) {
    if (input.decision !== "approve" && input.decision !== "reject") {
      throw new BadRequestException("Settlement exception quota approval decision is invalid");
    }
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Settlement exception quota approval password is required"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to review settlement exception quota");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const quota = await tx.projectSettlementExceptionQuota.findFirst({
        where: { id: quotaId, projectId }
      });
      if (!quota) {
        throw new NotFoundException("Settlement exception quota not found");
      }
      if (quota.status !== "approval_pending") {
        throw new BadRequestException(`Cannot review settlement exception quota from status ${quota.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "project_settlement_exception_quota",
          businessId: quota.id,
          flowType: "settlement_exception_quota.approve",
          status: "in_progress"
        }
      });
      if (!instance) {
        throw new BadRequestException("Settlement exception quota approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as SettlementExceptionQuotaApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];
      if (!currentNode) {
        throw new BadRequestException("Settlement exception quota approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, quota.projectId);
      const approvedRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));
      if (!approvedRoleKey) {
        throw new BadRequestException(`Actor cannot approve settlement exception quota node ${currentNode.name}`);
      }

      if (input.decision === "reject") {
        const rejected = await tx.projectSettlementExceptionQuota.update({
          where: { id: quota.id },
          data: { status: "rejected" }
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
            comment: input.comment?.trim() || undefined
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.settlement_exception_quota.reject",
          businessType: "project_settlement_exception_quota",
          businessId: quota.id,
          metadata: {
            projectId: quota.projectId,
            contractId: quota.contractId,
            nodeName: currentNode.name
          }
        });
        return toSettlementExceptionQuotaReadModel(rejected);
      }

      const nextNodes = [...nodes];
      const nextNode = {
        ...currentNode,
        approvedRoleKeys: [...new Set([...(currentNode.approvedRoleKeys ?? []), approvedRoleKey])]
      };
      nextNodes[instance.currentNodeIndex] = nextNode;
      const nextNodeIndex = instance.currentNodeIndex + 1;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      const approvedAt = flowCompleted ? new Date() : undefined;
      const updated = await tx.projectSettlementExceptionQuota.update({
        where: { id: quota.id },
        data: flowCompleted
          ? {
              status: "approved",
              approvedByUserId: actorUserId,
              approvedAt
            }
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
          comment: input.comment?.trim() || undefined
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.settlement_exception_quota.approve",
        businessType: "project_settlement_exception_quota",
        businessId: quota.id,
        metadata: {
          projectId: quota.projectId,
          contractId: quota.contractId,
          nodeName: currentNode.name,
          flowCompleted
        }
      });

      return toSettlementExceptionQuotaReadModel(updated);
    });
  }

  async requestProjectFinancingQuota(
    projectId: string,
    actorUserId: string,
    input: RequestProjectFinancingQuotaDto
  ) {
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "项目垫资额度金额必须大于零"
    );
    const reason = requiredTrimmed(input.reason, "项目垫资额度申请原因必填");
    const validUntil = parseFutureDate(
      input.validUntil,
      "项目垫资额度有效期无效",
      "项目垫资额度有效期必须晚于当前时间"
    );
    const attachmentFileId = requiredTrimmed(
      input.attachmentFileId,
      "项目垫资额度附件必填"
    );

    return this.prisma.$transaction(async (tx) => {
      const [project, file] = await Promise.all([
        tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        }),
        tx.fileObject.findUnique({
          where: { id: attachmentFileId },
          select: { id: true, uploadedByUserId: true }
        })
      ]);

      if (!project) {
        throw new NotFoundException("项目不存在或已停用");
      }
      if (!file) {
        throw new NotFoundException("项目垫资额度附件不存在");
      }
      if (file.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("项目垫资额度附件必须由申请人本人上传");
      }

      const quota = await tx.projectFinancingQuota.create({
        data: {
          projectId: project.id,
          amountCents,
          reason,
          validUntil,
          attachmentFileId,
          requestedByUserId: actorUserId,
          status: "approval_pending"
        }
      });

      await tx.approvalInstance.create({
        data: {
          flowType: "project_financing_quota.approve",
          businessType: "project_financing_quota",
          businessId: quota.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: PROJECT_FINANCING_QUOTA_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.financing_quota.request",
        businessType: "project_financing_quota",
        businessId: quota.id,
        metadata: {
          projectId: project.id,
          amountCents: moneyCentsToApi(amountCents),
          validUntil: validUntil.toISOString(),
          attachmentFileId
        }
      });

      return toProjectFinancingQuotaReadModel(quota);
    });
  }

  async reviewProjectFinancingQuota(
    projectId: string,
    quotaId: string,
    actorUserId: string,
    input: ReviewProjectFinancingQuotaDto
  ) {
    if (input.decision !== "approve" && input.decision !== "reject") {
      throw new BadRequestException("项目垫资额度审批动作无效");
    }
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "项目垫资额度审批需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to review project financing quota");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const quota = await tx.projectFinancingQuota.findFirst({
        where: { id: quotaId, projectId }
      });
      if (!quota) {
        throw new NotFoundException("项目垫资额度不存在");
      }
      if (quota.status !== "approval_pending") {
        throw new BadRequestException("当前项目垫资额度状态不可审批");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "project_financing_quota",
          businessId: quota.id,
          flowType: "project_financing_quota.approve",
          status: "in_progress"
        }
      });
      if (!instance) {
        throw new BadRequestException("项目垫资额度审批实例不存在");
      }

      const nodes = instance.frozenNodes as unknown as SettlementExceptionQuotaApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];
      if (!currentNode) {
        throw new BadRequestException("项目垫资额度当前审批节点不存在");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, quota.projectId);
      const approvedRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));
      if (!approvedRoleKey) {
        throw new BadRequestException(`当前用户不能审批项目垫资额度节点：${currentNode.name}`);
      }

      if (input.decision === "reject") {
        const rejected = await tx.projectFinancingQuota.update({
          where: { id: quota.id },
          data: { status: "rejected" }
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
            comment: input.comment?.trim() || undefined
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.financing_quota.reject",
          businessType: "project_financing_quota",
          businessId: quota.id,
          metadata: {
            projectId: quota.projectId,
            nodeName: currentNode.name
          }
        });
        return toProjectFinancingQuotaReadModel(rejected);
      }

      const nextNodes = [...nodes];
      const nextNode = {
        ...currentNode,
        approvedRoleKeys: [...new Set([...(currentNode.approvedRoleKeys ?? []), approvedRoleKey])]
      };
      nextNodes[instance.currentNodeIndex] = nextNode;
      const nextNodeIndex = instance.currentNodeIndex + 1;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      const approvedAt = flowCompleted ? new Date() : undefined;
      const updated = await tx.projectFinancingQuota.update({
        where: { id: quota.id },
        data: flowCompleted
          ? {
              status: "approved",
              approvedByUserId: actorUserId,
              approvedAt
            }
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
          comment: input.comment?.trim() || undefined
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.financing_quota.approve",
        businessType: "project_financing_quota",
        businessId: quota.id,
        metadata: {
          projectId: quota.projectId,
          nodeName: currentNode.name,
          flowCompleted
        }
      });

      return toProjectFinancingQuotaReadModel(updated);
    });
  }

  private async loadActorRoleKeys(
    tx: {
      userPosition: { findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>> };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    return Array.from(
      new Set([
        ...positions.map((position) => position.key as RoleKey),
        ...projectMembers.map((member) => member.positionKey as RoleKey)
      ])
    );
  }
}

function isProjectOptionPosition(positionKey: RoleKey | undefined): boolean {
  return !!positionKey && PROJECT_OPTION_POSITIONS.has(positionKey);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function latestByContract<T extends { contractId: string; versionNo?: number | null }>(versions: T[]): T[] {
  return Array.from(
    versions.reduce((latestById, version) => {
      const current = latestById.get(version.contractId);
      if (!current || (version.versionNo ?? 0) > (current.versionNo ?? 0)) {
        latestById.set(version.contractId, version);
      }
      return latestById;
    }, new Map<string, T>()).values()
  );
}

export function projectMoneyToApi(value: bigint | number): string {
  return moneyCentsToApi(dbMoneyToBigInt(value, "项目金额"));
}

function normalizePositiveMoneyCents(value: unknown, message: string): bigint {
  let cents: bigint;
  try {
    cents = parseMoneyCents(value as string, "金额");
  } catch {
    throw new BadRequestException(message);
  }
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function parseReceiptDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("Receipt date is invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Receipt date is invalid");
  }
  return parsed;
}

function parseProxyPaymentDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("总包代付日期不正确，请重新选择");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("总包代付日期不正确，请重新选择");
  }
  return parsed;
}

function parseUpstreamSettlementDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("Upstream settlement date is invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Upstream settlement date is invalid");
  }
  return parsed;
}

function parseOwnerContractDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("Project owner contract signed date is invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Project owner contract signed date is invalid");
  }
  return parsed;
}

function parseFutureDate(value: unknown, invalidMessage: string, pastMessage: string): Date {
  if (typeof value !== "string") {
    throw new BadRequestException(invalidMessage);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(invalidMessage);
  }
  if (parsed.getTime() <= Date.now()) {
    throw new BadRequestException(pastMessage);
  }
  return parsed;
}

function requiredTrimmed(value: unknown, message: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function optionalTrimmed(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function normalizeRequiredBps(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10000) {
    throw new BadRequestException(message);
  }
  return value;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeSourceType(value: unknown): ProjectReceiptSourceType {
  if (typeof value !== "string") {
    throw new BadRequestException("Receipt source type is invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(RECEIPT_SOURCE_LABELS, value)) {
    throw new BadRequestException("Receipt source type is invalid");
  }
  return value as ProjectReceiptSourceType;
}

function normalizeProxyPaymentType(value: unknown): ProjectProxyPaymentType {
  if (typeof value !== "string") {
    throw new BadRequestException("总包代付类型不正确，请重新选择");
  }
  if (!Object.prototype.hasOwnProperty.call(PROXY_PAYMENT_TYPE_LABELS, value)) {
    throw new BadRequestException("总包代付类型不正确，请重新选择");
  }
  return value as ProjectProxyPaymentType;
}

function toReceiptReadModel(receipt: {
  id: string;
  projectId: string;
  receivedAt: Date;
  amountCents: bigint | number;
  payerName: string;
  sourceType: string;
  description?: string | null;
  voucherFileId: string;
  recordedByUserId: string;
  createdAt: Date;
}) {
  const sourceType = normalizeSourceType(receipt.sourceType as ProjectReceiptSourceType);
  return {
    id: receipt.id,
    projectId: receipt.projectId,
    receivedAt: receipt.receivedAt.toISOString(),
    amountCents: projectMoneyToApi(receipt.amountCents),
    payerName: receipt.payerName,
    sourceType,
    sourceTypeLabel: RECEIPT_SOURCE_LABELS[sourceType],
    description: receipt.description ?? null,
    voucherFileId: receipt.voucherFileId,
    recordedByUserId: receipt.recordedByUserId,
    createdAt: receipt.createdAt.toISOString()
  };
}

function toProxyPaymentReadModel(proxyPayment: {
  id: string;
  projectId: string;
  paidAt: Date;
  amountCents: bigint | number;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: string;
  description?: string | null;
  voucherFileId: string;
  recordedByUserId: string;
  contractId?: string | null;
  settlementId?: string | null;
  createdAt: Date;
}) {
  const paymentType = normalizeProxyPaymentType(proxyPayment.paymentType as ProjectProxyPaymentType);
  return {
    id: proxyPayment.id,
    projectId: proxyPayment.projectId,
    paidAt: proxyPayment.paidAt.toISOString(),
    amountCents: projectMoneyToApi(proxyPayment.amountCents),
    generalContractorName: proxyPayment.generalContractorName,
    paidTargetName: proxyPayment.paidTargetName,
    paymentType,
    paymentTypeLabel: PROXY_PAYMENT_TYPE_LABELS[paymentType],
    description: proxyPayment.description ?? null,
    voucherFileId: proxyPayment.voucherFileId,
    recordedByUserId: proxyPayment.recordedByUserId,
    contractId: proxyPayment.contractId ?? null,
    settlementId: proxyPayment.settlementId ?? null,
    createdAt: proxyPayment.createdAt.toISOString()
  };
}

function toUpstreamSettlementReadModel(upstreamSettlement: {
  id: string;
  projectId: string;
  settledAt: Date;
  reportedAmountCents: bigint | number;
  approvedAmountCents: bigint | number;
  approvingPartyName: string;
  periodLabel: string;
  isFinal: boolean;
  description?: string | null;
  voucherFileId: string;
  recordedByUserId: string;
  createdAt: Date;
}) {
  return {
    id: upstreamSettlement.id,
    projectId: upstreamSettlement.projectId,
    settledAt: upstreamSettlement.settledAt.toISOString(),
    reportedAmountCents: projectMoneyToApi(upstreamSettlement.reportedAmountCents),
    approvedAmountCents: projectMoneyToApi(upstreamSettlement.approvedAmountCents),
    approvingPartyName: upstreamSettlement.approvingPartyName,
    periodLabel: upstreamSettlement.periodLabel,
    isFinal: upstreamSettlement.isFinal,
    description: upstreamSettlement.description ?? null,
    voucherFileId: upstreamSettlement.voucherFileId,
    recordedByUserId: upstreamSettlement.recordedByUserId,
    createdAt: upstreamSettlement.createdAt.toISOString()
  };
}

function toOwnerContractReadModel(ownerContract: {
  id: string;
  projectId: string;
  ownerName: string;
  contractName: string;
  contractCode: string;
  signedAt: Date;
  amountCents: bigint | number;
  taxRateBps?: number | null;
  pricingMethod: string;
  paymentTermsSummary?: string | null;
  retentionSummary?: string | null;
  fileId: string;
  recordedByUserId: string;
  confirmedByUserId?: string | null;
  confirmedAt?: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ownerContract.id,
    projectId: ownerContract.projectId,
    ownerName: ownerContract.ownerName,
    contractName: ownerContract.contractName,
    contractCode: ownerContract.contractCode,
    signedAt: ownerContract.signedAt.toISOString(),
    amountCents: projectMoneyToApi(ownerContract.amountCents),
    taxRateBps: ownerContract.taxRateBps ?? null,
    pricingMethod: ownerContract.pricingMethod,
    paymentTermsSummary: ownerContract.paymentTermsSummary ?? null,
    retentionSummary: ownerContract.retentionSummary ?? null,
    fileId: ownerContract.fileId,
    recordedByUserId: ownerContract.recordedByUserId,
    confirmedByUserId: ownerContract.confirmedByUserId ?? null,
    confirmedAt: ownerContract.confirmedAt?.toISOString() ?? null,
    status: ownerContract.status,
    createdAt: ownerContract.createdAt.toISOString(),
    updatedAt: ownerContract.updatedAt.toISOString()
  };
}

function toSettlementExceptionQuotaReadModel(quota: {
  id: string;
  projectId: string;
  contractId: string;
  amountCents: bigint | number;
  reason: string;
  validUntil: Date;
  attachmentFileId: string;
  requestedByUserId: string;
  approvedByUserId?: string | null;
  approvedAt?: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: quota.id,
    projectId: quota.projectId,
    contractId: quota.contractId,
    amountCents: projectMoneyToApi(quota.amountCents),
    reason: quota.reason,
    validUntil: quota.validUntil.toISOString(),
    attachmentFileId: quota.attachmentFileId,
    requestedByUserId: quota.requestedByUserId,
    approvedByUserId: quota.approvedByUserId ?? null,
    approvedAt: quota.approvedAt?.toISOString() ?? null,
    status: quota.status,
    createdAt: quota.createdAt.toISOString(),
    updatedAt: quota.updatedAt.toISOString()
  };
}

function toProjectFinancingQuotaReadModel(quota: {
  id: string;
  projectId: string;
  amountCents: bigint | number;
  reason: string;
  validUntil: Date;
  attachmentFileId: string;
  requestedByUserId: string;
  approvedByUserId?: string | null;
  approvedAt?: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: quota.id,
    projectId: quota.projectId,
    amountCents: projectMoneyToApi(quota.amountCents),
    reason: quota.reason,
    validUntil: quota.validUntil.toISOString(),
    attachmentFileId: quota.attachmentFileId,
    requestedByUserId: quota.requestedByUserId,
    approvedByUserId: quota.approvedByUserId ?? null,
    approvedAt: quota.approvedAt?.toISOString() ?? null,
    status: quota.status,
    createdAt: quota.createdAt.toISOString(),
    updatedAt: quota.updatedAt.toISOString()
  };
}
