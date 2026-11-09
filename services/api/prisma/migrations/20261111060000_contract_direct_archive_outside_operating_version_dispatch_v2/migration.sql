-- Exact version and POL-284 successors for the enabled affiliate direct path.
-- This migration defines private source and an explicit owner-only installer.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_guard_direct_outside_operating_version_v2(
  p_old public."ContractVersion",p_new public."ContractVersion"
) RETURNS DATE
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $guard$
DECLARE
  a RECORD;
  witness JSONB;
  source JSONB;
  manifest JSONB;
  originals JSONB;
  terms JSONB;
  terms_id TEXT;
  business_day DATE;
  source_xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  IF p_old."status" IS DISTINCT FROM 'draft' OR p_new."status" IS DISTINCT FROM 'effective'
    OR p_old."effectiveAt" IS NOT NULL OR p_old."taxFactsFrozenAt" IS NOT NULL OR p_old."endedAt" IS NOT NULL
    OR p_old."firstSubmittedAt" IS NOT NULL OR p_old."documentContentFingerprint" IS NOT NULL
    OR p_old."versionNo" IS DISTINCT FROM 1 OR p_old."numericProtocolVersion" IS DISTINCT FROM 2
    OR p_old."changeType" IS DISTINCT FROM 'original' OR p_old."supersedesVersionId" IS NOT NULL
    OR p_old."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR p_old."companyEntityIdSnapshot" IS NOT NULL OR p_old."companyEntityVersionId" IS NOT NULL
    OR p_old."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR p_old."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR p_old."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR p_old."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside'
    OR (to_jsonb(p_old)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) IS DISTINCT FROM
      (to_jsonb(p_new)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) THEN
    RAISE EXCEPTION '经营账表外直签只能保留原资料并登记生效' USING ERRCODE='23514';
  END IF;

  SELECT archive.*,c."projectId" INTO STRICT a FROM public."ContractArchiveFile" archive
  JOIN public."Contract" c ON c."id"=p_old."contractId" AND c."companyEntityId" IS NULL
  WHERE archive."contractVersionId"=p_old."id" AND archive."archiveProtocolVersion"=2 AND archive."archiveSource"='direct_signed'
    AND archive."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required';
  witness:=public.jg_require_direct_outside_operating_handoff_v2(a."id",p_old."id");
  SELECT u."payload" INTO STRICT source FROM public.jg_contract_direct_outside_operating_use_v2 u
  WHERE u."archiveId"=a."id" AND u."contractVersionId"=p_old."id" AND u.xmin::text=source_xid
    AND u."intentId"=(witness->>'intentId')::uuid;
  business_day:=((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
  IF p_new."effectiveAt" IS DISTINCT FROM a."confirmedAt"
    OR p_new."taxFactsFrozenAt" IS DISTINCT FROM a."confirmedAt"
    OR p_new."updatedAt" IS DISTINCT FROM a."confirmedAt"
    OR a."authoritySnapshot"#>>'{sourceBasis,businessTime,businessDay}' IS DISTINCT FROM to_char(business_day,'YYYY-MM-DD')
    OR a."authoritySnapshot"#>>'{sourceBasis,businessTime,archivedAt}' IS DISTINCT FROM to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR NOT EXISTS(SELECT 1 FROM public."ProjectAffiliateAssignment" assignment
      WHERE assignment."id"=p_old."affiliateAssignmentId" AND assignment."id"=source#>>'{operatingConsequence,debtor,assignmentId}'
        AND assignment."projectId"=a."projectId" AND assignment."businessPartyVersionId"=p_old."affiliateBusinessPartyVersionId"
        AND assignment."businessPartyVersionId"=source#>>'{operatingConsequence,debtor,id}'
        AND assignment."affiliateNameSnapshot"=p_old."affiliateNameSnapshot"
        AND assignment."affiliateCreditCodeSnapshot" IS NOT DISTINCT FROM p_old."affiliateCreditCodeSnapshot"
        AND assignment."effectiveFrom"<=a."confirmedAt" AND (assignment."endedAt" IS NULL OR assignment."endedAt">a."confirmedAt"))
    OR 1<>(SELECT count(*) FROM public."ProjectAffiliateAssignment" assignment WHERE assignment."projectId"=a."projectId"
      AND assignment."effectiveFrom"<=a."confirmedAt" AND (assignment."endedAt" IS NULL OR assignment."endedAt">a."confirmedAt"))
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" slot WHERE slot."contractVersionId"=p_old."id"
      AND slot."slotKey"='direct_signed_originals_v1') THEN
    RAISE EXCEPTION '经营账表外直签缺少归档时间、施工企业或已交接原件' USING ERRCODE='23514';
  END IF;

  SELECT jsonb_agg(item ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
  INTO originals,manifest
  FROM jsonb_array_elements(source->'orderedEvidence') WITH ORDINALITY AS frozen(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=a."id" AND e."contractVersionId"=p_old."id"
    AND e.xmin::text=source_xid AND e."displayOrder"=position-1 AND e."fileId"=item->>'fileId'
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
  WHERE e."displayOrder"::text=item->>'displayOrder' AND e."mimeType"=item->>'mimeType' AND f."mimeType"=e."mimeType"
    AND e."sizeBytes"::text=item->>'sizeBytes' AND f."sizeBytes"=e."sizeBytes"
    AND e."contentSha256"=item->>'contentSha256' AND f."contentSha256"=e."contentSha256"
    AND f."uploadedByUserId"=a."uploadedByUserId" AND f."storageStatus"='active'
    AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" other WHERE other."id"<>f."id"
      AND (other."supersedesFileObjectId"=f."id" OR (other."bucket",other."objectKey")=(f."bucket",f."objectKey")));
  IF originals IS DISTINCT FROM source->'orderedEvidence' OR manifest IS DISTINCT FROM a."authoritySnapshot"->'fileManifest'
    OR jsonb_array_length(originals) IS DISTINCT FROM (SELECT count(*)::integer FROM public."ContractArchiveEvidenceFile" e
      WHERE e."archiveFileId"=a."id") THEN
    RAISE EXCEPTION '经营账表外直签生效需要完整的同事务固定代原件' USING ERRCODE='23514';
  END IF;

  terms:=source#>'{directInput,Q,terms,paymentTerms}';
  terms_id:=p_old."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}';
  IF (terms_id IS NULL AND (terms IS DISTINCT FROM 'null'::jsonb
      OR EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=p_old."id")))
    OR (terms_id IS NOT NULL AND ((SELECT count(*) FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=p_old."id")<>1
      OR NOT EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."id"=terms_id AND t."contractId"=p_old."contractId"
        AND t."contractVersionId"=p_old."id" AND t."status"='effective' AND t."updatedAt"=a."confirmedAt" AND t.xmin::text=source_xid
        AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText",'stages','[]'::jsonb)
        AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" stage WHERE stage."paymentTermsVersionId"=t."id"))))
    OR witness IS DISTINCT FROM public.jg_require_direct_outside_operating_handoff_v2(a."id",p_old."id") THEN
    RAISE EXCEPTION '经营账表外直签生效的付款约定或领取资格已变化' USING ERRCODE='23514';
  END IF;
  RETURN business_day;
END;
$guard$;

CREATE FUNCTION public.jg_install_direct_outside_operating_version_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  executor_name TEXT;
  prior RECORD;
  trigger_prior RECORD;
  recipe RECORD;
  new_body TEXT;
  guard_oid OID:='public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion")'::regprocedure;
  v_anchor CONSTANT TEXT:=$v_anchor$  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();$v_anchor$;
  v_branch CONSTANT TEXT:=$v_branch$  IF p_old."draftData"#>>'{directSigningInput,relationship}'='outside'
    AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=p_old."id"
      AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
      AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
    PERFORM public.jg_guard_direct_outside_operating_version_v2(p_old,p_new);
    RETURN p_new;
  END IF;
$v_branch$;
  p_anchor CONSTANT TEXT:=$p_anchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);
  END IF;$p_anchor$;
  p_branch CONSTANT TEXT:=$p_branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='draft' AND NEW."status"='effective'
      AND OLD."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,
        'public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion")','EXECUTE') THEN
      IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=OLD."id"
        AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
        AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
        candidate_fact_date:=public.jg_guard_direct_outside_operating_version_v2(
          OLD::public."ContractVersion",NEW::public."ContractVersion");
        -- The exact affiliate path above binds the day and an active assignment.
        -- It has no company participant candidates.
        IF candidate_fact_date IS NULL OR primary_company_id IS NOT NULL OR secondary_company_id IS NOT NULL THEN
          RAISE EXCEPTION '表外直签归档日期或参与方不一致' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END IF;
    END IF;
  END IF;

