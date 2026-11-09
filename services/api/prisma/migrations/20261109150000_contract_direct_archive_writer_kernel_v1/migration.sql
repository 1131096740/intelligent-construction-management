BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- A trusted installer must supply and validate the exact successor binding
-- together with the parent/version dispatch. No installed kernel alone can write.
CREATE FUNCTION public.jg_assert_contract_direct_archive_write_profile_v1() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $write_profile$
BEGIN
  RAISE EXCEPTION '直签登记写入资格尚未完整供应' USING ERRCODE='55000';
END;
$write_profile$;

-- A closed, invoker-only kernel. Its return value is an internal archive ID.
-- The application must obtain the outcome separately through the original-key proof.
CREATE FUNCTION public.jg_write_contract_direct_archive_v1(
  p_version_id TEXT, p_actor TEXT, p_key TEXT, p_revision INTEGER,
  p_input_sha256 TEXT, p_file_ids TEXT[], p_verified_file_identity JSONB
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $writer$
DECLARE
  profile JSONB; located_contract TEXT; c RECORD; v RECORD; p RECORD; assignment RECORD;
  acting_role TEXT; row_count_now INTEGER; physical_key TEXT; file_identity JSONB;
  current_input JSONB; q JSONB; manifest JSONB; terms JSONB; fixed_terms_id TEXT; observed_file_ids TEXT[];
  archived_at TIMESTAMP(3); archived_at_text TEXT; business_day TEXT;
  archive_id TEXT; request_sha TEXT; basis JSONB; basis_sha TEXT; manifest_sha TEXT; authority JSONB; response JSONB;
BEGIN
  profile:=public.jg_assert_contract_direct_archive_write_profile_v1();
  IF current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR profile->>'bindingSha256' IS NULL OR profile->>'bindingSha256' !~ '^[a-f0-9]{64}$'
    OR profile IS DISTINCT FROM jsonb_build_object(
      'profileProtocolVersion',1,'recipeVersion','contract-direct-archive-write-v1/1','bindingSha256',profile->>'bindingSha256',
      'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
      'sessionRoleOid',session_user::regrole::oid::text,'currentRoleOid',current_user::regrole::oid::text,
      'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text) THEN
    RAISE EXCEPTION '直签登记写入资格与当前事务不一致' USING ERRCODE='55000';
  END IF;
  IF p_revision<1 OR p_input_sha256 !~ '^[a-f0-9]{64}$'
    OR p_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR cardinality(p_file_ids) NOT BETWEEN 1 AND 20 OR array_ndims(p_file_ids) IS DISTINCT FROM 1
    OR cardinality(p_file_ids)<>(SELECT count(DISTINCT f) FROM unnest(p_file_ids) f
      WHERE f~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
    OR jsonb_typeof(p_verified_file_identity) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '直签原请求或原件清单不完整' USING ERRCODE='23514';
  END IF;

  SELECT "contractId" INTO located_contract FROM public."ContractVersion" WHERE "id"=p_version_id;
  SELECT "id","projectId","ownerUserId","voidedAt" INTO c FROM public."Contract" WHERE "id"=located_contract FOR UPDATE;
  SELECT "id","contractId","versionNo","changeType","numericProtocolVersion","status","draftRevision","draftData",
    "supersedesVersionId","firstSubmittedAt","effectiveAt","taxFactsFrozenAt","endedAt","documentContentFingerprint",
    "signingSubjectType","affiliateAssignmentId","affiliateBusinessPartyVersionId"
  INTO v FROM public."ContractVersion" WHERE "id"=p_version_id FOR UPDATE;
  IF c."id" IS NULL OR v."id" IS NULL OR v."contractId" IS DISTINCT FROM c."id"
    OR c."ownerUserId" IS DISTINCT FROM p_actor OR c."voidedAt" IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public."User" u WHERE u."id"=p_actor AND u."isActive") THEN
    RAISE EXCEPTION '当前经办人无权登记本合同' USING ERRCODE='42501';
  END IF;
  IF v."versionNo" IS DISTINCT FROM 1 OR v."changeType" IS DISTINCT FROM 'original'
    OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."status" IS DISTINCT FROM 'draft'
    OR v."draftRevision" IS DISTINCT FROM p_revision OR v."supersedesVersionId" IS NOT NULL
    OR v."firstSubmittedAt" IS NOT NULL OR v."effectiveAt" IS NOT NULL OR v."taxFactsFrozenAt" IS NOT NULL
    OR v."endedAt" IS NOT NULL OR v."documentContentFingerprint" IS NOT NULL OR v."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR v."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR v."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside' THEN
    RAISE EXCEPTION '当前合同不属于可登记的已签合同来源' USING ERRCODE='23514';
  END IF;

  SELECT "id","isActive","operatingLedgerEffectiveDate" INTO p FROM public."Project" WHERE "id"=c."projectId" FOR UPDATE;
  IF NOT FOUND OR p."isActive" IS DISTINCT FROM TRUE OR p."operatingLedgerEffectiveDate" IS NOT NULL THEN
    RAISE EXCEPTION '项目当前不可办理此类直签登记' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public."UserPosition" up JOIN public."Position" po ON po."id"=up."positionId"
    WHERE up."userId"=p_actor AND up."projectId" IS NULL AND po."key"='contract_director') THEN
    acting_role:='contract_director';
  ELSIF EXISTS (SELECT 1 FROM public."ProjectMember" pm WHERE pm."userId"=p_actor AND pm."projectId"=p."id" AND pm."positionKey"='contract_staff') THEN
    acting_role:='contract_staff';
  ELSE
    RAISE EXCEPTION '当前经办人已无项目合同登记权限' USING ERRCODE='42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public."ContractArchiveFile" a WHERE a."idempotencyKey"=p_key OR a."contractVersionId"=p_version_id) THEN
    RAISE EXCEPTION '合同或归档标识已有记录，请查询原请求' USING ERRCODE='23505';
  END IF;

  -- Conservative first write domain. A future caller must also run the full
  -- application overlap evaluator; its display results cannot replace this test.
  IF EXISTS (SELECT 1 FROM public."Contract" other_contract
      WHERE other_contract."projectId"=p."id" AND other_contract."id"<>c."id" AND other_contract."voidedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM public."ProjectAffiliateContractFact" f WHERE f."projectId"=p."id")
    OR EXISTS (SELECT 1 FROM public."ContractEconomicReview" r WHERE r."projectId"=p."id"
      AND (('contract:'||c."id") IN (r."leftSourceRef",r."rightSourceRef"))) THEN
    RAISE EXCEPTION '项目存在需要单独核对的其他履约来源，当前不能直接登记' USING ERRCODE='23514';
  END IF;

  PERFORM f."id" FROM public."FileObject" f WHERE f."id"=ANY(p_file_ids) ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS row_count_now=ROW_COUNT;
  IF row_count_now<>cardinality(p_file_ids) THEN RAISE EXCEPTION '直签原件不完整' USING ERRCODE='23514'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION '文件绑定正在办理，请稍后查询原请求' USING ERRCODE='55P03';
  END IF;
  FOR physical_key IN SELECT f."objectKey" FROM public."FileObject" f
    WHERE f."id"=ANY(p_file_ids) ORDER BY f."objectKey" COLLATE "C"
  LOOP
    IF physical_key IS NULL OR physical_key='' THEN RAISE EXCEPTION '直签原件物理身份不完整' USING ERRCODE='23514'; END IF;
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('jg:contract-direct-review-object-key-v1:'||physical_key,0)) THEN
      RAISE EXCEPTION '签章原件正在办理，请稍后查询原请求' USING ERRCODE='55P03';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public."FileObject" f WHERE f."id"=ANY(p_file_ids)
    AND (f."uploadedByUserId" IS DISTINCT FROM p_actor OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL
      OR f."supersedesFileObjectId" IS NOT NULL OR f."bucket"='' OR f."sizeBytes"<1
      OR f."mimeType" NOT IN ('application/pdf','image/jpeg','image/png') OR f."contentSha256" IS NULL OR f."contentSha256"!~'^[a-f0-9]{64}$'
      OR EXISTS (SELECT 1 FROM public."FileObject" alias WHERE alias."id"<>f."id"
        AND (alias."objectKey"=f."objectKey" OR alias."supersedesFileObjectId"=f."id")))) THEN
    RAISE EXCEPTION '直签原件内容或物理身份已变化' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('fileId',f."id",'displayOrder',requested.position-1,'bucket',f."bucket",'objectKey',f."objectKey",
    'mimeType',f."mimeType",'sizeBytes',f."sizeBytes",'contentSha256',f."contentSha256") ORDER BY requested.position)
  INTO file_identity FROM unnest(p_file_ids) WITH ORDINALITY AS requested(id,position)
    JOIN public."FileObject" f ON f."id"=requested.id;
  IF file_identity IS DISTINCT FROM p_verified_file_identity THEN
    RAISE EXCEPTION '签章原件与应用核对的文件身份不一致' USING ERRCODE='23514';
  END IF;

  PERFORM da."id" FROM public."ContractDraftAttachment" da
    WHERE da."contractVersionId"=p_version_id AND da."slotKey"='direct_signed_originals_v1'
    ORDER BY da."displayOrder" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS row_count_now=ROW_COUNT;
  IF row_count_now<>cardinality(p_file_ids) OR EXISTS (SELECT 1 FROM public."ContractDraftAttachment" da
    WHERE da."contractVersionId"=p_version_id AND da."slotKey"='direct_signed_originals_v1'
      AND da."createdByUserId" IS DISTINCT FROM p_actor) THEN
    RAISE EXCEPTION '当前专用槽原件或经办归属已变化' USING ERRCODE='23514';
  END IF;
  fixed_terms_id:=v."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}';
  IF fixed_terms_id IS NOT NULL THEN
    PERFORM t."id" FROM public."PaymentTermsVersion" t WHERE t."id"=fixed_terms_id
      AND t."contractId"=c."id" AND t."contractVersionId"=p_version_id AND t."status"='draft' FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION '固定付款约定来源已变化' USING ERRCODE='23514'; END IF;
  END IF;
  current_input:=public.jg_contract_direct_pending_input_v1(p_version_id);
  q:=current_input->'Q';
  manifest:=q->'signedFiles';
  IF current_input->>'state' IS DISTINCT FROM 'complete' OR current_input->'sourceRevision' IS DISTINCT FROM to_jsonb(p_revision)
    OR current_input->>'inputSha256' IS DISTINCT FROM p_input_sha256 OR jsonb_typeof(manifest) IS DISTINCT FROM 'array'
    OR encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_input_sha256
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',p."id",'contractId',c."id",'contractVersionId',v."id",
      'versionNo',1,'changeType','original','draftRevision',p_revision) THEN
    RAISE EXCEPTION '实际待登记来源已经变化，请刷新核对' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(item->>'fileId' ORDER BY position) INTO observed_file_ids
    FROM jsonb_array_elements(manifest) WITH ORDINALITY AS originals(item,position);
  IF observed_file_ids IS DISTINCT FROM p_file_ids THEN RAISE EXCEPTION '签章原件顺序已变化' USING ERRCODE='23514'; END IF;
  terms:=q#>'{terms,paymentTerms}';
  IF (fixed_terms_id IS NULL AND terms IS DISTINCT FROM 'null'::jsonb)
    OR (fixed_terms_id IS NOT NULL AND (jsonb_typeof(terms) IS DISTINCT FROM 'object'
      OR terms->>'id' IS DISTINCT FROM fixed_terms_id)) THEN
    RAISE EXCEPTION '固定付款约定来源与真实草稿不一致' USING ERRCODE='23514';
  END IF;

  archived_at:=(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
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
  IF profile IS DISTINCT FROM public.jg_assert_contract_direct_archive_write_profile_v1() THEN
    RAISE EXCEPTION '直签登记写入资格在同事务内已变化' USING ERRCODE='55000';
  END IF;

  archive_id:=public.gen_random_uuid()::text;
  archived_at_text:=to_char(archived_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  business_day:=to_char((archived_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD');
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(c."id",v."id",p_actor,p_key,p_revision,p_input_sha256,p_file_ids);
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',jsonb_build_object('Q',q,'inputSha256',p_input_sha256),
    'fileManifest',manifest,'businessTime',jsonb_build_object('archivedAt',archived_at_text,'businessDay',business_day,'handlerUserId',p_actor),
    'reviewScope',jsonb_build_object('excludedAmountYuan','0.0000','sources','[]'::jsonb));
  basis_sha:=encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex');
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed','projectId',p."id",'contractId',c."id",
    'contractVersionId',v."id",'handlerUserId',p_actor,'archivedAt',archived_at_text,'requestSha256',request_sha,'sourceRevision',p_revision,
    'sourceBasis',basis,'sourceBasisSha256',basis_sha,'fileManifest',manifest,'fileManifestSha256',manifest_sha,
    'operatingConsequence',jsonb_build_object('protocolVersion',1,'mode','not_applicable','operatingLedgerEffectiveDateSnapshot',NULL,'expectedSource',NULL));
  response:=jsonb_build_object('archiveId',archive_id,'contractVersionId',v."id",'status','effective','fileIds',to_jsonb(p_file_ids));

  -- The future exact parent guard must independently rederive the source before
  -- it permits this insert. The current 204 guard still rejects direct parents.
  INSERT INTO public."ContractArchiveFile"("id","contractVersionId","uploadedByUserId","confirmedByUserId","confirmedAt","status",
    "archiveProtocolVersion","archiveSource","idempotencyKey","requestSha256","sourceRevision",
    "authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot")
  VALUES (archive_id,v."id",p_actor,p_actor,archived_at,'confirmed',2,'direct_signed',p_key,request_sha,p_revision,
    authority,encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex'),manifest_sha,response);

  DELETE FROM public."ContractDraftAttachment" da USING unnest(p_file_ids) WITH ORDINALITY AS originals(id,position)
  WHERE da."contractVersionId"=v."id" AND da."slotKey"='direct_signed_originals_v1'
    AND da."fileId"=originals.id AND da."displayOrder"=originals.position-1 AND da."createdByUserId"=p_actor;
  GET DIAGNOSTICS row_count_now=ROW_COUNT;
  IF row_count_now<>cardinality(p_file_ids) THEN RAISE EXCEPTION '专用槽原件没有完整交接' USING ERRCODE='23514'; END IF;

  -- The unchanged 204 Evidence triggers now check every other file owner
  -- while the same global lock is held. A collision rolls the slot back.
  INSERT INTO public."ContractArchiveEvidenceFile"("id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256")
  SELECT public.gen_random_uuid()::text,archive_id,v."id",item->>'fileId',(position-1)::integer,item->>'mimeType',
    (item->>'sizeBytes')::integer,item->>'contentSha256'
  FROM jsonb_array_elements(manifest) WITH ORDINALITY AS originals(item,position) ORDER BY position;
  GET DIAGNOSTICS row_count_now=ROW_COUNT;
  IF row_count_now<>cardinality(p_file_ids) THEN RAISE EXCEPTION '归档原件没有完整交接' USING ERRCODE='23514'; END IF;

  IF fixed_terms_id IS NOT NULL THEN
    UPDATE public."PaymentTermsVersion" SET "status"='effective',"updatedAt"=archived_at
    WHERE "id"=fixed_terms_id AND "contractId"=c."id" AND "contractVersionId"=v."id" AND "status"='draft';
    IF NOT FOUND THEN RAISE EXCEPTION '固定付款约定未能生效' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE public."ContractVersion" SET "status"='effective',"effectiveAt"=archived_at,"taxFactsFrozenAt"=archived_at,"updatedAt"=archived_at
  WHERE "id"=v."id" AND "contractId"=c."id" AND "status"='draft' AND "draftRevision"=p_revision;
  IF NOT FOUND OR public.jg_contract_direct_archive_proof_v1(archive_id) IS NULL THEN
    RAISE EXCEPTION '签章归档与合同生效没有完整落实' USING ERRCODE='23514';
  END IF;

  INSERT INTO public."AuditLog"("id","actorUserId","action","businessType","businessId","metadata")
  VALUES (public.gen_random_uuid()::text,p_actor,'contract.archive.complete','contract_version',v."id",
    jsonb_build_object('archiveId',archive_id,'archiveSource','direct_signed','sourceRevision',p_revision,
      'inputSha256',p_input_sha256,'requestSha256',request_sha,'fileIds',to_jsonb(p_file_ids),'actingRoleKey',acting_role));
  IF profile IS DISTINCT FROM public.jg_assert_contract_direct_archive_write_profile_v1() THEN
    RAISE EXCEPTION '直签登记写入资格在完成前已变化' USING ERRCODE='55000';
  END IF;
  RETURN archive_id;
END;
$writer$;

REVOKE ALL ON FUNCTION public.jg_assert_contract_direct_archive_write_profile_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_write_contract_direct_archive_v1(TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT[],JSONB) FROM PUBLIC;
COMMIT;
