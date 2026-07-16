import {
  canPerform,
  CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

function hasAnyRole(roleKeys: readonly RoleKey[], allowedRoleKeys: readonly RoleKey[]) {
  return allowedRoleKeys.some((roleKey) => roleKeys.includes(roleKey));
}

export function canReadHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return hasAnyRole(roleKeys, HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS);
}

export function canExportContractSettlementLedger(roleKeys: readonly RoleKey[]) {
  return hasAnyRole(roleKeys, CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS);
}

export function canManageHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.create", roleKeys);
}

export function canSubmitHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.submit", roleKeys);
}

export function canConfirmHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.archive.confirm", roleKeys);
}

export function canManageContractRecords(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.create", roleKeys);
}

export function canManageSettlementRecords(roleKeys: readonly RoleKey[]) {
  return canPerform("settlement.create", roleKeys);
}
