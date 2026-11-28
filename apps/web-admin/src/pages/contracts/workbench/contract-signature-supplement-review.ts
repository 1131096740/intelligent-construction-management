import type { ContractBodyEditPlan, ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";

/** Confirmation covers the exact visible saved edits; the server rechecks the digest. */
export function confirmSignatureSupplementPlan(plan:ContractBodyEditPlan,review:NonNullable<ContractDraftBodyReadModel["signatureSupplementReview"]>):ContractBodyEditPlan|null {
 if(review.confirmed||!review.entries.length||review.entries.some(entry=>!plan.edits.some(edit=>edit.positionId===entry.id&&edit.text===entry.text)))return null;
 return {...plan,signatureSupplementReviewDigest:review.digest};
}
