-- Private issue/claim for enabled-ledger outside direct signing.
-- A successor may route the already-installed V1 channel roles to these invoker
-- routines after its writer and exact catalog proof are installed.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

DO $predecessors$
BEGIN
  IF 3<>(SELECT count(*) FROM (VALUES
    ('public.jg_check_contract_direct_archive_intent_roles_v1(boolean)','19afa3783a3a18126af58e7e61633367ec6d745eb602e88cbe36d7c7a790cde9','pg_catalog.text',TRUE,FALSE,'v'),
    ('public.jg_contract_direct_archive_native_channel_v1()','21d5cf73c09bd4b46d1a953980efde6e18f53430c5c203695856ee15c867ad9a','pg_catalog.uuid',FALSE,TRUE,'v'),
    ('public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)','3a03e57f244af59d7ad8f1c7af5fa5d04436c1132e0260b0d7cad585aa36603d','pg_catalog.jsonb',TRUE,FALSE,'s')
  ) expected(signature,body_sha,result_type,is_strict,is_definer,volatility)
  JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
    AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=current_user::regrole::oid
    AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(expected.result_type)
    AND p.prosecdef=expected.is_definer AND NOT p.proretset AND p.proisstrict=expected.is_strict
    AND p.provolatile::text=expected.volatility AND p.proparallel='u'
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.pronargdefaults=0 AND p.provariadic=0
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql') THEN
    RAISE EXCEPTION '表外直签经营签发的来源目录不匹配' USING ERRCODE='55000';
  END IF;
END;
$predecessors$;

CREATE TABLE public.jg_contract_direct_outside_operating_receipt_v2 (
  "intentId" UUID PRIMARY KEY,
  "bindingSha256" TEXT NOT NULL CHECK ("bindingSha256"~'^[a-f0-9]{64}$'),
  "payloadSha256" TEXT NOT NULL CHECK ("payloadSha256"~'^[a-f0-9]{64}$'),
  "issuedAt" TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite("issuedAt")),
  "expiresAt" TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite("expiresAt") AND "expiresAt"="issuedAt"+interval '2 minutes')
);

CREATE TABLE public.jg_contract_direct_outside_operating_use_v2 (
  "intentId" UUID PRIMARY KEY REFERENCES public.jg_contract_direct_outside_operating_receipt_v2("intentId") ON DELETE RESTRICT,
  "archiveId" TEXT NOT NULL UNIQUE REFERENCES public."ContractArchiveFile"("id") DEFERRABLE INITIALLY DEFERRED,
  "contractVersionId" TEXT NOT NULL UNIQUE REFERENCES public."ContractVersion"("id") ON DELETE RESTRICT,
  "requestKey" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload")='object'),
  "databaseOid" OID NOT NULL,
  "runtimeSessionOid" OID NOT NULL,
  "executorOwnerOid" OID NOT NULL CHECK ("executorOwnerOid"<>"runtimeSessionOid"),
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "claimedAt" TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite("claimedAt")),
  UNIQUE ("databaseOid","backendPid","transactionId")
);
REVOKE ALL ON TABLE public.jg_contract_direct_outside_operating_receipt_v2,
  public.jg_contract_direct_outside_operating_use_v2 FROM PUBLIC;

