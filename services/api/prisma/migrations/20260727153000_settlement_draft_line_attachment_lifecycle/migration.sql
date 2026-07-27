BEGIN;

-- 20260727120000 已成为不可变的前向基线；其早期草稿枚举与现行工作台
-- `visa_change/manual_adjustment/pending_source` 语义不一致，必须以新迁移修正。
ALTER TABLE "SettlementDraftLine"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

UPDATE "SettlementDraftLine"
SET "sourceType" = CASE "sourceType"
  WHEN 'signature_change' THEN 'visa_change'
  WHEN 'adjustment' THEN 'manual_adjustment'
  ELSE "sourceType"
END,
"calculationMode" = CASE
  WHEN "sourceType" = 'signature_change' THEN 'visa_change'
  WHEN "sourceType" = 'adjustment' THEN 'manual_adjustment'
  ELSE 'pending_source'
END;

ALTER TABLE "SettlementDraftLine"
  DROP CONSTRAINT IF EXISTS "SettlementDraftLine_sourceType_check",
  DROP CONSTRAINT IF EXISTS "SettlementDraftLine_calculationMode_check",
  DROP CONSTRAINT IF EXISTS "SettlementDraftLine_calculation_fields_check";

ALTER TABLE "SettlementDraftLine"
  ADD CONSTRAINT "SettlementDraftLine_sourceType_check"
    CHECK ("sourceType" IN ('contract_bill_row', 'visa_change', 'manual_adjustment')) NOT VALID,
  ADD CONSTRAINT "SettlementDraftLine_calculationMode_check"
    CHECK ("calculationMode" IN ('pending_source', 'normal_auto', 'manual_amount', 'visa_change', 'manual_adjustment')) NOT VALID,
  ADD CONSTRAINT "SettlementDraftLine_status_check"
    CHECK ("status" IN ('active', 'removed')) NOT VALID;

CREATE INDEX "SettlementDraftLine_settlementDraftId_status_sortOrder_idx"
  ON "SettlementDraftLine"("settlementDraftId", "status", "sortOrder");

COMMIT;
