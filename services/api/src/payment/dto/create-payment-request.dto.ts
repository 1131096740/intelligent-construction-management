export interface CreatePaymentRequestDto {
  sourceType?: "settlement" | "contract_advance";
  settlementId?: string;
  contractVersionId?: string;
  paymentTermsVersionId?: string;
  code: string;
  requestedAmountCents: number;
}
