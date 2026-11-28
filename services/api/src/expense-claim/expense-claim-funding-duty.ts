import type { ExpenseClaim } from "@prisma/client";

type FundingClaim = Pick<ExpenseClaim, "claimType" | "status" | "companyPayableAmountCents" | "fundedAmountCents">;

export const expenseFundingFacets = [
  { duty: "payment", claimTypes: ["reimbursement", "incidental_expense"], initial: "approved_pending_payment", partial: "partially_paid",
    action: "expense_claim.payment.execute", label: "登记实际付款" }
] as const;

export function expenseClaimFundingDuty(claim: FundingClaim, includePartial: boolean) {
  const facet = expenseFundingFacets.find(({ claimTypes, initial, partial }) =>
    claimTypes.some(type => type === claim.claimType) && (claim.status === initial || (includePartial && claim.status === partial)));
  if (!facet) return null;
  const remaining = claim.companyPayableAmountCents - claim.fundedAmountCents;
  return remaining > 0n ? { ...facet, remaining } : null;
}
