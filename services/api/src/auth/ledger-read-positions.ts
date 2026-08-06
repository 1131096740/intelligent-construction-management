import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

/**
 * Read-only access to the contract, settlement and payment ledgers.
 *
 * Global business positions see every active project through the existing
 * project-visibility service. The project-scoped positions below keep or gain
 * ledger access without turning them into global users.
 *
 * Spec 9 extends the ledger gate to the remaining project full-view positions
 * and lets `employee` enter the summary-only path. Row-level visibility is
 * still enforced by the read service against the lifecycle + role groups;
 * passing the gate here does not grant full rows.
 */
export const LEDGER_READ_POSITION_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "project_manager",
  "contract_staff",
  "budget_staff",
  "material_staff",
  "engineering_department_member",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech",
  "employee"
] as const satisfies readonly RoleKey[];

/**
 * The project overview is a management read model. It is available to every
 * global business position and to the project manager in the current project.
 */
export const PROJECT_OVERVIEW_READ_POSITION_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "project_manager"
] as const satisfies readonly RoleKey[];
