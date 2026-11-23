-- #400 真库 db push 后补齐 schema.prisma 无法表达的数据库兜底约束。
-- 与迁移 20261123010000_payment_execution_refund_and_correction 中的同名定义一致。
CREATE FUNCTION public."jg_payment_execution_refund_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  execution_amount BIGINT;
  execution_paid_at DATE;
  already_refunded BIGINT;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
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

CREATE FUNCTION public."jg_payment_execution_correction_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_execution_correction_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'pending_confirm' OR NEW."status" <> 'confirmed' THEN
    RAISE EXCEPTION 'payment_execution_correction_invalid_transition' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','fundRegistrationId','updatedAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','confirmationKey','reviewNote','selfReviewReason','fundRegistrationId','updatedAt']) THEN
    RAISE EXCEPTION 'payment_execution_correction_snapshot_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PaymentExecutionCorrection_guard"
BEFORE UPDATE OR DELETE ON "PaymentExecutionCorrection"
FOR EACH ROW EXECUTE FUNCTION public."jg_payment_execution_correction_guard"();
CREATE UNIQUE INDEX "PaymentExecutionCorrection_one_open_idx"
  ON "PaymentExecutionCorrection"("paymentExecutionId")
  WHERE "status" = 'pending_confirm';