CREATE FUNCTION public.jg_direct_outside_operating_channel_v2(p_issue BOOLEAN,p_nonce UUID) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $channel$
DECLARE binding_sha TEXT;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(p_issue);
  IF public.jg_contract_direct_archive_native_channel_v1() IS DISTINCT FROM p_nonce
    OR pg_catalog.current_setting('transaction_isolation')<>'read committed'
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."ApprovalInstance"'::regclass,'public."ContractSealTask"'::regclass,'public."ContractArchiveFile"'::regclass,
      'public."ContractArchiveEvidenceFile"'::regclass,'public."ContractDraftAttachment"'::regclass,
      'public."ProjectAffiliateAssignment"'::regclass,'public."ContractEconomicReview"'::regclass,
      'public."ContractPartySnapshot"'::regclass,'public."BusinessPartyVersion"'::regclass,
      'public."PaymentTermsVersion"'::regclass,'public."PaymentTermsStage"'::regclass,
      'public."OperatingFact"'::regclass,'public."OperatingImpactEntry"'::regclass,'public."AuditLog"'::regclass,
      'public.jg_contract_direct_outside_operating_receipt_v2'::regclass,'public.jg_contract_direct_outside_operating_use_v2'::regclass)
      AND (c.relkind<>'r' OR c.relpersistence<>'p' OR c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION '表外直签经营通道与当前环境不匹配' USING ERRCODE='42501';
  END IF;
  RETURN binding_sha;
END;
$channel$;

CREATE FUNCTION public.jg_guard_direct_outside_operating_intent_v2() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $guard$
DECLARE receipt public.jg_contract_direct_outside_operating_receipt_v2%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '表外直签经营凭据只能追加' USING ERRCODE='23514';
  END IF;
  IF TG_RELID='public.jg_contract_direct_outside_operating_receipt_v2'::regclass THEN
    IF NEW."bindingSha256" IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(TRUE)
      OR NEW."issuedAt">pg_catalog.clock_timestamp() OR NEW."expiresAt"<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION '表外直签发行缺少有效身份和时间' USING ERRCODE='42501';
    END IF;
  ELSIF TG_RELID='public.jg_contract_direct_outside_operating_use_v2'::regclass THEN
    SELECT * INTO receipt FROM public.jg_contract_direct_outside_operating_receipt_v2 r WHERE r."intentId"=NEW."intentId";
    IF NOT FOUND OR receipt."bindingSha256" IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
      OR NEW."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
      OR NEW."runtimeSessionOid" IS DISTINCT FROM session_user::regrole::oid
      OR NEW."executorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
      OR NEW."backendPid" IS DISTINCT FROM pg_catalog.pg_backend_pid()
      OR NEW."transactionId" IS DISTINCT FROM pg_catalog.txid_current()
      OR NEW."claimedAt"<receipt."issuedAt" OR NEW."claimedAt">pg_catalog.clock_timestamp()
      OR pg_catalog.clock_timestamp()>=receipt."expiresAt"
      OR NEW."payload"->'protocolVersion' IS DISTINCT FROM '2'::jsonb
      OR NEW."payload"->>'archiveSource' IS DISTINCT FROM 'direct_signed'
      OR NEW."payload"->>'relationship' IS DISTINCT FROM 'outside'
      OR NEW."payload"#>>'{operatingConsequence,mode}' IS DISTINCT FROM 'projection_required'
      OR NEW."payload"->>'contractVersionId' IS DISTINCT FROM NEW."contractVersionId"
      OR NEW."payload"->>'requestKey' IS DISTINCT FROM NEW."requestKey"
      OR receipt."payloadSha256" IS DISTINCT FROM encode(public.digest(convert_to(NEW."payload"::text,'UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION '表外直签领取缺少当前有效原请求和事务' USING ERRCODE='55000';
    END IF;
  ELSE
    RAISE EXCEPTION '表外直签经营凭据接线不匹配' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER jg_direct_outside_operating_receipt_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_outside_operating_receipt_v2
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_direct_outside_operating_intent_v2();
CREATE TRIGGER jg_direct_outside_operating_receipt_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_outside_operating_receipt_v2
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_direct_outside_operating_intent_v2();
CREATE TRIGGER jg_direct_outside_operating_use_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_outside_operating_use_v2
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_direct_outside_operating_intent_v2();
CREATE TRIGGER jg_direct_outside_operating_use_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_outside_operating_use_v2
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_direct_outside_operating_intent_v2();

CREATE FUNCTION public.jg_issue_contract_direct_outside_operating_intent_v2(
  p_nonce UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS UUID
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $issue$
DECLARE binding_sha TEXT; payload JSONB; issued_at TIMESTAMPTZ; intent_id UUID;
BEGIN
  binding_sha:=public.jg_direct_outside_operating_channel_v2(TRUE,p_nonce);
  payload:=public.jg_contract_direct_archive_outside_operating_basis_v2(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF payload IS NULL THEN
    RAISE EXCEPTION '表外直签经营发行缺少真实来源' USING ERRCODE='23514';
  END IF;
  issued_at:=pg_catalog.clock_timestamp();
  intent_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.jg_contract_direct_outside_operating_receipt_v2("intentId","bindingSha256","payloadSha256","issuedAt","expiresAt")
    VALUES(intent_id,binding_sha,encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),issued_at,issued_at+interval '2 minutes');
  RETURN intent_id;
END;
$issue$;

CREATE FUNCTION public.jg_claim_contract_direct_outside_operating_intent_v2(
  p_nonce UUID,p_intent UUID,p_archive UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $claim$
DECLARE
  binding_sha TEXT;
  receipt public.jg_contract_direct_outside_operating_receipt_v2%ROWTYPE;
  payload JSONB;
  file_ids TEXT[];
  file_count INTEGER;
  physical_key TEXT;
  claimed_at TIMESTAMPTZ;
BEGIN
  binding_sha:=public.jg_direct_outside_operating_channel_v2(FALSE,p_nonce);
  SELECT * INTO receipt FROM public.jg_contract_direct_outside_operating_receipt_v2 r WHERE r."intentId"=p_intent;
  IF NOT FOUND OR receipt."bindingSha256" IS DISTINCT FROM binding_sha
    OR pg_catalog.clock_timestamp()>=receipt."expiresAt"
    OR p_archive::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '表外直签凭据已过期或未绑定当前执行通道' USING ERRCODE='55000';
  END IF;
  -- NOWAIT avoids blocking behind another path that already holds a later lock.
  PERFORM c."id" FROM public."Contract" c WHERE c."id"=p_contract AND c."projectId"=p_project
    AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION '当前经办人无权登记本合同' USING ERRCODE='42501'; END IF;
  PERFORM v."id" FROM public."ContractVersion" v WHERE v."id"=p_version AND v."contractId"=p_contract
    AND v."status"='draft' AND v."draftRevision"=p_revision AND v."signingSubjectType"='affiliate' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION '表外已签草稿资料已变化' USING ERRCODE='23514'; END IF;
  PERFORM p."id" FROM public."Project" p WHERE p."id"=p_project AND p."isActive"
    AND p."operatingLedgerEffectiveDate" IS NOT NULL FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION '项目当前不能办理经营账表外直签' USING ERRCODE='23514'; END IF;
  PERFORM a."id" FROM public."ProjectAffiliateAssignment" a WHERE a."projectId"=p_project
    AND a."id"=(SELECT v."affiliateAssignmentId" FROM public."ContractVersion" v WHERE v."id"=p_version) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION '当前施工企业派驻已变化' USING ERRCODE='23514'; END IF;

  PERFORM public.jg_contract_direct_archive_intent_payload_v1(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) AS original(item)
    WHERE (item->>'objectGeneration') COLLATE "C" !~ '^[!-~]+$' OR position(',' IN item->>'objectGeneration')>0) THEN
    RAISE EXCEPTION '表外直签原件存储版本不完整' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(item->>'fileId' ORDER BY position) INTO file_ids
    FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS original(item,position);
  PERFORM f."id" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS file_count=ROW_COUNT;
  IF file_count<>cardinality(file_ids) THEN RAISE EXCEPTION '表外直签原件不完整' USING ERRCODE='23514'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION '文件绑定正在办理，请先查询原请求' USING ERRCODE='55P03';
  END IF;
  FOR physical_key IN SELECT f."objectKey" FROM public."FileObject" f
    WHERE f."id"=ANY(file_ids) ORDER BY f."objectKey" COLLATE "C" LOOP
    IF physical_key IS NULL OR physical_key='' OR
      NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('jg:contract-direct-review-object-key-v1:'||physical_key,0)) THEN
      RAISE EXCEPTION '签章原件身份正在变化，请先查询原请求' USING ERRCODE='55P03';
    END IF;
  END LOOP;

  payload:=public.jg_contract_direct_archive_outside_operating_basis_v2(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  claimed_at:=pg_catalog.clock_timestamp();
  IF payload IS NULL OR receipt."payloadSha256" IS DISTINCT FROM encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')
    OR claimed_at<receipt."issuedAt" OR claimed_at>=receipt."expiresAt" THEN
    RAISE EXCEPTION '表外直签经营原请求或有效时间已变化' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.jg_contract_direct_outside_operating_use_v2
    ("intentId","archiveId","contractVersionId","requestKey","payload","databaseOid","runtimeSessionOid","executorOwnerOid",
      "backendPid","transactionId","claimedAt")
  VALUES(p_intent,p_archive::text,p_version,p_key,payload,(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
    session_user::regrole::oid,current_user::regrole::oid,pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),claimed_at)
  ON CONFLICT ("intentId") DO NOTHING;
  GET DIAGNOSTICS file_count=ROW_COUNT;
  IF file_count<>1 OR pg_catalog.clock_timestamp()>=receipt."expiresAt"
    OR public.jg_direct_outside_operating_channel_v2(FALSE,p_nonce) IS DISTINCT FROM binding_sha THEN
    RAISE EXCEPTION '表外直签凭据已领取、过期或通道已变化' USING ERRCODE='55000';
  END IF;
  RETURN payload;
END;
$claim$;

CREATE FUNCTION public.jg_require_direct_outside_operating_completion_v2() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $complete$
DECLARE
  receipt public.jg_contract_direct_outside_operating_receipt_v2%ROWTYPE;
  archive public."ContractArchiveFile"%ROWTYPE;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
  original JSONB:=NEW."payload";
  consequence JSONB:=original->'operatingConsequence';
  source JSONB:=consequence->'expectedSource';
  evidence JSONB;
  manifest JSONB;
  file_ids JSONB;
  archived_at TEXT;
  basis JSONB;
  manifest_sha TEXT;
  authority JSONB;
  project_id TEXT:=original->>'projectId';
  actor TEXT:=original->>'actor';
BEGIN
  SELECT * INTO receipt FROM public.jg_contract_direct_outside_operating_receipt_v2 r WHERE r."intentId"=NEW."intentId";
  IF TG_RELID IS DISTINCT FROM 'public.jg_contract_direct_outside_operating_use_v2'::regclass OR TG_OP<>'INSERT'
    OR NOT FOUND OR receipt."bindingSha256" IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    OR NEW."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR NEW."runtimeSessionOid" IS DISTINCT FROM session_user::regrole::oid OR NEW."executorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
    OR NEW."backendPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR NEW."transactionId" IS DISTINCT FROM pg_catalog.txid_current() THEN
    RAISE EXCEPTION '表外直签经营完成缺少同事务领取凭据' USING ERRCODE='55000';
  END IF;
  SELECT archive_row.* INTO STRICT archive FROM public."ContractArchiveFile" archive_row
    WHERE archive_row."id"=NEW."archiveId" AND archive_row.xmin::text=xid;
  IF archive."contractVersionId" IS DISTINCT FROM NEW."contractVersionId"
    OR archive."idempotencyKey" IS DISTINCT FROM NEW."requestKey"
    OR archive."requestSha256" IS DISTINCT FROM original->>'requestSha256'
    OR archive."sourceRevision" IS DISTINCT FROM (original->>'sourceRevision')::integer
    OR archive."archiveProtocolVersion" IS DISTINCT FROM 2 OR archive."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR archive."status" IS DISTINCT FROM 'confirmed' OR archive."fileId" IS NOT NULL
    OR archive."uploadedByUserId" IS DISTINCT FROM actor OR archive."confirmedByUserId" IS DISTINCT FROM actor
    OR archive."confirmedAt" IS NULL OR NOT pg_catalog.isfinite(archive."confirmedAt")
    OR archive."confirmedAt"<(NEW."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    OR archive."confirmedAt">(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    OR archive."approvalInstanceId" IS NOT NULL OR archive."sealTaskId" IS NOT NULL
    OR archive."documentContentRevision" IS NOT NULL OR archive."documentContentFingerprint" IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
      JOIN public."Project" p ON p."id"=c."projectId"
      WHERE v."id"=archive."contractVersionId" AND v.xmin::text=xid AND c."id"=original->>'contractId'
        AND c."ownerUserId"=actor AND c."voidedAt" IS NULL AND p."id"=project_id AND p."isActive"
        AND to_jsonb(p."operatingLedgerEffectiveDate")=consequence->'operatingLedgerEffectiveDateSnapshot'
        AND v."status"='effective' AND v."signingSubjectType"='affiliate' AND v."draftRevision"=archive."sourceRevision"
        AND v."versionNo"=1 AND v."changeType"='original' AND v."numericProtocolVersion"=2 AND v."supersedesVersionId" IS NULL
        AND v."firstSubmittedAt" IS NULL AND v."effectiveAt"=archive."confirmedAt" AND v."taxFactsFrozenAt"=archive."confirmedAt"
        AND v."draftData"#>>'{directSigningInput,source}'='direct_signed' AND v."draftData"#>>'{directSigningInput,relationship}'='outside') THEN
    RAISE EXCEPTION '表外直签原请求、归档和生效必须一起提交' USING ERRCODE='23514';
  END IF;

  SELECT jsonb_agg(item ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position),
    jsonb_agg(item->'fileId' ORDER BY position) INTO evidence,manifest,file_ids
  FROM jsonb_array_elements(original->'orderedEvidence') WITH ORDINALITY AS original_file(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=archive."id" AND e."contractVersionId"=NEW."contractVersionId"
    AND e."fileId"=item->>'fileId' AND e."displayOrder"=position-1 AND e.xmin::text=xid
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."uploadedByUserId"=actor AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
  WHERE e."mimeType"=item->>'mimeType' AND f."mimeType"=e."mimeType" AND to_jsonb(e."sizeBytes")=item->'sizeBytes'
    AND f."sizeBytes"=e."sizeBytes" AND e."contentSha256"=item->>'contentSha256' AND f."contentSha256"=e."contentSha256"
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."supersedesFileObjectId"=e."fileId");
  IF evidence IS DISTINCT FROM original->'orderedEvidence'
    OR (SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=archive."id")<>jsonb_array_length(evidence)
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" a WHERE a."contractVersionId"=NEW."contractVersionId"
      AND a."slotKey"='direct_signed_originals_v1')
    OR EXISTS(SELECT 1 FROM public."ApprovalInstance" a WHERE a."businessType"='contract_version' AND a."businessId"=NEW."contractVersionId")
    OR EXISTS(SELECT 1 FROM public."ContractSealTask" s WHERE s."contractVersionId"=NEW."contractVersionId") THEN
    RAISE EXCEPTION '表外直签归档原件未完整交接或错误进入审批' USING ERRCODE='23514';
  END IF;

  archived_at:=to_char(archive."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',original->'directInput',
    'fileManifest',manifest,'businessTime',jsonb_build_object('archivedAt',archived_at,'handlerUserId',actor,
      'businessDay',to_char((archive."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')),
    'reviewScope',consequence->'reviewScope','intentPayloadSha256',receipt."payloadSha256");
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed',
    'projectId',project_id,'contractId',original->>'contractId','contractVersionId',NEW."contractVersionId",
    'handlerUserId',actor,'archivedAt',archived_at,'requestSha256',archive."requestSha256",'sourceRevision',archive."sourceRevision",
    'sourceBasis',basis,'sourceBasisSha256',encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'operatingConsequence',consequence);
  IF archive."authoritySnapshot" IS DISTINCT FROM authority
    OR archive."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR archive."fileManifestSha256" IS DISTINCT FROM manifest_sha
    OR archive."responseSnapshot" IS DISTINCT FROM jsonb_build_object('archiveId',archive."id",
      'contractVersionId',NEW."contractVersionId",'status','effective','fileIds',file_ids) THEN
    RAISE EXCEPTION '表外直签归档权威和原标识回执不完整' USING ERRCODE='23514';
  END IF;

  IF 1<>(SELECT count(*) FROM public."OperatingFact" fact
      WHERE fact."sourceType"='contract_version' AND fact."sourceBusinessId"=NEW."contractVersionId")
    OR 1<>(SELECT count(*) FROM public."OperatingFact" f JOIN public."OperatingImpactEntry" i ON i."factId"=f."id"
    WHERE f.xmin::text=xid AND i.xmin::text=xid AND f."projectId"=project_id AND i."projectId"=project_id
      AND f."sourceType"='contract_version' AND f."sourceBusinessId"=NEW."contractVersionId"
      AND i."sourceType"=f."sourceType" AND i."sourceBusinessId"=f."sourceBusinessId"
      AND f."sourceBusinessCode"=source->>'sourceBusinessCode' AND f."sourceVersion"=(source->>'sourceVersion')::int
      AND f."status"='confirmed' AND f."entryKind"='original' AND f."factKind"='downstream_contract'
      AND f."operatingLevel"='project' AND f."evidenceLevel"='A' AND f."currencyCode"='CNY' AND f."direction"='neutral'
      AND f."idempotencyKey"=source->>'factIdempotencyKey' AND i."idempotencyKey"=source->>'impactIdempotencyKey'
      AND i."sourceImpactKey"='contract_commitment_reference' AND i."impactKind"='contract_commitment_reference'
      AND f."amountCents" IS NULL AND i."amountCents" IS NULL AND f."numericProtocolVersion"=2 AND i."numericProtocolVersion"=2
      AND f."amountYuan" IS NOT DISTINCT FROM (source->>'amountYuan')::numeric
      AND i."amountYuan" IS NOT DISTINCT FROM f."amountYuan" AND i."direction"=source->>'direction'
      AND f."occurredAt"=archive."confirmedAt" AND f."confirmedAt"=archive."confirmedAt"
      AND f."confirmedByUserId"=actor AND f."recordedByUserId"=actor
      AND to_jsonb(f."operatingLedgerEffectiveDateSnapshot")=consequence->'operatingLedgerEffectiveDateSnapshot'
      AND f."isBeforeOperatingLedgerEffectiveDate"=(((archive."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date
        < f."operatingLedgerEffectiveDateSnapshot")
      AND f."affiliateAssignmentId"=consequence#>>'{debtor,assignmentId}'
      AND f."affiliateBusinessPartyVersionId"=consequence#>>'{debtor,id}'
      AND f."affiliateNameSnapshot"=consequence#>>'{debtor,name}'
      AND f."affiliateCreditCodeSnapshot" IS NOT DISTINCT FROM consequence#>>'{debtor,creditCode}'
      AND f."debtorSubjectKind"='construction_enterprise' AND f."debtorSubjectId"=consequence#>>'{debtor,id}'
      AND f."creditorSubjectKind"='downstream_counterparty' AND f."creditorSubjectId"=consequence#>>'{creditor,id}'
      AND i."subjectRole"='debtor' AND i."subjectKind"=f."debtorSubjectKind" AND i."subjectId"=f."debtorSubjectId"
      AND f."sourceSnapshot" @> jsonb_build_object('archiveAuthorityId',archive."id",
        'archiveAuthoritySha256',archive."authoritySha256",'archiveSource','direct_signed','intentPayloadSha256',receipt."payloadSha256")
      AND f."paymentExecutionId" IS NULL AND f."fundExecutionId" IS NULL AND f."fundExecutionCaseId" IS NULL
      AND f."historicalTakeoverBatchId" IS NULL AND f."adjustsFactId" IS NULL
      AND f."approvedPayerSubjectKind" IS NULL AND f."approvedPayerSubjectId" IS NULL
      AND f."actualPayerSubjectKind" IS NULL AND f."actualPayerSubjectId" IS NULL
      AND f."payeeSubjectKind" IS NULL AND f."payeeSubjectId" IS NULL
      AND f."costBearingCompanySubjectKind" IS NULL AND f."costBearingCompanySubjectId" IS NULL
      AND i."costCategoryCode" IS NULL AND i."fundPurpose" IS NULL AND i."paymentExecutionId" IS NULL
      AND i."fundExecutionId" IS NULL AND i."fundExecutionCaseId" IS NULL AND i."executionAllocationLineId" IS NULL
      AND 1=(SELECT count(*) FROM public."OperatingImpactEntry" other WHERE other."factId"=f."id"
        OR (other."sourceType"='contract_version' AND other."sourceBusinessId"=NEW."contractVersionId")))
    OR 1<>(SELECT count(*) FROM public."AuditLog" any_audit WHERE any_audit."businessType"='contract_version'
      AND any_audit."businessId"=NEW."contractVersionId" AND any_audit."action"='contract.archive.complete')
    OR 1<>(SELECT count(*) FROM public."AuditLog" audit WHERE audit.xmin::text=xid
      AND audit."businessType"='contract_version' AND audit."businessId"=NEW."contractVersionId"
      AND audit."actorUserId"=actor AND audit."action"='contract.archive.complete'
      AND audit."metadata" @> jsonb_build_object('archiveId',archive."id",'archiveSource','direct_signed',
        'requestSha256',archive."requestSha256",'intentPayloadSha256',receipt."payloadSha256")) THEN
    RAISE EXCEPTION '表外直签经营承诺和审计必须随归档一起提交' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$complete$;
CREATE CONSTRAINT TRIGGER jg_direct_outside_operating_completion
AFTER INSERT ON public.jg_contract_direct_outside_operating_use_v2 DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_direct_outside_operating_completion_v2();

REVOKE ALL ON FUNCTION public.jg_direct_outside_operating_channel_v2(BOOLEAN,UUID),
  public.jg_guard_direct_outside_operating_intent_v2(),
  public.jg_issue_contract_direct_outside_operating_intent_v2(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_claim_contract_direct_outside_operating_intent_v2(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_require_direct_outside_operating_completion_v2() FROM PUBLIC;

DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.jg_direct_outside_operating_channel_v2(boolean,uuid)'::regprocedure,
      'public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure,
      'public.jg_issue_contract_direct_outside_operating_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure,
      'public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure,
      'public.jg_require_direct_outside_operating_completion_v2()'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid IN ('public.jg_contract_direct_outside_operating_receipt_v2'::regclass,
        'public.jg_contract_direct_outside_operating_use_v2'::regclass)
        AND (a.grantee<>c.relowner OR a.grantor<>c.relowner)) THEN
    RAISE EXCEPTION '表外直签经营领取必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private_acl$;

COMMIT;
