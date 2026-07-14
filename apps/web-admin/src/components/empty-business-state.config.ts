export interface EmptyBusinessStateAction {
  label: string;
  to: string;
  primary?: boolean;
}

export function normalizeEmptyBusinessStateActions(
  actions: readonly unknown[]
): EmptyBusinessStateAction[] {
  return actions.flatMap((action) => {
    if (!isPlainObject(action)) {
      return [];
    }

    const label = readTrimmedText(action.label);
    const to = readTrimmedText(action.to);

    if (!label || !to) {
      return [];
    }

    return [{ label, to, ...(action.primary === true ? { primary: true } : {}) }];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
