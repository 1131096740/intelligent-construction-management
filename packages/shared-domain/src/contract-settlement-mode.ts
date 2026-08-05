export const CONTRACT_SETTLEMENT_MODES = [
  "settlement_required",
  "direct_payment"
] as const;

export type ContractSettlementMode = (typeof CONTRACT_SETTLEMENT_MODES)[number];

export type DirectPaymentAmountNature = "fixed_limit" | "unlimited_total";

export function isContractSettlementMode(value: unknown): value is ContractSettlementMode {
  return CONTRACT_SETTLEMENT_MODES.includes(value as ContractSettlementMode);
}

export const CONTRACT_SETTLEMENT_MODE_SOURCES = [
  "rule",
  "contract_director",
  "inherited",
  "backfill",
  "contract_takeover"
] as const;

export type ContractSettlementModeSource =
  (typeof CONTRACT_SETTLEMENT_MODE_SOURCES)[number];

export function suggestedContractSettlementMode(input: {
  contractTypeKey: string | null | undefined;
  hasBill: boolean;
}): ContractSettlementMode {
  return input.contractTypeKey === "generic_contract" && !input.hasBill
    ? "direct_payment"
    : "settlement_required";
}

export function contractSettlementModeLabel(mode: ContractSettlementMode) {
  return mode === "direct_payment" ? "按合同直接付款" : "需要结算";
}

export function directPaymentAmountNature(input: {
  amountLimitType: string | null | undefined;
  amountCents?: bigint | string | number | null;
}): DirectPaymentAmountNature {
  return input.amountLimitType === "unlimited"
    ? "unlimited_total"
    : "fixed_limit";
}
