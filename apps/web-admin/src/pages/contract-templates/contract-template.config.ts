export const templateListColumns = [
  { colKey: "name", title: "模板名称" },
  { colKey: "contractTypeKey", title: "类型" },
  { colKey: "status", title: "状态" },
  { colKey: "latestVersion", title: "最新版本" },
  { colKey: "publicationStatus", title: "发布状态" },
  { colKey: "operation", title: "操作" }
] as const;

export const templateListActions = ["open", "clone", "submit", "publish", "stop", "revoke"] as const;

export const contractTypeOptions = [
  { label: "材料采购合同", value: "material_purchase" },
  { label: "工程机械设备租赁合同", value: "equipment_rental" },
  { label: "劳务分包合同", value: "labor_subcontract" },
  { label: "专业分包合同", value: "professional_subcontract" },
  { label: "通用合同", value: "generic_contract" }
] as const;

export const fieldTypeOptions = [
  { label: "文本", value: "text" },
  { label: "长文本", value: "long_text" },
  { label: "数字", value: "number" },
  { label: "金额", value: "money" },
  { label: "日期", value: "date" },
  { label: "单选", value: "single_select" },
  { label: "多选", value: "multi_select" },
  { label: "是/否", value: "boolean" }
] as const;

export const quantityScaleOptions = [0, 1, 2, 3, 4, 5, 6] as const;
export const unitPriceScaleOptions = [2] as const;

export const billAmountRoleOptions = [
  { label: "计入合同金额", value: "included" },
  { label: "参考金额", value: "reference" },
  { label: "不计价", value: "non_priced" },
  { label: "暂列金额", value: "provisional" }
] as const;

export const pricingModeOptions = [
  { label: "含税单价", value: "tax_inclusive" },
  { label: "不含税单价", value: "tax_exclusive" }
] as const;

export const businessTemplateVersionActionsByStatus = {
  draft: ["edit", "submit"],
  submitted: ["publish", "revoke"],
  published: ["clone", "stop", "revoke"],
  stopped: ["clone"],
  revoked: []
} as const;

export interface LayoutPublishGateInput {
  inspectionReport?: { blockingErrors?: unknown[] } | null;
  latestPreview?: { status?: string | null; previewPdfFileId?: string | null } | null;
}

export function canPublishLayoutVersion(input: LayoutPublishGateInput) {
  return Boolean(
    input.inspectionReport &&
      (input.inspectionReport.blockingErrors?.length ?? 0) === 0 &&
      input.latestPreview?.status === "succeeded" &&
      input.latestPreview.previewPdfFileId
  );
}

export const businessPartyEditPolicy = {
  mode: "append_version",
  label: "创建新版本，不覆盖历史版本"
} as const;

export const numberRuleTokens = ["{company}", "{project}", "{year}", "{type}", "{sequence}"] as const;
export const numberRuleTokenOptions = [
  { label: "公司", value: "{公司}", internalValue: "{company}" },
  { label: "项目", value: "{项目}", internalValue: "{project}" },
  { label: "年份", value: "{年份}", internalValue: "{year}" },
  { label: "类型", value: "{类型}", internalValue: "{type}" },
  { label: "流水号", value: "{流水号}", internalValue: "{sequence}" }
] as const;

const numberRuleTokenToInternal = Object.fromEntries(
  numberRuleTokenOptions.map((option) => [option.value, option.internalValue])
) as Record<string, (typeof numberRuleTokens)[number]>;
const numberRuleTokenToChinese = Object.fromEntries(
  numberRuleTokenOptions.map((option) => [option.internalValue, option.value])
) as Record<(typeof numberRuleTokens)[number], string>;

export function normalizeContractNumberPattern(pattern: string) {
  return Object.entries(numberRuleTokenToInternal).reduce(
    (text, [token, internalToken]) => text.split(token).join(internalToken),
    pattern
  );
}

export function displayContractNumberPattern(pattern: string) {
  return numberRuleTokens.reduce(
    (text, token) => text.split(token).join(numberRuleTokenToChinese[token]),
    pattern
  );
}

export function hasOnlyAllowedNumberRuleTokens(pattern: string) {
  const allowed = new Set<string>(numberRuleTokens);
  const normalized = normalizeContractNumberPattern(pattern);
  return [...normalized.matchAll(/\{[^{}]+\}/g)].every((match) => allowed.has(match[0]));
}

export function isValidContractNumberPattern(pattern: string) {
  const normalized = normalizeContractNumberPattern(pattern);
  return hasOnlyAllowedNumberRuleTokens(normalized) && normalized.includes("{sequence}");
}

export function previewContractNumber(pattern: string, sequence: number, width: number) {
  const normalized = normalizeContractNumberPattern(pattern);
  const values: Record<string, string> = {
    "{company}": "公司",
    "{project}": "项目",
    "{year}": String(new Date().getFullYear()),
    "{type}": "材料",
    "{sequence}": String(sequence).padStart(width, "0")
  };
  return numberRuleTokens.reduce((text, token) => text.split(token).join(values[token]), normalized);
}
