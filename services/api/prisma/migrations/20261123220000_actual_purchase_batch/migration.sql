-- #403 两类原采购单分批实际采购与付款。
-- 采购需求与实际采购批次分开；批次记录供应商、实际明细和确定金额；
-- 付款/垫付报销引用批次，成本只按批次确认一次；更正另存只增事实。
-- 退款事实沿用 #400 PaymentExecutionRefund，扩展为三类实付，既有行不变。

CREATE TABLE "ActualPurchaseBatch" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT,
  "projectId" TEXT,
  "companyEntityId" TEXT,
  "supplierName" TEXT NOT NULL,
  "totalAmountCents" BIGINT NOT NULL,
  "effectiveTotalAmountCents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "costVersion" INTEGER NOT NULL DEFAULT 0,
  "costConfirmedAt" TIMESTAMP(3),
  "costConfirmedByUserId" TEXT,
  "costFactId" TEXT,
  "note" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActualPurchaseBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActualPurchaseBatch_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ActualPurchaseBatch_kind_check" CHECK ("kind" IN ('spot_material', 'general')),
  CONSTRAINT "ActualPurchaseBatch_supplier_check" CHECK (length(btrim("supplierName")) > 0),
  CONSTRAINT "ActualPurchaseBatch_total_check" CHECK ("totalAmountCents" > 0 AND "effectiveTotalAmountCents" > 0),
  CONSTRAINT "ActualPurchaseBatch_status_check" CHECK ("status" IN ('recorded', 'cost_confirmed', 'voided')),
  CONSTRAINT "ActualPurchaseBatch_project_check" CHECK (
    ("kind" = 'spot_material' AND "projectId" IS NOT NULL)
    OR ("kind" = 'general' AND ("projectId" IS NULL OR "projectId" IS NOT NULL))
  ),
  CONSTRAINT "ActualPurchaseBatch_cost_check" CHECK (
    ("costVersion" = 0 AND "costConfirmedAt" IS NULL AND "costConfirmedByUserId" IS NULL AND "costFactId" IS NULL AND "status" = 'recorded')
    OR ("costVersion" > 0 AND "costConfirmedAt" IS NOT NULL AND "costConfirmedByUserId" IS NOT NULL
      AND "status" IN ('cost_confirmed', 'voided')
      AND ("projectId" IS NOT NULL OR "costFactId" IS NULL)
      AND ("projectId" IS NULL OR "costFactId" IS NOT NULL))
  ),
  CONSTRAINT "ActualPurchaseBatch_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ActualPurchaseBatch_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ActualPurchaseBatch_company_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActualPurchaseBatch_kind_procurement_idx" ON "ActualPurchaseBatch"("kind", "procurementId");
CREATE INDEX "ActualPurchaseBatch_procurementVersion_idx" ON "ActualPurchaseBatch"("procurementVersionId");
CREATE INDEX "ActualPurchaseBatch_project_status_idx" ON "ActualPurchaseBatch"("projectId", "status");
CREATE INDEX "ActualPurchaseBatch_creator_idx" ON "ActualPurchaseBatch"("createdByUserId", "createdAt");

CREATE TABLE "ActualPurchaseBatchLine" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "materialName" TEXT NOT NULL,
  "specification" TEXT,
  "unit" TEXT,
  "quantity" DECIMAL(24,6),
  "unitPrice" DECIMAL(24,6),
  "amountCents" BIGINT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualPurchaseBatchLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActualPurchaseBatchLine_batch_order_key" UNIQUE ("batchId", "sortOrder"),
  CONSTRAINT "ActualPurchaseBatchLine_name_check" CHECK (length(btrim("materialName")) > 0),
  CONSTRAINT "ActualPurchaseBatchLine_amount_check" CHECK ("amountCents" IS NULL OR "amountCents" >= 0),
  CONSTRAINT "ActualPurchaseBatchLine_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0),
  CONSTRAINT "ActualPurchaseBatchLine_unit_price_check" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0),
  CONSTRAINT "ActualPurchaseBatchLine_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "ActualPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActualPurchaseBatchLine_batch_idx" ON "ActualPurchaseBatchLine"("batchId");

