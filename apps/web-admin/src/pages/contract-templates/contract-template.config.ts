import type {
  ContractTemplateDetailReadModel,
  ContractTemplateSchemaPayload,
  ContractTemplateVersionReadModel,
  ContractTemplateVersionStatus,
  ContractTemplateUsagePreview,
  PublishedContractTemplateReadModel
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

const usagePreviewKeys = new Set(["fields", "bills", "clauses", "attachments", "validations"]);
const usageFieldKeys = new Set(["label", "type", "required", "group", "conditional"]);
const usageBillKeys = new Set(["name", "amountRole", "pricingMode", "columns"]);
const usageBillColumnKeys = new Set(["label", "type", "required"]);
const usageClauseKeys = new Set(["title", "required"]);
const usageAttachmentKeys = new Set(["name", "required", "mustBeValid"]);
const usageValidationKeys = new Set(["level", "message"]);
const usageFieldTypes = new Set<string>(fieldTypeOptions.map((option) => option.value));
const usageBillColumnTypes = new Set<string>(["text", "number", "boolean"]);
const usageBillAmountRoles = new Set<string>(billAmountRoleOptions.map((option) => option.value));
const usagePricingModes = new Set<string>(pricingModeOptions.map((option) => option.value));
const usageValidationLevels = new Set<string>(["block", "warning"]);

function assertUsagePreviewKeys(value: Record<string, unknown>, allowed: Set<string>) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("模板结构预览包含未允许的数据，请刷新后重试");
  }
}

function normalizeUsagePreview(value: unknown): ContractTemplateUsagePreview {
  if (!isRecord(value)) {
    throw new Error("模板结构预览数据不完整，请刷新后重试");
  }
  assertUsagePreviewKeys(value, usagePreviewKeys);
  if (
    !Array.isArray(value.fields) ||
    !Array.isArray(value.bills) ||
    !Array.isArray(value.clauses) ||
    !Array.isArray(value.attachments) ||
    !Array.isArray(value.validations)
  ) {
    throw new Error("模板结构预览数据不完整，请刷新后重试");
  }

  for (const field of value.fields) {
    if (!isRecord(field)) throw new Error("模板结构预览数据不完整，请刷新后重试");
    assertUsagePreviewKeys(field, usageFieldKeys);
    if (
      !hasText(field.label) ||
      !usageFieldTypes.has(String(field.type)) ||
      typeof field.required !== "boolean" ||
      typeof field.conditional !== "boolean" ||
      (field.group !== undefined && !hasText(field.group))
    ) {
      throw new Error("模板结构预览数据不完整，请刷新后重试");
    }
  }

  for (const bill of value.bills) {
    if (!isRecord(bill)) throw new Error("模板结构预览数据不完整，请刷新后重试");
    assertUsagePreviewKeys(bill, usageBillKeys);
    if (
      !hasText(bill.name) ||
      !usageBillAmountRoles.has(String(bill.amountRole)) ||
      !usagePricingModes.has(String(bill.pricingMode)) ||
      !Array.isArray(bill.columns)
    ) {
      throw new Error("模板结构预览数据不完整，请刷新后重试");
    }
    for (const column of bill.columns) {
      if (!isRecord(column)) throw new Error("模板结构预览数据不完整，请刷新后重试");
      assertUsagePreviewKeys(column, usageBillColumnKeys);
      if (
        !hasText(column.label) ||
        !usageBillColumnTypes.has(String(column.type)) ||
        typeof column.required !== "boolean"
      ) {
        throw new Error("模板结构预览数据不完整，请刷新后重试");
      }
    }
  }

  for (const clause of value.clauses) {
    if (!isRecord(clause)) throw new Error("模板结构预览数据不完整，请刷新后重试");
    assertUsagePreviewKeys(clause, usageClauseKeys);
    if (!hasText(clause.title) || typeof clause.required !== "boolean") {
      throw new Error("模板结构预览数据不完整，请刷新后重试");
    }
  }

  for (const attachment of value.attachments) {
    if (!isRecord(attachment)) throw new Error("模板结构预览数据不完整，请刷新后重试");
    assertUsagePreviewKeys(attachment, usageAttachmentKeys);
    if (
      !hasText(attachment.name) ||
      typeof attachment.required !== "boolean" ||
      typeof attachment.mustBeValid !== "boolean"
    ) {
      throw new Error("模板结构预览数据不完整，请刷新后重试");
    }
  }

  for (const validation of value.validations) {
    if (!isRecord(validation)) throw new Error("模板结构预览数据不完整，请刷新后重试");
    assertUsagePreviewKeys(validation, usageValidationKeys);
    if (
      !usageValidationLevels.has(String(validation.level)) ||
      !hasText(validation.message)
    ) {
      throw new Error("模板结构预览数据不完整，请刷新后重试");
    }
  }

  return value as unknown as ContractTemplateUsagePreview;
}

