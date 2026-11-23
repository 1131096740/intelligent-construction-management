-- #400 统一财务更正与实际退款登记。
-- 退款与更正都是新事实：原 PaymentExecution 不改写，也不以负数冲回
-- PaymentExecution.amountCents > 0 的既有约束。

CREATE TABLE "PaymentExecutionRefund" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "paymentRequestId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "accountId" TEXT,
  "fundRegistrationId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "receivedAt" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentExecutionRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionRefund_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "PaymentExecutionRefund_execution_fkey" FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaymentExecutionRefund_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "PaymentExecutionRefund_reason_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "PaymentExecutionRefund_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "PaymentExecutionRefund_execution_received_idx" ON "PaymentExecutionRefund"("paymentExecutionId", "receivedAt");
CREATE INDEX "PaymentExecutionRefund_paymentRequestId_idx" ON "PaymentExecutionRefund"("paymentRequestId");
CREATE INDEX "PaymentExecutionRefund_accountId_idx" ON "PaymentExecutionRefund"("accountId");
CREATE INDEX "PaymentExecutionRefund_recordedById_idx" ON "PaymentExecutionRefund"("recordedByUserId", "createdAt");

-- 退款是只增事实：累计退款不得超过原实付，且不得早于原付款业务日或晚于当天。
CREATE FUNCTION public."jg_payment_execution_refund_guard"()
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

  SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
  FROM public."PaymentExecution" WHERE "id" = NEW."paymentExecutionId";
  IF execution_amount IS NULL THEN
    RAISE EXCEPTION 'payment_execution_refund_original_missing' USING ERRCODE = '23503';
  END IF;
  IF NEW."receivedAt" < execution_paid_at THEN
    RAISE EXCEPTION 'payment_execution_refund_before_payment' USING ERRCODE = '23514';
  END IF;
  IF NEW."receivedAt" > CURRENT_DATE THEN
    RAISE EXCEPTION 'payment_execution_refund_future_date' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
  FROM public."PaymentExecutionRefund" WHERE "paymentExecutionId" = NEW."paymentExecutionId";
  IF already_refunded + NEW."amountCents" > execution_amount THEN
    RAISE EXCEPTION 'payment_execution_refund_cap_exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentExecutionRefund_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "PaymentExecutionRefund"
FOR EACH ROW EXECUTE FUNCTION public."jg_payment_execution_refund_guard"();

CREATE TABLE "PaymentExecutionCorrection" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "paymentRequestId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_confirm',
  "correctionReason" TEXT NOT NULL,
  "selfReviewReason" TEXT,
  "reviewNote" TEXT,
  "originalAmountCents" BIGINT NOT NULL,
  "correctedAmountCents" BIGINT NOT NULL,
  "amountDeltaCents" BIGINT NOT NULL,
  "originalPaidAt" DATE NOT NULL,
  "correctedPaidAt" DATE NOT NULL,
  "originalSnapshot" JSONB NOT NULL,
  "reversalSnapshot" JSONB NOT NULL,
  "correctionSnapshot" JSONB NOT NULL,
  "fundRegistrationId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationKey" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentExecutionCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionCorrection_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "PaymentExecutionCorrection_confirmationKey_key" UNIQUE ("confirmationKey"),
  CONSTRAINT "PaymentExecutionCorrection_execution_fkey" FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaymentExecutionCorrection_status_check" CHECK ("status" IN ('pending_confirm', 'confirmed')),
  CONSTRAINT "PaymentExecutionCorrection_amount_check" CHECK (
    "originalAmountCents" > 0 AND "correctedAmountCents" > 0
    AND "amountDeltaCents" = "correctedAmountCents" - "originalAmountCents"
  ),
  CONSTRAINT "PaymentExecutionCorrection_reason_check" CHECK (length(btrim("correctionReason")) > 0),
  CONSTRAINT "PaymentExecutionCorrection_snapshot_check" CHECK (
    jsonb_typeof("originalSnapshot") = 'object'
    AND jsonb_typeof("reversalSnapshot") = 'object'
    AND jsonb_typeof("correctionSnapshot") = 'object'
  ),
  CONSTRAINT "PaymentExecutionCorrection_confirm_state_check" CHECK (
    ("status" = 'pending_confirm' AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL AND "confirmationKey" IS NULL)
    OR ("status" = 'confirmed' AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmationKey" IS NOT NULL)
  ),
  CONSTRAINT "PaymentExecutionCorrection_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "PaymentExecutionCorrection_execution_status_idx" ON "PaymentExecutionCorrection"("paymentExecutionId", "status");
CREATE INDEX "PaymentExecutionCorrection_paymentRequestId_idx" ON "PaymentExecutionCorrection"("paymentRequestId");
CREATE INDEX "PaymentExecutionCorrection_status_created_idx" ON "PaymentExecutionCorrection"("status", "createdAt");
CREATE UNIQUE INDEX "PaymentExecutionCorrection_one_open_idx"
  ON "PaymentExecutionCorrection"("paymentExecutionId")
  WHERE "status" = 'pending_confirm';

-- 更正三段快照与身份不可改；只允许 pending_confirm → confirmed 的确认推进。
CREATE FUNCTION public."jg_payment_execution_correction_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_execution_correction_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'pending_confirm' OR NEW."status" <> 'confirmed' THEN
      RAISE EXCEPTION 'payment_execution_correction_invalid_transition' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','fundRegistrationId','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','fundRegistrationId','updatedAt']) THEN
      RAISE EXCEPTION 'payment_execution_correction_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentExecutionCorrection_guard"
BEFORE UPDATE OR DELETE ON "PaymentExecutionCorrection"
FOR EACH ROW EXECUTE FUNCTION public."jg_payment_execution_correction_guard"();

-- 资金登记新增两种“已确认、无需审批”的入账/回补 kind；既有 kind 语义不变。
ALTER TABLE public."FundAccountBalanceRegistration"
  DROP CONSTRAINT IF EXISTS "FundAccountBalanceRegistration_transfer_kind_check",
  ADD CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check" CHECK (
    ("kind" = 'opening' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed')
    OR ("kind" = 'correction' AND "transferId" IS NULL AND "approvalInstanceId" IS NOT NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review', 'confirmed', 'returned', 'withdrawn'))
    OR ("kind" = 'transfer' AND "transferId" IS NOT NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
    OR ("kind" IN ('advance_receipt', 'principal_return', 'operational_payment', 'payment_refund', 'payment_correction') AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
  );
