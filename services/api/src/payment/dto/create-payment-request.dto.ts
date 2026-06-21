export interface CreatePaymentRequestDto {
  settlementId: string;
  code: string;
  requestedAmountCents: number;
}
