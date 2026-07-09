export type BusinessSummaryTone = "default" | "primary" | "warning" | "danger" | "success";

export interface BusinessStatusSummaryItem {
  label: string;
  value: string;
  tone?: BusinessSummaryTone;
}

export function normalizeBusinessStatusSummaryItems(
  items: readonly BusinessStatusSummaryItem[]
): BusinessStatusSummaryItem[] {
  return items.map((item) => ({
    label: item.label.trim(),
    value: item.value.trim() || "-",
    tone: item.tone ?? "default"
  }));
}
