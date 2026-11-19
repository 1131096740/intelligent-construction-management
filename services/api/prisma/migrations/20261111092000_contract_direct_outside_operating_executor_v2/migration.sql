-- Private native transaction entrypoints. This migration does not transfer
-- ownership, install predecessors or grant execution to any login.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_observe_direct_outside_issuer_tls_v2() RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $observe$
  SELECT current_user IS NOT DISTINCT FROM session_user
    AND pg_catalog.inet_client_addr() IS NOT NULL
    AND pg_catalog.current_setting('session_replication_role')='origin'
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s
      WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl IS TRUE);
$observe$;

CREATE FUNCTION public.jg_issue_direct_outside_operating_v2(
  p_nonce UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS UUID
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $issue$
DECLARE
  binding_sha TEXT;
  intent UUID;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(TRUE);
  IF NOT (CASE WHEN EXISTS(
    SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 i
    JOIN pg_catalog.pg_database d ON d.oid=i."databaseOid" AND d.datname=current_database() AND d.datdba=i."anchorOwnerOid"
    JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('public.jg_observe_direct_outside_issuer_tls_v2()')
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='sql'
    WHERE i."protocolVersion"=1 AND i."namespaceOid"=to_regnamespace('public')
      AND i."issuerSessionOid"=session_user::regrole::oid AND i."issuerOwnerOid"=current_user::regrole::oid
      AND p.proowner=i."issuerSessionOid" AND p.pronamespace=i."namespaceOid" AND p.prokind='f' AND p.prosecdef
      AND p.provolatile='v' AND p.proparallel='u' AND NOT (p.proisstrict OR p.proretset OR p.proleakproof)
      AND p.pronargs=0 AND p.pronargdefaults=0 AND p.prosupport=0 AND p.prorettype='pg_catalog.bool'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7'
      AND (SELECT count(*)=2 AND count(*) FILTER (WHERE a.grantee=i."issuerOwnerOid" AND NOT a.is_grantable)=1
        AND count(*) FILTER (WHERE a.grantee=i."issuerSessionOid")=1
        AND bool_and(a.grantor=i."issuerSessionOid" AND a.privilege_type='EXECUTE')
        FROM aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a)
  ) THEN public.jg_observe_direct_outside_issuer_tls_v2() IS TRUE ELSE FALSE END) THEN
    RAISE EXCEPTION '表外直签签发必须使用绑定的独立 TLS 连接' USING ERRCODE='55000';
  END IF;
  intent:=public.jg_issue_contract_direct_outside_operating_intent_v2(
    p_nonce,p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF intent IS NULL OR public.jg_check_contract_direct_archive_intent_roles_v1(TRUE) IS DISTINCT FROM binding_sha THEN
    RAISE EXCEPTION '表外直签签发的原请求或角色资格已变化' USING ERRCODE='55000';
  END IF;
  RETURN intent;
END;
$issue$;

CREATE FUNCTION public.jg_execute_direct_outside_operating_v2(
  p_nonce UUID,p_intent UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $execute$
DECLARE
  binding_sha TEXT;
  anchor OID;
  namespace_oid OID:=pg_catalog.to_regnamespace('public');
  archive_id TEXT;
  archived_at TIMESTAMP(3);
  request_sha TEXT;
  file_ids TEXT[];
  pair JSONB;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE);
  SELECT b."anchorOwnerOid" INTO STRICT anchor FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=namespace_oid
    AND b."executorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid;
  IF pg_catalog.pg_my_temp_schema()<>0
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.oid=namespace_oid
      AND n.nspowner IN (anchor,pg_catalog.to_regrole('pg_database_owner')::oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper
      AND r.oid NOT IN (anchor,pg_catalog.to_regrole('pg_database_owner')::oid)
      AND pg_catalog.has_schema_privilege(r.oid,namespace_oid,'CREATE'))
    OR 2<>(SELECT count(*) FROM (VALUES
      ('public.jg_stage_direct_outside_operating_archive_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
        '7196f97ce11149792f50642a0800045f9d123229ca82ec05298ace226ba28400','pg_catalog.text',FALSE),
      ('public.jg_append_direct_outside_operating_pair_v2(text)',
        '320cd69ccc24928eddf607ece7cbae5c2bc4544a73f9395ef6266571ed3e3f22','pg_catalog.jsonb',TRUE)
    ) q(signature,sha,result_type,definer)
    JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(q.signature) AND p.proowner=anchor AND p.pronamespace=namespace_oid
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.proretset AND p.prosecdef=q.definer
      AND p.prorettype=to_regtype(q.result_type) AND p.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=q.sha
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE'))
    OR 6<>(SELECT count(*) FROM (VALUES
      ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"','public.jg_contract_archive_v2_complete_guard()',
        '2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd','search_path=pg_catalog, public'),
      ('ContractArchiveEvidenceFile_v2_complete','public."ContractArchiveEvidenceFile"','public.jg_contract_archive_v2_complete_guard()',
        '2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd','search_path=pg_catalog, public'),
      ('ContractArchiveFile_direct_complete_v1','public."ContractArchiveFile"','public.jg_require_contract_direct_archive_complete_v1()',
        'aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a','search_path=pg_catalog, pg_temp'),
      ('ContractArchiveEvidenceFile_direct_complete_v1','public."ContractArchiveEvidenceFile"','public.jg_require_contract_direct_archive_complete_v1()',
        'aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a','search_path=pg_catalog, pg_temp'),
      ('ContractArchiveFile_direct_generations_v1','public."ContractArchiveFile"','public.jg_require_contract_direct_archive_generations_v1()',
        '5b6ad408598dbde8798f62fa3ed3ea94d32a96faa2b64f3473112df7e2238a35','search_path=pg_catalog, pg_temp'),
      ('jg_direct_outside_operating_completion','public.jg_contract_direct_outside_operating_use_v2',
        'public.jg_require_direct_outside_operating_completion_v2()',
        'd67e9870c2f11a8a2cfdb53360c1b93adeaf4bd2db653a7d0dd9f12004651f70','search_path=pg_catalog, pg_temp')
    ) q(name,relation,signature,sha,path)
    JOIN pg_catalog.pg_constraint c ON c.conname=q.name AND c.connamespace=namespace_oid
      AND c.conrelid=to_regclass(q.relation) AND c.contype='t' AND c.condeferrable AND c.condeferred
    JOIN pg_catalog.pg_trigger t ON t.tgconstraint=c.oid AND t.tgrelid=c.conrelid AND t.tgname=c.conname
      AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid AND p.oid=to_regprocedure(q.signature)
      AND p.proowner=anchor AND p.pronamespace=namespace_oid AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND NOT (p.prosecdef OR p.proisstrict OR p.proretset) AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY[q.path]
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=q.sha
    WHERE 1=(SELECT count(*) FROM pg_catalog.pg_constraint other WHERE other.conname=q.name AND other.connamespace=namespace_oid)) THEN
    RAISE EXCEPTION '表外直签执行缺少已绑定的事务与归档完成守卫' USING ERRCODE='55000';
  END IF;

  archive_id:=public.jg_stage_direct_outside_operating_archive_v2(
    p_nonce,p_intent,p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  SELECT array_agg(item->>'fileId' ORDER BY position) INTO file_ids
  FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS original(item,position);
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(p_contract,p_version,p_actor,p_key,p_revision,p_input_sha,file_ids);
  IF archive_id IS NULL OR request_sha IS NULL THEN
    RAISE EXCEPTION '表外直签缺少原归档标识或原请求摘要' USING ERRCODE='23514';
  END IF;
  SELECT a."confirmedAt" INTO STRICT archived_at FROM public."ContractArchiveFile" a
  JOIN public."Contract" c ON c."id"=p_contract AND c."projectId"=p_project AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL
  JOIN public."Project" p ON p."id"=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NOT NULL
  WHERE a."id"=archive_id AND a."contractVersionId"=p_version
    AND a.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed' AND a."status"='confirmed'
    AND a."idempotencyKey"=p_key AND a."requestSha256"=request_sha AND a."sourceRevision"=p_revision
    AND a."uploadedByUserId"=p_actor AND a."confirmedByUserId"=p_actor
    AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
    AND to_jsonb(p."operatingLedgerEffectiveDate")=a."authoritySnapshot"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}';

  -- The stage still holds C/V/P and the ordered original-file locks. The
  -- ordinary version hooks check the four changed fields, assignment and terms.
  UPDATE public."ContractVersion" v SET "status"='effective',"effectiveAt"=archived_at,
    "taxFactsFrozenAt"=archived_at,"updatedAt"=archived_at
  WHERE v."id"=p_version AND v."contractId"=p_contract AND v."draftRevision"=p_revision AND v."status"='draft'
    AND v."versionNo"=1 AND v."changeType"='original' AND v."numericProtocolVersion"=2 AND v."signingSubjectType"='affiliate'
    AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL AND v."taxFactsFrozenAt" IS NULL AND v."endedAt" IS NULL;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."Project" p
    WHERE p."id"=p_project AND p."isActive" AND p."constructionEnterpriseLockedAt" IS NOT NULL) THEN
    RAISE EXCEPTION '表外直签生效与施工企业锁必须随同归档' USING ERRCODE='23514';
  END IF;
  pair:=public.jg_append_direct_outside_operating_pair_v2(archive_id);
  IF pair->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR nullif(pair->>'factId','') IS NULL
    OR nullif(pair->>'impactId','') IS NULL OR nullif(pair->>'auditId','') IS NULL THEN
    RAISE EXCEPTION '表外直签经营承诺未完整写入' USING ERRCODE='23514';
  END IF;

  SET CONSTRAINTS public."ContractArchiveFile_v2_complete",public."ContractArchiveEvidenceFile_v2_complete",
    public."ContractArchiveFile_direct_complete_v1",public."ContractArchiveEvidenceFile_direct_complete_v1",
    public."ContractArchiveFile_direct_generations_v1",public.jg_direct_outside_operating_completion IMMEDIATE;
  IF public.jg_check_contract_direct_archive_intent_roles_v1(FALSE) IS DISTINCT FROM binding_sha
    OR NOT EXISTS(SELECT 1 FROM public."ContractArchiveFile" a WHERE a."id"=archive_id AND a."contractVersionId"=p_version
      AND a."idempotencyKey"=p_key AND a."requestSha256"=request_sha
      AND a."responseSnapshot"=jsonb_build_object('archiveId',archive_id,'contractVersionId',p_version,
        'status','effective','fileIds',to_jsonb(file_ids))) THEN
    RAISE EXCEPTION '表外直签归档响应与原请求不一致' USING ERRCODE='23514';
  END IF;
  -- The API still reads the committed result using the original request key.
  RETURN archive_id;
END;
$execute$;

REVOKE ALL ON FUNCTION public.jg_observe_direct_outside_issuer_tls_v2(),
  public.jg_issue_direct_outside_operating_v2(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_execute_direct_outside_operating_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
    WHERE p.oid IN ('public.jg_observe_direct_outside_issuer_tls_v2()'::regprocedure,
      'public.jg_issue_direct_outside_operating_v2(uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure,
      'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签原生签发与执行函数默认须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
