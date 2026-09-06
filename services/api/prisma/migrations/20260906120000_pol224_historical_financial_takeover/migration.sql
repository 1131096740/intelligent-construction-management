-- POL-224: historical payable/payment/relationship/fund-movement adapter.
-- This migration creates only inactive takeover projections and governance
-- receipts. It does not scan, import, activate, compensate, or mutate business data.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 224);

CREATE TABLE "HistoricalFinancialTakeoverBatch" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "asOfDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "candidateBaselineSha" TEXT NOT NULL,
  "sourceSetFingerprint" TEXT NOT NULL,
  "readSetFingerprint" TEXT NOT NULL,
  "manifestFingerprint" TEXT NOT NULL,
  "permissionSnapshotFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "appliedByUserId" TEXT,
  "attestedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  "attestedAt" TIMESTAMP(3),
  CONSTRAINT "HistoricalFinancialTakeoverBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HFTakeoverBatch_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverBatch_status_check" CHECK ("status" IN ('prepared', 'applied_inactive', 'attested', 'activated', 'compensated')),
  CONSTRAINT "HFTakeoverBatch_revision_check" CHECK ("revision" BETWEEN 1 AND 5),
  CONSTRAINT "HFTakeoverBatch_hash_check" CHECK (
    "candidateBaselineSha" ~ '^[0-9a-fA-F]{40}$' AND
    "sourceSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "readSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "manifestFingerprint" ~ '^[0-9a-f]{64}$' AND
    "permissionSnapshotFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "HFTakeoverBatch_lifecycle_shape_check" CHECK (
    ("status" = 'prepared' AND "revision" = 1 AND "appliedByUserId" IS NULL AND "attestedByUserId" IS NULL AND "appliedAt" IS NULL AND "attestedAt" IS NULL) OR
    ("status" = 'applied_inactive' AND "revision" = 2 AND "appliedByUserId" IS NOT NULL AND "attestedByUserId" IS NULL AND "appliedAt" IS NOT NULL AND "attestedAt" IS NULL) OR
    ("status" IN ('attested', 'activated', 'compensated') AND "revision" >= 3 AND "appliedByUserId" IS NOT NULL AND "attestedByUserId" IS NOT NULL AND "appliedAt" IS NOT NULL AND "attestedAt" IS NOT NULL AND "appliedByUserId" <> "attestedByUserId")
  )
);
CREATE UNIQUE INDEX "HFTakeoverBatch_project_manifest_key" ON "HistoricalFinancialTakeoverBatch"("projectId", "manifestFingerprint");
CREATE INDEX "HFTakeoverBatch_project_status_created_idx" ON "HistoricalFinancialTakeoverBatch"("projectId", "status", "createdAt");

