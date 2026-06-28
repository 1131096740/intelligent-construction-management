export const templateListColumns = [
  { colKey: "status", title: "状态" },
  { colKey: "contractTypeKey", title: "类型" },
  { colKey: "latestVersion", title: "最新版本" },
  { colKey: "publishedBy", title: "发布人" },
  { colKey: "operation", title: "操作" }
] as const;

export const templateListActions = ["open", "clone", "submit", "publish", "stop", "revoke"] as const;

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
export const unitPriceScaleOptions = [2, 3, 4, 5, 6] as const;

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

export function hasOnlyAllowedNumberRuleTokens(pattern: string) {
  const allowed = new Set<string>(numberRuleTokens);
  return [...pattern.matchAll(/\{[^{}]+\}/g)].every((match) => allowed.has(match[0]));
}

export function previewContractNumber(pattern: string, sequence: number, width: number) {
  const values: Record<string, string> = {
    "{company}": "GS",
    "{project}": "XM",
    "{year}": String(new Date().getFullYear()),
    "{type}": "HT",
    "{sequence}": String(sequence).padStart(width, "0")
  };
  return numberRuleTokens.reduce((text, token) => text.split(token).join(values[token]), pattern);
}
