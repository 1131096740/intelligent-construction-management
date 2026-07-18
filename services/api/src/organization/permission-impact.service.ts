import { BadRequestException, Injectable } from "@nestjs/common";
import {
  ACTION_REQUIRED_ROLES,
  DUAL_SCOPE_ROLE_KEYS,
  GLOBAL_USER_POSITION_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import type { PreviewRoleAdditionDto } from "./dto/preview-role-addition.dto";
import type { PreviewRoleRemovalBatchDto } from "./dto/preview-role-removal-batch.dto";
import type { PreviewRoleRemovalDto } from "./dto/preview-role-removal.dto";
import { OrganizationService } from "./organization.service";

const ROLE_KEY_SET = new Set<string>(ROLE_KEYS);
const LEADER_ROLE_KEYS = new Set<RoleKey>(["chairman", "general_manager"]);
const LEGACY_BUSINESS_TYPES = [
  "contract_version",
  "settlement",
  "payment_request",
  "project_expense_request"
] as const;
const SPOT_BUSINESS_TYPES = ["spot_procurement_version", "spot_procurement_payment"] as const;
const SUPPORTED_BUSINESS_TYPES = [...LEGACY_BUSINESS_TYPES, ...SPOT_BUSINESS_TYPES] as const;
type SupportedBusinessType = (typeof SUPPORTED_BUSINESS_TYPES)[number];
const APPROVAL_ROLE_SETS_BY_BUSINESS_TYPE = {
  contract_version: new Set(ACTION_REQUIRED_ROLES["contract.approve"]),
  settlement: new Set(ACTION_REQUIRED_ROLES["settlement.approve"]),
  payment_request: new Set(ACTION_REQUIRED_ROLES["payment.approve"]),
  project_expense_request: new Set(ACTION_REQUIRED_ROLES["project_expense.approve"]),
  spot_procurement_version: new Set(ACTION_REQUIRED_ROLES["spot_procurement.approve"]),
  spot_procurement_payment: new Set(ACTION_REQUIRED_ROLES["spot_procurement.payment.approve"])
} satisfies Record<SupportedBusinessType, ReadonlySet<RoleKey>>;
type PermissionImpactClient = Pick<
  Prisma.TransactionClient,
  | "user"
  | "position"
  | "userPosition"
  | "projectMember"
  | "project"
  | "approvalInstance"
  | "approvalDelegation"
  | "contractVersion"
  | "contract"
  | "settlement"
  | "paymentRequest"
  | "projectExpenseRequest"
  | "spotProcurementVersion"
  | "spotProcurement"
  | "spotProcurementPayment"
>;

export type RoleRemovalBlockingIssueCode =
  | "target_user_missing"
  | "target_position_missing"
  | "target_project_missing"
  | "target_assignment_missing"
  | "target_assignment_ambiguous"
  | "legacy_shadow_assignment"
  | "last_active_global_super_admin";

const BLOCKING_ISSUE_MESSAGES: Record<RoleRemovalBlockingIssueCode, string> = {
  target_user_missing: "待撤销岗位的人员不存在",
  target_position_missing: "待撤销的固定岗位不存在",
  target_project_missing: "待撤销岗位所属项目不存在",
  target_assignment_missing: "未找到待撤销的规范岗位事实",
  target_assignment_ambiguous: "待撤销的规范岗位事实不唯一",
  legacy_shadow_assignment: "项目范围仍存在会继续授权的 UserPosition 遗留岗位",
  last_active_global_super_admin: "不能撤销最后一个启用的全局超级管理员"
};

export type RoleAdditionBlockingIssueCode =
  | "target_user_missing"
  | "target_user_inactive"
  | "target_position_missing"
  | "target_project_missing"
  | "target_project_inactive"
  | "target_assignment_exists"
  | "target_assignment_ambiguous"
  | "project_super_admin_forbidden"
  | "global_role_scope_required"
  | "project_role_scope_required"
  | "engineering_member_requires_project_manager"
  | "engineering_director_requires_membership"
  | "engineering_director_already_active"
  | "legacy_shadow_assignment"
  | "canonical_role_writes_not_ready";

const ADDITION_BLOCKING_ISSUE_MESSAGES: Record<RoleAdditionBlockingIssueCode, string> = {
  target_user_missing: "待新增岗位的人员不存在",
  target_user_inactive: "待新增岗位的人员已停用",
  target_position_missing: "待新增的固定岗位不存在",
  target_project_missing: "待新增岗位所属项目不存在",
  target_project_inactive: "待新增岗位所属项目已停用",
  target_assignment_exists: "该规范岗位事实已存在",
  target_assignment_ambiguous: "该规范岗位事实存在重复",
  project_super_admin_forbidden: "super_admin 不允许新增到项目范围",
  global_role_scope_required: "该岗位只能新增到全局范围",
  project_role_scope_required: "该岗位只能新增到项目范围",
  engineering_member_requires_project_manager: "公司工程技术部成员必须先持有同一项目的项目经理岗位",
  engineering_director_requires_membership: "公司工程技术部部长必须至少在一个项目同时持有工程技术部成员和项目经理岗位",
  engineering_director_already_active: "当前已有启用的公司工程技术部部长，请先预览并完成更换",
  legacy_shadow_assignment: "项目范围存在 UserPosition 遗留岗位",
  canonical_role_writes_not_ready: "权限事实完整性未通过，不能新增岗位"
};

interface UserRow {
  id: string;
  isActive: boolean;
}

interface PositionRow {
  id: string;
  key: string;
}

interface UserPositionRow {
  id: string;
  userId: string;
  positionId: string;
  projectId: string | null;
}

interface ProjectMemberRow {
  id: string;
  userId: string;
  projectId: string;
  positionKey: string;
}

interface ApprovalInstanceRow {
  id: string;
  businessType: string;
  businessId: string;
  applicantUserId: string;
  currentNodeIndex: number;
  frozenNodes: unknown;
}

interface DelegationRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsAt: Date;
  endsAt: Date;
  enabled: boolean;
}

interface FrozenAssignment {
  toUserId: string;
  fromRoleKey: RoleKey;
}

interface ParsedNode {
  name: string;
  mode: "any" | "all";
  roleKeys: RoleKey[];
  approvedRoleKeys: RoleKey[];
  pendingRoleKeys: RoleKey[];
  assignments: FrozenAssignment[];
}

interface MappedApprovalInstance extends ApprovalInstanceRow {
  projectId: string | null;
  parsedNode: ParsedNode | null;
}

export interface NormalizedRoleRemovalChange {
  operation: "remove";
  userId: string;
  scope: "global" | "project";
  projectId: string | null;
  roleKey: RoleKey;
}

export interface NormalizedRoleAdditionChange {
  operation: "add";
  userId: string;
  scope: "global" | "project";
  projectId: string | null;
  roleKey: RoleKey;
}

