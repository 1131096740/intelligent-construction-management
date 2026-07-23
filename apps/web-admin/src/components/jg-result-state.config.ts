export type JgResultState = "loading" | "error" | "permission" | "empty" | "ready";

export function resolveJgResultState(input: {
  loading: boolean;
  error?: string | null;
  permissionReason?: string | null;
  hasResults: boolean;
}): JgResultState {
  if (input.hasResults) return "ready";
  if (input.permissionReason?.trim()) return "permission";
  if (input.error?.trim()) return "error";
  if (input.loading) return "loading";
  return "empty";
}
