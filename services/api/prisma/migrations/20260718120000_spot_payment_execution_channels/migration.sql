-- Task 7: real-form payments record the approved channel used for each actual payment.
-- Legacy execution rows intentionally retain NULL because their historic payment channel was not modelled.
ALTER TABLE "SpotProcurementPaymentExecution"
  ADD COLUMN "paymentChannelId" TEXT;

CREATE INDEX "SpotProcurementPaymentExecution_paymentChannelId_idx"
  ON "SpotProcurementPaymentExecution"("paymentChannelId");
