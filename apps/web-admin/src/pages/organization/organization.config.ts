import { isOrganizationRoleKey } from "../../api/organization.api";
import type {
  ApplyOrganizationRoleAdditionPayload,
  CreateOrganizationDepartmentPayload,
  ApplyOrganizationRoleRemovalPayload,
  OrganizationDepartmentNode,
  OrganizationDirectory,
  OrganizationDirectoryUser,
  PermissionIntegrityIssue,
  PermissionIntegrityReadModel,
  RoleAdditionImpactPreview,
  RoleAdditionImpactReasonCode,
  RoleAdditionResolution,
  RoleRemovalImpactPreview,
  RoleRemovalImpactReasonCode,
  OrganizationRoleRemovalTarget,
  OrganizationRoleAdditionTarget,
  OrganizationRoleScope,
  UpdateOrganizationDepartmentPayload,
  UpdateOrganizationUserPayload
} from "../../api/organization.api";
import type { BusinessStatusSummaryItem } from "../../components/business-status-summary.config";

export interface FlatOrganizationDepartment extends Omit<OrganizationDepartmentNode, "children"> {
  depth: number;
  parentName: string;
  path: string;
}

export interface OrganizationUserFilters {
  keyword?: string;
  departmentId?: string;
  status?: "active" | "inactive";
}

export interface DepartmentFormValue {
  name: string;
  parentId?: string | null;
  isActive?: boolean;
  confirmationPassword?: string;
}

export interface DepartmentSnapshot {
  name: string;
  parentId: string | null;
  isActive: boolean;
}

export interface OrganizationUserFormValue {
  departmentId?: string | null;
  isActive: boolean;
}

export interface OrganizationUserSnapshot {
  departmentId: string | null;
  isActive: boolean;
}

export type OrganizationActionKind = "create_department" | "update_department" | "update_user";

export interface PermissionIntegrityIssueRow {
  key: string;
  severityLabel: "阻断" | "警告";
  severityTone: "danger" | "warning";
  issueLabel: string;
  message: string;
  sourceLabel: string;
  userId: string;
  projectId: string;
  roleKey: string;
  assignmentIds: string;
}

export interface OrganizationRoleRemovalTargetRow extends OrganizationRoleRemovalTarget {
  key: string;
  scopeLabel: string;
  projectLabel: string;
  roleName: string;
}

export interface RoleRemovalImpactRow {
  key: string;
  businessTypeLabel: string;
  businessId: string;
  projectId: string;
  currentNodeName: string;
  modeLabel: string;
  pendingRoleNames: string;
  statusLabel: string;
  statusTone: "success" | "danger";
  reasonLabel: string;
}

export interface OrganizationRoleAdditionSelection {
  scope: OrganizationRoleScope;
  projectId?: string | null;
  roleKey?: OrganizationDirectory["positions"][number]["key"] | null;
}

export interface RoleAdditionImpactRow {
  key: string;
  businessTypeLabel: string;
  businessId: string;
  projectId: string;
  nodeName: string;
  modeLabel: string;
  pendingRoleNames: string;
  beforeText: string;
  afterText: string;
  statusLabel: string;
  statusTone: "success" | "danger";
  reasonLabel: string;
}

const PERMISSION_INTEGRITY_ISSUE_LABELS: Record<string, string> = {
  duplicate_global_assignment: "全局岗位重复分配",
  legacy_project_user_position: "项目级 UserPosition 遗留",
  dual_source_project_role: "项目岗位双源重叠",
  invalid_role: "无效岗位",
  project_super_admin: "项目级超级管理员",
  orphan_user: "人员记录缺失",
  orphan_position: "岗位记录缺失",
  orphan_project: "项目记录缺失"
};

const PERMISSION_INTEGRITY_SOURCE_LABELS: Record<string, string> = {
  user_position: "用户岗位（UserPosition）",
  project_member: "项目成员（ProjectMember）"
};

const ROLE_REMOVAL_BUSINESS_TYPE_LABELS: Record<string, string> = {
  contract_version: "合同版本",
  settlement: "结算",
  payment_request: "付款申请",
  project_expense_request: "项目支出申请"
};

