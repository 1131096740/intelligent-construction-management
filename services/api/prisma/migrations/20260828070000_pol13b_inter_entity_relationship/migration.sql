-- POL-13B: cross-entity proxy payment relationship. This is an append-only
-- business effect over an existing PaymentExecution; it never creates a
-- second payment fact or rewrites the original payable.
CREATE TABLE "InterEntityRelationshipEntry" (
  "id" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "adjustsEntryId" TEXT,
  "paymentExecutionId" TEXT,
  "settlementCaseId" TEXT,
  "originalDebtorCompanyId" TEXT NOT NULL,
  "creditorCompanyId" TEXT NOT NULL,
  "approvedPayerCompanyId" TEXT NOT NULL,
  "debtorSnapshot" JSONB NOT NULL,
  "creditorSnapshot" JSONB NOT NULL,
  "approvedPayerSnapshot" JSONB NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "evidenceFileId" TEXT NOT NULL,
  "reason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "InterEntityRelationshipEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InterEntityRelationshipEntry_kind_check"
    CHECK ("entryKind" IN ('proxy_payment', 'proxy_return')),
  CONSTRAINT "InterEntityRelationshipEntry_direction_check"
    CHECK ("direction" IN ('increase', 'decrease')),
  CONSTRAINT "InterEntityRelationshipEntry_status_check"
    CHECK ("status" IN ('draft', 'confirmed')),
  CONSTRAINT "InterEntityRelationshipEntry_amount_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "InterEntityRelationshipEntry_currency_check"
    CHECK ("currencyCode" = 'CNY'),
  CONSTRAINT "InterEntityRelationshipEntry_subject_check"
    CHECK (
      btrim("originalDebtorCompanyId") <> ''
      AND btrim("creditorCompanyId") <> ''
      AND btrim("approvedPayerCompanyId") <> ''
      AND "originalDebtorCompanyId" <> "creditorCompanyId"
    ),
  CONSTRAINT "InterEntityRelationshipEntry_reference_check"
    CHECK (btrim("evidenceFileId") <> '' AND btrim("idempotencyKey") <> ''),
  CONSTRAINT "InterEntityRelationshipEntry_shape_check"
    CHECK (
      ("entryKind" = 'proxy_payment'
       AND "direction" = 'increase'
       AND "adjustsEntryId" IS NULL
       AND "paymentExecutionId" IS NOT NULL
       AND "settlementCaseId" IS NOT NULL)
      OR
      ("entryKind" = 'proxy_return'
       AND "direction" = 'decrease'
       AND "adjustsEntryId" IS NOT NULL
       AND "paymentExecutionId" IS NULL
       AND "settlementCaseId" IS NULL)
    )
);

CREATE UNIQUE INDEX "InterEntityRelationshipEntry_idempotencyKey_key"
  ON "InterEntityRelationshipEntry"("idempotencyKey");
CREATE UNIQUE INDEX "InterEntityRelationshipEntry_case_kind_key"
  ON "InterEntityRelationshipEntry"("settlementCaseId", "entryKind");
CREATE INDEX "InterEntityRelationshipEntry_adjustsEntryId_idx"
  ON "InterEntityRelationshipEntry"("adjustsEntryId");
CREATE INDEX "InterEntityRelationshipEntry_debtor_creditor_createdAt_idx"
  ON "InterEntityRelationshipEntry"("originalDebtorCompanyId", "creditorCompanyId", "createdAt");
CREATE INDEX "InterEntityRelationshipEntry_paymentExecutionId_idx"
  ON "InterEntityRelationshipEntry"("paymentExecutionId");
CREATE INDEX "InterEntityRelationshipEntry_settlementCaseId_idx"
  ON "InterEntityRelationshipEntry"("settlementCaseId");

ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_payment_execution_fkey"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_settlement_case_fkey"
  FOREIGN KEY ("settlementCaseId") REFERENCES "PayableSettlementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_adjusts_entry_fkey"
  FOREIGN KEY ("adjustsEntryId") REFERENCES "InterEntityRelationshipEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relationship rows are append-only facts. A direct writer can insert only an
-- inert draft; the service must perform the audited status transition inside
-- its serializable transaction. Once confirmed, every source/subject/evidence
-- field is immutable and a return must be a new decrease row.
CREATE FUNCTION guard_inter_entity_relationship_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."status" := 'draft';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_append_only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'confirmed' THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_immutable';
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."entryKind" <> OLD."entryKind"
       OR NEW."direction" <> OLD."direction"
       OR NEW."adjustsEntryId" IS DISTINCT FROM OLD."adjustsEntryId"
       OR NEW."paymentExecutionId" IS DISTINCT FROM OLD."paymentExecutionId"
       OR NEW."settlementCaseId" IS DISTINCT FROM OLD."settlementCaseId"
       OR NEW."originalDebtorCompanyId" <> OLD."originalDebtorCompanyId"
       OR NEW."creditorCompanyId" <> OLD."creditorCompanyId"
       OR NEW."approvedPayerCompanyId" <> OLD."approvedPayerCompanyId"
       OR NEW."debtorSnapshot" IS DISTINCT FROM OLD."debtorSnapshot"
       OR NEW."creditorSnapshot" IS DISTINCT FROM OLD."creditorSnapshot"
       OR NEW."approvedPayerSnapshot" IS DISTINCT FROM OLD."approvedPayerSnapshot"
       OR NEW."amountCents" <> OLD."amountCents"
       OR NEW."currencyCode" <> OLD."currencyCode"
       OR NEW."evidenceFileId" <> OLD."evidenceFileId"
       OR NEW."reason" IS DISTINCT FROM OLD."reason"
       OR NEW."idempotencyKey" <> OLD."idempotencyKey"
       OR NEW."payloadFingerprint" <> OLD."payloadFingerprint"
       OR NEW."createdByUserId" <> OLD."createdByUserId"
       OR NEW."createdAt" <> OLD."createdAt" THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_identity_immutable';
    END IF;
    IF OLD."status" <> 'draft' OR NEW."status" <> 'confirmed' THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_transition_invalid';
    END IF;
  END IF;
  IF NEW."status" = 'draft'
     AND (NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_draft_audit_invalid';
  END IF;
  IF NEW."status" = 'confirmed'
     AND (NEW."confirmedByUserId" IS NULL OR NEW."confirmedAt" IS NULL) THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_confirmation_audit_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inter_entity_relationship_entry_guard
BEFORE INSERT OR UPDATE OR DELETE ON "InterEntityRelationshipEntry"
FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_entry();
