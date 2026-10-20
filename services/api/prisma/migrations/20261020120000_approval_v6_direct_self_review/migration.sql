-- V6 approved policy: an applicant who directly holds the required business role
-- must perform an explicit signed review. No historical row is changed.
-- Preserve all shape, state, actor, time, target and application invariants.
BEGIN;
LOCK TABLE "ContractTakeoverCorrection" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ContractTakeoverCorrection" DROP CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check";
ALTER TABLE "ContractTakeoverCorrection"
  ADD CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check"
    CHECK (
      "correctionType" <> 'company_entity'
      OR (
        "schemaVersion" = 1
        AND "targetCompanyEntityId" IS NOT NULL
        AND "submittedByUserId" IS NOT NULL
        AND "submittedByUserId" = "createdByUserId"
        AND "submittedAt" IS NOT NULL
        AND (
          "status" = 'submitted'
          OR (
            "reviewedByUserId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
          )
        )
      )
    );

ALTER TABLE "ContractTakeoverCorrection" DROP CONSTRAINT "ContractTakeoverCorrection_v2_shape_check";
ALTER TABLE "ContractTakeoverCorrection"
  ADD CONSTRAINT "ContractTakeoverCorrection_v2_shape_check"
    CHECK (
      "schemaVersion" <> 2
      OR (
        "correctionScope" IN (
          'historical_settlement',
          'historical_payment',
          'historical_advance',
          'abnormal_overpay'
        )
        AND "correctionOperation" IN (
          'correction',
          'reclassification',
          'reversal'
        )
        AND "targetRevision" > 0
        AND "applicationIdempotencyKey" IS NOT NULL
        AND NULLIF(BTRIM("applicationIdempotencyKey"), '') IS NOT NULL
        AND "deltaSnapshot" IS NOT NULL
        AND (
          (
            "status" = 'draft'
            AND "submittedByUserId" IS NULL
            AND "submittedAt" IS NULL
            AND "reviewedByUserId" IS NULL
            AND "reviewedAt" IS NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
          OR
          (
            "status" = 'submitted'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NULL
            AND "reviewedAt" IS NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
          OR (
            "status" = 'applied'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
            AND "appliedByUserId" = "reviewedByUserId"
            AND "appliedAt" = "reviewedAt"
          )
          OR (
            "status" = 'rejected'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
        )
      )
    );

COMMIT;