const ROLE_REMOVAL_REASON_LABELS: Record<RoleRemovalImpactReasonCode, string> = {
  no_executable_current_approver: "撤销后当前节点没有可执行审批人",
  invalid_approval_instance_data: "审批实例数据不完整，暂不能安全撤销",
  approval_execution_semantics_not_safe: "当前审批执行规则无法安全模拟，暂不能撤销"
};

const ROLE_ADDITION_REASON_LABELS: Record<RoleAdditionImpactReasonCode, string> = {
  no_executable_current_approver: "新增后当前节点没有可执行审批人",
  invalid_approval_instance_data: "审批实例数据不完整，暂不能安全新增",
  approval_execution_semantics_not_safe: "当前审批执行规则无法安全模拟，暂不能新增",
  role_addition_revokes_target_review_capability: "新增岗位会使目标人员失去当前节点办理能力"
};

function codePointLength(value: string) {
  return Array.from(value).length;
}

function requiredPassword(value: string | undefined) {
  if (!value?.trim()) throw new Error("请输入当前登录密码");
  if (codePointLength(value) > 256) throw new Error("当前登录密码不能超过 256 个字符");
  return value;
}

function roleNameByKey(
  roleKey: string,
  positions: ReadonlyArray<{ id?: string; key: string; name: string }>
) {
  return positions.find((position) => position.key === roleKey)?.name ?? "岗位名称未读取";
}

function normalizedRoleRemovalTarget(target: OrganizationRoleRemovalTarget) {
  const operation: unknown = target.operation;
  const scope: unknown = target.scope;
  if (operation !== "remove") throw new Error("岗位变更操作不正确");
  if (scope !== "global" && scope !== "project") throw new Error("岗位范围不正确");
  if (!target.userId.trim()) throw new Error("人员标识缺失");
  if (target.scope === "global" && target.projectId !== undefined && target.projectId !== null) {
    throw new Error("全局岗位不得提交项目标识");
  }
  if (target.scope === "project" && !target.projectId?.trim()) {
    throw new Error("项目岗位缺少项目标识");
  }
  return {
    operation: "remove" as const,
    userId: target.userId,
    scope: target.scope,
    ...(target.scope === "project" ? { projectId: target.projectId as string } : {}),
    roleKey: target.roleKey
  };
}

function normalizedRoleAdditionTarget(target: OrganizationRoleAdditionTarget) {
  const operation: unknown = target.operation;
  const scope: unknown = target.scope;
  if (operation !== "add") throw new Error("岗位变更操作不正确");
  if (scope !== "global" && scope !== "project") throw new Error("岗位范围不正确");
  if (!target.userId.trim()) throw new Error("人员标识缺失");
  if (!isOrganizationRoleKey(target.roleKey)) throw new Error("岗位键不正确");
  if (target.scope === "global" && target.projectId !== undefined && target.projectId !== null) {
    throw new Error("全局岗位不得提交项目标识");
  }
  if (target.scope === "project" && !target.projectId?.trim()) {
    throw new Error("项目岗位缺少项目标识");
  }
  if (target.scope === "project" && target.roleKey === "super_admin") {
    throw new Error("项目岗位不得新增系统管理员");
  }
  return {
    operation: "add" as const,
    userId: target.userId,
    scope: target.scope,
    ...(target.scope === "project" ? { projectId: target.projectId as string } : {}),
    roleKey: target.roleKey
  };
}

function normalizedDepartmentName(value: string) {
  const name = value.trim();
  if (!name) throw new Error("请填写部门名称");
  if (codePointLength(name) > 100) throw new Error("部门名称不能超过 100 个字符");
  return name;
}

export function flattenDepartmentTree(
  departments: readonly OrganizationDepartmentNode[]
): FlatOrganizationDepartment[] {
  const result: FlatOrganizationDepartment[] = [];
  const visited = new Set<string>();

  const visit = (
    nodes: readonly OrganizationDepartmentNode[],
    depth: number,
    parentName: string,
    parentPath: string
  ) => {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
      result.push({
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        isActive: node.isActive,
        depth,
        parentName,
        path
      });
      visit(node.children ?? [], depth + 1, node.name, path);
    }
  };

  visit(departments, 0, "—", "");
  return result;
}

