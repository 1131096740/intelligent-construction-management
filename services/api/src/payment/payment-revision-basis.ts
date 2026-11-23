import type { PaymentRequest } from "@prisma/client";

export function hasPaymentRevisionBasis(payment: Pick<PaymentRequest,
  "sourceType" | "settlementId" | "signedSettlementId" | "paymentTermsStageId" |
  "requestedAmountCents" | "approvedAmountCents" | "paidAmountCents">): boolean {
  if (payment.requestedAmountCents <= 0n || payment.approvedAmountCents !== null || payment.paidAmountCents !== 0n) return false;
  switch (payment.sourceType) {
    case "settlement":
      return Boolean(payment.settlementId) && !payment.signedSettlementId && !payment.paymentTermsStageId;
    case "signed_settlement":
      return Boolean(payment.signedSettlementId) && !payment.settlementId && !payment.paymentTermsStageId;
    case "contract_due":
      return Boolean(payment.paymentTermsStageId) && !payment.signedSettlementId && !payment.settlementId;
    case "contract_advance":
      return !payment.paymentTermsStageId && !payment.signedSettlementId && !payment.settlementId;
    default:
      return false;
  }
}
