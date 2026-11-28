BEGIN;

ALTER TABLE public."PaymentRequest"
  ADD COLUMN "remainingWithdrawnCents" BIGINT,
  ADD CONSTRAINT "PaymentRequest_remaining_withdrawn_cents_check"
  CHECK (
    "remainingWithdrawnCents" IS NULL OR (
      "sourceType" = 'signed_settlement'
      AND "approvedAmountCents" IS NOT NULL
      AND "remainingWithdrawnCents" BETWEEN 1 AND "approvedAmountCents"
    )
  );

CREATE FUNCTION public.jg_guard_payment_remaining_withdrawal_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."remainingWithdrawnCents" IS NOT NULL THEN
      RAISE EXCEPTION '付款申请的未付款须在原审批通过后撤回' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."remainingWithdrawnCents" IS DISTINCT FROM NEW."remainingWithdrawnCents" THEN
    IF OLD."remainingWithdrawnCents" IS NOT NULL
      OR OLD."sourceType" <> 'signed_settlement'
      OR OLD."status" NOT IN ('approved_pending_payment', 'partially_paid')
      OR OLD."approvedAmountCents" IS NULL
      OR NEW."remainingWithdrawnCents" IS DISTINCT FROM OLD."approvedAmountCents" - OLD."paidAmountCents"
      OR NEW."approvedAmountCents" IS DISTINCT FROM OLD."approvedAmountCents"
      OR NEW."paidAmountCents" IS DISTINCT FROM OLD."paidAmountCents"
    THEN
      RAISE EXCEPTION '付款申请只能一次性撤回原审批尚未支付的部分' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_payment_remaining_withdrawal_v1() FROM PUBLIC;

CREATE TRIGGER "PaymentRequest_remaining_withdrawal_guard"
  BEFORE INSERT OR UPDATE OF "remainingWithdrawnCents" ON public."PaymentRequest"
  FOR EACH ROW EXECUTE FUNCTION public.jg_guard_payment_remaining_withdrawal_v1();

CREATE FUNCTION public.jg_guard_withdrawn_payment_execution_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE withdrawn_cents bigint;
BEGIN
  SELECT request."remainingWithdrawnCents" INTO withdrawn_cents
  FROM public."PaymentRequest" request
  WHERE request.id = NEW."paymentRequestId"
  FOR UPDATE OF request;
  IF withdrawn_cents IS NOT NULL THEN
    RAISE EXCEPTION '原付款申请的未付金额已撤回' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_withdrawn_payment_execution_v1() FROM PUBLIC;

CREATE TRIGGER "PaymentExecution_withdrawn_remainder_guard"
  BEFORE INSERT ON public."PaymentExecution"
  FOR EACH ROW EXECUTE FUNCTION public.jg_guard_withdrawn_payment_execution_v1();

COMMIT;
