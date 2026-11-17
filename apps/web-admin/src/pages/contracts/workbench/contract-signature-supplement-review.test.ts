import { describe, expect, it } from "vitest";
import { confirmSignatureSupplementPlan } from "./contract-signature-supplement-review";
import type { ContractBodyEditPlan, ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";
describe("signature supplement review",()=>{
 const plan:ContractBodyEditPlan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:"a".repeat(64),edits:[{positionId:"b".repeat(64),text:"用户原文"}]};
 const review:NonNullable<ContractDraftBodyReadModel["signatureSupplementReview"]>={digest:"c".repeat(64),confirmed:false,entries:[{role:"party_a",id:"b".repeat(64),text:"用户原文"}]};
 it("confirms only matching visible saved edits and preserves the user's text",()=>{
  expect(confirmSignatureSupplementPlan(plan,review)).toEqual({...plan,signatureSupplementReviewDigest:review.digest});expect(plan.edits[0].text).toBe("用户原文");
 });
 it("refuses stale edits and an already confirmed review",()=>{
  expect(confirmSignatureSupplementPlan({...plan,edits:[{...plan.edits[0],text:"已变化"}]},review)).toBeNull();
  expect(confirmSignatureSupplementPlan(plan,{...review,confirmed:true})).toBeNull();
 });
});
