export interface RecordProjectOwnerContractDto {
  ownerName: string;
  contractName: string;
  contractCode: string;
  signedAt: string;
  amountCents: number;
  taxRateBps: number;
  pricingMethod: string;
  paymentTermsSummary: string;
  retentionSummary: string;
  fileId: string;
}
