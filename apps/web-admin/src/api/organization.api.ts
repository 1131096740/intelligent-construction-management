import {
  DUAL_SCOPE_ROLE_KEYS,
  GLOBAL_USER_POSITION_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export const ORGANIZATION_ROLE_KEYS = [
  "chairman",
  "general_manager",
  "project_manager",
  "contract_director",
  "contract_staff",
  "budget_director",
  "budget_staff",
  "finance_director",
  "finance_staff",
  "material_director",
  "material_staff",
  "engineering_department_member",
  "engineering_department_director",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech",
  "comprehensive_director",
  "employee",
  "super_admin"
] as const satisfies readonly RoleKey[];

export const GLOBAL_ORGANIZATION_ROLE_KEYS: readonly RoleKey[] =
  GLOBAL_USER_POSITION_ROLE_KEYS;
export const DUAL_SCOPE_ORGANIZATION_ROLE_KEYS: readonly RoleKey[] =
  DUAL_SCOPE_ROLE_KEYS;

const ORGANIZATION_ROLE_KEY_SET = new Set<string>(ORGANIZATION_ROLE_KEYS);

export function isOrganizationRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && ORGANIZATION_ROLE_KEY_SET.has(value);
}

export interface OrganizationDepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  children: OrganizationDepartmentNode[];
}

export interface OrganizationDirectoryUser {
  id: string;
  name: string;
  phone: string;
  departmentId: string | null;
  departmentName: string;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  globalPositions: Array<{ key: RoleKey; name: string }>;
  projectPositions: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    keys: RoleKey[];
    names: string[];
    needsReconciliation?: boolean;
    legacySource?: "user_position";
    legacyPositionKeys?: RoleKey[];
    legacyPositionNames?: string[];
  }>;
  rosterProjects?: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    needsReconciliation?: boolean;
    legacySource?: "user_position";
    legacyPositionKeys?: RoleKey[];
    legacyPositionNames?: string[];
  }>;
}

export interface OrganizationDirectory {
  summary: {
    departments: number;
    activeUsers: number;
    inactiveUsers: number;
    positions: number;
  };
  departments: OrganizationDepartmentNode[];
  users: OrganizationDirectoryUser[];
  projects: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  positions: Array<{ id: string; key: RoleKey; name: string }>;
}

export type PermissionIntegrityIssueCode =
  | "duplicate_global_assignment"
  | "legacy_project_user_position"
  | "dual_source_project_role"
  | "invalid_role"
  | "project_super_admin"
  | "global_scope_mismatch"
  | "project_scope_mismatch"
  | "orphan_user"
  | "orphan_position"
  | "orphan_project";

export interface PermissionIntegrityIssue {
  code: PermissionIntegrityIssueCode;
  severity: "blocking" | "warning";
  source: "user_position" | "project_member";
  assignmentIds: string[];
  userId?: string;
  projectId?: string;
  positionId?: string;
  roleKey?: string;
  message: string;
}

export interface PermissionIntegrityReadModel {
  policy: {
    globalWriteSource: "UserPosition(projectId=null)";
    projectWriteSource: "ProjectMember";
    legacyProjectUserPositionReadCompatibility: true;
    projectSuperAdminAllowed: false;
  };
  readiness: {
    canonicalRoleWritesReady: boolean;
    legacyMigrationReady: boolean;
  };
  summary: {
    globalAssignments: number;
    canonicalProjectAssignments: number;
    legacyProjectAssignments: number;
    duplicateGlobalGroups: number;
    dualSourceOverlaps: number;
    invalidRoleAssignments: number;
    orphanAssignments: number;
    blockingIssues: number;
    warningIssues: number;
  };
  issues: PermissionIntegrityIssue[];
}

export type OrganizationRoleScope = "global" | "project";

export interface OrganizationRoleRemovalTarget {
  operation: "remove";
  userId: string;
  scope: OrganizationRoleScope;
  projectId?: string | null;
  roleKey: RoleKey;
}

