-- A completed enabled-ledger direct archive uses the immutable V2 claim as its
-- generation source. The V1 reader and all write permissions remain separate.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_read_direct_outside_operating_archive_v2(p_archive TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $read$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  a public."ContractArchiveFile"%ROWTYPE;
  u RECORD;
  source JSONB;
  consequence JSONB;
  expected JSONB;
  terms JSONB;
  originals JSONB;
  manifest JSONB;
  file_ids TEXT[];
  archived_at TEXT;
  basis JSONB;
  authority JSONB;
  response JSONB;
  request_sha TEXT;
  matched INTEGER;
BEGIN
  SELECT b.* INTO binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 nonce ON nonce."protocolVersion"=1
    AND nonce."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  WHERE b."protocolVersion"=1 AND b."anchorOwnerOid"=current_user::regrole::oid
    AND b."ordinaryApplicationRoleOid"=session_user::regrole::oid AND b."namespaceOid"=to_regnamespace('public')
    AND current_setting('session_replication_role')='origin';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT use_row.*,use_row.xmin AS row_xid,receipt."payloadSha256" INTO u
  FROM public.jg_contract_direct_outside_operating_use_v2 use_row
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=use_row."intentId"
  WHERE use_row."archiveId"=p_archive AND use_row."databaseOid"=binding."databaseOid"
    AND use_row."runtimeSessionOid"=binding."runtimeSessionOid" AND use_row."executorOwnerOid"=binding."executorOwnerOid"
    AND use_row."backendPid">0 AND use_row."transactionId">0
    AND mod(use_row."transactionId",4294967296::bigint)::text=use_row.xmin::text
    AND receipt.xmin<>use_row.xmin
    AND receipt."bindingSha256"=encode(public.digest(convert_to(to_jsonb(binding)::text,'UTF8'),'sha256'),'hex')
    AND receipt."payloadSha256"=encode(public.digest(convert_to(use_row."payload"::text,'UTF8'),'sha256'),'hex')
    AND use_row."claimedAt">=receipt."issuedAt" AND use_row."claimedAt"<receipt."expiresAt";
  IF NOT FOUND THEN RETURN NULL; END IF;
  source:=u."payload";
  consequence:=source->'operatingConsequence';
  expected:=consequence->'expectedSource';
  IF source->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR source->>'archiveSource' IS DISTINCT FROM 'direct_signed'
    OR source->>'relationship' IS DISTINCT FROM 'outside' OR consequence->>'mode' IS DISTINCT FROM 'projection_required'
    OR source->>'contractVersionId' IS DISTINCT FROM u."contractVersionId"
    OR source->>'requestKey' IS DISTINCT FROM u."requestKey"
    OR jsonb_typeof(source->'orderedEvidence') IS DISTINCT FROM 'array'
    OR source#>'{directInput,Q,inputProtocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR source#>'{directInput,Q,source}' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"outside"}'::jsonb
    OR source#>'{directInput,Q,locator}' IS DISTINCT FROM jsonb_build_object('projectId',source->>'projectId',
      'contractId',source->>'contractId','contractVersionId',u."contractVersionId",'versionNo',1,
      'changeType','original','draftRevision',source->'sourceRevision')
    OR source#>>'{directInput,inputSha256}' IS DISTINCT FROM source->>'inputSha256'
    OR source->>'inputSha256' IS DISTINCT FROM encode(public.digest(convert_to((source#>'{directInput,Q}')::text,'UTF8'),'sha256'),'hex')
    OR jsonb_typeof(expected) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  IF jsonb_array_length(source->'orderedEvidence') NOT BETWEEN 1 AND 20 THEN RETURN NULL; END IF;

  SELECT archive.* INTO a FROM public."ContractArchiveFile" archive
  JOIN public."ContractVersion" v ON v."id"=archive."contractVersionId"
  JOIN public."Contract" c ON c."id"=v."contractId"
  WHERE archive."id"=p_archive AND archive.xmin=u.row_xid AND v.xmin=u.row_xid
    AND archive."contractVersionId"=u."contractVersionId" AND archive."idempotencyKey"=u."requestKey"
    AND archive."requestSha256"=source->>'requestSha256' AND archive."sourceRevision"::text=source->>'sourceRevision'
    AND archive."archiveProtocolVersion"=2 AND archive."archiveSource"='direct_signed' AND archive."status"='confirmed'
    AND archive."fileId" IS NULL AND archive."approvalInstanceId" IS NULL AND archive."sealTaskId" IS NULL
    AND archive."documentContentRevision" IS NULL AND archive."documentContentFingerprint" IS NULL
    AND archive."uploadedByUserId"=source->>'actor' AND archive."confirmedByUserId"=archive."uploadedByUserId"
    AND archive."confirmedAt">=(u."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    AND v."status"='effective' AND v."signingSubjectType"='affiliate' AND v."numericProtocolVersion"=2 AND v."versionNo"=1
    AND v."changeType"='original' AND v."firstSubmittedAt" IS NULL AND v."supersedesVersionId" IS NULL
    AND v."documentContentFingerprint" IS NULL
    AND v."draftRevision"=archive."sourceRevision" AND v."effectiveAt"=archive."confirmedAt" AND v."taxFactsFrozenAt"=v."effectiveAt"
    AND c."id"=source->>'contractId' AND c."projectId"=source->>'projectId' AND c."voidedAt" IS NULL
    AND NOT EXISTS(SELECT 1 FROM public."ApprovalInstance" round WHERE round."businessType"='contract_version' AND round."businessId"=v."id")
    AND NOT EXISTS(SELECT 1 FROM public."ContractSealTask" seal WHERE seal."contractVersionId"=v."id");
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_agg(item ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position),
    array_agg(item->>'fileId' ORDER BY position),count(*) INTO originals,manifest,file_ids,matched
  FROM jsonb_array_elements(source->'orderedEvidence') WITH ORDINALITY AS stored(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=a."id" AND e."contractVersionId"=a."contractVersionId"
    AND e.xmin=u.row_xid AND e."displayOrder"=position-1 AND e."fileId"=item->>'fileId'
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."storageStatus"='active' AND f."uploadedByUserId"=a."uploadedByUserId"
    AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
  WHERE e."displayOrder"::text=item->>'displayOrder' AND e."mimeType"=item->>'mimeType' AND f."mimeType"=e."mimeType"
    AND e."sizeBytes"::text=item->>'sizeBytes' AND f."sizeBytes"=e."sizeBytes"
    AND e."contentSha256"=item->>'contentSha256' AND f."contentSha256"=e."contentSha256"
    AND length(item->>'objectGeneration') BETWEEN 1 AND 1024 AND (item->>'objectGeneration') COLLATE "C"~'^[!-~]+$'
    AND lower(item->>'objectGeneration')<>'null' AND position(',' IN item->>'objectGeneration')=0
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."id"<>f."id"
      AND (replacement."supersedesFileObjectId"=f."id" OR (replacement."bucket",replacement."objectKey")=(f."bucket",f."objectKey")))
    AND NOT EXISTS(SELECT 1 FROM public."ContractArchiveEvidenceFile" other WHERE other."fileId"=f."id" AND other."id"<>e."id");
  IF originals IS DISTINCT FROM source->'orderedEvidence' OR manifest IS DISTINCT FROM source#>'{directInput,Q,signedFiles}'
    OR matched<>(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id")
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" da WHERE da."contractVersionId"=a."contractVersionId"
      AND da."slotKey"='direct_signed_originals_v1') THEN RETURN NULL; END IF;

  terms:=source#>'{directInput,Q,terms,paymentTerms}';
  IF terms IS NULL
    OR (terms='null'::jsonb AND EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=a."contractVersionId"))
    OR (terms<>'null'::jsonb AND ((SELECT count(*) FROM public."PaymentTermsVersion" t
      WHERE t."contractVersionId"=a."contractVersionId")<>1 OR NOT EXISTS(
        SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=a."contractVersionId"
          AND t."contractId"=source->>'contractId' AND t."status"='effective' AND t.xmin=u.row_xid
          AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText",'stages','[]'::jsonb)
          AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" st WHERE st."paymentTermsVersionId"=t."id"))))
    THEN RETURN NULL; END IF;

  archived_at:=to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(source->>'contractId',a."contractVersionId",a."uploadedByUserId",
    a."idempotencyKey",a."sourceRevision",source->>'inputSha256',file_ids);
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',source->'directInput','fileManifest',manifest,
    'businessTime',jsonb_build_object('archivedAt',archived_at,'handlerUserId',a."uploadedByUserId",
      'businessDay',to_char((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')),
    'reviewScope',consequence->'reviewScope','intentPayloadSha256',u."payloadSha256");
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed',
    'projectId',source->>'projectId','contractId',source->>'contractId','contractVersionId',a."contractVersionId",
    'handlerUserId',a."uploadedByUserId",'archivedAt',archived_at,'requestSha256',request_sha,'sourceRevision',a."sourceRevision",
    'sourceBasis',basis,'sourceBasisSha256',encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),
    'fileManifest',manifest,'fileManifestSha256',encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'),
    'operatingConsequence',consequence);
  response:=jsonb_build_object('archiveId',a."id",'contractVersionId',a."contractVersionId",'status','effective','fileIds',to_jsonb(file_ids));
  IF request_sha IS NULL OR request_sha IS DISTINCT FROM a."requestSha256" OR authority IS DISTINCT FROM a."authoritySnapshot"
    OR authority->>'fileManifestSha256' IS DISTINCT FROM a."fileManifestSha256"
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR response IS DISTINCT FROM a."responseSnapshot" THEN RETURN NULL; END IF;

  IF 1<>(SELECT count(*) FROM public."OperatingFact" fact
      WHERE fact."sourceType"='contract_version' AND fact."sourceBusinessId"=a."contractVersionId")
    OR 1<>(SELECT count(*) FROM public."OperatingFact" fact JOIN public."OperatingImpactEntry" impact ON impact."factId"=fact."id"
      WHERE fact.xmin=u.row_xid AND impact.xmin=u.row_xid AND fact."projectId"=source->>'projectId'
        AND impact."projectId"=fact."projectId" AND fact."sourceType"='contract_version' AND fact."sourceBusinessId"=a."contractVersionId"
        AND impact."sourceType"=fact."sourceType" AND impact."sourceBusinessId"=fact."sourceBusinessId"
        AND fact."sourceVersion"::text=expected->>'sourceVersion' AND fact."sourceBusinessCode"=expected->>'sourceBusinessCode'
        AND fact."idempotencyKey"=expected->>'factIdempotencyKey' AND impact."idempotencyKey"=expected->>'impactIdempotencyKey'
        AND fact."status"='confirmed' AND fact."entryKind"='original' AND fact."factKind"='downstream_contract' AND fact."direction"='neutral'
        AND impact."impactKind"='contract_commitment_reference' AND impact."sourceImpactKey"='contract_commitment_reference'
        AND fact."amountCents" IS NULL AND impact."amountCents" IS NULL AND fact."numericProtocolVersion"=2 AND impact."numericProtocolVersion"=2
        AND fact."amountYuan" IS NOT DISTINCT FROM (expected->>'amountYuan')::numeric
        AND impact."amountYuan" IS NOT DISTINCT FROM fact."amountYuan" AND impact."direction"=expected->>'direction'
        AND fact."affiliateAssignmentId"=consequence#>>'{debtor,assignmentId}'
        AND fact."debtorSubjectKind"='construction_enterprise' AND fact."debtorSubjectId"=consequence#>>'{debtor,id}'
        AND fact."creditorSubjectKind"='downstream_counterparty' AND fact."creditorSubjectId"=consequence#>>'{creditor,id}'
        AND fact."confirmedAt"=a."confirmedAt" AND fact."occurredAt"=a."confirmedAt"
        AND fact."confirmedByUserId"=a."uploadedByUserId" AND fact."recordedByUserId"=a."uploadedByUserId"
        AND to_jsonb(fact."operatingLedgerEffectiveDateSnapshot")=consequence->'operatingLedgerEffectiveDateSnapshot'
        AND impact."subjectRole"='debtor' AND impact."subjectKind"=fact."debtorSubjectKind" AND impact."subjectId"=fact."debtorSubjectId"
        AND fact."paymentExecutionId" IS NULL AND fact."fundExecutionId" IS NULL AND fact."fundExecutionCaseId" IS NULL
        AND impact."paymentExecutionId" IS NULL AND impact."fundExecutionId" IS NULL AND impact."fundExecutionCaseId" IS NULL
        AND impact."costCategoryCode" IS NULL AND impact."fundPurpose" IS NULL
        AND fact."sourceSnapshot" @> jsonb_build_object('archiveAuthorityId',a."id",'archiveAuthoritySha256',a."authoritySha256",
          'archiveSource','direct_signed','intentPayloadSha256',u."payloadSha256")
        AND 1=(SELECT count(*) FROM public."OperatingImpactEntry" other WHERE other."factId"=fact."id"
          OR (other."sourceType"='contract_version' AND other."sourceBusinessId"=a."contractVersionId")))
    OR 1<>(SELECT count(*) FROM public."AuditLog" log WHERE log."businessType"='contract_version'
      AND log."businessId"=a."contractVersionId" AND log."action"='contract.archive.complete')
    OR 1<>(SELECT count(*) FROM public."AuditLog" log WHERE log.xmin=u.row_xid AND log."actorUserId"=a."uploadedByUserId"
      AND log."businessType"='contract_version' AND log."businessId"=a."contractVersionId" AND log."action"='contract.archive.complete'
      AND log."metadata" @> jsonb_build_object('archiveId',a."id",'archiveSource','direct_signed','requestSha256',request_sha,
        'intentPayloadSha256',u."payloadSha256")) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('proof',jsonb_build_object('proofProtocolVersion',1,'contractId',source->>'contractId',
    'projectId',source->>'projectId','contractVersionId',a."contractVersionId",'archiveId',a."id",
    'handlerUserId',a."uploadedByUserId",'idempotencyKey',a."idempotencyKey",'requestSha256',request_sha,
    'authoritySha256',a."authoritySha256",'sourceRevision',a."sourceRevision",'inputSha256',source->>'inputSha256',
    'fileIds',to_jsonb(file_ids),'result',response),'originals',originals);
END;
$read$;
REVOKE ALL ON FUNCTION public.jg_read_direct_outside_operating_archive_v2(TEXT) FROM PUBLIC;

-- Installed by the original owner only after the existing native binding
-- and the enclosing enabled writer have been independently qualified.
CREATE FUNCTION public.jg_install_direct_outside_operating_archive_read_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  b public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  reader OID:='public.jg_read_direct_outside_operating_archive_v2(text)'::regprocedure;
  app_name TEXT;
BEGIN
  SELECT x.* INTO STRICT b FROM public.jg_contract_direct_archive_intent_binding_v1 x
  JOIN pg_catalog.pg_database d ON d.oid=x."databaseOid" AND d.datdba=x."anchorOwnerOid" AND d.datname=current_database()
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(x)::text,'UTF8'),'sha256'),'hex')
  WHERE x."protocolVersion"=1 AND x."namespaceOid"=to_regnamespace('public');
  SELECT r.rolname INTO STRICT app_name FROM pg_catalog.pg_roles r WHERE r.oid=b."ordinaryApplicationRoleOid"
    AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication)
    AND r.oid NOT IN (b."anchorOwnerOid",b."issuerOwnerOid",b."issuerSessionOid",b."executorOwnerOid",b."runtimeSessionOid")
    AND NOT has_schema_privilege(r.oid,b."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid AND
      (pg_has_role(r.oid,other.oid,'MEMBER') OR (NOT other.rolsuper AND pg_has_role(other.oid,r.oid,'MEMBER'))));
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM b."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=reader AND p.proowner=b."anchorOwnerOid"
      AND p.pronamespace=b."namespaceOid" AND p.prosecdef AND p.proisstrict AND p.provolatile='s' AND NOT p.proretset
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='97187bfe8ea4afecec7836dfaa984f4afd095a58456b433879f485e107fb1776'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantor<>p.proowner OR acl.grantee<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签原标识读取的绑定角色或目录资格不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_read_direct_outside_operating_archive_v2(text) TO %I',app_name);
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_operating_archive_read_v2() FROM PUBLIC;

DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid IN ('public.jg_read_direct_outside_operating_archive_v2(text)'::regprocedure,
      'public.jg_install_direct_outside_operating_archive_read_v2()'::regprocedure)
      AND (acl.grantor<>p.proowner OR acl.grantee<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签读证明默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private_acl$;
COMMIT;