export interface RoleRemovalImpactPreview {
  change: NormalizedRoleRemovalChange;
  evaluatedAt: string;
  snapshotHash: string;
  canApply: boolean;
  summary: { affectedInstances: number; blockingInstances: number };
  blockingIssues: Array<{ code: RoleRemovalBlockingIssueCode; message: string }>;
  impacts: Array<{
    approvalInstanceId: string;
    businessType: string;
    businessId: string;
    projectId: string | null;
    currentNodeIndex: number;
    currentNodeName: string | null;
    mode: "any" | "all" | null;
    pendingRoleKeys: RoleKey[];
    blocking: boolean;
    reasonCode:
      | "no_executable_current_approver"
      | "invalid_approval_instance_data"
      | "approval_execution_semantics_not_safe"
      | null;
    roleCoverage: Array<{
      roleKey: RoleKey;
      targetStillDirectAfter: boolean;
      otherDirectApproverUserIds: string[];
      directApproverUserIdsAfter: string[];
      assignmentApproverUserIds: string[];
      delegationApproverUserIds: string[];
      requiresSelfReviewConfirmation: boolean;
      executable: boolean;
    }>;
  }>;
}

export interface RoleRemovalEvaluation {
  preview: RoleRemovalImpactPreview;
  targetAssignment: {
    id: string;
    source: "user_position" | "project_member";
  } | null;
}

export interface RoleRemovalBatchImpactPreview {
  evaluatedAt: string;
  combinedSnapshotHash: string;
  canApply: boolean;
  simulatedTargets: number;
  blockingTarget: NormalizedRoleRemovalChange | null;
  steps: Array<RoleRemovalImpactPreview & { sequence: number }>;
}

export interface RoleAdditionResolution {
  channel: "direct" | "assignment" | "delegation" | null;
  roleKey: RoleKey | null;
  canReview: boolean;
  requiresSelfReviewConfirmation: boolean;
}

export interface RoleAdditionImpactPreview {
  change: NormalizedRoleAdditionChange;
  evaluatedAt: string;
  snapshotHash: string;
  canApply: boolean;
  summary: { affectedNodes: number; blockingNodes: number };
  blockingIssues: Array<{ code: RoleAdditionBlockingIssueCode; message: string }>;
  impacts: Array<{
    approvalInstanceId: string;
    businessType: string;
    businessId: string;
    projectId: string | null;
    nodeIndex: number;
    nodeName: string | null;
    mode: "any" | "all" | null;
    roleKeys: RoleKey[];
    pendingRoleKeys: RoleKey[];
    blocking: boolean;
    reasonCode:
      | "no_executable_current_approver"
      | "invalid_approval_instance_data"
      | "approval_execution_semantics_not_safe"
      | "role_addition_revokes_target_review_capability"
      | null;
    targetBefore: RoleAdditionResolution;
    targetAfter: RoleAdditionResolution;
    roleCoverage: RoleRemovalImpactPreview["impacts"][number]["roleCoverage"];
  }>;
}

export type RoleAdditionCreateTarget =
  | {
      source: "user_position";
      userId: string;
      projectId: null;
      roleKey: RoleKey;
      positionId: string;
    }
  | {
      source: "project_member";
      userId: string;
      projectId: string;
      roleKey: RoleKey;
    };

export interface RoleAdditionEvaluation {
  preview: RoleAdditionImpactPreview;
  targetCreate: RoleAdditionCreateTarget | null;
}

interface DirectFacts {
  usersByProjectAndRole: Map<string, Set<string>>;
  usersByGlobalRole: Map<RoleKey, Set<string>>;
}

