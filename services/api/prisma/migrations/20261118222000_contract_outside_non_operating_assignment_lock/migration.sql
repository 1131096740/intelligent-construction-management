BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

-- The original archive transaction already holds C/V/P. The existing
-- caller cannot independently lock assignments or write the sticky marker.
CREATE FUNCTION public.jg_lock_direct_outside_non_operating_assignment_v1(p_version text) RETURNS void
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $lock$
DECLARE
  target record;
  assignment record;
BEGIN
  SELECT p."id" AS project_id, v."affiliateAssignmentId" AS assignment_id,
    v."affiliateBusinessPartyVersionId" AS assignment_version_id, v."effectiveAt"::date AS fact_day
    INTO STRICT target
  FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN pg_roles executor ON executor.oid=b."executorOwnerOid" AND NOT (
    executor.rolcanlogin OR executor.rolinherit OR executor.rolsuper OR executor.rolcreaterole
      OR executor.rolcreatedb OR executor.rolreplication OR executor.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership WHERE executor.oid IN(membership.member,membership.roleid))
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_intent_use_v1 u ON u."databaseOid"=b."databaseOid"
    AND u."runtimeSessionOid"=b."runtimeSessionOid" AND u."executorOwnerOid"=executor.oid
    AND u."backendPid"=pg_backend_pid() AND u."transactionId"=txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
  JOIN public.jg_contract_direct_archive_intent_v1 intent ON intent."intentId"=u."intentId"
    AND intent."bindingSha256"=n."intentBindingSha256" AND intent.xmin<>u.xmin
    AND u."usedAt">=intent."issuedAt" AND u."usedAt"<intent."expiresAt"
  JOIN public."ContractVersion" v ON v."id"=p_version AND v.xmin=u.xmin
    AND v."status"='effective' AND v."numericProtocolVersion"=2 AND v."versionNo"=1
    AND v."changeType"='original' AND v."signingSubjectType"='affiliate'
    AND v."firstSubmittedAt" IS NULL AND v."taxFactsFrozenAt"=v."effectiveAt"
    AND v."companyEntityIdSnapshot" IS NULL AND v."companyEntityVersionId" IS NULL
    AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
    AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
  JOIN public."Contract" c ON c."id"=v."contractId" AND c."voidedAt" IS NULL AND c."companyEntityId" IS NULL
  JOIN public."Project" p ON p."id"=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."ContractArchiveFile" a ON a."contractVersionId"=v."id" AND a.xmin=u.xmin
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed' AND a."status"='confirmed'
    AND a."sourceRevision"=v."draftRevision" AND a."confirmedAt"=v."effectiveAt"
    AND a."uploadedByUserId"=c."ownerUserId" AND a."confirmedByUserId"=c."ownerUserId"
    AND a."requestSha256"=a."authoritySnapshot"->>'requestSha256'
    AND a."authoritySha256"=encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='not_applicable'
    AND a."authoritySnapshot"->>'contractVersionId'=v."id"
    AND a."authoritySnapshot"->>'contractId'=c."id"
    AND a."authoritySnapshot"->>'projectId'=p."id"
    AND a."authoritySnapshot"#>>'{sourceBasis,directInput,Q,subjects,enterprise,assignmentId}'=v."affiliateAssignmentId"
    AND a."authoritySnapshot"#>>'{sourceBasis,directInput,Q,subjects,enterprise,businessPartyVersionId}'=v."affiliateBusinessPartyVersionId"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid
    AND current_setting('session_replication_role')='origin'
  FOR UPDATE OF p;

  SELECT a."id",a."businessPartyVersionId" INTO STRICT assignment
    FROM public."ProjectAffiliateAssignment" a
    WHERE a."projectId"=target.project_id AND a."effectiveFrom"<=target.fact_day AND a."endedAt" IS NULL
    FOR KEY SHARE;
  IF assignment."id" IS DISTINCT FROM target.assignment_id
    OR assignment."businessPartyVersionId" IS DISTINCT FROM target.assignment_version_id THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_ASSIGNMENT_CHANGED' USING ERRCODE='23514';
  END IF;

  UPDATE public."Project" p SET "constructionEnterpriseLockedAt"=COALESCE(p."constructionEnterpriseLockedAt",transaction_timestamp())
    WHERE p."id"=target.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_PROJECT_LOCK' USING ERRCODE='23514'; END IF;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_ARCHIVE_WITNESS' USING ERRCODE='55000';
END;
$lock$;

REVOKE ALL ON FUNCTION public.jg_lock_direct_outside_non_operating_assignment_v1(text) FROM PUBLIC;