export function buildDepartmentParentOptions(
  departments: readonly OrganizationDepartmentNode[],
  editingDepartmentId?: string
) {
  const excludedIds = new Set<string>();
  const collectExcluded = (nodes: readonly OrganizationDepartmentNode[], excluding: boolean) => {
    for (const node of nodes) {
      const shouldExclude = excluding || node.id === editingDepartmentId;
      if (shouldExclude) excludedIds.add(node.id);
      collectExcluded(node.children ?? [], shouldExclude);
    }
  };
  collectExcluded(departments, false);

  return flattenDepartmentTree(departments)
    .filter((department) => department.isActive && !excludedIds.has(department.id))
    .map((department) => ({ label: department.path, value: department.id }));
}

export function filterOrganizationUsers(
  users: readonly OrganizationDirectoryUser[],
  filters: OrganizationUserFilters
) {
  const keyword = filters.keyword?.trim().toLocaleLowerCase("zh-CN") ?? "";
  return users.filter((user) => {
    if (filters.departmentId && user.departmentId !== filters.departmentId) return false;
    if (filters.status && user.status !== filters.status) return false;
    if (!keyword) return true;
    const searchableText = [
      user.name,
      user.phone,
      user.departmentName,
      user.status,
      ...user.globalPositions.flatMap((position) => [position.key, position.name]),
      ...user.projectPositions.flatMap((position) => [
        position.projectId,
        position.projectCode,
        position.projectName,
        ...position.keys,
        ...position.names
      ])
    ]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return searchableText.includes(keyword);
  });
}

export function departmentStatusText(isActive: boolean) {
  return isActive ? "启用" : "停用";
}

export function userStatusText(status: OrganizationDirectoryUser["status"]) {
  return status === "active" ? "启用" : "停用";
}

export function mustChangePasswordText(mustChangePassword: boolean) {
  return mustChangePassword ? "待首次改密" : "已完成";
}

export function globalPositionsText(user: OrganizationDirectoryUser) {
  return user.globalPositions.map((position) => position.name).join("、") || "无";
}

export function projectPositionsText(user: OrganizationDirectoryUser) {
  return (
    user.projectPositions
      .map((position) => `${position.projectName}：${position.names.join("、") || "无"}`)
      .join("；") || "无"
  );
}

export function activeOrganizationProjectOptions(projects: OrganizationDirectory["projects"]) {
  return projects
    .filter((project) => project.isActive)
    .slice()
    .sort((left, right) =>
      [left.code, left.name, left.id]
        .join("\u0000")
        .localeCompare([right.code, right.name, right.id].join("\u0000"), "zh-CN")
    )
    .map((project) => ({ label: `${project.name}（${project.code}）`, value: project.id }));
}

export function organizationRoleAdditionOptions(
  user: OrganizationDirectoryUser,
  scope: OrganizationRoleScope,
  projectId: string | null | undefined,
  positions: OrganizationDirectory["positions"]
) {
  if (scope !== "global" && scope !== "project") return [];
  const assigned = new Set(
    scope === "global"
      ? user.globalPositions.map((position) => position.key)
      : user.projectPositions.find((project) => project.projectId === projectId)?.keys ?? []
  );
  return positions
    .filter(
      (position) =>
        !assigned.has(position.key) && !(scope === "project" && position.key === "super_admin")
    )
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key, "zh-CN"))
    .map((position) => ({ label: position.name, value: position.key }));
}

export function buildOrganizationRoleAdditionTarget(
  user: OrganizationDirectoryUser,
  selection: OrganizationRoleAdditionSelection,
  directory: OrganizationDirectory
): OrganizationRoleAdditionTarget {
  const scope: unknown = selection.scope;
  if (scope !== "global" && scope !== "project") throw new Error("岗位范围不正确");
  const latestUser = directory.users.find((item) => item.id === user.id);
  if (!latestUser) throw new Error("人员不在最新组织目录中，请刷新后重试");
  if (latestUser.status !== "active") throw new Error("人员已停用，不能新增岗位");
  if (!selection.roleKey) throw new Error("请选择待新增岗位");
  const position = directory.positions.find((item) => item.key === selection.roleKey);
  if (!position) throw new Error("岗位不在最新固定岗位目录中，请刷新后重试");
  if (selection.scope === "global") {
    if (selection.projectId !== undefined && selection.projectId !== null) {
      throw new Error("全局岗位不得提交项目标识");
    }
    if (latestUser.globalPositions.some((item) => item.key === position.key)) {
      throw new Error("该人员已拥有此全局岗位，请刷新后重试");
    }
    return {
      operation: "add",
      userId: latestUser.id,
      scope: "global",
      roleKey: position.key
    };
  }
  if (!selection.projectId?.trim()) throw new Error("项目岗位缺少项目标识");
  const project = directory.projects.find((item) => item.id === selection.projectId);
  if (!project) throw new Error("项目不在最新治理目录中，请刷新后重试");
  if (!project.isActive) throw new Error("项目已停用，不能新增岗位");
  if (position.key === "super_admin") throw new Error("项目岗位不得新增系统管理员");
  if (
    latestUser.projectPositions
      .find((item) => item.projectId === project.id)
      ?.keys.includes(position.key)
  ) {
    throw new Error("该人员已拥有此项目岗位，请刷新后重试");
  }
  return {
    operation: "add",
    userId: latestUser.id,
    scope: "project",
    projectId: project.id,
    roleKey: position.key
  };
}

