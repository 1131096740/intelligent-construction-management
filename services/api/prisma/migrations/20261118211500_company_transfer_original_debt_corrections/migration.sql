BEGIN;

CREATE TABLE public."CompanyTransferOriginalDebtCorrection" (
  id TEXT PRIMARY KEY,
  "outgoingEventId" TEXT NOT NULL REFERENCES public."CompanyTransferEvent"(id) ON DELETE RESTRICT,
  "originalSource" TEXT NOT NULL,
  "targetOriginalSource" TEXT NOT NULL,
  "reason" TEXT NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 2000),
  "requestedByUserId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestKey" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','confirmed')),
  "confirmedByUserId" TEXT REFERENCES public."User"(id) ON DELETE RESTRICT,
  "confirmedAt" TIMESTAMP(3),
  "confirmKey" TEXT UNIQUE,
  "selfReviewReason" TEXT,
  CHECK ("originalSource" <> "targetOriginalSource"),
  CHECK (("status" = 'confirmed' AND num_nonnulls("confirmedByUserId","confirmedAt","confirmKey") = 3)
    OR ("status" = 'pending' AND num_nonnulls("confirmedByUserId","confirmedAt","confirmKey","selfReviewReason") = 0)),
  CHECK ("status" <> 'confirmed' OR "confirmedByUserId" <> "requestedByUserId"
    OR coalesce(length(btrim("selfReviewReason")), 0) > 0)
);

CREATE UNIQUE INDEX "CompanyTransferOriginalDebtCorrection_one_confirmed"
  ON public."CompanyTransferOriginalDebtCorrection"("outgoingEventId") WHERE "status" = 'confirmed';
CREATE INDEX "CompanyTransferOriginalDebtCorrection_outgoingEventId_idx"
  ON public."CompanyTransferOriginalDebtCorrection"("outgoingEventId");
CREATE INDEX "CompanyTransferOriginalDebtCorrection_originalSource_idx"
  ON public."CompanyTransferOriginalDebtCorrection"("originalSource");
CREATE INDEX "CompanyTransferOriginalDebtCorrection_targetOriginalSource_idx"
  ON public."CompanyTransferOriginalDebtCorrection"("targetOriginalSource");

CREATE FUNCTION public.jg_company_transfer_original_source(transfer public."CompanyTransfer")
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce('loan:' || transfer."originalTransferId", 'proxy:' || transfer."originalProxyId",
    'movement:' || transfer."originalFundMovementRelationshipId", 'inter_entity:' || transfer."originalInterEntityRelationshipId",
    'operational:' || transfer."originalOperationalPaymentId");
$$;

CREATE FUNCTION public.jg_company_transfer_correction_delta(original_source TEXT, cutoff TIMESTAMP DEFAULT NULL,
    received_only BOOLEAN DEFAULT FALSE, excluded_transfer TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(
    (CASE WHEN correction."targetOriginalSource" = original_source THEN 1 ELSE -1 END)
    * (CASE WHEN received_only THEN received.amount ELSE outgoing."amountCents" END)
  ), 0)::BIGINT
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId"
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(incoming."amountCents"),0) AS amount
    FROM public."CompanyTransferEvent" incoming WHERE incoming."outgoingEventId" = outgoing.id
      AND incoming.kind = 'incoming' AND (cutoff IS NULL OR incoming."occurredAt" <= cutoff)
  ) received ON received_only
  WHERE correction.status = 'confirmed' AND (correction."originalSource" = original_source OR correction."targetOriginalSource" = original_source)
    AND (cutoff IS NULL OR outgoing."occurredAt" <= cutoff)
    AND (excluded_transfer IS NULL OR outgoing."transferId" <> excluded_transfer);
$$;