CREATE TABLE "ActualPurchaseBatchCorrection" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_confirm',
  "originalTotalAmountCents" BIGINT NOT NULL,
  "correctedTotalAmountCents" BIGINT NOT NULL,
  "correctionDeltaCents" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "selfReviewReason" TEXT,
  "reviewNote" TEXT,
  "originalSnapshot" JSONB NOT NULL,
  "reversalSnapshot" JSONB NOT NULL,
  "correctionSnapshot" JSONB NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationKey" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActualPurchaseBatchCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActualPurchaseBatchCorrection_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ActualPurchaseBatchCorrection_confirmationKey_key" UNIQUE ("confirmationKey"),
  CONSTRAINT "ActualPurchaseBatchCorrection_status_check" CHECK ("status" IN ('pending_confirm', 'confirmed')),
  CONSTRAINT "ActualPurchaseBatchCorrection_amount_check" CHECK (
    "originalTotalAmountCents" > 0
    AND "correctedTotalAmountCents" > 0
    AND "correctionDeltaCents" = "correctedTotalAmountCents" - "originalTotalAmountCents"
    AND "correctionDeltaCents" <> 0
  ),
  CONSTRAINT "ActualPurchaseBatchCorrection_reason_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "ActualPurchaseBatchCorrection_snapshot_check" CHECK (
    jsonb_typeof("originalSnapshot") = 'object'
    AND jsonb_typeof("reversalSnapshot") = 'object'
    AND jsonb_typeof("correctionSnapshot") = 'object'
  ),
  CONSTRAINT "ActualPurchaseBatchCorrection_confirm_state_check" CHECK (
    ("status" = 'pending_confirm' AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL AND "confirmationKey" IS NULL)
    OR ("status" = 'confirmed' AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmationKey" IS NOT NULL)
  ),
  CONSTRAINT "ActualPurchaseBatchCorrection_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ActualPurchaseBatchCorrection_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "ActualPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActualPurchaseBatchCorrection_batch_status_idx" ON "ActualPurchaseBatchCorrection"("batchId", "status");
CREATE INDEX "ActualPurchaseBatchCorrection_status_created_idx" ON "ActualPurchaseBatchCorrection"("status", "createdAt");
CREATE UNIQUE INDEX "ActualPurchaseBatchCorrection_one_open_idx"
  ON "ActualPurchaseBatchCorrection"("batchId") WHERE "status" = 'pending_confirm';

-- 付款/报销单引用批次；同一批次可多次付款，但累计不得超过批次确认金额。
ALTER TABLE "SpotProcurementPayment"
  ADD COLUMN "actualPurchaseBatchId" TEXT,
  ADD CONSTRAINT "SpotProcurementPayment_actual_batch_fkey"
    FOREIGN KEY ("actualPurchaseBatchId") REFERENCES "ActualPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "SpotProcurementPayment_actual_batch_idx" ON "SpotProcurementPayment"("actualPurchaseBatchId");

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "actualPurchaseBatchId" TEXT,
  ADD CONSTRAINT "ExpenseClaim_actual_batch_fkey"
    FOREIGN KEY ("actualPurchaseBatchId") REFERENCES "ActualPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "ExpenseClaim_actual_batch_idx" ON "ExpenseClaim"("actualPurchaseBatchId");

-- 退款事实泛化：三类实付共用只增退款；既有 PaymentExecution 行语义不变。
ALTER TABLE "PaymentExecutionRefund"
  ALTER COLUMN "paymentExecutionId" DROP NOT NULL,
  ALTER COLUMN "paymentRequestId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "executionType" TEXT NOT NULL DEFAULT 'payment_execution',
  ADD COLUMN IF NOT EXISTS "spotProcurementPaymentExecutionId" TEXT,
  ADD COLUMN IF NOT EXISTS "expenseClaimPaymentExecutionId" TEXT;

-- 批次原事实只读；只允许成本确认和更正投影推进有效金额/成本版本。
-- ENFORCEMENT-BEGIN
-- 同一采购申请不再只允许一笔活动付款：批次内可多次付款；旧 v1 路径保留原限制。
DROP INDEX IF EXISTS "SpotProcurementPayment_one_current_per_procurement";
CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement_non_batch"
  ON "SpotProcurementPayment"("procurementId")
  WHERE "status" NOT IN ('invalidated', 'voided', 'withdrawn', 'rejected', 'returned')
    AND "actualPurchaseBatchId" IS NULL;

-- 约束以 DROP IF EXISTS + ADD 形式重复声明，便于真实 PG 用例先由
-- `prisma db push` 建表、再单独执行本段校验与触发器（不是迁移重放）。
ALTER TABLE "ActualPurchaseBatch"
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_kind_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_supplier_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_total_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_status_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_cost_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatch_fingerprint_check",
  ADD CONSTRAINT "ActualPurchaseBatch_kind_check" CHECK ("kind" IN ('spot_material', 'general')),
  ADD CONSTRAINT "ActualPurchaseBatch_supplier_check" CHECK (length(btrim("supplierName")) > 0),
  ADD CONSTRAINT "ActualPurchaseBatch_total_check" CHECK ("totalAmountCents" > 0 AND "effectiveTotalAmountCents" > 0),
  ADD CONSTRAINT "ActualPurchaseBatch_status_check" CHECK ("status" IN ('recorded', 'cost_confirmed', 'voided')),
  ADD CONSTRAINT "ActualPurchaseBatch_cost_check" CHECK (
    ("costVersion" = 0 AND "costConfirmedAt" IS NULL AND "costConfirmedByUserId" IS NULL AND "costFactId" IS NULL AND "status" = 'recorded')
    OR ("costVersion" > 0 AND "costConfirmedAt" IS NOT NULL AND "costConfirmedByUserId" IS NOT NULL
      AND "status" IN ('cost_confirmed', 'voided')
      AND ("projectId" IS NOT NULL OR "costFactId" IS NULL)
      AND ("projectId" IS NULL OR "costFactId" IS NOT NULL))
  ),
  ADD CONSTRAINT "ActualPurchaseBatch_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "ActualPurchaseBatchLine"
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchLine_name_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchLine_amount_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchLine_quantity_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchLine_unit_price_check",
  ADD CONSTRAINT "ActualPurchaseBatchLine_name_check" CHECK (length(btrim("materialName")) > 0),
  ADD CONSTRAINT "ActualPurchaseBatchLine_amount_check" CHECK ("amountCents" IS NULL OR "amountCents" >= 0),
  ADD CONSTRAINT "ActualPurchaseBatchLine_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0),
  ADD CONSTRAINT "ActualPurchaseBatchLine_unit_price_check" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);