export function roleAdditionTargetMatchesPreview(
  target: OrganizationRoleAdditionTarget,
  preview: RoleAdditionImpactPreview
) {
  try {
    const normalized = normalizedRoleAdditionTarget(target);
    const projectId = normalized.scope === "project" ? normalized.projectId : null;
    return (
      preview.change.operation === "add" &&
      preview.change.userId === normalized.userId &&
      preview.change.scope === normalized.scope &&
      preview.change.projectId === projectId &&
      preview.change.roleKey === normalized.roleKey
    );
  } catch {
    return false;
  }
}

export function canConfirmRoleAddition(
  target: OrganizationRoleAdditionTarget | null,
  preview: RoleAdditionImpactPreview | null,
  stale: boolean
) {
  return Boolean(
    target && preview && !stale && preview.canApply && roleAdditionTargetMatchesPreview(target, preview)
  );
}

export function buildRoleAdditionApplyPayload(
  target: OrganizationRoleAdditionTarget,
  preview: RoleAdditionImpactPreview,
  confirmationPassword: string
): ApplyOrganizationRoleAdditionPayload {
  const normalized = normalizedRoleAdditionTarget(target);
  if (!roleAdditionTargetMatchesPreview(normalized, preview)) {
    throw new Error("岗位目标与影响预览不一致，请重新预览");
  }
  if (!preview.canApply) throw new Error("最新影响预览存在阻断，不能新增该岗位");
  if (!/^sha256:[0-9a-f]{64}$/u.test(preview.snapshotHash)) {
    throw new Error("影响版本校验码无效，请重新预览");
  }
  return {
    ...normalized,
    snapshotHash: preview.snapshotHash,
    confirmationPassword: requiredPassword(confirmationPassword)
  };
}

function roleAdditionResolutionText(
  resolution: RoleAdditionResolution,
  positions: OrganizationDirectory["positions"]
) {
  if (!resolution.channel && !resolution.roleKey && !resolution.canReview) return "不可办理";
  const channel =
    resolution.channel === "direct"
      ? "直接岗位"
      : resolution.channel === "assignment"
        ? "节点指派"
        : resolution.channel === "delegation"
          ? "常驻委托"
          : "办理通道未读取";
  const roleName = resolution.roleKey
    ? roleNameByKey(resolution.roleKey, positions)
    : "岗位未读取";
  return [
    channel,
    roleName,
    resolution.canReview ? "可办理" : "不可办理",
    ...(resolution.requiresSelfReviewConfirmation ? ["需自审确认"] : [])
  ].join(" · ");
}

export function roleAdditionReasonLabel(reasonCode: string | null) {
  if (!reasonCode) return "无阻断";
  return ROLE_ADDITION_REASON_LABELS[reasonCode as RoleAdditionImpactReasonCode] ?? "阻断原因未读取";
}