CREATE FUNCTION public.jg_company_transfer_original_used(original_source TEXT, cutoff TIMESTAMP DEFAULT NULL, excluded_transfer TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(
    CASE WHEN cutoff IS NULL THEN t."amountCents" - actual.returned ELSE actual.sent - actual.returned END
  ),0)::BIGINT + public.jg_company_transfer_correction_delta(original_source, cutoff, FALSE, excluded_transfer)
  FROM public."CompanyTransfer" t
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(e."amountCents") FILTER (WHERE e.kind = 'outgoing'),0) AS sent,
      coalesce(sum(e."amountCents") FILTER (WHERE e.kind = 'returned'),0) AS returned
    FROM public."CompanyTransferEvent" e WHERE e."transferId" = t.id AND (cutoff IS NULL OR e."occurredAt" <= cutoff)
  ) actual ON TRUE
  WHERE t.status IN ('submitted','approved') AND public.jg_company_transfer_original_source(t) = original_source
    AND (excluded_transfer IS NULL OR t.id <> excluded_transfer);
$$;

CREATE FUNCTION public.jg_company_transfer_original_checkpoints(original_source TEXT, earliest TIMESTAMP)
RETURNS TABLE (checkpoint TIMESTAMP) LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT earliest
  UNION
  SELECT e."occurredAt" FROM public."CompanyTransferEvent" e
  JOIN public."CompanyTransfer" t ON t.id = e."transferId"
  LEFT JOIN public."CompanyTransferOriginalDebtCorrection" correction ON correction."outgoingEventId" = e.id AND correction.status = 'confirmed'
  WHERE e.kind = 'outgoing' AND e."occurredAt" > earliest
    AND coalesce(correction."targetOriginalSource", public.jg_company_transfer_original_source(t)) = original_source;
$$;

CREATE OR REPLACE FUNCTION public.guard_company_transfer_original_reservation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cap BIGINT;
BEGIN
  IF NEW.kind <> 'repayment' OR NEW.status NOT IN ('submitted','approved') THEN RETURN NEW; END IF;
  cap := public.company_transfer_debt_limit(NEW, NULL);
  IF public.jg_company_transfer_original_used(public.jg_company_transfer_original_source(NEW), NULL, NEW.id) + NEW."amountCents" > cap THEN
    RAISE EXCEPTION 'company_transfer_original_capacity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_company_transfer_dated_repayment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE transfer public."CompanyTransfer"; original_source TEXT; checked TIMESTAMP;
