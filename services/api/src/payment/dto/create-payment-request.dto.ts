export interface CreatePaymentRequestDto {
  sourceType?: "settlement" | "contract_advance" | "contract_due";
  settlementId?: string;
  contractVersionId?: string;
  paymentTermsVersionId?: string;
  code: string;
  requestedAmountCents: number;
}
