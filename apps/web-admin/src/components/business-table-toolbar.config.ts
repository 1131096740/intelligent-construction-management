export function hasActiveToolbarFilters(filters: Record<string, unknown>) {
  return Object.values(filters).some((value) => isActiveToolbarFilterValue(value));
}

function isActiveToolbarFilterValue(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return false;
}
