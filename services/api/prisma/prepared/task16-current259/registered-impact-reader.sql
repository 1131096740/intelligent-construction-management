-- Prospective B7 owner-transaction member. Source only, outside the seven-fragment installer.
DO $preflight$
DECLARE
  runtime_oid pg_catalog.oid := pg_catalog.to_regrole('jg_task01_runtime');
  observer_oid pg_catalog.oid := pg_catalog.to_regrole('jg_task01_observer');
BEGIN
  IF current_user <> 'jg_task01_owner' OR session_user <> 'jg_task01_owner'
    OR runtime_oid IS NULL OR observer_oid IS NULL OR runtime_oid = observer_oid
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = runtime_oid OR member = runtime_oid
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid = runtime_oid AND rolcanlogin
        AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    )
    OR pg_catalog.to_regprocedure('public.jg_read_registered_payment_impacts(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'registered payment impact reader installation is not qualified' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.jg_read_registered_payment_impacts(
  p_request_key pg_catalog.text,
  p_execution_id pg_catalog.text,
  p_payment_id pg_catalog.text,
  p_project_id pg_catalog.text,
  p_fact_id pg_catalog.text
) RETURNS TABLE (
  "factId" pg_catalog.text,
  "impactKind" pg_catalog.text,
  "amountCents" pg_catalog.int8,
  "numericProtocolVersion" pg_catalog.int4,
  "subjectKind" pg_catalog.text,
  "subjectId" pg_catalog.text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $reader$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."PaymentExecution" execution
    JOIN public."PaymentRequest" request ON request."id" = execution."paymentRequestId"
    JOIN public."Contract" contract ON contract."id" = request."contractId" AND contract."projectId" = request."projectId"
    JOIN public."ContractVersion" version ON version."id" = request."contractVersionId" AND version."contractId" = contract."id"
    JOIN public."OperatingFact" fact ON fact."id" = p_fact_id
      AND fact."projectId" = request."projectId" AND fact."sourceType" = 'payment_execution'
      AND fact."sourceBusinessId" = execution."id"
      AND (fact."paymentExecutionId" IS NULL OR fact."paymentExecutionId" = execution."id")
    WHERE execution."idempotencyKey" = p_request_key AND execution."id" = p_execution_id
      AND request."id" = p_payment_id AND request."projectId" = p_project_id
      AND request."paymentSubjectType" = 'our_company'
      AND request."sourceType" IN ('settlement', 'contract_due', 'contract_advance')
      AND version."signingSubjectType" = 'our_company'
      AND (execution."voucherFileId" IS NOT NULL OR EXISTS (
        SELECT 1 FROM public."RegisteredPaymentFunding" funding WHERE funding."executionId" = execution."id"
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public."PaymentExecution" sibling
        WHERE sibling."paymentRequestId" = request."id" AND (
          EXISTS (
            SELECT 1 FROM public."PaymentExecutionWagePayableBinding" wage
            WHERE wage."paymentExecutionId" = sibling."id"
          ) OR EXISTS (
            SELECT 1 FROM public."HistoricalWageSummaryPaymentExecutionLink" wage
            WHERE wage."paymentExecutionId" = sibling."id"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'registered payment impact source is not available' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT impact."factId", impact."impactKind", impact."amountCents",
      impact."numericProtocolVersion", impact."subjectKind", impact."subjectId"
    FROM public."OperatingImpactEntry" impact
    WHERE impact."factId" = p_fact_id AND impact."projectId" = p_project_id
      AND impact."sourceType" = 'payment_execution' AND impact."sourceBusinessId" = p_execution_id
      AND (impact."paymentExecutionId" IS NULL OR impact."paymentExecutionId" = p_execution_id)
    ORDER BY impact."id";
END;
$reader$;

REVOKE ALL ON FUNCTION public.jg_read_registered_payment_impacts(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text) FROM PUBLIC, jg_task01_observer;
GRANT EXECUTE ON FUNCTION public.jg_read_registered_payment_impacts(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text) TO jg_task01_runtime;

DO $witness$
DECLARE
  owner_oid pg_catalog.oid := pg_catalog.to_regrole('jg_task01_owner');
  runtime_oid pg_catalog.oid := pg_catalog.to_regrole('jg_task01_runtime');
  observer_oid pg_catalog.oid := pg_catalog.to_regrole('jg_task01_observer');
  reader_oid pg_catalog.oid := pg_catalog.to_regprocedure('public.jg_read_registered_payment_impacts(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text)');
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc JOIN pg_catalog.pg_language lang ON lang.oid = proc.prolang
    WHERE proc.oid = reader_oid AND proc.proowner = owner_oid AND proc.prokind = 'f'
      AND lang.lanname = 'plpgsql' AND proc.prosecdef AND proc.provolatile = 's'
      AND proc.proparallel = 'u' AND NOT proc.proleakproof AND NOT proc.proisstrict
      AND proc.proretset AND proc.prorettype = 'pg_catalog.record'::pg_catalog.regtype
      AND proc.pronargs = 5 AND proc.pronargdefaults = 0
      AND proc.proconfig = ARRAY['search_path=pg_catalog']
      AND proc.proargnames = ARRAY['p_request_key','p_execution_id','p_payment_id','p_project_id','p_fact_id',
        'factId','impactKind','amountCents','numericProtocolVersion','subjectKind','subjectId']
      AND proc.proargmodes = ARRAY['i','i','i','i','i','t','t','t','t','t','t']::pg_catalog."char"[]
      AND proc.proallargtypes = ARRAY[
        'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid, 'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid,
        'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid, 'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid,
        'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid, 'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid,
        'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid, 'pg_catalog.int8'::pg_catalog.regtype::pg_catalog.oid,
        'pg_catalog.int4'::pg_catalog.regtype::pg_catalog.oid, 'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid,
        'pg_catalog.text'::pg_catalog.regtype::pg_catalog.oid
      ]
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(proc.prosrc, 'UTF8')), 'hex') = 'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20'
  ) OR NOT pg_catalog.has_function_privilege(runtime_oid, reader_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(runtime_oid, reader_oid, 'EXECUTE WITH GRANT OPTION')
    OR pg_catalog.has_function_privilege(observer_oid, reader_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc proc CROSS JOIN LATERAL
        pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) acl
      WHERE proc.oid = reader_oid AND (
        acl.grantor <> owner_oid OR acl.grantee NOT IN (owner_oid, runtime_oid)
        OR acl.privilege_type <> 'EXECUTE' OR (acl.grantee = runtime_oid AND acl.is_grantable)
      )
    )
  THEN
    RAISE EXCEPTION 'registered payment impact reader installation proof is not available' USING ERRCODE = '42501';
  END IF;
END;
$witness$;
