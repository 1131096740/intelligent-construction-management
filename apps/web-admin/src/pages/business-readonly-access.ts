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
  return canEditHistoricalContractFacts(roleKeys);
}

export function canSubmitHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.submit", roleKeys);
}

export function canConfirmHistoricalContractTakeovers(roleKeys: readonly RoleKey[]) {
  return canConfirmHistoricalContractFacts(roleKeys);
}

export function canUploadHistoricalPaymentVoucher(roleKeys: readonly RoleKey[]) {
  return canEditHistoricalFinanceFacts(roleKeys);
}

export type HistoricalTakeoverSide = "contract" | "finance";

export function canEditHistoricalContractFacts(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.takeover.contract_facts.edit", roleKeys);
}

export function canConfirmHistoricalContractFacts(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.takeover.contract_facts.confirm", roleKeys);
}

export function canEditHistoricalFinanceFacts(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.takeover.finance_facts.edit", roleKeys);
}

export function canConfirmHistoricalFinanceFacts(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.takeover.finance_facts.confirm", roleKeys);
}

export function canWithdrawHistoricalTakeoverConfirmation(
  roleKeys: readonly RoleKey[],
  side: HistoricalTakeoverSide
) {
  if (!canPerform("contract.takeover.confirmation.withdraw", roleKeys)) {
    return false;
  }
  return roleKeys.includes(
    side === "contract" ? "contract_director" : "finance_director"
  );
}

export function canSubmitHistoricalTakeoverCorrection(
  roleKeys: readonly RoleKey[],
  side: HistoricalTakeoverSide
) {
  if (!canPerform("contract.takeover.correction.submit", roleKeys)) {
    return false;
  }
  const allowed =
    side === "contract"
      ? (["contract_staff", "contract_director"] as const)
      : (["finance_staff", "finance_director"] as const);
  return hasAnyRole(roleKeys, allowed);
}

export function canReviewHistoricalTakeoverCorrection(
  roleKeys: readonly RoleKey[],
  side: HistoricalTakeoverSide
) {
  if (!canPerform("contract.takeover.correction.review", roleKeys)) {
    return false;
  }
  return roleKeys.includes(
    side === "contract" ? "contract_director" : "finance_director"
  );
}

export function canManageContractRecords(roleKeys: readonly RoleKey[]) {
  return canPerform("contract.create", roleKeys);
}

export function canManageSettlementRecords(roleKeys: readonly RoleKey[]) {
  return canPerform("settlement.create", roleKeys);
}
