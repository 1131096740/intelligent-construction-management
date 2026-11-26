BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
LOCK TABLE public."OperatingFact" IN SHARE ROW EXCLUSIVE MODE;

DO $install$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  prior record;
  trigger_before jsonb;
  expected_after text;
  definition text;
  body_after text;
  anchor CONSTANT text := $old$  IF NEW."factKind" = 'expense' AND NEW."costBearingCompanySubjectKind" IS NULL THEN
    RAISE EXCEPTION '费用事实必须填写成本承担公司' USING ERRCODE = '23514';
  END IF;$old$;
  replacement CONSTANT text := $next$  IF NEW."factKind" = 'expense' AND NEW."costBearingCompanySubjectKind" IS NULL THEN
    -- The approved expense is already locked by the caller for a live approval.
    -- This read does not take a reverse lock after the existing project lock.
    IF NOT coalesce(
      NEW."sourceType" = 'expense_claim_approval' AND NEW."sourceVersion" = 1
      AND NEW."entryKind" = 'original' AND NEW."adjustsFactId" IS NULL
      AND NEW."historicalTakeoverBatchId" IS NULL AND NEW."numericProtocolVersion" = 1
      AND NEW."status" = 'confirmed' AND NEW."operatingLevel" = 'project'
      AND NEW."evidenceLevel" = 'A' AND NEW."direction" = 'outflow'
      AND NEW."idempotencyKey" = ('expense_claim_approval:' || NEW."sourceBusinessId")
      AND NEW."sourceSnapshot"->>'formalStatus' = 'confirmed'
      AND NEW."sourceSnapshot"->'costBearingCompanyEntityId' = 'null'::jsonb
      AND EXISTS (
        SELECT 1 FROM public."ExpenseClaim" expense
        JOIN public."ApprovalInstance" round ON round."id" = expense."approvalInstanceId"
          AND round."businessType" = 'expense_claim' AND round."businessId" = expense."id"
          AND round."flowType" = 'expense_claim.approve' AND round."status" = 'approved'
        JOIN public."ApprovalActionLog" action ON action."approvalInstanceId" = round."id"
          AND action."action" = 'approve' AND action."actorUserId" = NEW."confirmedByUserId"
          AND action."createdAt" = NEW."confirmedAt"
        WHERE expense."id" = NEW."sourceBusinessId" AND expense."code" = NEW."sourceBusinessCode"
          AND expense."projectId" = NEW."projectId" AND expense."approvedAt" = NEW."occurredAt"
          AND expense."requestedAmountCents" = NEW."amountCents"
          AND expense."claimType" = NEW."sourceSnapshot"->>'claimType'
          AND expense."claimType" IN ('reimbursement', 'incidental_expense')
          AND (expense."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
            OR (expense."claimType" = 'reimbursement' AND expense."status" = 'offset_completed'))
          AND expense."voidedAt" IS NULL AND expense."actualPurchaseBatchId" IS NULL
          AND expense."generalProcurementId" IS NULL
          AND expense."costBearingCompanySpecified" AND expense."costBearingCompanyEntityId" IS NULL
      ), false)
    THEN
      RAISE EXCEPTION '费用事实必须填写成本承担公司' USING ERRCODE = '23514';
    END IF;
  END IF;$next$;
BEGIN
  IF current_user <> session_user OR current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database() AND datdba = owner_oid)
  THEN
    RAISE EXCEPTION 'EXPENSE_PENDING_COST_BEARER_SCOPE' USING ERRCODE = '55000';
  END IF;

  SELECT p.oid, p.prosrc, to_jsonb(p) - 'prosrc' AS metadata, to_jsonb(t) AS wiring
  INTO STRICT prior
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang AND l.lanname = 'plpgsql'
  JOIN pg_trigger t ON t.tgfoid = p.oid AND t.tgrelid = 'public."OperatingFact"'::regclass
    AND t.tgname = 'OperatingFact_validate_references'
    AND t.tgtype = 7 AND t.tgenabled = 'O' AND NOT t.tgisinternal
    AND NOT (t.tgdeferrable OR t.tginitdeferred) AND t.tgconstraint = 0
    AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr::text = ''
  WHERE p.oid = 'public."validateOperatingFactReferences"()'::regprocedure
    AND p.proowner = owner_oid AND p.pronamespace = to_regnamespace('public')
    AND p.prokind = 'f' AND p.provolatile = 'v' AND p.proparallel = 'u'
    AND NOT (p.prosecdef OR p.proisstrict OR p.proretset)
    AND p.prorettype = 'pg_catalog.trigger'::regtype AND p.proconfig IS NULL;

  SELECT postimage INTO STRICT expected_after FROM (VALUES
    ('26a0fe0d77faa0cb21df9098d339f6350e45e9468504d1cc9d66afee4171a975', 'bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6'),
    ('a9f2052a70675effdd906929c1b3490c4f4f81867b65b29ea13c9e3a935f7434', '61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb'),
    ('a59d505c02c2e0ff453ed0ccf29b25909449aa9cf1149f4a414844abc0541e1b', 'f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987')
  ) AS bodies(preimage, postimage)
  WHERE preimage = encode(sha256(convert_to(prior.prosrc, 'UTF8')), 'hex');
  definition := pg_get_functiondef(prior.oid);
  IF cardinality(string_to_array(prior.prosrc, anchor)) <> 2
    OR cardinality(string_to_array(definition, prior.prosrc)) <> 2
  THEN
    RAISE EXCEPTION 'EXPENSE_PENDING_COST_BEARER_PREIMAGE' USING ERRCODE = '55000';
  END IF;
  body_after := replace(prior.prosrc, anchor, replacement);
  IF encode(sha256(convert_to(body_after, 'UTF8')), 'hex') <> expected_after THEN
    RAISE EXCEPTION 'EXPENSE_PENDING_COST_BEARER_POSTIMAGE' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition, prior.prosrc, body_after);

  SELECT to_jsonb(t) INTO STRICT trigger_before FROM pg_trigger t WHERE t.oid = (prior.wiring->>'oid')::oid;
  IF trigger_before IS DISTINCT FROM prior.wiring OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = prior.oid AND p.prosrc = body_after
      AND (to_jsonb(p) - 'prosrc') = prior.metadata
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PENDING_COST_BEARER_CATALOG' USING ERRCODE = '55000';
  END IF;
END;
$install$;

COMMIT;
