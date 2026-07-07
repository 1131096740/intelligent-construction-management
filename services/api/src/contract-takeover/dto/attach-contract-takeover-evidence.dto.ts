export type ContractTakeoverEvidencePurpose =
  | "historical_contract_scan"
  | "historical_settlement_ledger"
  | "historical_payment_voucher"
  | "other";

export interface AttachContractTakeoverEvidenceDto {
  fileId: string;
  purpose: ContractTakeoverEvidencePurpose;
}
