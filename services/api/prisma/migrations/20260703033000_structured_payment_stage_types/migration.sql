ALTER TABLE "PaymentTermsStage"
  ADD COLUMN "stageType" TEXT NOT NULL DEFAULT 'progress',
  ADD COLUMN "triggerAnchor" TEXT NOT NULL DEFAULT 'settlement_effective';

ALTER TABLE "Settlement"
  ADD COLUMN "isFinal" BOOLEAN NOT NULL DEFAULT false;
