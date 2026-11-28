import {
  CONTRACT_LEDGER_READ_ROLE_KEYS,
  PROJECT_OVERVIEW_READ_ROLE_KEYS
} from "@jiangkong/shared-domain";

/**
 * Read-only access to the contract, settlement and payment ledgers.
 *
 * The role set is defined once in `@jiangkong/shared-domain` so the Web
 * navigation matrix (#423) and this backend Guard read the same truth.
 * `employee` enters the summary-only path; row-level visibility is still
 * enforced by the read service against the lifecycle + role groups.
 */
export const LEDGER_READ_POSITION_KEYS = CONTRACT_LEDGER_READ_ROLE_KEYS;

/**
 * The project overview is a management read model. It is available to every
 * existing management position and to the project manager in the current project.
 * Company-wide contract handling does not grant financial-overview duties.
 */
export const PROJECT_OVERVIEW_READ_POSITION_KEYS = PROJECT_OVERVIEW_READ_ROLE_KEYS;