export type RoleRemovalBlockingIssueCode =
  | "target_user_missing"
  | "target_position_missing"
  | "target_project_missing"
  | "target_assignment_missing"
  | "target_assignment_ambiguous"
  | "legacy_shadow_assignment"
  | "last_active_global_super_admin";

export type RoleRemovalImpactReasonCode =
  | "no_executable_current_approver"
  | "invalid_approval_instance_data"
  | "approval_execution_semantics_not_safe";

export interface RoleRemovalImpactPreview {
  change: {
    operation: "remove";
    userId: string;
    scope: OrganizationRoleScope;
    projectId: string | null;
    roleKey: RoleKey;
  };
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
    reasonCode: RoleRemovalImpactReasonCode | null;
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

export interface RoleRemovalBatchImpactPreview {
  evaluatedAt: string;
  combinedSnapshotHash: string;
  canApply: boolean;
  simulatedTargets: number;
  blockingTarget: RoleRemovalImpactPreview["change"] | null;
  steps: Array<RoleRemovalImpactPreview & { sequence: number }>;
}

export interface PreviewOrganizationRoleRemovalBatchPayload {
  targets: OrganizationRoleRemovalTarget[];
}

export interface ApplyOrganizationRoleRemovalPayload extends OrganizationRoleRemovalTarget {
  snapshotHash: string;
  confirmationPassword: string;
}

export interface ApplyOrganizationRoleRemovalResult {
  change: RoleRemovalImpactPreview["change"];
  assignmentId: string;
  source: "user_position" | "project_member";
  affectedInstances: number;
  revokedRefreshTokens: number;
}

export interface OrganizationRoleAdditionTarget {
  operation: "add";
  userId: string;
  scope: OrganizationRoleScope;
  projectId?: string | null;
  roleKey: RoleKey;
}

export type RoleAdditionBlockingIssueCode =
  | "target_user_missing"
  | "target_user_inactive"
  | "target_position_missing"
  | "target_project_missing"
  | "target_project_inactive"
  | "target_assignment_exists"
  | "target_assignment_ambiguous"
  | "project_super_admin_forbidden"
  | "legacy_shadow_assignment"
  | "canonical_role_writes_not_ready";

export type RoleAdditionImpactReasonCode =
  | "no_executable_current_approver"
  | "invalid_approval_instance_data"
  | "approval_execution_semantics_not_safe"
  | "role_addition_revokes_target_review_capability";

export interface RoleAdditionResolution {
  channel: "direct" | "assignment" | "delegation" | null;
  roleKey: RoleKey | null;
  canReview: boolean;
  requiresSelfReviewConfirmation: boolean;
}

export interface RoleAdditionImpactPreview {
  change: {
    operation: "add";
    userId: string;
    scope: OrganizationRoleScope;
    projectId: string | null;
    roleKey: RoleKey;
  };
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
    reasonCode: RoleAdditionImpactReasonCode | null;
    targetBefore: RoleAdditionResolution;
    targetAfter: RoleAdditionResolution;
    roleCoverage: RoleRemovalImpactPreview["impacts"][number]["roleCoverage"];
  }>;
}

export interface ApplyOrganizationRoleAdditionPayload extends OrganizationRoleAdditionTarget {
  snapshotHash: string;
  confirmationPassword: string;
}

export interface ApplyOrganizationRoleAdditionResult {
  change: RoleAdditionImpactPreview["change"];
  assignmentId: string;
  source: "user_position" | "project_member";
  affectedNodes: number;
  revokedRefreshTokens: number;
}

export interface CreateOrganizationDepartmentPayload {
  name: string;
  parentId?: string | null;
  confirmationPassword: string;
}

export interface UpdateOrganizationDepartmentPayload {
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
  confirmationPassword: string;
}

export interface UpdateOrganizationUserPayload {
  departmentId?: string | null;
  isActive?: boolean;
  confirmationPassword: string;
}

