BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Recovery proof only. No grants, registration writes or legacy guard replacements.
CREATE FUNCTION public.jg_contract_direct_archive_request_sha_v1(
  p_contract_id TEXT, p_version_id TEXT, p_actor TEXT, p_key TEXT,
  p_revision INTEGER, p_input_sha256 TEXT, p_file_ids TEXT[]
) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $request_sha$
  SELECT pg_catalog.encode(public.digest(pg_catalog.convert_to(
    pg_catalog.string_agg(pg_catalog.octet_length(pg_catalog.convert_to(part, 'UTF8'))::text || ':' || part, '' ORDER BY position),
    'UTF8'), 'sha256'), 'hex')
  FROM pg_catalog.unnest(ARRAY['contract-direct-archive-request-v1', '2', 'direct_signed',
    p_contract_id, p_version_id, p_actor, p_key, p_revision::text, p_input_sha256, pg_catalog.cardinality(p_file_ids)::text]
    || p_file_ids || ARRAY['true']) WITH ORDINALITY AS request_part(part, position);
$request_sha$;

CREATE FUNCTION public.jg_contract_direct_archive_proof_v1(p_archive_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT PARALLEL UNSAFE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $archive_proof$
DECLARE
  a RECORD; v RECORD; c RECORD;
  authority JSONB; basis JSONB; q JSONB; manifest JSONB; terms JSONB; review_scope JSONB;
  input_sha TEXT; basis_sha TEXT; manifest_sha TEXT; request_sha TEXT; archived_at TEXT; business_day TEXT;
  evidence JSONB; file_ids TEXT[]; response JSONB;
BEGIN
  SELECT "id","contractVersionId","archiveProtocolVersion","archiveSource","status","fileId",
    "uploadedByUserId","confirmedByUserId","confirmedAt","idempotencyKey","requestSha256","sourceRevision",
    "approvalInstanceId","sealTaskId","documentContentRevision","documentContentFingerprint",
    "authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot"
  INTO a FROM public."ContractArchiveFile" WHERE "id"=p_archive_id;
  IF NOT FOUND OR a."archiveProtocolVersion" IS DISTINCT FROM 2 OR a."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR a."status" IS DISTINCT FROM 'confirmed' OR a."fileId" IS NOT NULL OR a."confirmedAt" IS NULL
    OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR a."approvalInstanceId" IS NOT NULL OR a."sealTaskId" IS NOT NULL
    OR a."documentContentRevision" IS NOT NULL OR a."documentContentFingerprint" IS NOT NULL
    OR a."idempotencyKey" IS NULL OR a."idempotencyKey" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR a."sourceRevision" IS NULL OR a."sourceRevision"<1 THEN RETURN NULL; END IF;

  SELECT "id","contractId","versionNo","numericProtocolVersion","changeType","supersedesVersionId","status",
    "effectiveAt","taxFactsFrozenAt","firstSubmittedAt","endedAt","signingSubjectType","draftRevision","documentContentFingerprint",
    "originalSignedNumber","affiliateAssignmentId","affiliateBusinessPartyVersionId","draftData"
  INTO v FROM public."ContractVersion" WHERE "id"=a."contractVersionId";
  IF NOT FOUND OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."versionNo" IS DISTINCT FROM 1
    OR v."changeType" IS DISTINCT FROM 'original' OR v."supersedesVersionId" IS NOT NULL
    OR v."status" IS DISTINCT FROM 'effective' OR v."effectiveAt" IS DISTINCT FROM a."confirmedAt"
    OR v."taxFactsFrozenAt" IS DISTINCT FROM a."confirmedAt" OR v."firstSubmittedAt" IS NOT NULL OR v."endedAt" IS NOT NULL
    OR v."draftRevision" IS DISTINCT FROM a."sourceRevision" OR v."documentContentFingerprint" IS NOT NULL
    OR v."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR v."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR v."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside' THEN RETURN NULL; END IF;

  SELECT "id","projectId" INTO c FROM public."Contract" WHERE "id"=v."contractId";
  IF NOT FOUND THEN RETURN NULL; END IF;
  authority := a."authoritySnapshot";
  basis := authority -> 'sourceBasis';
  q := basis #> '{directInput,Q}';
  input_sha := basis #>> '{directInput,inputSha256}';
  manifest := authority -> 'fileManifest';
  terms := q #> '{terms,paymentTerms}';
  review_scope := basis -> 'reviewScope';
  IF jsonb_typeof(q) IS DISTINCT FROM 'object'
    OR q->'inputProtocolVersion' IS DISTINCT FROM '1'::jsonb
    OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"outside"}'::jsonb
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',c."projectId",'contractId',c."id",'contractVersionId',v."id",
      'versionNo',1,'changeType','original','draftRevision',a."sourceRevision")
    OR q#>'{contract,originalSignedNumber}' IS DISTINCT FROM COALESCE(to_jsonb(v."originalSignedNumber"),'null'::jsonb)
    OR q#>'{contract,signedOn}' IS DISTINCT FROM v."draftData"#>'{directSigningInput,signedOn}'
    OR v."affiliateAssignmentId" IS NULL OR q#>>'{subjects,enterprise,assignmentId}' IS DISTINCT FROM v."affiliateAssignmentId"
    OR v."affiliateBusinessPartyVersionId" IS NULL OR q#>>'{subjects,enterprise,businessPartyVersionId}' IS DISTINCT FROM v."affiliateBusinessPartyVersionId"
    OR input_sha IS DISTINCT FROM pg_catalog.encode(public.digest(pg_catalog.convert_to(q::text,'UTF8'),'sha256'),'hex')
    OR jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR manifest IS DISTINCT FROM q->'signedFiles'
    OR jsonb_typeof(review_scope) IS DISTINCT FROM 'object' OR review_scope->>'excludedAmountYuan' IS DISTINCT FROM '0.0000'
    OR jsonb_typeof(review_scope->'sources') IS DISTINCT FROM 'array'
    OR (review_scope - ARRAY['excludedAmountYuan','sources']) IS DISTINCT FROM '{}'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_array_length(manifest) NOT BETWEEN 1 AND 20 THEN RETURN NULL; END IF;

  IF terms='null'::jsonb THEN
    IF v."draftData"#>'{directSigningInput,fixedPaymentTermsVersionId}' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
  ELSIF jsonb_typeof(terms) IS DISTINCT FROM 'object' OR terms->>'id' IS NULL
    OR v."draftData"#>>'{directSigningInput,fixedPaymentTermsVersionId}' IS DISTINCT FROM terms->>'id'
    OR NOT EXISTS (SELECT 1 FROM public."PaymentTermsVersion" t
      WHERE t."id"=terms->>'id' AND t."contractId"=c."id" AND t."contractVersionId"=v."id" AND t."status"='effective'
        AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText",'stages','[]'::jsonb)
        AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" ts WHERE ts."paymentTermsVersionId"=t."id")) THEN RETURN NULL;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",
    'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder"),
    array_agg(e."fileId" ORDER BY e."displayOrder")
  INTO evidence,file_ids FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id" AND e."contractVersionId"=v."id";
  IF evidence IS DISTINCT FROM manifest OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(manifest) WITH ORDINALITY AS m(item,position)
    WHERE m.item->>'displayOrder' IS DISTINCT FROM (m.position-1)::text
      OR m.item->>'fileId' IS NULL OR m.item->>'fileId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) OR EXISTS (
    SELECT 1 FROM public."ContractArchiveEvidenceFile" e LEFT JOIN public."FileObject" f ON f."id"=e."fileId"
    WHERE e."archiveFileId"=a."id" AND (e."contractVersionId" IS DISTINCT FROM v."id" OR f."id" IS NULL
      OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
      OR f."mimeType" IS DISTINCT FROM e."mimeType" OR f."sizeBytes" IS DISTINCT FROM e."sizeBytes"
      OR f."contentSha256" IS DISTINCT FROM e."contentSha256"
      OR EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."supersedesFileObjectId"=e."fileId"))
  ) OR EXISTS (SELECT 1 FROM public."ContractDraftAttachment" da WHERE da."contractVersionId"=v."id" AND da."slotKey"='direct_signed_originals_v1')
  THEN RETURN NULL; END IF;

  archived_at := to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  business_day := to_char((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD');
  IF basis IS DISTINCT FROM jsonb_build_object('basisProtocolVersion',1,'directInput',jsonb_build_object('Q',q,'inputSha256',input_sha),
    'fileManifest',manifest,'businessTime',jsonb_build_object('archivedAt',archived_at,'businessDay',business_day,'handlerUserId',a."uploadedByUserId"),
    'reviewScope',review_scope) THEN RETURN NULL; END IF;
  basis_sha := pg_catalog.encode(public.digest(pg_catalog.convert_to(basis::text,'UTF8'),'sha256'),'hex');
  manifest_sha := pg_catalog.encode(public.digest(pg_catalog.convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  request_sha := public.jg_contract_direct_archive_request_sha_v1(c."id",v."id",a."uploadedByUserId",a."idempotencyKey",a."sourceRevision",input_sha,file_ids);
  IF request_sha IS NULL OR a."requestSha256" IS DISTINCT FROM request_sha
    OR a."fileManifestSha256" IS DISTINCT FROM manifest_sha
    OR authority IS DISTINCT FROM jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed','projectId',c."projectId",'contractId',c."id",
      'contractVersionId',v."id",'handlerUserId',a."uploadedByUserId",'archivedAt',archived_at,'requestSha256',request_sha,'sourceRevision',a."sourceRevision",
      'sourceBasis',basis,'sourceBasisSha256',basis_sha,'fileManifest',manifest,'fileManifestSha256',manifest_sha,
      'operatingConsequence',jsonb_build_object('protocolVersion',1,'mode','not_applicable','operatingLedgerEffectiveDateSnapshot',NULL,'expectedSource',NULL))
    OR a."authoritySha256" IS DISTINCT FROM pg_catalog.encode(public.digest(pg_catalog.convert_to(authority::text,'UTF8'),'sha256'),'hex')
    THEN RETURN NULL; END IF;

  response := jsonb_build_object('archiveId',a."id",'contractVersionId',v."id",'status','effective','fileIds',to_jsonb(file_ids));
  IF a."responseSnapshot" IS DISTINCT FROM response THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('proofProtocolVersion',1,'contractId',c."id",'projectId',c."projectId",'contractVersionId',v."id",
    'archiveId',a."id",'handlerUserId',a."uploadedByUserId",'idempotencyKey',a."idempotencyKey",'requestSha256',request_sha,
    'authoritySha256',a."authoritySha256",'sourceRevision',a."sourceRevision",'inputSha256',input_sha,
    'fileIds',to_jsonb(file_ids),'result',response);
END;
$archive_proof$;

REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_request_sha_v1(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_proof_v1(TEXT) FROM PUBLIC;
COMMIT;
