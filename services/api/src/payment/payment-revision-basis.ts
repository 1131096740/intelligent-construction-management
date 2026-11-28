import { PAYMENT_TEXT_AGREEMENT_BASIS } from "./payment-text-agreement";
import type { PaymentRequest } from "@prisma/client";
import { isOrdinaryPaymentParallelRound } from "./ordinary-payment-parallel";

export function paymentRevisionAction(round: { status: string; frozenNodes?: unknown } | null | undefined) {
  if (round?.status === "returned_to_applicant") return "return_to_applicant";
  if (round?.status === "withdrawn" && isOrdinaryPaymentParallelRound(round.frozenNodes)) return "withdraw";
  return null;
}

export function hasPaymentRevisionBasis(payment: Pick<PaymentRequest,
  "sourceType" | "settlementId" | "signedSettlementId" | "paymentTermsStageId" |
  "contractDueBasis" | "requestedAmountCents" | "approvedAmountCents" | "paidAmountCents">): boolean {
  if (payment.requestedAmountCents <= 0n || payment.approvedAmountCents !== null || payment.paidAmountCents !== 0n) return false;
  switch (payment.sourceType) {
    case "settlement":
      return Boolean(payment.settlementId) && !payment.signedSettlementId && !payment.paymentTermsStageId;
    case "signed_settlement":
      return Boolean(payment.signedSettlementId) && !payment.settlementId && !payment.paymentTermsStageId;
    case "contract_due":
      return (Boolean(payment.paymentTermsStageId) || payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS) &&
        !payment.signedSettlementId && !payment.settlementId;
    case "contract_advance":
      return !payment.paymentTermsStageId && !payment.signedSettlementId && !payment.settlementId;
    default:
      return false;
  }
}
