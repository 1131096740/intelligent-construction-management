BEGIN;
ALTER TABLE public."SpotProcurementPayment"
  ADD COLUMN "originalDebtorCompanyId" TEXT REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
  ADD COLUMN "originalDebtorCompanyName" TEXT,
  ADD COLUMN "originalDebtorApprovalId" TEXT REFERENCES public."ApprovalInstance"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "SpotProcurementPayment_original_debtor_tuple" CHECK (
    num_nonnulls("originalDebtorCompanyId","originalDebtorCompanyName","originalDebtorApprovalId") = 0 OR
    (num_nonnulls("originalDebtorCompanyId","originalDebtorCompanyName","originalDebtorApprovalId") = 3
      AND length(btrim("originalDebtorCompanyName")) > 0)
  );

CREATE FUNCTION public.jg_spot_freeze_original_debtor()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE approval_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF num_nonnulls(NEW."originalDebtorCompanyId",NEW."originalDebtorCompanyName",NEW."originalDebtorApprovalId") <> 0 THEN
      RAISE EXCEPTION 'spot_original_debtor_requires_first_approval';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."originalDebtorCompanyId",NEW."originalDebtorCompanyName",NEW."originalDebtorApprovalId") IS DISTINCT FROM
     (OLD."originalDebtorCompanyId",OLD."originalDebtorCompanyName",OLD."originalDebtorApprovalId") THEN
    RAISE EXCEPTION 'spot_original_debtor_immutable';
  END IF;
  IF OLD."approvedAt" IS NOT NULL OR OLD."originalDebtorApprovalId" IS NOT NULL
    OR OLD.status <> 'approval_pending' OR NEW.status <> 'approved_pending_payment'
    OR NEW."approvedAt" IS NULL OR OLD."paymentType" IS NULL OR OLD."factsFrozenAt" IS NULL
    OR OLD."payerCompanyEntityId" IS NULL OR nullif(btrim(OLD."payerCompanyNameSnapshot"),'') IS NULL
  THEN RETURN NEW; END IF;

  IF (NEW."payerCompanyEntityId",NEW."payerCompanyNameSnapshot") IS DISTINCT FROM
     (OLD."payerCompanyEntityId",OLD."payerCompanyNameSnapshot") THEN
    RAISE EXCEPTION 'spot_original_debtor_approval_payer_changed';
  END IF;

  SELECT round.id INTO approval_id FROM public."ApprovalInstance" round
  WHERE round."businessType" = 'spot_procurement_payment' AND round."businessId" = NEW.id AND round.status = 'approved'
    AND round.xmin::text = (txid_current() % 4294967296)::text
    AND EXISTS (SELECT 1 FROM public."ApprovalActionLog" action WHERE action."approvalInstanceId" = round.id
      AND action.action = 'approve' AND action."signatureVersionIdSnapshot" IS NOT NULL
      AND action.xmin::text = (txid_current() % 4294967296)::text)
  ORDER BY round."createdAt" DESC, round.id DESC LIMIT 1;
  IF approval_id IS NULL THEN RAISE EXCEPTION 'spot_original_debtor_requires_first_approval'; END IF;

  NEW."originalDebtorCompanyId" := OLD."payerCompanyEntityId";
  NEW."originalDebtorCompanyName" := OLD."payerCompanyNameSnapshot";
  NEW."originalDebtorApprovalId" := approval_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_spot_freeze_original_debtor() FROM PUBLIC;
CREATE TRIGGER "SpotProcurementPayment_original_debtor_guard"
BEFORE INSERT OR UPDATE ON public."SpotProcurementPayment"
FOR EACH ROW EXECUTE FUNCTION public.jg_spot_freeze_original_debtor();

-- Keep the single operational debit authority and replace only the Spot debtor reference.
DO $$
DECLARE definition TEXT; old_predicate TEXT := 'request."payerCompanyEntityId" = fact."originalDebtorCompanyId"';
BEGIN
  SELECT pg_get_functiondef('public.jg_registered_operational_payment_conservation()'::regprocedure) INTO STRICT definition;
  IF length(definition) - length(replace(definition,old_predicate,'')) <> length(old_predicate) THEN
    RAISE EXCEPTION 'registered operational payment original debtor source drift';
  END IF;
  EXECUTE replace(definition,old_predicate,
    'request."originalDebtorCompanyId" = fact."originalDebtorCompanyId" AND request."originalDebtorApprovalId" IS NOT NULL');
END;
$$;
COMMIT;
