export type ProjectProxyPaymentType =
  | "material"
  | "equipment"
  | "labor"
  | "professional_subcontract"
  | "other";

export interface RecordProjectProxyPaymentDto {
  paidAt: string;
  amountCents: string;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: ProjectProxyPaymentType;
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
  contractId?: string;
  settlementId?: string;
}