export function roleAdditionImpactRows(
  impacts: RoleAdditionImpactPreview["impacts"],
  positions: OrganizationDirectory["positions"]
): RoleAdditionImpactRow[] {
  return impacts.map((impact) => ({
    key: `${impact.approvalInstanceId}:${impact.nodeIndex}`,
    businessTypeLabel: roleRemovalBusinessTypeLabel(impact.businessType),
    businessId: impact.businessId,
    projectId: impact.projectId ?? "项目未读取",
    nodeName: impact.nodeName ?? "审批节点未读取",
    modeLabel:
      impact.mode === "any" ? "任一人通过" : impact.mode === "all" ? "全部通过" : "审批方式未读取",
    pendingRoleNames:
      impact.pendingRoleKeys.map((roleKey) => roleNameByKey(roleKey, positions)).join("、") ||
      "无待审岗位",
    beforeText: roleAdditionResolutionText(impact.targetBefore, positions),
    afterText: roleAdditionResolutionText(impact.targetAfter, positions),
    statusLabel: impact.blocking ? "新增后阻断" : "新增后可继续执行",
    statusTone: impact.blocking ? "danger" : "success",
    reasonLabel: roleAdditionReasonLabel(impact.reasonCode)
  }));
}

export function buildOrganizationRoleRemovalTargets(
  user: OrganizationDirectoryUser,
  positions: ReadonlyArray<{ id?: string; key: string; name: string }>
): OrganizationRoleRemovalTargetRow[] {
  const globalTargets = user.globalPositions.map((position) => ({
    key: `global:${user.id}:${position.key}`,
    operation: "remove" as const,
    userId: user.id,
    scope: "global" as const,
    roleKey: position.key,
    scopeLabel: "全局岗位",
    projectLabel: "全公司",
    roleName: roleNameByKey(position.key, positions)
  }));
  const projectTargets = user.projectPositions.flatMap((project) =>
    project.keys.map((roleKey) => ({
      key: `project:${user.id}:${project.projectId}:${roleKey}`,
      operation: "remove" as const,
      userId: user.id,
      scope: "project" as const,
      projectId: project.projectId,
      roleKey,
      scopeLabel: "项目岗位",
      projectLabel: `${project.projectName}（${project.projectCode}）`,
      roleName: roleNameByKey(roleKey, positions)
    }))
  );
  return sortOrganizationRoleRemovalTargets([...globalTargets, ...projectTargets]);
}

function sortOrganizationRoleRemovalTargets(targets: OrganizationRoleRemovalTargetRow[]) {
  return targets.sort((left, right) =>
    [left.scope, left.projectLabel, left.roleKey, left.key]
      .join("\u0000")
      .localeCompare(
        [right.scope, right.projectLabel, right.roleKey, right.key].join("\u0000"),
        "zh-CN"
      )
  );
}

export function isProjectSuperAdminRemediationIssue(issue: PermissionIntegrityIssue) {
  return (
    issue.code === "project_super_admin" &&
    issue.source === "project_member" &&
    Boolean(issue.userId?.trim()) &&
    Boolean(issue.projectId?.trim()) &&
    issue.roleKey === "super_admin"
  );
}

export function buildProjectSuperAdminRemediationTarget(
  issue: PermissionIntegrityIssue,
  user: OrganizationDirectoryUser | null,
  positions: ReadonlyArray<{ id?: string; key: string; name: string }>
): OrganizationRoleRemovalTargetRow | null {
  if (!isProjectSuperAdminRemediationIssue(issue) || !user || user.id !== issue.userId) {
    return null;
  }
  const projectId = issue.projectId as string;
  const project = user.projectPositions.find((item) => item.projectId === projectId);
  return {
    key: `project:${user.id}:${projectId}:super_admin`,
    operation: "remove",
    userId: user.id,
    scope: "project",
    projectId,
    roleKey: "super_admin",
    scopeLabel: "项目岗位",
    projectLabel: project
      ? `${project.projectName}（${project.projectCode}）`
      : `项目ID：${projectId}`,
    roleName: roleNameByKey("super_admin", positions)
  };
}

export function mergeOrganizationRoleRemovalTargets(
  targets: readonly OrganizationRoleRemovalTargetRow[],
  remediationTarget: OrganizationRoleRemovalTargetRow | null | undefined
) {
  const merged = new Map(targets.map((target) => [target.key, target]));
  if (remediationTarget) merged.set(remediationTarget.key, remediationTarget);
  return sortOrganizationRoleRemovalTargets([...merged.values()]);
}

