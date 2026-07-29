BEGIN;

SELECT pg_advisory_xact_lock(190731, 28);

ALTER TABLE "ContractTakeover"
  ADD COLUMN "activationIdempotencyKey" TEXT,
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "activatedByUserId" TEXT,
  ADD COLUMN "historicalInitialSettlementId" TEXT;

CREATE UNIQUE INDEX "ContractTakeover_activationIdempotencyKey_key"
  ON "ContractTakeover"("activationIdempotencyKey");
CREATE UNIQUE INDEX "ContractTakeover_historicalInitialSettlementId_key"
  ON "ContractTakeover"("historicalInitialSettlementId");

CREATE TABLE "ContractTakeoverContractFacts" (
  "takeoverId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "financeBasisRevision" INTEGER NOT NULL DEFAULT 1,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "historicalSettledCents" BIGINT NOT NULL DEFAULT 0,
  "zeroSettlementDeclared" BOOLEAN NOT NULL DEFAULT FALSE,
  "performanceStatus" TEXT NOT NULL,
  "settlementEvidenceSummary" TEXT,
  "paymentTermsSnapshot" JSONB NOT NULL,
  "contractFactsSnapshot" JSONB NOT NULL,
  "confirmedRevision" INTEGER,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "updatedByUserId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeoverContractFacts_pkey" PRIMARY KEY ("takeoverId"),
  CONSTRAINT "ContractTakeoverContractFacts_revision_check"
    CHECK ("revision" > 0 AND "financeBasisRevision" > 0),
  CONSTRAINT "ContractTakeoverContractFacts_performance_status_check"
    CHECK ("performanceStatus" IN ('not_started', 'performing', 'suspended', 'completed', 'terminated')),
  CONSTRAINT "ContractTakeoverContractFacts_settled_amount_check"
    CHECK ("historicalSettledCents" >= 0),
  CONSTRAINT "ContractTakeoverContractFacts_zero_settlement_check"
    CHECK (NOT "zeroSettlementDeclared" OR "historicalSettledCents" = 0),
  CONSTRAINT "ContractTakeoverContractFacts_confirmation_check"
    CHECK (
      (
        "confirmedRevision" IS NULL
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
      )
      OR (
        "confirmedRevision" = "revision"
        AND "confirmedByUserId" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
      )
    )
);

CREATE TABLE "ContractTakeoverFinanceFacts" (
  "takeoverId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "basedOnContractRevision" INTEGER NOT NULL,
  "basedOnFinanceBasisRevision" INTEGER NOT NULL,
  "zeroPaymentDeclared" BOOLEAN NOT NULL DEFAULT FALSE,
  "excessTreatment" TEXT,
  "excessReason" TEXT,
  "confirmedRevision" INTEGER,
  "confirmedContractRevision" INTEGER,
  "confirmedFinanceBasisRevision" INTEGER,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "updatedByUserId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeoverFinanceFacts_pkey" PRIMARY KEY ("takeoverId"),
  CONSTRAINT "ContractTakeoverFinanceFacts_revision_check"
    CHECK (
      "revision" > 0
      AND "basedOnContractRevision" > 0
      AND "basedOnFinanceBasisRevision" > 0
    ),
  CONSTRAINT "ContractTakeoverFinanceFacts_excess_treatment_check"
    CHECK (
      "excessTreatment" IS NULL
      OR "excessTreatment" IN ('historical_advance', 'abnormal_overpay')
    ),
  CONSTRAINT "ContractTakeoverFinanceFacts_excess_reason_check"
    CHECK ("excessTreatment" IS NULL OR NULLIF(BTRIM("excessReason"), '') IS NOT NULL),
  CONSTRAINT "ContractTakeoverFinanceFacts_confirmation_check"
    CHECK (
      (
        "confirmedRevision" IS NULL
        AND "confirmedContractRevision" IS NULL
        AND "confirmedFinanceBasisRevision" IS NULL
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
      )
      OR (
        "confirmedRevision" = "revision"
        AND "confirmedContractRevision" = "basedOnContractRevision"
        AND "confirmedFinanceBasisRevision" = "basedOnFinanceBasisRevision"
        AND "confirmedByUserId" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
      )
    )
);

