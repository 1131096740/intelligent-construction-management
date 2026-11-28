-- #411 real-PostgreSQL fixture: the guards exercised by the third-company

-- repayment path, extracted from the migrations that own them.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- 20260814120000_operating_ledger_runtime_write_guard

CREATE OR REPLACE FUNCTION "assertOperatingLedgerWriteContext"(
  p_actor_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  authorized_actor_user_id TEXT;
BEGIN
  SELECT "actorUserId"
    INTO authorized_actor_user_id
    FROM public."OperatingLedgerWriteContext"
    WHERE "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current();

  IF authorized_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION '正式经营账必须通过受控写入函数登记' USING ERRCODE = '42501';
  END IF;
END;
$$;


-- 20261020120000_company_transfer

CREATE FUNCTION guard_company_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "CompanyTransfer"%ROWTYPE; o "VerifiedBankTransactionObservation"%ROWTYPE; r "ContractBankVerificationRequest"%ROWTYPE; original "CompanyTransferEvent"%ROWTYPE; expected_company TEXT; expected_project TEXT; expected_account TEXT; used BIGINT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company_transfer_event_immutable'; END IF;
 PERFORM public."assertOperatingLedgerWriteContext"(NEW."recordedByUserId");
 SELECT * INTO t FROM "CompanyTransfer" WHERE "id"=NEW."transferId" FOR UPDATE;
 IF t."status" IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'company_transfer_not_approved'; END IF;
 SELECT * INTO o FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 SELECT * INTO r FROM "ContractBankVerificationRequest" WHERE "observationId"=o."id" AND "status"='confirmed';
 expected_company:=CASE WHEN NEW."kind"='incoming' THEN t."destinationCompanyId" ELSE t."sourceCompanyId" END;
 expected_project:=CASE WHEN NEW."kind"='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END;
 expected_account:=CASE WHEN NEW."kind"='incoming' THEN t."destinationAccountHash" ELSE t."sourceAccountHash" END;
 IF r."id" IS NULL OR r."companyEntityId"<>expected_company OR r."projectId" IS DISTINCT FROM expected_project OR r."accountHash"<>expected_account OR o."amountCents"<>NEW."amountCents" OR o."occurredAt"<>NEW."occurredAt" OR o."direction"<>(CASE WHEN NEW."kind"='outgoing' THEN 'outflow' ELSE 'inflow' END) THEN RAISE EXCEPTION 'company_transfer_bank_mismatch'; END IF;
 IF NEW."kind"='outgoing' THEN
  SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent" WHERE "transferId"=t."id" AND "kind"='outgoing';
  IF used+NEW."amountCents">t."amountCents" THEN RAISE EXCEPTION 'company_transfer_approved_capacity'; END IF;
 ELSE
  SELECT * INTO original FROM "CompanyTransferEvent" WHERE "id"=NEW."outgoingEventId";
  IF original."transferId" IS DISTINCT FROM t."id" OR original."kind" IS DISTINCT FROM 'outgoing' OR NEW."occurredAt"<original."occurredAt" OR NEW."recordedByUserId"=original."recordedByUserId" THEN RAISE EXCEPTION 'company_transfer_independent_reconciliation_required'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent" WHERE "outgoingEventId"=original."id";
  IF used+NEW."amountCents">original."amountCents" THEN RAISE EXCEPTION 'company_transfer_receipt_capacity'; END IF;
 END IF; IF EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" observed JOIN "CompanyEntity" c ON c."id"=observed."holderCompanyEntityId" WHERE observed."id"=NEW."observationId" AND NOT c."isActive") AND t."kind"<>'repayment' THEN RAISE EXCEPTION 'inactive_company_repayment_only'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION guard_company_transfer_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company_transfer_bank_claim_immutable'; END IF;
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM "CompanyTransferEvent" WHERE "id"=NEW."eventId" AND "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "BankTransactionClaim" WHERE "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "ContractBankEventClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF; RETURN NEW;
END; $$;

CREATE FUNCTION guard_other_bank_claim_against_company_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" observed JOIN "CompanyEntity" c ON c."id"=observed."holderCompanyEntityId" WHERE observed."id"=NEW."observationId" AND NOT c."isActive") THEN RAISE EXCEPTION 'inactive_company_repayment_only'; END IF;
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "CompanyTransferBankClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF; RETURN NEW; END; $$;

CREATE FUNCTION require_company_transfer_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM "CompanyTransferBankClaim" WHERE "eventId"=NEW."id" AND "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'company_transfer_bank_claim_required'; END IF; RETURN NEW; END; $$;


-- 20261118210000_company_proxy_repayment_approval

CREATE OR REPLACE FUNCTION public.guard_company_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ApprovalInstance"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'company_transfer_immutable'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) THEN RAISE EXCEPTION 'company_transfer_terms_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD."status"<>'submitted' THEN RAISE EXCEPTION 'company_transfer_decision_final'; END IF;
 IF NEW."status"='approved' THEN
  SELECT * INTO a FROM "ApprovalInstance" WHERE "id"=NEW."approvalInstanceId";
  IF a."businessType" IS DISTINCT FROM 'company_transfer' OR a."businessId" IS DISTINCT FROM NEW."id" OR a."status" IS DISTINCT FROM 'approved' OR NEW."approvedByUserId" IS NULL OR (NOT NEW."requiresParallelRepaymentApproval" AND NEW."approvedByUserId"=NEW."applicantUserId") OR NEW."approvedAt" IS NULL OR NOT EXISTS(SELECT 1 FROM "ApprovalActionLog" WHERE "approvalInstanceId"=a."id" AND "action"='approve' AND "actorUserId"=NEW."approvedByUserId" AND "approvedRoleKey" IN ('chairman','general_manager') AND "signatureVersionIdSnapshot" IS NOT NULL) THEN RAISE EXCEPTION 'company_transfer_leader_approval_required'; END IF;
 END IF; RETURN NEW;
END; $$;

CREATE FUNCTION public.guard_company_proxy_repayment_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approval public."ApprovalInstance"%ROWTYPE;
  duty RECORD;
  node JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."requiresParallelRepaymentApproval" IS DISTINCT FROM (
    NEW."kind" = 'repayment' AND NEW."sourceProjectId" IS NOT NULL
    AND NEW."sourceProjectId" IS NOT DISTINCT FROM NEW."destinationProjectId"
    AND (
      NEW."originalProxyId" IS NOT NULL OR NEW."originalInterEntityRelationshipId" IS NOT NULL
      OR NEW."originalOperationalPaymentId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM public."FundMovementRelationshipEntry" move
        WHERE move."id" = NEW."originalFundMovementRelationshipId" AND move."entryKind" = 'proxy_payment')
    )
  ) THEN
    RAISE EXCEPTION 'company_proxy_repayment_parallel_approval_required';
  END IF;
  IF NOT NEW."requiresParallelRepaymentApproval" THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."approvalInstanceId" IS DISTINCT FROM OLD."approvalInstanceId" THEN
    RAISE EXCEPTION 'company_proxy_repayment_approval_round_immutable';
  END IF;

  SELECT * INTO approval FROM public."ApprovalInstance" WHERE "id" = NEW."approvalInstanceId";
  IF approval."businessType" IS DISTINCT FROM 'company_transfer'
    OR approval."businessId" IS DISTINCT FROM NEW."id"
    OR approval."flowType" IS DISTINCT FROM 'company_transfer.approve'
    OR approval."applicantUserId" IS DISTINCT FROM NEW."applicantUserId"
    OR jsonb_typeof(approval."frozenNodes") IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'company_proxy_repayment_approval_round_required';
  END IF;
  IF jsonb_array_length(approval."frozenNodes") <> 4 THEN
    RAISE EXCEPTION 'company_proxy_repayment_four_duties_required';
  END IF;

  FOR duty IN SELECT * FROM (VALUES
    (0, ARRAY['comprehensive_director'], '{"comprehensive_director":"global"}'::jsonb),
    (1, ARRAY['project_manager'], '{"project_manager":"project"}'::jsonb),
    (2, ARRAY['finance_director'], '{"finance_director":"global"}'::jsonb),
    (3, ARRAY['chairman','general_manager'], '{"chairman":"global","general_manager":"global"}'::jsonb)
  ) AS duties(index, roles, scopes)
  LOOP
    node := approval."frozenNodes" -> duty.index;
    IF node -> 'protocolVersion' IS DISTINCT FROM '1'::jsonb
      OR node ->> 'executionMode' IS DISTINCT FROM 'parallel'
      OR node ->> 'mode' IS DISTINCT FROM 'any'
      OR node -> 'roleKeys' IS DISTINCT FROM to_jsonb(duty.roles)
      OR node -> 'roleScopesByRole' IS DISTINCT FROM duty.scopes
    THEN
      RAISE EXCEPTION 'company_proxy_repayment_duty_protocol_required';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW."status" <> 'submitted' OR node -> 'approvedRoleKeys' IS DISTINCT FROM '[]'::jsonb) THEN
      RAISE EXCEPTION 'company_proxy_repayment_initial_duties_must_be_pending';
    END IF;
    IF NEW."status" = 'approved' AND NOT EXISTS (
      SELECT 1 FROM public."ApprovalActionLog" signed
      WHERE signed."approvalInstanceId" = approval."id"
        AND signed."action" = 'approve'
        AND (
          signed."actorUserId" <> NEW."applicantUserId"
          OR (signed."metadata" -> 'selfReview' = 'true'::jsonb
            AND length(btrim(signed."metadata" ->> 'selfReviewReason')) > 0)
        )
        AND signed."approvedRoleKey" = ANY(duty.roles)
        AND signed."signatureVersionIdSnapshot" IS NOT NULL
        AND signed."metadata" -> 'nodeIndex' = to_jsonb(duty.index)
        AND node -> 'approvedRoleKeys' = jsonb_build_array(signed."approvedRoleKey")
        AND (duty.index <> 3 OR signed."actorUserId" = NEW."approvedByUserId")
    ) THEN
      RAISE EXCEPTION 'company_proxy_repayment_four_signed_duties_required';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;


