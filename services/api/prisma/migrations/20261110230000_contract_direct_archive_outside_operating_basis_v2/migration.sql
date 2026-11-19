-- Private prerequisite for enabled-ledger outside direct signing. Issuance,
-- same-transaction consumption, operating append and durable readback are separate.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

DO $predecessors$
BEGIN
  IF 3<>(SELECT count(*) FROM (VALUES
    ('public.jg_contract_direct_pending_input_v1(text)','24e586804f996807e6c0d28bc5e1401551fc1c73e92eca93cec4a06c50b1f6e9','pg_catalog.jsonb',FALSE,'plpgsql','s','u','search_path=pg_catalog, public'),
    ('public.jg_contract_direct_archive_intent_payload_v1(text,text,text,text,integer,text,text,jsonb)','0ae73d99bde8ae0dc87295d5a296844e8c10fb1a70c8b8f96e1a5aa210db8ddc','pg_catalog.jsonb',TRUE,'plpgsql','s','u','search_path=pg_catalog, pg_temp'),
    ('public.jg_contract_direct_archive_request_sha_v1(text,text,text,text,integer,text,text[])','f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf','pg_catalog.text',TRUE,'sql','i','s','search_path=pg_catalog, pg_temp')
  ) expected(signature,body_sha,result_type,is_strict,language,volatility,parallel,settings)
  JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
    AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=current_user::regrole::oid
    AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(expected.result_type)
    AND NOT p.prosecdef AND NOT p.proretset AND p.proisstrict=expected.is_strict
    AND p.provolatile::text=expected.volatility AND p.proparallel::text=expected.parallel
    AND p.proconfig=ARRAY[expected.settings] AND p.pronargdefaults=0 AND p.provariadic=0
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname=expected.language) THEN
    RAISE EXCEPTION '表外直签经营依据前态不匹配' USING ERRCODE='55000';
  END IF;
END;
$predecessors$;

