import type { ExpenseClaim } from "@prisma/client";

type FundingClaim = Pick<ExpenseClaim, "claimType" | "status" | "requestedAmountCents" | "companyPayableAmountCents" | "fundedAmountCents">;

export const expenseFundingFacets = [
  { duty: "disbursement", claimTypes: ["loan"], initial: "approved_pending_disbursement", partial: "partially_disbursed",
    action: "expense_claim.disburse", label: "登记借款放款" },
  { duty: "payment", claimTypes: ["reimbursement", "incidental_expense"], initial: "approved_pending_payment", partial: "partially_paid",
    action: "expense_claim.payment.execute", label: "登记实际付款" }
] as const;

export function expenseClaimFundingDuty(claim: FundingClaim, includePartial: boolean) {
  const facet = expenseFundingFacets.find(({ claimTypes, initial, partial }) =>
    claimTypes.some(type => type === claim.claimType) && (claim.status === initial || (includePartial && claim.status === partial)));
  if (!facet) return null;
  const remaining = (facet.duty === "disbursement" ? claim.requestedAmountCents : claim.companyPayableAmountCents) - claim.fundedAmountCents;
  return remaining > 0n ? { ...facet, remaining } : null;
}
