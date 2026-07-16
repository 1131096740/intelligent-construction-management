import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_MODES,
  contractInvoiceTypeLabel,
  contractTaxModeLabel,
  normalizeTaxRatePercent,
  type ContractFieldDefinition,
  type ContractInvoiceType,
  type ContractTaxMode
} from "@jiangkong/shared-domain";

export type TaxRateQuickValue = "1" | "3" | "6" | "9" | "13" | "other";

export interface ContractTaxFactsDraft {
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  rate: string;
}

export const contractInvoiceTypeOptions = CONTRACT_INVOICE_TYPES.map((value) => ({
  label: contractInvoiceTypeLabel(value),
  value
}));

export const contractTaxModeOptions = CONTRACT_TAX_MODES.map((value) => ({
  label: contractTaxModeLabel(value),
  value
}));

export const taxRateQuickOptions: Array<{
  label: string;
  value: TaxRateQuickValue;
}> = [
  { label: "1%", value: "1" },
  { label: "3%", value: "3" },
  { label: "6%", value: "6" },
  { label: "9%", value: "9" },
  { label: "13%", value: "13" },
  { label: "其他税率", value: "other" }
];

const QUICK_TAX_RATES = new Set<TaxRateQuickValue>(["1", "3", "6", "9", "13"]);
const LEGACY_TAX_FACT_FIELD_KEYS = new Set(["invoiceType", "taxRatePercent"]);

export function contractProfessionalFields(
  fields: ContractFieldDefinition[]
): ContractFieldDefinition[] {
  return fields.filter((field) => !LEGACY_TAX_FACT_FIELD_KEYS.has(field.key));
}

export function resolveTaxRatePercent(
  quickValue: TaxRateQuickValue,
  otherRate: string
): string {
  return normalizeTaxRatePercent(quickValue === "other" ? otherRate : quickValue);
}

export function taxRateQuickValueFor(rate: string): TaxRateQuickValue {
  if (!rate.trim()) return "other";
  try {
    const normalized = normalizeTaxRatePercent(rate);
    return QUICK_TAX_RATES.has(normalized as TaxRateQuickValue)
      ? (normalized as TaxRateQuickValue)
      : "other";
  } catch {
    return "other";
  }
}

export function taxFactsDisabledReason(draft: ContractTaxFactsDraft): string {
  if (!draft.invoiceType) return "请选择发票类型";
  if (!draft.rate.trim()) {
    return draft.taxMode === "multiple_rate" ? "请填写默认税率" : "请填写税率";
  }
  try {
    normalizeTaxRatePercent(draft.rate);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "税率填写不正确";
  }
}