export function normalizePublishedContractTemplates(
  value: unknown,
  expectedContractTypeKey?: string
): PublishedContractTemplateReadModel[] {
  if (!Array.isArray(value)) {
    throw new Error("模板发布列表数据不完整，请刷新后重试");
  }
  const seenTemplateIds = new Set<string>();
  const seenVersionIds = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !hasText(item.id) ||
      !hasText(item.name) ||
      item.status !== "published" ||
      !hasText(item.contractTypeKey) ||
      !hasText(item.versionId) ||
      !Number.isInteger(item.versionNo) ||
      Number(item.versionNo) < 1
    ) {
      if (isRecord(item) && item.status !== "published") {
        throw new Error("模板发布状态不正确，请刷新后重试");
      }
      throw new Error("模板发布版本数据不完整，请刷新后重试");
    }
    if (expectedContractTypeKey && item.contractTypeKey !== expectedContractTypeKey) {
      throw new Error("模板合同类型与当前选择不一致，请重新选择");
    }
    if (seenTemplateIds.has(item.id) || seenVersionIds.has(item.versionId)) {
      throw new Error("模板发布版本数据重复，请刷新后重试");
    }
    seenTemplateIds.add(item.id);
    seenVersionIds.add(item.versionId);
    return {
      id: item.id,
      ...(hasText(item.code) ? { code: item.code } : {}),
      name: item.name,
      status: "published",
      contractTypeKey: item.contractTypeKey,
      versionId: item.versionId,
      versionNo: Number(item.versionNo),
      usagePreview: normalizeUsagePreview(item.usagePreview)
    };
  });
}

export function publishedTemplateForSelection(
  templates: PublishedContractTemplateReadModel[],
  versionId: string,
  contractTypeKey: string
) {
  return templates.find(
    (template) =>
      template.versionId === versionId && template.contractTypeKey === contractTypeKey
  ) ?? null;
}

export function mergeContractTemplateSchemaForSave(
  original: ContractTemplateSchemaPayload,
  edited: ContractTemplateSchemaPayload
): ContractTemplateSchemaPayload {
  return {
    fields: mergeSchemaItems(original.fields, edited.fields, (originalItem, editedItem) => {
      const merged = { ...originalItem, ...editedItem };
      if (!Object.hasOwn(editedItem, "visibleWhen")) return merged;
      const originalVisibleWhen = isRecord(originalItem.visibleWhen)
        ? originalItem.visibleWhen
        : null;
      const editedVisibleWhen = isRecord(editedItem.visibleWhen)
        ? editedItem.visibleWhen
        : null;
      if (!editedVisibleWhen) return { ...merged, visibleWhen: editedItem.visibleWhen };
      return {
        ...merged,
        visibleWhen: {
          ...originalVisibleWhen,
          ...editedVisibleWhen,
          ...(originalVisibleWhen?.operator === "eq" || originalVisibleWhen?.operator === "neq"
            ? { operator: originalVisibleWhen.operator }
            : {})
        }
      };
    }),
    bills: mergeSchemaItems(original.bills, edited.bills, (originalItem, editedItem) => ({
      ...originalItem,
      ...editedItem,
      ...(Array.isArray(editedItem.columns)
        ? {
            columns: mergeSchemaItems(
              Array.isArray(originalItem.columns) ? originalItem.columns : [],
              editedItem.columns
            )
          }
        : {})
    })),
    clauses: mergeSchemaItems(original.clauses, edited.clauses, (originalItem, editedItem) => ({
      ...originalItem,
      ...editedItem,
      ...(isRecord(editedItem.content)
        ? {
            content: {
              ...(isRecord(originalItem.content) ? originalItem.content : {}),
              ...editedItem.content
            }
          }
        : {})
    })),
    attachments: mergeSchemaItems(original.attachments, edited.attachments),
    validations: mergeSchemaItems(original.validations, edited.validations)
  };
}

function mergeSchemaItems(
  originalItems: unknown[],
  editedItems: unknown[],
  merge: (
    originalItem: Record<string, unknown>,
    editedItem: Record<string, unknown>
  ) => Record<string, unknown> = (originalItem, editedItem) => ({
    ...originalItem,
    ...editedItem
  })
) {
  const originalByKey = new Map(
    originalItems
      .filter(isRecord)
      .filter((item) => hasText(item.key))
      .map((item) => [item.key, item] as const)
  );
  return editedItems.map((editedItem) => {
    if (!isRecord(editedItem) || !hasText(editedItem.key)) return editedItem;
    const originalItem = originalByKey.get(editedItem.key);
    return originalItem ? merge(originalItem, editedItem) : editedItem;
  });
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
  draftRevision?: number | null;
  inspectionRevision?: number | null;
  inspectionReport?: { blockingErrors?: unknown[] } | null;
  latestPreview?: {
    status?: string | null;
    sourceRevision?: number | null;
    previewPdfFileId?: string | null;
  } | null;
}

export function canPublishLayoutVersion(input: LayoutPublishGateInput) {
  return Boolean(
    input.inspectionReport &&
      input.inspectionRevision === input.draftRevision &&
      (input.inspectionReport.blockingErrors?.length ?? 0) === 0 &&
      input.latestPreview?.status === "succeeded" &&
      input.latestPreview.sourceRevision === input.draftRevision &&
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
