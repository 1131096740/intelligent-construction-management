export interface EmptyBusinessStateAction {
  label: string;
  to?: string;
}

export function normalizeEmptyBusinessStateActions(
  actions: readonly EmptyBusinessStateAction[]
): EmptyBusinessStateAction[] {
  return actions.filter((action) => action.label.trim().length > 0);
}
