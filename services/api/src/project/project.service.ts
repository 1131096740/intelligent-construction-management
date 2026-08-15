import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  Prisma,
  type ApprovalActionLog,
  type ProjectFinancingQuota
} from "@prisma/client";
import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { PrismaService } from "../database/prisma.service";
import {
  acquireFileBusinessBindingTransactionLock,
  hasAnyBusinessFileBinding
} from "../file/file-business-binding";
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
import type { ConfirmProjectUpstreamFundFactDto } from "./dto/confirm-project-upstream-fund-fact.dto";
import type {
  RecordProjectProxyPaymentDto,
  ProjectProxyPaymentType
} from "./dto/record-project-proxy-payment.dto";
import type { ConfirmProjectOwnerContractDto } from "./dto/confirm-project-owner-contract.dto";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { RecordProjectOwnerContractDto } from "./dto/record-project-owner-contract.dto";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import type { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import {
  PROJECT_AFFILIATE_DEDUCTION_CATEGORIES,
  PROJECT_UPSTREAM_FUND_BASIS_TYPES,
  PROJECT_UPSTREAM_FUND_ENTRY_KINDS,
  PROJECT_UPSTREAM_FUND_FACT_TYPES,
  type ProjectAffiliateDeductionCategory,
  type ProjectUpstreamFundBasisType,
  type ProjectUpstreamFundEntryKind,
  type ProjectUpstreamFundFactType,
  type RecordProjectUpstreamFundFactDto
} from "./dto/record-project-upstream-fund-fact.dto";
import type { RequestProjectFinancingQuotaDto } from "./dto/request-project-financing-quota.dto";
import type { RequestSettlementExceptionQuotaDto } from "./dto/request-settlement-exception-quota.dto";
import type { ReviewProjectFinancingQuotaDto } from "./dto/review-project-financing-quota.dto";
import type { ReviewSettlementExceptionQuotaDto } from "./dto/review-settlement-exception-quota.dto";
import type { TerminateProjectFinancingQuotaDto } from "./dto/terminate-project-financing-quota.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";
import { resolveCurrentProjectAffiliate } from "./project-affiliate-subject";
import {
  assertProjectFinancingQuotaApprovalLifecycle,
  assertProjectFinancingQuotaApprovalSnapshot,
  indexProjectFinancingQuotaApprovalInstances,
  PROJECT_FINANCING_QUOTA_APPROVAL_NODES,
  type FinancingQuotaApprovalInstanceSnapshot
} from "./project-financing-quota-approval";

const UPSTREAM_SETTLEMENT_GAP =
  "缺少已确认上游结算，当前经营收入仅按已确认业主付款事实展示，不把挂靠拨款误作收入。";
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
const UPSTREAM_FUND_FACT_LABELS: Record<ProjectUpstreamFundFactType, string> = {
  owner_payment_to_affiliate: "业主向挂靠企业付款",
  affiliate_remittance_to_company: "挂靠企业向我方拨款",
  affiliate_deduction: "挂靠企业扣款",
  unreconciled_receipt_difference: "待核对到账差额"
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
      "施工企业版本不能为空"
    );
    const changeReason = requiredTrimmed(
      input.changeReason,
      "施工企业配置或变更原因不能为空"
    );
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException("施工企业生效时间格式不正确");
    }
    if (effectiveFrom.getTime() > Date.now()) {
      throw new BadRequestException("施工企业生效时间不能晚于当前时间");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [project] = await tx.$queryRaw<Array<{
          id: string;
          isActive: boolean;
          constructionEnterpriseLockedAt: Date | null;
          operatingLedgerEffectiveDate: Date | null;
        }>>(Prisma.sql`
          SELECT "id", "isActive", "constructionEnterpriseLockedAt", "operatingLedgerEffectiveDate"
          FROM "Project"
          WHERE "id" = ${projectId}
          FOR UPDATE
        `);
        if (!project?.isActive) {
          throw new NotFoundException("项目不存在或已停用，不能配置施工企业");
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
            "项目存在多个当前施工企业，不能直接覆盖；请先按人工清单消除冲突"
          );
        }
        const currentAssignment = currentAssignments[0];
        if (project.constructionEnterpriseLockedAt) {
          throw new BadRequestException(
            "项目已有正式经营事实，施工企业已经锁定，不能普通设置或更换"
          );
        }
        if (
          project.operatingLedgerEffectiveDate &&
          effectiveFrom.toISOString().slice(0, 10) >
            project.operatingLedgerEffectiveDate.toISOString().slice(0, 10)
        ) {
          throw new BadRequestException("施工企业生效日不得晚于经营账生效日");
        }
        if (
          currentAssignment?.effectiveFrom &&
          effectiveFrom.getTime() < currentAssignment.effectiveFrom.getTime()
        ) {
          throw new BadRequestException("新施工企业生效时间不能早于当前施工企业生效时间");
        }

        const version = await tx.businessPartyVersion.findUnique({
          where: { id: businessPartyVersionId },
          select: { id: true, businessPartyId: true, snapshot: true }
        });
        if (!version) {
          throw new NotFoundException("所选施工企业版本不存在");
        }
        const party = await tx.businessParty.findUnique({
          where: { id: version.businessPartyId },
          select: { id: true, status: true }
        });
        if (!party || party.status !== "active") {
          throw new BadRequestException("所选施工企业已停用，不能建立新的项目映射");
        }
        const snapshot = version.snapshot as {
          name?: unknown;
          unifiedSocialCreditCode?: unknown;
        };
        const affiliateNameSnapshot = requiredTrimmed(
          snapshot.name,
          "所选施工企业版本缺少企业名称，不能建立项目映射"
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
          "项目当前施工企业已被其他操作更新，请刷新项目经营档案后重试"
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
      upstreamFundFacts,
      supplierRefundAmountCents,
      projectProxyPayments,
      projectAffiliatePayments,
      projectUpstreamSettlements,
      projectFinancingQuotas,
      projectExpenseRequests,
      spotProcurementPayments,
      projectFundingAllocations
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
        where: {
          projectId,
          voidedAt: null,
          sourceType: { in: ["general_contractor_payment", "other"] }
        },
        select: { amountCents: true }
      }),
      this.prisma.projectUpstreamFundFact.findMany({
        where: { projectId },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
      }),
      findProjectSpotProcurementRefundAmounts(
        this.prisma,
        projectId
      ),
      this.prisma.projectProxyPayment.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      this.prisma.projectAffiliatePaymentFact.findMany({
        where: { projectId, status: "confirmed" },
        select: { amountCents: true, effectDirection: true }
      }),
      this.prisma.projectUpstreamSettlement.findMany({
        where: { projectId, status: "confirmed", voidedAt: null },
        select: { approvedAmountCents: true }
      }),
      this.prisma.projectFinancingQuota.findMany({
        where: { projectId },
        select: {
          id: true,
          amountCents: true,
          status: true,
          validUntil: true
        }
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
      }),
      this.prisma.projectFundingAllocation.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
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
    const { allocationSummary: fundingAllocationSummary } =
      this.funding.assertFundingLedgerCoverage({
        receipts: projectReceipts,
        affiliateRemittances: upstreamFundFacts
          .filter((fact) =>
            fact.factType === "affiliate_remittance_to_company" &&
            fact.status === "confirmed"
          )
          .map((fact) => ({
            amountCents: fact.amountCents,
            effectDirection: fact.effectDirection
          })),
        quotas: projectFinancingQuotas,
        allocations: projectFundingAllocations
      });
    const legacyReceiptsCents = sumDbMoneyToBigInt(
      projectReceipts.map((receipt) => receipt.amountCents),
      "历史项目实收金额"
    );
    const ownerPaymentCents = upstreamFundFactNetAmount(
      upstreamFundFacts,
      "owner_payment_to_affiliate"
    );
    const affiliateRemittanceCents = upstreamFundFactNetAmount(
      upstreamFundFacts,
      "affiliate_remittance_to_company"
    );
    const affiliateDeductionCents = upstreamFundFactNetAmount(
      upstreamFundFacts,
      "affiliate_deduction"
    );
    const unreconciledReceiptDifferenceCents =
      upstreamFundUnreconciledDifference(upstreamFundFacts);
    const actualReceiptsCents = legacyReceiptsCents + affiliateRemittanceCents;
    const supplierRefundsCents = sumDbMoneyToBigInt(
      supplierRefundAmountCents,
      "供应商退款到账金额"
    );
    const proxyPaymentCents = sumDbMoneyToBigInt(
      projectProxyPayments.map((payment) => payment.amountCents),
      "项目代付金额"
    );
    const affiliateDownstreamPaymentCents = projectAffiliatePayments.reduce(
      (total, payment) =>
        total +
        (payment.effectDirection === "decrease" ? -1n : 1n) *
          dbMoneyToBigInt(payment.amountCents, "挂靠企业对下付款金额"),
      0n
    );
    const upstreamSettlementCents = sumDbMoneyToBigInt(
      projectUpstreamSettlements.map((settlement) => settlement.approvedAmountCents),
      "对上结算金额"
    );
    const financingReadAt = new Date();
    const availableFinancingQuotas = projectFinancingQuotas.filter(
      (quota) =>
        quota.status === "approved" &&
        (quota.validUntil === null || quota.validUntil.getTime() >= financingReadAt.getTime())
    );
    const availableFinancingCents = sumDbMoneyToBigInt(
      availableFinancingQuotas.map((quota) => {
        const sourceKey = `financing_quota:${quota.id}`;
        const netUsed = fundingAllocationSummary.netUsedBySource.get(sourceKey) ?? 0n;
        return dbMoneyToBigInt(quota.amountCents, "项目垫资额度") - netUsed;
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
      : ownerPaymentCents;
    const operatingCostCents =
      actualPaidCents +
      proxyPaymentCents +
      affiliateDownstreamPaymentCents +
      affiliateDeductionCents;
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
      availableFinancingCents -
      (fundingAllocationSummary.netUsedBySource.get("project_cash") ?? 0n) -
      approvalPendingOccupancyCents -
      approvedPendingPaymentCents;
    const dataGaps = [
      ...(projectUpstreamSettlements.length ? [] : [UPSTREAM_SETTLEMENT_GAP]),
      ...(availableFinancingQuotas.length ? [] : [FINANCING_LIMIT_GAP])
    ];

    return {
      project,
      cash: {
        actualReceiptsCents: projectMoneyToApi(actualReceiptsCents),
        legacyReceiptsCents: projectMoneyToApi(legacyReceiptsCents),
        affiliateRemittanceCents: projectMoneyToApi(affiliateRemittanceCents),
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
        affiliateDownstreamPaymentCents: projectMoneyToApi(
          affiliateDownstreamPaymentCents
        ),
        operatingCostCents: projectMoneyToApi(operatingCostCents),
        grossProfitCents: projectMoneyToApi(operatingIncomeCents - operatingCostCents)
      },
      upstreamFunds: {
        ownerPaymentCents: projectMoneyToApi(ownerPaymentCents),
        affiliateRemittanceCents: projectMoneyToApi(affiliateRemittanceCents),
        affiliateDeductionCents: projectMoneyToApi(affiliateDeductionCents),
        unreconciledReceiptDifferenceCents:
          projectMoneyToApi(unreconciledReceiptDifferenceCents),
        writtenCount: upstreamFundFacts.filter((fact) => fact.basisType === "written").length,
        oralCount: upstreamFundFacts.filter((fact) => fact.basisType === "oral").length,
        rows: upstreamFundFacts.map(toUpstreamFundFactReadModel)
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
    void projectId;
    void actorUserId;
    void input;
    throw new GoneException(
      "旧项目收款入口已停止新增；请分别登记业主付款、挂靠企业向我方拨款、挂靠扣款或待核对到账差额"
    );
  }

  async recordUpstreamFundFact(
    projectId: string,
    actorUserId: string,
    input: RecordProjectUpstreamFundFactDto
  ) {
    const factType = normalizeUpstreamFundFactType(input.factType);
    const basisType = normalizeUpstreamFundBasisType(input.basisType);
    const entryKind = normalizeUpstreamFundEntryKind(input.entryKind ?? "original");
    const occurredAt = parseUpstreamFundDate(input.occurredAt);
    const amountCents = normalizePositiveMoneyCents(
      input.amountCents,
      "上游资金金额必须大于零"
    );
    const counterpartyName = requiredTrimmed(input.counterpartyName, "请填写交易对方名称");
    const deductionCategory = normalizeDeductionCategory(
      factType,
      input.deductionCategory
    );
    const upstreamSettlementId = optionalTrimmed(input.upstreamSettlementId);
    const evidenceFileId = optionalTrimmed(input.evidenceFileId);
    const adjustsFactId = optionalTrimmed(input.adjustsFactId);
    const effectDirection = normalizeUpstreamFundEffectDirection(
      entryKind,
      input.effectDirection
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;
    const idempotencyKey = requiredTrimmed(input.idempotencyKey, "请提供上游资金登记幂等键");

    if (basisType === "written" && !evidenceFileId) {
      throw new BadRequestException("书面依据的上游资金事实必须上传依据文件");
    }
    if (entryKind === "original" && adjustsFactId) {
      throw new BadRequestException("原始上游资金事实不能关联被调整记录");
    }
    if (entryKind !== "original" && !adjustsFactId) {
      throw new BadRequestException("更正、反向或重分类必须关联原上游资金事实");
    }
    if (
      factType === "unreconciled_receipt_difference" &&
      entryKind !== "original"
    ) {
      throw new BadRequestException("待核对到账差额只能追加重分类事实，不能直接覆盖");
    }

    const requestFingerprint = upstreamFundRequestFingerprint({
      projectId,
      actorUserId,
      factType,
      basisType,
      entryKind,
      adjustsFactId,
      effectDirection,
      occurredAt: occurredAt.toISOString(),
      amountCents: amountCents.toString(),
      counterpartyName,
      deductionCategory,
      upstreamSettlementId,
      evidenceFileId,
      description
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectUpstreamFundFact.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.recordedByUserId !== actorUserId ||
            existing.requestFingerprint !== requestFingerprint
          ) {
            throw new ConflictException("上游资金登记幂等键已用于不同请求");
          }
          return toUpstreamFundFactReadModel(existing);
        }

        const project = await tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        });
        if (!project) {
          throw new NotFoundException("项目不存在或已停用，请刷新后重试");
        }
        const roleKeys = await this.loadActorRoleKeys(tx, actorUserId, projectId);
        const recordedByRoleKey = roleKeys.includes("finance_director")
          ? "finance_director"
          : roleKeys.includes("finance_staff")
            ? "finance_staff"
            : null;
        if (!recordedByRoleKey) {
          throw new ForbiddenException("只有项目财务人员或财务主管可以登记上游资金事实");
        }

        const currentAffiliate = await resolveCurrentProjectAffiliate(tx, project.id);
        if (upstreamSettlementId) {
          const settlement = await tx.projectUpstreamSettlement.findFirst({
            where: {
              id: upstreamSettlementId,
              projectId,
              status: "confirmed",
              voidedAt: null
            },
            select: { id: true }
          });
          if (!settlement) {
            throw new BadRequestException("关联上游结算不存在、未确认或不属于当前项目");
          }
        }

        if (adjustsFactId) {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "ProjectUpstreamFundFact"
            WHERE "id" = ${adjustsFactId}
              AND "projectId" = ${projectId}
            FOR UPDATE
          `);
          const target = await tx.projectUpstreamFundFact.findFirst({
            where: { id: adjustsFactId, projectId }
          });
          if (!target) {
            throw new NotFoundException("被调整的上游资金事实不存在");
          }
          const existingAdjustments = await tx.projectUpstreamFundFact.findMany({
            where: {
              adjustsFactId,
              status: { in: ["pending_confirm", "confirmed"] }
            },
            select: {
              entryKind: true,
              effectDirection: true,
              amountCents: true
            }
          });
          assertUpstreamFundAdjustment(
            target,
            existingAdjustments,
            { factType, entryKind, effectDirection, amountCents }
          );
        }

        const evidence = evidenceFileId
          ? await tx.fileObject.findUnique({
              where: { id: evidenceFileId },
              select: {
                id: true,
                uploadedByUserId: true,
                storageStatus: true,
                contentSha256: true
              }
            })
          : null;
        if (evidenceFileId && !evidence) {
          throw new NotFoundException("上游资金依据文件不存在，请重新上传");
        }
        if (evidence && evidence.uploadedByUserId !== actorUserId) {
          throw new BadRequestException("只能使用本人上传的上游资金依据文件");
        }
        if (
          evidence &&
          (evidence.storageStatus !== "active" ||
            typeof evidence.contentSha256 !== "string" ||
            evidence.contentSha256.length !== 64)
        ) {
          throw new BadRequestException("上游资金依据文件尚未完成有效性校验");
        }

        const status =
          factType === "unreconciled_receipt_difference"
            ? "pending_reconciliation"
            : "pending_confirm";
        const created = await tx.projectUpstreamFundFact.create({
          data: {
            projectId,
            factType,
            entryKind,
            adjustsFactId,
            effectDirection,
            occurredAt,
            amountCents,
            counterpartyName,
            basisType,
            deductionCategory,
            upstreamSettlementId,
            affiliateAssignmentId: currentAffiliate.assignmentId,
            affiliateBusinessPartyVersionId:
              currentAffiliate.businessPartyVersionId,
            affiliateNameSnapshot: currentAffiliate.name,
            description,
            evidenceFileId,
            documentVersion: 1,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey,
            status
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "project.upstream_fund_fact.record",
          businessType: factType,
          businessId: created.id,
          metadata: {
            projectId,
            factType,
            entryKind,
            adjustsFactId,
            effectDirection,
            amountCents: moneyCentsToApi(amountCents),
            basisType,
            deductionCategory,
            upstreamSettlementId,
            affiliateAssignmentId: currentAffiliate.assignmentId,
            affiliateBusinessPartyVersionId:
              currentAffiliate.businessPartyVersionId,
            evidenceFileId,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            status
          }
        });
        return toUpstreamFundFactReadModel(created);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.projectUpstreamFundFact.findUnique({
          where: { idempotencyKey }
        });
        if (
          existing?.projectId === projectId &&
          existing.recordedByUserId === actorUserId &&
          existing.requestFingerprint === requestFingerprint
        ) {
          return toUpstreamFundFactReadModel(existing);
        }
        throw new ConflictException("上游资金事实已登记，请刷新台账后核对");
      }
      throw error;
    }
  }

  async getUpstreamFundFactConfirmationCapability(
    projectId: string,
    factId: string,
    actorUserId: string
  ) {
    const fact = await this.prisma.projectUpstreamFundFact.findFirst({
      where: { id: factId, projectId },
      select: { id: true, factType: true, basisType: true, status: true }
    });
    if (!fact) throw new NotFoundException("上游资金事实不存在");
    if (
      fact.factType === "unreconciled_receipt_difference" ||
      fact.status !== "pending_confirm"
    ) {
      return { projectId, fundFactId: fact.id, availableActions: [] };
    }
    const roleKeys = await this.loadActorRoleKeys(
      this.prisma,
      actorUserId,
      projectId
    );
    const canConfirm =
      fact.basisType === "oral"
        ? roleKeys.includes("finance_director")
        : roleKeys.includes("finance_staff") || roleKeys.includes("finance_director");
    return {
      projectId,
      fundFactId: fact.id,
      availableActions: canConfirm ? ["confirm_upstream_fund_fact"] : []
    };
  }

  async confirmUpstreamFundFact(
    projectId: string,
    factId: string,
    actorUserId: string,
    input: ConfirmProjectUpstreamFundFactDto,
    now: Date = new Date()
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    const confirmationActionId = requiredTrimmed(
      input.confirmationActionId,
      "请提供上游资金确认幂等键"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm upstream fund fact");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.projectUpstreamFundFact.findUnique({
        where: { confirmationActionId }
      });
      if (replay) {
        if (
          replay.id !== factId ||
          replay.projectId !== projectId ||
          replay.confirmedByUserId !== actorUserId
        ) {
          throw new ConflictException("上游资金确认幂等键已用于不同动作");
        }
        return toUpstreamFundFactReadModel(replay);
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ProjectUpstreamFundFact"
        WHERE "id" = ${factId}
          AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      const fact = await tx.projectUpstreamFundFact.findFirst({
        where: { id: factId, projectId }
      });
      if (!fact) {
        throw new NotFoundException("上游资金事实不存在");
      }
      if (fact.factType === "unreconciled_receipt_difference") {
        throw new BadRequestException("待核对到账差额不能直接确认成收入或成本");
      }
      if (fact.status !== "pending_confirm") {
        throw new BadRequestException("当前上游资金事实状态不可确认");
      }

      const roleKeys = await this.loadActorRoleKeys(tx, actorUserId, projectId);
      const canConfirmWritten =
        roleKeys.includes("finance_staff") || roleKeys.includes("finance_director");
      const canConfirmOral = roleKeys.includes("finance_director");
      if (
        (fact.basisType === "written" && !canConfirmWritten) ||
        (fact.basisType === "oral" && !canConfirmOral)
      ) {
        throw new ForbiddenException(
          fact.basisType === "oral"
            ? "口头通知必须由财务主管执行独立确认"
          : "只有项目财务人员或财务主管可以确认书面依据资金事实"
        );
      }

      const decreasesProjectCash =
        fact.factType === "affiliate_remittance_to_company" &&
        fact.effectDirection === "decrease";
      if (decreasesProjectCash) {
        await this.funding.lockFundingContext(tx, projectId);
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });
      const updated = await tx.projectUpstreamFundFact.updateMany({
        where: {
          id: factId,
          projectId,
          status: "pending_confirm",
          confirmationActionId: null
        },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt: now,
          confirmationActionId,
          confirmationSignatureVersionId: signature.versionId,
          confirmationSignatureFileId: signature.fileId,
          confirmationSignatureSha256: signature.sha256
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("上游资金事实已被其他操作确认，请刷新后核对");
      }
      if (decreasesProjectCash) {
        await this.funding.assertPersistedProjectFundingLedgerCoverage(
          tx,
          projectId
        );
      }
      const confirmed = await tx.projectUpstreamFundFact.findUnique({
        where: { id: factId }
      });
      if (!confirmed) {
        throw new InternalServerErrorException("上游资金确认结果未正确保存，请稍后重试");
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "project.upstream_fund_fact.confirm",
        businessType: confirmed.factType,
        businessId: confirmed.id,
        metadata: {
          projectId,
          factId,
          factType: confirmed.factType,
          entryKind: confirmed.entryKind,
          amountCents: moneyCentsToApi(confirmed.amountCents),
          basisType: confirmed.basisType,
          confirmationActionId,
          confirmationSignatureVersionId: signature.versionId,
          confirmedAt: now.toISOString()
        }
      });
      return toUpstreamFundFactReadModel(confirmed);
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

  async getProjectFinancingQuotaWorkbench(projectId: string, actorUserId: string) {
    const readAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true, code: true, name: true }
      });
      if (!project) {
        throw new NotFoundException("项目不存在或已停用");
      }

      const [
        quotas,
        allocations,
        actorRoleKeys,
        projectCashReceipts,
        affiliateRemittances
      ] = await Promise.all([
        tx.projectFinancingQuota.findMany({
          where: { projectId: project.id },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }]
        }),
        tx.projectFundingAllocation.findMany({
          where: { projectId: project.id },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }]
        }),
        this.loadActorRoleKeys(tx, actorUserId, project.id),
        tx.projectReceipt.findMany({
          where: {
            projectId: project.id,
            voidedAt: null,
            sourceType: { in: ["general_contractor_payment", "other"] }
          },
          select: { amountCents: true }
        }),
        tx.projectUpstreamFundFact.findMany({
          where: {
            projectId: project.id,
            factType: "affiliate_remittance_to_company",
            status: "confirmed"
          },
          select: { amountCents: true, effectDirection: true }
        })
      ]);
      const quotaIds = quotas.map((quota) => quota.id);
      const approvalInstances = quotaIds.length
        ? await tx.approvalInstance.findMany({
            where: {
              businessType: "project_financing_quota",
              flowType: "project_financing_quota.approve",
              businessId: { in: quotaIds }
            },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }]
          })
        : [];
      const userIds = Array.from(new Set(quotas.flatMap((quota) => [
        quota.requestedByUserId,
        quota.approvedByUserId,
        quota.terminatedByUserId
      ]).filter((userId): userId is string => Boolean(userId))));
      const users = userIds.length
        ? await tx.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true }
          })
        : [];
      const userNameById = new Map(users.map((user) => [user.id, user.name]));
      const approvalByQuotaId = indexProjectFinancingQuotaApprovalInstances(
        approvalInstances
      );
      const { allocationSummary } = this.funding.assertFundingLedgerCoverage({
        receipts: projectCashReceipts,
        affiliateRemittances,
        quotas,
        allocations
      });
      const usageGroupsByQuotaId = indexProjectFinancingQuotaUsageGroups(
        allocations
      );

      const rows = quotas.map((quota) => {
        const amountCents = dbMoneyToBigInt(quota.amountCents, "项目垫资额度");
        const sourceKey = `financing_quota:${quota.id}`;
        const netUsedAmountCents = allocationSummary.netUsedBySource.get(sourceKey) ?? 0n;
        if (netUsedAmountCents > amountCents) {
          throw new ConflictException("项目垫资额度累计占用超过批准金额");
        }
        const isExpired = quota.validUntil !== null && quota.validUntil < readAt;
        const availableAmountCents =
          quota.status === "approved" && !isExpired
            ? amountCents - netUsedAmountCents
            : 0n;
        const {
          instance: currentApproval,
          nodes
        } = assertProjectFinancingQuotaApprovalLifecycle(
          quota,
          approvalByQuotaId.get(quota.id)
        );
        const currentNode = currentApproval?.status === "in_progress"
          ? nodes[currentApproval.currentNodeIndex] ?? null
          : null;
        const actorApprovalRole = currentNode?.roleKeys.find((roleKey) =>
          actorRoleKeys.includes(roleKey)
        ) ?? null;
        const selfReview = currentApproval?.applicantUserId === actorUserId;
        const selfReviewAllowed =
          selfReview &&
          quota.requestedByRoleKey === "finance_director" &&
          currentApproval?.currentNodeIndex === 0 &&
          actorApprovalRole === "finance_director";
        const reviewEnabled =
          quota.status === "approval_pending" &&
          currentApproval?.status === "in_progress" &&
          Boolean(currentNode) &&
          canPerform("project.financing_quota.approve", actorRoleKeys) &&
          Boolean(actorApprovalRole) &&
          (!selfReview || selfReviewAllowed);
        const terminateEnabled =
          quota.status === "approved" &&
          currentApproval?.status === "approved" &&
          canPerform("project.financing_quota.terminate", actorRoleKeys);

        return {
          id: quota.id,
          amountCents: moneyCentsToApi(amountCents),
          reason: quota.reason,
          validUntil: quota.validUntil?.toISOString() ?? null,
          requestedByName: userNameById.get(quota.requestedByUserId) ?? null,
          approvedByName: quota.approvedByUserId
            ? userNameById.get(quota.approvedByUserId) ?? null
            : null,
          approvedAt: quota.approvedAt?.toISOString() ?? null,
          status: quota.status,
          statusLabel: projectFinancingQuotaStatusLabel(quota.status, isExpired),
          isExpired,
          terminatedAt: quota.terminatedAt?.toISOString() ?? null,
          terminatedByName: quota.terminatedByUserId
            ? userNameById.get(quota.terminatedByUserId) ?? null
            : null,
          terminationReason: quota.terminationReason ?? null,
          createdAt: quota.createdAt.toISOString(),
          updatedAt: quota.updatedAt.toISOString(),
          netUsedAmountCents: moneyCentsToApi(netUsedAmountCents),
          availableAmountCents: moneyCentsToApi(availableAmountCents),
          currentApproval: {
            status: currentApproval.status,
            currentNodeIndex: currentApproval.currentNodeIndex,
            currentNodeName: currentNode?.name ?? null,
            updatedAt: currentApproval.updatedAt.toISOString()
          },
          lifecycleToken: financingQuotaLifecycleToken(
            quota,
            currentApproval,
            netUsedAmountCents
          ),
          reviewAction: financingQuotaReadAction({
            key: "review_financing_quota",
            label: "审批垫资额度",
            kind: "primary",
            requiredAction: "project.financing_quota.approve",
            enabled: Boolean(reviewEnabled),
            disabledReason: financingQuotaReviewDisabledReason({
              quotaStatus: quota.status,
              currentApproval,
              currentNode,
              actorApprovalRole,
              actorRoleKeys,
              selfReview,
              selfReviewAllowed
            }),
            requiresPassword: true,
            requiresSelfReviewConfirmation: Boolean(selfReviewAllowed)
          }),
          terminateAction: financingQuotaReadAction({
            key: "terminate_financing_quota",
            label: "终止垫资额度",
            kind: "danger",
            requiredAction: "project.financing_quota.terminate",
            enabled: terminateEnabled,
            disabledReason: terminateEnabled
              ? null
              : quota.status !== "approved"
                ? "只有已批准的项目垫资额度可以终止"
                : currentApproval?.status !== "approved"
                  ? "项目垫资额度审批生命周期不完整"
                  : "当前账号无项目垫资额度终止权限",
            requiresPassword: true
          }),
          usageGroups: usageGroupsByQuotaId.get(quota.id) ?? []
        };
      });

      return {
        project,
        readAt: readAt.toISOString(),
        policy: {
          allocationOrder: ["project_cash", "financing_quota"] as const,
          userSelectable: false
        },
        summary: {
          quotaAmountCents: moneyCentsToApi(rows.reduce(
            (total, row) => total + BigInt(row.amountCents),
            0n
          )),
          netUsedAmountCents: moneyCentsToApi(rows.reduce(
            (total, row) => total + BigInt(row.netUsedAmountCents),
            0n
          )),
          currentlyAvailableAmountCents: moneyCentsToApi(rows.reduce(
            (total, row) => total + BigInt(row.availableAmountCents),
            0n
          )),
          projectCashNetUsedAmountCents: moneyCentsToApi(
            allocationSummary.netUsedBySource.get("project_cash") ?? 0n
          )
        },
        requestAction: financingQuotaReadAction({
          key: "request_financing_quota",
          label: "申请垫资额度",
          kind: "primary",
          requiredAction: "project.financing_quota.request",
          enabled: canPerform("project.financing_quota.request", actorRoleKeys),
          disabledReason: canPerform("project.financing_quota.request", actorRoleKeys)
            ? null
            : "当前账号无项目垫资额度申请权限",
          requiresFile: true
        }),
        rows
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getProjectFinancingQuotaReviewCapability(
    projectId: string,
    quotaId: string,
    actorUserId: string
  ) {
    const workbench = await this.getProjectFinancingQuotaWorkbench(
      projectId,
      actorUserId
    );
    const matchingRows = workbench.rows.filter((row) => row.id === quotaId);
    if (matchingRows.length === 0) {
      throw new NotFoundException("项目垫资额度不存在");
    }
    if (matchingRows.length !== 1) {
      throw new ConflictException("项目垫资额度存在重复的只读审批能力");
    }
    const row = matchingRows[0]!;
    return {
      projectId: workbench.project.id,
      quotaId: row.id,
      status: row.status,
      lifecycleToken: row.lifecycleToken,
      reviewAction: row.reviewAction
    };
  }

  async getProjectFinancingQuotaTerminationCapability(
    projectId: string,
    quotaId: string,
    actorUserId: string
  ) {
    const workbench = await this.getProjectFinancingQuotaWorkbench(
      projectId,
      actorUserId
    );
    const matchingRows = workbench.rows.filter((row) => row.id === quotaId);
    if (matchingRows.length === 0) {
      throw new NotFoundException("项目垫资额度不存在");
    }
    if (matchingRows.length !== 1) {
      throw new ConflictException("项目垫资额度存在重复的只读终止能力");
    }
    const row = matchingRows[0]!;
    return {
      projectId: workbench.project.id,
      quotaId: row.id,
      status: row.status,
      lifecycleToken: row.lifecycleToken,
      terminateAction: row.terminateAction
    };
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
      : parseProjectFinancingQuotaValidUntil(
          input.validUntil,
          "项目垫资额度有效期无效"
        );
    const attachmentFileId = requiredTrimmed(
      input.attachmentFileId,
      "项目垫资额度附件必填"
    );
    const idempotencyKey = normalizeUuidV4(
      input.idempotencyKey,
      "项目垫资申请幂等键必须是 UUID"
    );
    const normalizedRequest = {
      projectId,
      actorUserId,
      amountCents,
      reason,
      validUntil,
      attachmentFileId,
      idempotencyKey
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const requestedByRoleKey = await this.requireProjectFinancingQuotaRequester(
          tx,
          projectId,
          actorUserId
        );
        const replay = await tx.projectFinancingQuota.findUnique({
          where: { requestIdempotencyKey: idempotencyKey }
        });
        if (replay) {
          return this.toProjectFinancingQuotaRequestReplay(
            tx,
            replay,
            normalizedRequest
          );
        }

        await acquireFileBusinessBindingTransactionLock(tx);
        const replayAfterFileBindingLock =
          await tx.projectFinancingQuota.findUnique({
            where: { requestIdempotencyKey: idempotencyKey }
          });
        if (replayAfterFileBindingLock) {
          return this.toProjectFinancingQuotaRequestReplay(
            tx,
            replayAfterFileBindingLock,
            normalizedRequest
          );
        }

        if (validUntil && validUntil.getTime() <= Date.now()) {
          throw new BadRequestException(
            "项目垫资额度有效期必须晚于当前时间"
          );
        }

        const file = await lockProjectFinancingQuotaAttachment(
          tx,
          attachmentFileId
        );
        if (!file) {
          throw new NotFoundException("项目垫资额度附件不存在");
        }
        if (file.uploadedByUserId !== actorUserId) {
          throw new BadRequestException(
            "项目垫资额度附件必须由申请人本人上传"
          );
        }
        if (file.storageStatus !== "active") {
          throw new BadRequestException("项目垫资额度附件尚未完成存储");
        }
        if (!isLowercaseSha256(file.contentSha256)) {
          throw new BadRequestException(
            "项目垫资额度附件缺少有效 SHA-256"
          );
        }
        if (await hasAnyBusinessFileBinding(tx, [attachmentFileId])) {
          throw new ConflictException("项目垫资额度附件已绑定其他业务事实");
        }

        const attachmentFileSha256Snapshot = file.contentSha256;
        const requestFingerprint = projectFinancingQuotaRequestFingerprint({
          projectId,
          actorUserId,
          requestedByRoleKey,
          amountCents: moneyCentsToApi(amountCents),
          reason,
          validUntil: validUntil?.toISOString() ?? null,
          attachmentFileId,
          attachmentFileSha256Snapshot
        });
        const quota = await tx.projectFinancingQuota.create({
          data: {
            projectId,
            amountCents,
            reason,
            validUntil,
            attachmentFileId,
            attachmentFileSha256Snapshot,
            requestedByUserId: actorUserId,
            requestedByRoleKey,
            requestIdempotencyKey: idempotencyKey,
            requestFingerprint,
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
            frozenNodes:
              PROJECT_FINANCING_QUOTA_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
            applicantUserId: actorUserId
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "project.financing_quota.request",
          businessType: "project_financing_quota",
          businessId: quota.id,
          metadata: {
            projectId,
            amountCents: moneyCentsToApi(amountCents),
            validUntil: validUntil?.toISOString() ?? null,
            attachmentFileId,
            attachmentFileSha256Snapshot,
            requestedByRoleKey,
            requestIdempotencyKey: idempotencyKey,
            requestFingerprint
          }
        });

        return projectFinancingQuotaRequestReceipt(quota, "created");
      });
    } catch (error) {
      if (!isProjectFinancingQuotaRequestIdempotencyConflict(error)) throw error;
      return this.prisma.$transaction(async (tx) => {
        await this.requireProjectFinancingQuotaRequester(
          tx,
          projectId,
          actorUserId
        );
        const replay = await tx.projectFinancingQuota.findUnique({
          where: { requestIdempotencyKey: idempotencyKey }
        });
        if (!replay) {
          throw new ConflictException(
            "项目垫资额度申请发生并发冲突，请刷新后重试"
          );
        }
        return this.toProjectFinancingQuotaRequestReplay(
          tx,
          replay,
          normalizedRequest
        );
      });
    }
  }

  private async requireProjectFinancingQuotaRequester(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string
  ): Promise<"finance_director" | "finance_staff"> {
    const project = await lockActiveProjectForFinancingQuotaMutation(tx, projectId);
    if (!project) {
      throw new NotFoundException("项目不存在或已停用");
    }
    const activeUser = await tx.user.findFirst({
      where: { id: actorUserId, isActive: true },
      select: { id: true }
    });
    if (!activeUser) {
      throw new ForbiddenException("当前账号已停用或不存在");
    }
    const actorRoleKeys = await this.loadActorRoleKeys(
      tx,
      actorUserId,
      projectId
    );
    if (!canPerform("project.financing_quota.request", actorRoleKeys)) {
      throw new ForbiddenException(
        "只有财务人员或财务主管可以申请项目垫资额度"
      );
    }
    return actorRoleKeys.includes("finance_director")
      ? "finance_director"
      : "finance_staff";
  }

  private async toProjectFinancingQuotaRequestReplay(
    tx: Prisma.TransactionClient,
    quota: ProjectFinancingQuota,
    request: {
      projectId: string;
      actorUserId: string;
      amountCents: bigint;
      reason: string;
      validUntil: Date | null;
      attachmentFileId: string;
      idempotencyKey: string;
    }
  ) {
    if (
      quota.projectId !== request.projectId ||
      quota.requestedByUserId !== request.actorUserId ||
      quota.requestIdempotencyKey !== request.idempotencyKey ||
      quota.amountCents !== request.amountCents ||
      quota.reason !== request.reason ||
      quota.validUntil?.toISOString() !== request.validUntil?.toISOString() ||
      quota.attachmentFileId !== request.attachmentFileId ||
      (quota.requestedByRoleKey !== "finance_staff" &&
        quota.requestedByRoleKey !== "finance_director") ||
      !isLowercaseSha256(quota.attachmentFileSha256Snapshot)
    ) {
      throw new ConflictException("项目垫资额度申请幂等键与已有事实不一致");
    }
    const expectedFingerprint = projectFinancingQuotaRequestFingerprint({
      projectId: request.projectId,
      actorUserId: request.actorUserId,
      requestedByRoleKey: quota.requestedByRoleKey,
      amountCents: moneyCentsToApi(request.amountCents),
      reason: request.reason,
      validUntil: request.validUntil?.toISOString() ?? null,
      attachmentFileId: request.attachmentFileId,
      attachmentFileSha256Snapshot: quota.attachmentFileSha256Snapshot
    });
    if (quota.requestFingerprint !== expectedFingerprint) {
      throw new ConflictException("项目垫资额度申请幂等键与已有事实不一致");
    }
    const approvalInstances = await tx.approvalInstance.findMany({
      where: {
        businessType: "project_financing_quota",
        flowType: "project_financing_quota.approve",
        businessId: quota.id
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    });
    const approvalByQuotaId = indexProjectFinancingQuotaApprovalInstances(
      approvalInstances
    );
    assertProjectFinancingQuotaApprovalLifecycle(
      quota,
      approvalByQuotaId.get(quota.id)
    );
    return projectFinancingQuotaRequestReceipt(quota, "replayed");
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
    const actionId = normalizeUuidV4(
      input.actionId,
      "项目垫资额度审批 actionId 必须是 UUIDv4"
    );
    const expectedLifecycleToken = normalizeLowercaseSha256(
      input.expectedLifecycleToken,
      "项目垫资额度审批生命周期令牌无效"
    );
    if (
      typeof input.confirmationPassword !== "string" ||
      !input.confirmationPassword.trim()
    ) {
      throw new BadRequestException(
        "项目垫资额度审批需要当前登录密码确认"
      );
    }
    const confirmationPassword = input.confirmationPassword;
    const comment = input.comment?.trim() || null;
    const submittedSelfReviewReason = input.selfReviewReason?.trim() || null;
    if (comment && Array.from(comment).length > 500) {
      throw new BadRequestException("审批意见不能超过 500 个字符");
    }
    if (
      submittedSelfReviewReason &&
      Array.from(submittedSelfReviewReason).length > 500
    ) {
      throw new BadRequestException("自审原因不能超过 500 个字符");
    }
    const requestFingerprint = projectFinancingQuotaReviewRequestFingerprint({
      actionId,
      projectId,
      quotaId,
      actorUserId,
      expectedLifecycleToken,
      decision: input.decision,
      comment,
      selfReviewReason: submittedSelfReviewReason
    });
    if (!this.auth) {
      throw new Error("Auth service is required to review project financing quota");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await lockActiveProjectForFinancingQuotaMutation(
          tx,
          projectId
        );
        if (!project) {
          throw new NotFoundException("项目不存在或已停用");
        }
        const quota = await lockProjectFinancingQuotaForReview(
          tx,
          projectId,
          quotaId
        );
        if (!quota) {
          throw new NotFoundException("项目垫资额度不存在");
        }
        const approvalInstances =
          await lockProjectFinancingQuotaApprovalInstances(tx, quota.id);
        if (approvalInstances.length !== 1) {
          throw new ConflictException(
            approvalInstances.length
              ? "项目垫资额度存在重复的生命周期审批实例"
              : "项目垫资额度缺少生命周期审批实例"
          );
        }
        const instance = approvalInstances[0]!;

        await this.auth!.confirmPassword(
          actorUserId,
          confirmationPassword,
          tx
        );
        const actorRoleKeys = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          quota.projectId
        );
        if (!canPerform("project.financing_quota.approve", actorRoleKeys)) {
          throw new ForbiddenException("当前账号无项目垫资额度审批权限");
        }

        const existingAction = await tx.approvalActionLog.findUnique({
          where: { id: actionId }
        });
        if (existingAction) {
          assertProjectFinancingQuotaReviewReplay(existingAction, {
            actionId,
            projectId,
            quotaId,
            actorUserId,
            approvalInstanceId: instance.id,
            decision: input.decision,
            expectedLifecycleToken,
            requestFingerprint
          });
          return projectFinancingQuotaReviewReceipt({
            kind: "replayed",
            actionId,
            projectId,
            quotaId
          });
        }

        if (quota.status !== "approval_pending") {
          throw new ConflictException(
            "当前项目垫资额度状态已变化，请刷新后重试"
          );
        }
        const nodes = assertProjectFinancingQuotaApprovalSnapshot(
          instance,
          quota.requestedByUserId,
          quota.status
        );
        const currentNode = nodes[instance.currentNodeIndex];
        if (!currentNode) {
          throw new ConflictException("项目垫资额度当前审批节点不存在");
        }
        const approvedRoleKey = currentNode.roleKeys.find((roleKey) =>
          actorRoleKeys.includes(roleKey)
        );
        if (!approvedRoleKey) {
          throw new ForbiddenException("当前账号不能审批项目垫资额度");
        }

        const selfReview = instance.applicantUserId === actorUserId;
        const selfReviewAllowed =
          selfReview &&
          quota.requestedByRoleKey === "finance_director" &&
          instance.currentNodeIndex === 0 &&
          approvedRoleKey === "finance_director";
        if (selfReview && !selfReviewAllowed) {
          throw new ForbiddenException(
            "只有以财务主管岗位发起的申请，才可由申请人独立审批财务主管节点"
          );
        }
        const selfReviewReason = selfReviewAllowed
          ? requiredTrimmed(
              input.selfReviewReason,
              "财务主管审批本人发起的项目垫资额度时，请填写独立自审原因"
            )
          : null;
        if (
          financingQuotaLifecycleToken(quota, instance) !==
          expectedLifecycleToken
        ) {
          throw new ConflictException(
            "项目垫资额度审批事实已变化，请刷新后重试"
          );
        }

        const signature = await snapshotApprovalSignature(tx, actorUserId, {
          required: true
        });
        const nextNodes = [...nodes];
        const nextNodeIndex = instance.currentNodeIndex + 1;
        const flowCompleted =
          input.decision === "approve" && nextNodeIndex >= nextNodes.length;
        const approvedAt = flowCompleted ? new Date() : null;
        if (input.decision === "approve") {
          nextNodes[instance.currentNodeIndex] = {
            ...currentNode,
            approvedRoleKeys: [
              ...new Set([
                ...(currentNode.approvedRoleKeys ?? []),
                approvedRoleKey
              ])
            ]
          };
        }

        const quotaUpdate = await tx.projectFinancingQuota.updateMany({
          where: {
            id: quota.id,
            projectId: quota.projectId,
            status: "approval_pending",
            updatedAt: quota.updatedAt
          },
          data: input.decision === "reject"
            ? { status: "rejected" }
            : flowCompleted
              ? {
                  status: "approved",
                  approvedByUserId: actorUserId,
                  approvedAt: approvedAt!
                }
              : { status: "approval_pending" }
        });
        if (quotaUpdate.count !== 1) {
          throw new ConflictException(
            "项目垫资额度审批事实已变化，请刷新后重试"
          );
        }

        const approvalUpdate = await tx.approvalInstance.updateMany({
          where: {
            id: instance.id,
            status: "in_progress",
            currentNodeIndex: instance.currentNodeIndex,
            updatedAt: instance.updatedAt
          },
          data: input.decision === "reject"
            ? { status: "rejected" }
            : {
                currentNodeIndex: nextNodeIndex,
                frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
                status: flowCompleted ? "approved" : "in_progress"
              }
        });
        if (approvalUpdate.count !== 1) {
          throw new ConflictException(
            "项目垫资额度审批节点已变化，请刷新后重试"
          );
        }

        const actionMetadata = {
          actionId,
          projectId,
          quotaId,
          decision: input.decision,
          expectedLifecycleToken,
          requestFingerprint,
          ...(selfReviewAllowed
            ? { selfReview: true, selfReviewReason }
            : {})
        };
        await tx.approvalActionLog.create({
          data: {
            id: actionId,
            approvalInstanceId: instance.id,
            action: input.decision,
            actorUserId,
            comment: comment ?? undefined,
            approvedRoleKey,
            signatureFileIdSnapshot: signature.fileId,
            signatureSha256Snapshot: signature.sha256,
            signatureVersionIdSnapshot: signature.versionId,
            metadata: actionMetadata
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: `project.financing_quota.${input.decision}`,
          businessType: "project_financing_quota",
          businessId: quota.id,
          metadata: {
            ...actionMetadata,
            nodeName: currentNode.name,
            flowCompleted,
            approvedRoleKey
          }
        });

        return projectFinancingQuotaReviewReceipt({
          kind: "applied",
          actionId,
          projectId,
          quotaId
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isProjectFinancingQuotaReviewConcurrencyConflict(error)) {
        throw new ConflictException(
          "项目垫资额度审批发生并发冲突，请刷新后重试"
        );
      }
      if (isProjectFinancingQuotaReviewActionIdConflict(error)) {
        throw new ConflictException(
          "项目垫资额度审批 actionId 已被其他请求使用"
        );
      }
      throw error;
    }
  }

  async terminateProjectFinancingQuota(
    projectId: string,
    quotaId: string,
    actorUserId: string,
    input: TerminateProjectFinancingQuotaDto
  ) {
    const actionId = normalizeUuidV4(
      input.actionId,
      "项目垫资额度终止 actionId 必须是 UUIDv4"
    );
    const expectedLifecycleToken = normalizeLowercaseSha256(
      input.expectedLifecycleToken,
      "项目垫资额度终止生命周期令牌无效"
    );
    const reason = requiredTrimmed(
      input.reason,
      "请填写项目垫资额度终止原因"
    );
    if (Array.from(reason).length > 500) {
      throw new BadRequestException(
        "项目垫资额度终止原因不能超过 500 个字符"
      );
    }
    const confirmationPassword = input.confirmationPassword;
    if (
      typeof confirmationPassword !== "string" ||
      confirmationPassword.trim().length === 0
    ) {
      throw new BadRequestException(
        "项目垫资额度终止需要当前登录密码确认"
      );
    }
    if (Array.from(confirmationPassword).length > 256) {
      throw new BadRequestException("当前登录密码格式不正确");
    }
    if (!this.auth) {
      throw new Error("项目垫资额度终止缺少身份确认服务");
    }
    const requestFingerprint = projectFinancingQuotaTerminationRequestFingerprint({
      actionId,
      projectId,
      quotaId,
      actorUserId,
      expectedLifecycleToken,
      reason
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await lockActiveProjectForFinancingQuotaMutation(
          tx,
          projectId
        );
        if (!project) {
          throw new NotFoundException("项目不存在或已停用");
        }
        const quota = await lockProjectFinancingQuotaForReview(
          tx,
          projectId,
          quotaId
        );
        if (!quota) {
          throw new NotFoundException("项目垫资额度不存在");
        }
        const approvalInstances =
          await lockProjectFinancingQuotaApprovalInstances(tx, quotaId);
        const approvalByQuotaId = indexProjectFinancingQuotaApprovalInstances(
          approvalInstances
        );
        const { instance: approval } =
          assertProjectFinancingQuotaApprovalLifecycle(
            quota,
            approvalByQuotaId.get(quota.id)
          );

        const actorRoleKeys = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          projectId
        );
        if (!actorRoleKeys.includes("finance_director")) {
          throw new ForbiddenException(
            "只有财务主管可以终止项目垫资额度"
          );
        }
        await this.auth!.confirmPassword(
          actorUserId,
          confirmationPassword,
          tx
        );

        if (quota.terminationActionId) {
          assertProjectFinancingQuotaTerminationReplay(quota, {
            actionId,
            projectId,
            quotaId,
            actorUserId,
            requestFingerprint,
            reason
          });
          return projectFinancingQuotaTerminationReceipt({
            kind: "replayed",
            actionId,
            projectId,
            quotaId
          });
        }
        if (quota.status === "terminated") {
          throw new ConflictException(
            "历史项目垫资额度终止事实缺少耐久 actionId，不能自动重放"
          );
        }
        if (quota.status !== "approved") {
          throw new ConflictException(
            "只有已批准的项目垫资额度可以终止"
          );
        }
        if (approval.status !== "approved") {
          throw new ConflictException(
            "项目垫资额度审批生命周期不完整"
          );
        }
        const { allocationSummary } =
          await this.funding.assertPersistedProjectFundingLedgerCoverage(
            tx,
            projectId
          );
        const amountCents = dbMoneyToBigInt(
          quota.amountCents,
          "项目垫资额度"
        );
        const netUsedAmountCents =
          allocationSummary.netUsedBySource.get(
            `financing_quota:${quota.id}`
          ) ?? 0n;
        if (
          netUsedAmountCents < 0n ||
          netUsedAmountCents > amountCents
        ) {
          throw new ConflictException(
            "项目垫资额度占用事实不完整，请先核对资金账本"
          );
        }
        if (
          financingQuotaLifecycleToken(
            quota,
            approval,
            netUsedAmountCents
          ) !== expectedLifecycleToken
        ) {
          throw new ConflictException(
            "项目垫资额度终止事实已变化，请刷新后重试"
          );
        }
        const signature = await snapshotApprovalSignature(tx, actorUserId, {
          required: true
        });
        if (!isLowercaseSha256(signature.sha256)) {
          throw new ConflictException(
            "项目垫资额度终止签名 SHA-256 无效"
          );
        }
        const remainingAmountCents = amountCents - netUsedAmountCents;
        const terminatedAt = new Date();
        const updated = await tx.projectFinancingQuota.updateMany({
          where: {
            id: quota.id,
            projectId,
            status: "approved",
            updatedAt: quota.updatedAt,
            terminatedAt: null,
            terminatedByUserId: null,
            terminationReason: null,
            terminationSignatureFileId: null,
            terminationSignatureSha256: null,
            terminationSignatureVersionId: null,
            terminationActionId: null,
            terminationRequestFingerprint: null
          },
          data: {
            status: "terminated",
            terminatedAt,
            terminatedByUserId: actorUserId,
            terminationReason: reason,
            terminationSignatureFileId: signature.fileId,
            terminationSignatureSha256: signature.sha256,
            terminationSignatureVersionId: signature.versionId,
            terminationActionId: actionId,
            terminationRequestFingerprint: requestFingerprint
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            "项目垫资额度终止事实已变化，请刷新后重试"
          );
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "project.financing_quota.terminate",
          businessType: "project_financing_quota",
          businessId: quota.id,
          metadata: {
            actionId,
            projectId,
            quotaId,
            approvalInstanceId: approval.id,
            expectedLifecycleToken,
            requestFingerprint,
            fromStatus: quota.status,
            toStatus: "terminated",
            reason,
            terminatedAt: terminatedAt.toISOString(),
            netUsedAmountCents: moneyCentsToApi(netUsedAmountCents),
            remainingAmountCents: moneyCentsToApi(remainingAmountCents),
            terminationSignatureFileId: signature.fileId,
            terminationSignatureSha256: signature.sha256,
            terminationSignatureVersionId: signature.versionId
          }
        });
        return projectFinancingQuotaTerminationReceipt({
          kind: "applied",
          actionId,
          projectId,
          quotaId
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isProjectFinancingQuotaReviewConcurrencyConflict(error)) {
        throw new ConflictException(
          "项目垫资额度终止发生并发冲突，请刷新后重试"
        );
      }
      if (isProjectFinancingQuotaTerminationActionIdConflict(error)) {
        throw new ConflictException(
          "项目垫资额度终止 actionId 已被其他额度使用"
        );
      }
      throw error;
    }
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

interface FinancingQuotaLedgerRow {
  id: string;
  projectId: string;
  executionType: string;
  executionId: string;
  businessType: string;
  businessId: string;
  sourceType: string;
  sourceKey: string;
  sourceId: string | null;
  direction: string;
  amountCents: bigint;
  occurredAt: Date;
  createdByUserId: string;
  reversalOfAllocationId: string | null;
  reversalKey: string;
  reason: string | null;
  createdAt: Date;
}

export interface FinancingQuotaUsageGroupProjection {
  executionType: string;
  executionId: string;
  businessType: string;
  businessId: string;
  occurredAt: string;
  projectCashNetAmountCents: string;
  financingQuotaNetAmountCents: string;
  currentQuotaDebitAmountCents: string;
  currentQuotaCreditAmountCents: string;
  currentQuotaNetAmountCents: string;
}

function financingQuotaReadAction(input: {
  key: string;
  label: string;
  kind: "primary" | "danger";
  requiredAction: string;
  enabled: boolean;
  disabledReason: string | null;
  requiresPassword?: boolean;
  requiresSelfReviewConfirmation?: boolean;
  requiresFile?: boolean;
}) {
  return {
    key: input.key,
    label: input.label,
    kind: input.kind,
    enabled: input.enabled,
    disabledReason: input.enabled ? null : input.disabledReason,
    requiredAction: input.requiredAction,
    ...(input.requiresPassword ? { requiresPassword: true } : {}),
    ...(input.requiresFile ? { requiresFile: true } : {}),
    ...(input.requiresSelfReviewConfirmation
      ? { requiresSelfReviewConfirmation: true }
      : {})
  };
}

function financingQuotaReviewDisabledReason(input: {
  quotaStatus: string;
  currentApproval: FinancingQuotaApprovalInstanceSnapshot | null;
  currentNode: SettlementExceptionQuotaApprovalNode | null;
  actorApprovalRole: RoleKey | null;
  actorRoleKeys: RoleKey[];
  selfReview: boolean;
  selfReviewAllowed: boolean;
}) {
  if (input.quotaStatus !== "approval_pending") {
    return "当前项目垫资额度状态不可审批";
  }
  if (!input.currentApproval || input.currentApproval.status !== "in_progress") {
    return "项目垫资额度审批实例不存在或已结束";
  }
  if (!input.currentNode) {
    return "项目垫资额度当前审批节点无效";
  }
  if (!canPerform("project.financing_quota.approve", input.actorRoleKeys)) {
    return "当前账号无项目垫资额度审批权限";
  }
  if (!input.actorApprovalRole) {
    return "当前账号不是项目垫资额度当前审批节点处理人";
  }
  if (input.selfReview && !input.selfReviewAllowed) {
    return "项目垫资额度申请人只能独立审批财务主管节点";
  }
  return null;
}

function projectFinancingQuotaStatusLabel(status: string, isExpired: boolean) {
  if (status === "approved" && isExpired) return "已过期";
  return ({
    approval_pending: "审批中",
    approved: "已批准",
    rejected: "已驳回",
    terminated: "已终止"
  } as Record<string, string>)[status] ?? "状态异常";
}

function financingQuotaLifecycleToken(
  quota: {
    id: string;
    projectId: string;
    status: string;
    amountCents: bigint;
    reason: string;
    validUntil: Date | null;
    attachmentFileId: string;
    attachmentFileSha256Snapshot: string | null;
    requestedByUserId: string;
    requestedByRoleKey: string | null;
    updatedAt: Date;
  },
  approval: FinancingQuotaApprovalInstanceSnapshot | null,
  netUsedAmountCents?: bigint
) {
  const requiresFundingState =
    quota.status === "approved" || quota.status === "terminated";
  if (requiresFundingState && netUsedAmountCents === undefined) {
    throw new ConflictException(
      "项目垫资额度生命周期令牌缺少占用事实"
    );
  }
  const terminalFundingState = requiresFundingState
    ? { netUsedAmountCents: netUsedAmountCents!.toString() }
    : {};
  return createHash("sha256").update(JSON.stringify({
    quota: {
      id: quota.id,
      projectId: quota.projectId,
      status: quota.status,
      amountCents: quota.amountCents.toString(),
      reason: quota.reason,
      validUntil: quota.validUntil?.toISOString() ?? null,
      attachmentFileId: quota.attachmentFileId,
      attachmentFileSha256Snapshot: quota.attachmentFileSha256Snapshot,
      requestedByUserId: quota.requestedByUserId,
      requestedByRoleKey: quota.requestedByRoleKey,
      updatedAt: quota.updatedAt.toISOString(),
      ...terminalFundingState
    },
    approval: approval
      ? {
          id: approval.id,
          businessId: approval.businessId,
          applicantUserId: approval.applicantUserId,
          status: approval.status,
          currentNodeIndex: approval.currentNodeIndex,
          frozenNodes: approval.frozenNodes,
          updatedAt: approval.updatedAt.toISOString()
        }
      : null
  })).digest("hex");
}

function indexProjectFinancingQuotaUsageGroups(
  allocations: FinancingQuotaLedgerRow[]
) {
  const rowsByExecution = new Map<string, FinancingQuotaLedgerRow[]>();
  for (const allocation of allocations) {
    const key = `${allocation.executionType}\u0000${allocation.executionId}`;
    const rows = rowsByExecution.get(key) ?? [];
    rows.push(allocation);
    rowsByExecution.set(key, rows);
  }
  const result = new Map<string, FinancingQuotaUsageGroupProjection[]>();
  for (const rows of rowsByExecution.values()) {
    const first = rows[0];
    if (!first) continue;
    if (rows.some((row) =>
      row.projectId !== first.projectId ||
      row.businessType !== first.businessType ||
      row.businessId !== first.businessId
    )) {
      throw new ConflictException("同一实付编号绑定了不一致的项目资金业务对象");
    }
    let projectCashNet = 0n;
    let financingQuotaNet = 0n;
    let occurredAt = first.occurredAt;
    const quotaAmounts = new Map<string, { debit: bigint; credit: bigint }>();
    for (const allocation of rows) {
      const amountCents = dbMoneyToBigInt(
        allocation.amountCents,
        "项目资金分配金额"
      );
      const signedAmount = allocation.direction === "credit"
        ? -amountCents
        : amountCents;
      if (allocation.sourceType === "project_cash") {
        projectCashNet += signedAmount;
      } else if (allocation.sourceType === "financing_quota") {
        financingQuotaNet += signedAmount;
        if (allocation.sourceId) {
          const current = quotaAmounts.get(allocation.sourceId) ?? {
            debit: 0n,
            credit: 0n
          };
          current[allocation.direction === "credit" ? "credit" : "debit"] +=
            amountCents;
          quotaAmounts.set(allocation.sourceId, current);
        }
      }
      if (allocation.occurredAt > occurredAt) occurredAt = allocation.occurredAt;
    }
    for (const [quotaId, currentQuota] of quotaAmounts) {
      const groups = result.get(quotaId) ?? [];
      groups.push({
        executionType: first.executionType,
        executionId: first.executionId,
        businessType: first.businessType,
        businessId: first.businessId,
        occurredAt: occurredAt.toISOString(),
        projectCashNetAmountCents: moneyCentsToApi(projectCashNet),
        financingQuotaNetAmountCents: moneyCentsToApi(financingQuotaNet),
        currentQuotaDebitAmountCents: moneyCentsToApi(currentQuota.debit),
        currentQuotaCreditAmountCents: moneyCentsToApi(currentQuota.credit),
        currentQuotaNetAmountCents: moneyCentsToApi(
          currentQuota.debit - currentQuota.credit
        )
      });
      result.set(quotaId, groups);
    }
  }
  return result;
}

function normalizePositiveMoneyCents(value: unknown, message: string): bigint {
  const cents = parseMoneyCentsInput(value as string, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

async function lockActiveProjectForFinancingQuotaMutation(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Project"
    WHERE "id" = ${projectId}
      AND "isActive" = TRUE
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockProjectFinancingQuotaForReview(
  tx: Prisma.TransactionClient,
  projectId: string,
  quotaId: string
): Promise<ProjectFinancingQuota | null> {
  const rows = await tx.$queryRaw<ProjectFinancingQuota[]>(Prisma.sql`
    SELECT *
    FROM "ProjectFinancingQuota"
    WHERE "id" = ${quotaId}
      AND "projectId" = ${projectId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockProjectFinancingQuotaApprovalInstances(
  tx: Prisma.TransactionClient,
  quotaId: string
): Promise<FinancingQuotaApprovalInstanceSnapshot[]> {
  return tx.$queryRaw<FinancingQuotaApprovalInstanceSnapshot[]>(Prisma.sql`
    SELECT
      "id",
      "businessId",
      "applicantUserId",
      "status",
      "currentNodeIndex",
      "frozenNodes",
      "createdAt",
      "updatedAt"
    FROM "ApprovalInstance"
    WHERE "businessType" = 'project_financing_quota'
      AND "flowType" = 'project_financing_quota.approve'
      AND "businessId" = ${quotaId}
    ORDER BY "createdAt" DESC, "id" ASC
    FOR UPDATE
  `);
}

async function lockProjectFinancingQuotaAttachment(
  tx: Prisma.TransactionClient,
  attachmentFileId: string
): Promise<{
  id: string;
  uploadedByUserId: string;
  storageStatus: string;
  contentSha256: string | null;
} | null> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    uploadedByUserId: string;
    storageStatus: string;
    contentSha256: string | null;
  }>>(Prisma.sql`
    SELECT "id", "uploadedByUserId", "storageStatus", "contentSha256"
    FROM "FileObject"
    WHERE "id" = ${attachmentFileId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function normalizeUuidV4(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      normalized
    )
  ) {
    throw new BadRequestException(message);
  }
  return normalized;
}

function isLowercaseSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function projectFinancingQuotaRequestFingerprint(value: {
  projectId: string;
  actorUserId: string;
  requestedByRoleKey: "finance_staff" | "finance_director";
  amountCents: string;
  reason: string;
  validUntil: string | null;
  attachmentFileId: string;
  attachmentFileSha256Snapshot: string;
}) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function projectFinancingQuotaRequestReceipt(
  quota: Pick<ProjectFinancingQuota, "id" | "projectId" | "requestIdempotencyKey">,
  kind: "created" | "replayed"
) {
  if (!quota.requestIdempotencyKey) {
    throw new ConflictException("项目垫资额度申请回执缺少幂等键");
  }
  return {
    kind,
    idempotencyKey: quota.requestIdempotencyKey,
    projectId: quota.projectId,
    quotaId: quota.id
  };
}

function projectFinancingQuotaReviewRequestFingerprint(value: {
  actionId: string;
  projectId: string;
  quotaId: string;
  actorUserId: string;
  expectedLifecycleToken: string;
  decision: "approve" | "reject";
  comment: string | null;
  selfReviewReason: string | null;
}) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function projectFinancingQuotaReviewReceipt(input: {
  kind: "applied" | "replayed";
  actionId: string;
  projectId: string;
  quotaId: string;
}) {
  return input;
}

function projectFinancingQuotaTerminationRequestFingerprint(value: {
  actionId: string;
  projectId: string;
  quotaId: string;
  actorUserId: string;
  expectedLifecycleToken: string;
  reason: string;
}) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function projectFinancingQuotaTerminationReceipt(input: {
  kind: "applied" | "replayed";
  actionId: string;
  projectId: string;
  quotaId: string;
}) {
  return input;
}

function assertProjectFinancingQuotaTerminationReplay(
  quota: ProjectFinancingQuota,
  expected: {
    actionId: string;
    projectId: string;
    quotaId: string;
    actorUserId: string;
    requestFingerprint: string;
    reason: string;
  }
) {
  if (
    quota.id !== expected.quotaId ||
    quota.projectId !== expected.projectId ||
    quota.status !== "terminated" ||
    quota.terminationActionId !== expected.actionId ||
    quota.terminationRequestFingerprint !== expected.requestFingerprint ||
    quota.terminatedByUserId !== expected.actorUserId ||
    quota.terminationReason !== expected.reason ||
    !(quota.terminatedAt instanceof Date) ||
    Number.isNaN(quota.terminatedAt.getTime()) ||
    !quota.terminationSignatureFileId ||
    !quota.terminationSignatureVersionId ||
    !isLowercaseSha256(quota.terminationSignatureSha256)
  ) {
    throw new ConflictException(
      "项目垫资额度终止 actionId 与已有终止事实不一致"
    );
  }
}

function assertProjectFinancingQuotaReviewReplay(
  action: ApprovalActionLog,
  expected: {
    actionId: string;
    projectId: string;
    quotaId: string;
    actorUserId: string;
    approvalInstanceId: string;
    decision: "approve" | "reject";
    expectedLifecycleToken: string;
    requestFingerprint: string;
  }
) {
  const metadata = isPlainRecord(action.metadata) ? action.metadata : null;
  if (
    action.id !== expected.actionId ||
    action.approvalInstanceId !== expected.approvalInstanceId ||
    action.actorUserId !== expected.actorUserId ||
    action.action !== expected.decision ||
    !action.signatureFileIdSnapshot ||
    !action.signatureVersionIdSnapshot ||
    !isLowercaseSha256(action.signatureSha256Snapshot) ||
    !metadata ||
    metadata.actionId !== expected.actionId ||
    metadata.projectId !== expected.projectId ||
    metadata.quotaId !== expected.quotaId ||
    metadata.decision !== expected.decision ||
    metadata.expectedLifecycleToken !== expected.expectedLifecycleToken ||
    metadata.requestFingerprint !== expected.requestFingerprint
  ) {
    throw new ConflictException(
      "项目垫资额度审批 actionId 与已有审批事实不一致"
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLowercaseSha256(value: unknown, message: string): string {
  if (!isLowercaseSha256(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

function parseUpstreamFundDate(value: unknown): Date {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("请填写上游资金发生日期");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("上游资金发生日期不正确，请重新选择");
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
  const parsed = parseDateInput(value, invalidMessage);
  if (parsed.getTime() <= Date.now()) {
    throw new BadRequestException(pastMessage);
  }
  return parsed;
}

function parseDateInput(value: unknown, invalidMessage: string): Date {
  if (typeof value !== "string") {
    throw new BadRequestException(invalidMessage);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(invalidMessage);
  }
  return parsed;
}

function parseProjectFinancingQuotaValidUntil(
  value: unknown,
  invalidMessage: string
): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const selectedDate = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(selectedDate.getTime()) ||
      selectedDate.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(invalidMessage);
    }
    return new Date(
      selectedDate.getTime() + 16 * 60 * 60 * 1000 - 1
    );
  }
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    throw new BadRequestException(invalidMessage);
  }
  return parseDateInput(value, invalidMessage);
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

function isUniqueConstraintError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isProjectFinancingQuotaRequestIdempotencyConflict(
  error: unknown
): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "requestIdempotencyKey";
  }
  return target === "requestIdempotencyKey" ||
    target === "ProjectFinancingQuota_requestIdempotencyKey_key";
}

function isProjectFinancingQuotaReviewConcurrencyConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  if (!isPlainRecord(error) || typeof error.code !== "string") return false;
  if (
    error.code === "P2034" ||
    error.code === "40001" ||
    error.code === "40P01"
  ) {
    return true;
  }
  if (error.code !== "P2010" || !isPlainRecord(error.meta)) return false;
  return error.meta.code === "40001" || error.meta.code === "40P01";
}

function isProjectFinancingQuotaReviewActionIdConflict(error: unknown) {
  if (!isUniqueConstraintError(error)) return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "id";
  }
  return target === "id" || target === "ApprovalActionLog_pkey";
}

function isProjectFinancingQuotaTerminationActionIdConflict(error: unknown) {
  if (!isUniqueConstraintError(error)) return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "terminationActionId";
  }
  return target === "terminationActionId" ||
    target === "ProjectFinancingQuota_terminationActionId_key";
}

function normalizeUpstreamFundFactType(value: unknown): ProjectUpstreamFundFactType {
  if (
    typeof value !== "string" ||
    !(PROJECT_UPSTREAM_FUND_FACT_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("上游资金事实类型不正确");
  }
  return value as ProjectUpstreamFundFactType;
}

function normalizeUpstreamFundBasisType(value: unknown): ProjectUpstreamFundBasisType {
  if (
    typeof value !== "string" ||
    !(PROJECT_UPSTREAM_FUND_BASIS_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("上游资金依据类型不正确");
  }
  return value as ProjectUpstreamFundBasisType;
}

function normalizeUpstreamFundEntryKind(value: unknown): ProjectUpstreamFundEntryKind {
  if (
    typeof value !== "string" ||
    !(PROJECT_UPSTREAM_FUND_ENTRY_KINDS as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("上游资金追加类型不正确");
  }
  return value as ProjectUpstreamFundEntryKind;
}

function normalizeDeductionCategory(
  factType: ProjectUpstreamFundFactType,
  value: unknown
): ProjectAffiliateDeductionCategory | null {
  if (factType !== "affiliate_deduction") {
    if (value !== undefined && value !== null && value !== "") {
      throw new BadRequestException("非挂靠扣款事实不能填写扣款类型");
    }
    return null;
  }
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_DEDUCTION_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("请选择挂靠扣款类型");
  }
  return value as ProjectAffiliateDeductionCategory;
}

function normalizeUpstreamFundEffectDirection(
  entryKind: ProjectUpstreamFundEntryKind,
  value: unknown
): "increase" | "decrease" {
  if (entryKind === "original" || entryKind === "reclassification") {
    if (value !== undefined && value !== "increase") {
      throw new BadRequestException("原始或重分类事实只能追加正向金额");
    }
    return "increase";
  }
  if (value !== "increase" && value !== "decrease") {
    throw new BadRequestException("更正或反向必须明确增加或减少方向");
  }
  if (entryKind === "reversal" && value !== "decrease") {
    throw new BadRequestException("反向记录只能减少原事实金额");
  }
  return value;
}

function assertUpstreamFundAdjustment(
  target: {
    factType: string;
    entryKind: string;
    status: string;
    amountCents: bigint;
  },
  existingAdjustments: Array<{
    entryKind: string;
    effectDirection: string;
    amountCents: bigint;
  }>,
  requested: {
    factType: ProjectUpstreamFundFactType;
    entryKind: ProjectUpstreamFundEntryKind;
    effectDirection: "increase" | "decrease";
    amountCents: bigint;
  }
) {
  if (target.entryKind !== "original") {
    throw new BadRequestException("更正、反向或重分类必须直接引用原始资金事实");
  }
  if (
    target.status !== "confirmed" &&
    !(
      target.factType === "unreconciled_receipt_difference" &&
      target.status === "pending_reconciliation"
    )
  ) {
    throw new BadRequestException("只能对已确认资金事实或待核对到账差额追加处理");
  }
  if (requested.entryKind === "reclassification") {
    if (
      target.factType !== "unreconciled_receipt_difference" ||
      requested.factType !== "affiliate_deduction" ||
      requested.effectDirection !== "increase"
    ) {
      throw new BadRequestException("只有待核对到账差额可以重分类为挂靠扣款");
    }
    const alreadyClassified = existingAdjustments
      .filter((adjustment) => adjustment.entryKind === "reclassification")
      .reduce(
        (total, adjustment) =>
          total + dbMoneyToBigInt(adjustment.amountCents, "已登记重分类金额"),
        0n
      );
    if (
      alreadyClassified + requested.amountCents >
      dbMoneyToBigInt(target.amountCents, "待核对到账差额")
    ) {
      throw new BadRequestException("重分类金额不能超过原待核对到账差额");
    }
    return;
  }
  if (target.factType !== requested.factType) {
    throw new BadRequestException("更正或反向记录必须与原资金事实类型一致");
  }
  if (
    requested.entryKind === "reversal" &&
    requested.amountCents !== dbMoneyToBigInt(target.amountCents, "原资金事实金额")
  ) {
    throw new BadRequestException("反向记录必须精确冲销被引用资金事实的金额");
  }
  if (
    existingAdjustments.some((adjustment) => adjustment.entryKind === "reversal")
  ) {
    throw new BadRequestException("原资金事实已经反向，不能继续追加更正");
  }
  if (requested.entryKind === "reversal" && existingAdjustments.length > 0) {
    throw new BadRequestException("已有更正的资金事实不能直接反向，请追加差额更正");
  }
  if (requested.effectDirection === "decrease") {
    const remainingAmount = existingAdjustments.reduce(
      (total, adjustment) =>
        total +
        (adjustment.effectDirection === "decrease"
          ? -dbMoneyToBigInt(adjustment.amountCents, "已有减少更正金额")
          : dbMoneyToBigInt(adjustment.amountCents, "已有增加更正金额")),
      dbMoneyToBigInt(target.amountCents, "原资金事实金额")
    );
    if (requested.amountCents > remainingAmount) {
      throw new BadRequestException("累计减少金额不能超过原资金事实的当前净额");
    }
  }
}

function upstreamFundRequestFingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function upstreamFundFactNetAmount(
  facts: Array<{
    factType: string;
    status: string;
    effectDirection: string;
    amountCents: bigint;
  }>,
  factType: ProjectUpstreamFundFactType
) {
  return facts
    .filter((fact) => fact.factType === factType && fact.status === "confirmed")
    .reduce(
      (total, fact) =>
        total +
        (fact.effectDirection === "decrease"
          ? -dbMoneyToBigInt(fact.amountCents, "上游资金事实金额")
          : dbMoneyToBigInt(fact.amountCents, "上游资金事实金额")),
      0n
    );
}

function upstreamFundUnreconciledDifference(
  facts: Array<{
    factType: string;
    entryKind: string;
    status: string;
    effectDirection: string;
    amountCents: bigint;
  }>
) {
  const pending = facts
    .filter(
      (fact) =>
        fact.factType === "unreconciled_receipt_difference" &&
        fact.status === "pending_reconciliation"
    )
    .reduce(
      (total, fact) => total + dbMoneyToBigInt(fact.amountCents, "待核对到账差额"),
      0n
    );
  const reclassified = facts
    .filter(
      (fact) =>
        fact.factType === "affiliate_deduction" &&
        fact.entryKind === "reclassification" &&
        fact.status === "confirmed"
    )
    .reduce(
      (total, fact) => total + dbMoneyToBigInt(fact.amountCents, "已重分类到账差额"),
      0n
    );
  return pending > reclassified ? pending - reclassified : 0n;
}

function toUpstreamFundFactReadModel(fact: {
  id: string;
  projectId: string;
  factType: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  occurredAt: Date;
  amountCents: bigint;
  counterpartyName: string;
  basisType: string;
  deductionCategory: string | null;
  upstreamSettlementId: string | null;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  idempotencyKey: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  status: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  confirmationActionId: string | null;
  confirmationSignatureVersionId: string | null;
  confirmationSignatureFileId: string | null;
  confirmationSignatureSha256: string | null;
  createdAt: Date;
}) {
  const signedAmountCents =
    fact.effectDirection === "decrease"
      ? -dbMoneyToBigInt(fact.amountCents, "上游资金事实金额")
      : dbMoneyToBigInt(fact.amountCents, "上游资金事实金额");
  const cashEffectCents =
    fact.status === "confirmed" &&
    fact.factType === "affiliate_remittance_to_company"
      ? signedAmountCents
      : 0n;
  return {
    id: fact.id,
    projectId: fact.projectId,
    factType: fact.factType,
    factTypeLabel:
      UPSTREAM_FUND_FACT_LABELS[fact.factType as ProjectUpstreamFundFactType] ??
      fact.factType,
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId,
    effectDirection: fact.effectDirection,
    occurredAt: fact.occurredAt.toISOString(),
    amountCents: moneyCentsToApi(fact.amountCents),
    signedAmountCents: moneyCentsToApi(signedAmountCents),
    cashEffectCents: moneyCentsToApi(cashEffectCents),
    counterpartyName: fact.counterpartyName,
    basisType: fact.basisType,
    deductionCategory: fact.deductionCategory,
    upstreamSettlementId: fact.upstreamSettlementId,
    affiliateAssignmentId: fact.affiliateAssignmentId,
    affiliateBusinessPartyVersionId: fact.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: fact.affiliateNameSnapshot,
    description: fact.description,
    evidenceFileId: fact.evidenceFileId,
    documentVersion: fact.documentVersion,
    fileContentSha256Snapshot: fact.fileContentSha256Snapshot,
    recordedByUserId: fact.recordedByUserId,
    recordedByRoleKey: fact.recordedByRoleKey,
    status: fact.status,
    confirmedByUserId: fact.confirmedByUserId,
    confirmedAt: fact.confirmedAt?.toISOString() ?? null,
    confirmationActionId: fact.confirmationActionId,
    confirmationSignatureVersionId: fact.confirmationSignatureVersionId,
    confirmationSignatureFileId: fact.confirmationSignatureFileId,
    confirmationSignatureSha256: fact.confirmationSignatureSha256,
    createdAt: fact.createdAt.toISOString()
  };
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
