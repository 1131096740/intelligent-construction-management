ALTER TABLE public."ExpenseClaim"
  DROP CONSTRAINT "ExpenseClaim_fact_witness_tuple_check",
  ADD CONSTRAINT "ExpenseClaim_fact_witness_tuple_check" CHECK (
    ("projectId" IS NOT NULL AND "factWitnessUserId" IS NULL AND "factWitnessNameSnapshot" IS NULL)
    OR (
      "projectId" IS NULL
      AND (
        ("factWitnessUserId" IS NOT NULL AND "factWitnessNameSnapshot" IS NOT NULL
          AND btrim("factWitnessNameSnapshot") <> '')
        OR (
          "claimType" = 'reimbursement'
          AND "generalProcurementId" IS NULL AND "actualPurchaseBatchId" IS NULL
          AND "factWitnessUserId" IS NULL AND "factWitnessNameSnapshot" IS NULL
        )
      )
    )
  );
