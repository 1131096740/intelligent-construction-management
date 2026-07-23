-- 非项目报销必须冻结真实事实证明人；已有新表尚未开放写入，本迁移仅追加可空字段。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 23);

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "factWitnessUserId" TEXT,
  ADD COLUMN "factWitnessNameSnapshot" TEXT,
  ADD CONSTRAINT "ExpenseClaim_fact_witness_tuple_check" CHECK (
    ("projectId" IS NOT NULL AND "factWitnessUserId" IS NULL AND "factWitnessNameSnapshot" IS NULL)
    OR ("projectId" IS NULL AND "factWitnessUserId" IS NOT NULL AND "factWitnessNameSnapshot" IS NOT NULL AND btrim("factWitnessNameSnapshot") <> '')
  ),
  ADD CONSTRAINT "ExpenseClaim_factWitnessUserId_fkey"
    FOREIGN KEY ("factWitnessUserId") REFERENCES "User"("id");

CREATE INDEX "ExpenseClaim_factWitnessUserId_idx" ON "ExpenseClaim"("factWitnessUserId");

COMMIT;
