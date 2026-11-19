-- The issuer and a future executor can derive identical V2 intent bytes.
-- This migration installs only a private, read-only prerequisite.
BEGIN;
SET LOCAL search_path TO pg_catalog,pg_temp;

DO $predecessors$
BEGIN
  IF 3<>(SELECT count(*) FROM (VALUES
    ('public.jg_contract_upward_pending_read_v1(text,text)','5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4','pg_catalog.jsonb',FALSE,'plpgsql','s','u','search_path=pg_catalog, public'),
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
    RAISE EXCEPTION '对上直签原请求来源前态不匹配' USING ERRCODE='55000';
  END IF;
END;
$predecessors$;

CREATE FUNCTION public.jg_contract_direct_archive_upward_intent_basis_v2(
  p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $basis$
DECLARE
  coordinates JSONB;
  ledger_day DATE;
  actual_input JSONB;
  q JSONB;
  evidence_manifest JSONB;
BEGIN
  -- Reuse the installed request digest and ordered physical-evidence validator.
  -- Replace its V1 relationship/protocol explicitly before returning any bytes.
  coordinates:=public.jg_contract_direct_archive_intent_payload_v1(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);

  SELECT project."operatingLedgerEffectiveDate" INTO ledger_day
  FROM public."ContractVersion" v
  JOIN public."Contract" c ON c."id"=v."contractId"
  JOIN public."Project" project ON project."id"=c."projectId"
  WHERE v."id"=p_version AND c."id"=p_contract AND project."id"=p_project
    AND v."status"='draft' AND v."draftRevision"=p_revision AND v."signingSubjectType"='upward'
    AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL AND project."isActive"
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
    AND NOT EXISTS(SELECT 1 FROM public."ContractSealTask" task WHERE task."contractVersionId"=p_version);
  -- Freeze the configured date; eligibility follows the established operating activation policy.
  IF NOT FOUND THEN
    RAISE EXCEPTION '对上直签当前经办或待登记状态已变化' USING ERRCODE='23514';
  END IF;

  -- Read the canonical V2 Q from PostgreSQL, including the two parties,
  -- active participation/assignment, exact draft terms and original slots.
  actual_input:=public.jg_contract_upward_pending_read_v1(p_version,p_actor);
  q:=actual_input->'Q';
  SELECT jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position)
    INTO evidence_manifest FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS evidence(item,position);
  IF q->'inputProtocolVersion' IS DISTINCT FROM '2'::jsonb
    OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"upward"}'::jsonb
    OR q->'locator' IS DISTINCT FROM jsonb_build_object('projectId',p_project,'contractId',p_contract,
      'contractVersionId',p_version,'versionNo',1,'changeType','original','draftRevision',p_revision)
    OR actual_input->>'inputSha256' IS DISTINCT FROM p_input_sha
    OR actual_input->>'qText' IS DISTINCT FROM q::text
    OR p_input_sha IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex')
    OR q->'signedFiles' IS DISTINCT FROM evidence_manifest
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) AS evidence(item)
      LEFT JOIN public."FileObject" f ON f."id"=item->>'fileId'
      WHERE f."id" IS NULL OR f."uploadedByUserId" IS DISTINCT FROM p_actor
        OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
        OR f."bucket" IS DISTINCT FROM item->>'bucket' OR f."objectKey" IS DISTINCT FROM item->>'objectKey'
        OR f."mimeType" IS DISTINCT FROM item->>'mimeType' OR to_jsonb(f."sizeBytes") IS DISTINCT FROM item->'sizeBytes'
        OR f."contentSha256" IS DISTINCT FROM item->>'contentSha256') THEN
    RAISE EXCEPTION '对上直签资料或有序签章原件已变化' USING ERRCODE='23514';
  END IF;

  RETURN (coordinates-ARRAY['protocolVersion','relationship']) || jsonb_build_object(
    'protocolVersion',2,'relationship','upward','directInput',jsonb_build_object('Q',q,'inputSha256',p_input_sha),
    'operatingConsequence',jsonb_build_object('protocolVersion',1,
      'mode',CASE WHEN ledger_day IS NULL THEN 'not_applicable' ELSE 'internal_reference_only' END,
      'operatingLedgerEffectiveDateSnapshot',ledger_day,'expectedSource',NULL));
END;
$basis$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_upward_intent_basis_v2(
  TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

-- Named default ACLs must not accidentally expose the detached prerequisite.
DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid='public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)'::regprocedure
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '对上直签原请求资格必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private_acl$;

COMMIT;
