-- POL-13B: freeze the source and contract coordinates used by a confirmed
-- cross-entity relationship.  The root is an accounting projection of the
-- existing settlement allocations; it never creates or mutates a payment.
BEGIN;

ALTER TABLE "InterEntityRelationshipEntry"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "contractId" TEXT,
  ADD COLUMN "contractVersionId" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceAggregateId" TEXT,
  ADD COLUMN "sourceAllocationCount" INTEGER,
  ADD COLUMN "sourceAllocationAmountCents" BIGINT;

CREATE INDEX "InterEntityRelationshipEntry_source_scope_idx"
  ON "InterEntityRelationshipEntry"("projectId", "contractId", "contractVersionId");

ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_source_snapshot_shape_check"
  CHECK (
    "entryKind" <> 'proxy_payment'
    OR (
      btrim("projectId") <> ''
      AND btrim("contractId") <> ''
      AND btrim("contractVersionId") <> ''
      AND "sourceType" = 'wage_payable_ref'
      AND btrim("sourceAggregateId") <> ''
      AND "sourceAllocationCount" > 0
      AND "sourceAllocationAmountCents" = "amountCents"
      AND "sourceAllocationAmountCents" > 0
    )
  );

CREATE FUNCTION guard_inter_entity_relationship_source_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  request_record RECORD;
  allocation_count INTEGER;
  allocation_amount_cents BIGINT;
  allocation_source_count INTEGER;
  allocation_source_type TEXT;
  allocation_source_aggregate_id TEXT;
  root_record RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- The preceding append-only trigger changes every direct INSERT to draft.
  -- Only the audited draft -> confirmed transition is required to carry the
  -- complete, cross-checked source snapshot.
  IF NEW."status" = 'confirmed' AND NEW."entryKind" = 'proxy_payment' THEN
    IF NEW."projectId" IS NULL
       OR NEW."contractId" IS NULL
       OR NEW."contractVersionId" IS NULL
       OR NEW."sourceType" IS DISTINCT FROM 'wage_payable_ref'
       OR NEW."sourceAggregateId" IS NULL
       OR NEW."sourceAllocationCount" IS NULL
       OR NEW."sourceAllocationCount" <= 0
       OR NEW."sourceAllocationAmountCents" IS NULL
       OR NEW."sourceAllocationAmountCents" <> NEW."amountCents" THEN
      RAISE EXCEPTION 'inter_entity_relationship_source_snapshot_invalid';
    END IF;

    SELECT request."projectId", request."contractId", request."contractVersionId"
    INTO request_record
    FROM "PaymentExecution" execution
    INNER JOIN "PaymentRequest" request
      ON request."id" = execution."paymentRequestId"
    INNER JOIN "PayableSettlementCase" settlement_case
      ON settlement_case."id" = NEW."settlementCaseId"
    WHERE execution."id" = NEW."paymentExecutionId"
      AND settlement_case."paymentExecutionId" = execution."id";
    IF NOT FOUND
       OR request_record."projectId" IS DISTINCT FROM NEW."projectId"
       OR request_record."contractId" IS DISTINCT FROM NEW."contractId"
       OR request_record."contractVersionId" IS DISTINCT FROM NEW."contractVersionId" THEN
      RAISE EXCEPTION 'inter_entity_relationship_source_contract_snapshot_invalid';
    END IF;

    SELECT COUNT(*)::INTEGER,
           COALESCE(SUM(allocation."amountCents"), 0),
           COUNT(DISTINCT allocation."sourceAggregateId")::INTEGER,
           MIN(allocation."sourceType"),
           MIN(allocation."sourceAggregateId")
    INTO allocation_count, allocation_amount_cents, allocation_source_count,
         allocation_source_type, allocation_source_aggregate_id
    FROM "PayableSettlementAllocation" allocation
    WHERE allocation."settlementCaseId" = NEW."settlementCaseId";
    IF allocation_count <> NEW."sourceAllocationCount"
       OR allocation_amount_cents <> NEW."sourceAllocationAmountCents"
       OR allocation_source_count <> 1
       OR allocation_source_type IS DISTINCT FROM 'wage_payable_ref'
       OR allocation_source_aggregate_id IS DISTINCT FROM NEW."sourceAggregateId" THEN
      RAISE EXCEPTION 'inter_entity_relationship_source_allocation_snapshot_invalid';
    END IF;
  END IF;

  IF NEW."status" = 'confirmed' AND NEW."entryKind" = 'proxy_return' THEN
    SELECT root."projectId", root."contractId", root."contractVersionId",
           root."sourceType", root."sourceAggregateId",
           root."sourceAllocationCount", root."sourceAllocationAmountCents"
    INTO root_record
    FROM "InterEntityRelationshipEntry" root
    WHERE root."id" = NEW."adjustsEntryId"
      AND root."entryKind" = 'proxy_payment'
      AND root."direction" = 'increase'
      AND root."status" = 'confirmed'
      AND root."adjustsEntryId" IS NULL
    FOR UPDATE;
    IF NOT FOUND
       OR NEW."projectId" IS DISTINCT FROM root_record."projectId"
       OR NEW."contractId" IS DISTINCT FROM root_record."contractId"
       OR NEW."contractVersionId" IS DISTINCT FROM root_record."contractVersionId"
       OR NEW."sourceType" IS DISTINCT FROM root_record."sourceType"
       OR NEW."sourceAggregateId" IS DISTINCT FROM root_record."sourceAggregateId"
       OR NEW."sourceAllocationCount" IS DISTINCT FROM root_record."sourceAllocationCount"
       OR NEW."sourceAllocationAmountCents" IS DISTINCT FROM root_record."sourceAllocationAmountCents" THEN
      RAISE EXCEPTION 'inter_entity_relationship_return_source_snapshot_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_inter_entity_relationship_source_snapshot_guard"
BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry"
FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_source_snapshot();

COMMIT;
