export const CONTRACT_INVOICE_TYPES = ["vat_general", "vat_special"] as const;
export type ContractInvoiceType = (typeof CONTRACT_INVOICE_TYPES)[number];

export const CONTRACT_TAX_MODES = ["single_rate", "multiple_rate"] as const;
export type ContractTaxMode = (typeof CONTRACT_TAX_MODES)[number];

export const CONTRACT_TAX_FACT_STATUSES = [
  "unconfirmed",
  "draft",
  "frozen",
  "pending_finance_review",
  "pending_contract_confirmation",
  "confirmed"
] as const;
export type ContractTaxFactStatus = (typeof CONTRACT_TAX_FACT_STATUSES)[number];

export const CONTRACT_TAX_FACT_SOURCES = [
  "contract_document",
  "supplement_evidence",
  "business_finance_confirmation"
] as const;
export type ContractTaxFactSource = (typeof CONTRACT_TAX_FACT_SOURCES)[number];

const CONTRACT_INVOICE_TYPE_LABELS: Record<ContractInvoiceType, string> = {
  vat_general: "增值税普通发票",
  vat_special: "增值税专用发票"
};

const CONTRACT_TAX_MODE_LABELS: Record<ContractTaxMode, string> = {
  single_rate: "单一税率",
  multiple_rate: "特殊多税率"
};

const CONTRACT_TAX_FACT_STATUS_LABELS: Record<ContractTaxFactStatus, string> = {
  unconfirmed: "未明确",
  draft: "草稿",
  frozen: "随审批冻结",
  pending_finance_review: "待财务复核",
  pending_contract_confirmation: "待合同部确认",
  confirmed: "已确认"
};

const CONTRACT_TAX_FACT_SOURCE_LABELS: Record<ContractTaxFactSource, string> = {
  contract_document: "合同文件明确",
  supplement_evidence: "依据补充资料确认",
  business_finance_confirmation: "经业务与财务复核确认"
};

export function contractInvoiceTypeLabel(value: ContractInvoiceType): string {
  return CONTRACT_INVOICE_TYPE_LABELS[value];
}

export function contractTaxModeLabel(value: ContractTaxMode): string {
  return CONTRACT_TAX_MODE_LABELS[value];
}

export function contractTaxFactStatusLabel(value: ContractTaxFactStatus): string {
  return CONTRACT_TAX_FACT_STATUS_LABELS[value];
}

export function contractTaxFactSourceLabel(value: ContractTaxFactSource): string {
  return CONTRACT_TAX_FACT_SOURCE_LABELS[value];
}

const TAX_RATE_TEXT = /^(?:0|[1-9]\d{0,2})(?:\.(\d{1,3}))?$/u;

export function normalizeTaxRatePercent(value: string): string {
  const text = value.trim();
  const decimalPart = text.includes(".") ? text.split(".")[1] ?? "" : "";
  if (decimalPart.length > 3) {
    throw new Error("税率最多保留 3 位小数");
  }
  if (text.startsWith("-")) {
    throw new Error("税率必须大于 0");
  }

  const match = TAX_RATE_TEXT.exec(text);
  if (!match) {
    throw new Error("税率必须是 0 到 100 之间且最多 3 位小数的数字");
  }

  const [whole] = text.split(".");
  if (whole === "0" && !/[1-9]/u.test(match[1] ?? "")) {
    throw new Error("税率必须大于 0");
  }
  if (
    BigInt(whole) > 100n ||
    (whole === "100" && /[1-9]/u.test(match[1] ?? ""))
  ) {
    throw new Error("税率不能超过 100");
  }

  return text
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}
