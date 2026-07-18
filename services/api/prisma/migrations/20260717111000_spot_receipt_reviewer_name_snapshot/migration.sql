ALTER TABLE "SpotProcurementReceiptReview"
ADD COLUMN "reviewedByNameSnapshot" TEXT;

UPDATE "SpotProcurementReceiptReview" review
SET "reviewedByNameSnapshot" = BTRIM("User"."name")
FROM "User"
WHERE "User"."id" = review."reviewedByUserId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SpotProcurementReceiptReview"
    WHERE "reviewedByNameSnapshot" IS NULL
       OR "reviewedByNameSnapshot" = ''
  ) THEN
    RAISE EXCEPTION
      'cannot freeze spot procurement receipt reviewer name snapshot';
  END IF;
END
$$;

ALTER TABLE "SpotProcurementReceiptReview"
ALTER COLUMN "reviewedByNameSnapshot" SET NOT NULL;
