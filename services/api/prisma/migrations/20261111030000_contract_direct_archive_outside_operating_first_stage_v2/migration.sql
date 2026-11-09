-- Private first-registration stage. The existing completion constraint must
-- still reject a transaction that stops after writing this stage.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

DO $predecessors$
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR 3<>(SELECT count(*) FROM (VALUES
      ('public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
        'd975a30e898859d54c1bea6152242ef233d947d458953d6e38e62df2088ddb9c',TRUE),
      ('public.jg_guard_direct_outside_operating_intent_v2()',
        '515f40256cd22560bdd2fb2b46e3c13deb3e7924f56987d0ceaedc98efecd3f2',FALSE),
      ('public.jg_require_direct_outside_operating_completion_v2()',
        '201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd',FALSE)
    ) expected(signature,body_sha,is_strict)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
      AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=current_user::regrole::oid
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict=expected.is_strict
      AND NOT p.prosecdef AND NOT p.proretset AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public.jg_contract_direct_outside_operating_use_v2'::regclass
        AND t.tgname='jg_direct_outside_operating_completion'
        AND t.tgfoid='public.jg_require_direct_outside_operating_completion_v2()'::regprocedure
        AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
        AND t.tgconstraint<>0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public.jg_contract_direct_outside_operating_use_v2'::regclass
        AND t.tgname='jg_direct_outside_operating_use_immutable'
        AND t.tgfoid='public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure
        AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='') THEN
    RAISE EXCEPTION '表外直签首写缺少原领取与同事务完成守卫' USING ERRCODE='55000';
  END IF;
END;
$predecessors$;

-- Can also be called by a future BEFORE INSERT dispatcher to independently
-- reconstruct the permitted NEW row before any V2 direct parent is accepted.
CREATE FUNCTION public.jg_direct_outside_operating_first_parent_v2(p_archive TEXT,p_archived_at TIMESTAMP)
RETURNS public."ContractArchiveFile"
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $parent$
DECLARE
  claim RECORD;
  source JSONB;
  consequence JSONB;
  live_input JSONB;
  manifest JSONB;
  file_ids TEXT[];
  archived_at TEXT;
  basis JSONB;
  authority JSONB;
  manifest_sha TEXT;