CREATE TABLE "ContractTakeoverHistoricalPayment" (
  "id" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "rowKey" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "payerName" TEXT,
  "payeeName" TEXT,
  "bankReference" TEXT,
  "paymentMethod" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeoverHistoricalPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverHistoricalPayment_amount_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "ContractTakeoverHistoricalPayment_sequence_positive_check"
    CHECK ("sequenceNo" > 0),
  CONSTRAINT "ContractTakeoverHistoricalPayment_row_key_check"
    CHECK (NULLIF(BTRIM("rowKey"), '') IS NOT NULL),
  CONSTRAINT "ContractTakeoverHistoricalPayment_status_check"
    CHECK ("status" IN ('draft', 'confirmed', 'activated')),
  CONSTRAINT "ContractTakeoverHistoricalPayment_activation_check"
    CHECK (
      ("status" = 'activated' AND "activatedAt" IS NOT NULL)
      OR ("status" <> 'activated' AND "activatedAt" IS NULL)
    )
);

CREATE TABLE "ContractTakeoverHistoricalPaymentAllocation" (
  "id" TEXT NOT NULL,
  "historicalPaymentId" TEXT NOT NULL,
  "allocationType" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "allocationOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_amount_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_order_positive_check"
    CHECK ("allocationOrder" > 0),
  CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_type_check"
    CHECK ("allocationType" IN ('settlement', 'historical_advance', 'abnormal_overpay'))
);

CREATE TABLE "ContractTakeoverHistoricalPaymentVoucher" (
  "id" TEXT NOT NULL,
  "historicalPaymentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverHistoricalPaymentVoucher_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverHistoricalPaymentVoucher_order_check"
    CHECK ("displayOrder" >= 0)
);

CREATE TABLE "ContractTakeoverSettlementEvidence" (
  "id" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverSettlementEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverSettlementEvidence_order_check"
    CHECK ("displayOrder" >= 0)
);

CREATE TABLE "ContractTakeoverExcessEvidence" (
  "id" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverExcessEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverExcessEvidence_order_check"
    CHECK ("displayOrder" >= 0)
);

CREATE TABLE "ContractTakeoverSideSaveRequest" (
  "idempotencyKey" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "resultRevision" INTEGER NOT NULL,
  "requestSha256" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeoverSideSaveRequest_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "ContractTakeoverSideSaveRequest_side_check"
    CHECK ("side" IN ('contract', 'finance')),
  CONSTRAINT "ContractTakeoverSideSaveRequest_revision_check"
    CHECK ("expectedRevision" > 0 AND "resultRevision" > 0),
  CONSTRAINT "ContractTakeoverSideSaveRequest_ttl_check"
    CHECK (
      "expiresAt" > "createdAt"
      AND "expiresAt" <= "createdAt" + INTERVAL '7 days'
    )
);

CREATE TABLE "ContractTakeoverBalanceAccount" (
  "id" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "balanceType" TEXT NOT NULL,
  "openingCents" BIGINT NOT NULL,
  "balanceCents" BIGINT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeoverBalanceAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverBalanceAccount_type_check"
    CHECK ("balanceType" IN ('historical_advance', 'abnormal_overpay')),
  CONSTRAINT "ContractTakeoverBalanceAccount_opening_positive_check"
    CHECK ("openingCents" > 0),
  CONSTRAINT "ContractTakeoverBalanceAccount_balance_nonnegative_check"
    CHECK ("balanceCents" >= 0),
  CONSTRAINT "ContractTakeoverBalanceAccount_revision_check"
    CHECK ("revision" > 0)
);

CREATE TABLE "ContractTakeoverBalanceEntry" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "settlementId" TEXT,
  "historicalPaymentId" TEXT,
  "correctionId" TEXT,
  "reversesEntryId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverBalanceEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverBalanceEntry_kind_check"
    CHECK ("entryKind" IN ('opening', 'deduction', 'correction', 'reversal', 'reclassification')),
  CONSTRAINT "ContractTakeoverBalanceEntry_amount_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "ContractTakeoverBalanceEntry_reversal_shape_check"
    CHECK (
      ("entryKind" = 'reversal' AND "reversesEntryId" IS NOT NULL)
      OR ("entryKind" <> 'reversal' AND "reversesEntryId" IS NULL)
    )
);

