import type { RoleKey } from "@jiangkong/shared-domain";

export const CONTRACT_ECONOMIC_REVIEW_PREPARER_ROLES: readonly RoleKey[] = [
  "contract_staff", "contract_director", "budget_staff", "budget_director"
];

export const CONTRACT_ECONOMIC_REVIEW_READER_ROLES: readonly RoleKey[] = [
  ...CONTRACT_ECONOMIC_REVIEW_PREPARER_ROLES,
  "finance_staff", "finance_director", "project_manager", "chairman", "general_manager"
];