export function roleRemovalTargetMatchesPreview(
  target: OrganizationRoleRemovalTarget,
  preview: RoleRemovalImpactPreview
) {
  if (target.scope === "global" && target.projectId !== undefined && target.projectId !== null) {
    return false;
  }
  const projectId = target.scope === "project" ? target.projectId ?? null : null;
  return (
    preview.change.operation === "remove" &&
    preview.change.userId === target.userId &&
    preview.change.scope === target.scope &&
    preview.change.projectId === projectId &&
    preview.change.roleKey === target.roleKey
  );
}

export function canConfirmRoleRemoval(
  target: OrganizationRoleRemovalTarget | null,
  preview: RoleRemovalImpactPreview | null,
  stale: boolean
) {
  return Boolean(
    target && preview && !stale && preview.canApply && roleRemovalTargetMatchesPreview(target, preview)
  );
}

export function buildRoleRemovalApplyPayload(
  target: OrganizationRoleRemovalTarget,
  preview: RoleRemovalImpactPreview,
  confirmationPassword: string
): ApplyOrganizationRoleRemovalPayload {
  const normalizedTarget = normalizedRoleRemovalTarget(target);
  if (!roleRemovalTargetMatchesPreview(normalizedTarget, preview)) {
    throw new Error("岗位目标与影响预览不一致，请重新预览");
  }
  if (!preview.canApply) throw new Error("最新影响预览存在阻断，不能撤销该岗位");
  if (!/^sha256:[0-9a-f]{64}$/u.test(preview.snapshotHash)) {
    throw new Error("影响版本校验码无效，请重新预览");
  }
  return {
    ...normalizedTarget,
    snapshotHash: preview.snapshotHash,
    confirmationPassword: requiredPassword(confirmationPassword)
  };
}

export function roleRemovalBusinessTypeLabel(businessType: string) {
  return ROLE_REMOVAL_BUSINESS_TYPE_LABELS[businessType] ?? "业务类型未读取";
}

export function roleRemovalReasonLabel(reasonCode: string | null) {
  if (!reasonCode) return "无阻断";
  return ROLE_REMOVAL_REASON_LABELS[reasonCode as RoleRemovalImpactReasonCode] ?? "阻断原因未读取";
}

export function roleRemovalImpactRows(
  impacts: RoleRemovalImpactPreview["impacts"],
  positions: ReadonlyArray<{ id?: string; key: string; name: string }>
): RoleRemovalImpactRow[] {
  return impacts.map((impact) => ({
    key: impact.approvalInstanceId,
    businessTypeLabel: roleRemovalBusinessTypeLabel(impact.businessType),
    businessId: impact.businessId,
    projectId: impact.projectId ?? "项目未读取",
    currentNodeName: impact.currentNodeName ?? "当前审批节点未读取",
    modeLabel: impact.mode === "any" ? "任一人通过" : impact.mode === "all" ? "全部通过" : "审批方式未读取",
    pendingRoleNames:
      impact.pendingRoleKeys.map((roleKey) => roleNameByKey(roleKey, positions)).join("、") ||
      "无待审岗位",
    statusLabel: impact.blocking ? "撤销后阻断" : "可继续执行",
    statusTone: impact.blocking ? "danger" : "success",
    reasonLabel: roleRemovalReasonLabel(impact.reasonCode)
  }));
}

export function buildCreateDepartmentPayload(
  value: DepartmentFormValue
): CreateOrganizationDepartmentPayload {
  return {
    name: normalizedDepartmentName(value.name),
    ...(value.parentId !== undefined ? { parentId: value.parentId } : {}),
    confirmationPassword: requiredPassword(value.confirmationPassword)
  };
}

export function buildDepartmentPatch(
  before: DepartmentSnapshot,
  value: DepartmentFormValue,
  confirmationPassword: string
): UpdateOrganizationDepartmentPayload {
  const patch: Omit<UpdateOrganizationDepartmentPayload, "confirmationPassword"> = {};
  const name = normalizedDepartmentName(value.name);
  if (name !== before.name) patch.name = name;
  if (value.parentId !== undefined && value.parentId !== before.parentId) patch.parentId = value.parentId;
  if (value.isActive !== undefined && value.isActive !== before.isActive) patch.isActive = value.isActive;
  if (Object.keys(patch).length === 0) throw new Error("没有可保存的部门变更");
  return { ...patch, confirmationPassword: requiredPassword(confirmationPassword) };
}

