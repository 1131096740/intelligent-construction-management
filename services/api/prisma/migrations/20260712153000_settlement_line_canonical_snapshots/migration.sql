ALTER TABLE "SettlementLine"
  ADD COLUMN "calculationMode" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "contractQuantitySnapshot" DECIMAL(24, 6),
  ADD COLUMN "unitPriceSnapshot" DECIMAL(24, 6),
  ADD COLUMN "taxRatePercentSnapshot" DECIMAL(9, 6),
  ADD COLUMN "pricingModeSnapshot" TEXT;

ALTER TABLE "SettlementLine"
  DROP CONSTRAINT IF EXISTS "SettlementLine_amount_nonzero_check",
  DROP CONSTRAINT IF EXISTS "SettlementLine_contract_row_amount_positive_check";

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_calculation_mode_check"
  CHECK ("calculationMode" IN ('legacy', 'normal_auto', 'manual_amount', 'manual_adjustment')) NOT VALID,
  ADD CONSTRAINT "SettlementLine_contract_quantity_nonnegative_check"
  CHECK ("sourceType" <> 'contract_bill_row' OR "quantity" IS NULL OR "quantity" >= 0) NOT VALID,
  ADD CONSTRAINT "SettlementLine_contract_amount_nonnegative_check"
  CHECK ("sourceType" <> 'contract_bill_row' OR "amountCents" >= 0) NOT VALID,
  ADD CONSTRAINT "SettlementLine_manual_adjustment_nonzero_check"
  CHECK ("sourceType" <> 'manual_adjustment' OR "amountCents" <> 0) NOT VALID;
