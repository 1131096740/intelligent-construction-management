import type { RoleKey } from "./roles";

export const COMPANY_ENTITY_DATA_STATUSES = ["complete", "legacy_incomplete"] as const;

export type CompanyEntityDataStatus = (typeof COMPANY_ENTITY_DATA_STATUSES)[number];

export const COMPANY_ENTITY_MAINTAINER_ROLES = [
  "comprehensive_director",
  "contract_staff",
  "contract_director"
] as const satisfies readonly RoleKey[];

export const COMPANY_ENTITY_READER_ROLES = [
  "comprehensive_director",
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director",
  "chairman",
  "general_manager"
] as const satisfies readonly RoleKey[];
