import type {
  CreateOrganizationDepartmentPayload,
  OrganizationDepartmentNode,
  OrganizationDirectoryUser,
  UpdateOrganizationDepartmentPayload,
  UpdateOrganizationUserPayload
} from "../../api/organization.api";

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
