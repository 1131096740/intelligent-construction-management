export const OPERATIONAL_WRITE_MODULES: readonly [
  "account", "approval", "contract", "expense", "files", "finance",
  "master_data", "operations", "organization", "payment", "procurement",
  "project", "settlement"
];
export function isOperationalWriteFrozen(
  environment: Record<string, string | undefined>,
  module: (typeof OPERATIONAL_WRITE_MODULES)[number]
): boolean;