CREATE FUNCTION public.jg_contract_direct_archive_outside_operating_basis_v2(
  p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $basis$
DECLARE
  at_utc CONSTANT TIMESTAMP:=statement_timestamp() AT TIME ZONE 'UTC';
  coordinates JSONB;
  scope RECORD;
  actual_input JSONB;
  q JSONB;
  evidence_manifest JSONB;
  downstream_party JSONB;
  amount TEXT;
BEGIN
  coordinates:=public.jg_contract_direct_archive_intent_payload_v1(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);

  SELECT COALESCE(c."code",c."temporaryCode",c."name") AS source_code,
    project."operatingLedgerEffectiveDate"::date AS ledger_day,
    v."affiliateAssignmentId" AS assignment_id, v."affiliateBusinessPartyVersionId" AS enterprise_version
  INTO scope
  FROM public."ContractVersion" v
  JOIN public."Contract" c ON c."id"=v."contractId"
  JOIN public."Project" project ON project."id"=c."projectId"
  WHERE v."id"=p_version AND c."id"=p_contract AND project."id"=p_project
    AND v."status"='draft' AND v."draftRevision"=p_revision AND v."signingSubjectType"='affiliate'
    AND v."numericProtocolVersion"=2 AND v."versionNo"=1 AND v."changeType"='original'
    AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL
    AND v."taxFactsFrozenAt" IS NULL AND v."documentContentFingerprint" IS NULL AND v."endedAt" IS NULL
    AND v."companyEntityIdSnapshot" IS NULL AND v."companyEntityVersionId" IS NULL
    AND c."companyEntityId" IS NULL AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL
    AND project."isActive" AND project."operatingLedgerEffectiveDate" IS NOT NULL
    AND EXISTS(SELECT 1 FROM public."User" u WHERE u."id"=p_actor AND u."isActive")
    AND (EXISTS(SELECT 1 FROM public."ProjectMember" member WHERE member."projectId"=p_project
          AND member."userId"=p_actor AND member."positionKey"='contract_staff')
      OR EXISTS(SELECT 1 FROM public."UserPosition" assignment
        JOIN public."Position" position ON position."id"=assignment."positionId"
        WHERE assignment."userId"=p_actor AND assignment."projectId" IS NULL
          AND position."key"='contract_director'))
    AND NOT EXISTS(SELECT 1 FROM public."ContractArchiveFile" a
      WHERE a."contractVersionId"=p_version OR a."idempotencyKey"=p_key)
    AND NOT EXISTS(SELECT 1 FROM public."ApprovalInstance" round
      WHERE round."businessType"='contract_version' AND round."businessId"=p_version)
    AND NOT EXISTS(SELECT 1 FROM public."ContractSealTask" task WHERE task."contractVersionId"=p_version)
    AND NOT EXISTS(SELECT 1 FROM public."OperatingFact" fact
      WHERE fact."sourceType"='contract_version' AND fact."sourceBusinessId"=p_version)
    AND NOT EXISTS(SELECT 1 FROM public."OperatingImpactEntry" impact
      WHERE impact."sourceType"='contract_version' AND impact."sourceBusinessId"=p_version)
    AND NOT EXISTS(SELECT 1 FROM public."ContractEconomicReview" review WHERE review."projectId"=p_project
      AND review."status" IN ('pending_review','pending_finance','confirmed')
      AND ('contract:'||p_contract) IN (review."leftSourceRef",review."rightSourceRef"));
  IF NOT FOUND THEN
    RAISE EXCEPTION '表外直签的经办、经营账或履约依据尚未确认' USING ERRCODE='23514';
  END IF;

  actual_input:=public.jg_contract_direct_pending_input_v1(p_version);
  q:=actual_input->'Q';
  SELECT jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
    INTO evidence_manifest FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS evidence(item,position);
  IF actual_input->>'state' IS DISTINCT FROM 'complete'
    OR q->'inputProtocolVersion' IS DISTINCT FROM '1'::jsonb
    OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"outside"}'::jsonb
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',p_project,'contractId',p_contract,
      'contractVersionId',p_version,'versionNo',1,'changeType','original','draftRevision',p_revision)
    OR actual_input->>'inputSha256' IS DISTINCT FROM p_input_sha
    OR p_input_sha IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex')
    OR q->'signedFiles' IS DISTINCT FROM evidence_manifest
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) AS evidence(item)
      LEFT JOIN public."FileObject" f ON f."id"=item->>'fileId'
      WHERE f."id" IS NULL OR f."uploadedByUserId" IS DISTINCT FROM p_actor
        OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
        OR f."bucket" IS DISTINCT FROM item->>'bucket' OR f."objectKey" IS DISTINCT FROM item->>'objectKey'
        OR f."mimeType" IS DISTINCT FROM item->>'mimeType' OR to_jsonb(f."sizeBytes") IS DISTINCT FROM item->'sizeBytes'
        OR f."contentSha256" IS DISTINCT FROM item->>'contentSha256') THEN
    RAISE EXCEPTION '表外直签资料或有序签章原件已变化' USING ERRCODE='23514';
  END IF;

  SELECT jsonb_build_object('kind','downstream_counterparty','id',downstream."id",
    'businessPartyId',downstream."businessPartyId",'contractPartySnapshotId',slot."id",
    'name',btrim(downstream."snapshot"->>'name'),'creditCode',nullif(btrim(downstream."snapshot"->>'unifiedSocialCreditCode'),''))
  INTO downstream_party
  FROM public."ProjectAffiliateAssignment" assignment
  JOIN public."ContractPartySnapshot" slot ON slot."contractVersionId"=p_version
  JOIN public."BusinessPartyVersion" downstream ON downstream."id"=slot."businessPartyVersionId"
  WHERE assignment."id"=scope.assignment_id AND assignment."projectId"=p_project
    AND assignment."businessPartyVersionId"=scope.enterprise_version
    AND assignment."effectiveFrom"<=at_utc AND (assignment."endedAt" IS NULL OR assignment."endedAt">at_utc)
    AND assignment."id"=q#>>'{subjects,enterprise,assignmentId}'
    AND assignment."businessPartyId"=q#>>'{subjects,enterprise,businessPartyId}'
    AND NOT EXISTS(SELECT 1 FROM public."ProjectAffiliateAssignment" other
      WHERE other."projectId"=p_project AND other."id"<>assignment."id"
        AND other."effectiveFrom"<=at_utc AND (other."endedAt" IS NULL OR other."endedAt">at_utc))
    AND slot."id"=q#>>'{subjects,roles,counterpartyCpsId}'
    AND downstream."businessPartyId"<>assignment."businessPartyId"
    AND length(btrim(downstream."snapshot"->>'name'))>0
    AND NOT COALESCE(upper(nullif(btrim(downstream."snapshot"->>'unifiedSocialCreditCode'),''))
      =upper(nullif(btrim(assignment."affiliateCreditCodeSnapshot"),'')),false);
  IF NOT FOUND THEN
    RAISE EXCEPTION '表外直签的施工企业或下游签约主体已变化' USING ERRCODE='23514';
  END IF;

  amount:=q#>>'{money,amountYuan}';
  IF q#>'{money,numericProtocolVersion}' IS DISTINCT FROM '2'::jsonb
    OR (amount IS NOT NULL AND amount !~ '^(0|[1-9][0-9]{0,19})\.[0-9]{4}$') THEN
    RAISE EXCEPTION '表外直签的合同承诺金额不完整' USING ERRCODE='23514';
  END IF;

  RETURN (coordinates-'protocolVersion') || jsonb_build_object('protocolVersion',2,
    'directInput',jsonb_build_object('Q',q,'inputSha256',p_input_sha),
    'operatingConsequence',jsonb_build_object('protocolVersion',1,'mode','projection_required',
      'operatingLedgerEffectiveDateSnapshot',scope.ledger_day,
      'reviewScope',jsonb_build_object('economicExcludedYuan','0.0000','sources','[]'::jsonb),
      'debtor',(q#>'{subjects,enterprise}') || jsonb_build_object('kind','construction_enterprise','id',scope.enterprise_version),
      'creditor',downstream_party,
      'expectedSource',jsonb_build_object('sourceType','contract_version','sourceBusinessId',p_version,
        'sourceBusinessCode',scope.source_code,'sourceVersion',1,'entryKind','original',
        'factKind','downstream_contract','factIdempotencyKey','contract_version:'||p_version,
        'impactIdempotencyKey','contract_version:'||p_version||':commitment',
        'sourceImpactKey','contract_commitment_reference','impactKind','contract_commitment_reference',
        'numericProtocolVersion',2,'amountState',CASE WHEN amount IS NULL THEN 'unknown' ELSE 'known' END,
        'amountYuan',amount,'direction',CASE WHEN amount IS NULL THEN 'notice' ELSE 'increase' END)));
END;
$basis$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_outside_operating_basis_v2(
  TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid='public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)'::regprocedure
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签经营依据必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private_acl$;

COMMIT;
