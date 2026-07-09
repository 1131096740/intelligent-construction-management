export function hasActiveToolbarFilters(filters: Record<string, unknown>) {
  return Object.values(filters).some((value) => String(value ?? "").trim().length > 0);
}
