CREATE UNIQUE INDEX "Settlement_contractVersion_period_active_key"
  ON "Settlement"("contractVersionId", "periodLabel")
  WHERE "status" IN (
    'draft',
    'in_approval',
    'approval_pending',
    'approved_pending_archive',
    'archive_pending',
    'pending_archive_confirm',
    'effective',
    'partially_paid',
    'paid'
  );

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_contract_row_amount_positive_check"
  CHECK ("sourceType" <> 'contract_bill_row' OR "amountCents" > 0) NOT VALID;