BEGIN
  SELECT u.*,receipt."payloadSha256" INTO STRICT claim
  FROM public.jg_contract_direct_outside_operating_use_v2 u
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=u."intentId"
  WHERE u."archiveId"=p_archive AND u."runtimeSessionOid"=session_user::regrole::oid
    AND u."executorOwnerOid"=current_user::regrole::oid
    AND u."databaseOid"=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=current_database())
    AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text AND receipt.xmin<>u.xmin
    AND receipt."bindingSha256"=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    AND receipt."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=receipt."issuedAt" AND u."claimedAt"<receipt."expiresAt"
    AND (p_archived_at AT TIME ZONE 'UTC')<receipt."expiresAt";
  IF NOT pg_catalog.isfinite(p_archived_at) OR p_archived_at<(claim."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    OR p_archived_at>(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) THEN
    RAISE EXCEPTION '表外直签归档须采用本次领取的有效时刻' USING ERRCODE='23514';
  END IF;
  source:=claim."payload";
  consequence:=source->'operatingConsequence';
  IF consequence->>'mode' IS DISTINCT FROM 'projection_required'
    OR jsonb_typeof(consequence->'reviewScope') IS DISTINCT FROM 'object'
    OR NOT EXISTS(SELECT 1 FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
      JOIN public."Project" p ON p."id"=c."projectId" JOIN public."ProjectAffiliateAssignment" a ON a."id"=v."affiliateAssignmentId"
      WHERE v."id"=claim."contractVersionId" AND v."status"='draft' AND v."signingSubjectType"='affiliate'
        AND v."draftRevision"=(source->>'sourceRevision')::integer AND v."versionNo"=1 AND v."changeType"='original'
        AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL
        AND v."taxFactsFrozenAt" IS NULL AND v."endedAt" IS NULL AND v."supersedesVersionId" IS NULL
        AND v."documentContentFingerprint" IS NULL AND c."id"=source->>'contractId'
        AND c."ownerUserId"=source->>'actor' AND c."voidedAt" IS NULL AND p."id"=source->>'projectId' AND p."isActive"
        AND p."operatingLedgerEffectiveDate" IS NOT NULL
        AND to_jsonb(p."operatingLedgerEffectiveDate")=consequence->'operatingLedgerEffectiveDateSnapshot'
        AND a."projectId"=p."id" AND a."id"=consequence#>>'{debtor,assignmentId}'
        AND a."businessPartyVersionId"=v."affiliateBusinessPartyVersionId" AND a."businessPartyVersionId"=consequence#>>'{debtor,id}'
        AND a."effectiveFrom"<=p_archived_at AND (a."endedAt" IS NULL OR a."endedAt">p_archived_at)
        AND 1=(SELECT count(*) FROM public."ProjectAffiliateAssignment" candidate
          WHERE candidate."projectId"=p."id" AND candidate."effectiveFrom"<=p_archived_at
            AND (candidate."endedAt" IS NULL OR candidate."endedAt">p_archived_at))) THEN
    RAISE EXCEPTION '表外直签的施工企业、草稿或经营账依据已变化' USING ERRCODE='23514';
  END IF;

  live_input:=public.jg_contract_direct_pending_input_v1(claim."contractVersionId");
  SELECT jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position),
    array_agg(item->>'fileId' ORDER BY position) INTO manifest,file_ids
  FROM jsonb_array_elements(source->'orderedEvidence') WITH ORDINALITY AS original(item,position);
  IF live_input->>'state' IS DISTINCT FROM 'complete'
    OR live_input->'Q' IS DISTINCT FROM source#>'{directInput,Q}'
    OR live_input->>'inputSha256' IS DISTINCT FROM source->>'inputSha256'
    OR manifest IS DISTINCT FROM source#>'{directInput,Q,signedFiles}'
    OR source->>'requestSha256' IS DISTINCT FROM public.jg_contract_direct_archive_request_sha_v1(source->>'contractId',
      claim."contractVersionId",source->>'actor',claim."requestKey",(source->>'sourceRevision')::integer,source->>'inputSha256',file_ids)
    OR EXISTS(SELECT 1 FROM public."ContractArchiveFile" previous
      WHERE previous."contractVersionId"=claim."contractVersionId" OR previous."idempotencyKey"=claim."requestKey"
        OR previous."id"=p_archive) THEN
    RAISE EXCEPTION '表外直签原请求或签章原件已变化，请查询原标识' USING ERRCODE='23514';
  END IF;

  archived_at:=to_char(p_archived_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',source->'directInput','fileManifest',manifest,
    'businessTime',jsonb_build_object('archivedAt',archived_at,'handlerUserId',source->>'actor',
      'businessDay',to_char((p_archived_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')),
    'reviewScope',consequence->'reviewScope','intentPayloadSha256',claim."payloadSha256");
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed',
    'projectId',source->>'projectId','contractId',source->>'contractId','contractVersionId',claim."contractVersionId",
    'handlerUserId',source->>'actor','archivedAt',archived_at,'requestSha256',source->>'requestSha256',
    'sourceRevision',source->'sourceRevision','sourceBasis',basis,
    'sourceBasisSha256',encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'operatingConsequence',consequence);
  RETURN jsonb_populate_record(NULL::public."ContractArchiveFile",jsonb_build_object(
    'id',p_archive,'contractVersionId',claim."contractVersionId",'uploadedByUserId',source->>'actor',
    'confirmedByUserId',source->>'actor','confirmedAt',p_archived_at,'status','confirmed','archiveProtocolVersion',2,
    'archiveSource','direct_signed','idempotencyKey',claim."requestKey",'requestSha256',source->>'requestSha256',
    'sourceRevision',source->'sourceRevision','authoritySnapshot',authority,
    'authoritySha256',encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex'),
    'fileManifestSha256',manifest_sha,'responseSnapshot',jsonb_build_object('archiveId',p_archive,
      'contractVersionId',claim."contractVersionId",'status','effective','fileIds',to_jsonb(file_ids))));
END;
$parent$;

CREATE FUNCTION public.jg_stage_direct_outside_operating_archive_v2(
  p_nonce UUID,p_intent UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,
  p_revision INTEGER,p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $stage$
DECLARE
  archive_id UUID:=pg_catalog.gen_random_uuid();
  source JSONB;
  manifest JSONB;
  payment_terms JSONB;
  parent RECORD;
  affected INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='public.jg_contract_direct_outside_operating_use_v2'::regclass
        AND t.tgname='jg_direct_outside_operating_completion'
        AND p.oid='public.jg_require_direct_outside_operating_completion_v2()'::regprocedure
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
          '201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd'
        AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
        AND t.tgconstraint<>0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='') THEN
    RAISE EXCEPTION '表外直签首写须使用隔离连接与本事务完成守卫' USING ERRCODE='55000';
  END IF;
  source:=public.jg_claim_contract_direct_outside_operating_intent_v2(
    p_nonce,p_intent,archive_id,p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  manifest:=source#>'{directInput,Q,signedFiles}';
  payment_terms:=source#>'{directInput,Q,terms,paymentTerms}';

  PERFORM slot."id" FROM public."ContractDraftAttachment" slot
    WHERE slot."contractVersionId"=p_version AND slot."slotKey"='direct_signed_originals_v1'
    ORDER BY slot."displayOrder" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected IS DISTINCT FROM jsonb_array_length(manifest) THEN
    RAISE EXCEPTION '表外直签原件槽不完整' USING ERRCODE='23514';
  END IF;
  PERFORM t."id" FROM public."PaymentTermsVersion" t
    WHERE t."contractVersionId"=p_version ORDER BY t."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF payment_terms IS NULL OR affected IS DISTINCT FROM (CASE WHEN payment_terms='null'::jsonb THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION '表外直签固定付款约定不完整' USING ERRCODE='23514';
  END IF;

  SELECT * INTO STRICT parent FROM public.jg_direct_outside_operating_first_parent_v2(
    archive_id::text,(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3));
  INSERT INTO public."ContractArchiveFile"("id","contractVersionId","uploadedByUserId","confirmedByUserId","confirmedAt","status",
    "archiveProtocolVersion","archiveSource","idempotencyKey","requestSha256","sourceRevision",
    "authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot")
  VALUES (parent."id",parent."contractVersionId",parent."uploadedByUserId",parent."confirmedByUserId",parent."confirmedAt",
    parent."status",parent."archiveProtocolVersion",parent."archiveSource",parent."idempotencyKey",parent."requestSha256",
    parent."sourceRevision",parent."authoritySnapshot",parent."authoritySha256",parent."fileManifestSha256",parent."responseSnapshot");

  DELETE FROM public."ContractDraftAttachment" slot
    USING jsonb_array_elements(manifest) WITH ORDINALITY AS original(item,position)
    WHERE slot."contractVersionId"=p_version AND slot."slotKey"='direct_signed_originals_v1'
      AND slot."fileId"=item->>'fileId' AND slot."displayOrder"=position-1 AND slot."createdByUserId"=p_actor;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected IS DISTINCT FROM jsonb_array_length(manifest) THEN
    RAISE EXCEPTION '表外直签原件未完整移交' USING ERRCODE='23514';
  END IF;

  INSERT INTO public."ContractArchiveEvidenceFile"("id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType",
    "sizeBytes","contentSha256")
  SELECT pg_catalog.gen_random_uuid()::text,parent."id",p_version,item->>'fileId',(position-1)::integer,item->>'mimeType',
    (item->>'sizeBytes')::integer,item->>'contentSha256'
  FROM jsonb_array_elements(manifest) WITH ORDINALITY AS original(item,position) ORDER BY position;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected IS DISTINCT FROM jsonb_array_length(manifest) THEN
    RAISE EXCEPTION '表外直签签章原件未完整冻结' USING ERRCODE='23514';
  END IF;

  IF payment_terms<>'null'::jsonb THEN
    UPDATE public."PaymentTermsVersion" t SET "status"='effective',"updatedAt"=parent."confirmedAt"
    WHERE t."contractVersionId"=p_version AND t."contractId"=p_contract AND t."id"=payment_terms->>'id'
      AND t."status"='draft' AND to_jsonb(t."versionNo")=payment_terms->'versionNo'
      AND t."originalText" IS NOT DISTINCT FROM payment_terms->>'originalText'
      AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" stage WHERE stage."paymentTermsVersionId"=t."id");
    IF NOT FOUND THEN RAISE EXCEPTION '表外直签固定付款约定未能生效' USING ERRCODE='23514'; END IF;
  END IF;
  -- Internal only. The caller still owes effective version, Fact, Impact and
  -- audit in this transaction. The original claim forbids partial commit.
  RETURN parent."id";
END;
$stage$;

REVOKE ALL ON FUNCTION public.jg_direct_outside_operating_first_parent_v2(TEXT,TIMESTAMP),
  public.jg_stage_direct_outside_operating_archive_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid IN ('public.jg_direct_outside_operating_first_parent_v2(text,timestamp)'::regprocedure,
      'public.jg_stage_direct_outside_operating_archive_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure)
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签首写函数默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private_acl$;
COMMIT;
