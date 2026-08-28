-- POL-13A: closed generic payable-settlement cases reference the existing
-- PaymentExecution fact. No bank-payment table is introduced here.
CREATE TABLE "PayableSettlementCase" (
  "id" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedesCaseId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "confirmedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayableSettlementCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayableSettlementCase_status_check" CHECK ("status" IN ('draft', 'submitted', 'review_returned', 'confirmed')),
  CONSTRAINT "PayableSettlementCase_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "PayableSettlementAllocation" (
  "id" TEXT NOT NULL,
  "settlementCaseId" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "payableRef" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceAggregateId" TEXT NOT NULL,
  "sourceLineId" TEXT NOT NULL,
  "confirmedVersionId" TEXT NOT NULL,
  "debtorCompanyId" TEXT NOT NULL,
  "payeeSubjectType" TEXT NOT NULL,
  "payeeSubjectId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "beneficiaryProjectId" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "confirmedAmountCents" BIGINT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayableSettlementAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayableSettlementAllocation_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "PayableSettlementAllocation_confirmed_amount_check" CHECK ("confirmedAmountCents" > 0),
  CONSTRAINT "PayableSettlementAllocation_currency_check" CHECK ("currencyCode" = 'CNY')
);

CREATE TABLE "PayableSettlementCommandReceipt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "settlementCaseId" TEXT,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayableSettlementCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayableSettlementCase_execution_revision_key"
  ON "PayableSettlementCase"("paymentExecutionId", "revision");
CREATE INDEX "PayableSettlementCase_status_updatedAt_idx"
  ON "PayableSettlementCase"("status", "updatedAt");
CREATE INDEX "PayableSettlementCase_supersedesCaseId_idx"
  ON "PayableSettlementCase"("supersedesCaseId");
CREATE UNIQUE INDEX "PayableSettlementAllocation_case_payable_ref_key"
  ON "PayableSettlementAllocation"("settlementCaseId", "payableRef");
CREATE INDEX "PayableSettlementAllocation_payableRef_createdAt_idx"
  ON "PayableSettlementAllocation"("payableRef", "createdAt");
CREATE INDEX "PayableSettlementAllocation_paymentExecutionId_idx"
  ON "PayableSettlementAllocation"("paymentExecutionId");
CREATE UNIQUE INDEX "PayableSettlementCommandReceipt_idempotencyKey_key"
  ON "PayableSettlementCommandReceipt"("idempotencyKey");
CREATE INDEX "PayableSettlementCommandReceipt_settlementCaseId_idx"
  ON "PayableSettlementCommandReceipt"("settlementCaseId");

ALTER TABLE "PayableSettlementCase"
  ADD CONSTRAINT "PayableSettlementCase_payment_execution_fkey"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayableSettlementCase"
  ADD CONSTRAINT "PayableSettlementCase_supersedes_case_fkey"
  FOREIGN KEY ("supersedesCaseId") REFERENCES "PayableSettlementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayableSettlementAllocation"
  ADD CONSTRAINT "PayableSettlementAllocation_settlement_case_fkey"
  FOREIGN KEY ("settlementCaseId") REFERENCES "PayableSettlementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayableSettlementAllocation"
  ADD CONSTRAINT "PayableSettlementAllocation_payment_execution_fkey"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayableSettlementCommandReceipt"
  ADD CONSTRAINT "PayableSettlementCommandReceipt_settlement_case_fkey"
  FOREIGN KEY ("settlementCaseId") REFERENCES "PayableSettlementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Submitted payloads are frozen. A returned or confirmed case is terminal;
-- corrections create a new revision instead of rewriting the old payload.
CREATE FUNCTION guard_confirmed_payable_settlement_case()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'payable_settlement_frozen_case_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IN ('confirmed', 'review_returned') THEN
      RAISE EXCEPTION 'payable_settlement_confirmed_case_immutable';
    END IF;
    IF NEW."paymentExecutionId" <> OLD."paymentExecutionId"
       OR NEW."createdByUserId" <> OLD."createdByUserId"
       OR NEW."createdAt" <> OLD."createdAt"
       OR NEW."supersedesCaseId" IS DISTINCT FROM OLD."supersedesCaseId" THEN
      RAISE EXCEPTION 'payable_settlement_case_identity_immutable';
    END IF;
    IF OLD."status" = 'submitted'
       AND (NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId"
         OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") THEN
      RAISE EXCEPTION 'payable_settlement_submitted_audit_immutable';
    END IF;
    IF OLD."status" = 'submitted' AND NEW."status" NOT IN ('confirmed', 'review_returned') THEN
      RAISE EXCEPTION 'payable_settlement_submitted_transition_invalid';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'payable_settlement_draft_transition_invalid';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 THEN
      RAISE EXCEPTION 'payable_settlement_revision_invalid';
    END IF;
  END IF;
  IF (NEW."status" = 'draft'
        AND (NEW."submittedByUserId" IS NOT NULL OR NEW."submittedAt" IS NOT NULL
          OR NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL))
     OR (NEW."status" = 'submitted'
        AND (NEW."submittedByUserId" IS NULL OR NEW."submittedAt" IS NULL
          OR NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL))
     OR (NEW."status" = 'confirmed'
        AND (NEW."submittedByUserId" IS NULL OR NEW."submittedAt" IS NULL
          OR NEW."confirmedByUserId" IS NULL OR NEW."confirmedAt" IS NULL))
     OR (NEW."status" = 'review_returned'
        AND (NEW."submittedByUserId" IS NULL OR NEW."submittedAt" IS NULL
          OR NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'payable_settlement_state_audit_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_confirmed_payable_settlement_allocation()
RETURNS TRIGGER AS $$
DECLARE
  case_status TEXT;
  case_payment_execution_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."settlementCaseId" <> OLD."settlementCaseId" THEN
    RAISE EXCEPTION 'payable_settlement_allocation_case_immutable';
  END IF;
  SELECT "status", "paymentExecutionId"
  INTO case_status, case_payment_execution_id
  FROM "PayableSettlementCase"
  WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."settlementCaseId" ELSE OLD."settlementCaseId" END;
  IF case_status IS NULL THEN
    RAISE EXCEPTION 'payable_settlement_case_missing';
  END IF;
  IF case_status <> 'draft' THEN
    RAISE EXCEPTION 'payable_settlement_confirmed_allocation_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF case_payment_execution_id <> NEW."paymentExecutionId" THEN
    RAISE EXCEPTION 'payable_settlement_allocation_execution_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayableSettlementCase_confirmed_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "PayableSettlementCase"
  FOR EACH ROW EXECUTE FUNCTION guard_confirmed_payable_settlement_case();
CREATE TRIGGER "PayableSettlementAllocation_confirmed_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "PayableSettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION guard_confirmed_payable_settlement_allocation();
