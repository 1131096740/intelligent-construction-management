BEGIN;

-- CreateTable
CREATE TABLE "CompanyHistoryExpenseBatch" (
    "id" TEXT NOT NULL,
    "companyEntityId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "importFingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "confirmedRevision" INTEGER,
    "confirmationKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHistoryExpenseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHistoryExpenseRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "businessRef" TEXT NOT NULL,
    "occurredAt" DATE NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidCents" BIGINT,
    "paymentStatus" TEXT NOT NULL,
    "costCategoryCode" TEXT NOT NULL,
    "valuesSnapshot" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "duplicateStatus" TEXT NOT NULL,
    "duplicateNote" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewConclusion" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "correctedRowId" TEXT,

    CONSTRAINT "CompanyHistoryExpenseRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHistoryExpenseFact" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "companyEntityId" TEXT NOT NULL,
    "companyNameSnapshot" TEXT NOT NULL,
    "companyCreditCodeSnapshot" TEXT NOT NULL,
    "companyVersionNoSnapshot" INTEGER NOT NULL,
    "entryKind" TEXT NOT NULL,
    "adjustsFactId" TEXT,
    "businessRef" TEXT NOT NULL,
    "occurredAt" DATE NOT NULL,
    "costCategoryCode" TEXT NOT NULL,
    "costCents" BIGINT NOT NULL,
    "paidCents" BIGINT,
    "outstandingCents" BIGINT,
    "paymentStatus" TEXT NOT NULL,
    "valuesSnapshot" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHistoryExpenseFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseBatch_confirmationKey_key" ON "CompanyHistoryExpenseBatch"("confirmationKey");

-- CreateIndex
CREATE INDEX "CompanyHistoryExpenseBatch_companyEntityId_createdAt_idx" ON "CompanyHistoryExpenseBatch"("companyEntityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseBatch_company_import_key" ON "CompanyHistoryExpenseBatch"("companyEntityId", "importFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseBatch_company_no_key" ON "CompanyHistoryExpenseBatch"("companyEntityId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseBatch_id_company_key" ON "CompanyHistoryExpenseBatch"("id", "companyEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseRow_correctedRowId_key" ON "CompanyHistoryExpenseRow"("correctedRowId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseRow_batchId_rowNo_key" ON "CompanyHistoryExpenseRow"("batchId", "rowNo");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseRow_id_batch_key" ON "CompanyHistoryExpenseRow"("id", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseRow_corrected_batch_key" ON "CompanyHistoryExpenseRow"("correctedRowId", "batchId");

-- CreateIndex
CREATE INDEX "CompanyHistoryExpenseFact_companyEntityId_occurredAt_id_idx" ON "CompanyHistoryExpenseFact"("companyEntityId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseFact_rowId_entryKind_key" ON "CompanyHistoryExpenseFact"("rowId", "entryKind");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseFact_adjusts_kind_key" ON "CompanyHistoryExpenseFact"("adjustsFactId", "entryKind");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHistoryExpenseFact_id_batch_key" ON "CompanyHistoryExpenseFact"("id", "batchId");

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseBatch" ADD CONSTRAINT "CompanyHistoryExpenseBatch_companyEntityId_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseRow" ADD CONSTRAINT "CompanyHistoryExpenseRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CompanyHistoryExpenseBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseRow" ADD CONSTRAINT "CompanyHistoryExpenseRow_correctedRowId_batchId_fkey" FOREIGN KEY ("correctedRowId", "batchId") REFERENCES "CompanyHistoryExpenseRow"("id", "batchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseFact" ADD CONSTRAINT "CompanyHistoryExpenseFact_batchId_companyEntityId_fkey" FOREIGN KEY ("batchId", "companyEntityId") REFERENCES "CompanyHistoryExpenseBatch"("id", "companyEntityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseFact" ADD CONSTRAINT "CompanyHistoryExpenseFact_rowId_batchId_fkey" FOREIGN KEY ("rowId", "batchId") REFERENCES "CompanyHistoryExpenseRow"("id", "batchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CompanyHistoryExpenseFact" ADD CONSTRAINT "CompanyHistoryExpenseFact_adjustsFactId_batchId_fkey" FOREIGN KEY ("adjustsFactId", "batchId") REFERENCES "CompanyHistoryExpenseFact"("id", "batchId") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Source identity is checked across batches; reversal and replacement have their
-- own lineage keys and must not consume another original-source slot.
CREATE UNIQUE INDEX "CompanyHistoryExpenseFact_original_source_key"
ON "CompanyHistoryExpenseFact" ("companyEntityId", "businessRef", "occurredAt", "costCents")
WHERE "entryKind" = 'original';

ALTER TABLE "CompanyHistoryExpenseRow" ADD CONSTRAINT "CompanyHistoryExpenseRow_review_check"
CHECK ("reviewStatus" IN ('pending', 'verified', 'not_occurred', 'activated')
  AND ("reviewStatus" <> 'not_occurred' OR "amountCents" = 0)
  AND ("reviewStatus" NOT IN ('verified', 'activated') OR "amountCents" > 0)
  AND ("correctedRowId" IS NULL OR ("correctedRowId" <> "id" AND "reviewStatus" = 'activated')));

ALTER TABLE "CompanyHistoryExpenseFact" ADD CONSTRAINT "CompanyHistoryExpenseFact_entry_check"
CHECK (
  ("entryKind" = 'original' AND "adjustsFactId" IS NULL AND "costCents" > 0)
  OR ("entryKind" = 'replacement' AND "adjustsFactId" IS NOT NULL AND "costCents" > 0)
  OR ("entryKind" = 'reversal' AND "adjustsFactId" IS NOT NULL AND "costCents" < 0)
);
ALTER TABLE "CompanyHistoryExpenseFact" ADD CONSTRAINT "CompanyHistoryExpenseFact_payment_check"
CHECK (
  ("paymentStatus" = 'paid' AND "paidCents" IS NOT NULL AND "paidCents" = "costCents"
    AND "outstandingCents" IS NOT NULL AND "outstandingCents" = 0)
  OR ("paymentStatus" = 'unpaid' AND "paidCents" IS NULL
    AND "outstandingCents" IS NOT NULL AND "outstandingCents" = "costCents")
  OR ("paymentStatus" = 'partially_paid' AND "paidCents" IS NOT NULL AND "outstandingCents" IS NOT NULL
    AND abs("paidCents"::numeric) > 0 AND abs("paidCents"::numeric) < abs("costCents"::numeric)
    AND sign("paidCents") = sign("costCents") AND "paidCents" + "outstandingCents" = "costCents")
  OR ("paymentStatus" = 'unknown' AND "paidCents" IS NULL AND "outstandingCents" IS NULL)
);

CREATE FUNCTION public.jg_company_history_expense_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'company historical expense accounting entries are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "CompanyHistoryExpenseFact_immutable"
BEFORE UPDATE OR DELETE ON "CompanyHistoryExpenseFact"
FOR EACH ROW EXECUTE FUNCTION public.jg_company_history_expense_immutable();

CREATE TRIGGER "CompanyHistoryExpenseRow_posted_immutable"
BEFORE UPDATE OR DELETE ON "CompanyHistoryExpenseRow"
FOR EACH ROW WHEN (OLD."reviewStatus" = 'activated')
EXECUTE FUNCTION public.jg_company_history_expense_immutable();

COMMIT;