CREATE TABLE "HistoricalFinancialTakeoverRowMapping" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "rowNo" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceCoordinate" TEXT NOT NULL,
  "normalizedRowHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "evidenceLevel" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "asOfDate" DATE NOT NULL,
  "mappingDecision" TEXT NOT NULL,
  "targetKind" TEXT,
  "targetRef" TEXT,
  "targetFingerprint" TEXT,
  "targetSnapshot" JSONB NOT NULL,
  "sourceDuplicateGroupKey" TEXT NOT NULL,
  "bankDuplicateGroupKey" TEXT,
  "payableDuplicateGroupKey" TEXT,
  "movementDuplicateGroupKey" TEXT,
  "openingBalanceDuplicateGroupKey" TEXT,
  "conflictGroupKeys" JSONB NOT NULL,
  "legacyProjectProxyPaymentId" TEXT,
  "legacyProjectAffiliatePaymentFactId" TEXT,
  "readSetFingerprint" TEXT NOT NULL,
  "mappingFingerprint" TEXT NOT NULL,
  "projectionStatus" TEXT NOT NULL DEFAULT 'applied_inactive',
  "newPaymentAllowed" BOOLEAN NOT NULL DEFAULT false,
  "settlementAllocationAllowed" BOOLEAN NOT NULL DEFAULT false,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalFinancialTakeoverRowMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HFTakeoverRow_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalFinancialTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverRow_shape_check" CHECK (
    "rowNo" > 0 AND "sourceVersion" > 0 AND "amountCents" > 0 AND "currencyCode" = 'CNY' AND
    "kind" IN ('payable', 'payment_execution', 'settlement_allocation', 'inter_entity_relationship', 'fund_movement', 'opening_balance') AND
    "evidenceLevel" IN ('A', 'B', 'C') AND
    "mappingDecision" IN ('LINK', 'SKIP', 'OPENING_BALANCE', 'GAP') AND
    "normalizedRowHash" ~ '^[0-9a-f]{64}$' AND "readSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "mappingFingerprint" ~ '^[0-9a-f]{64}$' AND
    ("targetFingerprint" IS NULL OR "targetFingerprint" ~ '^[0-9a-f]{64}$') AND
    jsonb_typeof("conflictGroupKeys") = 'array' AND
    "projectionStatus" = 'applied_inactive' AND
    "newPaymentAllowed" = false AND "settlementAllocationAllowed" = false
  ),
  CONSTRAINT "HFTakeoverRow_evidence_decision_check" CHECK (
    ("evidenceLevel" = 'A' AND "kind" <> 'opening_balance' AND "mappingDecision" IN ('LINK', 'SKIP') AND "targetKind" = "kind" AND "targetRef" IS NOT NULL AND "targetFingerprint" IS NOT NULL) OR
    ("evidenceLevel" = 'B' AND "kind" = 'opening_balance' AND "mappingDecision" IN ('OPENING_BALANCE', 'SKIP') AND "targetKind" = 'historical_opening_balance' AND "targetRef" IS NOT NULL AND "targetFingerprint" IS NOT NULL AND "bankDuplicateGroupKey" IS NULL) OR
    ("evidenceLevel" = 'C' AND "mappingDecision" = 'GAP' AND "targetKind" IS NULL AND "targetRef" IS NULL AND "targetFingerprint" IS NULL AND "bankDuplicateGroupKey" IS NULL AND "payableDuplicateGroupKey" IS NULL AND "movementDuplicateGroupKey" IS NULL AND "openingBalanceDuplicateGroupKey" IS NULL)
  ),
  CONSTRAINT "HFTakeoverRow_legacy_not_target_check" CHECK (
    ("legacyProjectProxyPaymentId" IS NULL OR "targetRef" IS DISTINCT FROM "legacyProjectProxyPaymentId") AND
    ("legacyProjectAffiliatePaymentFactId" IS NULL OR "targetRef" IS DISTINCT FROM "legacyProjectAffiliatePaymentFactId")
  )
);
CREATE UNIQUE INDEX "HFTakeoverRow_batch_row_key" ON "HistoricalFinancialTakeoverRowMapping"("batchId", "rowNo");
CREATE UNIQUE INDEX "HFTakeoverRow_batch_source_key" ON "HistoricalFinancialTakeoverRowMapping"("batchId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceCoordinate");
CREATE INDEX "HFTakeoverRow_project_source_group_idx" ON "HistoricalFinancialTakeoverRowMapping"("projectId", "sourceDuplicateGroupKey");
CREATE INDEX "HFTakeoverRow_project_bank_group_idx" ON "HistoricalFinancialTakeoverRowMapping"("projectId", "bankDuplicateGroupKey");
CREATE INDEX "HFTakeoverRow_project_payable_group_idx" ON "HistoricalFinancialTakeoverRowMapping"("projectId", "payableDuplicateGroupKey");
CREATE INDEX "HFTakeoverRow_project_movement_group_idx" ON "HistoricalFinancialTakeoverRowMapping"("projectId", "movementDuplicateGroupKey");
CREATE INDEX "HFTakeoverRow_project_opening_group_idx" ON "HistoricalFinancialTakeoverRowMapping"("projectId", "openingBalanceDuplicateGroupKey");
CREATE INDEX "HFTakeoverRow_target_idx" ON "HistoricalFinancialTakeoverRowMapping"("targetKind", "targetRef");

