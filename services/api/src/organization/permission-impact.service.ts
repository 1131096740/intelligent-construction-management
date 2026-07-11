import { BadRequestException, Injectable } from "@nestjs/common";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import type { PreviewRoleRemovalDto } from "./dto/preview-role-removal.dto";

const ROLE_KEY_SET = new Set<string>(ROLE_KEYS);
const LEADER_ROLE_KEYS = new Set<RoleKey>(["chairman", "general_manager"]);
const SUPPORTED_BUSINESS_TYPES = [
  "contract_version",
  "settlement",
  "payment_request",
  "project_expense_request"
] as const;
type SupportedBusinessType = (typeof SUPPORTED_BUSINESS_TYPES)[number];
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

interface DirectFacts {
  usersByProjectAndRole: Map<string, Set<string>>;
  usersByGlobalRole: Map<RoleKey, Set<string>>;
}

@Injectable()
export class PermissionImpactService {
  constructor(private readonly prisma: PrismaService) {}

  async previewRoleRemoval(
    input: PreviewRoleRemovalDto,
    evaluatedAt: Date = new Date()
  ): Promise<RoleRemovalImpactPreview> {
    return (await this.evaluateRoleRemoval(this.prisma, input, evaluatedAt)).preview;
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
            status: "in_progress",
            businessType: { in: [...SUPPORTED_BUSINESS_TYPES] }
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
      ? mappedInstances
          .filter((instance) => isRelevantInstance(instance, change))
          .sort((left, right) => compareText(left.id, right.id))
      : [];
    const impacts = relevantInstances
      .map((instance) => buildImpact(instance, change, users, directFacts, delegations))
      .sort((left, right) => compareText(left.approvalInstanceId, right.approvalInstanceId));
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

  private async mapApprovalProjects(
    client: PermissionImpactClient,
    instances: ApprovalInstanceRow[]
  ): Promise<MappedApprovalInstance[]> {
    const ids = (businessType: SupportedBusinessType) =>
      instances.filter((row) => row.businessType === businessType).map((row) => row.businessId);
    const contractVersionIds = ids("contract_version");
    const [contractVersions, settlements, payments, expenses] = (await Promise.all([
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
      })
    ])) as [
      Array<{ id: string; contractId: string }>,
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; projectId: string }>,
      Array<{ id: string; projectId: string }>
    ];
    const contracts = (await client.contract.findMany({
      where: { id: { in: contractVersions.map((row) => row.contractId) } },
      select: { id: true, projectId: true }
    })) as Array<{ id: string; projectId: string }>;
    const contractById = new Map(contracts.map((row) => [row.id, row.projectId]));
    const projectByBusinessKey = new Map<string, string>();
    for (const row of contractVersions) {
      const projectId = contractById.get(row.contractId);
      if (projectId) projectByBusinessKey.set(`contract_version:${row.id}`, projectId);
    }
    for (const [businessType, rows] of [
      ["settlement", settlements],
      ["payment_request", payments],
      ["project_expense_request", expenses]
    ] as const) {
      for (const row of rows) projectByBusinessKey.set(`${businessType}:${row.id}`, row.projectId);
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

function parseCurrentNode(instance: ApprovalInstanceRow): ParsedNode | null {
  if (!Array.isArray(instance.frozenNodes)) return null;
  if (!Number.isInteger(instance.currentNodeIndex) || instance.currentNodeIndex < 0) return null;
  const value = instance.frozenNodes[instance.currentNodeIndex];
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0) return null;
  if (value.mode !== "any" && value.mode !== "all") return null;
  const roleKeys = validRoleKeyArray(value.roleKeys);
  if (!roleKeys || roleKeys.length === 0) return null;
  const approvedRoleKeys = value.approvedRoleKeys === undefined ? [] : validRoleKeyArray(value.approvedRoleKeys);
  if (!approvedRoleKeys || approvedRoleKeys.some((role) => !roleKeys.includes(role))) return null;
  const pendingRoleKeys = roleKeys.filter((role) => !approvedRoleKeys.includes(role));
  if (pendingRoleKeys.length === 0) return null;
  const assignments =
    instance.businessType === "project_expense_request" ? [] : parseAssignments(value.assignments);
  if (!assignments) return null;
  return {
    name: value.name.trim(),
    mode: value.mode,
    roleKeys,
    approvedRoleKeys,
    pendingRoleKeys,
    assignments
  };
}

function validRoleKeyArray(value: unknown): RoleKey[] | null {
  if (!Array.isArray(value)) return null;
  const result: RoleKey[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ROLE_KEY_SET.has(item)) return null;
    if (!result.includes(item as RoleKey)) result.push(item as RoleKey);
  }
  return result;
}

function parseAssignments(value: unknown): FrozenAssignment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: FrozenAssignment[] = [];
  for (const assignment of value) {
    if (
      !isRecord(assignment) ||
      typeof assignment.toUserId !== "string" ||
      assignment.toUserId.trim().length === 0 ||
      typeof assignment.fromRoleKey !== "string" ||
      !ROLE_KEY_SET.has(assignment.fromRoleKey)
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
  projectMembers: ProjectMemberRow[]
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
  change: NormalizedRoleRemovalChange,
  users: UserRow[],
  directFacts: DirectFacts,
  delegations: DelegationRow[]
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
  const supportsIndirect = instance.businessType !== "project_expense_request";
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
        !assignmentRoleByUser.has(assignment.toUserId)
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

function isRelevantInstance(instance: MappedApprovalInstance, change: NormalizedRoleRemovalChange) {
  if (change.scope === "project" && instance.projectId && instance.projectId !== change.projectId) {
    return false;
  }
  if (!instance.parsedNode || !instance.projectId) return true;
  return instance.parsedNode.pendingRoleKeys.includes(change.roleKey);
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