export function buildUserPatch(
  before: OrganizationUserSnapshot,
  value: OrganizationUserFormValue,
  confirmationPassword: string
): UpdateOrganizationUserPayload {
  const patch: Omit<UpdateOrganizationUserPayload, "confirmationPassword"> = {};
  if (value.departmentId !== undefined && value.departmentId !== before.departmentId) {
    patch.departmentId = value.departmentId;
  }
  if (value.isActive !== before.isActive) patch.isActive = value.isActive;
  if (Object.keys(patch).length === 0) throw new Error("没有可保存的人员变更");
  return { ...patch, confirmationPassword: requiredPassword(confirmationPassword) };
}

export function organizationActionConsequence(kind: OrganizationActionKind, isActive = true) {
  if (kind === "create_department") {
    return "创建部门后可作为人员归属和下级部门的上级节点。";
  }
  if (kind === "update_department" && !isActive) {
    return "停用前必须先处理该部门的启用人员和启用下级部门；历史组织记录仍会保留。";
  }
  if (kind === "update_user" && !isActive) {
    return "停用人员会立即阻止登录和办理业务，同时保留历史记录和岗位信息。";
  }
  return kind === "update_department"
    ? "部门名称、上级或状态变更将影响组织目录展示。"
    : "人员部门归属或状态变更将在保存后生效。";
}

export function permissionIntegrityIssueLabel(code: string) {
  return PERMISSION_INTEGRITY_ISSUE_LABELS[code] ?? `未知问题（${code || "—"}）`;
}

export function permissionIntegritySourceLabel(source: string) {
  return PERMISSION_INTEGRITY_SOURCE_LABELS[source] ?? `未知来源（${source || "—"}）`;
}

export function permissionIntegrityPolicyText(policy: PermissionIntegrityReadModel["policy"]) {
  const legacyText = policy.legacyProjectUserPositionReadCompatibility
    ? "项目级 UserPosition 仅兼容读取"
    : "项目级 UserPosition 不兼容读取";
  const superAdminText = policy.projectSuperAdminAllowed
    ? "项目范围允许 super_admin"
    : "项目范围不允许 super_admin";
  return `全局规范源：${policy.globalWriteSource}；项目规范源：${policy.projectWriteSource}；${legacyText}；${superAdminText}。`;
}

export function permissionIntegrityReadinessTag(
  kind: "canonical" | "migration",
  readiness: PermissionIntegrityReadModel["readiness"]
): { label: string; tone: "success" | "danger" } {
  const ready =
    kind === "canonical" ? readiness.canonicalRoleWritesReady : readiness.legacyMigrationReady;
  return {
    label:
      kind === "canonical"
        ? `规范岗位写入${ready ? "已" : "未"}就绪`
        : `遗留迁移${ready ? "已" : "未"}就绪`,
    tone: ready ? "success" : "danger"
  };
}

export function permissionIntegritySummaryItems(
  summary: PermissionIntegrityReadModel["summary"]
): BusinessStatusSummaryItem[] {
  return [
    { label: "阻断项", value: String(summary.blockingIssues), tone: "danger" },
    { label: "警告项", value: String(summary.warningIssues), tone: "warning" },
    { label: "遗留项目岗位", value: String(summary.legacyProjectAssignments), tone: "warning" },
    { label: "双源重叠", value: String(summary.dualSourceOverlaps), tone: "danger" }
  ];
}

export function permissionIntegrityIssueRows(
  issues: readonly PermissionIntegrityIssue[]
): PermissionIntegrityIssueRow[] {
  return issues.map((issue) => {
    const assignmentIds = issue.assignmentIds.length ? issue.assignmentIds.join("、") : "—";
    return {
      key: permissionIntegrityIssueKey(issue),
      severityLabel: issue.severity === "blocking" ? "阻断" : "警告",
      severityTone: issue.severity === "blocking" ? "danger" : "warning",
      issueLabel: permissionIntegrityIssueLabel(issue.code),
      message: issue.message,
      sourceLabel: permissionIntegritySourceLabel(issue.source),
      userId: issue.userId || "—",
      projectId: issue.projectId || "—",
      roleKey: issue.roleKey || "—",
      assignmentIds
    };
  });
}

export function permissionIntegrityIssueKey(issue: PermissionIntegrityIssue) {
  return `${issue.code}:${issue.source}:${issue.assignmentIds.length ? issue.assignmentIds.join(",") : "—"}`;
}
