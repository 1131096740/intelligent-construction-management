import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "./business-entry-definition";
import type { RoleKey } from "./roles";

export const ORGANIZATION_ENTRY_MANAGER_ROLE_KEYS: readonly RoleKey[] = [
  "chairman", "general_manager", "engineering_department_director", "finance_director",
  "contract_director", "budget_director", "material_director", "comprehensive_director", "super_admin"
];

function field(key: string, label: string, type: BusinessEntryFieldDefinition["type"] = "text", options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition {
  return {
    key, label, description: `请按实际情况选择或填写${label}。`, example: type === "text" ? "按真实资料填写" : "从业务选项中选择", type,
    scope: "header", unit: "", precision: 0, required: false,
    permissions: { view: ORGANIZATION_ENTRY_MANAGER_ROLE_KEYS, edit: ORGANIZATION_ENTRY_MANAGER_ROLE_KEYS, import: ORGANIZATION_ENTRY_MANAGER_ROLE_KEYS },
    bulk: { enabled: false, strategy: "append" },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请选择或填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: label },
    ...options
  };
}
function definition(key: string, name: string, fields: BusinessEntryFieldDefinition[]): BusinessEntrySceneDefinition {
  return { key, entityType: key, name, description: `${name}填写规则`, version: 2, fields, rules: [] };
}

export const ORGANIZATION_DEPARTMENT_ENTRY_DEFINITION = definition("department", "部门", [
  field("name", "部门名称", "text", { required: true, format: { maxLength: 100 } }),
  field("parentId", "上级部门"),
  field("isActive", "是否启用", "boolean")
]);
export const ORGANIZATION_USER_ENTRY_DEFINITION = definition("organization_user", "人员账号", [
  field("name", "姓名"),
  field("phone", "手机号", "text", { format: { pattern: "^1[3-9]\\d{9}$" } }),
  field("departmentId", "所属部门"),
  field("initialRoleKey", "初始岗位"),
  field("projectId", "安排项目"),
  field("isActive", "是否启用", "boolean")
]);
export const ORGANIZATION_ROLE_ENTRY_DEFINITION = definition("user_role_assignment_command", "岗位调整", [
  field("operation", "操作", "single_select", { options: [{ value: "grant", label: "新增岗位" }, { value: "revoke", label: "撤销岗位" }] }),
  field("scope", "岗位范围", "single_select", { options: [{ value: "global", label: "全公司岗位" }, { value: "project", label: "项目岗位" }] }),
  field("projectId", "所属项目", "text", { visibleWhen: { fieldKey: "scope", operator: "eq", value: "project" } }),
  field("roleKey", "岗位")
]);

export const PROJECT_ROSTER_ENTRY_DEFINITION = definition("project_roster_change", "项目人员调整", [
  field("userId", "人员", "text", { required: true,
    permissions: { view: ["chairman", "comprehensive_director"], edit: ["chairman", "comprehensive_director"], import: [] } }),
  field("reason", "调整原因", "text", { required: true, format: { maxLength: 300 },
    permissions: { view: ["chairman", "comprehensive_director"], edit: ["chairman", "comprehensive_director"], import: [] } })
]);
