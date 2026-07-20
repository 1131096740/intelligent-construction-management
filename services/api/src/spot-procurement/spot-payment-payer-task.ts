export function isSpotPaymentPayerTaskComplete(
  payment: {
    payerCompanyEntityId: string | null;
    payerCompanyNameSnapshot: string | null;
  },
  paymentMethodCount: number
) {
  return Boolean(
    payment.payerCompanyEntityId &&
      payment.payerCompanyNameSnapshot?.trim() &&
      paymentMethodCount > 0
  );
}
