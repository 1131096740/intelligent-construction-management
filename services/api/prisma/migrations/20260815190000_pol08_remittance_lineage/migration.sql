ALTER TABLE "ProjectUpstreamFundFact"
  ADD COLUMN "affiliateCompanyContractId" TEXT,
  ADD COLUMN "affiliateSettlementFactId" TEXT,
  ADD COLUMN "invoiceRecordId" TEXT;

CREATE INDEX "ProjectUpstreamFundFact_affiliateCompanyContractId_idx"
  ON "ProjectUpstreamFundFact"("affiliateCompanyContractId");

CREATE INDEX "ProjectUpstreamFundFact_affiliateSettlementFactId_idx"
  ON "ProjectUpstreamFundFact"("affiliateSettlementFactId");

CREATE INDEX "ProjectUpstreamFundFact_invoiceRecordId_idx"
  ON "ProjectUpstreamFundFact"("invoiceRecordId");
