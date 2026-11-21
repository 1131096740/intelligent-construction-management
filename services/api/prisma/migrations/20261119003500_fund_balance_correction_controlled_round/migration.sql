BEGIN;

CREATE TABLE public.jg_fund_balance_correction_witness_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (octet_length("key") = 32)
);
REVOKE ALL ON TABLE public.jg_fund_balance_correction_witness_key FROM PUBLIC;

CREATE UNIQUE INDEX "AuditLog_fund_balance_correction_round_witness"
ON public."AuditLog" ("businessId")
WHERE "businessType" = 'fund_account_balance' AND action = 'fund_account.correction.request'
  AND metadata->>'roundCreationProtocol' = '1';

CREATE FUNCTION public.jg_fund_balance_correction_fields(fields text[])
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT string_agg(coalesce(encode(convert_to(value, 'UTF8'), 'hex'), '-'), ':' ORDER BY ordinal)
  FROM unnest(fields) WITH ORDINALITY AS parts(value, ordinal)
$$;
REVOKE ALL ON FUNCTION public.jg_fund_balance_correction_fields(text[]) FROM PUBLIC;

CREATE FUNCTION public.jg_create_fund_balance_correction_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  witness text := current_setting('jg.fund_balance_correction_witness', true);
  expiry text;
  now_seconds bigint;
  key_bytes bytea;
  request_marker jsonb;
  expected_proof text;
  recipient_id text;
  recipient_active boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'fund balance correction requires a Serializable transaction' USING ERRCODE = '42501';
  END IF;
  IF witness IS NULL OR witness !~ '^[0-9]{10}:[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'fund balance correction requires a signed request witness' USING ERRCODE = '42501';
  END IF;
  expiry := split_part(witness, ':', 1);
  now_seconds := floor(extract(epoch FROM clock_timestamp()))::bigint;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30 THEN
    RAISE EXCEPTION 'fund balance correction request witness expired' USING ERRCODE = '42501';
  END IF;
  SELECT "key" INTO key_bytes FROM public.jg_fund_balance_correction_witness_key WHERE singleton;
  SELECT audit.metadata INTO request_marker
  FROM public."AuditLog" audit
  WHERE audit."businessType" = 'fund_account_balance' AND audit.action = 'fund_account.correction.request'
    AND audit."businessId" = NEW.id AND audit."actorUserId" = NEW."createdByUserId"
    AND audit.metadata->>'roundCreationProtocol' = '1'
    AND audit.metadata->>'previousRegistrationId' = NEW."previousRegistrationId"
    AND audit.xmin = pg_current_xact_id()::xid;
  IF key_bytes IS NULL OR request_marker IS NULL
    OR NOT coalesce(request_marker->>'sourceCount' ~ '^(0|[1-9][0-9]{0,2})$', false)
    OR NOT coalesce(request_marker->>'sourceDigest' ~ '^[a-f0-9]{64}$', false)
  THEN
    RAISE EXCEPTION 'fund balance correction request witness unavailable' USING ERRCODE = '42501';
  END IF;
  IF (request_marker->>'sourceCount')::integer > 200 THEN
    RAISE EXCEPTION 'fund balance correction source count invalid' USING ERRCODE = '23514';
  END IF;
  expected_proof := encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
    'fund_balance_correction_round_v1', current_database()::text, session_user::text,
    pg_current_xact_id()::text, pg_backend_pid()::text, expiry,
    NEW."createdByUserId", NEW."accountId", NEW."previousRegistrationId", NEW.id, NEW.version::text,
    NEW."idempotencyKey", NEW."payloadFingerprint", NEW."balanceYuan"::text, NEW."asOfDate", NEW."evidenceReference",
    NEW."reconciliationNote", NEW.reason, array_to_string(NEW."coveredExecutionIds", ','),
    request_marker->>'sourceCount', request_marker->>'sourceDigest'
  ]), 'UTF8'), key_bytes, 'sha256'), 'hex');
  IF expected_proof IS DISTINCT FROM split_part(witness, ':', 2) THEN
    RAISE EXCEPTION 'fund balance correction request witness mismatch' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('jg.fund_balance_correction_witness', '', true);

  IF NOT EXISTS (
    SELECT 1
    FROM public."FundAccountBalanceRegistration" predecessor
    WHERE predecessor.id = NEW."previousRegistrationId"
      AND predecessor."accountId" = NEW."accountId"
      AND predecessor.status = 'confirmed'
      AND predecessor.version = (
        SELECT max(r.version) FROM public."FundAccountBalanceRegistration" r
        WHERE r."accountId" = NEW."accountId" AND r.status = 'confirmed'
      )
      AND predecessor."asOfDate" <= NEW."asOfDate"
  ) OR NEW.version IS DISTINCT FROM (
      SELECT max(r.version) + 1 FROM public."FundAccountBalanceRegistration" r
      WHERE r."accountId" = NEW."accountId"
  ) OR EXISTS (
      SELECT 1 FROM public."FundAccountBalanceRegistration" r
      WHERE r."accountId" = NEW."accountId" AND r.status = 'pending_review'
  ) OR NOT EXISTS (
    SELECT 1 FROM public."User" applicant
    JOIN public."UserPosition" assignment ON assignment."userId" = applicant.id AND assignment."projectId" IS NULL
    JOIN public."Position" duty ON duty.id = assignment."positionId"
    WHERE applicant.id = NEW."createdByUserId" AND applicant."isActive"
      AND duty.key IN ('finance_staff', 'finance_director')
  ) THEN
    RAISE EXCEPTION 'fund balance correction requires its current applicant and same-transaction request evidence'
      USING ERRCODE = '23514';
  END IF;

  NEW."approvalInstanceId" := gen_random_uuid()::text;
  INSERT INTO public."ApprovalInstance" (
    id, "flowType", "businessType", "businessId", status, "currentNodeIndex",
    "frozenNodes", "applicantUserId", "createdAt", "updatedAt"
  )
  VALUES (
    NEW."approvalInstanceId", 'fund_account_balance_correction', 'fund_account_balance_registration',
    NEW.id, 'approval_pending', 0,
    '[{"name":"财务主管余额核对复核","mode":"any","roleKeys":["finance_director"],"approvedRoleKeys":[],"protocolVersion":1,"executionMode":"parallel","roleScopesByRole":{"finance_director":"global"}}]'::jsonb,
    NEW."createdByUserId", statement_timestamp() AT TIME ZONE 'UTC', statement_timestamp() AT TIME ZONE 'UTC'
  );
  -- The round is newly created and cannot have a legitimate delegation before
  -- commit. Preserve the original per-recipient lock order and reject an
  -- orphan carrying its exact fresh scope instead of widening the lock set.
  FOR recipient_id IN
    SELECT DISTINCT assignment."userId"
    FROM public."UserPosition" assignment
    JOIN public."Position" duty ON duty.id = assignment."positionId"
    WHERE assignment."projectId" IS NULL AND duty.key = 'finance_director'
    ORDER BY assignment."userId"
  LOOP
    SELECT recipient."isActive" INTO recipient_active
    FROM public."User" recipient WHERE recipient.id = recipient_id FOR SHARE OF recipient;
    PERFORM assignment."userId"
    FROM public."UserPosition" assignment
    JOIN public."Position" duty ON duty.id = assignment."positionId"
    WHERE assignment."userId" = recipient_id AND assignment."projectId" IS NULL
    FOR SHARE OF assignment, duty;
    IF coalesce(recipient_active, false) THEN
      PERFORM delegation.id
      FROM public."ApprovalDelegation" delegation
      WHERE delegation."toUserId" = recipient_id
        AND delegation."actionKey" = 'fund_account.balance.review'
        AND delegation."resourceType" = 'fund_account_balance_review_duty'
        AND delegation."resourceId" = NEW."approvalInstanceId" || ':0'
      FOR SHARE OF delegation;
      IF FOUND THEN
        RAISE EXCEPTION 'fund balance correction fresh round has a preexisting delegation' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('jg.fund_balance_correction_recipient_locks', encode(public.hmac(
    convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'fund_balance_correction_recipient_locks_v1', current_database()::text, session_user::text,
      pg_current_xact_id()::text, pg_backend_pid()::text, NEW.id, NEW."approvalInstanceId"
    ]), 'UTF8'), key_bytes, 'sha256'), 'hex'), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jg_create_fund_balance_correction_round() FROM PUBLIC;

