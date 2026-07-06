-- Core flow guardrails. NOT VALID avoids blocking rollout on legacy rows while
-- enforcing the constraints for new writes and touched rows.

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_status_check"
  CHECK ("status" IN ('draft', 'in_approval', 'approval_rejected', 'approved_pending_seal', 'in_seal', 'seal_approved_pending_archive', 'pending_archive_confirm', 'effective', 'voided')) NOT VALID;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_amount_nonnegative_check"
  CHECK ("amountCents" >= 0) NOT VALID;

ALTER TABLE "PaymentTermsVersion"
  ADD CONSTRAINT "PaymentTermsVersion_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;

ALTER TABLE "PaymentTermsVersion"
  ADD CONSTRAINT "PaymentTermsVersion_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;

ALTER TABLE "PaymentTermsVersion"
  ADD CONSTRAINT "PaymentTermsVersion_status_check"
  CHECK ("status" IN ('draft', 'effective', 'voided')) NOT VALID;

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_terms_version_fk"
  FOREIGN KEY ("paymentTermsVersionId") REFERENCES "PaymentTermsVersion"("id") NOT VALID;

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_ratioBps_range_check"
  CHECK ("ratioBps" IS NULL OR ("ratioBps" >= 0 AND "ratioBps" <= 10000)) NOT VALID;

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_fixedAmount_positive_check"
  CHECK ("fixedAmountCents" IS NULL OR "fixedAmountCents" > 0) NOT VALID;

ALTER TABLE "PaymentTermsStage"
  ADD CONSTRAINT "PaymentTermsStage_dueDays_nonnegative_check"
  CHECK ("dueDays" >= 0) NOT VALID;

ALTER TABLE "ContractArchiveFile"
  ADD CONSTRAINT "ContractArchiveFile_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;

ALTER TABLE "ContractArchiveFile"
  ADD CONSTRAINT "ContractArchiveFile_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "ContractArchiveFile"
  ADD CONSTRAINT "ContractArchiveFile_status_check"
  CHECK ("status" IN ('pending_confirm', 'confirmed', 'voided')) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_terms_version_fk"
  FOREIGN KEY ("paymentTermsVersionId") REFERENCES "PaymentTermsVersion"("id") NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_status_check"
  CHECK ("status" IN ('draft', 'in_approval', 'approval_pending', 'approval_rejected', 'withdrawn', 'approved_pending_archive', 'archive_pending', 'pending_archive_confirm', 'effective', 'partially_paid', 'paid', 'voided')) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_amount_positive_check"
  CHECK ("amountCents" > 0) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_payable_nonnegative_check"
  CHECK ("payableAmountCents" >= 0) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_paid_nonnegative_check"
  CHECK ("paidAmountCents" >= 0) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_paid_lte_payable_check"
  CHECK ("paidAmountCents" <= "payableAmountCents") NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_final_cumulative_nonnegative_check"
  CHECK ("finalCumulativeAmountCents" IS NULL OR "finalCumulativeAmountCents" >= 0) NOT VALID;

ALTER TABLE "SettlementArchiveFile"
  ADD CONSTRAINT "SettlementArchiveFile_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") NOT VALID;

ALTER TABLE "SettlementArchiveFile"
  ADD CONSTRAINT "SettlementArchiveFile_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "SettlementArchiveFile"
  ADD CONSTRAINT "SettlementArchiveFile_status_check"
  CHECK ("status" IN ('pending_confirm', 'confirmed', 'voided')) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_terms_version_fk"
  FOREIGN KEY ("paymentTermsVersionId") REFERENCES "PaymentTermsVersion"("id") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_status_check"
  CHECK ("status" IN ('draft', 'approval_pending', 'in_approval', 'approval_rejected', 'withdrawn', 'approved_pending_payment', 'partially_paid', 'paid', 'voided')) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_requested_positive_check"
  CHECK ("requestedAmountCents" > 0) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_approved_positive_check"
  CHECK ("approvedAmountCents" IS NULL OR "approvedAmountCents" > 0) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_approved_lte_requested_check"
  CHECK ("approvedAmountCents" IS NULL OR "approvedAmountCents" <= "requestedAmountCents") NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_paid_nonnegative_check"
  CHECK ("paidAmountCents" >= 0) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_paid_lte_approved_check"
  CHECK ("paidAmountCents" <= COALESCE("approvedAmountCents", "requestedAmountCents")) NOT VALID;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_request_fk"
  FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") NOT VALID;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") NOT VALID;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_voucher_file_fk"
  FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_amount_positive_check"
  CHECK ("amountCents" > 0) NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_payment_request_fk"
  FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_project_expense_fk"
  FOREIGN KEY ("projectExpenseRequestId") REFERENCES "ProjectExpenseRequest"("id") NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_direction_check"
  CHECK ("direction" IN ('inflow', 'outflow')) NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_amount_positive_check"
  CHECK ("amountCents" > 0) NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_source_check"
  CHECK (
    ("paymentRequestId" IS NOT NULL AND "projectExpenseRequestId" IS NULL)
    OR ("paymentRequestId" IS NULL AND "projectExpenseRequestId" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "PaymentExecutionAllocation"
  ADD CONSTRAINT "PaymentExecutionAllocation_execution_fk"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") NOT VALID;

ALTER TABLE "PaymentExecutionAllocation"
  ADD CONSTRAINT "PaymentExecutionAllocation_request_fk"
  FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") NOT VALID;
