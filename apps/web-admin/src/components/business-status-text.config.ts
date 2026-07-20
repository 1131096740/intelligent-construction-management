export const businessStatusTextSemantics = {
  neutral: "--jg-color-text-muted",
  progress: "--jg-color-warning",
  required: "--jg-color-required",
  success: "--jg-color-success",
  danger: "--jg-color-danger"
} as const;

export type BusinessStatusSemantic = keyof typeof businessStatusTextSemantics;

export function normalizeBusinessStatusSemantic(
  value: unknown
): BusinessStatusSemantic {
  switch (value) {
    case "progress":
    case "required":
    case "success":
    case "danger":
      return value;
    default:
      return "neutral";
  }
}
