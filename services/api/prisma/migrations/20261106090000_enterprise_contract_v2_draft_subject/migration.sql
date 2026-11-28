-- Preparation only. Execution requires separately authorized migration gates.
ALTER TABLE "ContractVersion" DROP CONSTRAINT "ContractVersion_signing_subject_check";
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_signing_subject_check" CHECK (
  (
    "signingSubjectType" = 'our_company'
    AND "affiliateAssignmentId" IS NULL
    AND "affiliateBusinessPartyVersionId" IS NULL
    AND "affiliateNameSnapshot" IS NULL
    AND "affiliateCreditCodeSnapshot" IS NULL
  ) OR (
    "signingSubjectType" = 'affiliate'
    AND "affiliateAssignmentId" IS NOT NULL
    AND "affiliateBusinessPartyVersionId" IS NOT NULL
    AND "affiliateNameSnapshot" IS NOT NULL
  ) OR (
    "signingSubjectType" = 'draft_unconfirmed'
    AND "numericProtocolVersion" = 2
    AND "status" IN ('draft', 'abandoned')
    AND "firstSubmittedAt" IS NULL
    AND "effectiveAt" IS NULL
    AND "affiliateAssignmentId" IS NULL
    AND "affiliateBusinessPartyVersionId" IS NULL
    AND "affiliateNameSnapshot" IS NULL
    AND "affiliateCreditCodeSnapshot" IS NULL
  )
);
