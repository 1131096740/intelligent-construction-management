import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";

export type ProjectProxySettlementOption = ContractBusinessOptionReadModel["settlements"][number];

export function findProjectProxyContract(
  contracts: ContractBusinessOptionReadModel[],
  value: string
): ContractBusinessOptionReadModel | null {
  return contracts.find((contract) => (contract.contractVersionId ?? contract.contractId) === value) ?? null;
}

export function findProjectProxySettlement(
  contract: ContractBusinessOptionReadModel | null,
  settlementId: string
): ProjectProxySettlementOption | null {
  return contract?.settlements.find((settlement) => settlement.settlementId === settlementId) ?? null;
}

export function buildProxyPaymentLinkPayload(
  contract: ContractBusinessOptionReadModel | null,
  settlement: ProjectProxySettlementOption | null
) {
  return {
    ...(contract ? { contractId: contract.contractId } : {}),
    ...(settlement ? { settlementId: settlement.settlementId } : {})
  };
}
