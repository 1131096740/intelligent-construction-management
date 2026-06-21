import type {
  ContractDetailReadModel,
  PaymentDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function fetchContractDetail(contractId: string) {
  return readJson<ContractDetailReadModel>(`/contracts/${contractId}`);
}

export function fetchSettlementDetail(settlementId: string) {
  return readJson<SettlementDetailReadModel>(`/settlements/${settlementId}`);
}

export function fetchPaymentDetail(paymentId: string) {
  return readJson<PaymentDetailReadModel>(`/payments/${paymentId}`);
}
