-- Detached Q2 executor source. Existing 233/234 basis and issuer/receipt stay
-- byte exact. No roles, grants, ownership transfer or guard installation here.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE TABLE public.jg_contract_direct_upward_execution_binding_v2 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=2),
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "applicationRoleOid" OID NOT NULL,
  "runtimeSessionOid" OID NOT NULL,
  "issuerBindingOid" OID NOT NULL,
  "issuerBindingSha256" TEXT NOT NULL CHECK ("issuerBindingSha256"~'^[a-f0-9]{64}$'),
  "sourceClosureSha256" TEXT NOT NULL CHECK ("sourceClosureSha256"~'^[a-f0-9]{64}$')
);
CREATE TABLE public.jg_contract_direct_upward_use_v2 (
  "intentId" UUID PRIMARY KEY REFERENCES public.jg_contract_direct_upward_intent_receipt_v2("intentId") ON DELETE RESTRICT,
  "archiveId" TEXT NOT NULL UNIQUE,
  "backendPid" INTEGER NOT NULL CHECK ("backendPid">0),
  "transactionId" BIGINT NOT NULL CHECK ("transactionId">0),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload")='object'),
  "payloadSha256" TEXT NOT NULL CHECK ("payloadSha256"~'^[a-f0-9]{64}$')
);
REVOKE ALL ON TABLE public.jg_contract_direct_upward_execution_binding_v2,public.jg_contract_direct_upward_use_v2 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_upward_execution_v2() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $append$
BEGIN
  IF TG_OP<>'INSERT' OR TG_TABLE_SCHEMA<>'public'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=current_user::regrole::oid) THEN
    RAISE EXCEPTION '对上登记资格和已用原请求不可改写' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='jg_contract_direct_upward_execution_binding_v2' THEN
    IF current_user IS DISTINCT FROM session_user OR NEW."anchorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
      OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_execution_binding_v2) THEN
      RAISE EXCEPTION '对上执行资格只接受一次可信安装' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='jg_contract_direct_upward_use_v2' THEN
    IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_execution_binding_v2 b
      WHERE b."protocolVersion"=2 AND b."anchorOwnerOid"=current_user::regrole::oid
        AND b."runtimeSessionOid"=session_user::regrole::oid)
      OR NEW."backendPid" IS DISTINCT FROM pg_backend_pid() OR NEW."transactionId" IS DISTINCT FROM txid_current()
      OR NEW."payloadSha256" IS DISTINCT FROM encode(public.digest(convert_to(NEW."payload"::text,'UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION '对上已用原请求缺少当前独立执行事务' USING ERRCODE='42501';
    END IF;
  ELSE RAISE EXCEPTION '对上执行保护接线错误' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$append$;
CREATE TRIGGER jg_direct_upward_execution_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_direct_upward_execution_binding_v2 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_upward_execution_v2();
CREATE TRIGGER jg_direct_upward_execution_binding_no_truncate BEFORE TRUNCATE
ON public.jg_contract_direct_upward_execution_binding_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_upward_execution_v2();
CREATE TRIGGER jg_direct_upward_use_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_direct_upward_use_v2 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_upward_execution_v2();
CREATE TRIGGER jg_direct_upward_use_no_truncate BEFORE TRUNCATE
ON public.jg_contract_direct_upward_use_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_upward_execution_v2();

-- The separately installed exact closure must supply this checker. A detached
-- source or issued receipt cannot authorize writes before all dispatch guards,
-- constraint, role graph and readback sources are bound together.
CREATE FUNCTION public.jg_execute_contract_direct_upward_v2(
  p_intent UUID,p_nonce UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $execute$
DECLARE
  closure_sha TEXT;
  issuer public.jg_contract_direct_upward_issuer_binding_v2%ROWTYPE;
  execution public.jg_contract_direct_upward_execution_binding_v2%ROWTYPE;
  payload JSONB;
  q JSONB;
  manifest JSONB;
  file_ids TEXT[];
  authority JSONB;
  basis JSONB;
  response JSONB;
  request_sha TEXT;
  manifest_sha TEXT;
  authority_sha TEXT;
  archive_id TEXT:=public.gen_random_uuid()::text;
  archived_at TIMESTAMP(3):=(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  count_now INTEGER;
  object_key TEXT;
  terms_id TEXT;
BEGIN
  -- This qualified checker must return the sealed closure, never a caller flag.
  closure_sha:=public.jg_require_contract_direct_upward_execution_v2(p_nonce);
  SELECT b.* INTO STRICT execution FROM public.jg_contract_direct_upward_execution_binding_v2 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
    WHERE b."protocolVersion"=2 AND b."namespaceOid"=to_regnamespace('public')
      AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid
      AND b."sourceClosureSha256"=closure_sha;
  SELECT b.* INTO STRICT issuer FROM public.jg_contract_direct_upward_issuer_binding_v2 b
    WHERE b.tableoid=execution."issuerBindingOid" AND b."protocolVersion"=2 AND b."channelNonce"=p_nonce
      AND b."databaseOid"=execution."databaseOid" AND b."namespaceOid"=execution."namespaceOid"
      AND b."anchorOwnerOid"=execution."anchorOwnerOid"
      AND encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')=execution."issuerBindingSha256";
  IF execution."runtimeSessionOid" IN (issuer."issuerSessionOid",issuer."issuerOwnerOid",execution."applicationRoleOid",execution."anchorOwnerOid")
    OR current_setting('session_replication_role')<>'origin' OR inet_client_addr() IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 old
      WHERE execution."runtimeSessionOid" IN(old."issuerSessionOid",old."issuerOwnerOid",old."runtimeSessionOid",old."executorOwnerOid")) THEN
    RAISE EXCEPTION '对上登记须使用独立且已绑定的原生执行连接' USING ERRCODE='42501';
  END IF;

  PERFORM c."id" FROM public."Contract" c WHERE c."id"=p_contract AND c."projectId"=p_project
    AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '当前经办人无权登记本合同' USING ERRCODE='42501'; END IF;
  PERFORM v."id" FROM public."ContractVersion" v WHERE v."id"=p_version AND v."contractId"=p_contract
    AND v."status"='draft' AND v."numericProtocolVersion"=2 AND v."signingSubjectType"='upward'
    AND v."versionNo"=1 AND v."changeType"='original' AND v."draftRevision"=p_revision
    AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL AND v."taxFactsFrozenAt" IS NULL AND v."endedAt" IS NULL
    AND v."baseVersionId" IS NULL AND v."supersedesVersionId" IS NULL AND v."copiedFromContractVersionId" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '当前对上已签原始草稿已变化' USING ERRCODE='23514'; END IF;
  PERFORM p."id" FROM public."Project" p WHERE p."id"=p_project AND p."isActive" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '项目当前不可办理登记' USING ERRCODE='23514'; END IF;

  -- Serialize the independent enterprise and participating-company identities.
  PERFORM a."id" FROM public."ProjectAffiliateAssignment" a JOIN public."ContractVersion" v
    ON v."affiliateAssignmentId"=a."id" WHERE v."id"=p_version FOR SHARE OF a;
  PERFORM b."id" FROM public."BusinessParty" b JOIN public."ProjectAffiliateAssignment" a ON a."businessPartyId"=b."id"
    JOIN public."ContractVersion" v ON v."affiliateAssignmentId"=a."id" WHERE v."id"=p_version FOR UPDATE OF b;
  PERFORM c."id" FROM public."CompanyEntity" c JOIN public."ContractVersion" v ON v."companyEntityIdSnapshot"=c."id"
    WHERE v."id"=p_version FOR UPDATE OF c;
  PERFORM p."id" FROM public."ProjectParticipatingCompany" p JOIN public."ContractVersion" v
    ON v."draftData"#>>'{directSigningInput,companyParticipationId}'=p."id" WHERE v."id"=p_version FOR SHARE OF p;

  SELECT array_agg(item->>'fileId' ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
    INTO file_ids,manifest FROM jsonb_array_elements(p_evidence) WITH ORDINALITY original(item,position);
  IF cardinality(file_ids) NOT BETWEEN 1 AND 20 OR cardinality(file_ids)<>(SELECT count(DISTINCT id) FROM unnest(file_ids) id) THEN
    RAISE EXCEPTION '对上签章原件须按序完整且不得重复' USING ERRCODE='23514';
  END IF;
  PERFORM f."id" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS count_now=ROW_COUNT;
  IF count_now<>cardinality(file_ids) OR NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION '原件缺失或正在绑定，请查询原请求后继续' USING ERRCODE='55P03';
  END IF;
  FOR object_key IN SELECT f."objectKey" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."objectKey" COLLATE "C" LOOP
    IF object_key IS NULL OR object_key='' OR NOT pg_try_advisory_xact_lock(hashtextextended('jg:contract-direct-review-object-key-v1:'||object_key,0)) THEN
      RAISE EXCEPTION '原件物理身份正在办理，请查询原请求后继续' USING ERRCODE='55P03';
    END IF;
  END LOOP;

  -- Reuse the exact existing Q2 basis after all locks. Its immutable two-minute
  -- receipt must bind these same bytes, and one use row makes consumption unique.
  payload:=public.jg_contract_direct_archive_upward_intent_basis_v2(p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF payload IS NULL OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_intent_receipt_v2 receipt
    WHERE receipt."intentId"=p_intent AND receipt."bindingSha256"=execution."issuerBindingSha256"
      AND receipt."payloadSha256"=encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')
      AND receipt."issuedAt"<=clock_timestamp() AND receipt."expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION '对上登记原授权过期或资料已变化' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.jg_contract_direct_upward_use_v2("intentId","archiveId","backendPid","transactionId","payload","payloadSha256")
    VALUES(p_intent,archive_id,pg_backend_pid(),txid_current(),payload,encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'));
  q:=payload#>'{directInput,Q}';
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(p_contract,p_version,p_actor,p_key,p_revision,p_input_sha,file_ids);
  basis:=jsonb_build_object('directInput',payload->'directInput','businessTime',jsonb_build_object(
    'archivedAt',to_char(archived_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'businessDay',to_char((archived_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')));
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  authority:=jsonb_build_object('recipeVersion','contract-upward-direct-archive-v1/1','authorityProtocolVersion',1,
    'archiveSource','direct_signed','projectId',p_project,'contractId',p_contract,'contractVersionId',p_version,
    'handlerUserId',p_actor,'sourceRevision',p_revision,'requestSha256',request_sha,'sourceBasis',basis,
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'originals',p_evidence,'operatingConsequence',payload->'operatingConsequence');
  authority_sha:=encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex');
  response:=jsonb_build_object('archiveId',archive_id,'contractVersionId',p_version,'status','effective','fileIds',to_jsonb(file_ids));

  INSERT INTO public."ContractArchiveFile"("id","contractVersionId","uploadedByUserId","confirmedByUserId","confirmedAt","status",
    "archiveProtocolVersion","archiveSource","idempotencyKey","requestSha256","sourceRevision","authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot")
  VALUES(archive_id,p_version,p_actor,p_actor,archived_at,'confirmed',2,'direct_signed',p_key,request_sha,p_revision,authority,authority_sha,manifest_sha,response);
  DELETE FROM public."ContractDraftAttachment" slot USING unnest(file_ids) WITH ORDINALITY original(id,position)
    WHERE slot."contractVersionId"=p_version AND slot."slotKey"='direct_signed_originals_v1'
      AND slot."fileId"=original.id AND slot."displayOrder"=original.position-1 AND slot."createdByUserId"=p_actor;
  GET DIAGNOSTICS count_now=ROW_COUNT;
  IF count_now<>cardinality(file_ids) THEN RAISE EXCEPTION '对上原件没有完整交接' USING ERRCODE='23514'; END IF;
  INSERT INTO public."ContractArchiveEvidenceFile"("id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256")
    SELECT public.gen_random_uuid()::text,archive_id,p_version,item->>'fileId',(position-1)::integer,item->>'mimeType',
      (item->>'sizeBytes')::integer,item->>'contentSha256'
    FROM jsonb_array_elements(manifest) WITH ORDINALITY original(item,position) ORDER BY position;
  GET DIAGNOSTICS count_now=ROW_COUNT;
  IF count_now<>cardinality(file_ids) THEN RAISE EXCEPTION '对上归档证据没有完整保留' USING ERRCODE='23514'; END IF;
  SELECT v."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}' INTO STRICT terms_id FROM public."ContractVersion" v WHERE v."id"=p_version;
  IF terms_id IS NOT NULL THEN
    UPDATE public."PaymentTermsVersion" SET "status"='effective',"updatedAt"=archived_at
      WHERE "id"=terms_id AND "contractId"=p_contract AND "contractVersionId"=p_version AND "status"='draft';
    IF NOT FOUND THEN RAISE EXCEPTION '纸面付款约定来源已变化' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE public."Project" SET "constructionEnterpriseLockedAt"=COALESCE("constructionEnterpriseLockedAt",archived_at) WHERE "id"=p_project;
  INSERT INTO public."AuditLog"("id","actorUserId","action","businessType","businessId","metadata")
    VALUES(public.gen_random_uuid()::text,p_actor,'contract.archive.complete','contract_version',p_version,
      jsonb_build_object('archiveId',archive_id,'archiveSource','direct_signed','relationship','upward','sourceRevision',p_revision,
        'inputSha256',p_input_sha,'requestSha256',request_sha,'fileIds',to_jsonb(file_ids)));
  UPDATE public."ContractVersion" SET "status"='effective',"effectiveAt"=archived_at,"taxFactsFrozenAt"=archived_at,"updatedAt"=archived_at
    WHERE "id"=p_version AND "status"='draft' AND "draftRevision"=p_revision;
  IF NOT FOUND THEN RAISE EXCEPTION '对上草稿未按原资料登记生效' USING ERRCODE='23514'; END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF public.jg_require_contract_direct_upward_execution_v2(p_nonce) IS DISTINCT FROM closure_sha
    OR public.jg_read_upward_direct_archive_v1(archive_id) IS NULL THEN
    RAISE EXCEPTION '对上登记缺少完整提交后继与原键证明' USING ERRCODE='23514';
  END IF;
  RETURN archive_id;
END;
$execute$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_upward_execution_v2(),
  public.jg_execute_contract_direct_upward_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;
CREATE FUNCTION public.jg_read_upward_direct_archive_v1(p_archive TEXT) RETURNS JSONB
-- VOLATILE read-only verifier: immediate AFTER UPDATE must see the calling command's new version postimage.
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $proof$
DECLARE
  a public."ContractArchiveFile"%ROWTYPE;
  v public."ContractVersion"%ROWTYPE;
  c public."Contract"%ROWTYPE;
  used public.jg_contract_direct_upward_use_v2%ROWTYPE;
  b public.jg_contract_direct_upward_execution_binding_v2%ROWTYPE;
  q JSONB;
  originals JSONB;
  manifest JSONB;
  evidence JSONB;
  basis JSONB;
  authority JSONB;
  file_ids TEXT[];
  result JSONB;
  request_sha TEXT;
  manifest_sha TEXT;
  terms_id TEXT;
  terms JSONB;
BEGIN
  SELECT binding.* INTO STRICT b FROM public.jg_contract_direct_upward_execution_binding_v2 binding
    JOIN pg_catalog.pg_database d ON d.oid=binding."databaseOid" AND d.datname=current_database() AND d.datdba=binding."anchorOwnerOid"
    WHERE binding."protocolVersion"=2 AND binding."anchorOwnerOid"=current_user::regrole::oid
      AND session_user::regrole::oid IN(binding."applicationRoleOid",binding."runtimeSessionOid")
      AND binding."namespaceOid"=to_regnamespace('public');
  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM b."sourceClosureSha256" THEN RETURN NULL; END IF;
  SELECT * INTO STRICT a FROM public."ContractArchiveFile" WHERE "id"=p_archive;
  SELECT * INTO STRICT v FROM public."ContractVersion" WHERE "id"=a."contractVersionId";
  SELECT * INTO STRICT c FROM public."Contract" WHERE "id"=v."contractId";
  SELECT u.* INTO STRICT used FROM public.jg_contract_direct_upward_use_v2 u
    JOIN public.jg_contract_direct_upward_intent_receipt_v2 receipt ON receipt."intentId"=u."intentId"
      AND receipt."bindingSha256"=b."issuerBindingSha256" AND receipt."payloadSha256"=u."payloadSha256"
    WHERE u."archiveId"=a."id"
      AND u."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex');
  q:=used."payload"#>'{directInput,Q}';
  originals:=used."payload"->'orderedEvidence';
  IF a."archiveProtocolVersion"<>2 OR a."archiveSource" IS DISTINCT FROM 'direct_signed' OR a."status" IS DISTINCT FROM 'confirmed'
    OR a."fileId" IS NOT NULL OR a."approvalInstanceId" IS NOT NULL OR a."sealTaskId" IS NOT NULL
    OR a."documentContentRevision" IS NOT NULL OR a."documentContentFingerprint" IS NOT NULL
    OR a."confirmedAt" IS NULL OR a."uploadedByUserId" IS DISTINCT FROM a."confirmedByUserId"
    OR c."ownerUserId" IS DISTINCT FROM a."uploadedByUserId" OR c."voidedAt" IS NOT NULL
    OR v."status" IS DISTINCT FROM 'effective' OR v."numericProtocolVersion"<>2 OR v."signingSubjectType" IS DISTINCT FROM 'upward'
    OR v."versionNo"<>1 OR v."changeType" IS DISTINCT FROM 'original' OR v."draftRevision" IS DISTINCT FROM a."sourceRevision"
    OR v."baseVersionId" IS NOT NULL OR v."supersedesVersionId" IS NOT NULL OR v."copiedFromContractVersionId" IS NOT NULL
    OR v."firstSubmittedAt" IS NOT NULL OR v."endedAt" IS NOT NULL OR v."effectiveAt" IS DISTINCT FROM a."confirmedAt"
    OR v."taxFactsFrozenAt" IS DISTINCT FROM a."confirmedAt"
    OR used."payload"->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR used."payload"->>'relationship' IS DISTINCT FROM 'upward'
    OR used."payload"->>'actor' IS DISTINCT FROM a."uploadedByUserId" OR used."payload"->>'projectId' IS DISTINCT FROM c."projectId"
    OR used."payload"->>'contractId' IS DISTINCT FROM c."id" OR used."payload"->>'contractVersionId' IS DISTINCT FROM v."id"
    OR used."payload"->>'requestKey' IS DISTINCT FROM a."idempotencyKey"
    OR q->'inputProtocolVersion' IS DISTINCT FROM '2'::jsonb
    OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"upward"}'::jsonb
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',c."projectId",'contractId',c."id",'contractVersionId',v."id",
      'draftRevision',v."draftRevision",'versionNo',1,'changeType','original')
    OR used."payload"->>'inputSha256' IS DISTINCT FROM used."payload"#>>'{directInput,inputSha256}'
    OR used."payload"->>'inputSha256' IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex') THEN RETURN NULL; END IF;

  IF q->'contract' IS DISTINCT FROM jsonb_build_object('businessType',c."contractTypeKey",'name',c."name",
      'originalSignedNumber',v."originalSignedNumber",'signedOn',v."draftData"#>'{directSigningInput,signedOn}')
    OR q->'money' IS DISTINCT FROM jsonb_build_object('numericProtocolVersion',2,'amountYuan',v."amountYuan"::numeric(24,4)::text,
      'amountLimitType',v."amountLimitType",'pricingNature',v."pricingNature",'amountSource',v."amountSource")
    OR q->'tax' IS DISTINCT FROM jsonb_build_object('amountBasis',v."draftData"#>>'{contractBasics,amountBasis}',
      'invoiceType',v."invoiceType",'taxMode',v."taxMode",'defaultTaxRatePercent',v."defaultTaxRatePercent"::numeric(9,6)::text)
    OR q#>>'{subjects,enterprise,assignmentId}' IS DISTINCT FROM v."affiliateAssignmentId"
    OR q#>>'{subjects,enterprise,businessPartyVersionId}' IS DISTINCT FROM v."affiliateBusinessPartyVersionId"
    OR q#>>'{subjects,company,companyEntityId}' IS DISTINCT FROM v."companyEntityIdSnapshot"
    OR q#>>'{subjects,company,companyEntityVersionId}' IS DISTINCT FROM v."companyEntityVersionId"
    OR q#>>'{subjects,company,participationId}' IS DISTINCT FROM v."draftData"#>>'{directSigningInput,companyParticipationId}'
    OR q#>'{subjects,enterprise,position}' IS DISTINCT FROM v."draftData"#>'{directSigningInput,enterpriseParty}'
    OR q#>'{subjects,company,position}' IS DISTINCT FROM v."draftData"#>'{directSigningInput,companyParty}' THEN RETURN NULL; END IF;
  terms_id:=v."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}';
  terms:=q#>'{terms,paymentTerms}';
  IF q#>>'{terms,settlementText}' IS DISTINCT FROM COALESCE(v."draftData"#>>'{contractBasics,settlementText}','')
    OR (terms_id IS NULL AND (terms IS DISTINCT FROM 'null'::jsonb OR EXISTS(SELECT 1 FROM public."PaymentTermsVersion" WHERE "contractVersionId"=v."id")))
    OR (terms_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t
      WHERE t."id"=terms_id AND t."contractId"=c."id" AND t."contractVersionId"=v."id" AND t."status"='effective'
        AND t."updatedAt"=a."confirmedAt" AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText")
        AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" s WHERE s."paymentTermsVersionId"=t."id"))) THEN RETURN NULL; END IF;

  IF jsonb_typeof(originals) IS DISTINCT FROM 'array' OR jsonb_array_length(originals) NOT BETWEEN 1 AND 20 THEN RETURN NULL; END IF;
  SELECT array_agg(item->>'fileId' ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
    INTO file_ids,manifest FROM jsonb_array_elements(originals) WITH ORDINALITY original(item,position);
  SELECT jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",
    'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder") INTO evidence
    FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id" AND e."contractVersionId"=v."id";
  IF evidence IS DISTINCT FROM manifest OR q->'signedFiles' IS DISTINCT FROM manifest
    OR cardinality(file_ids)<>(SELECT count(DISTINCT id) FROM unnest(file_ids) id)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(originals) WITH ORDINALITY original(item,position)
      LEFT JOIN public."FileObject" f ON f."id"=item->>'fileId'
      WHERE item->'displayOrder' IS DISTINCT FROM to_jsonb((position-1)::integer)
        OR f."id" IS NULL OR f."uploadedByUserId" IS DISTINCT FROM a."uploadedByUserId" OR f."storageStatus" IS DISTINCT FROM 'active'
        OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
        OR f."bucket" IS DISTINCT FROM item->>'bucket' OR f."objectKey" IS DISTINCT FROM item->>'objectKey'
        OR f."mimeType" IS DISTINCT FROM item->>'mimeType' OR to_jsonb(f."sizeBytes") IS DISTINCT FROM item->'sizeBytes'
        OR f."contentSha256" IS DISTINCT FROM item->>'contentSha256'
        OR EXISTS(SELECT 1 FROM public."FileObject" alias WHERE alias."id"<>f."id" AND alias."objectKey"=f."objectKey"))
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" WHERE "contractVersionId"=v."id" AND "slotKey"='direct_signed_originals_v1')
    OR EXISTS(SELECT 1 FROM public."ApprovalInstance" WHERE "businessType"='contract_version' AND "businessId"=v."id")
    OR EXISTS(SELECT 1 FROM public."ContractSealTask" WHERE "contractVersionId"=v."id")
    OR EXISTS(SELECT 1 FROM public."OperatingFact" WHERE "sourceType"='contract_version' AND "sourceBusinessId"=v."id")
    OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" WHERE "sourceType"='contract_version' AND "sourceBusinessId"=v."id") THEN RETURN NULL; END IF;
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(c."id",v."id",a."uploadedByUserId",a."idempotencyKey",a."sourceRevision",used."payload"->>'inputSha256',file_ids);
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  basis:=jsonb_build_object('directInput',used."payload"->'directInput','businessTime',jsonb_build_object(
    'archivedAt',to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'businessDay',to_char((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')));
  authority:=jsonb_build_object('recipeVersion','contract-upward-direct-archive-v1/1','authorityProtocolVersion',1,
    'archiveSource','direct_signed','projectId',c."projectId",'contractId',c."id",'contractVersionId',v."id",
    'handlerUserId',a."uploadedByUserId",'sourceRevision',a."sourceRevision",'requestSha256',request_sha,'sourceBasis',basis,
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'originals',originals,'operatingConsequence',used."payload"->'operatingConsequence');
  result:=jsonb_build_object('archiveId',a."id",'contractVersionId',v."id",'status','effective','fileIds',to_jsonb(file_ids));
  IF 1<>(SELECT count(*) FROM public."AuditLog" audit
      WHERE audit."actorUserId"=a."uploadedByUserId" AND audit."action"='contract.archive.complete'
        AND audit."businessType"='contract_version' AND audit."businessId"=v."id"
        AND audit."metadata"=jsonb_build_object('archiveId',a."id",'archiveSource','direct_signed','relationship','upward',
          'sourceRevision',a."sourceRevision",'inputSha256',used."payload"->>'inputSha256',
          'requestSha256',request_sha,'fileIds',to_jsonb(file_ids))) THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."Project" project WHERE project."id"=c."projectId"
      AND project."constructionEnterpriseLockedAt" IS NOT NULL AND project."constructionEnterpriseLockedAt"<=a."confirmedAt")
    OR authority IS DISTINCT FROM a."authoritySnapshot" OR request_sha IS DISTINCT FROM a."requestSha256"
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR a."fileManifestSha256" IS DISTINCT FROM manifest_sha OR a."responseSnapshot" IS DISTINCT FROM result THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('archiveId',a."id",'contractVersionId',v."id",'requestSha256',request_sha,'authoritySha256',a."authoritySha256",
    'sourceRevision',a."sourceRevision",'idempotencyKey',a."idempotencyKey",'handlerUserId',a."uploadedByUserId",
    'Q',q,'qText',q::text,'inputSha256',used."payload"->>'inputSha256','originals',originals,'result',result,
    'authorityText',authority::text,'operatingConsequence',used."payload"->'operatingConsequence');
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RETURN NULL;
END;
$proof$;
REVOKE ALL ON FUNCTION public.jg_read_upward_direct_archive_v1(TEXT) FROM PUBLIC;

DO $private_source$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN (
      'public.jg_guard_contract_direct_upward_execution_v2()'::regprocedure,
      'public.jg_execute_contract_direct_upward_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure,
      'public.jg_read_upward_direct_archive_v1(text)'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid IN('public.jg_contract_direct_upward_execution_binding_v2'::regclass,'public.jg_contract_direct_upward_use_v2'::regclass)
        AND (a.grantee<>c.relowner OR a.grantor<>c.relowner)) THEN
    RAISE EXCEPTION '对上登记后继源须保持私有，不能通过默认权限开放' USING ERRCODE='55000';
  END IF;
END;
$private_source$;
COMMIT;