ALTER TABLE "ActualPurchaseBatchCorrection"
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_status_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_amount_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_reason_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_snapshot_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_confirm_state_check",
  DROP CONSTRAINT IF EXISTS "ActualPurchaseBatchCorrection_fingerprint_check",
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_status_check" CHECK ("status" IN ('pending_confirm', 'confirmed')),
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_amount_check" CHECK (
    "originalTotalAmountCents" > 0
    AND "correctedTotalAmountCents" > 0
    AND "correctionDeltaCents" = "correctedTotalAmountCents" - "originalTotalAmountCents"
    AND "correctionDeltaCents" <> 0
  ),
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_reason_check" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_snapshot_check" CHECK (
    jsonb_typeof("originalSnapshot") = 'object'
    AND jsonb_typeof("reversalSnapshot") = 'object'
    AND jsonb_typeof("correctionSnapshot") = 'object'
  ),
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_confirm_state_check" CHECK (
    ("status" = 'pending_confirm' AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL AND "confirmationKey" IS NULL)
    OR ("status" = 'confirmed' AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmationKey" IS NOT NULL)
  ),
  ADD CONSTRAINT "ActualPurchaseBatchCorrection_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "PaymentExecutionRefund"
  DROP CONSTRAINT IF EXISTS "PaymentExecutionRefund_execution_type_check",
  DROP CONSTRAINT IF EXISTS "PaymentExecutionRefund_execution_exclusive_check",
  DROP CONSTRAINT IF EXISTS "PaymentExecutionRefund_spot_execution_fkey",
  DROP CONSTRAINT IF EXISTS "PaymentExecutionRefund_claim_execution_fkey",
  ADD CONSTRAINT "PaymentExecutionRefund_spot_execution_fkey"
    FOREIGN KEY ("spotProcurementPaymentExecutionId") REFERENCES "SpotProcurementPaymentExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentExecutionRefund_claim_execution_fkey"
    FOREIGN KEY ("expenseClaimPaymentExecutionId") REFERENCES "ExpenseClaimPaymentExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentExecutionRefund_execution_type_check" CHECK ("executionType" IN (
    'payment_execution', 'spot_procurement_payment_execution', 'expense_claim_payment_execution'
  )),
  ADD CONSTRAINT "PaymentExecutionRefund_execution_exclusive_check" CHECK (
    ("executionType" = 'payment_execution'
      AND "paymentExecutionId" IS NOT NULL
      AND "spotProcurementPaymentExecutionId" IS NULL
      AND "expenseClaimPaymentExecutionId" IS NULL)
    OR ("executionType" = 'spot_procurement_payment_execution'
      AND "paymentExecutionId" IS NULL
      AND "spotProcurementPaymentExecutionId" IS NOT NULL
      AND "expenseClaimPaymentExecutionId" IS NULL)
    OR ("executionType" = 'expense_claim_payment_execution'
      AND "paymentExecutionId" IS NULL
      AND "spotProcurementPaymentExecutionId" IS NULL
      AND "expenseClaimPaymentExecutionId" IS NOT NULL)
  );

