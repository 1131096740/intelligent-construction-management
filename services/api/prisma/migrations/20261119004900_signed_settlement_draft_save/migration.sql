BEGIN;

CREATE TABLE public.jg_signed_settlement_draft_witness_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (pg_catalog.octet_length("key") = 32)
);
REVOKE ALL ON TABLE public.jg_signed_settlement_draft_witness_key FROM PUBLIC;

CREATE FUNCTION public.jg_save_signed_settlement_draft_v1(
  p_project text, p_actor text, p_settlement text, p_revision integer, p_kind text, p_contract text,
  p_number text, p_amount text, p_file_json text, p_expiry text, p_proof text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
-- The existing binding trigger resolves fixed predecessor tables and routines in public.
SET search_path=pg_catalog,public,pg_temp AS $save$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  version record;
  draft public."SignedContractSettlement"%ROWTYPE;
  files text[];
  files_json jsonb;
  eligible_count bigint;
  attachments jsonb;
  changed_at timestamp(3) := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(p_expiry ~ '^[0-9]{10}$' AND p_proof ~ '^[0-9a-f]{64}$',false)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_WITNESS' USING ERRCODE='42501'; END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_draft_witness_key WHERE singleton;
  SELECT convert_to(string_agg(coalesce(encode(convert_to(value,'UTF8'),'hex'),'-'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_draft_save_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,
      p_project,p_actor,p_settlement,p_revision::text,p_kind,p_contract,p_number,p_amount,p_file_json
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_WITNESS' USING ERRCODE='42501'; END IF;

  IF NOT coalesce(p_kind IN ('downstream','outside_fact','upward'),false)
    OR (p_number IS NOT NULL AND (length(p_number)>100 OR btrim(p_number)=''))
    OR (p_amount IS NOT NULL AND p_amount !~ '^-?(0|[1-9][0-9]{0,19})\.[0-9]{4}$')
    OR (p_settlement IS NULL AND p_revision IS NOT NULL)
    OR (p_settlement IS NOT NULL AND NOT coalesce(p_revision>0,false))
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_INPUT' USING ERRCODE='22023'; END IF;
  files_json := p_file_json::jsonb;
  IF jsonb_typeof(files_json) IS DISTINCT FROM 'array' OR jsonb_array_length(files_json)>30
    OR EXISTS (SELECT FROM jsonb_array_elements(files_json) f(value) WHERE jsonb_typeof(f.value)<>'string')
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_INPUT' USING ERRCODE='22023'; END IF;
  files := ARRAY(SELECT jsonb_array_elements_text(files_json));
  IF cardinality(files)<>(SELECT count(DISTINCT f.id) FROM unnest(files) f(id))
    OR EXISTS (SELECT FROM unnest(files) f(id) WHERE btrim(f.id)='' OR length(f.id)>128)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_INPUT' USING ERRCODE='22023'; END IF;

  PERFORM FROM public."Project" p JOIN public."User" actor ON actor.id=p_actor AND actor."isActive"
    WHERE p.id=p_project AND p."isActive"
      AND (EXISTS (
        SELECT FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
        WHERE up."userId"=actor.id AND (up."projectId" IS NULL OR up."projectId"=p.id)
          AND pos.key IN ('contract_staff','contract_director')
        FOR SHARE OF up,pos
      ) OR EXISTS (
        SELECT FROM public."ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=actor.id
          AND m."positionKey" IN ('contract_staff','contract_director') FOR SHARE OF m
      )) FOR SHARE OF p,actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_DENIED' USING ERRCODE='42501'; END IF;

  IF p_kind='downstream' THEN
    SELECT v."signingSubjectType",v."companyEntityIdSnapshot",v."companyEntityVersionId",
      v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId" INTO version
      FROM public."ContractVersion" v
      JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=p_project AND c."voidedAt" IS NULL
      WHERE c.id=p_contract AND v.status='effective' ORDER BY v."versionNo" DESC LIMIT 1 FOR SHARE OF v,c;
    IF NOT FOUND OR NOT coalesce(
      (version."signingSubjectType"='our_company' AND (nullif(version."companyEntityIdSnapshot",'') IS NOT NULL OR nullif(version."companyEntityVersionId",'') IS NOT NULL))
      OR (version."signingSubjectType"='affiliate' AND nullif(version."affiliateAssignmentId",'') IS NOT NULL AND nullif(version."affiliateBusinessPartyVersionId",'') IS NOT NULL),false)
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT' USING ERRCODE='P0002'; END IF;
  ELSIF p_kind='outside_fact' THEN
    PERFORM FROM public."ProjectAffiliateContractFact" c WHERE c."projectId"=p_project AND c."ledgerId"=p_contract
      AND c."entryKind"='original' AND c.status='confirmed' FOR SHARE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT' USING ERRCODE='P0002'; END IF;
    IF EXISTS (SELECT FROM public."ProjectAffiliateSettlementFact" s WHERE s."projectId"=p_project AND s."contractLedgerId"=p_contract
      AND s.status='confirmed' AND s."affiliateCompanyContractId" IS NOT NULL)
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT_ALIAS' USING ERRCODE='23514'; END IF;
  ELSE
    PERFORM FROM public."ProjectAffiliateCompanyContract" c WHERE c.id=p_contract AND c."projectId"=p_project AND c.status='confirmed' FOR SHARE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT' USING ERRCODE='P0002'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(190731,13);
  IF p_settlement IS NOT NULL THEN
    SELECT s.* INTO draft FROM public."SignedContractSettlement" s
      WHERE s.id=p_settlement AND s."projectId"=p_project FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_MISSING' USING ERRCODE='P0002'; END IF;
    IF draft."ownerUserId"<>p_actor
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_OWNER' USING ERRCODE='42501'; END IF;
    IF draft.state NOT IN ('draft','returned') OR draft.revision<>p_revision
      OR draft."contractKind"<>p_kind OR draft."contractId"<>p_contract
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONFLICT' USING ERRCODE='23514'; END IF;
  END IF;

  SELECT count(*) INTO eligible_count FROM (
    SELECT f.id FROM public."FileObject" f WHERE f.id=ANY(files)
      AND f."uploadedByUserId"=p_actor AND f."storageStatus"='active'
      AND f."contentSha256" ~ '^[0-9a-f]{64}$' AND f."sizeBytes">0 AND f."supersedesFileObjectId" IS NULL
      AND f."mimeType" IN ('application/pdf','image/png','image/jpeg')
      AND starts_with(f."objectKey",'uploads/signed-contract-settlement/' || encode(sha256(convert_to(p_project,'UTF8')),'hex') || '/')
    FOR SHARE OF f
  ) eligible;
  IF cardinality(files)<>eligible_count
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_FILE' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT FROM public."SignedContractSettlementAttachment" a
    WHERE a."fileId"=ANY(files) AND a."settlementId" IS DISTINCT FROM p_settlement)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_FILE_BOUND' USING ERRCODE='23505'; END IF;

  IF p_settlement IS NULL THEN
    INSERT INTO public."SignedContractSettlement"(id,"projectId","contractKind","contractId","ownerUserId",number,"amountYuan","createdAt","updatedAt")
      VALUES(gen_random_uuid()::text,p_project,p_kind,p_contract,p_actor,p_number,p_amount::numeric,changed_at,changed_at)
      RETURNING * INTO draft;
  ELSE
    UPDATE public."SignedContractSettlement" s SET state='draft',number=p_number,"amountYuan"=p_amount::numeric,
      revision=s.revision+1,"updatedAt"=changed_at WHERE s.id=draft.id
      RETURNING s.* INTO draft;
  END IF;
  DELETE FROM public."SignedContractSettlementAttachment" a WHERE a."settlementId"=draft.id AND NOT (a."fileId"=ANY(files));
  INSERT INTO public."SignedContractSettlementAttachment"("settlementId","fileId",sha256)
    SELECT draft.id,f.id,f."contentSha256" FROM public."FileObject" f WHERE f.id=ANY(files)
      AND NOT EXISTS (SELECT FROM public."SignedContractSettlementAttachment" a WHERE a."settlementId"=draft.id AND a."fileId"=f.id);
  INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId","createdAt")
    VALUES(gen_random_uuid()::text,p_actor,'settlement.signed_draft_saved','settlement',draft.id,changed_at);
  SELECT coalesce(jsonb_agg(jsonb_build_object('fileId',f.id,'originalName',f."originalName",'mimeType',f."mimeType") ORDER BY requested.ordinal),'[]'::jsonb)
    INTO attachments FROM unnest(files) WITH ORDINALITY requested(id,ordinal) JOIN public."FileObject" f ON f.id=requested.id;
  RETURN to_jsonb(draft) || jsonb_build_object(
    'amountYuan',draft."amountYuan"::text,'confirmationNo',draft."confirmationNo"::text,'attachments',attachments,
    'createdAt',to_char(draft."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(draft."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'submittedAt',to_char(draft."submittedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reviewedAt',to_char(draft."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'canUpdate',true,'canReview',false,'selfReview',true,'duplicateNumber',EXISTS (
      SELECT FROM public."SignedContractSettlement" original WHERE original.id<>draft.id
        AND original."projectId"=p_project AND original."contractKind"=p_kind AND original."contractId"=p_contract AND original.number=p_number
    )
  );
END;
$save$;

REVOKE ALL ON FUNCTION public.jg_save_signed_settlement_draft_v1(text,text,text,integer,text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
