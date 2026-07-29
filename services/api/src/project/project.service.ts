import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { PrismaService } from "../database/prisma.service";
import {
  dbMoneyToBigInt,
  findProjectSpotProcurementRefundAmounts,
  formatMoneyCentsAsYuan,
  moneyCentsToApi,
  outstandingMoneyRequestCentsBigInt,
  parseMoneyCentsInput,
  spotProcurementPaymentToMoneyRequestValue,
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
import { loadSettlementPaymentConfirmationFacts } from "../payment/settlement-confirmation-facts";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import type { AssignProjectAffiliateDto } from "./dto/assign-project-affiliate.dto";
import type { ConfirmProjectUpstreamSettlementDto } from "./dto/confirm-project-upstream-settlement.dto";
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
import type { TerminateProjectFinancingQuotaDto } from "./dto/terminate-project-financing-quota.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";
import { resolveCurrentProjectAffiliate } from "./project-affiliate-subject";

const UPSTREAM_SETTLEMENT_GAP =
  "缺少对上结算/业主审定台账，当前经营收入和毛利为实际收款与总包代付发生口径。";
const FINANCING_LIMIT_GAP = "缺少项目垫资额度台账，当前可用资金未包含批准垫资额度。";
const PROJECT_OPTION_POSITIONS = new Set<RoleKey>([
  ...PROJECT_OVERVIEW_READ_POSITION_KEYS,
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
  engineering_department_member: "公司工程技术部成员",
  engineering_department_director: "公司工程技术部部长",
  engineering_director: "项目总工",
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
  { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
];

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly funding: ProjectFundingAvailabilityService =
      new ProjectFundingAvailabilityService()
  ) {}

  async createProject(actorUserId: string, input: CreateProjectDto) {
    const code = requiredTrimmed(input.code, "请填写项目编号");
    const name = requiredTrimmed(input.name, "请填写项目名称");

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
        throw new BadRequestException("项目编号已存在");
      }
      throw error;
    }
  }

  async updateProject(projectId: string, actorUserId: string, input: UpdateProjectDto) {
    const name = requiredTrimmed(input.name, "请填写项目名称");

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
        throw new NotFoundException("项目不存在，请刷新后重试");
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

  async getAffiliateMappingReport() {
    const [projects, assignments] = await Promise.all([
      this.prisma.project.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: [{ code: "asc" }, { name: "asc" }]
      }),
      this.prisma.projectAffiliateAssignment.findMany({
        where: { endedAt: null },
        select: {
          id: true,
          projectId: true,
          businessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true,
          effectiveFrom: true
        },
        orderBy: [{ projectId: "asc" }, { effectiveFrom: "desc" }, { id: "asc" }]
      })
    ]);
    const assignmentsByProject = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const rows = assignmentsByProject.get(assignment.projectId) ?? [];
      rows.push(assignment);
      assignmentsByProject.set(assignment.projectId, rows);
    }

    const rows = projects.map((project) => {
      const current = assignmentsByProject.get(project.id) ?? [];
      const ready = current.length === 1 ? current[0] : null;
      return {
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        status: current.length === 0 ? "missing" : current.length === 1 ? "ready" : "conflict",
        affiliateName: ready?.affiliateNameSnapshot ?? null,
        affiliateCreditCode: ready?.affiliateCreditCodeSnapshot ?? null,
        businessPartyVersionId: ready?.businessPartyVersionId ?? null,
        effectiveFrom: ready?.effectiveFrom.toISOString() ?? null,
        currentAssignmentIds: current.map((assignment) => assignment.id)
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      rows,
      summary: {
        ready: rows.filter((row) => row.status === "ready").length,
        missing: rows.filter((row) => row.status === "missing").length,
        conflict: rows.filter((row) => row.status === "conflict").length
      }
    };
  }

  async assignAffiliate(
    projectId: string,
    actorUserId: string,
    input: AssignProjectAffiliateDto
  ) {
    const businessPartyVersionId = requiredTrimmed(
      input.businessPartyVersionId,
      "挂靠企业版本不能为空"
    );
    const changeReason = requiredTrimmed(
      input.changeReason,
      "挂靠关系配置或变更原因不能为空"
    );
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException("挂靠关系生效时间格式不正确");
    }
    if (effectiveFrom.getTime() > Date.now()) {
      throw new BadRequestException("挂靠关系生效时间不能晚于当前时间");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [project] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
          SELECT "id", "isActive"
          FROM "Project"
          WHERE "id" = ${projectId}
          FOR UPDATE
        `);
        if (!project?.isActive) {
          throw new NotFoundException("项目不存在或已停用，不能配置挂靠企业");
        }

        const currentAssignments = await tx.$queryRaw<
          Array<{
            id: string;
            businessPartyId: string;
            businessPartyVersionId: string;
            effectiveFrom?: Date;
          }>
        >(Prisma.sql`
          SELECT "id", "businessPartyId", "businessPartyVersionId", "effectiveFrom"
          FROM "ProjectAffiliateAssignment"
          WHERE "projectId" = ${projectId} AND "endedAt" IS NULL
          ORDER BY "effectiveFrom" DESC, "id" ASC
          FOR UPDATE
        `);
        if (currentAssignments.length > 1) {
          throw new BadRequestException(
            "项目存在多个当前挂靠企业，不能直接覆盖；请先按人工清单消除冲突"
          );
        }
        const currentAssignment = currentAssignments[0];
        if (
          currentAssignment?.effectiveFrom &&
          effectiveFrom.getTime() < currentAssignment.effectiveFrom.getTime()
        ) {
          throw new BadRequestException("新挂靠关系生效时间不能早于当前挂靠关系生效时间");
        }

        const version = await tx.businessPartyVersion.findUnique({
          where: { id: businessPartyVersionId },
          select: { id: true, businessPartyId: true, snapshot: true }
        });
        if (!version) {
          throw new NotFoundException("所选挂靠企业版本不存在");
        }
        const party = await tx.businessParty.findUnique({
          where: { id: version.businessPartyId },
          select: { id: true, status: true }
        });
        if (!party || party.status !== "active") {
          throw new BadRequestException("所选挂靠企业已停用，不能建立新的项目映射");
        }
        const snapshot = version.snapshot as {
          name?: unknown;
          unifiedSocialCreditCode?: unknown;
        };
        const affiliateNameSnapshot = requiredTrimmed(
          snapshot.name,
          "所选挂靠企业版本缺少企业名称，不能建立项目映射"
        );
        const affiliateCreditCodeSnapshot =
          typeof snapshot.unifiedSocialCreditCode === "string"
            ? snapshot.unifiedSocialCreditCode.trim() || null
            : null;

        if (currentAssignment) {
          await tx.projectAffiliateAssignment.updateMany({
            where: { projectId, endedAt: null },
            data: { endedAt: effectiveFrom, endedByUserId: actorUserId }
          });
        }
        const assignment = await tx.projectAffiliateAssignment.create({
          data: {
            projectId,
            businessPartyId: version.businessPartyId,
            businessPartyVersionId: version.id,
            affiliateNameSnapshot,
            affiliateCreditCodeSnapshot,
            effectiveFrom,
            changeReason,
            assignedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: currentAssignment
            ? "project.affiliate_assignment.change"
            : "project.affiliate_assignment.create",
          businessType: "project_affiliate_assignment",
          businessId: assignment.id,
          metadata: {
            projectId,
            previousAssignmentId: currentAssignment?.id ?? null,
            previousBusinessPartyVersionId:
              currentAssignment?.businessPartyVersionId ?? null,
            businessPartyId: version.businessPartyId,
            businessPartyVersionId: version.id,
            affiliateNameSnapshot,
            effectiveFrom: effectiveFrom.toISOString(),
            changeReason
          }
        });
        return assignment;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException(
          "项目当前挂靠企业已被其他操作更新，请刷新人工映射报告后重试"
        );
      }
      throw error;
    }
  }

  private findActiveProjectOptions(extraWhere: object = {}) {
    return this.prisma.project.findMany({
      where: { isActive: true, ...extraWhere },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  }

  async listRoster(userId: string) {
    const [globalUserPositions, projectUserPositions, projectMembers, ownRosterMemberships] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } }),
      this.prisma.projectRosterMember.findMany({ where: { userId } })
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
      ...projectMembers.map((member) => member.projectId),
      ...ownRosterMemberships.map((member) => member.projectId)
    ]);

    if (!canSeeAllProjects && !scopedProjectIds.length) return [];

    const projects = await this.prisma.project.findMany({
      where: { isActive: true, ...(canSeeAllProjects ? {} : { id: { in: scopedProjectIds } }) },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
    const projectIds = projects.map((project) => project.id);
    if (!projectIds.length) return [];

    const [memberRows, rosterRows] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId: { in: projectIds } } }),
      this.prisma.projectRosterMember.findMany({ where: { projectId: { in: projectIds } } })
    ]);
    const rosterKeys = new Set([
      ...rosterRows.map((member) => `${member.projectId}:${member.userId}`),
      ...memberRows.map((member) => `${member.projectId}:${member.userId}`)
    ]);
    const userIds = unique([...rosterRows, ...memberRows].map((member) => member.userId));
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

    const globalAssignments = userIds.length
      ? await this.prisma.userPosition.findMany({
          where: { userId: { in: userIds }, projectId: null }
        })
      : [];
    const globalPositionIds = unique(globalAssignments.map((assignment) => assignment.positionId));
    const globalPositions = globalPositionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: globalPositionIds } } })
      : [];
    const globalPositionById = new Map(
      globalPositions.map((position) => [position.id, { key: position.key as RoleKey, name: position.name }])
    );
    const globalRolesByUser = new Map<string, Array<{ key: RoleKey; name: string }>>();
    for (const assignment of globalAssignments) {
      const position = globalPositionById.get(assignment.positionId);
      if (!position) continue;
      const roles = globalRolesByUser.get(assignment.userId) ?? [];
      if (!roles.some((role) => role.key === position.key)) roles.push(position);
      globalRolesByUser.set(assignment.userId, roles);
    }

    return Array.from(rosterKeys)
      .map((key) => {
        const [projectId, rowUserId] = key.split(":");
        const project = projectById.get(projectId);
        const user = userById.get(rowUserId);
        if (!project || !user) return null;
        const positions = Array.from(rolesByProjectUser.get(key) ?? []);
        const globalRoles = (globalRolesByUser.get(rowUserId) ?? []).sort((left, right) =>
          left.name.localeCompare(right.name, "zh-CN")
        );
        const projectPositionNames = positions.map((role) => ROLE_LABELS[role] ?? "未识别项目岗位");
        return {
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          userId: user.id,
          name: user.name,
          phone: user.phone ?? "",
          positionKeys: positions,
          positionNames: projectPositionNames,
          globalPositionNames: globalRoles.map((role) => role.name),
          projectPositionNames
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
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }

    const [
      contracts,
      settlements,
      payments,
      financeRecords,
      projectReceipts,
      supplierRefundAmountCents,
      projectProxyPayments,
      projectUpstreamSettlements,
      projectFinancingQuotas,
      projectExpenseRequests,
      spotProcurementPayments
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
      findProjectSpotProcurementRefundAmounts(
        this.prisma,
        projectId
      ),
      this.prisma.projectProxyPayment.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      this.prisma.projectUpstreamSettlement.findMany({
        where: { projectId, status: "confirmed", voidedAt: null },
        select: { approvedAmountCents: true }
      }),
      this.prisma.projectFinancingQuota.findMany({
        where: {
          projectId,
          status: "approved",
          OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }]
        },
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
      }),
      this.prisma.spotProcurementPayment.findMany({
        where: { projectId },
        select: {
          id: true,
          status: true,
          companyPaymentAmountCents: true,
          canceledCompanyPaymentAmountCents: true,
          paidAmountCents: true
        }
      })
    ]);
    const contractIds = contracts.map((contract) => contract.id);
    const paymentIds = payments.map((payment) => payment.id);
    const expenseRequestIds = projectExpenseRequests.map((request) => request.id);
    const spotPaymentIds = spotProcurementPayments.map((payment) => payment.id);
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
    const spotExecutions =
      spotPaymentIds.length
        ? await this.prisma.spotProcurementPaymentExecution.findMany({
            where: {
              paymentId: { in: spotPaymentIds },
              voidedAt: null
            },
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
    const supplierRefundsCents = sumDbMoneyToBigInt(
      supplierRefundAmountCents,
      "供应商退款到账金额"
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
        ...expenseExecutions.map((execution) => execution.amountCents),
        ...spotExecutions.map((execution) => execution.amountCents)
      ],
      "项目实付金额"
    );
    const operatingIncomeCents = projectUpstreamSettlements.length
      ? upstreamSettlementCents
      : actualReceiptsCents + proxyPaymentCents;
    const operatingCostCents = actualPaidCents + proxyPaymentCents;
    const spotCashRequests = spotProcurementPayments.map(
      spotProcurementPaymentToMoneyRequestValue
    );
    const projectRequests = [
      ...payments,
      ...projectExpenseRequests,
      ...spotCashRequests
    ];
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
      actualReceiptsCents +
      supplierRefundsCents -
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
        supplierRefundsCents:
          projectMoneyToApi(supplierRefundsCents),
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
    const amountCents = normalizePositiveMoneyCents(input.amountCents, "到账金额必须大于零");
    const receivedAt = parseReceiptDate(input.receivedAt);
    const payerName = requiredTrimmed(input.payerName, "请填写付款方名称");
    const sourceType = normalizeSourceType(input.sourceType);
    const voucherFileId = requiredTrimmed(input.voucherFileId, "请上传到账凭证");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
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
        throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      }
      const currentAffiliate = await resolveCurrentProjectAffiliate(tx, project.id);

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("到账凭证不存在，请重新上传");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("只能使用本人上传的到账凭证");
      }

      const receipt = await tx.projectReceipt.create({
        data: {
          projectId: project.id,
          receivedAt,
          amountCents,
          payerName,
          sourceType,
          affiliateAssignmentId: currentAffiliate.assignmentId,
          affiliateBusinessPartyVersionId: currentAffiliate.businessPartyVersionId,
          affiliateNameSnapshot: currentAffiliate.name,
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
          affiliateAssignmentId: currentAffiliate.assignmentId,
          affiliateBusinessPartyVersionId: currentAffiliate.businessPartyVersionId,
          affiliateNameSnapshot: currentAffiliate.name,
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
      const currentAffiliate = await resolveCurrentProjectAffiliate(tx, project.id);

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
      let affiliatePaymentSubject = {
        assignmentId: currentAffiliate.assignmentId,
        businessPartyVersionId: currentAffiliate.businessPartyVersionId,
        name: currentAffiliate.name
      };

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
        affiliatePaymentSubject = await this.loadAffiliateContractSubject(tx, contract.id);
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
        if (!requestedContractId) {
          affiliatePaymentSubject = await this.loadAffiliateContractSubject(
            tx,
            settlement.contractId
          );
        }
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
          paymentSubjectType: "affiliate",
          affiliateAssignmentId: affiliatePaymentSubject.assignmentId,
          affiliateBusinessPartyVersionId:
            affiliatePaymentSubject.businessPartyVersionId,
          affiliateNameSnapshot: affiliatePaymentSubject.name,
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
          paymentSubjectType: "affiliate",
          affiliateAssignmentId: affiliatePaymentSubject.assignmentId,
          affiliateBusinessPartyVersionId:
            affiliatePaymentSubject.businessPartyVersionId,
          affiliateNameSnapshot: affiliatePaymentSubject.name,
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

  private async loadAffiliateContractSubject(
    tx: Prisma.TransactionClient,
    contractId: string
  ): Promise<{ assignmentId: string; businessPartyVersionId: string; name: string }> {
    const version = await tx.contractVersion.findFirst({
      where: { contractId },
      orderBy: { versionNo: "desc" },
      select: {
        signingSubjectType: true,
        affiliateAssignmentId: true,
        affiliateBusinessPartyVersionId: true,
        affiliateNameSnapshot: true
      }
    });
    if (!version) {
      throw new NotFoundException("关联合同版本不存在，请重新选择");
    }
    if (version.signingSubjectType !== "affiliate") {
      throw new BadRequestException("该合同冻结为我方签约，不能登记挂靠企业付款");
    }
    if (
      !version.affiliateAssignmentId ||
      !version.affiliateBusinessPartyVersionId ||
      !version.affiliateNameSnapshot
    ) {
      throw new BadRequestException("关联合同缺少冻结的挂靠企业主体快照，不能登记挂靠付款");
    }
    return {
      assignmentId: version.affiliateAssignmentId,
      businessPartyVersionId: version.affiliateBusinessPartyVersionId,
      name: version.affiliateNameSnapshot
    };
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
            amountCents: bigint;
            paidAmountCents: bigint;
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
            fixedAmountCents: bigint | null;
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
        }) => Promise<Array<{ id: string; amountCents: bigint }>>;
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
      loadSettlementPaymentConfirmationFacts(tx, settlementIds),
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
    const contractAmountCentsByPaymentTermsVersionId = contractSettlements.reduce<Record<string, bigint>>(
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
      "对上结算报送金额必须大于零"
    );
    const approvedAmountCents = normalizePositiveMoneyCents(
      input.approvedAmountCents,
      "对上结算审定金额必须大于零"
    );
    const settledAt = parseUpstreamSettlementDate(input.settledAt);
    const approvingPartyName = requiredTrimmed(
      input.approvingPartyName,
      "请填写对上结算审定方名称"
    );
    const periodLabel = requiredTrimmed(input.periodLabel, "请填写对上结算期间");
    const isFinal = input.isFinal === true;
    const voucherFileId = requiredTrimmed(input.voucherFileId, "请上传对上结算凭证");
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      }

      const currentAffiliate = await resolveCurrentProjectAffiliate(tx, project.id);

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: {
          id: true,
          uploadedByUserId: true,
          storageStatus: true,
          contentSha256: true
        }
      });

      if (!voucher) {
        throw new NotFoundException("对上结算凭证不存在，请重新上传");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("只能使用本人上传的对上结算凭证");
      }
      if (voucher.storageStatus !== "active" || !voucher.contentSha256) {
        throw new BadRequestException("对上结算正式文件尚未完成摘要校验，不能登记");
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
          affiliateAssignmentId: currentAffiliate.assignmentId,
          affiliateBusinessPartyVersionId: currentAffiliate.businessPartyVersionId,
          affiliateNameSnapshot: currentAffiliate.name,
          description,
          voucherFileId,
          documentVersion: 1,
          fileContentSha256Snapshot: voucher.contentSha256,
          recordedByUserId: actorUserId,
          status: "pending_confirm"
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
          affiliateAssignmentId: currentAffiliate.assignmentId,
          affiliateBusinessPartyVersionId: currentAffiliate.businessPartyVersionId,
          affiliateNameSnapshot: currentAffiliate.name,
          voucherFileId,
          documentVersion: 1,
          fileContentSha256Snapshot: voucher.contentSha256,
          status: "pending_confirm"
        }
      });

      return toUpstreamSettlementReadModel(upstreamSettlement);
    });
  }

  async confirmUpstreamSettlement(
    projectId: string,
    upstreamSettlementId: string,
    actorUserId: string,
    input: ConfirmProjectUpstreamSettlementDto,
    now: Date = new Date()
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm upstream settlement");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ProjectUpstreamSettlement"
        WHERE "id" = ${upstreamSettlementId}
          AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });
      const updated = await tx.projectUpstreamSettlement.updateMany({
        where: {
          id: upstreamSettlementId,
          projectId,
          status: "pending_confirm",
          voidedAt: null
        },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt: now,
          confirmationSignatureVersionId: signature.versionId,
          confirmationSignatureFileId: signature.fileId,
          confirmationSignatureSha256: signature.sha256
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("当前上游结算状态不可确认");
      }
      const confirmed = await tx.projectUpstreamSettlement.findUnique({
        where: { id: upstreamSettlementId }
      });
      if (!confirmed) {
        throw new InternalServerErrorException("上游结算确认结果未正确保存，请稍后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "project.upstream_settlement.confirm",
        businessType: "project_upstream_settlement",
        businessId: confirmed.id,
        metadata: {
          projectId,
          upstreamSettlementId: confirmed.id,
          documentVersion: confirmed.documentVersion,
          fileContentSha256Snapshot: confirmed.fileContentSha256Snapshot,
          confirmationSignatureVersionId: signature.versionId,
          confirmedAt: now.toISOString()
        }
      });
      return toUpstreamSettlementReadModel(confirmed);
    });
  }

  async recordOwnerContract(
    projectId: string,
    actorUserId: string,
    input: RecordProjectOwnerContractDto
  ) {
    const ownerName = requiredTrimmed(input.ownerName, "请填写业主名称");
    const contractName = requiredTrimmed(input.contractName, "请填写业主主合同名称");
    const contractCode = requiredTrimmed(input.contractCode, "请填写业主主合同编号");
    const signedAt = parseOwnerContractDate(input.signedAt);
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "业主主合同金额必须大于零"
    );
    const taxRateBps = normalizeRequiredBps(
      input.taxRateBps,
      "业主主合同税率必须是 0 到 10000 之间的整数"
    );
    const pricingMethod = requiredTrimmed(input.pricingMethod, "请填写业主主合同计价方式");
    const paymentTermsSummary = requiredTrimmed(
      input.paymentTermsSummary,
      "请填写业主主合同付款条款摘要"
    );
    const retentionSummary = requiredTrimmed(
      input.retentionSummary,
      "请填写业主主合同质保金摘要"
    );
    const fileId = requiredTrimmed(input.fileId, "请上传业主主合同文件");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        });

        if (!project) {
          throw new NotFoundException("项目不存在或已停用，请刷新后重试");
        }

        const affiliate = await resolveCurrentProjectAffiliate(tx, project.id);

        const existing = await tx.projectOwnerContract.findFirst({
          where: { projectId: project.id, contractCode, voidedAt: null },
          select: { id: true }
        });

        if (existing) {
          throw new BadRequestException("业主主合同编号已存在");
        }

        const existingFile = await tx.projectOwnerContract.findFirst({
          where: { fileId, voidedAt: null },
          select: { id: true }
        });

        if (existingFile) {
          throw new BadRequestException("该业主主合同文件已登记");
        }

        const file = await tx.fileObject.findUnique({
          where: { id: fileId },
          select: {
            id: true,
            uploadedByUserId: true,
            storageStatus: true,
            contentSha256: true
          }
        });

        if (!file) {
          throw new NotFoundException("业主主合同文件不存在，请重新上传");
        }

        if (file.uploadedByUserId !== actorUserId) {
          throw new BadRequestException("只能使用本人上传的业主主合同文件");
        }
        if (file.storageStatus !== "active" || !file.contentSha256) {
          throw new BadRequestException("业主主合同正式文件尚未完成摘要校验，不能登记");
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
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            affiliateNameSnapshot: affiliate.name,
            affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode,
            fileId,
            documentVersion: 1,
            fileContentSha256Snapshot: file.contentSha256,
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
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            affiliateNameSnapshot: affiliate.name,
            fileId,
            documentVersion: 1,
            fileContentSha256Snapshot: file.contentSha256
          }
        });

        return toOwnerContractReadModel(ownerContract);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("当前项目已存在相同的业主主合同");
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
      "请输入当前登录密码"
    );

    if (!this.auth) {
      throw new Error("Auth service is required to confirm project owner contract");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date();
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Project"
        WHERE "id" = ${projectId}
        FOR UPDATE
      `);
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
        throw new BadRequestException("当前业主主合同状态不可确认");
      }

      const confirmed = await tx.projectOwnerContract.findUnique({
        where: { id: ownerContractId }
      });
      if (!confirmed) {
        throw new InternalServerErrorException("业主主合同确认结果未正确保存，请稍后重试");
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
          documentVersion: confirmed.documentVersion,
          fileContentSha256Snapshot: confirmed.fileContentSha256Snapshot,
          confirmedByUserId: actorUserId,
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
    const contractId = requiredTrimmed(input.contractId, "请选择结算例外额度关联合同");
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "结算例外额度必须大于零"
    );
    const reason = requiredTrimmed(input.reason, "请填写结算例外额度申请原因");
    const validUntil = parseFutureDate(
      input.validUntil,
      "结算例外额度有效期不正确，请重新选择",
      "结算例外额度有效期必须晚于当前时间"
    );
    const attachmentFileId = requiredTrimmed(
      input.attachmentFileId,
      "请上传结算例外额度附件"
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
        throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      }
      if (!contract) {
        throw new NotFoundException("关联合同不存在或不属于当前项目，请重新选择");
      }
      if (!file) {
        throw new NotFoundException("结算例外额度附件不存在，请重新上传");
      }
      if (file.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("只能使用申请人本人上传的结算例外额度附件");
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
      throw new BadRequestException("结算例外额度审批动作无效");
    }
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
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
        throw new NotFoundException("结算例外额度申请不存在");
      }
      if (quota.status !== "approval_pending") {
        throw new BadRequestException("当前结算例外额度状态不可审批");
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
        throw new BadRequestException("结算例外额度审批流程不存在");
      }

      const nodes = instance.frozenNodes as unknown as SettlementExceptionQuotaApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];
      if (!currentNode) {
        throw new BadRequestException("结算例外额度当前审批节点不存在");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, quota.projectId);
      const approvedRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));
      if (!approvedRoleKey) {
        throw new BadRequestException("当前账号不能审批结算例外额度");
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
    const validUntil = input.validUntil === undefined
      ? null
      : parseFutureDate(
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
          validUntil: validUntil?.toISOString() ?? null,
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
        throw new BadRequestException("当前账号不能审批项目垫资额度");
      }
      const selfReview =
        instance.applicantUserId === actorUserId
          ? {
              selfReview: true as const,
              selfReviewReason: requiredTrimmed(
                input.selfReviewReason,
                "财务主管审批本人发起的项目垫资额度时，请填写独立自审原因"
              )
            }
          : null;
      if (
        selfReview &&
        (instance.currentNodeIndex !== 0 || approvedRoleKey !== "finance_director")
      ) {
        throw new ForbiddenException("项目垫资额度申请人只能独立审批财务主管节点");
      }
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });

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
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            signatureFileIdSnapshot: signature.fileId,
            signatureSha256Snapshot: signature.sha256,
            signatureVersionIdSnapshot: signature.versionId,
            ...(selfReview ? { metadata: selfReview } : {})
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
          comment: input.comment?.trim() || undefined,
          approvedRoleKey,
          signatureFileIdSnapshot: signature.fileId,
          signatureSha256Snapshot: signature.sha256,
          signatureVersionIdSnapshot: signature.versionId,
          ...(selfReview ? { metadata: selfReview } : {})
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
          flowCompleted,
          approvedRoleKey,
          ...(selfReview ?? {})
        }
      });

      return toProjectFinancingQuotaReadModel(updated);
    });
  }

  async terminateProjectFinancingQuota(
    projectId: string,
    quotaId: string,
    actorUserId: string,
    input: TerminateProjectFinancingQuotaDto
  ) {
    const reason = requiredTrimmed(
      input.reason,
      "请填写项目垫资额度终止原因"
    );
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "项目垫资额度终止需要当前登录密码确认"
    );
    if (!this.auth) {
      throw new Error("项目垫资额度终止缺少身份确认服务");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      await this.funding.lockFundingContext(tx, projectId);
      const quota = await tx.projectFinancingQuota.findFirst({
        where: { id: quotaId, projectId }
      });
      if (!quota) {
        throw new NotFoundException("项目垫资额度不存在");
      }
      if (quota.status !== "approved") {
        throw new BadRequestException("只有已批准的项目垫资额度可以终止");
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });
      const terminatedAt = new Date();
      const updated = await tx.projectFinancingQuota.update({
        where: { id: quota.id },
        data: {
          status: "terminated",
          terminatedAt,
          terminatedByUserId: actorUserId,
          terminationReason: reason,
          terminationSignatureFileId: signature.fileId,
          terminationSignatureSha256: signature.sha256,
          terminationSignatureVersionId: signature.versionId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.financing_quota.terminate",
        businessType: "project_financing_quota",
        businessId: quota.id,
        metadata: {
          projectId: quota.projectId,
          fromStatus: quota.status,
          toStatus: "terminated",
          reason,
          terminationSignatureVersionId: signature.versionId
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

export function projectMoneyToApi(value: bigint): string {
  return moneyCentsToApi(dbMoneyToBigInt(value, "项目金额"));
}

function normalizePositiveMoneyCents(value: unknown, message: string): bigint {
  const cents = parseMoneyCentsInput(value as string, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function parseReceiptDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("到账日期不正确，请重新选择");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("到账日期不正确，请重新选择");
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
    throw new BadRequestException("对上结算日期不正确，请重新选择");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("对上结算日期不正确，请重新选择");
  }
  return parsed;
}

function parseOwnerContractDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("业主主合同签订日期不正确，请重新选择");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("业主主合同签订日期不正确，请重新选择");
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
    throw new BadRequestException("到账来源类型不正确，请重新选择");
  }
  if (!Object.prototype.hasOwnProperty.call(RECEIPT_SOURCE_LABELS, value)) {
    throw new BadRequestException("到账来源类型不正确，请重新选择");
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
  amountCents: bigint;
  payerName: string;
  sourceType: string;
  affiliateAssignmentId?: string | null;
  affiliateBusinessPartyVersionId?: string | null;
  affiliateNameSnapshot?: string | null;
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
    affiliateAssignmentId: receipt.affiliateAssignmentId ?? null,
    affiliateBusinessPartyVersionId:
      receipt.affiliateBusinessPartyVersionId ?? null,
    affiliateNameSnapshot: receipt.affiliateNameSnapshot ?? null,
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
  amountCents: bigint;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: string;
  paymentSubjectType?: string | null;
  affiliateAssignmentId?: string | null;
  affiliateBusinessPartyVersionId?: string | null;
  affiliateNameSnapshot?: string | null;
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
    paymentSubjectType: proxyPayment.paymentSubjectType ?? "affiliate",
    affiliateAssignmentId: proxyPayment.affiliateAssignmentId ?? null,
    affiliateBusinessPartyVersionId:
      proxyPayment.affiliateBusinessPartyVersionId ?? null,
    affiliateNameSnapshot: proxyPayment.affiliateNameSnapshot ?? null,
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
  reportedAmountCents: bigint;
  approvedAmountCents: bigint;
  approvingPartyName: string;
  periodLabel: string;
  isFinal: boolean;
  affiliateAssignmentId?: string | null;
  affiliateBusinessPartyVersionId?: string | null;
  affiliateNameSnapshot?: string | null;
  description?: string | null;
  voucherFileId: string;
  documentVersion?: number;
  fileContentSha256Snapshot?: string | null;
  recordedByUserId: string;
  status?: string;
  confirmedByUserId?: string | null;
  confirmedAt?: Date | null;
  confirmationSignatureVersionId?: string | null;
  confirmationSignatureFileId?: string | null;
  confirmationSignatureSha256?: string | null;
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
    affiliateAssignmentId: upstreamSettlement.affiliateAssignmentId ?? null,
    affiliateBusinessPartyVersionId:
      upstreamSettlement.affiliateBusinessPartyVersionId ?? null,
    affiliateNameSnapshot: upstreamSettlement.affiliateNameSnapshot ?? null,
    description: upstreamSettlement.description ?? null,
    voucherFileId: upstreamSettlement.voucherFileId,
    documentVersion: upstreamSettlement.documentVersion ?? 1,
    fileContentSha256Snapshot: upstreamSettlement.fileContentSha256Snapshot ?? null,
    recordedByUserId: upstreamSettlement.recordedByUserId,
    status: upstreamSettlement.status ?? "legacy_recorded",
    confirmedByUserId: upstreamSettlement.confirmedByUserId ?? null,
    confirmedAt: upstreamSettlement.confirmedAt?.toISOString() ?? null,
    confirmationSignatureVersionId:
      upstreamSettlement.confirmationSignatureVersionId ?? null,
    confirmationSignatureFileId:
      upstreamSettlement.confirmationSignatureFileId ?? null,
    confirmationSignatureSha256:
      upstreamSettlement.confirmationSignatureSha256 ?? null,
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
  amountCents: bigint;
  taxRateBps?: number | null;
  pricingMethod: string;
  paymentTermsSummary?: string | null;
  retentionSummary?: string | null;
  affiliateAssignmentId?: string | null;
  affiliateBusinessPartyVersionId?: string | null;
  affiliateNameSnapshot?: string | null;
  affiliateCreditCodeSnapshot?: string | null;
  fileId: string;
  documentVersion?: number;
  fileContentSha256Snapshot?: string | null;
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
    affiliateAssignmentId: ownerContract.affiliateAssignmentId ?? null,
    affiliateBusinessPartyVersionId:
      ownerContract.affiliateBusinessPartyVersionId ?? null,
    affiliateNameSnapshot: ownerContract.affiliateNameSnapshot ?? null,
    affiliateCreditCodeSnapshot: ownerContract.affiliateCreditCodeSnapshot ?? null,
    fileId: ownerContract.fileId,
    documentVersion: ownerContract.documentVersion ?? 1,
    fileContentSha256Snapshot: ownerContract.fileContentSha256Snapshot ?? null,
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
  amountCents: bigint;
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
  amountCents: bigint;
  reason: string;
  validUntil: Date | null;
  attachmentFileId: string;
  requestedByUserId: string;
  approvedByUserId?: string | null;
  approvedAt?: Date | null;
  status: string;
  terminatedAt?: Date | null;
  terminatedByUserId?: string | null;
  terminationReason?: string | null;
  terminationSignatureFileId?: string | null;
  terminationSignatureSha256?: string | null;
  terminationSignatureVersionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: quota.id,
    projectId: quota.projectId,
    amountCents: projectMoneyToApi(quota.amountCents),
    reason: quota.reason,
    validUntil: quota.validUntil?.toISOString() ?? null,
    attachmentFileId: quota.attachmentFileId,
    requestedByUserId: quota.requestedByUserId,
    approvedByUserId: quota.approvedByUserId ?? null,
    approvedAt: quota.approvedAt?.toISOString() ?? null,
    status: quota.status,
    terminatedAt: quota.terminatedAt?.toISOString() ?? null,
    terminatedByUserId: quota.terminatedByUserId ?? null,
    terminationReason: quota.terminationReason ?? null,
    terminationSignatureFileId: quota.terminationSignatureFileId ?? null,
    terminationSignatureSha256: quota.terminationSignatureSha256 ?? null,
    terminationSignatureVersionId: quota.terminationSignatureVersionId ?? null,
    createdAt: quota.createdAt.toISOString(),
    updatedAt: quota.updatedAt.toISOString()
  };
}
