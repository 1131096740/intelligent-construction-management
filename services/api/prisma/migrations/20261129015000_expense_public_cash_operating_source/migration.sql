BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
LOCK TABLE public."OperatingFact", public."OperatingImpactEntry" IN SHARE ROW EXCLUSIVE MODE;

-- A cash payer on a formal expense disbursement is justified by the
-- immutable original execution and its registered cash-account debit.
CREATE FUNCTION public.jg_validate_expense_public_cash_fact_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $expense_cash$
DECLARE source record;
BEGIN
  SELECT execution.id, execution."paidAt", execution."createdAt", execution."recordedByUserId",
    execution."amountCents", execution."voucherFileId", claim.id AS claim_id, claim.code,
    claim."claimType", payment.id AS payment_id, payment."originalDebtorCompanyId",
    claim."projectId"
  INTO source
  FROM public."ExpenseClaimPaymentExecution" execution
  JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
  JOIN public."RegisteredOperationalPayment" payment ON payment."expenseExecutionId" = execution.id
  JOIN public."RegisteredFundAccount" account ON account.id = payment."accountId"
  WHERE execution.id = NEW."sourceBusinessId"
    AND claim."claimType" IN ('reimbursement', 'incidental_expense')
    AND payment."projectId" = claim."projectId"
    AND payment."originalDebtorCompanyId" = claim."companyEntityId"
    AND payment."actorUserId" = execution."recordedByUserId"
    AND payment."amountCents" = execution."amountCents" AND payment."paidAt" = execution."paidAt"
    AND payment."actualPayerCompanyId" IS NULL AND payment."actualPayerName" = '公共现金'
    AND account.kind = 'public_cash' AND account."scopeKey" = 'public_cash'
    AND account."companyEntityId" IS NULL;
  IF NOT FOUND THEN
    IF NEW."actualPayerSubjectKind" = 'public_cash' THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_FACT_SOURCE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT coalesce(
    NEW."sourceVersion" = 1 AND NEW."entryKind" = 'original' AND NEW."adjustsFactId" IS NULL
    AND NEW."status" = 'confirmed' AND NEW."numericProtocolVersion" = 1
    AND NEW."factKind" = 'downstream_payment' AND NEW."operatingLevel" = 'project'
    AND NEW."evidenceLevel" = 'A' AND NEW."currencyCode" = 'CNY' AND NEW."direction" = 'outflow'
    AND NEW."actualPayerSubjectKind" = 'public_cash' AND NEW."actualPayerSubjectId" = 'public_cash'
    AND NEW."debtorSubjectKind" IS NULL AND NEW."creditorSubjectKind" IS NULL
    AND NEW."approvedPayerSubjectKind" IS NULL AND NEW."costBearingCompanySubjectKind" IS NULL
    AND NEW."payeeSubjectKind" = CASE source."claimType" WHEN 'reimbursement' THEN 'employee' ELSE 'downstream_counterparty' END
    AND NEW."projectId" = source."projectId" AND NEW."amountCents" = source."amountCents"
    AND NEW."occurredAt" = source."paidAt" AND NEW."confirmedAt" = source."createdAt"
    AND NEW."confirmedByUserId" = source."recordedByUserId"
    AND NEW."sourceBusinessCode" = source.code || '/实付/' || source.id
    AND NEW."idempotencyKey" = 'expense_claim_payment_execution:' || source.id
    AND NEW."basisSnapshot"->>'authority' = 'expense_claim_payment_execution'
    AND NEW."basisSnapshot"->>'voucherFileId' = source."voucherFileId"
    AND NEW."sourceSnapshot"->>'formalStatus' = 'confirmed'
    AND NEW."sourceSnapshot"->>'expenseClaimId' = source.claim_id
    AND NEW."sourceSnapshot"->>'claimType' = source."claimType"
    AND NEW."sourceSnapshot"->>'amountCents' = source."amountCents"::text
    AND NEW."sourceSnapshot"->>'recordedByUserId' = source."recordedByUserId"
    AND NEW."sourceSnapshot"->'registeredFunding' = jsonb_build_object(
      'id', source.payment_id, 'actualPayerCompanyId', NULL::text, 'actualPayerName', '公共现金',
      'originalDebtorCompanyId', source."originalDebtorCompanyId"
    ), false
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_FACT_SOURCE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$expense_cash$;
REVOKE ALL ON FUNCTION public.jg_validate_expense_public_cash_fact_v1() FROM PUBLIC;
CREATE TRIGGER "OperatingFact_expense_public_cash_source"
  BEFORE INSERT ON public."OperatingFact" FOR EACH ROW
  WHEN (NEW."sourceType" = 'expense_claim_payment_execution')
  EXECUTE FUNCTION public.jg_validate_expense_public_cash_fact_v1();

CREATE FUNCTION public.jg_validate_expense_public_cash_impact_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $expense_cash$
DECLARE source record;
BEGIN
  SELECT fact."sourceSnapshot"->>'expenseClaimId' AS claim_id, fact."amountCents",
    fact."payeeSubjectKind", fact."payeeSubjectId"
  INTO source
  FROM public."OperatingFact" fact
  WHERE fact.id = NEW."factId" AND fact."projectId" = NEW."projectId"
    AND fact."sourceType" = NEW."sourceType" AND fact."sourceBusinessId" = NEW."sourceBusinessId"
    AND fact."actualPayerSubjectKind" = 'public_cash' AND fact."actualPayerSubjectId" = 'public_cash';
  IF NOT FOUND THEN
    IF NEW."subjectKind" = 'public_cash' OR NEW."impactKind" = 'public_cash_funds_decrease' THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_IMPACT_SOURCE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT coalesce(
    NEW."numericProtocolVersion" = 1 AND NEW."amountCents" = source."amountCents"
    AND NEW.direction = 'decrease'
    AND (
      (NEW."impactKind" = 'public_cash_funds_decrease' AND NEW."subjectRole" = 'actual_payer'
        AND NEW."subjectKind" = 'public_cash' AND NEW."subjectId" = 'public_cash'
        AND NEW."sourceImpactKey" = 'public_cash_funds_decrease'
        AND NEW."idempotencyKey" = 'expense_claim_payment_execution:' || NEW."sourceBusinessId" || ':funds')
      OR
      (NEW."impactKind" = 'payable_decrease' AND NEW."subjectRole" = 'payee'
        AND NEW."subjectKind" = source."payeeSubjectKind" AND NEW."subjectId" = source."payeeSubjectId"
        AND NEW."sourceImpactKey" = 'payable:' || source.claim_id
        AND NEW."idempotencyKey" = 'expense_claim_payment_execution:' || NEW."sourceBusinessId" || ':payable')
    ), false
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_IMPACT_SOURCE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$expense_cash$;
REVOKE ALL ON FUNCTION public.jg_validate_expense_public_cash_impact_v1() FROM PUBLIC;
CREATE TRIGGER "OperatingImpactEntry_expense_public_cash_source"
  BEFORE INSERT ON public."OperatingImpactEntry" FOR EACH ROW
  WHEN (NEW."sourceType" = 'expense_claim_payment_execution')
  EXECUTE FUNCTION public.jg_validate_expense_public_cash_impact_v1();

DO $install$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  fact_before text;
  impact_before text;
  registered_fact oid := to_regprocedure('public.jg_registered_payment_fact_guard()');
  registered_impact oid := to_regprocedure('public.jg_registered_payment_cash_impact_guard()');
  prepared boolean;
  trigger_before jsonb;
  target record;
  current_body text;
  current_metadata jsonb;
  definition text;
  next_body text;
  constraint_expression text;
  constraint_valid boolean;
  fact_subject CONSTANT text := '"actualPayerSubjectKind" = ANY';
  scoped_fact_subject CONSTANT text := '(CASE WHEN "sourceType" = ''expense_claim_payment_execution''
      AND "actualPayerSubjectKind" = ''public_cash'' AND "actualPayerSubjectId" = ''public_cash''
      THEN NULL ELSE "actualPayerSubjectKind" END) = ANY';
  scoped_impact CONSTANT text := '"sourceType" = ''expense_claim_payment_execution''
    AND "numericProtocolVersion" = 1 AND "subjectKind" = ''public_cash''
    AND "subjectId" = ''public_cash'' AND "subjectRole" = ''actual_payer''
    AND "impactKind" = ''public_cash_funds_decrease'' AND direction = ''decrease''';
  fact_old CONSTANT text := $fact_old$candidate_subject->>'kind' NOT IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee')$fact_old$;
  fact_new CONSTANT text := $fact_new$candidate_subject->>'kind' NOT IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee')
      AND NOT (NEW."sourceType" = 'expense_claim_payment_execution' AND candidate_subject->>'role' = 'actualPayer'
        AND candidate_subject->>'kind' = 'public_cash' AND candidate_subject->>'id' = 'public_cash')$fact_new$;
  impact_old CONSTANT text := $impact_old$NEW."subjectKind" NOT IN (
       'owner', 'construction_enterprise', 'participating_company',
       'downstream_counterparty', 'employee'
     )$impact_old$;
  impact_new CONSTANT text := $impact_new$NEW."subjectKind" NOT IN (
       'owner', 'construction_enterprise', 'participating_company',
       'downstream_counterparty', 'employee'
     )
     AND NOT (NEW."sourceType" = 'expense_claim_payment_execution' AND NEW."subjectKind" = 'public_cash'
       AND NEW."subjectId" = 'public_cash' AND NEW."subjectRole" = 'actual_payer'
       AND NEW."impactKind" = 'public_cash_funds_decrease')$impact_new$;
  adapter_fact_old CONSTANT text := $adapter_fact_old$IF f."executionId" IS NOT NULL OR NEW."actualPayerSubjectKind" = 'public_cash' THEN$adapter_fact_old$;
  adapter_fact_new CONSTANT text := $adapter_fact_new$IF f."executionId" IS NOT NULL OR
    (NEW."actualPayerSubjectKind" = 'public_cash' AND NEW."sourceType" <> 'expense_claim_payment_execution') THEN$adapter_fact_new$;
  adapter_impact_old CONSTANT text := $adapter_impact_old$IF NEW."subjectKind" = 'public_cash' OR NEW."impactKind" = 'public_cash_funds_decrease' THEN$adapter_impact_old$;
  adapter_impact_new CONSTANT text := $adapter_impact_new$IF (NEW."subjectKind" = 'public_cash' OR NEW."impactKind" = 'public_cash_funds_decrease')
    AND NEW."sourceType" <> 'expense_claim_payment_execution' THEN$adapter_impact_new$;
BEGIN
  IF current_user <> session_user OR current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database() AND datdba = owner_oid) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_INSTALL_SCOPE' USING ERRCODE = '55000';
  END IF;

  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT fact_before
  FROM pg_proc WHERE oid = 'public."validateOperatingFactReferences"()'::regprocedure AND proowner = owner_oid;
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT impact_before
  FROM pg_proc WHERE oid = 'public."validateOperatingImpactEntryReferences"()'::regprocedure AND proowner = owner_oid;

  prepared := registered_fact IS NOT NULL AND registered_impact IS NOT NULL;
  IF prepared THEN
    -- The independent Task16 installation already defines the two cash kinds.
    -- Its legacy payment proof retains all of its logic and its exact trigger.
    IF fact_before <> 'f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987'
      OR impact_before <> '78d1efbfb923ee5417b580e51e87dee29d33277fe510136c7f562e61007ae1da' THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_ADAPTER_PREIMAGE' USING ERRCODE = '55000';
    END IF;
  ELSIF registered_fact IS NOT NULL OR registered_impact IS NOT NULL THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_PARTIAL_ADAPTER' USING ERRCODE = '55000';
  ELSIF (fact_before, impact_before) NOT IN (
    ('bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6',
     'd6666bbad410b5f1cacc8e40fe29dbaea990e2e101f9857cb14585d6a6a9d92b'),
    ('61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb',
     'e6d843c9d702ce00f88e79b1e7f83eac977df271c3962bb949b9299d78d9de3c')
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_PREIMAGE' USING ERRCODE = '55000';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      (false, 'public."validateOperatingFactReferences"()', 'public."OperatingFact"', 'OperatingFact_validate_references', 7,
        fact_before, CASE fact_before
          WHEN 'bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6' THEN '1235c355fa2777269b1920f9922401a357a725039f14e3321e00b5a3d338c973'
          WHEN '61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb' THEN '92f6f3e2e3e0f58bca1d00b5c631c0dd652b5552992dda991da3564429dc4644' END,
        fact_old, fact_new),
      (false, 'public."validateOperatingImpactEntryReferences"()', 'public."OperatingImpactEntry"', 'OperatingImpactEntry_validate_references', 7,
        impact_before, CASE impact_before
          WHEN 'd6666bbad410b5f1cacc8e40fe29dbaea990e2e101f9857cb14585d6a6a9d92b' THEN 'f9cc8b1db6c0fe72b0ee7d38e2193fb2a446e88f6da133e726b47424663f4250'
          WHEN 'e6d843c9d702ce00f88e79b1e7f83eac977df271c3962bb949b9299d78d9de3c' THEN '2db9ce648393690e5b1cf1e008b1a2df86b776d47240bca28fd04fe50f93ccc7' END,
        impact_old, impact_new),
      (true, 'public.jg_registered_payment_fact_guard()', 'public."OperatingFact"', 'OperatingFact_registered_payment', 7,
        '54abb9bca45f8cbf2ed3dd27abb0d86725e9bba7b863282e266dfa60377a837c',
        '9e7cf612da3cabbbe979b8a52813d766488b01aaa289da68272f612511167cd4', adapter_fact_old, adapter_fact_new),
      (true, 'public.jg_registered_payment_cash_impact_guard()', 'public."OperatingImpactEntry"', 'OperatingImpactEntry_registered_cash', 7,
        'e8f260b939348210d529402bf7d0f30ff3d71f369a7cc7b4ae1169d8664e6751',
        'e59887d92a12c53d6af6e7116edc61be6ced6ac9ced8624512c3c337af30c5b4', adapter_impact_old, adapter_impact_new)
    ) recipe(adapter, routine, relation, hook, trigger_type, previous_sha, next_sha, previous_clause, next_clause)
    WHERE adapter = prepared
  LOOP
    SELECT p.prosrc, to_jsonb(p)-'prosrc', pg_get_functiondef(p.oid), to_jsonb(t)
      INTO STRICT current_body, current_metadata, definition, trigger_before
    FROM pg_proc p JOIN pg_trigger t ON t.tgfoid = p.oid
    WHERE p.oid = to_regprocedure(target.routine) AND p.proowner = owner_oid
      AND p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.provolatile = 'v'
      AND p.proparallel = 'u' AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND NOT (p.prosecdef OR p.proisstrict OR p.proretset OR p.proleakproof)
      AND (CASE WHEN prepared THEN p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
                ELSE p.proconfig IS NULL END)
      AND t.tgrelid = to_regclass(target.relation) AND t.tgname = target.hook
      AND t.tgtype = target.trigger_type AND t.tgenabled = 'O' AND NOT t.tgisinternal
      AND t.tgqual IS NULL AND t.tgconstraint = 0 AND t.tgnargs = 0 AND t.tgattr::text = '';
    IF target.next_sha IS NULL OR encode(sha256(convert_to(current_body,'UTF8')),'hex') <> target.previous_sha
      OR cardinality(string_to_array(current_body,target.previous_clause)) <> 2
      OR cardinality(string_to_array(definition,current_body)) <> 2 THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_PREIMAGE' USING ERRCODE = '55000';
    END IF;
    next_body := replace(current_body,target.previous_clause,target.next_clause);
    IF encode(sha256(convert_to(next_body,'UTF8')),'hex') <> target.next_sha THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_POSTIMAGE' USING ERRCODE = '55000';
    END IF;
    EXECUTE replace(definition,current_body,next_body);
    IF NOT EXISTS (
      SELECT FROM pg_proc p JOIN pg_trigger t ON t.tgfoid = p.oid
      WHERE p.oid = to_regprocedure(target.routine)
        AND t.tgrelid = to_regclass(target.relation) AND t.tgname = target.hook
        AND (to_jsonb(p)-'prosrc') = current_metadata AND to_jsonb(t) = trigger_before
        AND p.prosrc = next_body
    ) THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_METADATA' USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF prepared THEN RETURN; END IF;
  FOR target IN SELECT * FROM (VALUES
    ('OperatingFact', 'OperatingFact_subject_kind_check'),
    ('OperatingFact', 'OperatingFact_supported_subject_check'),
    ('OperatingImpactEntry', 'OperatingImpactEntry_subject_check'),
    ('OperatingImpactEntry', 'OperatingImpactEntry_supported_subject_check'),
    ('OperatingImpactEntry', 'OperatingImpactEntry_impact_kind_check')
  ) recipe(relation, constraint_name)
  LOOP
    SELECT pg_get_expr(k.conbin,k.conrelid), k.convalidated INTO STRICT constraint_expression, constraint_valid
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = target.relation
      AND c.relowner = owner_oid AND k.conname = target.constraint_name AND k.contype = 'c';
    IF strpos(constraint_expression, '''public_cash''') <> 0 THEN
      RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_CONSTRAINT_PREIMAGE' USING ERRCODE = '55000';
    END IF;
    IF target.relation = 'OperatingFact' THEN
      IF cardinality(string_to_array(constraint_expression,fact_subject)) <> 2 THEN
        RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_LEDGER_CONSTRAINT_PREIMAGE' USING ERRCODE = '55000';
      END IF;
      constraint_expression := replace(constraint_expression,fact_subject,scoped_fact_subject);
    ELSE
      constraint_expression := '(' || constraint_expression || ') OR (' || scoped_impact || ')';
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (%s)%s',
      target.relation, target.constraint_name, target.constraint_name, constraint_expression,
      CASE WHEN constraint_valid THEN '' ELSE ' NOT VALID' END);
  END LOOP;
END;
$install$;

COMMIT;
