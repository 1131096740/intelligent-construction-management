CREATE TABLE "PaymentExecutionAllocation" (
  "id" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "paymentRequestId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT,
  "settlementId" TEXT,
  "sourceType" TEXT NOT NULL,
  "allocationType" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "paymentTermsVersionId" TEXT NOT NULL,
  "stageType" TEXT NOT NULL,
  "stageId" TEXT,
  "stageName" TEXT,
  "triggerAnchor" TEXT,
  "dueDays" INTEGER,
  "ratioBps" INTEGER,
  "fixedAmountCents" INTEGER,
  "sourceEffectiveAt" TIMESTAMP(3),
  "expectedPayableAt" TIMESTAMP(3),
  "sourcePayableAmountCents" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "allocationOrder" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentExecutionAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionAllocation_amount_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "PaymentExecutionAllocation_source_payable_positive_check"
    CHECK ("sourcePayableAmountCents" > 0),
  CONSTRAINT "PaymentExecutionAllocation_amount_within_source_payable_check"
    CHECK ("amountCents" <= "sourcePayableAmountCents"),
  CONSTRAINT "PaymentExecutionAllocation_source_type_check"
    CHECK ("sourceType" IN ('contract_due')),
  CONSTRAINT "PaymentExecutionAllocation_allocation_type_check"
    CHECK ("allocationType" IN ('contract_due_payment', 'advance_deduction')),
  CONSTRAINT "PaymentExecutionAllocation_stage_type_check"
    CHECK ("stageType" IN ('progress', 'final', 'retention')),
  CONSTRAINT "PaymentExecutionAllocation_settlement_required_check"
    CHECK ("settlementId" IS NOT NULL)
);

CREATE UNIQUE INDEX "PaymentExecutionAllocation_execution_type_order_key"
  ON "PaymentExecutionAllocation"("paymentExecutionId", "allocationType", "allocationOrder");

CREATE UNIQUE INDEX "PaymentExecutionAllocation_execution_type_row_key"
  ON "PaymentExecutionAllocation"("paymentExecutionId", "allocationType", "sourceRowId");

CREATE INDEX "PaymentExecutionAllocation_paymentRequestId_idx"
  ON "PaymentExecutionAllocation"("paymentRequestId");

CREATE INDEX "PaymentExecutionAllocation_contractId_idx"
  ON "PaymentExecutionAllocation"("contractId");

CREATE INDEX "PaymentExecutionAllocation_settlementId_idx"
  ON "PaymentExecutionAllocation"("settlementId");

CREATE INDEX "PaymentExecutionAllocation_contract_settlement_stage_idx"
  ON "PaymentExecutionAllocation"("contractId", "settlementId", "stageId");

CREATE INDEX "PaymentExecution_paymentRequestId_idx"
  ON "PaymentExecution"("paymentRequestId");

CREATE INDEX "PaymentRequest_contract_source_status_idx"
  ON "PaymentRequest"("contractId", "sourceType", "status");

CREATE INDEX "Settlement_contract_status_idx"
  ON "Settlement"("contractId", "status");

CREATE INDEX "SettlementArchiveFile_settlement_status_confirmed_idx"
  ON "SettlementArchiveFile"("settlementId", "status", "confirmedAt");

CREATE OR REPLACE FUNCTION "prevent_payment_execution_allocation_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PaymentExecutionAllocation is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionAllocation_immutable_trigger"
BEFORE UPDATE OR DELETE ON "PaymentExecutionAllocation"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_execution_allocation_mutation"();
