import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

/**
 * Read-only access to the contract, settlement and payment ledgers.
 *
 * Global business positions see every active project through the existing
 * project-visibility service. The three project-scoped positions below keep
 * their pre-existing ledger access without turning them into global users.
 */
export const LEDGER_READ_POSITION_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "project_manager",
  "contract_staff",
  "budget_staff"
] as const satisfies readonly RoleKey[];

/**
 * The project overview is a management read model. It is available to every
 * global business position and to the project manager in the current project.
 */
export const PROJECT_OVERVIEW_READ_POSITION_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "project_manager"
] as const satisfies readonly RoleKey[];