CREATE TABLE "ContractTakeoverConfirmationEvent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "observedOtherSideRevision" INTEGER,
  "observedFinanceBasisRevision" INTEGER,
  "reason" TEXT,
  "actorUserId" TEXT NOT NULL,
  "responseSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverConfirmationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverConfirmationEvent_side_check"
    CHECK ("side" IN ('contract', 'finance')),
  CONSTRAINT "ContractTakeoverConfirmationEvent_action_check"
    CHECK ("action" IN ('confirm', 'withdraw')),
  CONSTRAINT "ContractTakeoverConfirmationEvent_revision_check"
    CHECK (
      "revision" > 0
      AND ("observedOtherSideRevision" IS NULL OR "observedOtherSideRevision" > 0)
      AND ("observedFinanceBasisRevision" IS NULL OR "observedFinanceBasisRevision" > 0)
    ),
  CONSTRAINT "ContractTakeoverConfirmationEvent_withdraw_reason_check"
    CHECK ("action" <> 'withdraw' OR NULLIF(BTRIM("reason"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "ContractTakeoverHistoricalPayment_takeoverId_rowKey_key"
  ON "ContractTakeoverHistoricalPayment"("takeoverId", "rowKey");
CREATE UNIQUE INDEX "ContractTakeoverHistoricalPayment_takeoverId_sequenceNo_key"
  ON "ContractTakeoverHistoricalPayment"("takeoverId", "sequenceNo");
CREATE INDEX "ContractTakeoverHistoricalPayment_takeoverId_status_idx"
  ON "ContractTakeoverHistoricalPayment"("takeoverId", "status");

CREATE UNIQUE INDEX "ContractTakeoverHistoricalPaymentAllocation_payment_order_key"
  ON "ContractTakeoverHistoricalPaymentAllocation"("historicalPaymentId", "allocationOrder");
CREATE INDEX "ContractTakeoverHistoricalPaymentAllocation_payment_idx"
  ON "ContractTakeoverHistoricalPaymentAllocation"("historicalPaymentId");

CREATE UNIQUE INDEX "ContractTakeoverHistoricalPaymentVoucher_fileId_key"
  ON "ContractTakeoverHistoricalPaymentVoucher"("fileId");
CREATE UNIQUE INDEX "ContractTakeoverHistoricalPaymentVoucher_payment_order_key"
  ON "ContractTakeoverHistoricalPaymentVoucher"("historicalPaymentId", "displayOrder");
CREATE INDEX "ContractTakeoverHistoricalPaymentVoucher_payment_idx"
  ON "ContractTakeoverHistoricalPaymentVoucher"("historicalPaymentId");
CREATE INDEX "ContractTakeoverHistoricalPaymentVoucher_uploadedByUserId_idx"
  ON "ContractTakeoverHistoricalPaymentVoucher"("uploadedByUserId");

CREATE UNIQUE INDEX "ContractTakeoverSettlementEvidence_fileId_key"
  ON "ContractTakeoverSettlementEvidence"("fileId");
CREATE UNIQUE INDEX "ContractTakeoverSettlementEvidence_takeover_order_key"
  ON "ContractTakeoverSettlementEvidence"("takeoverId", "displayOrder");
CREATE INDEX "ContractTakeoverSettlementEvidence_takeoverId_idx"
  ON "ContractTakeoverSettlementEvidence"("takeoverId");
CREATE INDEX "ContractTakeoverSettlementEvidence_createdByUserId_idx"
  ON "ContractTakeoverSettlementEvidence"("createdByUserId");

CREATE UNIQUE INDEX "ContractTakeoverExcessEvidence_fileId_key"
  ON "ContractTakeoverExcessEvidence"("fileId");
CREATE UNIQUE INDEX "ContractTakeoverExcessEvidence_takeover_order_key"
  ON "ContractTakeoverExcessEvidence"("takeoverId", "displayOrder");
CREATE INDEX "ContractTakeoverExcessEvidence_takeoverId_idx"
  ON "ContractTakeoverExcessEvidence"("takeoverId");
CREATE INDEX "ContractTakeoverExcessEvidence_createdByUserId_idx"
  ON "ContractTakeoverExcessEvidence"("createdByUserId");

CREATE INDEX "ContractTakeoverSideSaveRequest_takeover_side_created_idx"
  ON "ContractTakeoverSideSaveRequest"("takeoverId", "side", "createdAt");
CREATE INDEX "ContractTakeoverSideSaveRequest_createdByUserId_idx"
  ON "ContractTakeoverSideSaveRequest"("createdByUserId");
CREATE INDEX "ContractTakeoverSideSaveRequest_expiresAt_idx"
  ON "ContractTakeoverSideSaveRequest"("expiresAt");

CREATE UNIQUE INDEX "ContractTakeoverBalanceAccount_takeover_type_key"
  ON "ContractTakeoverBalanceAccount"("takeoverId", "balanceType");
CREATE INDEX "ContractTakeoverBalanceAccount_takeoverId_idx"
  ON "ContractTakeoverBalanceAccount"("takeoverId");

CREATE UNIQUE INDEX "ContractTakeoverBalanceEntry_reversesEntryId_key"
  ON "ContractTakeoverBalanceEntry"("reversesEntryId");
CREATE UNIQUE INDEX "ContractTakeoverBalanceEntry_idempotencyKey_key"
  ON "ContractTakeoverBalanceEntry"("idempotencyKey");
CREATE INDEX "ContractTakeoverBalanceEntry_account_created_idx"
  ON "ContractTakeoverBalanceEntry"("accountId", "createdAt");
CREATE INDEX "ContractTakeoverBalanceEntry_settlementId_idx"
  ON "ContractTakeoverBalanceEntry"("settlementId");
CREATE INDEX "ContractTakeoverBalanceEntry_historicalPaymentId_idx"
  ON "ContractTakeoverBalanceEntry"("historicalPaymentId");
CREATE INDEX "ContractTakeoverBalanceEntry_correctionId_idx"
  ON "ContractTakeoverBalanceEntry"("correctionId");
CREATE INDEX "ContractTakeoverBalanceEntry_createdByUserId_idx"
  ON "ContractTakeoverBalanceEntry"("createdByUserId");

CREATE UNIQUE INDEX "ContractTakeoverConfirmationEvent_idempotencyKey_key"
  ON "ContractTakeoverConfirmationEvent"("idempotencyKey");
CREATE INDEX "ContractTakeoverConfirmationEvent_takeover_side_created_idx"
  ON "ContractTakeoverConfirmationEvent"("takeoverId", "side", "createdAt");
CREATE INDEX "ContractTakeoverConfirmationEvent_actorUserId_idx"
  ON "ContractTakeoverConfirmationEvent"("actorUserId");

ALTER TABLE "ContractTakeover"
  ADD CONSTRAINT "ContractTakeover_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeover_historicalInitialSettlementId_fkey"
  FOREIGN KEY ("historicalInitialSettlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeover_activation_tuple_check"
  CHECK (
    (
      "activationIdempotencyKey" IS NULL
      AND "activatedAt" IS NULL
      AND "activatedByUserId" IS NULL
      AND "historicalInitialSettlementId" IS NULL
    )
    OR (
      "activationIdempotencyKey" IS NOT NULL
      AND "activatedAt" IS NOT NULL
      AND "activatedByUserId" IS NOT NULL
      AND "historicalInitialSettlementId" IS NOT NULL
    )
  );

ALTER TABLE "ContractTakeoverContractFacts"
  ADD CONSTRAINT "ContractTakeoverContractFacts_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverContractFacts_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverContractFacts_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverFinanceFacts"
  ADD CONSTRAINT "ContractTakeoverFinanceFacts_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverFinanceFacts_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverFinanceFacts_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverHistoricalPayment"
  ADD CONSTRAINT "ContractTakeoverHistoricalPayment_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverHistoricalPaymentAllocation"
  ADD CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_paymentId_fkey"
  FOREIGN KEY ("historicalPaymentId") REFERENCES "ContractTakeoverHistoricalPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverHistoricalPaymentVoucher"
  ADD CONSTRAINT "ContractTakeoverHistoricalPaymentVoucher_paymentId_fkey"
  FOREIGN KEY ("historicalPaymentId") REFERENCES "ContractTakeoverHistoricalPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverHistoricalPaymentVoucher_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverHistoricalPaymentVoucher_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverSettlementEvidence"
  ADD CONSTRAINT "ContractTakeoverSettlementEvidence_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverSettlementEvidence_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverSettlementEvidence_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverExcessEvidence"
  ADD CONSTRAINT "ContractTakeoverExcessEvidence_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverExcessEvidence_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverExcessEvidence_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverSideSaveRequest"
  ADD CONSTRAINT "ContractTakeoverSideSaveRequest_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverSideSaveRequest_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverBalanceAccount"
  ADD CONSTRAINT "ContractTakeoverBalanceAccount_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverBalanceEntry"
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ContractTakeoverBalanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_historicalPaymentId_fkey"
  FOREIGN KEY ("historicalPaymentId") REFERENCES "ContractTakeoverHistoricalPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_correctionId_fkey"
  FOREIGN KEY ("correctionId") REFERENCES "ContractTakeoverCorrection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "ContractTakeoverBalanceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverBalanceEntry_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractTakeoverConfirmationEvent"
  ADD CONSTRAINT "ContractTakeoverConfirmationEvent_takeoverId_fkey"
  FOREIGN KEY ("takeoverId") REFERENCES "ContractTakeover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverConfirmationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION jg_assert_contract_takeover_payment_allocation_total(
  candidate_payment_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  payment_amount BIGINT;
  allocated_amount BIGINT;
BEGIN
  SELECT "amountCents"
    INTO payment_amount
    FROM "ContractTakeoverHistoricalPayment"
    WHERE "id" = candidate_payment_id;

  IF FOUND THEN
    SELECT COALESCE(SUM("amountCents"), 0)
      INTO allocated_amount
      FROM "ContractTakeoverHistoricalPaymentAllocation"
      WHERE "historicalPaymentId" = candidate_payment_id;

    IF allocated_amount <> payment_amount THEN
      RAISE EXCEPTION
        'historical payment % allocation total % must equal payment amount %',
        candidate_payment_id,
        allocated_amount,
        payment_amount
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION jg_check_contract_takeover_payment_allocation_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'ContractTakeoverHistoricalPayment' THEN
    IF TG_OP <> 'DELETE' THEN
      PERFORM jg_assert_contract_takeover_payment_allocation_total(NEW."id");
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM jg_assert_contract_takeover_payment_allocation_total(OLD."id");
    END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM jg_assert_contract_takeover_payment_allocation_total(
        NEW."historicalPaymentId"
      );
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM jg_assert_contract_takeover_payment_allocation_total(
        OLD."historicalPaymentId"
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER jg_check_contract_takeover_payment_allocation_total_on_payment
AFTER INSERT OR UPDATE OF "amountCents" OR DELETE
ON "ContractTakeoverHistoricalPayment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION jg_check_contract_takeover_payment_allocation_total();

CREATE CONSTRAINT TRIGGER jg_check_contract_takeover_payment_allocation_total_on_allocation
AFTER INSERT OR UPDATE OF "historicalPaymentId", "amountCents" OR DELETE
ON "ContractTakeoverHistoricalPaymentAllocation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION jg_check_contract_takeover_payment_allocation_total();

CREATE OR REPLACE FUNCTION jg_guard_contract_takeover_balance_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  locked_balance BIGINT;
  original_entry RECORD;
BEGIN
  SELECT "balanceCents"
    INTO locked_balance
    FROM "ContractTakeoverBalanceAccount"
    WHERE "id" = NEW."accountId"
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'takeover balance account % does not exist', NEW."accountId"
      USING ERRCODE = '23503';
  END IF;

  IF NEW."entryKind" = 'deduction' AND NEW."amountCents" > locked_balance THEN
    RAISE EXCEPTION
      'takeover balance deduction % exceeds locked balance %',
      NEW."amountCents",
      locked_balance
      USING ERRCODE = '23514';
  END IF;

  IF NEW."entryKind" = 'reversal' THEN
    SELECT "accountId", "entryKind", "amountCents"
      INTO original_entry
      FROM "ContractTakeoverBalanceEntry"
      WHERE "id" = NEW."reversesEntryId"
      FOR UPDATE;

    IF NOT FOUND
       OR original_entry."accountId" <> NEW."accountId"
       OR original_entry."entryKind" = 'reversal'
       OR original_entry."amountCents" <> NEW."amountCents" THEN
      RAISE EXCEPTION 'reversal must reference one unreversed entry in the same account'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER jg_guard_contract_takeover_balance_entry
BEFORE INSERT ON "ContractTakeoverBalanceEntry"
FOR EACH ROW EXECUTE FUNCTION jg_guard_contract_takeover_balance_entry();

-- Append the three authoritative takeover evidence bindings to the unified
-- FileObject registry. The new tables are empty, so this is additive and does
-- not infer or rewrite any legacy voucher ownership.
CREATE OR REPLACE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  VALUES
    ('User','signatureFileId',FALSE), ('HandwrittenSignatureVersion','fileId',FALSE),
    ('ContractVersion','taxFactEvidenceFileId',FALSE), ('ContractTaxFactRevision','evidenceFileId',FALSE),
    ('ContractTakeoverCorrection','attachmentFileId',FALSE), ('ContractArchiveFile','fileId',FALSE),
    ('ContractFormalFile','fileId',FALSE), ('ContractAuthorization','fileId',FALSE),
    ('Settlement','preparerSignatureFileId',FALSE), ('SettlementSignedDocument','fileId',FALSE),
    ('SettlementSignedDocumentGenerationClaim','uploadedFileId',FALSE), ('SettlementImport','fileId',FALSE),
    ('SettlementTemplateVersion','xlsxFileId',FALSE), ('SettlementTemplateVersion','previewXlsxFileId',FALSE),
    ('SettlementTemplateVersion','previewPdfFileId',FALSE), ('SettlementTemplatePreviewJob','previewXlsxFileId',FALSE),
    ('SettlementTemplatePreviewJob','previewPdfFileId',FALSE), ('SettlementArchiveFile','fileId',FALSE),
    ('SettlementLineAttachment','fileId',FALSE), ('SettlementRecoveryEntry','evidenceFileId',TRUE),
    ('PaymentExecution','voucherFileId',FALSE), ('SpotProcurementAttachment','fileId',FALSE),
    ('SpotProcurementPayment','supportingAttachmentFileId',FALSE), ('SpotProcurementPayment','merchantPaymentProofFileId',FALSE),
    ('SpotProcurementPaymentExecution','voucherFileId',TRUE), ('SpotProcurementPaymentAttachment','fileId',TRUE),
    ('SpotProcurementPaymentExecutionVoucher','fileId',TRUE), ('SpotProcurementPaymentInvoice','fileId',TRUE),
    ('SpotProcurementPaymentArchive','generatedPackageFileId',FALSE), ('SpotProcurementPaymentArchiveFile','fileId',FALSE),
    ('SpotProcurementReceiptPhoto','originalFileId',TRUE), ('SpotProcurementReceiptPhoto','watermarkedFileId',TRUE),
    ('SpotProcurementRefund','voucherFileId',TRUE), ('InvoiceRecord','fileId',TRUE),
    ('NoInvoiceConfirmation','proofFileId',TRUE), ('InvoiceExceptionConfirmation','proofFileId',TRUE),
    ('ProjectExpenseRequest','attachmentFileId',FALSE), ('ExpenseClaimAttachment','fileId',TRUE),
    ('ExpenseClaimPaymentExecution','voucherFileId',TRUE), ('ProjectExpenseExecution','voucherFileId',FALSE),
    ('ProjectReceipt','voucherFileId',FALSE), ('ProjectProxyPayment','voucherFileId',FALSE),
    ('ProjectUpstreamSettlement','voucherFileId',FALSE), ('ProjectOwnerContract','fileId',FALSE),
    ('ProjectSettlementExceptionQuota','attachmentFileId',FALSE), ('ProjectFinancingQuota','attachmentFileId',FALSE),
    ('EmployeeLoanRepayment','voucherFileId',FALSE), ('EmployeeProjectLoanEntry','voucherFileId',FALSE),
    ('ApprovalActionLog','signatureFileIdSnapshot',FALSE), ('ArchiveRecord','fileId',FALSE), ('PdfDocument','fileId',FALSE),
    ('ApprovalFormGenerationClaim','uploadedFileId',FALSE), ('ContractLayoutTemplateVersion','docxFileId',FALSE),
    ('ContractLayoutTemplateVersion','previewPdfFileId',FALSE), ('ContractLayoutPreviewJob','previewPdfFileId',FALSE),
    ('ContractBill','sourceExcelFileId',FALSE), ('ContractBillImport','fileId',FALSE),
    ('ContractDraftAttachment','fileId',FALSE),
    ('ContractGeneratedDocument','docxFileId',FALSE), ('ContractGeneratedDocument','pdfFileId',FALSE),
    ('ContractOfflineRevision','fileId',FALSE), ('ContractOfflineRevision','previewPdfFileId',FALSE),
    ('ContractTakeoverSettlementEvidence','fileId',TRUE),
    ('ContractTakeoverExcessEvidence','fileId',TRUE),
    ('ContractTakeoverHistoricalPaymentVoucher','fileId',TRUE);
$$;

CREATE TRIGGER jg_efb_contract_takeover_settlement_evidence
BEFORE INSERT OR UPDATE OF "fileId" ON "ContractTakeoverSettlementEvidence"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

CREATE TRIGGER jg_efb_contract_takeover_excess_evidence
BEFORE INSERT OR UPDATE OF "fileId" ON "ContractTakeoverExcessEvidence"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

CREATE TRIGGER jg_efb_contract_takeover_historical_payment_voucher
BEFORE INSERT OR UPDATE OF "fileId" ON "ContractTakeoverHistoricalPaymentVoucher"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

COMMIT;
