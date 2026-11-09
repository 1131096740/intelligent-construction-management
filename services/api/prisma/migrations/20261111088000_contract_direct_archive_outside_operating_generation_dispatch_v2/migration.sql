-- Extend only the 221 deferred fixed-generation dispatch.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_verify_direct_outside_operating_generations_v2(p_archive TEXT,p_binding_sha TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $verify_generation$
DECLARE
  proof RECORD;
  matched_count INTEGER;
  frozen_count INTEGER;
  manifest JSONB;
BEGIN
  IF pg_catalog.current_setting('session_replication_role')<>'origin'
    OR pg_catalog.inet_client_addr() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT u.xmin AS row_xid,u."contractVersionId" AS version_id,u."payload"->'orderedEvidence' AS originals,
    u."payload"#>'{directInput,Q,signedFiles}' AS signed_files,
    a."uploadedByUserId" AS actor,a."authoritySnapshot"->'fileManifest' AS archive_manifest,a."fileManifestSha256" AS manifest_sha
  INTO proof
  FROM public.jg_contract_direct_archive_intent_binding_v1 binding
  JOIN pg_catalog.pg_database d ON d.oid=binding."databaseOid" AND d.datname=pg_catalog.current_database()
    AND d.datdba=binding."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 nonce ON nonce."protocolVersion"=1
    AND nonce."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(binding)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_outside_operating_use_v2 u ON u."databaseOid"=binding."databaseOid"
    AND u."runtimeSessionOid"=binding."runtimeSessionOid" AND u."executorOwnerOid"=binding."executorOwnerOid"
    AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=u."intentId"
    AND receipt.xmin<>u.xmin AND receipt."bindingSha256"=nonce."intentBindingSha256"
    AND receipt."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=receipt."issuedAt" AND u."claimedAt"<receipt."expiresAt"
  JOIN public."ContractArchiveFile" a ON a."id"=u."archiveId" AND a."contractVersionId"=u."contractVersionId" AND a.xmin=u.xmin
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed' AND a."status"='confirmed'
    AND a."fileId" IS NULL AND a."approvalInstanceId" IS NULL AND a."sealTaskId" IS NULL
    AND a."idempotencyKey"=u."requestKey" AND a."requestSha256"=u."payload"->>'requestSha256'
    AND a."uploadedByUserId"=u."payload"->>'actor' AND a."confirmedByUserId"=a."uploadedByUserId"
    AND a."confirmedAt">=(u."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    AND (a."confirmedAt" AT TIME ZONE 'UTC')<receipt."expiresAt"
    AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
    AND a."authoritySnapshot"->'operatingConsequence'=u."payload"->'operatingConsequence'
    AND a."authoritySnapshot"#>>'{sourceBasis,intentPayloadSha256}'=receipt."payloadSha256"
    AND a."authoritySha256"=encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
  WHERE binding."protocolVersion"=1 AND binding."namespaceOid"=pg_catalog.to_regnamespace('public')
    AND binding."anchorOwnerOid"=current_user::regrole::oid AND binding."runtimeSessionOid"=session_user::regrole::oid
    AND nonce."intentBindingSha256"=p_binding_sha AND u."archiveId"=p_archive
    AND u."payload"->'protocolVersion'='2'::jsonb AND u."payload"->>'archiveSource'='direct_signed'
    AND u."payload"->>'relationship'='outside';
  IF NOT FOUND OR jsonb_typeof(proof.originals) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;

  frozen_count:=jsonb_array_length(proof.originals);
  IF frozen_count NOT BETWEEN 1 AND 20 THEN RETURN FALSE; END IF;
  SELECT count(*),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
  INTO matched_count,manifest
  FROM jsonb_array_elements(proof.originals) WITH ORDINALITY AS frozen(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=p_archive AND e."contractVersionId"=proof.version_id
    AND e.xmin=proof.row_xid AND e."displayOrder"=position-1 AND e."fileId"=item->>'fileId'
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."uploadedByUserId"=proof.actor AND f."storageStatus"='active'
    AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
  WHERE to_jsonb(e."displayOrder")=item->'displayOrder' AND to_jsonb(e."sizeBytes")=item->'sizeBytes'
    AND e."mimeType"=item->>'mimeType' AND f."mimeType"=e."mimeType" AND f."sizeBytes"=e."sizeBytes"
    AND e."contentSha256"=item->>'contentSha256' AND f."contentSha256"=e."contentSha256"
    AND jsonb_typeof(item->'objectGeneration')='string' AND length(item->>'objectGeneration') BETWEEN 1 AND 1024
    AND (item->>'objectGeneration') COLLATE "C"~'^[!-~]+$' AND lower(item->>'objectGeneration')<>'null'
    AND position(',' IN item->>'objectGeneration')=0
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."id"<>f."id"
      AND (replacement."supersedesFileObjectId"=f."id" OR (replacement."bucket",replacement."objectKey")=(f."bucket",f."objectKey")))
    AND NOT EXISTS(SELECT 1 FROM public."ContractArchiveEvidenceFile" other WHERE other."fileId"=e."fileId" AND other."id"<>e."id");

  IF matched_count IS DISTINCT FROM frozen_count
    OR frozen_count<>(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=p_archive)
    OR manifest IS DISTINCT FROM proof.signed_files OR manifest IS DISTINCT FROM proof.archive_manifest
    OR encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM proof.manifest_sha THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$verify_generation$;

CREATE FUNCTION public.jg_install_direct_outside_operating_generation_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install_generation$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  target OID:='public.jg_require_contract_direct_archive_generations_v1()'::regprocedure;
  verifier OID:='public.jg_verify_direct_outside_operating_generations_v2(text,text)'::regprocedure;
  archive_table OID:='public."ContractArchiveFile"'::regclass;
  constraint_oid OID;
  executor_name TEXT;
  prior RECORD;
  prior_trigger RECORD;
  next_body TEXT;
  anchor CONSTANT TEXT:=$generation_anchor$  IF public.jg_read_contract_direct_archive_generations_v1(NEW."id") IS NULL THEN$generation_anchor$;
  branch CONSTANT TEXT:=$generation_branch$  IF NEW."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required' THEN
    IF public.jg_observe_direct_outside_runtime_tls_v2() IS DISTINCT FROM TRUE
      OR public.jg_verify_direct_outside_operating_generations_v2(NEW."id",public.jg_check_contract_direct_archive_intent_roles_v1(FALSE))
      IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION '启用经营账的表外直签缺少同事务固定代原件' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
$generation_branch$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 nonce ON nonce."protocolVersion"=1
    AND nonce."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM binding."anchorOwnerOid"
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '表外直签固定代安装缺少受控所有者连接' USING ERRCODE='55000';
  END IF;

  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r
  WHERE r.oid=binding."executorOwnerOid" AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole
    OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."runtimeSessionOid",
      binding."issuerOwnerOid",binding."issuerSessionOid")
    AND NOT pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
      AND (pg_catalog.pg_has_role(r.oid,other.oid,'MEMBER') OR (other.oid<>binding."anchorOwnerOid" AND NOT other.rolsuper
        AND pg_catalog.pg_has_role(other.oid,r.oid,'MEMBER'))));
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=verifier AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND p.prosecdef AND NOT p.proretset
        AND p.prorettype='pg_catalog.bool'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='a34204383bb238a6bea8291bd28bc998e37e437a4267998bd18ec6205f5502d7'
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR 2<>(SELECT count(*) FROM (VALUES
      ('public.jg_read_contract_direct_archive_generations_v1(text)','8b0a12bcc9694ff1170668eea06731ad8153faf07bed5b94f620c718f7d38622'),
      ('public.jg_check_contract_direct_archive_intent_roles_v1(boolean)','19afa3783a3a18126af58e7e61633367ec6d745eb602e88cbe36d7c7a790cde9')
    ) expected(signature,body)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
      AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid" AND NOT p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body
      AND pg_catalog.has_function_privilege(binding."executorOwnerOid",p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION '表外直签固定代验证例程前态不匹配' USING ERRCODE='55000';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='sql'
    WHERE p.oid=pg_catalog.to_regprocedure('public.jg_observe_direct_outside_runtime_tls_v2()')
      AND p.pronamespace=binding."namespaceOid" AND p.proowner=binding."runtimeSessionOid" AND p.prokind='f' AND p.prosecdef
      AND p.provolatile='v' AND p.proparallel='u' AND NOT (p.proisstrict OR p.proretset OR p.proleakproof)
      AND p.pronargs=0 AND p.pronargdefaults=0 AND p.prosupport=0 AND p.prorettype='pg_catalog.bool'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7'
      AND (SELECT count(*)=2 AND count(*) FILTER (WHERE a.grantee=binding."executorOwnerOid" AND NOT a.is_grantable)=1
        AND count(*) FILTER (WHERE a.grantee=p.proowner)=1 AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION '表外直签固定代安装缺少已绑定的运行连接观察' USING ERRCODE='55000';
  END IF;

  SELECT c.oid INTO STRICT constraint_oid FROM pg_catalog.pg_constraint c
  WHERE c.connamespace=binding."namespaceOid" AND c.conname='ContractArchiveFile_direct_generations_v1';
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.oid=constraint_oid AND c.conrelid=archive_table
    AND c.contype='t' AND c.convalidated AND c.condeferrable AND c.condeferred AND c.conparentid=0) THEN
    RAISE EXCEPTION '表外直签固定代延期约束目录不匹配' USING ERRCODE='55000';
  END IF;
  SELECT t.oid,to_jsonb(t) AS metadata INTO STRICT prior_trigger FROM pg_catalog.pg_trigger t
  WHERE t.tgfoid=target AND t.tgrelid=archive_table AND t.tgconstraint=constraint_oid
    AND t.tgname='ContractArchiveFile_direct_generations_v1' AND t.tgtype=5 AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred AND t.tgparentid=0
    AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='';
  SELECT p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=target AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.prosecdef
    AND NOT p.proretset AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
      'f258feb6ebac8a63d654ebd6f98557a7b5f88c67f982613002e234dffcbd503b';
  IF cardinality(string_to_array(prior.prosrc,anchor))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(target),prior.prosrc))<>2 THEN
    RAISE EXCEPTION '表外直签固定代分派锚点不唯一' USING ERRCODE='55000';
  END IF;

  next_body:=replace(prior.prosrc,anchor,branch||anchor);
  IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '5b6ad408598dbde8798f62fa3ed3ea94d32a96faa2b64f3473112df7e2238a35' THEN
    RAISE EXCEPTION '表外直签固定代分派后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),prior.prosrc,next_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosrc=next_body AND to_jsonb(p)-'prosrc'=prior.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=prior_trigger.oid AND to_jsonb(t)=prior_trigger.metadata) THEN
    RAISE EXCEPTION '表外直签固定代分派改变了原触发器身份' USING ERRCODE='55000';
  END IF;

  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_verify_direct_outside_operating_generations_v2(text,text) TO %I',executor_name);
  IF NOT pg_catalog.has_function_privilege(binding."executorOwnerOid",verifier,'EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=verifier
      AND (a.grantor<>p.proowner OR (a.grantee<>p.proowner
        AND (a.grantee<>binding."executorOwnerOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))) THEN
    RAISE EXCEPTION '表外直签固定代核验授权不匹配' USING ERRCODE='55000';
  END IF;
END;
$install_generation$;

REVOKE ALL ON FUNCTION public.jg_verify_direct_outside_operating_generations_v2(TEXT,TEXT),
  public.jg_install_direct_outside_operating_generation_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
    pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.jg_verify_direct_outside_operating_generations_v2(text,text)'::regprocedure,
      'public.jg_install_direct_outside_operating_generation_v2()'::regprocedure)
    AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签固定代核验与安装默认必须私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
