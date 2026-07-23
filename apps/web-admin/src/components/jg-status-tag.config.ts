import type { BusinessSummaryTone } from "./business-status-summary.config";

export interface JgStatusTagView {
  label: string;
  tone: BusinessSummaryTone;
}

export function toJgStatusTagView(
  label: string,
  tone: BusinessSummaryTone = "default"
): JgStatusTagView {
  return {
    label: label.trim() || "-",
    tone
  };
}
