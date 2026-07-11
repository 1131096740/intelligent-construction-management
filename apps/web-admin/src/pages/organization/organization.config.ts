import type {
  CreateOrganizationDepartmentPayload,
  OrganizationDepartmentNode,
  OrganizationDirectoryUser,
  PermissionIntegrityIssue,
  PermissionIntegrityReadModel,
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

function codePointLength(value: string) {
  return Array.from(value).length;
}

function requiredPassword(value: string | undefined) {
  if (!value?.trim()) throw new Error("请输入当前登录密码");
  if (codePointLength(value) > 256) throw new Error("当前登录密码不能超过 256 个字符");
  return value;
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
      key: `${issue.code}:${issue.source}:${issue.assignmentIds.length ? issue.assignmentIds.join(",") : "—"}`,
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