@Injectable()
export class PermissionImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organization?: OrganizationService
  ) {}

  async previewRoleRemoval(
    input: PreviewRoleRemovalDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleRemovalImpactPreview> {
    return (await this.evaluateRoleRemoval(this.prisma, input, evaluatedAt)).preview;
  }

  async previewRoleRemovalBatch(
    input: PreviewRoleRemovalBatchDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleRemovalBatchImpactPreview> {
    const targets = normalizeBatchRemovalTargets(input.targets);
    return this.prisma.$transaction(
      async (tx) => {
        const snapshotClient = cachedPermissionImpactClient(tx);
        const excludedUserPositionIds = new Set<string>();
        const excludedProjectMemberIds = new Set<string>();
        const evaluatedSteps: Array<{
          preview: RoleRemovalImpactPreview;
          targetAssignment: RoleRemovalEvaluation["targetAssignment"];
        }> = [];

        for (const target of targets) {
          const client = excludingRoleAssignments(
            snapshotClient,
            excludedUserPositionIds,
            excludedProjectMemberIds
          );
          const evaluation = await this.evaluateRoleRemoval(client, target, evaluatedAt);
          evaluatedSteps.push(evaluation);
          if (!evaluation.preview.canApply || !evaluation.targetAssignment) break;
          if (evaluation.targetAssignment.source === "user_position") {
            excludedUserPositionIds.add(evaluation.targetAssignment.id);
          } else {
            excludedProjectMemberIds.add(evaluation.targetAssignment.id);
          }
        }

        const firstBlockingStep = evaluatedSteps.find((step) => !step.preview.canApply);
        const combinedSnapshotHash = hashSnapshot({
          schemaVersion: 1,
          targets,
          steps: evaluatedSteps.map((step, sequence) => ({
            sequence,
            change: step.preview.change,
            snapshotHash: step.preview.snapshotHash,
            targetAssignment: step.targetAssignment
          }))
        });

        return {
          evaluatedAt: evaluatedAt.toISOString(),
          combinedSnapshotHash,
          canApply:
            evaluatedSteps.length === targets.length &&
            evaluatedSteps.every((step) => step.preview.canApply),
          simulatedTargets: evaluatedSteps.length,
          blockingTarget: firstBlockingStep?.preview.change ?? null,
          steps: evaluatedSteps.map((step, sequence) => ({ sequence, ...step.preview }))
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async evaluateRoleRemoval(
    client: PermissionImpactClient,
    input: PreviewRoleRemovalDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleRemovalEvaluation> {
    const change = normalizeChange(input);
    const [users, positions, userPositions, projectMembers, projects, instances, delegations] =
      (await Promise.all([
        client.user.findMany({ select: { id: true, isActive: true } }),
        client.position.findMany({ select: { id: true, key: true } }),
        client.userPosition.findMany({
          select: { id: true, userId: true, positionId: true, projectId: true }
        }),
        client.projectMember.findMany({
          select: { id: true, userId: true, projectId: true, positionKey: true }
        }),
        client.project.findMany({ select: { id: true } }),
        client.approvalInstance.findMany({
          where: {
            OR: [
              {
                status: "in_progress",
                businessType: { in: [...LEGACY_BUSINESS_TYPES] }
              },
              {
                status: "approval_pending",
                businessType: { in: [...SPOT_BUSINESS_TYPES] }
              }
            ]
          },
          select: {
            id: true,
            businessType: true,
            businessId: true,
            applicantUserId: true,
            currentNodeIndex: true,
            frozenNodes: true
          }
        }),
        client.approvalDelegation.findMany({
          where: {
            enabled: true,
            startsAt: { lte: evaluatedAt },
            endsAt: { gte: evaluatedAt }
          },
          select: {
            id: true,
            fromUserId: true,
            toUserId: true,
            startsAt: true,
            endsAt: true,
            enabled: true
          }
        })
      ])) as [
        UserRow[],
        PositionRow[],
        UserPositionRow[],
        ProjectMemberRow[],
        Array<{ id: string }>,
        ApprovalInstanceRow[],
        DelegationRow[]
      ];

    const blockingIssues: Array<{ code: RoleRemovalBlockingIssueCode; message: string }> = [];
    const issue = (code: RoleRemovalBlockingIssueCode) =>
      blockingIssues.push({ code, message: BLOCKING_ISSUE_MESSAGES[code] });
    const position = positions.find((row) => row.key === change.roleKey);

    if (!users.some((user) => user.id === change.userId)) issue("target_user_missing");
    if (!position) issue("target_position_missing");
    if (change.scope === "project" && !projects.some((project) => project.id === change.projectId)) {
      issue("target_project_missing");
    }
    const targetAssignments = position
      ? change.scope === "global"
        ? userPositions.filter(
            (assignment) =>
              assignment.userId === change.userId &&
              assignment.positionId === position.id &&
              assignment.projectId === null
          )
        : projectMembers.filter(
            (assignment) =>
              assignment.userId === change.userId &&
              assignment.projectId === change.projectId &&
              assignment.positionKey === change.roleKey
          )
      : [];
    if (position && targetAssignments.length === 0) issue("target_assignment_missing");
    if (targetAssignments.length > 1) issue("target_assignment_ambiguous");

    const targetAssignmentId = targetAssignments.length === 1 ? targetAssignments[0]?.id ?? null : null;
    const remainingUserPositions =
      change.scope === "global" && targetAssignmentId
        ? userPositions.filter((assignment) => assignment.id !== targetAssignmentId)
        : userPositions;
    const remainingProjectMembers =
      change.scope === "project" && targetAssignmentId
        ? projectMembers.filter((assignment) => assignment.id !== targetAssignmentId)
        : projectMembers;

    if (
      change.scope === "project" &&
      targetAssignmentId !== null &&
      position &&
      userPositions.some(
        (assignment) =>
          assignment.userId === change.userId &&
          assignment.positionId === position.id &&
          assignment.projectId === change.projectId
      )
    ) {
      issue("legacy_shadow_assignment");
    }

    if (
      change.scope === "global" &&
      targetAssignmentId !== null &&
      change.roleKey === "super_admin" &&
      !hasActiveGlobalSuperAdmin(users, positions, remainingUserPositions)
    ) {
      issue("last_active_global_super_admin");
    }

    const mappedInstances = await this.mapApprovalProjects(client, instances);
    const directFacts = buildDirectFacts(
      users,
      positions,
      remainingUserPositions,
      remainingProjectMembers
    );
    const resolutionIssueCodes = new Set<RoleRemovalBlockingIssueCode>([
      "target_user_missing",
      "target_position_missing",
      "target_project_missing",
      "target_assignment_missing",
      "target_assignment_ambiguous"
    ]);
    const targetResolved = !blockingIssues.some((blockingIssue) =>
      resolutionIssueCodes.has(blockingIssue.code)
    );
    const relevantInstances = targetResolved
      ? collectRelevantRemovalNodes(mappedInstances, change).sort(
          (left, right) =>
            compareText(left.id, right.id) || left.currentNodeIndex - right.currentNodeIndex
        )
      : [];
    const impacts = relevantInstances
      .map((instance) => buildImpact(instance, change, users, directFacts, delegations))
      .sort(
        (left, right) =>
          compareText(left.approvalInstanceId, right.approvalInstanceId) ||
          left.currentNodeIndex - right.currentNodeIndex
      );
    const blockingInstances = impacts.filter((impact) => impact.blocking).length;

    const snapshotHash = hashSnapshot({
      schemaVersion: 1,
      change,
      targetAssignmentId,
      instances: relevantInstances.map((instance) => ({
          id: instance.id,
          businessType: instance.businessType,
          businessId: instance.businessId,
          applicantUserId: instance.applicantUserId,
          currentNodeIndex: instance.currentNodeIndex,
          currentNode: Array.isArray(instance.frozenNodes)
            ? instance.frozenNodes[instance.currentNodeIndex] ?? null
            : null,
          projectId: instance.projectId
        })),
      users: stableRows(users, (row) => row.id),
      positions: stableRows(positions, (row) => `${row.id}\u0000${row.key}`),
      projects: stableRows(projects, (row) => row.id),
      userPositions: stableRows(userPositions, (row) => row.id),
      projectMembers: stableRows(projectMembers, (row) => row.id),
      delegations: stableRows(delegations, (row) => row.id)
    });

    const preview: RoleRemovalImpactPreview = {
      change,
      evaluatedAt: evaluatedAt.toISOString(),
      snapshotHash,
      canApply: blockingIssues.length === 0 && blockingInstances === 0,
      summary: { affectedInstances: impacts.length, blockingInstances },
      blockingIssues,
      impacts
    };
    return {
      preview,
      targetAssignment: targetAssignmentId
        ? {
            id: targetAssignmentId,
            source: change.scope === "global" ? "user_position" : "project_member"
          }
        : null
    };
  }

  async previewRoleAddition(
    input: PreviewRoleAdditionDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleAdditionImpactPreview> {
    return (await this.evaluateRoleAddition(this.prisma, input, evaluatedAt)).preview;
  }

  async evaluateRoleAddition(
    client: PermissionImpactClient,
    input: PreviewRoleAdditionDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleAdditionEvaluation> {
    if (!this.organization) {
      throw new Error("岗位新增影响评估缺少组织完整性服务");
    }
    const change = normalizeAdditionChange(input);
    const [integrity, users, positions, userPositions, projectMembers, projects, instances, delegations] =
      (await Promise.all([
        this.organization.evaluatePermissionIntegrity(client),
        client.user.findMany({ select: { id: true, isActive: true } }),
        client.position.findMany({ select: { id: true, key: true } }),
        client.userPosition.findMany({
          select: { id: true, userId: true, positionId: true, projectId: true }
        }),
        client.projectMember.findMany({
          select: { id: true, userId: true, projectId: true, positionKey: true }
        }),
        client.project.findMany({ select: { id: true, isActive: true } }),
        client.approvalInstance.findMany({
          where: {
            OR: [
              {
                status: "in_progress",
                businessType: { in: [...LEGACY_BUSINESS_TYPES] }
              },
              {
                status: "approval_pending",
                businessType: { in: [...SPOT_BUSINESS_TYPES] }
              }
            ]
          },
          select: {
            id: true,
            businessType: true,
            businessId: true,
            applicantUserId: true,
            currentNodeIndex: true,
            frozenNodes: true
          }
        }),
        client.approvalDelegation.findMany({
          where: {
            enabled: true,
            startsAt: { lte: evaluatedAt },
            endsAt: { gte: evaluatedAt }
          },
          select: {
            id: true,
            fromUserId: true,
            toUserId: true,
            startsAt: true,
            endsAt: true,
            enabled: true
          }
        })
      ])) as [
        Awaited<ReturnType<OrganizationService["getPermissionIntegrity"]>>,
        UserRow[],
        PositionRow[],
        UserPositionRow[],
        ProjectMemberRow[],
        Array<{ id: string; isActive: boolean }>,
        ApprovalInstanceRow[],
        DelegationRow[]
      ];

    const blockingIssues: Array<{ code: RoleAdditionBlockingIssueCode; message: string }> = [];
    const issue = (code: RoleAdditionBlockingIssueCode) => {
      if (!blockingIssues.some((item) => item.code === code)) {
        blockingIssues.push({ code, message: ADDITION_BLOCKING_ISSUE_MESSAGES[code] });
      }
    };
    const user = users.find((row) => row.id === change.userId);
    const position = positions.find((row) => row.key === change.roleKey);
    const project = change.projectId
      ? projects.find((row) => row.id === change.projectId)
      : undefined;
    if (!user) issue("target_user_missing");
    else if (!user.isActive) issue("target_user_inactive");
    if (!position) issue("target_position_missing");
    if (change.scope === "project" && !project) issue("target_project_missing");
    else if (change.scope === "project" && !project?.isActive) issue("target_project_inactive");
    if (change.scope === "project" && change.roleKey === "super_admin") {
      issue("project_super_admin_forbidden");
    }
    if (
      change.scope === "project" &&
      GLOBAL_USER_POSITION_ROLE_KEYS.includes(change.roleKey) &&
      !DUAL_SCOPE_ROLE_KEYS.includes(change.roleKey)
    ) {
      issue("global_role_scope_required");
    }
    if (
      change.scope === "global" &&
      !GLOBAL_USER_POSITION_ROLE_KEYS.includes(change.roleKey)
    ) {
      issue("project_role_scope_required");
    }
    if (
      change.roleKey === "engineering_department_member" &&
      change.scope === "project" &&
      !projectMembers.some(
        (row) =>
          row.userId === change.userId &&
          row.projectId === change.projectId &&
          row.positionKey === "project_manager"
      )
    ) {
      issue("engineering_member_requires_project_manager");
    }
    if (change.roleKey === "engineering_department_director" && change.scope === "global") {
      const projectManagerProjectIds = new Set(
        projectMembers
          .filter(
            (row) => row.userId === change.userId && row.positionKey === "project_manager"
          )
          .map((row) => row.projectId)
      );
      if (
        !projectMembers.some(
          (row) =>
            row.userId === change.userId &&
            row.positionKey === "engineering_department_member" &&
            projectManagerProjectIds.has(row.projectId)
        )
      ) {
        issue("engineering_director_requires_membership");
      }
      const directorPosition = positions.find(
        (row) => row.key === "engineering_department_director"
      );
      const activeUserIds = new Set(users.filter((row) => row.isActive).map((row) => row.id));
      if (
        directorPosition &&
        userPositions.some(
          (row) =>
            row.positionId === directorPosition.id &&
            row.projectId === null &&
            row.userId !== change.userId &&
            activeUserIds.has(row.userId)
        )
      ) {
        issue("engineering_director_already_active");
      }
    }
    if (!integrity.readiness.canonicalRoleWritesReady) {
      issue("canonical_role_writes_not_ready");
    }

    const canonicalTargets = position
      ? change.scope === "global"
        ? userPositions.filter(
            (row) =>
              row.userId === change.userId &&
              row.positionId === position.id &&
              row.projectId === null
          )
        : projectMembers.filter(
            (row) =>
              row.userId === change.userId &&
              row.projectId === change.projectId &&
              row.positionKey === change.roleKey
          )
      : [];
    if (canonicalTargets.length === 1) issue("target_assignment_exists");
    else if (canonicalTargets.length > 1) issue("target_assignment_ambiguous");
    if (
      change.scope === "project" &&
      position &&
      userPositions.some(
        (row) =>
          row.userId === change.userId &&
          row.positionId === position.id &&
          row.projectId === change.projectId
      )
    ) {
      issue("legacy_shadow_assignment");
    }

    const resolutionIssueCodes = new Set<RoleAdditionBlockingIssueCode>([
      "target_user_missing",
      "target_user_inactive",
      "target_position_missing",
      "target_project_missing",
      "target_project_inactive",
      "target_assignment_exists",
      "target_assignment_ambiguous",
      "project_super_admin_forbidden",
      "global_role_scope_required",
      "project_role_scope_required",
      "engineering_member_requires_project_manager",
      "engineering_director_requires_membership",
      "engineering_director_already_active",
      "legacy_shadow_assignment"
    ]);
    const targetResolved = !blockingIssues.some((item) => resolutionIssueCodes.has(item.code));
    const targetCreate: RoleAdditionCreateTarget | null =
      targetResolved && position
        ? change.scope === "global"
          ? {
              source: "user_position",
              userId: change.userId,
              projectId: null,
              roleKey: change.roleKey,
              positionId: position.id
            }
          : {
              source: "project_member",
              userId: change.userId,
              projectId: change.projectId as string,
              roleKey: change.roleKey
            }
        : null;
    const userPositionsAfter =
      targetCreate?.source === "user_position"
        ? [
            ...userPositions,
            {
              id: "__pending_role_addition__",
              userId: targetCreate.userId,
              positionId: targetCreate.positionId,
              projectId: null
            }
          ]
        : userPositions;
    const projectMembersAfter =
      targetCreate?.source === "project_member"
        ? [
            ...projectMembers,
            {
              id: "__pending_role_addition__",
              userId: targetCreate.userId,
              projectId: targetCreate.projectId,
              positionKey: targetCreate.roleKey
            }
          ]
        : projectMembers;
    const factsBefore = buildDirectFacts(users, positions, userPositions, projectMembers, false);
    const factsAfter = buildDirectFacts(
      users,
      positions,
      userPositionsAfter,
      projectMembersAfter,
      false
    );
    const mappedInstances = await this.mapApprovalProjects(client, instances);
    const relevantNodes = targetCreate
      ? collectRelevantAdditionNodes(mappedInstances, change)
      : [];
    const stableRelevantNodes = [...relevantNodes].sort(
      (left, right) =>
        compareText(left.id, right.id) || left.currentNodeIndex - right.currentNodeIndex
    );
    const impacts = stableRelevantNodes
      .map((instance) => {
        const impact = buildImpact(instance, change, users, factsAfter, delegations, true);
        const targetBefore = resolveUserOnNode(
          instance,
          change.userId,
          users,
          factsBefore,
          delegations
        );
        const targetAfter = resolveUserOnNode(
          instance,
          change.userId,
          users,
          factsAfter,
          delegations
        );
        const revokesTargetReviewCapability = targetBefore.canReview && !targetAfter.canReview;
        return {
          approvalInstanceId: impact.approvalInstanceId,
          businessType: impact.businessType,
          businessId: impact.businessId,
          projectId: impact.projectId,
          nodeIndex: impact.currentNodeIndex,
          nodeName: impact.currentNodeName,
          mode: impact.mode,
          roleKeys: instance.parsedNode?.roleKeys ?? [],
          pendingRoleKeys: impact.pendingRoleKeys,
          blocking: impact.blocking || revokesTargetReviewCapability,
          reasonCode:
            impact.reasonCode ??
            (revokesTargetReviewCapability
              ? ("role_addition_revokes_target_review_capability" as const)
              : null),
          targetBefore,
          targetAfter,
          roleCoverage: impact.roleCoverage
        };
      });
    const blockingNodes = impacts.filter((impact) => impact.blocking).length;
    const snapshotHash = hashSnapshot({
      schemaVersion: 1,
      kind: "role_addition",
      change,
      targetCreate,
      integrity,
      instances: stableRelevantNodes.map((instance) => ({
        id: instance.id,
        businessType: instance.businessType,
        businessId: instance.businessId,
        applicantUserId: instance.applicantUserId,
        nodeIndex: instance.currentNodeIndex,
        node: Array.isArray(instance.frozenNodes)
          ? instance.frozenNodes[instance.currentNodeIndex] ?? null
          : null,
        projectId: instance.projectId
      })),
      users: stableRows(users, (row) => row.id),
      positions: stableRows(positions, (row) => `${row.id}\u0000${row.key}`),
      projects: stableRows(projects, (row) => row.id),
      userPositions: stableRows(userPositions, (row) => row.id),
      projectMembers: stableRows(projectMembers, (row) => row.id),
      delegations: stableRows(delegations, (row) => row.id)
    });
    const preview: RoleAdditionImpactPreview = {
      change,
      evaluatedAt: evaluatedAt.toISOString(),
      snapshotHash,
      canApply: blockingIssues.length === 0 && blockingNodes === 0,
      summary: { affectedNodes: impacts.length, blockingNodes },
      blockingIssues,
      impacts
    };
    return { preview, targetCreate };
  }

  private async mapApprovalProjects(
    client: PermissionImpactClient,
    instances: ApprovalInstanceRow[]
  ): Promise<MappedApprovalInstance[]> {
    const ids = (businessType: SupportedBusinessType) =>
      instances.filter((row) => row.businessType === businessType).map((row) => row.businessId);
    const contractVersionIds = ids("contract_version");
    const spotVersionIds = ids("spot_procurement_version");
    const spotPaymentIds = ids("spot_procurement_payment");
    const [contractVersions, settlements, payments, expenses, spotVersions, spotPayments] = (await Promise.all([
      client.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: { id: true, contractId: true }
      }),
      client.settlement.findMany({
        where: { id: { in: ids("settlement") } },
        select: { id: true, projectId: true }
      }),
      client.paymentRequest.findMany({
        where: { id: { in: ids("payment_request") } },
        select: { id: true, projectId: true }
      }),
      client.projectExpenseRequest.findMany({
        where: { id: { in: ids("project_expense_request") } },
        select: { id: true, projectId: true }
      }),
      spotVersionIds.length
        ? client.spotProcurementVersion.findMany({
            where: { id: { in: spotVersionIds } },
            select: { id: true, procurementId: true }
          })
        : Promise.resolve([]),
      spotPaymentIds.length
        ? client.spotProcurementPayment.findMany({
            where: { id: { in: spotPaymentIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([])
    ])) as [
      Array<{ id: string; contractId: string }>,
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; procurementId: string }>,
      Array<{ id: string; projectId: string }>
    ];
    const [contracts, spotProcurements] = (await Promise.all([
      client.contract.findMany({
        where: { id: { in: contractVersions.map((row) => row.contractId) } },
        select: { id: true, projectId: true }
      }),
      spotVersions.length
        ? client.spotProcurement.findMany({
            where: { id: { in: [...new Set(spotVersions.map((row) => row.procurementId))] } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([])
    ])) as [
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; projectId: string }>
    ];
    const contractById = new Map(contracts.map((row) => [row.id, row.projectId]));
    const projectBySpotProcurementId = new Map(
      spotProcurements.map((row) => [row.id, row.projectId])
    );
    const projectByBusinessKey = new Map<string, string>();
    for (const row of contractVersions) {
      const projectId = contractById.get(row.contractId);
      if (projectId) projectByBusinessKey.set(`contract_version:${row.id}`, projectId);
    }
    for (const [businessType, rows] of [
      ["settlement", settlements],
      ["payment_request", payments],
      ["project_expense_request", expenses],
      ["spot_procurement_payment", spotPayments]
    ] as const) {
      for (const row of rows) projectByBusinessKey.set(`${businessType}:${row.id}`, row.projectId);
    }
    for (const row of spotVersions) {
      const projectId = projectBySpotProcurementId.get(row.procurementId);
      if (projectId) projectByBusinessKey.set(`spot_procurement_version:${row.id}`, projectId);
    }

    return instances.map((instance) => ({
      ...instance,
      projectId: projectByBusinessKey.get(`${instance.businessType}:${instance.businessId}`) ?? null,
      parsedNode: parseCurrentNode(instance)
    }));
  }
}

function normalizeChange(input: PreviewRoleRemovalDto): NormalizedRoleRemovalChange {
  if (input.operation !== "remove") {
    throw new BadRequestException("只支持预览撤销岗位");
  }
  if (input.scope === "global" && input.projectId !== undefined && input.projectId !== null) {
    throw new BadRequestException("全局岗位不得提交项目标识");
  }
  if (input.scope === "project" && !input.projectId?.trim()) {
    throw new BadRequestException("项目岗位必须提交项目标识");
  }
  return {
    operation: "remove",
    userId: input.userId.trim(),
    scope: input.scope,
    projectId: input.scope === "project" ? input.projectId?.trim() || null : null,
    roleKey: input.roleKey
  };
}

function normalizeBatchRemovalTargets(
  targets: PreviewRoleRemovalDto[]
): NormalizedRoleRemovalChange[] {
  if (!Array.isArray(targets) || targets.length < 2) {
    throw new BadRequestException("批量撤销至少需要 2 个目标");
  }
  if (targets.length > 20) {
    throw new BadRequestException("批量撤销一次最多 20 个目标");
  }
  const normalized = targets.map(normalizeChange);
  const coordinates = new Set<string>();
  for (const target of normalized) {
    const coordinate = [target.userId, target.scope, target.projectId ?? "", target.roleKey].join(
      "\u0000"
    );
    if (coordinates.has(coordinate)) {
      throw new BadRequestException("批量撤销目标不得重复");
    }
    coordinates.add(coordinate);
  }
  return normalized;
}

function normalizeAdditionChange(input: PreviewRoleAdditionDto): NormalizedRoleAdditionChange {
  if (input.operation !== "add") {
    throw new BadRequestException("只支持新增岗位");
  }
  if (input.scope === "global" && input.projectId !== undefined && input.projectId !== null) {
    throw new BadRequestException("全局岗位不得提交项目标识");
  }
  if (input.scope === "project" && !input.projectId?.trim()) {
    throw new BadRequestException("项目岗位必须提交项目标识");
  }
  return {
    operation: "add",
    userId: input.userId.trim(),
    scope: input.scope,
    projectId: input.scope === "project" ? input.projectId?.trim() || null : null,
    roleKey: input.roleKey
  };
}

function parseCurrentNode(instance: ApprovalInstanceRow): ParsedNode | null {
  return parseNodeAt(
    instance,
    instance.currentNodeIndex,
    spotApprovalRoleSetForBusinessType(instance.businessType) ?? undefined
  );
}

function parseNodeAt(
  instance: ApprovalInstanceRow,
  nodeIndex: number,
  allowedRoles?: ReadonlySet<RoleKey>
): ParsedNode | null {
  if (!Array.isArray(instance.frozenNodes)) return null;
  if (!Number.isInteger(nodeIndex) || nodeIndex < 0) return null;
  const value = instance.frozenNodes[nodeIndex];
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0) return null;
  if (value.mode !== "any" && value.mode !== "all") return null;
  const roleKeys = validRoleKeyArray(value.roleKeys, allowedRoles);
  if (!roleKeys || roleKeys.length === 0) return null;
  const approvedRoleKeys =
    value.approvedRoleKeys === undefined
      ? []
      : validRoleKeyArray(value.approvedRoleKeys, allowedRoles);
  if (!approvedRoleKeys || approvedRoleKeys.some((role) => !roleKeys.includes(role))) return null;
  const pendingRoleKeys = roleKeys.filter((role) => !approvedRoleKeys.includes(role));
  if (pendingRoleKeys.length === 0) return null;
  const assignments = supportsIndirectApproval(instance.businessType)
    ? parseAssignments(value.assignments, allowedRoles)
    : [];
  if (!assignments) return null;
  if (
    allowedRoles &&
    assignments.some((assignment) => !roleKeys.includes(assignment.fromRoleKey))
  ) {
    return null;
  }
  return {
    name: value.name.trim(),
    mode: value.mode,
    roleKeys,
    approvedRoleKeys,
    pendingRoleKeys,
    assignments
  };
}

function validRoleKeyArray(
  value: unknown,
  allowedRoles?: ReadonlySet<RoleKey>
): RoleKey[] | null {
  if (!Array.isArray(value)) return null;
  const result: RoleKey[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !ROLE_KEY_SET.has(item) ||
      (allowedRoles && !allowedRoles.has(item as RoleKey))
    ) {
      return null;
    }
    if (!result.includes(item as RoleKey)) result.push(item as RoleKey);
  }
  return result;
}

function parseAssignments(
  value: unknown,
  allowedRoles?: ReadonlySet<RoleKey>
): FrozenAssignment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: FrozenAssignment[] = [];
  for (const assignment of value) {
    if (
      !isRecord(assignment) ||
      typeof assignment.toUserId !== "string" ||
      assignment.toUserId.trim().length === 0 ||
      typeof assignment.fromRoleKey !== "string" ||
      !ROLE_KEY_SET.has(assignment.fromRoleKey) ||
      (allowedRoles && !allowedRoles.has(assignment.fromRoleKey as RoleKey))
    ) {
      return null;
    }
    result.push({
      toUserId: assignment.toUserId,
      fromRoleKey: assignment.fromRoleKey as RoleKey
    });
  }
  return uniqueInOrder(result, (row) => `${row.fromRoleKey}\u0000${row.toUserId}`);
}

function buildDirectFacts(
  users: UserRow[],
  positions: PositionRow[],
  userPositions: UserPositionRow[],
  projectMembers: ProjectMemberRow[],
  allowGlobalSuperAdmin = true
): DirectFacts {
  const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
  const roleByPositionId = new Map(
    positions.filter((row) => ROLE_KEY_SET.has(row.key)).map((row) => [row.id, row.key as RoleKey])
  );
  const usersByGlobalRole = new Map<RoleKey, Set<string>>();
  const usersByProjectAndRole = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, userId: string) => {
    if (!activeUserIds.has(userId)) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(userId);
    map.set(key, set);
  };

  for (const assignment of userPositions) {
    const roleKey = roleByPositionId.get(assignment.positionId);
    if (!roleKey) continue;
    if (assignment.projectId === null) {
      if (!allowGlobalSuperAdmin && roleKey === "super_admin") continue;
      const set = usersByGlobalRole.get(roleKey) ?? new Set<string>();
      if (activeUserIds.has(assignment.userId)) set.add(assignment.userId);
      usersByGlobalRole.set(roleKey, set);
    } else if (roleKey !== "super_admin") {
      add(usersByProjectAndRole, `${assignment.projectId}\u0000${roleKey}`, assignment.userId);
    }
  }
  for (const assignment of projectMembers) {
    if (!ROLE_KEY_SET.has(assignment.positionKey) || assignment.positionKey === "super_admin") continue;
    add(
      usersByProjectAndRole,
      `${assignment.projectId}\u0000${assignment.positionKey}`,
      assignment.userId
    );
  }
  return { usersByGlobalRole, usersByProjectAndRole };
}

function directUsersForRole(facts: DirectFacts, projectId: string | null, roleKey: RoleKey) {
  return stableText([
    ...(facts.usersByGlobalRole.get(roleKey) ?? []),
    ...(projectId ? facts.usersByProjectAndRole.get(`${projectId}\u0000${roleKey}`) ?? [] : [])
  ]);
}

function buildImpact(
  instance: MappedApprovalInstance,
  change: { userId: string },
  users: UserRow[],
  directFacts: DirectFacts,
  delegations: DelegationRow[],
  enforceActionGuardEligibility = false
) {
  if (!instance.parsedNode || !instance.projectId) {
    return {
      approvalInstanceId: instance.id,
      businessType: instance.businessType,
      businessId: instance.businessId,
      projectId: instance.projectId,
      currentNodeIndex: instance.currentNodeIndex,
      currentNodeName: instance.parsedNode?.name ?? null,
      mode: instance.parsedNode?.mode ?? null,
      pendingRoleKeys: instance.parsedNode?.pendingRoleKeys ?? [],
      blocking: true,
      reasonCode: "invalid_approval_instance_data" as const,
      roleCoverage: []
    };
  }

  const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
  const supportsIndirect = supportsIndirectApproval(instance.businessType);
  const directRoleByUser = new Map<string, RoleKey>();
  for (const roleKey of instance.parsedNode.roleKeys) {
    for (const userId of directUsersForRole(directFacts, instance.projectId, roleKey)) {
      if (!directRoleByUser.has(userId)) directRoleByUser.set(userId, roleKey);
    }
  }
  const assignmentRoleByUser = new Map<string, RoleKey>();
  if (supportsIndirect) {
    for (const assignment of instance.parsedNode.assignments) {
      if (
        activeUserIds.has(assignment.toUserId) &&
        !directRoleByUser.has(assignment.toUserId) &&
        !assignmentRoleByUser.has(assignment.toUserId) &&
        (!enforceActionGuardEligibility ||
          isApprovalActionGuardEligible(
            instance,
            assignment.toUserId,
            users,
            directFacts,
            delegations
          ))
      ) {
        assignmentRoleByUser.set(assignment.toUserId, assignment.fromRoleKey);
      }
    }
  }
  const roleCoverage = instance.parsedNode.pendingRoleKeys.map((roleKey) => {
    const rawDirect = directUsersForRole(directFacts, instance.projectId, roleKey);
    const directSelfReviewAllowed = (userId: string) =>
      userId !== instance.applicantUserId ||
      LEADER_ROLE_KEYS.has(roleKey);
    const directApproverUserIdsAfter = stableText(
      [...directRoleByUser.entries()]
        .filter(
          ([userId, selectedRoleKey]) =>
            selectedRoleKey === roleKey && directSelfReviewAllowed(userId)
        )
        .map(([userId]) => userId)
    );
    const assignmentApproverUserIds = supportsIndirect
      ? stableText(
          [...assignmentRoleByUser.entries()]
            .filter(
              ([userId, selectedRoleKey]) =>
                selectedRoleKey === roleKey && userId !== instance.applicantUserId
            )
            .map(([userId]) => userId)
        )
      : [];
    const delegationApproverUserIds = supportsIndirect
      ? stableText(
          delegations
            .filter(
              (delegation) =>
                activeUserIds.has(delegation.fromUserId) &&
                activeUserIds.has(delegation.toUserId) &&
                directRoleByUser.get(delegation.fromUserId) === roleKey &&
                !directRoleByUser.has(delegation.toUserId) &&
                !assignmentRoleByUser.has(delegation.toUserId) &&
                delegation.toUserId !== instance.applicantUserId
            )
            .map((delegation) => delegation.toUserId)
        )
      : [];
    const allApprovers = stableText([
      ...directApproverUserIdsAfter,
      ...assignmentApproverUserIds,
      ...delegationApproverUserIds
    ]);
    return {
      roleKey,
      targetStillDirectAfter: rawDirect.includes(change.userId),
      otherDirectApproverUserIds: directApproverUserIdsAfter.filter(
        (userId) => userId !== change.userId
      ),
      directApproverUserIdsAfter,
      assignmentApproverUserIds,
      delegationApproverUserIds,
      requiresSelfReviewConfirmation:
        directApproverUserIdsAfter.includes(instance.applicantUserId) &&
        LEADER_ROLE_KEYS.has(roleKey),
      executable: allApprovers.length > 0
    };
  });
  const executionSemanticsUnsafe =
    instance.parsedNode.mode === "all" && instance.parsedNode.roleKeys.length > 1;
  const executableByCoverage =
    instance.parsedNode.mode === "any"
      ? roleCoverage.some((coverage) => coverage.executable)
      : roleCoverage.every((coverage) => coverage.executable);
  const executable = !executionSemanticsUnsafe && executableByCoverage;
  return {
    approvalInstanceId: instance.id,
    businessType: instance.businessType,
    businessId: instance.businessId,
    projectId: instance.projectId,
    currentNodeIndex: instance.currentNodeIndex,
    currentNodeName: instance.parsedNode.name,
    mode: instance.parsedNode.mode,
    pendingRoleKeys: instance.parsedNode.pendingRoleKeys,
    blocking: !executable,
    reasonCode: executable
      ? null
      : executionSemanticsUnsafe
        ? ("approval_execution_semantics_not_safe" as const)
        : ("no_executable_current_approver" as const),
    roleCoverage
  };
}

function collectRelevantAdditionNodes(
  instances: MappedApprovalInstance[],
  change: NormalizedRoleAdditionChange
): MappedApprovalInstance[] {
  const relevant: MappedApprovalInstance[] = [];
  for (const instance of instances) {
    if (
      change.scope === "project" &&
      instance.projectId &&
      instance.projectId !== change.projectId
    ) {
      continue;
    }
    if (
      !Array.isArray(instance.frozenNodes) ||
      !Number.isInteger(instance.currentNodeIndex) ||
      instance.currentNodeIndex < 0 ||
      instance.currentNodeIndex >= instance.frozenNodes.length
    ) {
      relevant.push({ ...instance, parsedNode: null });
      continue;
    }
    for (let nodeIndex = instance.currentNodeIndex; nodeIndex < instance.frozenNodes.length; nodeIndex += 1) {
      const allowedRoles = approvalRoleSetForBusinessType(instance.businessType);
      const parsedNode = allowedRoles ? parseNodeAt(instance, nodeIndex, allowedRoles) : null;
      const mayUnlockFrozenAssignment =
        supportsIndirectApproval(instance.businessType) &&
        allowedRoles?.has(change.roleKey) &&
        parsedNode?.assignments.some((assignment) => assignment.toUserId === change.userId);
      if (
        !parsedNode ||
        parsedNode.roleKeys.includes(change.roleKey) ||
        mayUnlockFrozenAssignment
      ) {
        relevant.push({ ...instance, currentNodeIndex: nodeIndex, parsedNode });
      }
    }
  }
  return relevant;
}

function collectRelevantRemovalNodes(
  instances: MappedApprovalInstance[],
  change: NormalizedRoleRemovalChange
): MappedApprovalInstance[] {
  const relevant: MappedApprovalInstance[] = [];
  for (const instance of instances) {
    if (
      change.scope === "project" &&
      instance.projectId &&
      instance.projectId !== change.projectId
    ) {
      continue;
    }
    if (
      !Array.isArray(instance.frozenNodes) ||
      !Number.isInteger(instance.currentNodeIndex) ||
      instance.currentNodeIndex < 0 ||
      instance.currentNodeIndex >= instance.frozenNodes.length
    ) {
      relevant.push({ ...instance, parsedNode: null });
      continue;
    }
    for (
      let nodeIndex = instance.currentNodeIndex;
      nodeIndex < instance.frozenNodes.length;
      nodeIndex += 1
    ) {
      const parsedNode = parseNodeAt(
        instance,
        nodeIndex,
        spotApprovalRoleSetForBusinessType(instance.businessType) ?? undefined
      );
      if (!parsedNode || parsedNode.pendingRoleKeys.includes(change.roleKey)) {
        relevant.push({ ...instance, currentNodeIndex: nodeIndex, parsedNode });
      }
    }
  }
  return relevant;
}

function approvalRoleSetForBusinessType(
  businessType: string
): ReadonlySet<RoleKey> | null {
  if (!SUPPORTED_BUSINESS_TYPES.includes(businessType as SupportedBusinessType)) return null;
  return APPROVAL_ROLE_SETS_BY_BUSINESS_TYPE[businessType as SupportedBusinessType];
}

function spotApprovalRoleSetForBusinessType(businessType: string): ReadonlySet<RoleKey> | null {
  if (!SPOT_BUSINESS_TYPES.includes(businessType as (typeof SPOT_BUSINESS_TYPES)[number])) {
    return null;
  }
  return approvalRoleSetForBusinessType(businessType);
}

function supportsIndirectApproval(businessType: string) {
  return (
    businessType !== "project_expense_request" &&
    businessType !== "spot_procurement_version" &&
    businessType !== "spot_procurement_payment"
  );
}

function isApprovalActionGuardEligible(
  instance: MappedApprovalInstance,
  userId: string,
  users: UserRow[],
  directFacts: DirectFacts,
  delegations: DelegationRow[]
): boolean {
  if (!instance.projectId || !users.some((user) => user.id === userId && user.isActive)) {
    return false;
  }
  const allowedRoles = approvalRoleSetForBusinessType(instance.businessType);
  if (!allowedRoles) return false;
  const hasAllowedDirectRole = (candidateUserId: string) =>
    [...allowedRoles].some((roleKey) =>
      directUsersForRole(directFacts, instance.projectId, roleKey).includes(candidateUserId)
    );
  if (hasAllowedDirectRole(userId)) return true;
  if (!supportsIndirectApproval(instance.businessType)) return false;

  const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
  return delegations.some(
    (delegation) =>
      delegation.toUserId === userId &&
      activeUserIds.has(delegation.fromUserId) &&
      activeUserIds.has(delegation.toUserId) &&
      hasAllowedDirectRole(delegation.fromUserId)
  );
}

function resolveUserOnNode(
  instance: MappedApprovalInstance,
  userId: string,
  users: UserRow[],
  directFacts: DirectFacts,
  delegations: DelegationRow[]
): RoleAdditionResolution {
  const none: RoleAdditionResolution = {
    channel: null,
    roleKey: null,
    canReview: false,
    requiresSelfReviewConfirmation: false
  };
  const node = instance.parsedNode;
  if (!node || !instance.projectId || !users.some((user) => user.id === userId && user.isActive)) {
    return none;
  }
  const directRoleByUser = new Map<string, RoleKey>();
  for (const roleKey of node.roleKeys) {
    for (const directUserId of directUsersForRole(directFacts, instance.projectId, roleKey)) {
      if (!directRoleByUser.has(directUserId)) directRoleByUser.set(directUserId, roleKey);
    }
  }
  const directRole = directRoleByUser.get(userId);
  if (directRole) {
    const requiresSelfReviewConfirmation =
      userId === instance.applicantUserId && LEADER_ROLE_KEYS.has(directRole);
    return {
      channel: "direct",
      roleKey: directRole,
      canReview: userId !== instance.applicantUserId || requiresSelfReviewConfirmation,
      requiresSelfReviewConfirmation
    };
  }
  if (!supportsIndirectApproval(instance.businessType)) return none;
  const assignment = node.assignments.find((item) => item.toUserId === userId);
  if (
    assignment &&
    isApprovalActionGuardEligible(instance, userId, users, directFacts, delegations)
  ) {
    return {
      channel: "assignment",
      roleKey: assignment.fromRoleKey,
      canReview: userId !== instance.applicantUserId,
      requiresSelfReviewConfirmation: false
    };
  }
  const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
  for (const roleKey of node.roleKeys) {
    const delegated = delegations.some(
      (delegation) =>
        delegation.toUserId === userId &&
        activeUserIds.has(delegation.fromUserId) &&
        activeUserIds.has(delegation.toUserId) &&
        directRoleByUser.get(delegation.fromUserId) === roleKey
    );
    if (delegated) {
      return {
        channel: "delegation",
        roleKey,
        canReview: userId !== instance.applicantUserId,
        requiresSelfReviewConfirmation: false
      };
    }
  }
  return none;
}

function hasActiveGlobalSuperAdmin(
  users: UserRow[],
  positions: PositionRow[],
  userPositions: UserPositionRow[]
) {
  const activeIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
  const adminPositionIds = new Set(
    positions.filter((position) => position.key === "super_admin").map((position) => position.id)
  );
  return userPositions.some(
    (assignment) =>
      assignment.projectId === null &&
      adminPositionIds.has(assignment.positionId) &&
      activeIds.has(assignment.userId)
  );
}

function excludingRoleAssignments(
  client: PermissionImpactClient,
  excludedUserPositionIds: ReadonlySet<string>,
  excludedProjectMemberIds: ReadonlySet<string>
): PermissionImpactClient {
  const findUserPositions = client.userPosition.findMany.bind(client.userPosition) as (
    args: unknown
  ) => Promise<UserPositionRow[]>;
  const findProjectMembers = client.projectMember.findMany.bind(client.projectMember) as (
    args: unknown
  ) => Promise<ProjectMemberRow[]>;
  return {
    user: client.user,
    position: client.position,
    userPosition: {
      findMany: async (args: unknown) =>
        (await findUserPositions(args)).filter(
          (assignment) => !excludedUserPositionIds.has(assignment.id)
        )
    },
    projectMember: {
      findMany: async (args: unknown) =>
        (await findProjectMembers(args)).filter(
          (assignment) => !excludedProjectMemberIds.has(assignment.id)
        )
    },
    project: client.project,
    approvalInstance: client.approvalInstance,
    approvalDelegation: client.approvalDelegation,
    contractVersion: client.contractVersion,
    contract: client.contract,
    settlement: client.settlement,
    paymentRequest: client.paymentRequest,
    projectExpenseRequest: client.projectExpenseRequest,
    spotProcurementVersion: client.spotProcurementVersion,
    spotProcurement: client.spotProcurement,
    spotProcurementPayment: client.spotProcurementPayment
  } as unknown as PermissionImpactClient;
}

function cachedPermissionImpactClient(client: PermissionImpactClient): PermissionImpactClient {
  const cachedDelegate = (delegate: { findMany: (...args: never[]) => unknown }) => {
    let result: unknown;
    return {
      findMany: (...args: never[]) => {
        result ??= delegate.findMany(...args);
        return result;
      }
    };
  };
  return {
    user: cachedDelegate(client.user),
    position: cachedDelegate(client.position),
    userPosition: cachedDelegate(client.userPosition),
    projectMember: cachedDelegate(client.projectMember),
    project: cachedDelegate(client.project),
    approvalInstance: cachedDelegate(client.approvalInstance),
    approvalDelegation: cachedDelegate(client.approvalDelegation),
    contractVersion: cachedDelegate(client.contractVersion),
    contract: cachedDelegate(client.contract),
    settlement: cachedDelegate(client.settlement),
    paymentRequest: cachedDelegate(client.paymentRequest),
    projectExpenseRequest: cachedDelegate(client.projectExpenseRequest),
    spotProcurementVersion: cachedDelegate(client.spotProcurementVersion),
    spotProcurement: cachedDelegate(client.spotProcurement),
    spotProcurementPayment: cachedDelegate(client.spotProcurementPayment)
  } as unknown as PermissionImpactClient;
}

function hashSnapshot(value: unknown) {
  const canonical = stableValue(value);
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableText(values: Iterable<string>) {
  return [...new Set(values)].sort(compareText);
}

function uniqueInOrder<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const stableKey = key(value);
    if (seen.has(stableKey)) return false;
    seen.add(stableKey);
    return true;
  });
}

function stableRows<T>(values: T[], key: (value: T) => string) {
  return [...values].sort((left, right) => compareText(key(left), key(right)));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
