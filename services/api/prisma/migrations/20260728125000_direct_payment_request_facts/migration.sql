BEGIN;

ALTER TABLE "PaymentRequest"
  ADD COLUMN "paymentMatter" TEXT,
  ADD COLUMN "amountCalculationExplanation" TEXT;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_direct_payment_facts_pair_check"
  CHECK (
    ("paymentMatter" IS NULL AND "amountCalculationExplanation" IS NULL)
    OR
    (
      "paymentMatter" IS NOT NULL
      AND btrim("paymentMatter") <> ''
      AND length("paymentMatter") <= 500
      AND "amountCalculationExplanation" IS NOT NULL
      AND btrim("amountCalculationExplanation") <> ''
      AND length("amountCalculationExplanation") <= 2000
    )
  );

COMMIT;
