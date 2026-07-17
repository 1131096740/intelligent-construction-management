import {
  COMPANY_ENTITY_MAINTAINER_ROLES,
  COMPANY_ENTITY_READER_ROLES,
  type CompanyEntityDataStatus,
  type RoleKey
} from "@jiangkong/shared-domain";

export const companyEntityMaintainerRoleKeys = COMPANY_ENTITY_MAINTAINER_ROLES;
export const companyEntityReaderRoleKeys = COMPANY_ENTITY_READER_ROLES;

export const companyEntityWritableFields = [
  "name",
  "unifiedSocialCreditCode",
  "registeredAddress"
] as const;

export function companyEntityCapabilities(globalRoleKeys: readonly RoleKey[]) {
  return {
    canRead: companyEntityReaderRoleKeys.some((role) => globalRoleKeys.includes(role)),
    canMaintain: companyEntityMaintainerRoleKeys.some((role) => globalRoleKeys.includes(role))
  };
}

const ACTION_LABELS: Record<string, string> = {
  create: "新增",
  update: "修改",
  enable: "启用",
  disable: "停用",
  legacy_backfill: "历史资料建档"
};

const ROLE_LABELS: Partial<Record<RoleKey, string>> = {
  comprehensive_director: "综合部主管",
  contract_staff: "合同部成员",
  contract_director: "合同部主管",
  finance_staff: "财务人员",
  finance_director: "财务主管",
  chairman: "董事长",
  general_manager: "总经理"
};

export function companyEntityActionLabel(action: string) {
  return ACTION_LABELS[action] ?? "资料变更";
}

export function companyEntityRoleLabel(roleKey: RoleKey | string | null) {
  return roleKey ? ROLE_LABELS[roleKey as RoleKey] ?? "已留痕公司岗位" : "历史记录";
}

export function companyEntityDataStatusLabel(status: CompanyEntityDataStatus) {
  return status === "complete" ? "资料完整" : "资料待补全";
}

export interface CompanyEntityComparableFacts {
  name: string;
  unifiedSocialCreditCode: string | null;
  registeredAddress: string | null;
  isActive: boolean;
}

export interface CompanyEntityFieldChange {
  label: string;
  before: string;
  after: string;
}

export function companyEntityFieldChanges(
  current: CompanyEntityComparableFacts,
  previous?: CompanyEntityComparableFacts
): CompanyEntityFieldChange[] {
  if (!previous) return [];
  const fields = [
    { label: "公司全称", current: current.name, previous: previous.name },
    {
      label: "统一社会信用代码",
      current: current.unifiedSocialCreditCode || "未填写",
      previous: previous.unifiedSocialCreditCode || "未填写"
    },
    {
      label: "注册地址",
      current: current.registeredAddress || "未填写",
      previous: previous.registeredAddress || "未填写"
    },
    {
      label: "启停状态",
      current: current.isActive ? "启用" : "停用",
      previous: previous.isActive ? "启用" : "停用"
    }
  ];
  return fields
    .filter((field) => field.current !== field.previous)
    .map((field) => ({ label: field.label, before: field.previous, after: field.current }));
}
