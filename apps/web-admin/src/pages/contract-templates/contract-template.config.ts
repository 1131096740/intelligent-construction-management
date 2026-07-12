import type {
  ContractTemplateDetailReadModel,
  ContractTemplateVersionReadModel,
  ContractTemplateVersionStatus
} from "../../api/contract-workbench.api";

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

export interface NormalizedContractTemplateDetail extends ContractTemplateDetailReadModel {
  defaultVersionId: string;
}

export interface ContractTemplateVersionGovernance {
  readOnly: boolean;
  canSave: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canClone: boolean;
}

const contractTemplateVersionStatuses = new Set<ContractTemplateVersionStatus>([
  "draft",
  "submitted",
  "published",
  "stopped",
  "revoked"
]);

const contractTemplateVersionStatusLabels: Record<ContractTemplateVersionStatus, string> = {
  draft: "草稿",
  submitted: "待发布",
  published: "已发布",
  stopped: "已停用",
  revoked: "已撤销"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeTemplateVersion(
  value: unknown,
  expectedTemplateId: string
): ContractTemplateVersionReadModel {
  if (!isRecord(value)) {
    throw new Error("模板版本数据不完整，请刷新后重试");
  }
  if (!hasText(value.status) || !contractTemplateVersionStatuses.has(value.status as ContractTemplateVersionStatus)) {
    throw new Error("模板版本状态不正确，请刷新后重试");
  }
  if (
    !hasText(value.id) ||
    value.templateId !== expectedTemplateId ||
    !Number.isInteger(value.versionNo) ||
    Number(value.versionNo) < 1 ||
    !isRecord(value.schema) ||
    !Array.isArray(value.schema.fields) ||
    !Array.isArray(value.schema.bills) ||
    !Array.isArray(value.schema.clauses) ||
    !Array.isArray(value.schema.attachments) ||
    !Array.isArray(value.schema.validations) ||
    !value.schema.fields.every(isRecord) ||
    !value.schema.bills.every(isRecord) ||
    !value.schema.clauses.every(isRecord) ||
    !value.schema.attachments.every(isRecord) ||
    !value.schema.validations.every(isRecord)
  ) {
    throw new Error("模板版本数据不完整，请刷新后重试");
  }

  return value as unknown as ContractTemplateVersionReadModel;
}

export function normalizeContractTemplateDetail(value: unknown): NormalizedContractTemplateDetail {
  if (!isRecord(value) || !isRecord(value.template) || !Array.isArray(value.versions)) {
    throw new Error("模板详情数据不完整，请刷新后重试");
  }
  const template = value.template;
  if (
    !hasText(template.id) ||
    !hasText(template.code) ||
    !hasText(template.name) ||
    !hasText(template.contractTypeKey) ||
    !hasText(template.status)
  ) {
    throw new Error("模板详情数据不完整，请刷新后重试");
  }

  const versions = value.versions
    .map((version) => normalizeTemplateVersion(version, template.id as string))
    .sort((left, right) => right.versionNo - left.versionNo);
  const defaultVersion =
    versions.find((version) => version.status === "draft") ??
    versions.find((version) => version.status === "published") ??
    versions[0];
  if (!defaultVersion) {
    throw new Error("模板暂无可用版本，请刷新后重试");
  }

  return {
    template: template as unknown as ContractTemplateDetailReadModel["template"],
    versions,
    defaultVersionId: defaultVersion.id
  };
}

export function contractTemplateVersionOptions(versions: ContractTemplateVersionReadModel[]) {
  return versions.map((version) => ({
    label: `V${version.versionNo} · ${contractTemplateVersionStatusLabels[version.status]}`,
    value: version.id
  }));
}

export function contractTemplateVersionGovernance(
  version?: ContractTemplateVersionReadModel
): ContractTemplateVersionGovernance {
  return {
    readOnly: version?.status !== "draft",
    canSave: version?.status === "draft",
    canSubmit: version?.status === "draft",
    canPublish: version?.status === "submitted",
    canClone: version?.status === "published"
  };
}

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
