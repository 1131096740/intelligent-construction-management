-- POL-08 records the concrete participating company for new remittances and
-- the approved payment request for post-effective construction-enterprise payments.
ALTER TABLE "ProjectUpstreamFundFact"
  ADD COLUMN "companyEntityId" TEXT;

CREATE INDEX "ProjectUpstreamFundFact_companyEntityId_idx"
  ON "ProjectUpstreamFundFact"("companyEntityId");

ALTER TABLE "ProjectAffiliatePaymentFact"
  ADD COLUMN "paymentRequestId" TEXT;

CREATE INDEX "ProjectAffiliatePaymentFact_paymentRequestId_idx"
  ON "ProjectAffiliatePaymentFact"("paymentRequestId");
