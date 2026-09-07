-- POL-11B-REPAIR: add the aggregate revision and immutable creation-time tax
-- snapshot without inventing values for historical invoice facts.
ALTER TABLE "InvoiceRecord"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxRateSnapshot" DECIMAL(9, 6);

ALTER TABLE "InvoiceRecord"
  ADD CONSTRAINT "InvoiceRecord_revision_non_negative"
    CHECK ("revision" >= 0),
  ADD CONSTRAINT "InvoiceRecord_tax_rate_snapshot_range"
    CHECK (
      "taxRateSnapshot" IS NULL
      OR ("taxRateSnapshot" >= 0 AND "taxRateSnapshot" <= 100)
    );

-- Extend the existing immutable legal-fact guard after the new snapshot column
-- exists. Keep every comparison from the original guard and add only the
-- creation-time tax snapshot; aggregate revision remains intentionally mutable.
CREATE OR REPLACE FUNCTION "prevent_global_invoice_legal_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."sourceBusinessType" IN ('global_clearing_invoice', 'global_clearing_invoice_red', 'global_clearing_invoice_reissue')
     AND (
       NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."identityKey" IS DISTINCT FROM OLD."identityKey"
       OR NEW."identityKind" IS DISTINCT FROM OLD."identityKind"
       OR NEW."owningCompanyEntityId" IS DISTINCT FROM OLD."owningCompanyEntityId"
       OR NEW."direction" IS DISTINCT FROM OLD."direction"
       OR NEW."invoiceType" IS DISTINCT FROM OLD."invoiceType"
       OR NEW."invoiceCode" IS DISTINCT FROM OLD."invoiceCode"
       OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
       OR NEW."externalIdentifier" IS DISTINCT FROM OLD."externalIdentifier"
       OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
       OR NEW."sellerName" IS DISTINCT FROM OLD."sellerName"
       OR NEW."sellerTaxId" IS DISTINCT FROM OLD."sellerTaxId"
       OR NEW."buyerName" IS DISTINCT FROM OLD."buyerName"
       OR NEW."buyerTaxId" IS DISTINCT FROM OLD."buyerTaxId"
       OR NEW."taxExclusiveAmountCents" IS DISTINCT FROM OLD."taxExclusiveAmountCents"
       OR NEW."taxAmountCents" IS DISTINCT FROM OLD."taxAmountCents"
       OR NEW."totalAmountCents" IS DISTINCT FROM OLD."totalAmountCents"
       OR NEW."allocatableAmountCents" IS DISTINCT FROM OLD."allocatableAmountCents"
       OR NEW."fileId" IS DISTINCT FROM OLD."fileId"
       OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId"
       OR NEW."sourceBusinessType" IS DISTINCT FROM OLD."sourceBusinessType"
       OR NEW."sourceBusinessId" IS DISTINCT FROM OLD."sourceBusinessId"
       OR NEW."sourceProcurementId" IS DISTINCT FROM OLD."sourceProcurementId"
       OR NEW."commandIdempotencyKey" IS DISTINCT FROM OLD."commandIdempotencyKey"
       OR NEW."commandFingerprint" IS DISTINCT FROM OLD."commandFingerprint"
       OR NEW."taxRateSnapshot" IS DISTINCT FROM OLD."taxRateSnapshot"
     ) THEN
    RAISE EXCEPTION 'global invoice legal facts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "InvoiceLifecycleEvent"
  ADD COLUMN "delegatorUserId" TEXT;

ALTER TABLE "InvoiceClearingAllocation"
  ADD COLUMN "delegatorUserId" TEXT;

CREATE TABLE "InvoiceEvidenceRepairImpact" (
  "id" TEXT NOT NULL,
  "lifecycleEventId" TEXT NOT NULL,
  "invoiceRecordId" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "clearingEventVersionId" TEXT NOT NULL,
  "invalidatedAmountCents" BIGINT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "actualActorUserId" TEXT NOT NULL,
  "delegatorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceEvidenceRepairImpact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceEvidenceRepairImpact_amount_positive" CHECK ("invalidatedAmountCents" > 0),
  CONSTRAINT "InvoiceEvidenceRepairImpact_reason_nonblank" CHECK (btrim("reasonCode") <> '')
);
CREATE UNIQUE INDEX "InvoiceEvidenceRepairImpact_lifecycleEventId_allocationId_key"
  ON "InvoiceEvidenceRepairImpact"("lifecycleEventId", "allocationId");