-- 20261118211500_company_transfer_original_debt_corrections (functions)

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


-- 20261118212000 (canonical plan functions)

CREATE OR REPLACE FUNCTION public.jg_company_transfer_correction_family(original_source TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN split_part(original_source, ':', 1) IN ('proxy','inter_entity','operational')
    THEN 'project_proxy' ELSE split_part(original_source, ':', 1) END;
$$;

-- One relationship-only adjustment per already verified incoming event. The amount and
-- direction derive from the reviewed source, never from an HTTP posting payload.
CREATE FUNCTION public.jg_company_transfer_canonical_correction_plan(correction_id TEXT)
RETURNS TABLE (
  "sourceBusinessId" TEXT, "incomingEventId" TEXT, "anchorFactId" TEXT, "projectId" TEXT,
  "actorId" TEXT, "occurredAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
  "amountCents" BIGINT, "effectDirection" TEXT, "debtorId" TEXT, "creditorId" TEXT,
  "originalSource" TEXT, "targetOriginalSource" TEXT
)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT correction.id || ':' || incoming.id, incoming.id, anchor.id, transfer."sourceProjectId",
    correction."confirmedByUserId", incoming."occurredAt", correction."confirmedAt",
    incoming."amountCents", CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'increase' ELSE 'decrease' END,
    transfer."sourceCompanyId", transfer."destinationCompanyId", correction."originalSource", correction."targetOriginalSource"
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId" AND outgoing.kind = 'outgoing'
  JOIN public."CompanyTransfer" transfer ON transfer.id = outgoing."transferId" AND transfer.status = 'approved'
  JOIN public."CompanyTransferEvent" incoming ON incoming."outgoingEventId" = outgoing.id
    AND incoming."transferId" = transfer.id AND incoming.kind = 'incoming'
  JOIN public."CompanyTransferBankClaim" out_claim ON out_claim."eventId" = outgoing.id AND out_claim."observationId" = outgoing."observationId"
  JOIN public."CompanyTransferBankClaim" in_claim ON in_claim."eventId" = incoming.id AND in_claim."observationId" = incoming."observationId"
  JOIN public."OperatingFact" anchor ON anchor."projectId" = transfer."sourceProjectId" AND anchor.status = 'confirmed'
    AND anchor."entryKind" = 'original' AND anchor."numericProtocolVersion" = 1
    AND (
      (correction."originalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'company_transfer_event' AND anchor."sourceBusinessId" = incoming.id)
      OR (correction."targetOriginalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'contract_proxy_execution'
        AND anchor."sourceBusinessId" = split_part(correction."targetOriginalSource", ':', 2))
    )
  WHERE correction.id = correction_id AND correction.status = 'confirmed'
    AND transfer."sourceProjectId" = transfer."destinationProjectId"
    AND (correction."originalSource" LIKE 'proxy:%') <> (correction."targetOriginalSource" LIKE 'proxy:%')
    AND anchor."debtorSubjectKind" = 'participating_company' AND anchor."debtorSubjectId" = transfer."sourceCompanyId"
    AND anchor."actualPayerSubjectKind" = 'participating_company' AND anchor."actualPayerSubjectId" = transfer."destinationCompanyId"
    AND EXISTS (
      SELECT 1 FROM public."OperatingImpactEntry" effect
      WHERE effect."factId" = anchor.id AND effect."sourceImpactKey" = 'relationship'
        AND effect."impactKind" = CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN 'inter_subject_balance_decrease' ELSE 'inter_subject_balance_increase' END
        AND effect.direction = CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'decrease' ELSE 'increase' END
        AND effect."subjectRole" = 'actual_payer' AND effect."subjectKind" = 'participating_company'
        AND effect."subjectId" = transfer."destinationCompanyId"
        AND CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN effect."amountCents" = incoming."amountCents" ELSE effect."amountCents" >= incoming."amountCents" END
    );
$$;


-- 20261125000000 (updated routines)

-- The debt-limit routine keeps every former comparison for an ordinary A->B
-- repayment (debtor = source). For a third-party repayment, the same typed
-- original-debt checks run against the explicit debtor instead of the payer.
CREATE OR REPLACE FUNCTION public.company_transfer_debt_limit(t "CompanyTransfer", cutoff TIMESTAMP DEFAULT NULL) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE loan "CompanyTransfer"%ROWTYPE; proxy "ContractProxyExecution"%ROWTYPE; movement "FundMovementRelationshipEntry"%ROWTYPE; inter "InterEntityRelationshipEntry"%ROWTYPE; operational public."RegisteredOperationalPayment"%ROWTYPE; cap BIGINT; changes BIGINT; debtor TEXT;
BEGIN
 IF t."kind"<>'repayment' THEN RETURN NULL; END IF;
 debtor := t."repaymentDebtorCompanyId";
 IF debtor IS NULL THEN debtor := t."sourceCompanyId"; END IF;
 IF t."originalTransferId" IS NOT NULL THEN
  SELECT * INTO loan FROM "CompanyTransfer" WHERE "id"=t."originalTransferId" FOR UPDATE;
  IF loan."kind" IS DISTINCT FROM 'loan' OR loan."status" IS DISTINCT FROM 'approved' OR loan."sourceCompanyId"<>t."destinationCompanyId" OR loan."destinationCompanyId"<>debtor OR loan."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" OR loan."destinationProjectId" IS DISTINCT FROM t."sourceProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO cap FROM "CompanyTransferEvent" WHERE "transferId"=loan."id" AND "kind"='incoming' AND (cutoff IS NULL OR "occurredAt"<=cutoff);
 ELSIF t."originalProxyId" IS NOT NULL THEN
  SELECT * INTO proxy FROM "ContractProxyExecution" WHERE "id"=t."originalProxyId" FOR UPDATE;
  IF proxy."status" IS DISTINCT FROM 'confirmed' OR proxy."entryKind" IS DISTINCT FROM 'payment' OR proxy."frozenSource"#>>'{debtor,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{actualPayer,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM debtor OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" OR proxy."projectId" IS DISTINCT FROM t."sourceProjectId" OR proxy."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "ContractProxyExecution" WHERE "originalId"=proxy."id" AND "status" IN ('pending_confirm','confirmed') AND (cutoff IS NULL OR "occurredAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR proxy."occurredAt"<=cutoff THEN proxy."amountCents" ELSE 0 END-changes;
 ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
  SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE "id"=t."originalFundMovementRelationshipId" FOR UPDATE;
  IF movement."status" IS DISTINCT FROM 'confirmed' OR movement."direction" IS DISTINCT FROM 'increase' OR movement."adjustsEntryId" IS NOT NULL OR movement."debtorCompanyEntityId" IS DISTINCT FROM debtor OR movement."creditorCompanyEntityId" IS DISTINCT FROM t."destinationCompanyId" OR movement."beneficiaryProjectId" IS DISTINCT FROM t."sourceProjectId" OR movement."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=movement."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(movement."confirmedAt",movement."createdAt")<=cutoff THEN movement."amountCents" ELSE 0 END-changes;
 ELSIF t."originalOperationalPaymentId" IS NOT NULL THEN
  SELECT * INTO operational FROM public."RegisteredOperationalPayment" WHERE id = t."originalOperationalPaymentId" FOR UPDATE;
  IF operational.id IS NULL OR operational."originalDebtorCompanyId" IS DISTINCT FROM debtor
    OR operational."actualPayerCompanyId" IS DISTINCT FROM t."destinationCompanyId"
    OR operational."projectId" IS DISTINCT FROM t."sourceProjectId"
    OR operational."projectId" IS DISTINCT FROM t."destinationProjectId"
    OR operational."originalDebtorCompanyId" = operational."actualPayerCompanyId"
  THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  cap := CASE WHEN cutoff IS NULL OR operational."paidAt" <= cutoff THEN operational."amountCents" ELSE 0 END;
 ELSE
  SELECT * INTO inter FROM "InterEntityRelationshipEntry" WHERE "id"=t."originalInterEntityRelationshipId" FOR UPDATE;
  IF inter."status" IS DISTINCT FROM 'confirmed' OR inter."entryKind" IS DISTINCT FROM 'proxy_payment' OR inter."direction" IS DISTINCT FROM 'increase' OR inter."adjustsEntryId" IS NOT NULL OR inter."originalDebtorCompanyId" IS DISTINCT FROM debtor OR inter."creditorCompanyId" IS DISTINCT FROM t."destinationCompanyId" OR inter."projectId" IS NULL OR inter."projectId" IS DISTINCT FROM t."sourceProjectId" OR inter."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=inter."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(inter."confirmedAt",inter."createdAt")<=cutoff THEN inter."amountCents" ELSE 0 END-changes;
 END IF;
 RETURN cap;
END; $$;

-- A correction re-points the original debt settled by one already received
-- repayment. For a third-party repayment the relationship debtor is the
-- explicit repaymentDebtorCompanyId, not the paying company.
CREATE OR REPLACE FUNCTION public.jg_company_transfer_canonical_correction_plan(correction_id TEXT)
RETURNS TABLE (
  "sourceBusinessId" TEXT, "incomingEventId" TEXT, "anchorFactId" TEXT, "projectId" TEXT,
  "actorId" TEXT, "occurredAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
  "amountCents" BIGINT, "effectDirection" TEXT, "debtorId" TEXT, "creditorId" TEXT,
  "originalSource" TEXT, "targetOriginalSource" TEXT
)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT correction.id || ':' || incoming.id, incoming.id, anchor.id, transfer."sourceProjectId",
    correction."confirmedByUserId", incoming."occurredAt", correction."confirmedAt",
    incoming."amountCents", CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'increase' ELSE 'decrease' END,
    coalesce(transfer."repaymentDebtorCompanyId", transfer."sourceCompanyId"), transfer."destinationCompanyId",
    correction."originalSource", correction."targetOriginalSource"
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId" AND outgoing.kind = 'outgoing'
  JOIN public."CompanyTransfer" transfer ON transfer.id = outgoing."transferId" AND transfer.status = 'approved'
  JOIN public."CompanyTransferEvent" incoming ON incoming."outgoingEventId" = outgoing.id
    AND incoming."transferId" = transfer.id AND incoming.kind = 'incoming'
  JOIN public."CompanyTransferBankClaim" out_claim ON out_claim."eventId" = outgoing.id AND out_claim."observationId" = outgoing."observationId"
  JOIN public."CompanyTransferBankClaim" in_claim ON in_claim."eventId" = incoming.id AND in_claim."observationId" = incoming."observationId"
  JOIN public."OperatingFact" anchor ON anchor."projectId" = transfer."sourceProjectId" AND anchor.status = 'confirmed'
    AND anchor."entryKind" = 'original' AND anchor."numericProtocolVersion" = 1
    AND (
      (correction."originalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'company_transfer_event' AND anchor."sourceBusinessId" = incoming.id)
      OR (correction."targetOriginalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'contract_proxy_execution'
        AND anchor."sourceBusinessId" = split_part(correction."targetOriginalSource", ':', 2))
    )
  WHERE correction.id = correction_id AND correction.status = 'confirmed'
    AND transfer."sourceProjectId" = transfer."destinationProjectId"
    AND (correction."originalSource" LIKE 'proxy:%') <> (correction."targetOriginalSource" LIKE 'proxy:%')
    AND anchor."debtorSubjectKind" = 'participating_company'
    AND anchor."debtorSubjectId" = coalesce(transfer."repaymentDebtorCompanyId", transfer."sourceCompanyId")
    AND anchor."actualPayerSubjectKind" = 'participating_company' AND anchor."actualPayerSubjectId" = transfer."destinationCompanyId"
    AND EXISTS (
      SELECT 1 FROM public."OperatingImpactEntry" effect
      WHERE effect."factId" = anchor.id AND effect."sourceImpactKey" = 'relationship'
        AND effect."impactKind" = CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN 'inter_subject_balance_decrease' ELSE 'inter_subject_balance_increase' END
        AND effect.direction = CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'decrease' ELSE 'increase' END
        AND effect."subjectRole" = 'actual_payer' AND effect."subjectKind" = 'participating_company'
        AND effect."subjectId" = transfer."destinationCompanyId"
        AND CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN effect."amountCents" = incoming."amountCents" ELSE effect."amountCents" >= incoming."amountCents" END
    );
$$;


-- The write-context table is migration-only (not in schema.prisma); the event
-- guard only needs the row for the current backend pid/transaction.
CREATE TABLE IF NOT EXISTS public."OperatingLedgerWriteContext" (
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("backendPid", "transactionId")
);

-- Shape checks and triggers equivalent to the migration state used by the flow.
ALTER TABLE public."CompanyTransfer" ADD CONSTRAINT "CompanyTransfer_repayment_debtor_shape" CHECK (
  ("kind" = 'repayment' AND "repaymentDebtorCompanyId" IS NOT NULL AND "repaymentDebtorCompanyId" <> "destinationCompanyId")
  OR ("kind" <> 'repayment' AND "repaymentDebtorCompanyId" IS NULL)
);
CREATE TRIGGER "CompanyTransfer_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."CompanyTransfer" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer();
CREATE TRIGGER "CompanyTransfer_proxy_repayment_approval_guard" BEFORE INSERT OR UPDATE ON public."CompanyTransfer" FOR EACH ROW EXECUTE FUNCTION public.guard_company_proxy_repayment_approval();
CREATE TRIGGER "CompanyTransfer_original_capacity" BEFORE INSERT OR UPDATE ON public."CompanyTransfer" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_original_reservation();
CREATE TRIGGER "CompanyTransferEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."CompanyTransferEvent" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_event();
CREATE TRIGGER "CompanyTransfer_event_dated_repayment" BEFORE INSERT ON public."CompanyTransferEvent" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_dated_repayment();
CREATE TRIGGER "CompanyTransferBankClaim_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."CompanyTransferBankClaim" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_bank_claim();
CREATE CONSTRAINT TRIGGER "CompanyTransferEvent_claim_required" AFTER INSERT ON public."CompanyTransferEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_company_transfer_bank_claim();
CREATE TRIGGER "CompanyTransferOriginalDebtCorrection_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."CompanyTransferOriginalDebtCorrection" FOR EACH ROW EXECUTE FUNCTION public.guard_company_transfer_original_debt_correction();
COMMIT;