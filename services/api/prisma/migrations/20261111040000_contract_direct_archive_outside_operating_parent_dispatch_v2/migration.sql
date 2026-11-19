-- Keep the global parent and the historical bindings intact. The owner can
-- install this precise direct-only splice after the existing V1 install.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_guard_direct_outside_operating_parent_v2(p_parent public."ContractArchiveFile")
RETURNS public."ContractArchiveFile"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $guard$
DECLARE expected RECORD;
BEGIN
  SELECT * INTO STRICT expected FROM public.jg_direct_outside_operating_first_parent_v2(
    p_parent."id",p_parent."confirmedAt");
  IF p_parent."createdAt" IS DISTINCT FROM pg_catalog.transaction_timestamp()::timestamp(3)
    OR (to_jsonb(p_parent)-'createdAt') IS DISTINCT FROM (to_jsonb(expected)-'createdAt') THEN
    RAISE EXCEPTION '表外直签归档与同事务冻结原请求不一致' USING ERRCODE='23514';
  END IF;
  RETURN p_parent;
END;
$guard$;

-- Shared private witness for future slot and version dispatch. It is valid
-- after the initial parent insert, including between ordered slot deletions.
CREATE FUNCTION public.jg_require_direct_outside_operating_handoff_v2(p_archive TEXT,p_version TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $handoff$
DECLARE witness JSONB;
BEGIN
  SELECT jsonb_build_object('protocolVersion',2,'archiveId',archive."id",'contractVersionId',p_version,
    'intentId',u."intentId",'requestKey',u."requestKey",'intentPayloadSha256',receipt."payloadSha256",
    'authoritySha256',archive."authoritySha256",'databaseOid',u."databaseOid"::text,
    'executorOwnerOid',u."executorOwnerOid"::text,'runtimeSessionOid',u."runtimeSessionOid"::text,
    'backendPid',u."backendPid",'transactionId',u."transactionId"::text) INTO witness
  FROM public.jg_contract_direct_outside_operating_use_v2 u
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=u."intentId"
  JOIN public."ContractArchiveFile" archive ON archive."id"=u."archiveId"
    AND archive."contractVersionId"=u."contractVersionId" AND archive.xmin=u.xmin
  JOIN public."ContractVersion" v ON v."id"=u."contractVersionId"
  JOIN public."Contract" c ON c."id"=v."contractId" AND c."id"=u."payload"->>'contractId'
  JOIN public."Project" project ON project."id"=c."projectId" AND project."id"=u."payload"->>'projectId'
  WHERE u."archiveId"=p_archive AND u."contractVersionId"=p_version
    AND u."databaseOid"=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=current_database())
    AND u."runtimeSessionOid"=session_user::regrole::oid AND u."executorOwnerOid"=current_user::regrole::oid
    AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text AND receipt.xmin<>u.xmin
    AND receipt."bindingSha256"=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    AND receipt."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=receipt."issuedAt" AND u."claimedAt"<receipt."expiresAt"
    AND archive."confirmedAt">=(u."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    AND (archive."confirmedAt" AT TIME ZONE 'UTC')<receipt."expiresAt"
    AND archive."archiveProtocolVersion"=2 AND archive."archiveSource"='direct_signed' AND archive."status"='confirmed'
    AND archive."fileId" IS NULL AND archive."approvalInstanceId" IS NULL AND archive."sealTaskId" IS NULL
    AND archive."uploadedByUserId"=u."payload"->>'actor' AND archive."confirmedByUserId"=archive."uploadedByUserId"
    AND archive."idempotencyKey"=u."requestKey" AND archive."requestSha256"=u."payload"->>'requestSha256'
    AND archive."sourceRevision"::text=u."payload"->>'sourceRevision' AND archive."sourceRevision"=v."draftRevision"
    AND v."status"='draft' AND v."signingSubjectType"='affiliate' AND v."firstSubmittedAt" IS NULL
    AND v."effectiveAt" IS NULL AND v."taxFactsFrozenAt" IS NULL
    AND c."ownerUserId"=archive."uploadedByUserId" AND c."voidedAt" IS NULL AND project."isActive"
    AND to_jsonb(project."operatingLedgerEffectiveDate")=u."payload"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
    AND archive."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
    AND archive."authoritySnapshot"->'operatingConsequence'=u."payload"->'operatingConsequence'
    AND archive."authoritySnapshot"#>'{sourceBasis,reviewScope}'=u."payload"#>'{operatingConsequence,reviewScope}'
    AND archive."authoritySnapshot"#>'{sourceBasis,directInput}'=u."payload"->'directInput'
    AND archive."authoritySnapshot"#>>'{sourceBasis,intentPayloadSha256}'=receipt."payloadSha256"
    AND archive."authoritySnapshot"->'fileManifest'=u."payload"#>'{directInput,Q,signedFiles}'
    AND archive."fileManifestSha256"=encode(public.digest(convert_to((archive."authoritySnapshot"->'fileManifest')::text,'UTF8'),'sha256'),'hex')
    AND archive."authoritySha256"=encode(public.digest(convert_to(archive."authoritySnapshot"::text,'UTF8'),'sha256'),'hex');
  IF NOT FOUND THEN
    RAISE EXCEPTION '表外直签原件及生效接线缺少本次归档与冻结凭据' USING ERRCODE='23514';
  END IF;
  RETURN witness;
END;
$handoff$;

CREATE FUNCTION public.jg_install_direct_outside_operating_parent_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  executor_name TEXT;
  prior RECORD;
  new_body TEXT;
  target OID:='public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")'::regprocedure;
  anchor CONSTANT TEXT:=$anchor$  profile:=public.jg_assert_contract_direct_archive_write_profile_v1();$anchor$;
  branch CONSTANT TEXT:=$branch$  IF p_parent."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required' THEN
    RETURN public.jg_guard_direct_outside_operating_parent_v2(p_parent);
  END IF;
$branch$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 nonce ON nonce."protocolVersion"=1
    AND nonce."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public');
  SELECT role.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles role
  WHERE role.oid=binding."executorOwnerOid" AND NOT (role.rolcanlogin OR role.rolsuper OR role.rolcreaterole
    OR role.rolcreatedb OR role.rolreplication OR role.rolbypassrls)
    AND role.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."runtimeSessionOid",
      binding."issuerOwnerOid",binding."issuerSessionOid")
    AND NOT has_schema_privilege(role.oid,binding."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>role.oid AND
      (pg_has_role(role.oid,other.oid,'MEMBER') OR (other.oid<>binding."anchorOwnerOid" AND NOT other.rolsuper
        AND pg_has_role(other.oid,role.oid,'MEMBER'))));
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM binding."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '表外直签父归档只能由当前数据库绑定所有者安装' USING ERRCODE='55000';
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
  WHERE p.oid=target AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND p.prorettype='public."ContractArchiveFile"'::regtype
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
      '1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903'
    AND has_function_privilege(binding."executorOwnerOid",p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantor<>p.proowner
      OR (acl.grantee<>p.proowner AND (acl.grantee<>binding."executorOwnerOid" OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable)));
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='public."ContractArchiveFile"'::regclass AND t.tgname='ContractArchiveFile_v2_immutable'
        AND p.oid='public.jg_contract_archive_v2_parent_guard()'::regprocedure
        AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.prorettype='pg_catalog.trigger'::regtype AND NOT p.prosecdef AND NOT p.proretset
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') IN (
          'f9de843279039250da6f56cc481d8d1f80e247431c7060aa637821a7bae7eff8',
          'cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522')
        AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
    OR 2<>(SELECT count(*) FROM (VALUES
      ('public.jg_guard_direct_outside_operating_parent_v2(public."ContractArchiveFile")','b774ebb292ad585ff2564ca3a6b119de77706314d2fc35c9b087055482e1da73'),
      ('public.jg_direct_outside_operating_first_parent_v2(text,timestamp)','b31541459ed1f2e4887a5d499279d779aafbbb28d2a4900ebd9a6c4ad7b9eb81')
    ) expected(signature,body)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
      AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.prorettype='public."ContractArchiveFile"'::regtype
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body
    WHERE NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee<>p.proowner OR acl.grantor<>p.proowner))
    OR cardinality(string_to_array(prior.prosrc,anchor))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(target),prior.prosrc))<>2 THEN
    RAISE EXCEPTION '表外直签父归档分派的目录前态不一致' USING ERRCODE='55000';
  END IF;

  new_body:=replace(prior.prosrc,anchor,branch||anchor);
  IF encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b211330ea1a8e4bad49fb29fa05543c3a4a7028cc6424c48975cdfe010e0ca4b' THEN
    RAISE EXCEPTION '表外直签父归档分派的精确后态不一致' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosrc=new_body
    AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
    RAISE EXCEPTION '表外直签父归档分派改变了既有对象身份' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_guard_direct_outside_operating_parent_v2(public."ContractArchiveFile"),
    public.jg_direct_outside_operating_first_parent_v2(text,timestamp) TO %I',executor_name);
END;
$install$;

REVOKE ALL ON FUNCTION public.jg_guard_direct_outside_operating_parent_v2(public."ContractArchiveFile"),
  public.jg_install_direct_outside_operating_parent_v2(),
  public.jg_require_direct_outside_operating_handoff_v2(text,text) FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid IN ('public.jg_guard_direct_outside_operating_parent_v2(public."ContractArchiveFile")'::regprocedure,
      'public.jg_install_direct_outside_operating_parent_v2()'::regprocedure,
      'public.jg_require_direct_outside_operating_handoff_v2(text,text)'::regprocedure)
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签分派默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
