-- Relation-specific transaction guards. No trigger splice or ACL activation.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_upward_archive_transaction_v2(p_archive TEXT,p_version TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $transaction$
DECLARE payload JSONB; binding RECORD; channel UUID;
BEGIN
  SELECT b.*,issuer."channelNonce" INTO STRICT binding
    FROM public.jg_contract_direct_upward_execution_binding_v2 b
    JOIN public.jg_contract_direct_upward_issuer_binding_v2 issuer ON issuer.tableoid=b."issuerBindingOid"
      AND encode(public.digest(convert_to(to_jsonb(issuer)::text,'UTF8'),'sha256'),'hex')=b."issuerBindingSha256"
    WHERE b."protocolVersion"=2 AND b."anchorOwnerOid"=current_user::regrole::oid
      AND b."runtimeSessionOid"=session_user::regrole::oid;
  channel:=binding."channelNonce";
  IF public.jg_require_contract_direct_upward_execution_v2(channel) IS DISTINCT FROM binding."sourceClosureSha256" THEN
    RAISE EXCEPTION '对上登记缺少当前专用执行资格' USING ERRCODE='42501';
  END IF;
  SELECT used."payload" INTO STRICT payload FROM public.jg_contract_direct_upward_use_v2 used
    JOIN public.jg_contract_direct_upward_intent_receipt_v2 receipt ON receipt."intentId"=used."intentId"
      AND receipt."bindingSha256"=binding."issuerBindingSha256" AND receipt."payloadSha256"=used."payloadSha256"
    WHERE used."archiveId"=p_archive AND used."backendPid"=pg_backend_pid() AND used."transactionId"=txid_current()
      AND used.xmin::text=mod(txid_current(),4294967296::bigint)::text
      AND used."payload"->>'contractVersionId'=p_version
      AND used."payloadSha256"=encode(public.digest(convert_to(used."payload"::text,'UTF8'),'sha256'),'hex');
  RETURN payload;
END;
$transaction$;

CREATE FUNCTION public.jg_guard_upward_archive_parent_v2(candidate public."ContractArchiveFile") RETURNS public."ContractArchiveFile"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $parent$
DECLARE payload JSONB; actual JSONB; q JSONB; manifest JSONB; files TEXT[]; basis JSONB; authority JSONB; request_sha TEXT; manifest_sha TEXT;
BEGIN
  payload:=public.jg_upward_archive_transaction_v2(candidate."id",candidate."contractVersionId");
  actual:=public.jg_contract_direct_archive_upward_intent_basis_v2(payload->>'actor',payload->>'projectId',payload->>'contractId',
    payload->>'contractVersionId',(payload->>'sourceRevision')::integer,payload->>'inputSha256',payload->>'requestKey',payload->'orderedEvidence');
  IF actual IS DISTINCT FROM payload OR candidate."archiveProtocolVersion"<>2 OR candidate."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR candidate."status" IS DISTINCT FROM 'confirmed' OR candidate."fileId" IS NOT NULL
    OR candidate."approvalInstanceId" IS NOT NULL OR candidate."sealTaskId" IS NOT NULL
    OR candidate."documentContentRevision" IS NOT NULL OR candidate."documentContentFingerprint" IS NOT NULL
    OR candidate."confirmedAt" IS NULL OR candidate."confirmedAt"<(statement_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    OR candidate."confirmedAt">(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    OR candidate."uploadedByUserId" IS DISTINCT FROM payload->>'actor' OR candidate."confirmedByUserId" IS DISTINCT FROM candidate."uploadedByUserId"
    OR candidate."idempotencyKey" IS DISTINCT FROM payload->>'requestKey'
    OR candidate."sourceRevision" IS DISTINCT FROM (payload->>'sourceRevision')::integer THEN
    RAISE EXCEPTION '对上归档父记录与当前已用原请求不一致' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(item->>'fileId' ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
    INTO files,manifest FROM jsonb_array_elements(payload->'orderedEvidence') WITH ORDINALITY original(item,position);
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(payload->>'contractId',candidate."contractVersionId",candidate."uploadedByUserId",
    candidate."idempotencyKey",candidate."sourceRevision",payload->>'inputSha256',files);
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  basis:=jsonb_build_object('directInput',payload->'directInput','businessTime',jsonb_build_object(
    'archivedAt',to_char(candidate."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'businessDay',to_char((candidate."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')));
  authority:=jsonb_build_object('recipeVersion','contract-upward-direct-archive-v1/1','authorityProtocolVersion',1,
    'archiveSource','direct_signed','projectId',payload->>'projectId','contractId',payload->>'contractId','contractVersionId',candidate."contractVersionId",
    'handlerUserId',candidate."uploadedByUserId",'sourceRevision',candidate."sourceRevision",'requestSha256',request_sha,'sourceBasis',basis,
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'originals',payload->'orderedEvidence','operatingConsequence',payload->'operatingConsequence');
  IF candidate."requestSha256" IS DISTINCT FROM request_sha OR candidate."fileManifestSha256" IS DISTINCT FROM manifest_sha
    OR candidate."authoritySnapshot" IS DISTINCT FROM authority
    OR candidate."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR candidate."responseSnapshot" IS DISTINCT FROM jsonb_build_object('archiveId',candidate."id",'contractVersionId',candidate."contractVersionId",
      'status','effective','fileIds',to_jsonb(files)) THEN
    RAISE EXCEPTION '对上归档权威、原件和原键结果必须独立重建' USING ERRCODE='23514';
  END IF;
  RETURN candidate;
END;
$parent$;

CREATE FUNCTION public.jg_guard_upward_archive_version_v2(prior public."ContractVersion",candidate public."ContractVersion")
RETURNS public."ContractVersion"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $version$
DECLARE parent public."ContractArchiveFile"%ROWTYPE; payload JSONB; manifest JSONB; evidence JSONB;
BEGIN
  IF prior."id" IS DISTINCT FROM candidate."id" OR prior."contractId" IS DISTINCT FROM candidate."contractId"
    OR prior."numericProtocolVersion"<>2 OR prior."signingSubjectType" IS DISTINCT FROM 'upward'
    OR prior."versionNo"<>1 OR prior."changeType" IS DISTINCT FROM 'original'
    OR prior."baseVersionId" IS NOT NULL OR prior."supersedesVersionId" IS NOT NULL OR prior."copiedFromContractVersionId" IS NOT NULL
    OR prior."firstSubmittedAt" IS NOT NULL OR prior."endedAt" IS NOT NULL
    OR prior."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '2'::jsonb
    OR prior."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR prior."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'upward' THEN
    RAISE EXCEPTION '对上直接登记只能保留原始Q2来源' USING ERRCODE='23514';
  END IF;
  IF prior."status"='effective' THEN
    IF (to_jsonb(candidate)-'updatedAt') IS DISTINCT FROM (to_jsonb(prior)-'updatedAt')
      OR NOT EXISTS(SELECT 1 FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=prior."id"
        AND a."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1'
        AND public.jg_read_upward_direct_archive_v1(a."id") IS NOT NULL) THEN
      RAISE EXCEPTION '对上已登记版本及其原件不可改写' USING ERRCODE='23514';
    END IF;
    RETURN candidate;
  END IF;
  IF prior."status" IS DISTINCT FROM 'draft' OR candidate."status" IS DISTINCT FROM 'effective'
    OR prior."effectiveAt" IS NOT NULL OR prior."taxFactsFrozenAt" IS NOT NULL
    OR (to_jsonb(prior)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) IS DISTINCT FROM
      (to_jsonb(candidate)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) THEN
    RAISE EXCEPTION '对上直接登记只可冻结原资料并一次生效' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT parent FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=prior."id"
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed'
    AND a."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1';
  payload:=public.jg_upward_archive_transaction_v2(parent."id",prior."id");
  SELECT jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",
    'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder") INTO evidence
    FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=parent."id" AND e."contractVersionId"=prior."id";
  manifest:=parent."authoritySnapshot"->'fileManifest';
  IF prior."draftRevision" IS DISTINCT FROM parent."sourceRevision" OR parent."sourceRevision" IS DISTINCT FROM (payload->>'sourceRevision')::integer
    OR candidate."effectiveAt" IS DISTINCT FROM parent."confirmedAt" OR candidate."taxFactsFrozenAt" IS DISTINCT FROM parent."confirmedAt"
    OR candidate."updatedAt" IS DISTINCT FROM parent."confirmedAt" OR evidence IS DISTINCT FROM manifest
    OR manifest IS DISTINCT FROM payload#>'{directInput,Q,signedFiles}'
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" WHERE "contractVersionId"=prior."id" AND "slotKey"='direct_signed_originals_v1') THEN
    RAISE EXCEPTION '对上生效缺少同事务有序原件交接' USING ERRCODE='23514';
  END IF;
  RETURN candidate;
END;
$version$;

CREATE FUNCTION public.jg_check_upward_archive_slot_v2(prior public."ContractDraftAttachment") RETURNS public."ContractDraftAttachment"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $slot$
DECLARE parent public."ContractArchiveFile"%ROWTYPE; payload JSONB; original JSONB;
BEGIN
  SELECT * INTO STRICT parent FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=prior."contractVersionId"
    AND a."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1';
  payload:=public.jg_upward_archive_transaction_v2(parent."id",prior."contractVersionId");
  original:=payload->'orderedEvidence'->prior."displayOrder";
  IF prior."slotKey" IS DISTINCT FROM 'direct_signed_originals_v1' OR prior."createdByUserId" IS DISTINCT FROM payload->>'actor'
    OR original->>'fileId' IS DISTINCT FROM prior."fileId" OR original->'displayOrder' IS DISTINCT FROM to_jsonb(prior."displayOrder") THEN
    RAISE EXCEPTION '对上原件只能向原请求有序交接' USING ERRCODE='23514';
  END IF;
  RETURN prior;
END;
$slot$;

CREATE FUNCTION public.jg_upward_archive_ownership_day_v2(p_version TEXT) RETURNS DATE
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $day$
DECLARE parent public."ContractArchiveFile"%ROWTYPE; payload JSONB; binding RECORD;
BEGIN
  SELECT * INTO STRICT parent FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=p_version
    AND a."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1';
  SELECT * INTO STRICT binding FROM public.jg_contract_direct_upward_execution_binding_v2 WHERE "protocolVersion"=2
    AND "anchorOwnerOid"=current_user::regrole::oid;
  IF session_user::regrole::oid=binding."runtimeSessionOid" THEN
    payload:=public.jg_upward_archive_transaction_v2(parent."id",p_version);
    IF payload#>>'{directInput,Q,locator,contractVersionId}' IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION '对上原件日期缺少同事务来源' USING ERRCODE='23514';
    END IF;
  ELSIF session_user::regrole::oid=binding."applicationRoleOid" THEN
    IF public.jg_read_upward_direct_archive_v1(parent."id") IS NULL THEN
      RAISE EXCEPTION '对上归档日期缺少完整持久证明' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION '当前连接无权读取对上归档日期' USING ERRCODE='42501';
  END IF;
  RETURN ((parent."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
END;
$day$;

CREATE FUNCTION public.jg_assert_upward_archive_complete_v2(p_archive TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $complete$
DECLARE version_id TEXT;
BEGIN
  SELECT "contractVersionId" INTO STRICT version_id FROM public."ContractArchiveFile" WHERE "id"=p_archive
    AND "archiveProtocolVersion"=2 AND "archiveSource"='direct_signed'
    AND "authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1';
  PERFORM public.jg_upward_archive_transaction_v2(p_archive,version_id);
  IF public.jg_read_upward_direct_archive_v1(p_archive) IS NULL THEN
    RAISE EXCEPTION '对上归档、生效、原件、项目锁和审计必须同事务完整提交' USING ERRCODE='23514';
  END IF;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_transaction_v2(TEXT,TEXT),
  public.jg_guard_upward_archive_parent_v2(public."ContractArchiveFile"),
  public.jg_guard_upward_archive_version_v2(public."ContractVersion",public."ContractVersion"),
  public.jg_check_upward_archive_slot_v2(public."ContractDraftAttachment"),
  public.jg_upward_archive_ownership_day_v2(TEXT),public.jg_assert_upward_archive_complete_v2(TEXT) FROM PUBLIC;
COMMIT;
