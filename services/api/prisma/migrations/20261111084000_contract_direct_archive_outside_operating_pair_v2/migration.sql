-- Private paired append. This migration neither installs the authority nor opens its caller ACL.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_append_direct_outside_operating_pair_v2(p_archive_id TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $append$
DECLARE
  plan JSONB;
  actor TEXT;
  fact_row public."OperatingFact"%ROWTYPE;
  impact_row public."OperatingImpactEntry"%ROWTYPE;
  audit_row public."AuditLog"%ROWTYPE;
  context_pid INTEGER:=pg_catalog.pg_backend_pid();
  context_xid BIGINT:=pg_catalog.txid_current();
  previous_actor TEXT:=pg_catalog.current_setting('app.operating_ledger_actor',true);
  anchor OID:=current_user::regrole::oid;
BEGIN
  IF current_user IS NOT DISTINCT FROM session_user
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR pg_catalog.pg_my_temp_schema()<>0
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public'
      AND n.nspowner IN (anchor,pg_catalog.to_regrole('pg_database_owner')::oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper
      AND r.oid NOT IN (anchor,pg_catalog.to_regrole('pg_database_owner')::oid)
      AND pg_catalog.has_schema_privilege(r.oid,pg_catalog.to_regnamespace('public'),'CREATE'))
    OR 3<>(SELECT count(*) FROM (VALUES
      ('OperatingFact_reversal_impact_set','public."OperatingFact"','public."validateOperatingReversalImpactSet"()','df10051649fa500e6533095842a2408544bc2e488ca4193e8f7885b2f03709ca'),
      ('OperatingFact_v7_contract_guard','public."OperatingFact"','public.guard_fund_execution_contract_deferred()','72c83522a71c11929fc1ad95738d3b1620ec674fff597a020f92d40ad7b78415'),
      ('OperatingImpactEntry_v7_contract_guard','public."OperatingImpactEntry"','public.guard_fund_execution_contract_deferred()','72c83522a71c11929fc1ad95738d3b1620ec674fff597a020f92d40ad7b78415')
    ) x(constraint_name,relation_name,routine_name,body_sha)
      JOIN pg_catalog.pg_constraint c ON c.conname=x.constraint_name AND c.connamespace=pg_catalog.to_regnamespace('public')
        AND c.conrelid=pg_catalog.to_regclass(x.relation_name) AND c.contype='t' AND c.condeferrable AND c.condeferred
      JOIN pg_catalog.pg_trigger t ON t.tgconstraint=c.oid AND t.tgrelid=c.conrelid AND t.tgname=c.conname
        AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
      JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid AND f.oid=pg_catalog.to_regprocedure(x.routine_name)
        AND f.proowner=anchor AND f.pronamespace=c.connamespace AND NOT f.prosecdef
        AND encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex')=x.body_sha
      WHERE 1=(SELECT count(*) FROM pg_catalog.pg_constraint other
        WHERE other.conname=c.conname AND other.connamespace=c.connamespace))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=pg_catalog.to_regprocedure('public.jg_prepare_direct_outside_operating_commit_v2(text)')
        AND p.proowner=anchor AND p.pronamespace=pg_catalog.to_regnamespace('public')
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict
        AND NOT (p.prosecdef OR p.proretset OR p.proleakproof) AND p.pronargdefaults=0 AND p.prosupport=0
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='d877743c1603b0db3abf1923d239d6736f419cb59977da1ab40f28a43d9120d4'
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签承诺写入缺少准确同事务资格' USING ERRCODE='55000';
  END IF;

  -- Only archive id crosses the function boundary. Derive all columns again
  -- from the immutable claim and the archive/version produced by this xid.
  plan:=public.jg_prepare_direct_outside_operating_commit_v2(p_archive_id);
  actor:=plan->>'actorUserId';
  fact_row:=pg_catalog.jsonb_populate_record(NULL::public."OperatingFact",plan->'fact');
  impact_row:=pg_catalog.jsonb_populate_record(NULL::public."OperatingImpactEntry",plan->'impact');
  audit_row:=pg_catalog.jsonb_populate_record(NULL::public."AuditLog",plan->'audit');
  IF plan->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR nullif(btrim(actor),'') IS NULL
    OR fact_row."id" IS NULL OR impact_row."id" IS NULL OR audit_row."id" IS NULL
    OR fact_row."confirmedByUserId" IS DISTINCT FROM actor OR audit_row."actorUserId" IS DISTINCT FROM actor
    OR impact_row."factId" IS DISTINCT FROM fact_row."id" OR impact_row."projectId" IS DISTINCT FROM fact_row."projectId"
    OR audit_row."businessId" IS DISTINCT FROM fact_row."sourceBusinessId" OR audit_row."action" IS DISTINCT FROM 'contract.archive.complete'
    OR audit_row."metadata"->>'archiveId' IS DISTINCT FROM p_archive_id
    OR NOT EXISTS(SELECT 1 FROM public."Project" p WHERE p."id"=fact_row."projectId"
      AND p."constructionEnterpriseLockedAt" IS NOT NULL) THEN
    RAISE EXCEPTION '表外直签承诺参数与本次归档不一致' USING ERRCODE='23514';
  END IF;

  INSERT INTO public."OperatingLedgerWriteContext"("backendPid","transactionId","actorUserId")
    VALUES (context_pid,context_xid,actor);
  PERFORM pg_catalog.set_config('app.operating_ledger_actor',actor,true);
  INSERT INTO public."OperatingFact"(
    "id","projectId","sourceType","sourceBusinessId","sourceVersion","sourceBusinessCode","occurredAt","confirmedAt",
    "affiliateAssignmentId","affiliateBusinessPartyVersionId","affiliateNameSnapshot","affiliateCreditCodeSnapshot",
    "operatingLedgerEffectiveDateSnapshot","isBeforeOperatingLedgerEffectiveDate","factKind","operatingLevel","evidenceLevel",
    "amountCents","amountYuan","numericProtocolVersion","currencyCode","direction","debtorSubjectKind","debtorSubjectId",
    "creditorSubjectKind","creditorSubjectId","subjectSnapshot","sourceSnapshot","basisSnapshot","entryKind","idempotencyKey",
    "recordedByUserId","confirmedByUserId","status")
  VALUES (fact_row."id",fact_row."projectId",fact_row."sourceType",fact_row."sourceBusinessId",fact_row."sourceVersion",
    fact_row."sourceBusinessCode",fact_row."occurredAt",fact_row."confirmedAt",fact_row."affiliateAssignmentId",
    fact_row."affiliateBusinessPartyVersionId",fact_row."affiliateNameSnapshot",fact_row."affiliateCreditCodeSnapshot",
    fact_row."operatingLedgerEffectiveDateSnapshot",fact_row."isBeforeOperatingLedgerEffectiveDate",fact_row."factKind",
    fact_row."operatingLevel",fact_row."evidenceLevel",fact_row."amountCents",fact_row."amountYuan",fact_row."numericProtocolVersion",
    fact_row."currencyCode",fact_row."direction",fact_row."debtorSubjectKind",fact_row."debtorSubjectId",fact_row."creditorSubjectKind",
    fact_row."creditorSubjectId",fact_row."subjectSnapshot",fact_row."sourceSnapshot",fact_row."basisSnapshot",fact_row."entryKind",
    fact_row."idempotencyKey",actor,fact_row."confirmedByUserId",fact_row."status");
  INSERT INTO public."OperatingImpactEntry"("id","factId","projectId","sourceType","sourceBusinessId","sourceImpactKey",
    "idempotencyKey","impactKind","amountCents","amountYuan","numericProtocolVersion","direction","subjectRole","subjectKind",
    "subjectId","description","impactSnapshot")
  VALUES (impact_row."id",impact_row."factId",impact_row."projectId",impact_row."sourceType",impact_row."sourceBusinessId",
    impact_row."sourceImpactKey",impact_row."idempotencyKey",impact_row."impactKind",impact_row."amountCents",impact_row."amountYuan",
    impact_row."numericProtocolVersion",impact_row."direction",impact_row."subjectRole",impact_row."subjectKind",impact_row."subjectId",
    impact_row."description",impact_row."impactSnapshot");
  INSERT INTO public."AuditLog"("id","actorUserId","action","businessType","businessId","metadata")
    VALUES (audit_row."id",audit_row."actorUserId",audit_row."action",audit_row."businessType",audit_row."businessId",audit_row."metadata");
  SET CONSTRAINTS public."OperatingFact_reversal_impact_set", public."OperatingFact_v7_contract_guard",
    public."OperatingImpactEntry_v7_contract_guard" IMMEDIATE;
  DELETE FROM public."OperatingLedgerWriteContext"
    WHERE "backendPid"=context_pid AND "transactionId"=context_xid AND "actorUserId"=actor;
  IF NOT FOUND THEN RAISE EXCEPTION '表外直签经营账写入上下文已变化' USING ERRCODE='55000'; END IF;
  PERFORM pg_catalog.set_config('app.operating_ledger_actor',COALESCE(previous_actor,''),true);
  RETURN jsonb_build_object('protocolVersion',2,'factId',fact_row."id",'impactId',impact_row."id",'auditId',audit_row."id");
END;
$append$;
REVOKE ALL ON FUNCTION public.jg_append_direct_outside_operating_pair_v2(TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_install_direct_outside_operating_pair_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  anchor OID:=current_user::regrole::oid;
  old_plan RECORD;
  plan_oid OID:='public.jg_prepare_direct_outside_operating_commit_v2(text)'::regprocedure;
  before_role CONSTANT TEXT:=$oldrole$AND u."runtimeSessionOid"=session_user::regrole::oid AND u."executorOwnerOid"=current_user::regrole::oid$oldrole$;
  after_role CONSTANT TEXT:=$newrole$AND u."runtimeSessionOid"=session_user::regrole::oid
    AND pg_catalog.current_setting('session_replication_role')='origin'$newrole$;
  before_binding CONSTANT TEXT:=$oldbinding$AND receipt."bindingSha256"=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)$oldbinding$;
  after_binding CONSTANT TEXT:=$newbinding$AND (CASE WHEN current_user::regrole::oid=u."executorOwnerOid" THEN
      receipt."bindingSha256"=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    ELSE EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database() AND d.datdba=b."anchorOwnerOid"
      JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1 AND n."intentBindingSha256"=receipt."bindingSha256"
      JOIN pg_catalog.pg_roles runtime ON runtime.oid=b."runtimeSessionOid" AND runtime.rolcanlogin
        AND NOT (runtime.rolsuper OR runtime.rolcreaterole OR runtime.rolcreatedb OR runtime.rolreplication OR runtime.rolbypassrls)
      JOIN pg_catalog.pg_roles executor ON executor.oid=b."executorOwnerOid" AND NOT executor.rolcanlogin
        AND NOT (executor.rolsuper OR executor.rolcreaterole OR executor.rolcreatedb OR executor.rolreplication OR executor.rolbypassrls)
      WHERE b."protocolVersion"=1 AND b."databaseOid"=u."databaseOid" AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
        AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=u."runtimeSessionOid"
        AND b."executorOwnerOid"=u."executorOwnerOid" AND b."anchorOwnerOid"<>ALL(ARRAY[b."runtimeSessionOid",b."executorOwnerOid"])
        AND receipt."bindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')) END)$newbinding$;
  before_code CONSTANT TEXT:=$oldcode$c."code" AS contract_code$oldcode$;
  after_code CONSTANT TEXT:=$newcode$COALESCE(c."code",c."temporaryCode",c."name") AS contract_code$newcode$;
  next_plan TEXT;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl IS TRUE)
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database() AND d.datdba=anchor
      WHERE b."protocolVersion"=1 AND b."anchorOwnerOid"=anchor AND b."namespaceOid"=pg_catalog.to_regnamespace('public')) THEN
    RAISE EXCEPTION '表外直签承诺例程须由本库绑定 TLS 安装者核对' USING ERRCODE='55000';
  END IF;
  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT old_plan FROM pg_catalog.pg_proc p
    WHERE p.oid=plan_oid AND p.proowner=anchor AND p.pronamespace=pg_catalog.to_regnamespace('public')
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='257724b87fbee386a585c0c97d67e6b343243cb7da1d538a170b42d0cbe64c5a'
      AND cardinality(string_to_array(p.prosrc,before_role))=2 AND cardinality(string_to_array(p.prosrc,before_binding))=2
      AND cardinality(string_to_array(p.prosrc,before_code))=2
      AND cardinality(string_to_array(pg_catalog.pg_get_functiondef(plan_oid),p.prosrc))=2;
  next_plan:=replace(replace(replace(old_plan.prosrc,before_role,after_role),before_binding,after_binding),before_code,after_code);
  IF encode(public.digest(convert_to(next_plan,'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'd877743c1603b0db3abf1923d239d6736f419cb59977da1ab40f28a43d9120d4' THEN
    RAISE EXCEPTION '表外直签承诺例程后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(plan_oid),old_plan.prosrc,next_plan);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=plan_oid AND p.prosrc=next_plan
      AND to_jsonb(p)-'prosrc'=old_plan.metadata) THEN
    RAISE EXCEPTION '表外直签承诺例程元数据已变化' USING ERRCODE='55000';
  END IF;
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_operating_pair_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
    WHERE p.oid IN ('public.jg_append_direct_outside_operating_pair_v2(text)'::regprocedure,
      'public.jg_install_direct_outside_operating_pair_v2()'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签承诺配对写入默认必须私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