$p_branch$;
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
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=guard_oid AND p.proowner=binding."anchorOwnerOid"
      AND p.pronamespace=binding."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset AND p.prorettype='pg_catalog.date'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='1e4898b461dca761fe46d37da78ab8316634b959572148e3b875d8e39fac8325'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid
      JOIN public.jg_contract_upward_pending_save_binding_v1 u ON u."slotRoutineOid"=p.oid
      WHERE u."protocolVersion"=1 AND u."databaseOid"=binding."databaseOid" AND u."namespaceOid"=binding."namespaceOid"
        AND u."ownerOid"=binding."anchorOwnerOid" AND u."applicationRoleOid"=binding."ordinaryApplicationRoleOid"
        AND p.oid='public.jg_guard_contract_direct_archive_slot_v1()'::regprocedure
        AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
          '99d80f7a4bb9105acda415aa7cedd6dba0266849cb9b945cb5e7b0aaf6885164'
        AND t.tgrelid='public."ContractDraftAttachment"'::regclass AND t.tgname='ContractDraftAttachment_direct_archive_transfer_v1'
        AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND t.tgqual IS NULL AND t.tgnargs=0) THEN
    RAISE EXCEPTION '经营账表外直签生效的安装角色或原件槽前态不一致' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")',
      'public."ContractVersion"'::regtype,TRUE,ARRAY['search_path=pg_catalog, pg_temp'],
      'c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157','b448ae524c9d9b1961b02a6a995f92df1295eae3f9d015e282660bc3bdef9b30',
      v_anchor,v_branch),
    ('public."requireActiveProjectParticipatingCompany"()','pg_catalog.trigger'::regtype,FALSE,NULL,
      '9b3b12c796afc49722d8277d10705277021c89897444f1a6b192d40df2be5f9c','ba713bc2f3d6c7faa9390f75fd9f459a7d2bd2791d62a39fa33a97b291f0ccfc',
      p_anchor,p_branch)
  ) expected(signature,result_type,is_strict,configuration,pre,post,anchor,branch) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE p.oid=pg_catalog.to_regprocedure(recipe.signature) AND p.proowner=binding."anchorOwnerOid"
      AND p.pronamespace=binding."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND NOT p.prosecdef AND NOT p.proretset AND p.proisstrict=recipe.is_strict AND p.prorettype=recipe.result_type
      AND p.proconfig IS NOT DISTINCT FROM recipe.configuration
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.pre;
    IF recipe.is_strict THEN
      IF NOT pg_catalog.has_function_privilege(binding."executorOwnerOid",prior.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(prior.proacl) a WHERE a.grantor<>prior.proowner
          OR (a.grantee<>prior.proowner AND (a.grantee<>binding."executorOwnerOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable))) THEN
        RAISE EXCEPTION '原直签生效分派的执行授权不一致' USING ERRCODE='55000';
      END IF;
    ELSE
      SELECT t.* INTO STRICT trigger_prior FROM pg_catalog.pg_trigger t
      WHERE t.tgfoid=prior.oid AND t.tgrelid='public."ContractVersion"'::regclass
        AND t.tgname='ContractVersion_require_active_participant' AND t.tgtype=23 AND t.tgenabled='O'
        AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgqual IS NULL
        AND t.tgnargs=0 AND t.tgattr::text='';
    END IF;
    IF cardinality(string_to_array(prior.prosrc,recipe.anchor))<>2
      OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2 THEN
      RAISE EXCEPTION '经营账表外直签生效的分派锚点不一致' USING ERRCODE='55000';
    END IF;
    new_body:=replace(prior.prosrc,recipe.anchor,recipe.branch||recipe.anchor);
    IF encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.post THEN
      RAISE EXCEPTION '经营账表外直签生效的精确后态不一致' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,new_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=new_body AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
      RAISE EXCEPTION '经营账表外直签生效接线改变了既有例程身份' USING ERRCODE='55000';
    END IF;
    IF NOT recipe.is_strict THEN
      IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=trigger_prior.oid AND to_jsonb(t)=to_jsonb(trigger_prior)) THEN
        RAISE EXCEPTION '经营账表外直签生效接线改变了既有触发器身份' USING ERRCODE='55000';
      END IF;
    END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion") TO %I',
    executor_name);
END;
$install$;

REVOKE ALL ON FUNCTION public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion"),
  public.jg_install_direct_outside_operating_version_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid IN ('public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion")'::regprocedure,
      'public.jg_install_direct_outside_operating_version_v2()'::regprocedure)
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '经营账表外直签生效函数默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