BEGIN
  IF NEW.kind <> 'outgoing' THEN RETURN NEW; END IF;
  SELECT * INTO transfer FROM public."CompanyTransfer" WHERE id = NEW."transferId";
  IF transfer.kind <> 'repayment' THEN RETURN NEW; END IF;
  original_source := public.jg_company_transfer_original_source(transfer);
  FOR checked IN SELECT checkpoint FROM public.jg_company_transfer_original_checkpoints(original_source, NEW."occurredAt")
  LOOP
    IF public.jg_company_transfer_original_used(original_source, checked) + NEW."amountCents" >
       public.company_transfer_debt_limit(transfer, checked) THEN
      RAISE EXCEPTION 'company_transfer_dated_original_capacity';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.jg_company_transfer_correction_family(original_source TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN split_part(original_source, ':', 1) IN ('inter_entity', 'operational')
    THEN 'project_ledger_proxy' ELSE split_part(original_source, ':', 1) END;
$$;

CREATE FUNCTION public.jg_company_transfer_correction_target(original public."CompanyTransfer", target TEXT)
RETURNS public."CompanyTransfer" LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_id TEXT := split_part(target, ':', 2);
BEGIN
  original."originalTransferId" := NULL;
  original."originalProxyId" := NULL;
  original."originalFundMovementRelationshipId" := NULL;
  original."originalInterEntityRelationshipId" := NULL;
  original."originalOperationalPaymentId" := NULL;
  CASE split_part(target, ':', 1)
    WHEN 'proxy' THEN original."originalProxyId" := target_id;
    WHEN 'movement' THEN original."originalFundMovementRelationshipId" := target_id;
    WHEN 'inter_entity' THEN original."originalInterEntityRelationshipId" := target_id;
    WHEN 'operational' THEN original."originalOperationalPaymentId" := target_id;
    ELSE RAISE EXCEPTION 'company_transfer_correction_source_invalid';
  END CASE;
  RETURN original;
END;
$$;

CREATE FUNCTION public.jg_company_transfer_correction_validate(event_id TEXT, target_source TEXT)
RETURNS TEXT LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  outgoing public."CompanyTransferEvent";
  transfer public."CompanyTransfer";
  target public."CompanyTransfer";
  original_source TEXT;
  received BIGINT;
  checked TIMESTAMP;
BEGIN
  PERFORM pg_advisory_xact_lock(190731,91);
  SELECT * INTO outgoing FROM public."CompanyTransferEvent" WHERE id = event_id FOR UPDATE;
  SELECT * INTO transfer FROM public."CompanyTransfer" WHERE id = outgoing."transferId" FOR UPDATE;
  original_source := public.jg_company_transfer_original_source(transfer);
  IF transfer."requiresParallelRepaymentApproval" IS DISTINCT FROM TRUE OR transfer.status <> 'approved'
    OR outgoing.kind <> 'outgoing' OR original_source IS NULL OR target_source = original_source
    OR public.jg_company_transfer_correction_family(original_source) <> public.jg_company_transfer_correction_family(target_source)
    OR target_source !~ '^(proxy|movement|inter_entity|operational):[A-Za-z0-9_-]{1,128}$'
  THEN RAISE EXCEPTION 'company_transfer_correction_source_invalid'; END IF;
  SELECT coalesce(sum("amountCents") FILTER (WHERE kind = 'incoming'),0) INTO received
    FROM public."CompanyTransferEvent" WHERE "outgoingEventId" = outgoing.id;
  IF received <> outgoing."amountCents" THEN RAISE EXCEPTION 'company_transfer_correction_requires_receipt'; END IF;
  target := public.jg_company_transfer_correction_target(transfer, target_source);
  IF target."originalFundMovementRelationshipId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."FundMovementRelationshipEntry" movement
    WHERE movement.id = target."originalFundMovementRelationshipId" AND movement."entryKind" = 'proxy_payment'
  ) THEN RAISE EXCEPTION 'company_transfer_correction_source_invalid'; END IF;
  -- Use the existing typed original-debt checks and root locks, in stable key order.
  IF original_source < target_source THEN
    PERFORM public.company_transfer_debt_limit(transfer, NULL);
    PERFORM public.company_transfer_debt_limit(target, NULL);
  ELSE
    PERFORM public.company_transfer_debt_limit(target, NULL);
    PERFORM public.company_transfer_debt_limit(transfer, NULL);
  END IF;
  IF public.jg_company_transfer_original_used(target_source) + outgoing."amountCents" >
     public.company_transfer_debt_limit(target, NULL) THEN RAISE EXCEPTION 'company_transfer_correction_capacity'; END IF;
  FOR checked IN SELECT checkpoint FROM public.jg_company_transfer_original_checkpoints(target_source, outgoing."occurredAt")
  LOOP
    IF public.jg_company_transfer_original_used(target_source, checked) + outgoing."amountCents" >
       public.company_transfer_debt_limit(target, checked) THEN RAISE EXCEPTION 'company_transfer_correction_capacity'; END IF;
  END LOOP;
  RETURN original_source;
END;
$$;

CREATE FUNCTION public.guard_company_transfer_original_debt_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE actor_id TEXT; required_role TEXT; source TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'company_transfer_correction_immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'company_transfer_correction_requires_request'; END IF;
    actor_id := NEW."requestedByUserId";
    required_role := 'finance_staff';
  ELSE
    IF OLD.status <> 'pending' OR NEW.status <> 'confirmed'
      OR (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','confirmKey','selfReviewReason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','confirmKey','selfReviewReason'])
    THEN RAISE EXCEPTION 'company_transfer_correction_immutable'; END IF;
    actor_id := NEW."confirmedByUserId";
    required_role := 'finance_director';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."UserPosition" assignment
    JOIN public."Position" position ON position.id = assignment."positionId"
    JOIN public."User" actor ON actor.id = assignment."userId" AND actor."isActive"
    WHERE assignment."userId" = actor_id AND assignment."projectId" IS NULL
      AND (position.key = required_role OR (TG_OP = 'INSERT' AND position.key = 'finance_director'))
  ) THEN RAISE EXCEPTION 'company_transfer_correction_role_required'; END IF;
  source := public.jg_company_transfer_correction_validate(NEW."outgoingEventId", NEW."targetOriginalSource");
  IF source IS DISTINCT FROM NEW."originalSource" OR EXISTS (
    SELECT 1 FROM public."CompanyTransferOriginalDebtCorrection" prior WHERE prior."outgoingEventId" = NEW."outgoingEventId" AND prior.status = 'confirmed'
  ) THEN RAISE EXCEPTION 'company_transfer_correction_already_applied'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CompanyTransferOriginalDebtCorrection_guard"