CREATE INDEX "InvoiceEvidenceRepairImpact_invoiceRecordId_createdAt_idx"
  ON "InvoiceEvidenceRepairImpact"("invoiceRecordId", "createdAt");
CREATE INDEX "InvoiceEvidenceRepairImpact_allocationId_idx"
  ON "InvoiceEvidenceRepairImpact"("allocationId");
CREATE INDEX "InvoiceEvidenceRepairImpact_projectId_clearingCaseId_idx"
  ON "InvoiceEvidenceRepairImpact"("projectId", "clearingCaseId");
ALTER TABLE "InvoiceEvidenceRepairImpact" ADD CONSTRAINT "InvoiceEvidenceRepairImpact_lifecycleEventId_fkey"
  FOREIGN KEY ("lifecycleEventId") REFERENCES "InvoiceLifecycleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairImpact" ADD CONSTRAINT "InvoiceEvidenceRepairImpact_invoiceRecordId_fkey"
  FOREIGN KEY ("invoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairImpact" ADD CONSTRAINT "InvoiceEvidenceRepairImpact_allocationId_fkey"
  FOREIGN KEY ("allocationId") REFERENCES "InvoiceClearingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairImpact" ADD CONSTRAINT "InvoiceEvidenceRepairImpact_clearingCaseId_fkey"
  FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairImpact" ADD CONSTRAINT "InvoiceEvidenceRepairImpact_clearingEventVersionId_fkey"
  FOREIGN KEY ("clearingEventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InvoiceEvidenceRepairResolution" (
  "id" TEXT NOT NULL,
  "impactId" TEXT NOT NULL,
  "invalidatedInvoiceRecordId" TEXT NOT NULL,
  "replacementInvoiceRecordId" TEXT NOT NULL,
  "replacementFileId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "actualActorUserId" TEXT NOT NULL,
  "delegatorUserId" TEXT,
  "expectedRevision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceEvidenceRepairResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceEvidenceRepairResolution_revision_non_negative" CHECK ("expectedRevision" >= 0),
  CONSTRAINT "InvoiceEvidenceRepairResolution_reason_nonblank" CHECK (btrim("reasonCode") <> ''),
  CONSTRAINT "InvoiceEvidenceRepairResolution_uuid_v4" CHECK (
    "idempotencyKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);
CREATE UNIQUE INDEX "InvoiceEvidenceRepairResolution_impactId_key"
  ON "InvoiceEvidenceRepairResolution"("impactId");
CREATE UNIQUE INDEX "InvoiceEvidenceRepairResolution_idempotencyKey_key"
  ON "InvoiceEvidenceRepairResolution"("idempotencyKey");
CREATE INDEX "InvoiceEvidenceRepairResolution_invalidatedInvoiceRecordId_createdAt_idx"
  ON "InvoiceEvidenceRepairResolution"("invalidatedInvoiceRecordId", "createdAt");
CREATE INDEX "InvoiceEvidenceRepairResolution_replacementInvoiceRecordId_createdAt_idx"
  ON "InvoiceEvidenceRepairResolution"("replacementInvoiceRecordId", "createdAt");
CREATE INDEX "InvoiceEvidenceRepairResolution_requestFingerprint_idx"
  ON "InvoiceEvidenceRepairResolution"("requestFingerprint");
ALTER TABLE "InvoiceEvidenceRepairResolution" ADD CONSTRAINT "InvoiceEvidenceRepairResolution_impactId_fkey"
  FOREIGN KEY ("impactId") REFERENCES "InvoiceEvidenceRepairImpact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairResolution" ADD CONSTRAINT "InvoiceEvidenceRepairResolution_invalidatedInvoiceRecordId_fkey"
  FOREIGN KEY ("invalidatedInvoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairResolution" ADD CONSTRAINT "InvoiceEvidenceRepairResolution_replacementInvoiceRecordId_fkey"
  FOREIGN KEY ("replacementInvoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvidenceRepairResolution" ADD CONSTRAINT "InvoiceEvidenceRepairResolution_replacementFileId_fkey"
  FOREIGN KEY ("replacementFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The replacement file is an immutable snapshot of the file already owned by
-- the replacement InvoiceRecord. Keep it visible to the canonical inventory,
-- but exclude this exact derived reference from collision ownership: the
-- resolution guard below proves the same invoice/file coordinate on insert.
SELECT pg_advisory_xact_lock(190731, 260);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol260_invoice_evidence_repair;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol260_invoice_evidence_repair()
  UNION ALL
  VALUES ('InvoiceEvidenceRepairResolution', 'replacementFileId', FALSE);
$$;

CREATE OR REPLACE FUNCTION jg_file_business_collision_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT *
  FROM jg_file_business_binding_columns()
  WHERE NOT (
    ("tableName" = 'SpotProcurementPaymentArchiveFile' AND "columnName" = 'fileId')
    OR (
      "tableName" = 'InvoiceEvidenceRepairResolution'
      AND "columnName" = 'replacementFileId'
    )
  );
$$;

CREATE TRIGGER "InvoiceEvidenceRepairImpact_immutable"
BEFORE UPDATE OR DELETE ON "InvoiceEvidenceRepairImpact"
FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_lifecycle_mutation"();
CREATE TRIGGER "InvoiceEvidenceRepairResolution_immutable"
BEFORE UPDATE OR DELETE ON "InvoiceEvidenceRepairResolution"
FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_lifecycle_mutation"();

CREATE OR REPLACE FUNCTION "enforce_invoice_evidence_repair_impact"()
RETURNS trigger AS $$
DECLARE
  invalidating_event "InvoiceLifecycleEvent"%ROWTYPE;
  affected_allocation "InvoiceClearingAllocation"%ROWTYPE;
  expected_invalidated_cents BIGINT;
BEGIN
  SELECT *
    INTO invalidating_event
    FROM "InvoiceLifecycleEvent"
   WHERE "id" = NEW."lifecycleEventId";

  SELECT *
    INTO affected_allocation
    FROM "InvoiceClearingAllocation"
   WHERE "id" = NEW."allocationId"
   FOR UPDATE;

  IF NOT FOUND
     OR invalidating_event."id" IS NULL
     OR affected_allocation."reversesAllocationId" IS NOT NULL
     OR invalidating_event."kind" NOT IN ('void', 'red')
     OR invalidating_event."invoiceRecordId" IS DISTINCT FROM NEW."invoiceRecordId"
     OR affected_allocation."invoiceRecordId" IS DISTINCT FROM NEW."invoiceRecordId"
     OR affected_allocation."projectId" IS DISTINCT FROM NEW."projectId"
     OR affected_allocation."clearingCaseId" IS DISTINCT FROM NEW."clearingCaseId"
     OR affected_allocation."clearingEventVersionId" IS DISTINCT FROM NEW."clearingEventVersionId"
     OR invalidating_event."reasonCode" IS DISTINCT FROM NEW."reasonCode"
     OR invalidating_event."createdByUserId" IS DISTINCT FROM NEW."actualActorUserId"
     OR invalidating_event."delegatorUserId" IS DISTINCT FROM NEW."delegatorUserId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'evidence repair impact coordinates do not match the invalidating fact';
  END IF;

  IF invalidating_event."kind" = 'red' THEN
    SELECT COALESCE(SUM("amountCents"), 0)
      INTO expected_invalidated_cents
      FROM "InvoiceRedAllocationReference"
     WHERE "lifecycleEventId" = invalidating_event."id"
       AND "blueInvoiceAllocationId" = affected_allocation."id";
  ELSE
    SELECT affected_allocation."amountCents"
           - COALESCE((
               SELECT SUM("amountCents")
                 FROM "InvoiceClearingAllocation"
                WHERE "reversesAllocationId" = affected_allocation."id"
             ), 0)
           - COALESCE((
               SELECT SUM("amountCents")
                 FROM "InvoiceRedAllocationReference"
                WHERE "blueInvoiceAllocationId" = affected_allocation."id"
             ), 0)
      INTO expected_invalidated_cents;
  END IF;

  IF expected_invalidated_cents <= 0
     OR NEW."invalidatedAmountCents" IS DISTINCT FROM expected_invalidated_cents THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'evidence repair impact amount does not match the invalidated allocation amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceEvidenceRepairImpact_exact_fact"
BEFORE INSERT ON "InvoiceEvidenceRepairImpact"
FOR EACH ROW EXECUTE FUNCTION "enforce_invoice_evidence_repair_impact"();

-- A replacement invoice is a shared capacity resource. Lock it before reading
-- prior resolutions so two concurrent repairs cannot both consume the same
-- remaining face value.
CREATE OR REPLACE FUNCTION "enforce_invoice_evidence_repair_resolution"()
RETURNS trigger AS $$
DECLARE
  repair_impact "InvoiceEvidenceRepairImpact"%ROWTYPE;
  invalidated_invoice "InvoiceRecord"%ROWTYPE;
  replacement_invoice "InvoiceRecord"%ROWTYPE;
  resolved_cents BIGINT;
BEGIN
  SELECT *
    INTO repair_impact
    FROM "InvoiceEvidenceRepairImpact"
   WHERE "id" = NEW."impactId";

  IF NOT FOUND
     OR repair_impact."invoiceRecordId" IS DISTINCT FROM NEW."invalidatedInvoiceRecordId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'evidence repair resolution does not match its impact';
  END IF;

  SELECT *
    INTO invalidated_invoice
    FROM "InvoiceRecord"
   WHERE "id" = NEW."invalidatedInvoiceRecordId";

  SELECT *
    INTO replacement_invoice
    FROM "InvoiceRecord"
   WHERE "id" = NEW."replacementInvoiceRecordId"
   FOR UPDATE;

  IF NOT FOUND
     OR replacement_invoice."id" = invalidated_invoice."id"
     OR replacement_invoice."projectId" IS NOT NULL
     OR replacement_invoice."sourceBusinessType" NOT IN (
       'global_clearing_invoice',
       'global_clearing_invoice_reissue'
     )
     OR replacement_invoice."owningCompanyEntityId" IS DISTINCT FROM invalidated_invoice."owningCompanyEntityId"
     OR replacement_invoice."direction" IS DISTINCT FROM invalidated_invoice."direction"
     OR replacement_invoice."fileId" IS DISTINCT FROM NEW."replacementFileId"
     OR EXISTS (
       SELECT 1
         FROM "InvoiceLifecycleEvent"
        WHERE "invoiceRecordId" = replacement_invoice."id"
          AND "kind" IN ('void', 'red')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'evidence repair requires an active matching replacement invoice and file';
  END IF;

  SELECT COALESCE(SUM(impact."invalidatedAmountCents"), 0)
    INTO resolved_cents
    FROM "InvoiceEvidenceRepairResolution" resolution
    JOIN "InvoiceEvidenceRepairImpact" impact
      ON impact."id" = resolution."impactId"
   WHERE resolution."replacementInvoiceRecordId" = replacement_invoice."id";

  IF resolved_cents + repair_impact."invalidatedAmountCents" > replacement_invoice."totalAmountCents" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'evidence repair resolutions exceed the replacement invoice';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceEvidenceRepairResolution_shared_cap"
BEFORE INSERT ON "InvoiceEvidenceRepairResolution"
FOR EACH ROW EXECUTE FUNCTION "enforce_invoice_evidence_repair_resolution"();

-- Lifecycle invalidation commands share the source InvoiceRecord as their
-- stable serialization point. A prior void is terminal for later void/red
-- facts; red-before-void remains valid so a later void may invalidate only the
-- still-effective allocation remainder.
CREATE OR REPLACE FUNCTION "enforce_invoice_lifecycle_compatibility"()
RETURNS trigger AS $$
DECLARE
  locked_invoice_id TEXT;
BEGIN
  IF NEW."kind" NOT IN ('void', 'red') THEN
    RETURN NEW;
  END IF;

  SELECT "id"
    INTO locked_invoice_id
    FROM "InvoiceRecord"
   WHERE "id" = NEW."invoiceRecordId"
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invoice lifecycle requires an existing invoice';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "InvoiceLifecycleEvent"
     WHERE "invoiceRecordId" = NEW."invoiceRecordId"
       AND "kind" = 'void'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = CASE
        WHEN NEW."kind" = 'void' THEN 'invoice already has a void lifecycle fact'
        ELSE 'a voided invoice cannot receive a red lifecycle fact'
      END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceLifecycleEvent_compatible_invalidation"
BEFORE INSERT ON "InvoiceLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION "enforce_invoice_lifecycle_compatibility"();

-- Serialize every red reference against its blue allocation
-- and enforce the shared red/reference reversal cap at the database boundary.
CREATE OR REPLACE FUNCTION "enforce_invoice_red_allocation_cap"()
RETURNS trigger AS $$
DECLARE
  blue_allocation "InvoiceClearingAllocation"%ROWTYPE;
  referenced_invoice_id TEXT;
  related_red_invoice_id TEXT;
  red_cents BIGINT;
  reversed_cents BIGINT;
BEGIN
  SELECT "invoiceRecordId", "relatedInvoiceRecordId"
    INTO referenced_invoice_id, related_red_invoice_id
    FROM "InvoiceLifecycleEvent"
   WHERE "id" = NEW."lifecycleEventId"
     AND "kind" = 'red';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'red reference requires a red lifecycle fact';
  END IF;

  PERFORM 1
    FROM "InvoiceRecord"
   WHERE "id" = referenced_invoice_id
   FOR UPDATE;

  IF NOT FOUND OR EXISTS (
    SELECT 1
      FROM "InvoiceLifecycleEvent"
     WHERE "invoiceRecordId" = referenced_invoice_id
       AND "kind" = 'void'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a voided invoice cannot receive a red allocation reference';
  END IF;

  SELECT *
    INTO blue_allocation
    FROM "InvoiceClearingAllocation"
   WHERE "id" = NEW."blueInvoiceAllocationId"
   FOR UPDATE;

  IF NOT FOUND OR blue_allocation."reversesAllocationId" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'red reference requires an original blue allocation';
  END IF;

  IF referenced_invoice_id IS DISTINCT FROM blue_allocation."invoiceRecordId"
     OR related_red_invoice_id IS DISTINCT FROM NEW."redInvoiceRecordId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'red reference lifecycle does not match the blue allocation';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)
    INTO red_cents
    FROM "InvoiceRedAllocationReference"
   WHERE "blueInvoiceAllocationId" = NEW."blueInvoiceAllocationId";

  SELECT COALESCE(SUM("amountCents"), 0)
    INTO reversed_cents
    FROM "InvoiceClearingAllocation"
   WHERE "reversesAllocationId" = NEW."blueInvoiceAllocationId";

  IF red_cents + reversed_cents + NEW."amountCents" > blue_allocation."amountCents" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'red references and allocation reversals exceed the blue allocation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceRedAllocationReference_shared_cap"
BEFORE INSERT ON "InvoiceRedAllocationReference"
FOR EACH ROW EXECUTE FUNCTION "enforce_invoice_red_allocation_cap"();

CREATE OR REPLACE FUNCTION "enforce_invoice_clearing_reversal_cap"()
RETURNS trigger AS $$
DECLARE
  original_allocation "InvoiceClearingAllocation"%ROWTYPE;
  original_invoice_id TEXT;
  red_cents BIGINT;
  reversed_cents BIGINT;
BEGIN
  IF NEW."reversesAllocationId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "invoiceRecordId"
    INTO original_invoice_id
    FROM "InvoiceClearingAllocation"
   WHERE "id" = NEW."reversesAllocationId";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'allocation reversal requires an original allocation';
  END IF;

  PERFORM 1
    FROM "InvoiceRecord"
   WHERE "id" = original_invoice_id
   FOR UPDATE;

  IF NOT FOUND OR EXISTS (
    SELECT 1
      FROM "InvoiceLifecycleEvent"
     WHERE "invoiceRecordId" = original_invoice_id
       AND "kind" = 'void'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a voided invoice allocation cannot be reversed';
  END IF;

  SELECT *
    INTO original_allocation
    FROM "InvoiceClearingAllocation"
   WHERE "id" = NEW."reversesAllocationId"
   FOR UPDATE;

  IF NOT FOUND OR original_allocation."reversesAllocationId" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'allocation reversal requires an original allocation';
  END IF;

  IF NEW."invoiceRecordId" IS DISTINCT FROM original_allocation."invoiceRecordId"
     OR NEW."projectId" IS DISTINCT FROM original_allocation."projectId"
     OR NEW."clearingCaseId" IS DISTINCT FROM original_allocation."clearingCaseId"
     OR NEW."clearingEventVersionId" IS DISTINCT FROM original_allocation."clearingEventVersionId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'allocation reversal coordinates do not match the original allocation';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)
    INTO red_cents
    FROM "InvoiceRedAllocationReference"
   WHERE "blueInvoiceAllocationId" = original_allocation."id";

  SELECT COALESCE(SUM("amountCents"), 0)
    INTO reversed_cents
    FROM "InvoiceClearingAllocation"
   WHERE "reversesAllocationId" = original_allocation."id";

  IF red_cents + reversed_cents + NEW."amountCents" > original_allocation."amountCents" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'allocation reversals and red references exceed the original allocation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceClearingAllocation_shared_reversal_cap"
BEFORE INSERT ON "InvoiceClearingAllocation"
FOR EACH ROW EXECUTE FUNCTION "enforce_invoice_clearing_reversal_cap"();
