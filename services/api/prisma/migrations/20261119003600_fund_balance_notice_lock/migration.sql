BEGIN;

CREATE TABLE public.jg_fund_balance_notice_witness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (octet_length("key") = 32),
  "databaseOid" oid NOT NULL,
  "interactiveRoleOid" oid NOT NULL,
  "workerRoleOid" oid NOT NULL,
  CHECK ("interactiveRoleOid" <> "workerRoleOid")
);
REVOKE ALL ON TABLE public.jg_fund_balance_notice_witness FROM PUBLIC;

CREATE FUNCTION public.jg_lock_fund_balance_notice_v1(
  operation text, stage text, registration_id text, round_id text,
  attempt_id text, recipient_id text, subject_id text, expiry text, proof text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  binding public.jg_fund_balance_notice_witness%ROWTYPE;
  expected_proof text;
  lock_result text;
  purpose text;
  role_oid oid;
  database_oid oid;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  duty_id text := round_id || ':0';
BEGIN
  IF operation IS NULL OR operation NOT IN ('status', 'retry', 'dispatch')
    OR stage IS NULL OR stage NOT IN ('round', 'user', 'positions', 'delegations')
    OR nullif(registration_id, '') IS NULL OR nullif(round_id, '') IS NULL
    OR nullif(recipient_id, '') IS NULL OR nullif(subject_id, '') IS NULL
    OR NOT coalesce(attempt_id ~ '^[a-f0-9]{64}$', false)
    OR NOT coalesce(expiry ~ '^[0-9]{10}$', false)
    OR NOT coalesce(proof ~ '^[a-f0-9]{64}$', false)
  THEN
    RAISE EXCEPTION 'invalid fund balance notice lock proof' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO binding FROM public.jg_fund_balance_notice_witness WHERE singleton;
  SELECT oid INTO database_oid FROM pg_database WHERE datname = current_database();
  SELECT oid INTO role_oid FROM pg_roles WHERE rolname = session_user;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30
    OR binding."databaseOid" IS DISTINCT FROM database_oid
    OR role_oid IS DISTINCT FROM (CASE WHEN operation = 'dispatch' THEN binding."workerRoleOid" ELSE binding."interactiveRoleOid" END)
    OR session_user = current_user
    OR EXISTS (SELECT 1 FROM public.jg_fund_balance_correction_witness_key WHERE "key" = binding."key")
  THEN
    RAISE EXCEPTION 'fund balance notice lock scope not qualified' USING ERRCODE = '42501';
  END IF;
  purpose := CASE WHEN operation = 'dispatch' THEN 'fund_balance_notice_worker_v1'
    ELSE 'fund_balance_notice_interaction_v1' END;
  expected_proof := encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
    purpose, current_database()::text, session_user::text, pg_current_xact_id()::text, pg_backend_pid()::text,
    expiry, operation, stage, registration_id, round_id, attempt_id, recipient_id, subject_id
  ]), 'UTF8'), binding."key", 'sha256'), 'hex');
  IF expected_proof IS DISTINCT FROM proof THEN
    RAISE EXCEPTION 'fund balance notice lock proof mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."AuditLog" intent
    WHERE intent.id = attempt_id AND intent."businessId" = registration_id
      AND intent."businessType" = 'fund_balance_review_duty_notification' AND intent.action = 'queued'
      AND intent.metadata->>'roundId' = round_id AND intent.metadata->>'recipientId' = recipient_id
  ) THEN
    RETURN false;
  END IF;

  IF stage = 'round' THEN
    IF subject_id <> recipient_id THEN
      RETURN false;
    END IF;
    PERFORM a.id FROM public."ApprovalInstance" a
    JOIN public."FundAccountBalanceRegistration" r ON r."approvalInstanceId" = a.id
    WHERE a.id = round_id AND a."businessId" = registration_id
      AND a."businessType" = 'fund_account_balance_registration'
      AND a."flowType" = 'fund_account_balance_correction'
      AND r.id = registration_id AND r.kind = 'correction'
    FOR UPDATE OF a;
    lock_result := CASE WHEN FOUND THEN 'locked' ELSE 'missing' END;
    PERFORM set_config('jg.fund_balance_notice_round_lock', lock_result || ':' ||
      encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
        'fund_balance_notice_round_lock_v1', current_database()::text, session_user::text,
        pg_current_xact_id()::text, pg_backend_pid()::text, operation,
        registration_id, round_id, attempt_id, recipient_id, lock_result
      ]), 'UTF8'), binding."key", 'sha256'), 'hex'), true);
    RETURN lock_result = 'locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."FundAccountBalanceRegistration" r
    WHERE r.id = registration_id AND r.kind = 'correction' AND r.status = 'pending_review'
      AND r."approvalInstanceId" = round_id
  ) THEN
    RETURN false;
  END IF;

  IF subject_id <> recipient_id AND (
    stage = 'delegations' OR NOT EXISTS (
      SELECT 1 FROM public."ApprovalDelegation" d
      WHERE d."fromUserId" = subject_id AND d."toUserId" = recipient_id
        AND d."actionKey" = 'fund_account.balance.review'
        AND d."resourceType" = 'fund_account_balance_review_duty'
        AND d."resourceId" = duty_id
    )
  ) THEN
    RETURN false;
  END IF;

  CASE stage
    WHEN 'user' THEN
      PERFORM u.id FROM public."User" u WHERE u.id = subject_id FOR SHARE;
    WHEN 'positions' THEN
      PERFORM up."userId" FROM public."UserPosition" up
      JOIN public."Position" p ON p.id = up."positionId"
      WHERE up."userId" = subject_id AND up."projectId" IS NULL FOR SHARE OF up, p;
    WHEN 'delegations' THEN
      PERFORM d.id FROM public."ApprovalDelegation" d
      WHERE d."toUserId" = recipient_id AND d."actionKey" = 'fund_account.balance.review'
        AND d."resourceType" = 'fund_account_balance_review_duty' AND d."resourceId" = duty_id FOR SHARE;
  END CASE;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_lock_fund_balance_notice_v1(text,text,text,text,text,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.jg_guard_fund_balance_notice_dispatch_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  binding public.jg_fund_balance_notice_witness%ROWTYPE;
  role_oid oid;
  expected_role_oid oid;
  queued public."AuditLog"%ROWTYPE;
  prior_id text;
  round_id text;
  recipient_id text;
  purpose text;
  witness text;
  expiry text;
  expected_proof text;
  expected_id text;
  lock_witness text;
  lock_result text;
  kind constant text := 'fund_balance_review_duty_notification';
  is_notice boolean := coalesce(NEW."businessType" = 'fund_balance_review_duty_notification', false);
  is_dispatch boolean := is_notice
    AND NEW.action IN ('dispatch_claimed', 'accepted', 'failed', 'unknown', 'cancelled');
  is_retry boolean := is_notice AND NEW.action = 'queued' AND coalesce(NEW.metadata ? 'retryOf', false);
BEGIN
  SELECT w.* INTO binding
  FROM public.jg_fund_balance_notice_witness w
  JOIN pg_database d ON d.oid = w."databaseOid" AND d.datname = current_database()
  WHERE w.singleton;
  SELECT oid INTO role_oid FROM pg_roles WHERE rolname = session_user;

  IF NOT is_dispatch AND NOT is_retry AND role_oid IS DISTINCT FROM binding."workerRoleOid" THEN
    RETURN NEW;
  END IF;
  expected_role_oid := CASE WHEN is_dispatch THEN binding."workerRoleOid"
    WHEN is_retry THEN binding."interactiveRoleOid" END;
  IF expected_role_oid IS NULL OR role_oid IS DISTINCT FROM expected_role_oid
    OR session_user = current_user THEN
    RAISE EXCEPTION 'fund balance notice audit requires the bound role' USING ERRCODE = '42501';
  END IF;
  witness := current_setting('jg.fund_balance_notice_audit', true);
  IF NOT coalesce(witness ~ '^[0-9]{10}:[a-f0-9]{64}$', false)
    OR EXISTS (SELECT 1 FROM public.jg_fund_balance_correction_witness_key WHERE "key" = binding."key")
  THEN
    RAISE EXCEPTION 'fund balance notice audit proof unavailable' USING ERRCODE = '42501';
  END IF;
  expiry := split_part(witness, ':', 1);
  IF expiry::bigint NOT BETWEEN floor(extract(epoch FROM clock_timestamp()))::bigint
    AND floor(extract(epoch FROM clock_timestamp()))::bigint + 30
  THEN
    RAISE EXCEPTION 'fund balance notice audit proof expired' USING ERRCODE = '42501';
  END IF;

  prior_id := NEW.metadata->>(CASE WHEN is_retry THEN 'retryOf' ELSE 'intentId' END);
  IF NOT coalesce(prior_id ~ '^[a-f0-9]{64}$', false) THEN
    RAISE EXCEPTION 'fund balance notice audit attempt invalid' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO queued FROM public."AuditLog" audit
    WHERE audit.id = prior_id AND audit."businessType" = kind AND audit.action = 'queued'
      AND audit."businessId" = NEW."businessId";
  round_id := queued.metadata->>'roundId';
  recipient_id := queued.metadata->>'recipientId';
  IF round_id IS NULL OR recipient_id IS NULL THEN
    RAISE EXCEPTION 'fund balance notice audit scope invalid' USING ERRCODE = '42501';
  END IF;

  purpose := CASE WHEN is_retry THEN 'fund_balance_notice_audit_interaction_v1'
    ELSE 'fund_balance_notice_audit_worker_v1' END;
  expected_proof := encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
    purpose, current_database()::text, session_user::text, pg_current_xact_id()::text, pg_backend_pid()::text,
    expiry, NEW.action, NEW.id, NEW."businessId", round_id, prior_id, recipient_id
  ]), 'UTF8'), binding."key", 'sha256'), 'hex');
  expected_id := encode(public.digest(convert_to(
    '["' || kind || '","' || prior_id || '","'
    || (CASE WHEN is_retry THEN 'retry' WHEN NEW.action = 'dispatch_claimed' THEN 'claim' ELSE 'terminal' END)
    || '"]', 'UTF8'), 'sha256'), 'hex');
  IF expected_proof IS DISTINCT FROM split_part(witness, ':', 2) OR NEW.id IS DISTINCT FROM expected_id
    OR NEW."actorUserId" IS DISTINCT FROM (CASE WHEN is_retry THEN recipient_id ELSE queued."actorUserId" END)
    OR NEW.metadata IS DISTINCT FROM (CASE WHEN is_retry THEN queued.metadata || jsonb_build_object('retryOf', prior_id)
      ELSE jsonb_build_object('intentId', prior_id) END)
  THEN
    RAISE EXCEPTION 'fund balance notice audit proof mismatch' USING ERRCODE = '42501';
  END IF;

  IF is_retry OR NEW.action IN ('dispatch_claimed', 'cancelled') THEN
    lock_witness := current_setting('jg.fund_balance_notice_round_lock', true);
    lock_result := split_part(coalesce(lock_witness, ''), ':', 1);
    IF (lock_result <> 'locked' AND NOT (NEW.action = 'cancelled' AND lock_result = 'missing'))
      OR split_part(coalesce(lock_witness, ''), ':', 2) IS DISTINCT FROM
        encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
          'fund_balance_notice_round_lock_v1', current_database()::text, session_user::text,
          pg_current_xact_id()::text, pg_backend_pid()::text, CASE WHEN is_retry THEN 'retry' ELSE 'dispatch' END,
          NEW."businessId", round_id, prior_id, recipient_id, lock_result
        ]), 'UTF8'), binding."key", 'sha256'), 'hex')
    THEN
      RAISE EXCEPTION 'fund balance notice audit requires the signed round lock' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('jg.fund_balance_notice_round_lock', '', true);
  END IF;

  IF is_retry AND NOT EXISTS (
    SELECT 1 FROM public."AuditLog" outcome
    WHERE outcome.id = encode(public.digest(convert_to(
        '["' || kind || '","' || prior_id || '","terminal"]', 'UTF8'), 'sha256'), 'hex')
      AND outcome."businessType" = kind AND outcome."businessId" = queued."businessId"
      AND outcome.action = 'failed' AND outcome.metadata = jsonb_build_object('intentId', prior_id)
  ) THEN
    RAISE EXCEPTION 'fund balance notice retry requires the failed terminal' USING ERRCODE = '42501';
  END IF;
  IF NEW.action IN ('accepted', 'failed', 'unknown') AND NOT EXISTS (
    SELECT 1 FROM public."AuditLog" claim
    WHERE claim.id = encode(public.digest(convert_to(
        '["' || kind || '","' || prior_id || '","claim"]', 'UTF8'), 'sha256'), 'hex')
      AND claim."businessType" = kind AND claim."businessId" = queued."businessId"
      AND claim.action = 'dispatch_claimed' AND claim.metadata = jsonb_build_object('intentId', prior_id)
      AND claim.xmin <> pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'fund balance notice result requires the committed claim' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('jg.fund_balance_notice_audit', '', true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_fund_balance_notice_dispatch_v1() FROM PUBLIC;

CREATE TRIGGER "AuditLog_fund_balance_notice_dispatch_worker"
BEFORE INSERT ON public."AuditLog"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_fund_balance_notice_dispatch_v1();

COMMIT;