CREATE FUNCTION public."jg_actual_purchase_batch_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actual_purchase_batch_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF (NEW."idempotencyKey", NEW."kind", NEW."procurementId", NEW."procurementVersionId",
      NEW."projectId", NEW."companyEntityId", NEW."supplierName", NEW."totalAmountCents",
      NEW."createdByUserId")
     IS DISTINCT FROM
     (OLD."idempotencyKey", OLD."kind", OLD."procurementId", OLD."procurementVersionId",
      OLD."projectId", OLD."companyEntityId", OLD."supplierName", OLD."totalAmountCents",
      OLD."createdByUserId") THEN
    RAISE EXCEPTION 'actual_purchase_batch_original_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'voided' AND OLD."status" <> 'voided' THEN
    RAISE EXCEPTION 'actual_purchase_batch_void_not_implemented' USING ERRCODE = '23514';
  END IF;
  IF NEW."costVersion" < OLD."costVersion" THEN
    RAISE EXCEPTION 'actual_purchase_batch_cost_version_regressed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ActualPurchaseBatch_guard"
BEFORE UPDATE OR DELETE ON "ActualPurchaseBatch"
FOR EACH ROW EXECUTE FUNCTION public."jg_actual_purchase_batch_guard"();

-- 更正只增：原/反/正三段冻结快照不可改，只允许 pending_confirm -> confirmed。
CREATE FUNCTION public."jg_actual_purchase_batch_correction_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actual_purchase_batch_correction_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'pending_confirm' OR NEW."status" <> 'confirmed' THEN
      RAISE EXCEPTION 'actual_purchase_batch_correction_invalid_transition' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','updatedAt']) THEN
      RAISE EXCEPTION 'actual_purchase_batch_correction_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ActualPurchaseBatchCorrection_guard"
BEFORE UPDATE OR DELETE ON "ActualPurchaseBatchCorrection"
FOR EACH ROW EXECUTE FUNCTION public."jg_actual_purchase_batch_correction_guard"();

-- 超批次总额在数据库层拒绝：净实付（非作废实付 - 已登记退款）+ 本次 <= 有效批次金额。
CREATE FUNCTION public."jg_actual_purchase_batch_spot_capacity_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  batch_id TEXT;
  batch_total BIGINT;
  batch_status TEXT;
  paid_total BIGINT;
BEGIN
  SELECT p."actualPurchaseBatchId" INTO batch_id
  FROM public."SpotProcurementPayment" p WHERE p."id" = NEW."paymentId";
  IF batch_id IS NULL THEN RETURN NEW; END IF;
  SELECT "effectiveTotalAmountCents", "status" INTO batch_total, batch_status
  FROM public."ActualPurchaseBatch" WHERE "id" = batch_id FOR UPDATE;
  IF batch_total IS NULL THEN
    RAISE EXCEPTION 'actual_purchase_batch_missing' USING ERRCODE = '23503';
  END IF;
  IF batch_status = 'voided' THEN
    RAISE EXCEPTION 'actual_purchase_batch_voided' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM(e."amountCents"), 0) - COALESCE((
      SELECT SUM(r."amountCents") FROM public."PaymentExecutionRefund" r
      JOIN public."SpotProcurementPaymentExecution" re ON re."id" = r."spotProcurementPaymentExecutionId"
      JOIN public."SpotProcurementPayment" rp ON rp."id" = re."paymentId"
      WHERE rp."actualPurchaseBatchId" = batch_id AND r."executionType" = 'spot_procurement_payment_execution'
    ), 0)
  INTO paid_total
  FROM public."SpotProcurementPaymentExecution" e
  JOIN public."SpotProcurementPayment" p ON p."id" = e."paymentId"
  WHERE p."actualPurchaseBatchId" = batch_id AND e."voidedAt" IS NULL;
  IF paid_total + NEW."amountCents" > batch_total THEN
    RAISE EXCEPTION 'actual_purchase_batch_overpay' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SpotProcurementPaymentExecution_actual_batch_capacity"
BEFORE INSERT ON "SpotProcurementPaymentExecution"
FOR EACH ROW EXECUTE FUNCTION public."jg_actual_purchase_batch_spot_capacity_guard"();

CREATE FUNCTION public."jg_actual_purchase_batch_claim_capacity_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  batch_id TEXT;
  batch_total BIGINT;
  batch_status TEXT;
  paid_total BIGINT;
