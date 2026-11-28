BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Detached source. The 204 trigger still rejects direct registration. A later
-- qualified installation must replace its exact dispatcher and activate the
-- write profile together with the version, slot and completion guards.
CREATE FUNCTION public.jg_guard_contract_direct_archive_parent_v1(p_parent public."ContractArchiveFile")
RETURNS public."ContractArchiveFile"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $direct_parent_guard$
DECLARE
  profile JSONB; contract_id TEXT; c RECORD; v RECORD; p RECORD; assignment RECORD; affected INTEGER;
  actor TEXT; file_ids TEXT[]; locked_slot_ids TEXT[]; physical_key TEXT; fixed_terms_id TEXT;
  stored_input JSONB; q JSONB; input_sha TEXT; manifest JSONB; actual_manifest JSONB; archived_at TIMESTAMP(3);
  archived_at_text TEXT; business_day TEXT; request_sha TEXT; basis JSONB; basis_sha TEXT; manifest_sha TEXT;
  authority JSONB; authority_sha TEXT; response JSONB;
BEGIN
  profile:=public.jg_assert_contract_direct_archive_write_profile_v1();
  IF current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR profile->>'bindingSha256' IS NULL OR profile->>'bindingSha256'!~'^[a-f0-9]{64}$'
    OR profile IS DISTINCT FROM jsonb_build_object(
      'profileProtocolVersion',1,'recipeVersion','contract-direct-archive-write-v1/1','bindingSha256',profile->>'bindingSha256',
      'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
      'sessionRoleOid',session_user::regrole::oid::text,'currentRoleOid',current_user::regrole::oid::text,
      'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text) THEN
    RAISE EXCEPTION '直签归档父记录缺少同一事务写入资格' USING ERRCODE='55000';
  END IF;

  actor:=p_parent."uploadedByUserId";
  archived_at:=p_parent."confirmedAt";
  IF p_parent."archiveProtocolVersion" IS DISTINCT FROM 2 OR p_parent."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR p_parent."status" IS DISTINCT FROM 'confirmed' OR p_parent."fileId" IS NOT NULL
    OR p_parent."approvalInstanceId" IS NOT NULL OR p_parent."sealTaskId" IS NOT NULL
    OR p_parent."documentContentRevision" IS NOT NULL OR p_parent."documentContentFingerprint" IS NOT NULL
    OR p_parent."id" IS NULL OR p_parent."id"!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR p_parent."idempotencyKey" IS NULL OR p_parent."idempotencyKey"!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR p_parent."sourceRevision" IS NULL OR p_parent."sourceRevision"<1
    OR actor IS NULL OR p_parent."confirmedByUserId" IS DISTINCT FROM actor OR archived_at IS NULL
    OR archived_at<(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    OR archived_at>(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) THEN
    RAISE EXCEPTION '直签归档父记录的请求、经办或时刻不正确' USING ERRCODE='23514';
  END IF;

  SELECT "contractId" INTO contract_id FROM public."ContractVersion" WHERE "id"=p_parent."contractVersionId";
  SELECT "id","projectId","ownerUserId","voidedAt" INTO c FROM public."Contract" WHERE "id"=contract_id FOR UPDATE;
  SELECT "id","contractId","status","versionNo","changeType","numericProtocolVersion","draftRevision","draftData",
    "supersedesVersionId","effectiveAt","taxFactsFrozenAt","firstSubmittedAt","endedAt","documentContentFingerprint",
    "signingSubjectType","affiliateAssignmentId","affiliateBusinessPartyVersionId"
  INTO v FROM public."ContractVersion" WHERE "id"=p_parent."contractVersionId" FOR UPDATE;
  IF c."id" IS NULL OR v."id" IS NULL OR v."contractId" IS DISTINCT FROM c."id" OR c."voidedAt" IS NOT NULL
    OR c."ownerUserId" IS DISTINCT FROM actor OR NOT EXISTS (SELECT 1 FROM public."User" u WHERE u."id"=actor AND u."isActive") THEN
    RAISE EXCEPTION '当前经办人无权确认直签归档' USING ERRCODE='42501';
  END IF;
  IF v."status" IS DISTINCT FROM 'draft' OR v."versionNo" IS DISTINCT FROM 1 OR v."changeType" IS DISTINCT FROM 'original'
    OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."draftRevision" IS DISTINCT FROM p_parent."sourceRevision"
    OR v."supersedesVersionId" IS NOT NULL OR v."effectiveAt" IS NOT NULL OR v."taxFactsFrozenAt" IS NOT NULL
    OR v."firstSubmittedAt" IS NOT NULL OR v."endedAt" IS NOT NULL OR v."documentContentFingerprint" IS NOT NULL
    OR v."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR v."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR v."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside' THEN
    RAISE EXCEPTION '当前版本不属于已签原件待登记来源' USING ERRCODE='23514';
  END IF;

  SELECT "id","isActive","operatingLedgerEffectiveDate" INTO p FROM public."Project" WHERE "id"=c."projectId" FOR UPDATE;
  IF NOT FOUND OR p."isActive" IS DISTINCT FROM TRUE OR p."operatingLedgerEffectiveDate" IS NOT NULL THEN
    RAISE EXCEPTION '当前项目不可直接登记已签原件' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."ProjectMember" pm
      WHERE pm."projectId"=p."id" AND pm."userId"=actor AND pm."positionKey"='contract_staff')
    AND NOT EXISTS (SELECT 1 FROM public."UserPosition" up JOIN public."Position" po ON po."id"=up."positionId"
      WHERE up."userId"=actor AND up."projectId" IS NULL AND po."key"='contract_director') THEN
    RAISE EXCEPTION '当前经办人已无项目合同登记权限' USING ERRCODE='42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public."ContractArchiveFile" old_parent
      WHERE old_parent."contractVersionId"=v."id" OR old_parent."idempotencyKey"=p_parent."idempotencyKey")
    OR EXISTS (SELECT 1 FROM public."Contract" other_contract
      WHERE other_contract."projectId"=p."id" AND other_contract."id"<>c."id" AND other_contract."voidedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM public."ProjectAffiliateContractFact" fact WHERE fact."projectId"=p."id")
    OR EXISTS (SELECT 1 FROM public."ContractEconomicReview" review WHERE review."projectId"=p."id"
      AND ('contract:'||c."id") IN (review."leftSourceRef",review."rightSourceRef")) THEN
    RAISE EXCEPTION '本版本或项目仍有需要单独核对的归档或履约来源' USING ERRCODE='23514';
  END IF;

  -- Discover IDs from the real slot, then hold C/V/P → sorted F → try G and
  -- physical keys. Re-read the locked slot and reject any intervening change.
  SELECT array_agg(da."fileId" ORDER BY da."displayOrder") INTO file_ids
  FROM public."ContractDraftAttachment" da WHERE da."contractVersionId"=v."id" AND da."slotKey"='direct_signed_originals_v1';
  IF file_ids IS NULL OR cardinality(file_ids) NOT BETWEEN 1 AND 20 OR cardinality(file_ids)<>(
    SELECT count(DISTINCT f) FROM unnest(file_ids) f WHERE f~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') THEN
    RAISE EXCEPTION '当前专用槽签章原件不完整' USING ERRCODE='23514';
  END IF;
  PERFORM f."id" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>cardinality(file_ids) THEN RAISE EXCEPTION '签章原件行已变化' USING ERRCODE='23514'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(190731,13) THEN RAISE EXCEPTION '文件绑定正在办理' USING ERRCODE='55P03'; END IF;
  FOR physical_key IN SELECT f."objectKey" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."objectKey" COLLATE "C"
  LOOP
    IF physical_key IS NULL OR physical_key='' THEN RAISE EXCEPTION '签章原件物理身份缺失' USING ERRCODE='23514'; END IF;
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('jg:contract-direct-review-object-key-v1:'||physical_key,0)) THEN
      RAISE EXCEPTION '签章原件正在办理' USING ERRCODE='55P03';
    END IF;
  END LOOP;
  SELECT array_agg(da."fileId" ORDER BY da."displayOrder") INTO locked_slot_ids FROM (
    SELECT slot."fileId",slot."displayOrder" FROM public."ContractDraftAttachment" slot
      WHERE slot."contractVersionId"=v."id" AND slot."slotKey"='direct_signed_originals_v1'
      ORDER BY slot."displayOrder" FOR UPDATE NOWAIT
  ) da;
  IF locked_slot_ids IS DISTINCT FROM file_ids OR EXISTS (
    SELECT 1 FROM public."ContractDraftAttachment" da WHERE da."fileId"=ANY(file_ids)
      AND (da."contractVersionId" IS DISTINCT FROM v."id" OR da."slotKey" IS DISTINCT FROM 'direct_signed_originals_v1'
        OR da."createdByUserId" IS DISTINCT FROM actor)) THEN
    RAISE EXCEPTION '签章原件槽或经办归属已变化' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public."FileObject" f WHERE f."id"=ANY(file_ids)
    AND (f."uploadedByUserId" IS DISTINCT FROM actor OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL
      OR f."supersedesFileObjectId" IS NOT NULL OR f."bucket"='' OR f."sizeBytes"<1
      OR f."mimeType" NOT IN ('application/pdf','image/jpeg','image/png')
      OR f."contentSha256" IS NULL OR f."contentSha256"!~'^[a-f0-9]{64}$'
      OR EXISTS (SELECT 1 FROM public."FileObject" other_file WHERE other_file."id"<>f."id"
        AND (other_file."objectKey"=f."objectKey" OR other_file."supersedesFileObjectId"=f."id")))) THEN
    RAISE EXCEPTION '签章原件内容、归属或物理身份不一致' USING ERRCODE='23514';
  END IF;

  fixed_terms_id:=v."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}';
  IF fixed_terms_id IS NOT NULL THEN
    PERFORM t."id" FROM public."PaymentTermsVersion" t WHERE t."id"=fixed_terms_id
      AND t."contractId"=c."id" AND t."contractVersionId"=v."id" AND t."status"='draft' FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION '固定付款约定来源已变化' USING ERRCODE='23514'; END IF;
  END IF;
  stored_input:=public.jg_contract_direct_pending_input_v1(v."id");
  q:=stored_input->'Q';
  input_sha:=stored_input->>'inputSha256';
  manifest:=q->'signedFiles';
  SELECT jsonb_agg(jsonb_build_object('fileId',f."id",'displayOrder',ordered.position-1,'mimeType',f."mimeType",
    'sizeBytes',f."sizeBytes",'contentSha256',f."contentSha256") ORDER BY ordered.position)
  INTO actual_manifest FROM unnest(file_ids) WITH ORDINALITY AS ordered(id,position)
    JOIN public."FileObject" f ON f."id"=ordered.id;
  IF stored_input->>'state' IS DISTINCT FROM 'complete' OR stored_input->'sourceRevision' IS DISTINCT FROM to_jsonb(v."draftRevision")
    OR jsonb_typeof(q) IS DISTINCT FROM 'object'
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',p."id",'contractId',c."id",'contractVersionId',v."id",
      'versionNo',1,'changeType','original','draftRevision',v."draftRevision")
    OR input_sha IS NULL OR input_sha IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex')
    OR manifest IS DISTINCT FROM actual_manifest
    OR (fixed_terms_id IS NULL AND q#>'{terms,paymentTerms}' IS DISTINCT FROM 'null'::jsonb)
    OR (fixed_terms_id IS NOT NULL AND q#>>'{terms,paymentTerms,id}' IS DISTINCT FROM fixed_terms_id) THEN
    RAISE EXCEPTION '实际待登记资料、付款约定或原件顺序已变化' USING ERRCODE='23514';
  END IF;

  IF 1<>(SELECT count(*) FROM public."ProjectAffiliateAssignment" a WHERE a."projectId"=p."id"
    AND a."effectiveFrom"<=archived_at AND (a."endedAt" IS NULL OR a."endedAt">archived_at)) THEN
    RAISE EXCEPTION '归档时的项目施工企业不唯一' USING ERRCODE='23514';
  END IF;
  SELECT a."id",a."businessPartyId",a."businessPartyVersionId" INTO assignment
  FROM public."ProjectAffiliateAssignment" a WHERE a."id"=v."affiliateAssignmentId" AND a."projectId"=p."id"
    AND a."effectiveFrom"<=archived_at AND (a."endedAt" IS NULL OR a."endedAt">archived_at);
  IF NOT FOUND OR assignment."businessPartyVersionId" IS DISTINCT FROM v."affiliateBusinessPartyVersionId"
    OR assignment."id" IS DISTINCT FROM q#>>'{subjects,enterprise,assignmentId}'
    OR assignment."businessPartyId" IS DISTINCT FROM q#>>'{subjects,enterprise,businessPartyId}'
    OR assignment."businessPartyVersionId" IS DISTINCT FROM q#>>'{subjects,enterprise,businessPartyVersionId}' THEN
    RAISE EXCEPTION '归档时的项目施工企业资格已变化' USING ERRCODE='23514';
  END IF;

  archived_at_text:=to_char(archived_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  business_day:=to_char((archived_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD');
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(c."id",v."id",actor,p_parent."idempotencyKey",v."draftRevision",input_sha,file_ids);
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',jsonb_build_object('Q',q,'inputSha256',input_sha),
    'fileManifest',manifest,'businessTime',jsonb_build_object('archivedAt',archived_at_text,'businessDay',business_day,'handlerUserId',actor),
    'reviewScope',jsonb_build_object('excludedAmountYuan','0.0000','sources','[]'::jsonb));
  basis_sha:=encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex');
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed','projectId',p."id",'contractId',c."id",
    'contractVersionId',v."id",'handlerUserId',actor,'archivedAt',archived_at_text,'requestSha256',request_sha,'sourceRevision',v."draftRevision",
    'sourceBasis',basis,'sourceBasisSha256',basis_sha,'fileManifest',manifest,'fileManifestSha256',manifest_sha,
    'operatingConsequence',jsonb_build_object('protocolVersion',1,'mode','not_applicable','operatingLedgerEffectiveDateSnapshot',NULL,'expectedSource',NULL));
  authority_sha:=encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex');
  response:=jsonb_build_object('archiveId',p_parent."id",'contractVersionId',v."id",'status','effective','fileIds',to_jsonb(file_ids));
  IF request_sha IS NULL OR p_parent."requestSha256" IS DISTINCT FROM request_sha
    OR p_parent."authoritySnapshot" IS DISTINCT FROM authority OR p_parent."authoritySha256" IS DISTINCT FROM authority_sha
    OR p_parent."fileManifestSha256" IS DISTINCT FROM manifest_sha OR p_parent."responseSnapshot" IS DISTINCT FROM response THEN
    RAISE EXCEPTION '直签归档父记录与数据库实际重建的归档依据不一致' USING ERRCODE='23514';
  END IF;
  IF profile IS DISTINCT FROM public.jg_assert_contract_direct_archive_write_profile_v1() THEN
    RAISE EXCEPTION '直签归档父记录写入资格在同一事务内已变化' USING ERRCODE='55000';
  END IF;
  RETURN p_parent;
END;
$direct_parent_guard$;

REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile") FROM PUBLIC;
COMMIT;
