BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Detached source for the next exact post-install profile. No existing trigger
-- changes here. 204/205 and the 210 closed write profile still prohibit activation.
CREATE FUNCTION public.jg_require_contract_direct_archive_transition_profile_v1() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $transition_profile$
DECLARE witness JSONB;
BEGIN
  witness:=public.jg_assert_contract_direct_archive_write_profile_v1();
  IF current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR witness->>'bindingSha256' IS NULL OR witness->>'bindingSha256'!~'^[a-f0-9]{64}$'
    OR witness IS DISTINCT FROM jsonb_build_object(
      'profileProtocolVersion',1,'recipeVersion','contract-direct-archive-write-v1/1','bindingSha256',witness->>'bindingSha256',
      'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
      'sessionRoleOid',session_user::regrole::oid::text,'currentRoleOid',current_user::regrole::oid::text,
      'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text) THEN
    RAISE EXCEPTION '直签原件交接缺少同一事务写入资格' USING ERRCODE='55000';
  END IF;
  RETURN witness;
END;
$transition_profile$;

CREATE FUNCTION public.jg_guard_contract_direct_archive_version_transition_v1(
  p_old public."ContractVersion", p_new public."ContractVersion"
) RETURNS public."ContractVersion"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $version_transition_guard$
DECLARE
  witness JSONB; a RECORD; c RECORD;
  authority JSONB; basis JSONB; q JSONB; manifest JSONB; evidence JSONB; terms JSONB;
  input_sha TEXT; request_sha TEXT; manifest_sha TEXT; fixed_terms_id TEXT; file_ids TEXT[];
BEGIN
  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();
  IF p_old."status" IS DISTINCT FROM 'draft' OR p_new."status" IS DISTINCT FROM 'effective'
    OR p_old."effectiveAt" IS NOT NULL OR p_old."taxFactsFrozenAt" IS NOT NULL OR p_old."endedAt" IS NOT NULL
    OR p_old."firstSubmittedAt" IS NOT NULL OR p_old."documentContentFingerprint" IS NOT NULL
    OR p_old."versionNo" IS DISTINCT FROM 1 OR p_old."numericProtocolVersion" IS DISTINCT FROM 2
    OR p_old."changeType" IS DISTINCT FROM 'original' OR p_old."supersedesVersionId" IS NOT NULL
    OR p_old."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR p_old."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR p_old."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR p_old."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR p_old."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside'
    OR (to_jsonb(p_old)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) IS DISTINCT FROM
      (to_jsonb(p_new)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) THEN
    RAISE EXCEPTION '直签版本只允许在保留原资料时从草稿转为生效' USING ERRCODE='23514';
  END IF;

  -- The authoritative parent is inserted first under C/V/P/F locks. The 209
  -- deferred checks forbid a committed parent whose version is still a draft.
  SELECT "id","contractVersionId","confirmedAt","uploadedByUserId","confirmedByUserId","status","fileId",
    "idempotencyKey","requestSha256","sourceRevision","approvalInstanceId","sealTaskId",
    "documentContentRevision","documentContentFingerprint","authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot"
  INTO a FROM public."ContractArchiveFile"
  WHERE "contractVersionId"=p_old."id" AND "archiveProtocolVersion"=2 AND "archiveSource"='direct_signed';
  IF NOT FOUND OR a."confirmedAt" IS NULL OR a."status" IS DISTINCT FROM 'confirmed' OR a."fileId" IS NOT NULL
    OR a."approvalInstanceId" IS NOT NULL OR a."sealTaskId" IS NOT NULL
    OR a."documentContentRevision" IS NOT NULL OR a."documentContentFingerprint" IS NOT NULL
    OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId" OR a."sourceRevision" IS DISTINCT FROM p_old."draftRevision"
    OR p_new."effectiveAt" IS DISTINCT FROM a."confirmedAt" OR p_new."taxFactsFrozenAt" IS DISTINCT FROM a."confirmedAt"
    OR p_new."updatedAt" IS DISTINCT FROM a."confirmedAt" THEN
    RAISE EXCEPTION '直签版本生效须对应真实归档父记录及同一冻结时刻' USING ERRCODE='23514';
  END IF;
  SELECT c0."id",c0."projectId",c0."ownerUserId",c0."voidedAt",p."isActive",p."operatingLedgerEffectiveDate"
  INTO c FROM public."Contract" c0 JOIN public."Project" p ON p."id"=c0."projectId"
  WHERE c0."id"=p_old."contractId";
  IF NOT FOUND OR c."voidedAt" IS NOT NULL OR c."ownerUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR c."isActive" IS DISTINCT FROM TRUE OR c."operatingLedgerEffectiveDate" IS NOT NULL THEN
    RAISE EXCEPTION '当前合同或项目不可直接生效' USING ERRCODE='23514';
  END IF;

  authority:=a."authoritySnapshot";
  basis:=authority->'sourceBasis';
  q:=basis#>'{directInput,Q}';
  manifest:=authority->'fileManifest';
  input_sha:=basis#>>'{directInput,inputSha256}';
  IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR q->'inputProtocolVersion' IS DISTINCT FROM '1'::jsonb
    OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"outside"}'::jsonb
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',c."projectId",'contractId',c."id",'contractVersionId',p_old."id",
      'versionNo',1,'changeType','original','draftRevision',p_old."draftRevision")
    OR q#>'{contract,originalSignedNumber}' IS DISTINCT FROM COALESCE(to_jsonb(p_old."originalSignedNumber"),'null'::jsonb)
    OR q#>'{contract,signedOn}' IS DISTINCT FROM p_old."draftData"#>'{directSigningInput,signedOn}'
    OR p_old."affiliateAssignmentId" IS NULL OR q#>>'{subjects,enterprise,assignmentId}' IS DISTINCT FROM p_old."affiliateAssignmentId"
    OR p_old."affiliateBusinessPartyVersionId" IS NULL
    OR q#>>'{subjects,enterprise,businessPartyVersionId}' IS DISTINCT FROM p_old."affiliateBusinessPartyVersionId"
    OR input_sha IS NULL OR input_sha IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex')
    OR jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR manifest IS DISTINCT FROM q->'signedFiles'
    OR basis IS DISTINCT FROM jsonb_build_object(
      'basisProtocolVersion',1,'directInput',jsonb_build_object('Q',q,'inputSha256',input_sha),'fileManifest',manifest,
      'businessTime',jsonb_build_object('archivedAt',to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'businessDay',to_char((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),'handlerUserId',a."uploadedByUserId"),
      'reviewScope',jsonb_build_object('excludedAmountYuan','0.0000','sources','[]'::jsonb)) THEN
    RAISE EXCEPTION '直签版本与归档冻结资料不一致' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(manifest) NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM public."ContractDraftAttachment" da WHERE da."contractVersionId"=p_old."id" AND da."slotKey"='direct_signed_originals_v1') THEN
    RAISE EXCEPTION '签章原件专用槽没有完整交接' USING ERRCODE='23514';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",
    'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder"),
    array_agg(e."fileId" ORDER BY e."displayOrder")
  INTO evidence,file_ids FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id" AND e."contractVersionId"=p_old."id";
  IF evidence IS DISTINCT FROM manifest OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(manifest) WITH ORDINALITY AS m(item,position)
    WHERE m.item->>'displayOrder' IS DISTINCT FROM (m.position-1)::text OR m.item->>'fileId' IS NULL
      OR m.item->>'fileId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) OR EXISTS (
    SELECT 1 FROM public."ContractArchiveEvidenceFile" e LEFT JOIN public."FileObject" f ON f."id"=e."fileId"
    WHERE e."archiveFileId"=a."id" AND (e."contractVersionId" IS DISTINCT FROM p_old."id" OR f."id" IS NULL
      OR f."uploadedByUserId" IS DISTINCT FROM a."uploadedByUserId" OR f."storageStatus" IS DISTINCT FROM 'active'
      OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
      OR f."mimeType" IS DISTINCT FROM e."mimeType" OR f."sizeBytes" IS DISTINCT FROM e."sizeBytes"
      OR f."contentSha256" IS DISTINCT FROM e."contentSha256"
      OR EXISTS(SELECT 1 FROM public."FileObject" alias WHERE alias."id"<>f."id"
        AND (alias."objectKey"=f."objectKey" OR alias."supersedesFileObjectId"=f."id")))
  ) THEN RAISE EXCEPTION '直签版本缺少按序交接的完整归档原件' USING ERRCODE='23514'; END IF;

  request_sha:=public.jg_contract_direct_archive_request_sha_v1(c."id",p_old."id",a."uploadedByUserId",a."idempotencyKey",a."sourceRevision",input_sha,file_ids);
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  IF request_sha IS NULL OR a."requestSha256" IS DISTINCT FROM request_sha OR a."fileManifestSha256" IS DISTINCT FROM manifest_sha
    OR authority IS DISTINCT FROM jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed',
      'projectId',c."projectId",'contractId',c."id",'contractVersionId',p_old."id",'handlerUserId',a."uploadedByUserId",
      'archivedAt',to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'requestSha256',request_sha,'sourceRevision',a."sourceRevision",
      'sourceBasis',basis,'sourceBasisSha256',encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),
      'fileManifest',manifest,'fileManifestSha256',manifest_sha,'operatingConsequence',jsonb_build_object(
        'protocolVersion',1,'mode','not_applicable','operatingLedgerEffectiveDateSnapshot',NULL,'expectedSource',NULL))
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR a."responseSnapshot" IS DISTINCT FROM jsonb_build_object('archiveId',a."id",'contractVersionId',p_old."id",
      'status','effective','fileIds',to_jsonb(file_ids)) THEN
    RAISE EXCEPTION '直签版本与归档原请求证明不一致' USING ERRCODE='23514';
  END IF;

  fixed_terms_id:=p_old."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}';
  terms:=q#>'{terms,paymentTerms}';
  IF (fixed_terms_id IS NULL AND terms IS DISTINCT FROM 'null'::jsonb)
    OR (fixed_terms_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."PaymentTermsVersion" t
      WHERE t."id"=fixed_terms_id AND t."contractId"=c."id" AND t."contractVersionId"=p_old."id" AND t."status"='effective'
        AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText",'stages','[]'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM public."PaymentTermsStage" s WHERE s."paymentTermsVersionId"=t."id"))) THEN
    RAISE EXCEPTION '固定付款约定未按冻结资料生效' USING ERRCODE='23514';
  END IF;
  IF witness IS DISTINCT FROM public.jg_require_contract_direct_archive_transition_profile_v1() THEN
    RAISE EXCEPTION '直签版本生效资格在同一事务内已变化' USING ERRCODE='55000';
  END IF;
  RETURN p_new;
END;
$version_transition_guard$;

CREATE FUNCTION public.jg_guard_contract_direct_archive_slot_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $archive_slot_guard$
DECLARE
  source_version TEXT; source_slot TEXT; contract_id TEXT; c RECORD; v RECORD; a RECORD;
  old_relevant BOOLEAN; new_relevant BOOLEAN; witness JSONB; match_count INTEGER;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ContractDraftAttachment' THEN
    RAISE EXCEPTION '直签原件槽守卫接线不正确' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    source_version:=NEW."contractVersionId"; source_slot:=NEW."slotKey";
  ELSIF TG_OP='DELETE' THEN
    source_version:=OLD."contractVersionId"; source_slot:=OLD."slotKey";
  ELSIF TG_OP='UPDATE' THEN
    IF OLD."contractVersionId" IS DISTINCT FROM NEW."contractVersionId" OR OLD."slotKey" IS DISTINCT FROM NEW."slotKey" THEN
      old_relevant:=OLD."slotKey"='direct_signed_originals_v1' OR EXISTS (
        SELECT 1 FROM public."ContractVersion" o WHERE o."id"=OLD."contractVersionId" AND o."draftData"?'directSigningInput');
      new_relevant:=NEW."slotKey"='direct_signed_originals_v1' OR EXISTS (
        SELECT 1 FROM public."ContractVersion" n WHERE n."id"=NEW."contractVersionId" AND n."draftData"?'directSigningInput');
      IF old_relevant OR new_relevant THEN RAISE EXCEPTION '签章原件不能迁往其他合同版本或槽位' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    source_version:=OLD."contractVersionId"; source_slot:=OLD."slotKey";
  ELSE
    RAISE EXCEPTION '直签原件槽守卫操作不正确' USING ERRCODE='23514';
  END IF;
  SELECT "contractId" INTO contract_id FROM public."ContractVersion" WHERE "id"=source_version
    AND ("draftData"?'directSigningInput' OR source_slot='direct_signed_originals_v1');
  IF NOT FOUND THEN
    IF source_slot='direct_signed_originals_v1' THEN RAISE EXCEPTION '签章原件槽缺少真实来源' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- A raw slot statement can already hold a slot-row lock. Never wait in the
  -- reverse direction for C or V while a real archive writer may hold them.
  SELECT "id","ownerUserId","voidedAt" INTO c FROM public."Contract" WHERE "id"=contract_id FOR UPDATE NOWAIT;
  SELECT "id","contractId","status","numericProtocolVersion","versionNo","changeType","draftRevision","draftData","effectiveAt","firstSubmittedAt","endedAt"
  INTO v FROM public."ContractVersion" WHERE "id"=source_version FOR UPDATE NOWAIT;
  IF c."id" IS NULL OR v."id" IS NULL OR v."contractId" IS DISTINCT FROM c."id" OR c."voidedAt" IS NOT NULL
    OR source_slot IS DISTINCT FROM 'direct_signed_originals_v1' OR v."status" IS DISTINCT FROM 'draft'
    OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."versionNo" IS DISTINCT FROM 1 OR v."changeType" IS DISTINCT FROM 'original'
    OR v."effectiveAt" IS NOT NULL OR v."firstSubmittedAt" IS NOT NULL OR v."endedAt" IS NOT NULL
    OR v."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR v."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside' THEN
    RAISE EXCEPTION '已结束或已登记的签章原件槽不可增删改' USING ERRCODE='23514';
  END IF;

  SELECT "id","archiveProtocolVersion","archiveSource","status","sourceRevision","uploadedByUserId",
    "confirmedByUserId","authoritySnapshot","authoritySha256","fileManifestSha256"
  INTO a FROM public."ContractArchiveFile" WHERE "contractVersionId"=v."id";
  IF NOT FOUND THEN
    -- An ordinary direct draft save still goes through the existing 205 guards.
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP<>'DELETE' THEN RAISE EXCEPTION '归档开始后不能新增、移动或更换签章原件' USING ERRCODE='23514'; END IF;
  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();
  IF a."archiveProtocolVersion" IS DISTINCT FROM 2 OR a."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR a."status" IS DISTINCT FROM 'confirmed' OR a."sourceRevision" IS DISTINCT FROM v."draftRevision"
    OR a."uploadedByUserId" IS DISTINCT FROM c."ownerUserId" OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR OLD."createdByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR a."authoritySnapshot"->>'contractVersionId' IS DISTINCT FROM v."id"
    OR jsonb_typeof(a."authoritySnapshot"->'fileManifest') IS DISTINCT FROM 'array'
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    OR a."fileManifestSha256" IS DISTINCT FROM encode(public.digest(convert_to((a."authoritySnapshot"->'fileManifest')::text,'UTF8'),'sha256'),'hex')
    OR EXISTS (SELECT 1 FROM public."ContractArchiveFile" other_parent
      WHERE other_parent."contractVersionId"=v."id" AND other_parent."id"<>a."id")
    OR EXISTS (SELECT 1 FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id") THEN
    RAISE EXCEPTION '签章原件只能从当前草稿交接到匹配归档' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer INTO match_count
  FROM jsonb_array_elements(a."authoritySnapshot"->'fileManifest') WITH ORDINALITY AS frozen(item,position)
  WHERE frozen.item->>'fileId'=OLD."fileId" AND frozen.item->'displayOrder'=to_jsonb(OLD."displayOrder")
    AND frozen.position-1=OLD."displayOrder";
  IF match_count<>1 THEN RAISE EXCEPTION '拟移交原件不在归档的冻结位置' USING ERRCODE='23514'; END IF;
  IF witness IS DISTINCT FROM public.jg_require_contract_direct_archive_transition_profile_v1() THEN
    RAISE EXCEPTION '签章原件移交资格在同一事务内已变化' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$archive_slot_guard$;

REVOKE ALL ON FUNCTION public.jg_require_contract_direct_archive_transition_profile_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion") FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_slot_v1() FROM PUBLIC;
COMMIT;
