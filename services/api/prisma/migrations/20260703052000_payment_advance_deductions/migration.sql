ALTER TABLE "PaymentTermsStage"
  ADD COLUMN "advanceDeductionMode" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "advanceDeductionRatioBps" INTEGER,
  ADD COLUMN "advanceDeductionStartRatioBps" INTEGER;

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_advanceDeductionMode_check"
  CHECK ("advanceDeductionMode" IN ('none', 'per_settlement_ratio', 'after_cumulative_settlement_ratio'));

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_advanceDeductionRatioBps_check"
  CHECK ("advanceDeductionRatioBps" IS NULL OR ("advanceDeductionRatioBps" >= 0 AND "advanceDeductionRatioBps" <= 10000));

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_advanceDeductionStartRatioBps_check"
  CHECK ("advanceDeductionStartRatioBps" IS NULL OR ("advanceDeductionStartRatioBps" >= 0 AND "advanceDeductionStartRatioBps" <= 10000));

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_activeAdvanceDeductionRatio_check"
  CHECK (
    "advanceDeductionMode" = 'none'
    OR ("advanceDeductionRatioBps" IS NOT NULL AND "advanceDeductionRatioBps" > 0)
  );

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_conditionalAdvanceDeductionStart_check"
  CHECK (
    "advanceDeductionMode" <> 'after_cumulative_settlement_ratio'
    OR "advanceDeductionStartRatioBps" IS NOT NULL
  );