CREATE FUNCTION public.jg_activate_outside_non_operating_assignment_lock_v1() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $activate$
DECLARE
  owner_oid oid:=current_user::regrole::oid;
  lock_oid oid:='public.jg_lock_direct_outside_non_operating_assignment_v1(text)'::regprocedure;
  guard_oid oid:='public."lockProjectConstructionEnterpriseFromFormalFact"()'::regprocedure;
  outside_binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  executor_name name;
  prior record;
  trigger_before jsonb;
  source_sha text;
  next_source text;
  anchor constant text:=$anchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$anchor$;
  branch constant text:=$branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='draft' AND NEW."status"='effective'
      AND OLD."draftData"#>>'{directSigningInput,source}'='direct_signed'
      AND OLD."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,'public.jg_lock_direct_outside_non_operating_assignment_v1(text)','EXECUTE') THEN
      IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" direct_archive WHERE direct_archive."contractVersionId"=NEW."id"
        AND direct_archive."archiveProtocolVersion"=2 AND direct_archive."archiveSource"='direct_signed'
        AND direct_archive."authoritySnapshot"#>>'{operatingConsequence,mode}'='not_applicable') THEN
        PERFORM public.jg_lock_direct_outside_non_operating_assignment_v1(NEW."id");
        RETURN NEW;
      END IF;
    END IF;
  END IF;
$branch$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=owner_oid) THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_LOCK_OWNER' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,
    public."ContractVersion" IN SHARE ROW EXCLUSIVE MODE;
  SELECT b.* INTO STRICT outside_binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
    JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
      AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
    WHERE b."protocolVersion"=1 AND b."anchorOwnerOid"=owner_oid AND b."namespaceOid"=to_regnamespace('public');
  SELECT r.rolname INTO STRICT executor_name FROM pg_roles r
    JOIN pg_proc e ON e.oid=to_regprocedure('public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)')
      AND e.proowner=r.oid AND e.prosecdef
    WHERE r.oid=outside_binding."executorOwnerOid"
      AND r.oid NOT IN(owner_oid,outside_binding."ordinaryApplicationRoleOid",outside_binding."issuerSessionOid",
        outside_binding."issuerOwnerOid",outside_binding."runtimeSessionOid")
      AND NOT(r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE r.oid IN(m.member,m.roleid));
  IF NOT EXISTS(SELECT 1 FROM pg_proc p
      WHERE p.oid=lock_oid AND p.proowner=owner_oid AND p.pronamespace=outside_binding."namespaceOid"
        AND p.prosecdef AND p.proisstrict AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='22b310925d2630fb7408870030273fd3fd6c42ee0d507fb208cbefd750966af9'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid AND a.privilege_type='EXECUTE')
          FROM aclexplode(p.proacl) a))
    OR NOT has_function_privilege(outside_binding."executorOwnerOid",
      'public.jg_upward_archive_constraint_v2(public."ContractVersion")','EXECUTE')
    OR NOT has_function_privilege(outside_binding."executorOwnerOid",
      'public.jg_lock_direct_outside_operating_assignment_v2(text)','EXECUTE') THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_LOCK_SOURCE' USING ERRCODE='55000';
  END IF;
  source_sha:=public.jg_require_contract_direct_upward_source_v2();
  SELECT p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_proc p
    WHERE p.oid=guard_oid AND p.proowner=owner_oid AND p.pronamespace=outside_binding."namespaceOid"
      AND NOT p.prosecdef AND p.proconfig IS NULL
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c57288b55b9bac928d32850b0e3171d2089ab1b7f417eb85e7c1282b6d2d90ca';
  SELECT to_jsonb(t) INTO STRICT trigger_before FROM pg_trigger t
    WHERE t.tgrelid='public."ContractVersion"'::regclass AND t.tgfoid=guard_oid
      AND t.tgname='ContractVersion_lock_construction_enterprise'
      AND t.tgtype=21 AND t.tgenabled='O' AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='';
  IF cardinality(string_to_array(prior.prosrc,anchor))<>2
    OR cardinality(string_to_array(pg_get_functiondef(guard_oid),prior.prosrc))<>2 THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_LOCK_ANCHOR' USING ERRCODE='55000';
  END IF;
  next_source:=replace(prior.prosrc,anchor,branch||anchor);
  IF encode(sha256(convert_to(next_source,'UTF8')),'hex')<>'a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f' THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_LOCK_DIGEST' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_get_functiondef(guard_oid),prior.prosrc,next_source);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_lock_direct_outside_non_operating_assignment_v1(text) TO %I',executor_name);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=guard_oid AND p.prosrc=next_source AND to_jsonb(p)-'prosrc'=prior.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=(trigger_before->>'oid')::oid AND to_jsonb(t)=trigger_before)
    OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=lock_oid
      AND (SELECT count(*)=2 AND count(*) FILTER(WHERE a.grantee=outside_binding."executorOwnerOid" AND NOT a.is_grantable)=1
      AND bool_and(a.grantor=owner_oid AND a.privilege_type='EXECUTE'
        AND a.grantee IN (owner_oid,outside_binding."executorOwnerOid")) FROM aclexplode(p.proacl) a))
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM source_sha THEN
    RAISE EXCEPTION 'OUTSIDE_NON_OPERATING_LOCK_POSTIMAGE' USING ERRCODE='55000';
  END IF;
  RETURN true;
END;
$activate$;
REVOKE ALL ON FUNCTION public.jg_activate_outside_non_operating_assignment_lock_v1() FROM PUBLIC;

DO $upgrade$
BEGIN
  IF EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_closure_v2) THEN
    PERFORM public.jg_activate_outside_non_operating_assignment_lock_v1();
  END IF;
END;
$upgrade$;

COMMIT;
