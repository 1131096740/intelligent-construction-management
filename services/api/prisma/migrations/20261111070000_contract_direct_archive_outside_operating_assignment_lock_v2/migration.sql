-- Exact AFTER activation successor for the enabled outside assignment lock.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

-- Complete the existing sticky project lock after the qualified effective
-- version becomes visible. The executor receives no new Project DML grants.
CREATE FUNCTION public.jg_lock_direct_outside_operating_assignment_v2(p_version TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $lock$
DECLARE
  project_id TEXT;
BEGIN
  SELECT p."id" INTO STRICT project_id
  FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_outside_operating_use_v2 u ON u."databaseOid"=b."databaseOid"
    AND u."runtimeSessionOid"=b."runtimeSessionOid" AND u."executorOwnerOid"=b."executorOwnerOid"
    AND u."backendPid"=pg_backend_pid() AND u."transactionId"=txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 r ON r."intentId"=u."intentId"
    AND r.xmin<>u.xmin AND r."bindingSha256"=n."intentBindingSha256"
    AND r."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=r."issuedAt" AND u."claimedAt"<r."expiresAt"
  JOIN public."ContractArchiveFile" archive ON archive."id"=u."archiveId"
    AND archive."contractVersionId"=u."contractVersionId" AND archive.xmin=u.xmin
    AND archive."archiveProtocolVersion"=2 AND archive."archiveSource"='direct_signed' AND archive."status"='confirmed'
    AND archive."idempotencyKey"=u."requestKey" AND archive."requestSha256"=u."payload"->>'requestSha256'
    AND archive."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
    AND archive."authoritySnapshot"->'operatingConsequence'=u."payload"->'operatingConsequence'
    AND archive."authoritySha256"=encode(public.digest(convert_to(archive."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
  JOIN public."ContractVersion" v ON v."id"=u."contractVersionId" AND v.xmin=u.xmin AND v."status"='effective'
    AND v."effectiveAt"=archive."confirmedAt" AND v."taxFactsFrozenAt"=v."effectiveAt" AND v."signingSubjectType"='affiliate'
    AND v."companyEntityIdSnapshot" IS NULL AND v."companyEntityVersionId" IS NULL AND v."firstSubmittedAt" IS NULL
  JOIN public."Contract" c ON c."id"=v."contractId" AND c."id"=u."payload"->>'contractId'
    AND c."companyEntityId" IS NULL AND c."voidedAt" IS NULL AND c."ownerUserId"=archive."uploadedByUserId"
  JOIN public."Project" p ON p."id"=c."projectId" AND p."id"=u."payload"->>'projectId' AND p."isActive"
    AND to_jsonb(p."operatingLedgerEffectiveDate")=u."payload"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
  JOIN public."ProjectAffiliateAssignment" a ON a."id"=v."affiliateAssignmentId" AND a."projectId"=p."id"
    AND a."businessPartyVersionId"=v."affiliateBusinessPartyVersionId"
    AND a."id"=u."payload"#>>'{operatingConsequence,debtor,assignmentId}'
    AND a."businessPartyVersionId"=u."payload"#>>'{operatingConsequence,debtor,id}'
    AND a."effectiveFrom"<=archive."confirmedAt" AND (a."endedAt" IS NULL OR a."endedAt">archive."confirmedAt")
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid
    AND current_setting('session_replication_role')='origin' AND u."contractVersionId"=p_version
    AND 1=(SELECT count(*) FROM public."ProjectAffiliateAssignment" active WHERE active."projectId"=p."id"
      AND active."effectiveFrom"<=archive."confirmedAt" AND (active."endedAt" IS NULL OR active."endedAt">archive."confirmedAt"));

  UPDATE public."Project" p SET "constructionEnterpriseLockedAt"=COALESCE(p."constructionEnterpriseLockedAt",transaction_timestamp())
  WHERE p."id"=project_id;
  IF NOT FOUND THEN RAISE EXCEPTION '表外直签施工企业锁定失败' USING ERRCODE='23514'; END IF;
END;
$lock$;

CREATE FUNCTION public.jg_install_direct_outside_operating_assignment_lock_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  executor_name TEXT;
  prior RECORD;
  prior_trigger RECORD;
  new_body TEXT;
  target OID:='public."lockProjectConstructionEnterpriseFromFormalFact"()'::regprocedure;
  lock_writer OID:='public.jg_lock_direct_outside_operating_assignment_v2(text)'::regprocedure;
  anchor CONSTANT TEXT:=$anchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$anchor$;
  branch CONSTANT TEXT:=$branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='draft' AND NEW."status"='effective'
      AND OLD."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,'public.jg_lock_direct_outside_operating_assignment_v2(text)','EXECUTE') THEN
      IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=NEW."id"
        AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
        AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
        PERFORM public.jg_lock_direct_outside_operating_assignment_v2(NEW."id");
        RETURN NEW;
      END IF;
    END IF;
  END IF;
$branch$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public');
  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r
  WHERE r.oid=binding."executorOwnerOid" AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole
    OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."runtimeSessionOid",
      binding."issuerOwnerOid",binding."issuerSessionOid")
    AND NOT has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
      AND (pg_has_role(r.oid,other.oid,'MEMBER') OR (other.oid<>binding."anchorOwnerOid" AND NOT other.rolsuper
        AND pg_has_role(other.oid,r.oid,'MEMBER'))));
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM binding."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=lock_writer AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND p.prosecdef AND NOT p.proretset
        AND p.prorettype='pg_catalog.void'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
          '4ae0880016c59ec452e9507f622c2c8fe10101e49220713e1fd7c42845aee581'
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR 2<>(SELECT count(*) FROM (VALUES
      ('public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")',
        'b448ae524c9d9b1961b02a6a995f92df1295eae3f9d015e282660bc3bdef9b30'),
      ('public."requireActiveProjectParticipatingCompany"()','ba713bc2f3d6c7faa9390f75fd9f459a7d2bd2791d62a39fa33a97b291f0ccfc')
    ) expected(signature,body)
    JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(expected.signature)
      AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body) THEN
    RAISE EXCEPTION '经营账表外施工企业锁接线缺少版本生效前态' USING ERRCODE='55000';
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=target AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.prosecdef
    AND NOT p.proretset AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig IS NULL
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
      'a83830f419340282908c9cc4c7d146fc8751724ea7f71fd05afb8691c990b941';
  SELECT t.* INTO STRICT prior_trigger FROM pg_catalog.pg_trigger t
  WHERE t.tgfoid=target AND t.tgrelid='public."ContractVersion"'::regclass
    AND t.tgname='ContractVersion_lock_construction_enterprise' AND t.tgtype=21 AND t.tgenabled='O'
    AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgqual IS NULL
    AND t.tgnargs=0 AND t.tgattr::text='';
  IF cardinality(string_to_array(prior.prosrc,anchor))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(target),prior.prosrc))<>2 THEN
    RAISE EXCEPTION '经营账表外施工企业锁的源码锚点不一致' USING ERRCODE='55000';
  END IF;
  new_body:=replace(prior.prosrc,anchor,branch||anchor);
  IF encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    'e651e3554e2938ebaa2c07578e109b1ad049188d4984820fe3bc017ca1879839' THEN
    RAISE EXCEPTION '经营账表外施工企业锁的精确后态不一致' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosrc=new_body AND to_jsonb(p)-'prosrc'=prior.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=prior_trigger.oid AND to_jsonb(t)=to_jsonb(prior_trigger)) THEN
    RAISE EXCEPTION '经营账表外施工企业锁接线改变了既有对象身份' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_lock_direct_outside_operating_assignment_v2(text) TO %I',executor_name);
END;
$install$;

REVOKE ALL ON FUNCTION public.jg_lock_direct_outside_operating_assignment_v2(text),
  public.jg_install_direct_outside_operating_assignment_lock_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.jg_lock_direct_outside_operating_assignment_v2(text)'::regprocedure,
      'public.jg_install_direct_outside_operating_assignment_lock_v2()'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '经营账表外施工企业锁函数默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