BEFORE INSERT OR UPDATE OR DELETE ON public."CompanyTransferOriginalDebtCorrection"
FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_original_debt_correction();

CREATE OR REPLACE FUNCTION public.guard_legacy_debt_against_transfer_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_id TEXT; original_amount BIGINT; other_decreases BIGINT; reserved BIGINT;
BEGIN
 IF NEW."direction"<>'decrease' OR NEW."status"<>'confirmed' OR NEW."adjustsEntryId" IS NULL THEN RETURN NEW; END IF;
 original_id:=NEW."adjustsEntryId";
 IF TG_TABLE_NAME='InterEntityRelationshipEntry' THEN
  SELECT "amountCents" INTO original_amount FROM "InterEntityRelationshipEntry" WHERE "id"=original_id FOR UPDATE;
  SELECT coalesce(sum("amountCents"),0) INTO other_decreases FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=original_id AND "id"<>NEW."id" AND "status"='confirmed' AND "direction"='decrease';
 ELSE
  SELECT "amountCents" INTO original_amount FROM "FundMovementRelationshipEntry" WHERE "id"=original_id FOR UPDATE;
  SELECT coalesce(sum("amountCents"),0) INTO other_decreases FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=original_id AND "id"<>NEW."id" AND "status"='confirmed' AND "direction"='decrease';
 END IF;
 reserved := public.jg_company_transfer_original_used(
   (CASE WHEN TG_TABLE_NAME = 'InterEntityRelationshipEntry' THEN 'inter_entity:' ELSE 'movement:' END) || original_id
 );
 IF other_decreases+reserved+NEW."amountCents">original_amount THEN RAISE EXCEPTION 'company_transfer_original_capacity'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.jg_contract_proxy_adjustment_preserve_corrected_debt()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  original public."ContractProxyExecution";
  original_source TEXT;
  other_changes BIGINT;
BEGIN
  IF NEW."originalId" IS NULL OR NEW.status NOT IN ('pending_confirm','confirmed') THEN RETURN NEW; END IF;
  original_source := 'proxy:' || NEW."originalId";
  SELECT * INTO original FROM public."ContractProxyExecution" WHERE id = NEW."originalId" FOR UPDATE;
  IF original."frozenSource" #>> '{debtor,kind}' <> 'participating_company'
    OR original."frozenSource" #>> '{actualPayer,kind}' <> 'participating_company'
    OR NOT EXISTS (
      SELECT 1 FROM public."CompanyTransferOriginalDebtCorrection" change WHERE change.status = 'confirmed'
        AND (change."originalSource" = original_source OR change."targetOriginalSource" = original_source)
    )
  THEN RETURN NEW; END IF;
  SELECT coalesce(sum(child."amountCents"),0) INTO other_changes
  FROM public."ContractProxyExecution" child WHERE child."originalId" = original.id AND child.id <> NEW.id
    AND child.status IN ('pending_confirm','confirmed');
  IF public.jg_company_transfer_original_used(original_source) + other_changes + NEW."amountCents" > original."amountCents" THEN
    RAISE EXCEPTION 'company_transfer_original_capacity';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ContractProxyExecution_corrected_transfer_capacity"
BEFORE INSERT OR UPDATE ON public."ContractProxyExecution"
FOR EACH ROW WHEN (NEW."originalId" IS NOT NULL)
EXECUTE FUNCTION public.jg_contract_proxy_adjustment_preserve_corrected_debt();

COMMIT;