export interface OrganizationDepartmentMutationResult {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

export interface OrganizationUserMutationResult {
  id: string;
  departmentId: string | null;
  isActive: boolean;
}

export interface CreateOrganizationUserPayload {
  phone: string;
  departmentId: string;
  initialRoleKey: RoleKey;
  initialRoleScope?: "global" | "project";
  projectId?: string;
  confirmationPassword: string;
}

export interface CreateOrganizationUserResult {
  id: string;
  name: "待本人确认";
  phone: string;
  departmentId: string;
  isActive: true;
  mustChangePassword: true;
}

export class OrganizationApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "OrganizationApiError";
  }
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new OrganizationApiError(message, response.status);
}

async function readJson<T>(path: string, fallback = "读取组织目录失败"): Promise<T> {
  const response = await apiFetch(path, { method: "GET" });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

async function sendJson<T>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  fallback = "保存组织信息失败"
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

export interface ProjectRosterManagementOptions {
  canManageRoster: boolean;
  projects: Array<{ id: string; code: string; name: string }>;
  users: Array<{ id: string; name: string; phone: string | null; canManage: boolean }>;
}

export interface ProjectRosterChange {
  operation: "join" | "leave";
  projectId: string;
  userId: string;
  reason: string;
}

export interface ProjectRosterChangePreview extends ProjectRosterChange {
  projectName: string;
  personName: string;
  snapshotHash: string;
  canApply: boolean;
  blockingReasons: string[];
  projectRoleKeys: RoleKey[];
  projectRoleNames: string[];
  affectedApprovals: number;
  retainsGlobalAccess: boolean;
}

export function fetchProjectRosterManagementOptions() {
  return readJson<ProjectRosterManagementOptions>("/organization/project-roster/options", "读取项目人员维护范围失败");
}

export function previewProjectRosterChange(body: ProjectRosterChange) {
  return sendJson<ProjectRosterChangePreview>("/organization/project-roster/preview", "POST", body, "预览人员调整失败");
}

export function applyProjectRosterChange(body: ProjectRosterChange & { snapshotHash: string; confirmationPassword: string; commandKey?: string }) {
  return sendJson<{ projectId: string; userId: string; operation: "join" | "leave"; commandKey: string }>("/organization/project-roster/apply", "POST", body, "保存人员调整失败");
}

export interface PersonnelCommand {
  commandKey: string;
  userId: string;
  action: "join" | "adjust" | "offboard" | "rehire";
  reason: string;
  departmentId?: string;
  startedOn?: string;
  companyEntityId?: string;
  additions?: OrganizationRoleAdditionTarget[];
  removals?: OrganizationRoleRemovalTarget[];
  rosterChanges?: Array<{ operation: "join" | "leave"; projectId: string }>;
}
export interface PersonnelPreview {
  snapshotHash: string; canApply: boolean; blockingReasons: string[];
  userId: string; personName: string; action: string;
}
export interface PersonnelResult { commandKey: string; userId: string; action: string }
export interface EmploymentHistory {
  periods: Array<{ id: string; startedOn: string | null; endedOn: string | null; endedAt: string | null;
    verified: boolean; companyEntityId: string | null; revision: number }>;
  changes: Array<{ id: string; action: string; reason: string; createdAt: string }>;
}
export const previewPersonnelChange = (body: PersonnelCommand) => sendJson<PersonnelPreview>("/organization/personnel-changes/preview", "POST", body, "读取人事办理影响失败");
export const applyPersonnelChange = (body: PersonnelCommand & { snapshotHash: string; confirmationPassword: string }) => sendJson<PersonnelResult>("/organization/personnel-changes/apply", "POST", body, "办理结果仍待核实");
export const fetchPersonnelResult = (key: string) => readJson<PersonnelResult | { found: false; message: string }>(`/organization/personnel-changes/results/${encodeURIComponent(key)}`, "核对办理结果失败");
export const fetchEmploymentHistory = (userId: string) => readJson<EmploymentHistory>(`/organization/users/${encodeURIComponent(userId)}/employment`, "读取任职履历失败");

export function fetchOrganizationDirectory() {
  return readJson<OrganizationDirectory>("/organization/directory");
}

export interface OrganizationManagementCapabilities {
  canReviewApplications?: boolean;
  canApproveImportantEmployees?: boolean;
  canGenerateRecoveryCode?: boolean;
  importantEmployeeRoleKeys?: RoleKey[];
  canManageUsers: boolean;
  canManageRoles: boolean;
  canCreateUser: boolean;
  canManageDepartments: boolean;
  manageableDepartmentIds: string[];
  manageableUserIds: string[];
  manageableRoleUserIds?: string[];
  manageableRoleKeys: RoleKey[];
}

export function fetchOrganizationManagementCapabilities() {
  return readJson<OrganizationManagementCapabilities>(
    "/organization/management-capabilities", "读取组织管理权限失败"
  );
}

export function fetchPermissionIntegrity() {
  return readJson<PermissionIntegrityReadModel>(
    "/organization/permission-integrity",
    "读取权限完整性预检失败"
  );
}

function roleRemovalRequestTarget(payload: OrganizationRoleRemovalTarget) {
  const operation: unknown = payload.operation;
  const scope: unknown = payload.scope;
  if (operation !== "remove") throw new Error("岗位变更操作不正确");
  if (scope !== "global" && scope !== "project") throw new Error("岗位范围不正确");
  if (!payload.userId.trim()) throw new Error("人员标识缺失");
  if (!isOrganizationRoleKey(payload.roleKey)) throw new Error("岗位键不正确");
  if (payload.scope === "global") {
    if (payload.projectId !== undefined && payload.projectId !== null) {
      throw new Error("全局岗位不得提交项目标识");
    }
    return {
      operation: "remove" as const,
      userId: payload.userId,
      scope: payload.scope,
      roleKey: payload.roleKey
    };
  }
  if (!payload.projectId?.trim()) throw new Error("项目岗位缺少项目标识");
  return {
    operation: "remove" as const,
    userId: payload.userId,
    scope: payload.scope,
    projectId: payload.projectId,
    roleKey: payload.roleKey
  };
}

function roleRemovalBatchRequestTargets(targets: OrganizationRoleRemovalTarget[]) {
  if (!Array.isArray(targets) || targets.length < 2) {
    throw new Error("批量撤销至少需要 2 个目标");
  }
  if (targets.length > 20) {
    throw new Error("批量撤销一次最多 20 个目标");
  }
  const coordinates = new Set<string>();
  return targets.map((target) => {
    const requestTarget = roleRemovalRequestTarget(target);
    const normalized = {
      ...requestTarget,
      userId: requestTarget.userId.trim(),
      ...(requestTarget.scope === "project"
        ? { projectId: requestTarget.projectId.trim() }
        : {})
    };
    if (normalized.scope === "project" && normalized.roleKey === "super_admin") {
      throw new Error("项目岗位不得批量预览系统管理员清理");
    }
    const coordinate = [
      normalized.userId,
      normalized.scope,
      normalized.scope === "project" ? normalized.projectId : "",
      normalized.roleKey
    ].join("\u0000");
    if (coordinates.has(coordinate)) {
      throw new Error("批量撤销目标不得重复");
    }
    coordinates.add(coordinate);
    return normalized;
  });
}

function roleAdditionRequestTarget(payload: OrganizationRoleAdditionTarget) {
  const operation: unknown = payload.operation;
  const scope: unknown = payload.scope;
  if (operation !== "add") throw new Error("岗位变更操作不正确");
  if (scope !== "global" && scope !== "project") throw new Error("岗位范围不正确");
  if (!payload.userId.trim()) throw new Error("人员标识缺失");
  if (!isOrganizationRoleKey(payload.roleKey)) throw new Error("岗位键不正确");
  if (payload.scope === "global") {
    if (payload.projectId !== undefined && payload.projectId !== null) {
      throw new Error("全局岗位不得提交项目标识");
    }
    return {
      operation: "add" as const,
      userId: payload.userId,
      scope: payload.scope,
      roleKey: payload.roleKey
    };
  }
  if (!payload.projectId?.trim()) throw new Error("项目岗位缺少项目标识");
  if (payload.roleKey === "super_admin") throw new Error("项目岗位不得新增系统管理员");
  return {
    operation: "add" as const,
    userId: payload.userId,
    scope: payload.scope,
    projectId: payload.projectId,
    roleKey: payload.roleKey
  };
}

export function previewOrganizationRoleRemoval(payload: OrganizationRoleRemovalTarget) {
  const target = roleRemovalRequestTarget(payload);
  return sendJson<RoleRemovalImpactPreview>(
    "/organization/role-changes/preview",
    "POST",
    target,
    "读取岗位撤销影响失败"
  );
}

export function previewOrganizationRoleRemovalBatch(
  payload: PreviewOrganizationRoleRemovalBatchPayload
) {
  const targets = roleRemovalBatchRequestTargets(payload.targets);
  return sendJson<RoleRemovalBatchImpactPreview>(
    "/organization/role-changes/batch-preview",
    "POST",
    { targets },
    "读取批量岗位撤销影响失败"
  );
}

export function applyOrganizationRoleRemoval(payload: ApplyOrganizationRoleRemovalPayload) {
  const target = roleRemovalRequestTarget(payload);
  return sendJson<ApplyOrganizationRoleRemovalResult>(
    "/organization/role-changes/apply",
    "POST",
    {
      ...target,
      snapshotHash: payload.snapshotHash,
      confirmationPassword: payload.confirmationPassword
    },
    "撤销岗位失败"
  );
}

export function previewOrganizationRoleAddition(payload: OrganizationRoleAdditionTarget) {
  const target = roleAdditionRequestTarget(payload);
  return sendJson<RoleAdditionImpactPreview>(
    "/organization/role-additions/preview",
    "POST",
    target,
    "读取岗位新增影响失败"
  );
}

export function applyOrganizationRoleAddition(payload: ApplyOrganizationRoleAdditionPayload) {
  const target = roleAdditionRequestTarget(payload);
  return sendJson<ApplyOrganizationRoleAdditionResult>(
    "/organization/role-additions/apply",
    "POST",
    {
      ...target,
      snapshotHash: payload.snapshotHash,
      confirmationPassword: payload.confirmationPassword
    },
    "新增岗位失败"
  );
}

export function createOrganizationDepartment(payload: CreateOrganizationDepartmentPayload) {
  return sendJson<OrganizationDepartmentMutationResult>("/organization/departments", "POST", {
    name: payload.name,
    ...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
    confirmationPassword: payload.confirmationPassword
  });
}

export function createOrganizationUser(payload: CreateOrganizationUserPayload) {
  return sendJson<CreateOrganizationUserResult>("/organization/users", "POST", {
    phone: payload.phone,
    departmentId: payload.departmentId,
    initialRoleKey: payload.initialRoleKey,
    ...(payload.initialRoleScope ? { initialRoleScope: payload.initialRoleScope } : {}),
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    confirmationPassword: payload.confirmationPassword
  }, "创建人员失败");
}

export function updateOrganizationDepartment(
  departmentId: string,
  payload: UpdateOrganizationDepartmentPayload
) {
  return sendJson<OrganizationDepartmentMutationResult>(
    `/organization/departments/${encodeURIComponent(departmentId)}`,
    "PATCH",
    {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      confirmationPassword: payload.confirmationPassword
    }
  );
}

export function updateOrganizationUser(userId: string, payload: UpdateOrganizationUserPayload) {
  return sendJson<OrganizationUserMutationResult>(
    `/organization/users/${encodeURIComponent(userId)}`,
    "PATCH",
    {
      ...(payload.departmentId !== undefined ? { departmentId: payload.departmentId } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      confirmationPassword: payload.confirmationPassword
    }
  );
}