CREATE TABLE "HistoricalFinancialTakeoverCommandReceipt" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "causalityFingerprint" TEXT NOT NULL,
  "causesReceiptId" TEXT,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalFinancialTakeoverCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HFTakeoverReceipt_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalFinancialTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverReceipt_cause_fkey" FOREIGN KEY ("causesReceiptId") REFERENCES "HistoricalFinancialTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverReceipt_shape_check" CHECK (
    "action" IN ('prepare', 'apply_inactive', 'attest', 'activate', 'compensate') AND
    "expectedRevision" BETWEEN 0 AND 4 AND
    "fingerprint" ~ '^[0-9a-f]{64}$' AND "causalityFingerprint" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverCommandReceipt_idempotency_key" ON "HistoricalFinancialTakeoverCommandReceipt"("idempotencyKey");
CREATE INDEX "HFTakeoverReceipt_batch_action_created_idx" ON "HistoricalFinancialTakeoverCommandReceipt"("batchId", "action", "createdAt");
CREATE INDEX "HFTakeoverReceipt_cause_idx" ON "HistoricalFinancialTakeoverCommandReceipt"("causesReceiptId");

CREATE TABLE "HistoricalFinancialTakeoverActivation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "applyReceiptId" TEXT NOT NULL,
  "attestationReceiptId" TEXT NOT NULL,
  "activationReceiptId" TEXT NOT NULL,
  "manifestFingerprint" TEXT NOT NULL,
  "preActivationReadSetFingerprint" TEXT NOT NULL,
  "activationFingerprint" TEXT NOT NULL,
  "activatedByUserId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalFinancialTakeoverActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HFTakeoverActivation_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalFinancialTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverActivation_apply_receipt_fkey" FOREIGN KEY ("applyReceiptId") REFERENCES "HistoricalFinancialTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverActivation_attest_receipt_fkey" FOREIGN KEY ("attestationReceiptId") REFERENCES "HistoricalFinancialTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverActivation_receipt_fkey" FOREIGN KEY ("activationReceiptId") REFERENCES "HistoricalFinancialTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverActivation_hash_check" CHECK (
    "manifestFingerprint" ~ '^[0-9a-f]{64}$' AND
    "preActivationReadSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "activationFingerprint" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverActivation_batch_key" ON "HistoricalFinancialTakeoverActivation"("batchId");
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverActivation_apply_receipt_key" ON "HistoricalFinancialTakeoverActivation"("applyReceiptId");
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverActivation_attest_receipt_key" ON "HistoricalFinancialTakeoverActivation"("attestationReceiptId");
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverActivation_receipt_key" ON "HistoricalFinancialTakeoverActivation"("activationReceiptId");

CREATE TABLE "HistoricalFinancialTakeoverCompensation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "compensationReceiptId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reverseCausalitySnapshot" JSONB NOT NULL,
  "compensationFingerprint" TEXT NOT NULL,
  "compensatedByUserId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "compensatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalFinancialTakeoverCompensation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HFTakeoverCompensation_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalFinancialTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverCompensation_activation_fkey" FOREIGN KEY ("activationId") REFERENCES "HistoricalFinancialTakeoverActivation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverCompensation_receipt_fkey" FOREIGN KEY ("compensationReceiptId") REFERENCES "HistoricalFinancialTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HFTakeoverCompensation_shape_check" CHECK (
    length(btrim("reason")) >= 5 AND jsonb_typeof("reverseCausalitySnapshot") = 'array' AND
    "compensationFingerprint" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverCompensation_batch_key" ON "HistoricalFinancialTakeoverCompensation"("batchId");
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverCompensation_activation_key" ON "HistoricalFinancialTakeoverCompensation"("activationId");
CREATE UNIQUE INDEX "HistoricalFinancialTakeoverCompensation_receipt_key" ON "HistoricalFinancialTakeoverCompensation"("compensationReceiptId");

CREATE OR REPLACE FUNCTION jg_pol224_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224历史接管凭据与投影只允许追加';
END;
$$;

CREATE OR REPLACE FUNCTION jg_pol224_validate_batch_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."id", OLD."projectId", OLD."asOfDate", OLD."candidateBaselineSha", OLD."sourceSetFingerprint", OLD."readSetFingerprint", OLD."manifestFingerprint", OLD."permissionSnapshotFingerprint", OLD."createdByUserId", OLD."createdAt")
     IS DISTINCT FROM
     ROW(NEW."id", NEW."projectId", NEW."asOfDate", NEW."candidateBaselineSha", NEW."sourceSetFingerprint", NEW."readSetFingerprint", NEW."manifestFingerprint", NEW."permissionSnapshotFingerprint", NEW."createdByUserId", NEW."createdAt") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224批次权威快照不可修改';
  END IF;
  IF NOT (
    (OLD."status" = 'prepared' AND NEW."status" = 'applied_inactive' AND NEW."revision" = 2) OR
    (OLD."status" = 'applied_inactive' AND NEW."status" = 'attested' AND NEW."revision" = 3) OR
    (OLD."status" = 'attested' AND NEW."status" = 'activated' AND NEW."revision" = 4) OR
    (OLD."status" = 'activated' AND NEW."status" = 'compensated' AND NEW."revision" = 5)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224批次状态只能按固定顺序前进';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jg_pol224_validate_row_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HistoricalFinancialTakeoverBatch" batch
    WHERE batch."id" = NEW."batchId" AND batch."projectId" = NEW."projectId" AND batch."asOfDate" = NEW."asOfDate"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224行投影的项目、批次与截止日不一致';
  END IF;
  IF NEW."evidenceLevel" = 'A' AND NEW."targetKind" = 'payment_execution' AND NOT EXISTS (
    SELECT 1
    FROM "PaymentExecution" payment_execution
    JOIN "PaymentRequest" payment_request ON payment_request."id" = payment_execution."paymentRequestId"
    WHERE payment_execution."id" = NEW."targetRef" AND payment_request."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POL-224 A级付款必须引用既有PaymentExecution';
  ELSIF NEW."evidenceLevel" = 'A' AND NEW."targetKind" = 'payable' THEN
    IF EXISTS (SELECT 1 FROM "HistoricalWageSummaryPayableRef" WHERE "id" = NEW."targetRef") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224不得把historical_reconciliation_only工资汇总引用变成新付款来源';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "WagePayableRef" WHERE "id" = NEW."targetRef" AND "projectId" = NEW."projectId") THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POL-224 A级应付必须引用封闭注册表正式应付';
    END IF;
  ELSIF NEW."evidenceLevel" = 'A' AND NEW."targetKind" = 'settlement_allocation' AND NOT EXISTS (
    SELECT 1
    FROM "PayableSettlementAllocation" allocation
    JOIN "PayableSettlementCase" settlement_case ON settlement_case."id" = allocation."settlementCaseId"
    JOIN "PaymentExecution" payment_execution ON payment_execution."id" = allocation."paymentExecutionId"
    JOIN "PaymentRequest" payment_request ON payment_request."id" = payment_execution."paymentRequestId"
    WHERE allocation."id" = NEW."targetRef" AND settlement_case."status" = 'confirmed' AND
      allocation."beneficiaryProjectId" = NEW."projectId" AND payment_request."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POL-224 A级核销必须引用已确认且绑定既有PaymentExecution的正式分配';
  ELSIF NEW."evidenceLevel" = 'A' AND NEW."targetKind" = 'inter_entity_relationship' AND NOT (
    EXISTS (SELECT 1 FROM "InterEntityRelationshipEntry" WHERE "id" = NEW."targetRef" AND "status" = 'confirmed' AND "projectId" = NEW."projectId") OR
    EXISTS (SELECT 1 FROM "FundMovementRelationshipEntry" WHERE "id" = NEW."targetRef" AND "status" = 'confirmed' AND ("sourceProjectId" = NEW."projectId" OR "beneficiaryProjectId" = NEW."projectId"))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POL-224 A级往来必须引用既有已确认正式往来';
  ELSIF NEW."evidenceLevel" = 'A' AND NEW."targetKind" = 'fund_movement' AND NOT EXISTS (
    SELECT 1 FROM "FundMovement" WHERE "id" = NEW."targetRef" AND "status" = 'confirmed' AND ("sourceProjectId" = NEW."projectId" OR "beneficiaryProjectId" = NEW."projectId")
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POL-224 A级资金移动必须引用既有已确认movement';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jg_pol224_validate_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_row "HistoricalFinancialTakeoverBatch";
BEGIN
  SELECT * INTO batch_row FROM "HistoricalFinancialTakeoverBatch" WHERE "id" = NEW."batchId" FOR UPDATE;
  IF batch_row."status" <> 'attested' OR batch_row."revision" <> 3 OR
     batch_row."manifestFingerprint" <> NEW."manifestFingerprint" OR
     batch_row."readSetFingerprint" <> NEW."preActivationReadSetFingerprint" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224激活前批次状态或勾稽指纹不一致';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "HistoricalFinancialTakeoverRowMapping" WHERE "batchId" = NEW."batchId") OR
     EXISTS (SELECT 1 FROM "HistoricalFinancialTakeoverRowMapping" WHERE "batchId" = NEW."batchId" AND "projectionStatus" <> 'applied_inactive') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224激活必须覆盖完整inactive投影';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jg_pol224_validate_compensation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HistoricalFinancialTakeoverBatch" batch
    JOIN "HistoricalFinancialTakeoverActivation" activation ON activation."batchId" = batch."id"
    WHERE batch."id" = NEW."batchId" AND batch."status" = 'activated' AND activation."id" = NEW."activationId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-224只能对已激活批次追加逆因果补偿';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jg_pol224_batch_transition_guard BEFORE UPDATE ON "HistoricalFinancialTakeoverBatch" FOR EACH ROW EXECUTE FUNCTION jg_pol224_validate_batch_transition();
CREATE TRIGGER jg_pol224_batch_no_delete BEFORE DELETE ON "HistoricalFinancialTakeoverBatch" FOR EACH ROW EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_row_target_guard BEFORE INSERT ON "HistoricalFinancialTakeoverRowMapping" FOR EACH ROW EXECUTE FUNCTION jg_pol224_validate_row_target();
CREATE TRIGGER jg_pol224_row_append_only BEFORE UPDATE OR DELETE ON "HistoricalFinancialTakeoverRowMapping" FOR EACH ROW EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_receipt_append_only BEFORE UPDATE OR DELETE ON "HistoricalFinancialTakeoverCommandReceipt" FOR EACH ROW EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_activation_guard BEFORE INSERT ON "HistoricalFinancialTakeoverActivation" FOR EACH ROW EXECUTE FUNCTION jg_pol224_validate_activation();
CREATE TRIGGER jg_pol224_activation_append_only BEFORE UPDATE OR DELETE ON "HistoricalFinancialTakeoverActivation" FOR EACH ROW EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_compensation_guard BEFORE INSERT ON "HistoricalFinancialTakeoverCompensation" FOR EACH ROW EXECUTE FUNCTION jg_pol224_validate_compensation();
CREATE TRIGGER jg_pol224_compensation_append_only BEFORE UPDATE OR DELETE ON "HistoricalFinancialTakeoverCompensation" FOR EACH ROW EXECUTE FUNCTION jg_pol224_reject_mutation();

CREATE TRIGGER jg_pol224_batch_no_truncate BEFORE TRUNCATE ON "HistoricalFinancialTakeoverBatch" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_row_no_truncate BEFORE TRUNCATE ON "HistoricalFinancialTakeoverRowMapping" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_receipt_no_truncate BEFORE TRUNCATE ON "HistoricalFinancialTakeoverCommandReceipt" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_activation_no_truncate BEFORE TRUNCATE ON "HistoricalFinancialTakeoverActivation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol224_reject_mutation();
CREATE TRIGGER jg_pol224_compensation_no_truncate BEFORE TRUNCATE ON "HistoricalFinancialTakeoverCompensation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol224_reject_mutation();

COMMIT;
