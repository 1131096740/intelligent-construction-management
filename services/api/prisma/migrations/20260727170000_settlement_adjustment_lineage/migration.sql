-- T17: distinguish normal manual adjustments from retrospective pricing and over-settlement offsets.
-- Nullable so historical settlements and drafts retain their recorded facts unchanged.
ALTER TABLE "SettlementLine"
  ADD COLUMN "adjustmentKind" TEXT;

ALTER TABLE "SettlementDraftLine"
  ADD COLUMN "adjustmentKind" TEXT;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_adjustmentKind_check"
  CHECK ("adjustmentKind" IS NULL OR "adjustmentKind" IN (
    'ordinary', 'retrospective_price_difference', 'over_settlement_offset'
  ));

ALTER TABLE "SettlementDraftLine"
  ADD CONSTRAINT "SettlementDraftLine_adjustmentKind_check"
  CHECK ("adjustmentKind" IS NULL OR "adjustmentKind" IN (
    'ordinary', 'retrospective_price_difference', 'over_settlement_offset'
  ));
