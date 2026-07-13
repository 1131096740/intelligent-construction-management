import type { RoleKey } from "@jiangkong/shared-domain";

const TEMPLATE_MAINTENANCE_ROLE_KEYS = new Set<RoleKey>([
  "contract_staff",
  "contract_director"
]);
const TEMPLATE_PUBLICATION_ROLE_KEYS = new Set<RoleKey>(["contract_director"]);

export function canMaintainContractTemplates(roleKeys?: readonly RoleKey[]) {
  return Boolean(roleKeys?.some((roleKey) => TEMPLATE_MAINTENANCE_ROLE_KEYS.has(roleKey)));
}

export function canPublishContractTemplates(roleKeys?: readonly RoleKey[]) {
  return Boolean(roleKeys?.some((roleKey) => TEMPLATE_PUBLICATION_ROLE_KEYS.has(roleKey)));
}