CREATE TRIGGER "FundBalanceCorrection_create_round"
BEFORE INSERT ON public."FundAccountBalanceRegistration" FOR EACH ROW
WHEN (NEW.kind = 'correction' AND NEW.status = 'pending_review' AND NEW."approvalInstanceId" IS NULL)
EXECUTE FUNCTION public.jg_create_fund_balance_correction_round();

CREATE FUNCTION public.jg_validate_fund_balance_correction_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'FundAccountSourceBatch' THEN
    IF EXISTS (
      SELECT 1 FROM public."AuditLog" audit
      WHERE audit."businessType" = 'fund_account_balance' AND audit.action = 'fund_account.correction.request'
        AND audit."businessId" = NEW."registrationId" AND audit.metadata->>'roundCreationProtocol' = '1'
        AND audit.xmin = pg_current_xact_id()::xid
        AND NEW."lineNo" > (audit.metadata->>'sourceCount')::integer
    ) THEN
      RAISE EXCEPTION 'fund balance correction source set is already fixed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.xmin = pg_current_xact_id()::xid AND EXISTS (
      SELECT 1 FROM public."AuditLog" audit
      WHERE audit."businessType" = 'fund_account_balance' AND audit.action = 'fund_account.correction.request'
        AND audit."businessId" = OLD."businessId" AND audit."actorUserId" = OLD."applicantUserId"
        AND audit.metadata->>'roundCreationProtocol' = '1' AND audit.xmin = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'new fund balance correction review must remain pending until commit'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."FundAccountBalanceRegistration" registration
    JOIN public."ApprovalInstance" round ON round.id = registration."approvalInstanceId"
    JOIN public."AuditLog" audit ON audit."businessId" = registration.id AND audit."actorUserId" = registration."createdByUserId"
    WHERE registration.id = NEW."businessId" AND registration."approvalInstanceId" = NEW.id
      AND registration.kind = 'correction' AND registration.status = 'pending_review'
      AND registration."createdByUserId" = NEW."applicantUserId" AND registration.xmin = pg_current_xact_id()::xid
      AND round.status = NEW.status AND round."currentNodeIndex" = NEW."currentNodeIndex"
      AND round."frozenNodes" = NEW."frozenNodes"
      AND audit."businessType" = 'fund_account_balance' AND audit.action = 'fund_account.correction.request'
      AND audit.metadata->>'roundCreationProtocol' = '1' AND audit.xmin = pg_current_xact_id()::xid
      AND (SELECT count(*) FROM public."FundAccountSourceBatch" source WHERE source."registrationId" = registration.id)
        = (audit.metadata->>'sourceCount')::integer
      AND (SELECT encode(sha256(convert_to(coalesce(string_agg(
        public.jg_fund_balance_correction_fields(ARRAY[
          source."lineNo"::text, source."amountYuan"::text, source."sourceStatus", source."sourceName",
          source."projectStatus", source."projectId", source."previousSourceBatchId"
        ]), '|' ORDER BY source."lineNo"), ''), 'UTF8')), 'hex')
          FROM public."FundAccountSourceBatch" source WHERE source."registrationId" = registration.id)
        = audit.metadata->>'sourceDigest'
  ) OR EXISTS (
    SELECT DISTINCT recipient.id
    FROM public."User" recipient
    JOIN public."UserPosition" assignment ON assignment."userId" = recipient.id AND assignment."projectId" IS NULL
    JOIN public."Position" duty ON duty.id = assignment."positionId"
    WHERE recipient."isActive" AND duty.key = 'finance_director'
      AND NOT EXISTS (
        SELECT 1 FROM public."AuditLog" intent
        WHERE intent."businessType" = 'fund_balance_review_duty_notification'
          AND intent.action = 'queued' AND intent."businessId" = NEW."businessId"
          AND intent."actorUserId" = NEW."applicantUserId" AND intent.xmin = pg_current_xact_id()::xid
          AND intent.id = encode(sha256(convert_to(
            '["fund_balance_review_duty_notification",' || to_json(NEW.id)::text || ',' || to_json(recipient.id)::text || ']',
            'UTF8'
          )), 'hex')
          AND intent.metadata = jsonb_build_object('recipientId', recipient.id, 'roundId', NEW.id)
      )
  ) THEN
    RAISE EXCEPTION 'fund balance correction requires its same-transaction registration, audit and current review intents'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.jg_validate_fund_balance_correction_round() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "FundBalanceCorrection_round_complete"
AFTER INSERT ON public."ApprovalInstance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW."businessType" = 'fund_account_balance_registration'
  AND NEW."flowType" = 'fund_account_balance_correction' AND pg_trigger_depth() > 0)
EXECUTE FUNCTION public.jg_validate_fund_balance_correction_round();

CREATE TRIGGER "FundBalanceCorrection_round_creation_immutable"
BEFORE UPDATE ON public."ApprovalInstance" FOR EACH ROW
WHEN (OLD."businessType" = 'fund_account_balance_registration' AND OLD."flowType" = 'fund_account_balance_correction')
EXECUTE FUNCTION public.jg_validate_fund_balance_correction_round();

CREATE TRIGGER "FundBalanceCorrection_source_bound"
BEFORE INSERT ON public."FundAccountSourceBatch" FOR EACH ROW
EXECUTE FUNCTION public.jg_validate_fund_balance_correction_round();

COMMIT;
