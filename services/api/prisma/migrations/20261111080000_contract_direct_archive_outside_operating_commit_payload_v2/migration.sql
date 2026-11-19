-- Freeze the exact direct-signed commitment payload. Runtime admission and writes are separate.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_prepare_direct_outside_operating_commit_v2(p_archive_id TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $prepare$
DECLARE
  source RECORD;
  claim JSONB;
  authority JSONB;
  consequence JSONB;
  expected JSONB;
  debtor JSONB;
  creditor JSONB;
  frozen_files JSONB;
  actual_files JSONB;
  occurred_text TEXT;
  business_day DATE;
  ledger_day DATE;
  gross_text TEXT;
  excluded_text TEXT;
  amount_text TEXT;
  amount_state TEXT;
  amount_nature TEXT;
  direction TEXT;
  fact_id TEXT:=pg_catalog.gen_random_uuid()::text;
  impact_id TEXT:=pg_catalog.gen_random_uuid()::text;
  fact_key TEXT;
  impact_key TEXT;
  numeric_facts JSONB;
  fact_payload JSONB;
  impact_payload JSONB;
BEGIN
  SELECT u."payload", u.xmin AS row_xid, receipt."payloadSha256" AS intent_sha,
    a."id" AS archive_id,a."authoritySnapshot" AS authority,a."authoritySha256" AS authority_sha,
    a."confirmedAt" AS confirmed_at,a."requestSha256" AS request_sha,a."uploadedByUserId" AS actor,
    v."id" AS version_id,v."versionNo" AS version_no,v."amountYuan" AS gross,
    v."amountLimitType" AS amount_limit_type,c."id" AS contract_id,c."code" AS contract_code,p."id" AS project_id,
    p."operatingLedgerEffectiveDate" AS ledger_date
  INTO STRICT source
  FROM public.jg_contract_direct_outside_operating_use_v2 u
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=u."intentId" AND receipt.xmin<>u.xmin
  JOIN public."ContractArchiveFile" a ON a."id"=u."archiveId" AND a."contractVersionId"=u."contractVersionId" AND a.xmin=u.xmin
  JOIN public."ContractVersion" v ON v."id"=u."contractVersionId" AND v.xmin=u.xmin
  JOIN public."Contract" c ON c."id"=v."contractId" AND c."id"=u."payload"->>'contractId'
  JOIN public."Project" p ON p."id"=c."projectId" AND p."id"=u."payload"->>'projectId'
  WHERE u."archiveId"=p_archive_id AND u."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    AND u."runtimeSessionOid"=session_user::regrole::oid AND u."executorOwnerOid"=current_user::regrole::oid
    AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
    AND receipt."bindingSha256"=public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    AND receipt."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=receipt."issuedAt" AND u."claimedAt"<receipt."expiresAt"
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed' AND a."status"='confirmed'
    AND a."fileId" IS NULL AND a."approvalInstanceId" IS NULL AND a."sealTaskId" IS NULL
    AND a."idempotencyKey"=u."requestKey" AND a."requestSha256"=u."payload"->>'requestSha256'
    AND a."uploadedByUserId"=u."payload"->>'actor' AND a."confirmedByUserId"=a."uploadedByUserId"
    AND a."sourceRevision"=v."draftRevision" AND a."sourceRevision"::text=u."payload"->>'sourceRevision'
    AND pg_catalog.isfinite(a."confirmedAt") AND a."confirmedAt">=(u."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    AND (a."confirmedAt" AT TIME ZONE 'UTC')<receipt."expiresAt"
    AND a."authoritySha256"=encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    AND a."authoritySnapshot"#>>'{sourceBasis,intentPayloadSha256}'=receipt."payloadSha256"
    AND a."authoritySnapshot"->'operatingConsequence'=u."payload"->'operatingConsequence'
    AND a."authoritySnapshot"#>'{sourceBasis,directInput}'=u."payload"->'directInput'
    AND a."authoritySnapshot"#>'{sourceBasis,reviewScope}'=u."payload"#>'{operatingConsequence,reviewScope}'
    AND v."status"='effective' AND v."signingSubjectType"='affiliate' AND v."numericProtocolVersion"=2
    AND v."changeType"='original' AND v."versionNo"=1 AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL
    AND v."effectiveAt"=a."confirmedAt" AND v."taxFactsFrozenAt"=a."confirmedAt"
    AND c."ownerUserId"=a."uploadedByUserId" AND c."voidedAt" IS NULL AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NOT NULL
    AND to_jsonb(p."operatingLedgerEffectiveDate")=u."payload"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
    AND NOT EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=v."id")
    AND NOT EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."sourceType"='contract_version' AND i."sourceBusinessId"=v."id");

  claim:=source.payload;
  authority:=source.authority;
  consequence:=claim->'operatingConsequence';
  expected:=consequence->'expectedSource';
  debtor:=consequence->'debtor';
  creditor:=consequence->'creditor';
  frozen_files:=claim->'orderedEvidence';
  SELECT jsonb_agg(item ORDER BY original.position) INTO actual_files
  FROM jsonb_array_elements(frozen_files) WITH ORDINALITY original(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=source.archive_id
    AND e."contractVersionId"=source.version_id AND e."fileId"=item->>'fileId' AND e."displayOrder"=original.position-1 AND e.xmin=source.row_xid
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."uploadedByUserId"=source.actor AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
  WHERE e."mimeType"=item->>'mimeType' AND e."mimeType"=f."mimeType" AND to_jsonb(e."sizeBytes")=item->'sizeBytes'
    AND e."sizeBytes"=f."sizeBytes" AND e."contentSha256"=item->>'contentSha256' AND e."contentSha256"=f."contentSha256"
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."supersedesFileObjectId"=e."fileId");
  IF actual_files IS NULL OR actual_files IS DISTINCT FROM frozen_files
    OR (SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=source.archive_id)<>jsonb_array_length(frozen_files)
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" a WHERE a."contractVersionId"=source.version_id AND a."slotKey"='direct_signed_originals_v1') THEN
    RAISE EXCEPTION '表外直签经营承诺须使用本事务完整原件' USING ERRCODE='23514';
  END IF;

  gross_text:=claim#>>'{directInput,Q,money,amountYuan}';
  excluded_text:=consequence#>>'{reviewScope,economicExcludedYuan}';
  IF consequence->>'mode' IS DISTINCT FROM 'projection_required'
    OR debtor->>'kind' IS DISTINCT FROM 'construction_enterprise' OR creditor->>'kind' IS DISTINCT FROM 'downstream_counterparty'
    OR nullif(btrim(debtor->>'id'),'') IS NULL OR nullif(btrim(debtor->>'assignmentId'),'') IS NULL
    OR nullif(btrim(debtor->>'name'),'') IS NULL OR nullif(btrim(creditor->>'id'),'') IS NULL OR nullif(btrim(creditor->>'name'),'') IS NULL
    OR claim#>'{directInput,Q,money,numericProtocolVersion}' IS DISTINCT FROM '2'::jsonb
    OR jsonb_typeof(claim#>'{directInput,Q,money,amountYuan}') IS DISTINCT FROM (CASE WHEN gross_text IS NULL THEN 'null' ELSE 'string' END)
    OR jsonb_typeof(consequence#>'{reviewScope,economicExcludedYuan}') IS DISTINCT FROM 'string'
    OR NOT COALESCE(excluded_text ~ '^(0|[1-9][0-9]{0,19})\.[0-9]{4}$',FALSE)
    OR (gross_text IS NOT NULL AND gross_text !~ '^(0|[1-9][0-9]{0,19})\.[0-9]{4}$') THEN
    RAISE EXCEPTION '表外直签经营承诺主体或四位金额不完整' USING ERRCODE='23514';
  END IF;
  IF source.gross IS DISTINCT FROM gross_text::numeric OR (gross_text IS NOT NULL AND excluded_text::numeric>gross_text::numeric) THEN
    RAISE EXCEPTION '表外直签履约排除与原合同金额不匹配' USING ERRCODE='23514';
  END IF;
  amount_text:=CASE WHEN gross_text IS NULL THEN NULL ELSE (gross_text::numeric-excluded_text::numeric)::numeric(24,4)::text END;
  amount_state:=CASE WHEN amount_text IS NULL THEN 'unknown' ELSE 'known' END;
  amount_nature:=CASE WHEN amount_text IS NULL THEN 'uncapped' ELSE 'fixed' END;
  direction:=CASE WHEN amount_text IS NULL THEN 'notice' ELSE 'increase' END;
  fact_key:='contract_version:'||source.version_id;
  impact_key:=fact_key||':commitment';
  IF expected IS DISTINCT FROM jsonb_build_object('sourceType','contract_version','sourceBusinessId',source.version_id,
      'sourceBusinessCode',source.contract_code,'sourceVersion',source.version_no,'entryKind','original','factKind','downstream_contract',
      'factIdempotencyKey',fact_key,'impactIdempotencyKey',impact_key,'sourceImpactKey','contract_commitment_reference',
      'impactKind','contract_commitment_reference','numericProtocolVersion',2,'amountState',amount_state,'amountYuan',amount_text,'direction',direction) THEN
    RAISE EXCEPTION '表外直签经营承诺须与原冻结依据一致' USING ERRCODE='23514';
  END IF;

  ledger_day:=source.ledger_date;
  business_day:=((source.confirmed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
  occurred_text:=to_char(source.confirmed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  numeric_facts:=jsonb_build_object('protocolVersion',2,'amountState',amount_state,'amountYuan',amount_text);
  fact_payload:=jsonb_build_object('id',fact_id,'projectId',source.project_id,'sourceType','contract_version','sourceBusinessId',source.version_id,
    'sourceVersion',source.version_no,'sourceBusinessCode',source.contract_code,'occurredAt',occurred_text,'confirmedAt',occurred_text,
    'affiliateAssignmentId',debtor->>'assignmentId','affiliateBusinessPartyVersionId',debtor->>'id',
    'affiliateNameSnapshot',debtor->>'name','affiliateCreditCodeSnapshot',debtor->>'creditCode',
    'operatingLedgerEffectiveDateSnapshot',ledger_day,'isBeforeOperatingLedgerEffectiveDate',business_day<ledger_day,
    'factKind','downstream_contract','operatingLevel','project','evidenceLevel','A','amountCents',NULL,'amountYuan',amount_text,
    'numericProtocolVersion',2,'currencyCode','CNY','direction','neutral','debtorSubjectKind',debtor->>'kind','debtorSubjectId',debtor->>'id',
    'creditorSubjectKind',creditor->>'kind','creditorSubjectId',creditor->>'id','subjectSnapshot',jsonb_build_object('debtor',debtor,'creditor',creditor),
    'sourceSnapshot',jsonb_build_object('contractId',source.contract_id,'contractVersionId',source.version_id,'contractRelationship','outside',
      'signingSubjectType','affiliate','counterpartyVersionId',creditor->>'id','counterpartySubjectId',creditor->>'id','counterpartyName',creditor->>'name',
      'counterpartyIdentity',creditor,'archiveProtocolVersion',2,'archiveAuthorityId',source.archive_id,'archiveAuthoritySha256',source.authority_sha,
      'archiveSource','direct_signed','intentPayloadSha256',source.intent_sha,'sourceBasisSha256',authority->>'sourceBasisSha256',
      'sourceBasis',authority->'sourceBasis','amountNature',amount_nature,'numericProtocolVersion',2,'numericFacts',numeric_facts,
      'amountYuan',gross_text,'amountState',amount_state,'sourceAmountStatus',source.amount_limit_type,
      'currentAmount',jsonb_build_object('protocolVersion',2,'amountState',amount_state,'amountYuan',gross_text,'sourceAmountStatus',source.amount_limit_type),
      'priorAmount',NULL,'supersedesVersionId',NULL,'economicExcludedYuan',excluded_text,'commitmentDeltaYuan',amount_text,
      'occurredAt',occurred_text,'confirmedAt',occurred_text,'confirmedByUserId',source.actor,
      'operatingLedgerEffectiveDate',ledger_day::text||'T00:00:00.000Z','archiveBusinessDay',business_day,'affiliate',debtor),
    'basisSnapshot',jsonb_build_object('authority','effective_contract_version','amountNature',amount_nature),
    'entryKind','original','idempotencyKey',fact_key,'confirmedByUserId',source.actor,'status','confirmed');
  impact_payload:=jsonb_build_object('id',impact_id,'factId',fact_id,'projectId',source.project_id,'sourceType','contract_version',
    'sourceBusinessId',source.version_id,'sourceImpactKey','contract_commitment_reference','idempotencyKey',impact_key,
    'impactKind','contract_commitment_reference','amountCents',NULL,'amountYuan',amount_text,'numericProtocolVersion',2,'direction',direction,
    'subjectRole','debtor','subjectKind',debtor->>'kind','subjectId',debtor->>'id','description','表外原合同承诺，不形成成本或应付',
    'impactSnapshot',jsonb_build_object('numericFacts',numeric_facts));

  RETURN jsonb_build_object('protocolVersion',2,'actorUserId',source.actor,'fact',fact_payload,'impact',impact_payload,
    'audit',jsonb_build_object('id',pg_catalog.gen_random_uuid()::text,'actorUserId',source.actor,'action','contract.archive.complete',
      'businessType','contract_version','businessId',source.version_id,
      'metadata',jsonb_build_object('archiveId',source.archive_id,'archiveSource','direct_signed','requestSha256',source.request_sha,
        'intentPayloadSha256',source.intent_sha,'operatingFactId',fact_id,'operatingImpactId',impact_id)));
END;
$prepare$;
REVOKE ALL ON FUNCTION public.jg_prepare_direct_outside_operating_commit_v2(TEXT) FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
    WHERE p.oid='public.jg_prepare_direct_outside_operating_commit_v2(text)'::regprocedure
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签经营承诺计划默认必须私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