BEGIN
  SELECT c."actualPurchaseBatchId" INTO batch_id
  FROM public."ExpenseClaim" c WHERE c."id" = NEW."expenseClaimId";
  IF batch_id IS NULL THEN RETURN NEW; END IF;
  SELECT "effectiveTotalAmountCents", "status" INTO batch_total, batch_status
  FROM public."ActualPurchaseBatch" WHERE "id" = batch_id FOR UPDATE;
  IF batch_total IS NULL THEN
    RAISE EXCEPTION 'actual_purchase_batch_missing' USING ERRCODE = '23503';
  END IF;
  IF batch_status = 'voided' THEN
    RAISE EXCEPTION 'actual_purchase_batch_voided' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM(e."amountCents"), 0) - COALESCE((
      SELECT SUM(r."amountCents") FROM public."PaymentExecutionRefund" r
      JOIN public."ExpenseClaimPaymentExecution" re ON re."id" = r."expenseClaimPaymentExecutionId"
      JOIN public."ExpenseClaim" rc ON rc."id" = re."expenseClaimId"
      WHERE rc."actualPurchaseBatchId" = batch_id AND r."executionType" = 'expense_claim_payment_execution'
    ), 0)
  INTO paid_total
  FROM public."ExpenseClaimPaymentExecution" e
  JOIN public."ExpenseClaim" c ON c."id" = e."expenseClaimId"
  WHERE c."actualPurchaseBatchId" = batch_id;
  IF paid_total + NEW."amountCents" > batch_total THEN
    RAISE EXCEPTION 'actual_purchase_batch_overpay' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ExpenseClaimPaymentExecution_actual_batch_capacity"
BEFORE INSERT ON "ExpenseClaimPaymentExecution"
FOR EACH ROW EXECUTE FUNCTION public."jg_actual_purchase_batch_claim_capacity_guard"();

CREATE INDEX "PaymentExecutionRefund_spot_execution_idx"
  ON "PaymentExecutionRefund"("spotProcurementPaymentExecutionId", "receivedAt");
CREATE INDEX "PaymentExecutionRefund_claim_execution_idx"
  ON "PaymentExecutionRefund"("expenseClaimPaymentExecutionId", "receivedAt");

CREATE OR REPLACE FUNCTION public."jg_payment_execution_refund_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  execution_amount BIGINT;
  execution_paid_at DATE;
  already_refunded BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_execution_refund_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payment_execution_refund_is_append_only' USING ERRCODE = '23514';
  END IF;

  IF NEW."executionType" = 'payment_execution' THEN
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."PaymentExecution" WHERE "id" = NEW."paymentExecutionId";
  ELSIF NEW."executionType" = 'spot_procurement_payment_execution' THEN
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."SpotProcurementPaymentExecution"
    WHERE "id" = NEW."spotProcurementPaymentExecutionId" AND "voidedAt" IS NULL;
  ELSE
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."ExpenseClaimPaymentExecution" WHERE "id" = NEW."expenseClaimPaymentExecutionId";
  END IF;

  IF execution_amount IS NULL THEN
    RAISE EXCEPTION 'payment_execution_refund_original_missing' USING ERRCODE = '23503';
  END IF;
  IF NEW."receivedAt" < execution_paid_at THEN
    RAISE EXCEPTION 'payment_execution_refund_before_payment' USING ERRCODE = '23514';
  END IF;
  IF NEW."receivedAt" > CURRENT_DATE THEN
    RAISE EXCEPTION 'payment_execution_refund_future_date' USING ERRCODE = '23514';
  END IF;

  IF NEW."executionType" = 'payment_execution' THEN
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'payment_execution' AND "paymentExecutionId" = NEW."paymentExecutionId";
  ELSIF NEW."executionType" = 'spot_procurement_payment_execution' THEN
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'spot_procurement_payment_execution'
      AND "spotProcurementPaymentExecutionId" = NEW."spotProcurementPaymentExecutionId";
  ELSE
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'expense_claim_payment_execution'
      AND "expenseClaimPaymentExecutionId" = NEW."expenseClaimPaymentExecutionId";
  END IF;

  IF already_refunded + NEW."amountCents" > execution_amount THEN
    RAISE EXCEPTION 'payment_execution_refund_cap_exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 既有 #400 触发器引用被替换的函数；新库（db push 建表）补建同名触发器。
DROP TRIGGER IF EXISTS "PaymentExecutionRefund_guard" ON "PaymentExecutionRefund";
CREATE TRIGGER "PaymentExecutionRefund_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "PaymentExecutionRefund"
FOR EACH ROW EXECUTE FUNCTION public."jg_payment_execution_refund_guard"();
