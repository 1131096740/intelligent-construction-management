BEGIN;

CREATE FUNCTION public.jg_submit_signed_settlement_draft_v1(
  p_project text, p_settlement text, p_actor text, p_revision integer, p_expiry text, p_proof text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $submit$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  submitted_at timestamp(3);
  draft public."SignedContractSettlement"%ROWTYPE;
  version record;
  position_roles record;
  membership_roles record;
  source_count bigint;
  historical_cents numeric;
  legacy_cents numeric;
  confirmed_yuan numeric;
  pending_deductions numeric;
  expected_yuan numeric;
  attachments jsonb;
  attachment_count bigint;
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_WITNESS' USING ERRCODE='42501'; END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_draft_witness_key WHERE singleton;
  SELECT convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_draft_submit_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_project,p_settlement,p_actor,p_revision::text
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_WITNESS' USING ERRCODE='42501'; END IF;

  PERFORM FROM public."Project" p JOIN public."User" actor ON actor.id=p_actor AND actor."isActive"
    WHERE p.id=p_project AND p."isActive" FOR SHARE OF p,actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_DENIED' USING ERRCODE='42501'; END IF;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role='contract_director'),false) AS director INTO position_roles
    FROM (
      SELECT pos.key AS role FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
      WHERE up."userId"=p_actor AND (up."projectId" IS NULL OR up."projectId"=p_project)
        AND pos.key IN ('contract_staff','contract_director') FOR SHARE OF up,pos
    ) scoped;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role='contract_director'),false) AS director INTO membership_roles
    FROM (
      SELECT m."positionKey" AS role FROM public."ProjectMember" m
      WHERE m."projectId"=p_project AND m."userId"=p_actor AND m."positionKey" IN ('contract_staff','contract_director') FOR SHARE OF m
    ) scoped;
  IF position_roles.allowed+membership_roles.allowed=0
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_DENIED' USING ERRCODE='42501'; END IF;

  SELECT s.* INTO draft FROM public."SignedContractSettlement" s WHERE s.id=p_settlement AND s."projectId"=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_MISSING' USING ERRCODE='P0002'; END IF;
  IF draft."ownerUserId"<>p_actor THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_OWNER' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('signed-settlement:'||draft."contractKind"||':'||draft."contractId",0));
  SELECT s.* INTO draft FROM public."SignedContractSettlement" s
    WHERE s.id=p_settlement AND s."projectId"=p_project FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_MISSING' USING ERRCODE='P0002'; END IF;
  IF draft."ownerUserId"<>p_actor THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_OWNER' USING ERRCODE='42501'; END IF;
  IF draft.state NOT IN ('draft','returned') OR draft.revision<>p_revision
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONFLICT' USING ERRCODE='23514'; END IF;
  IF draft.number IS NULL OR btrim(draft.number)='' OR draft."amountYuan" IS NULL OR draft."amountYuan"=0
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_REQUIRED' USING ERRCODE='22023'; END IF;

  IF draft."contractKind"='downstream' THEN
    SELECT v."signingSubjectType",v."companyEntityIdSnapshot",v."companyEntityVersionId",
      v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId" INTO version
      FROM public."ContractVersion" v
      JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=p_project AND c."voidedAt" IS NULL
      WHERE c.id=draft."contractId" AND v.status='effective' ORDER BY v."versionNo" DESC LIMIT 1 FOR SHARE OF v,c;
    IF NOT FOUND OR NOT coalesce(
      (version."signingSubjectType"='our_company' AND (nullif(version."companyEntityIdSnapshot",'') IS NOT NULL OR nullif(version."companyEntityVersionId",'') IS NOT NULL))
      OR (version."signingSubjectType"='affiliate' AND nullif(version."affiliateAssignmentId",'') IS NOT NULL AND nullif(version."affiliateBusinessPartyVersionId",'') IS NOT NULL),false)
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;

    SELECT count(*),coalesce(sum(t."historicalSettledCents"),0) INTO source_count,historical_cents
      FROM public."ContractTakeover" t WHERE t."projectId"=p_project AND t."contractId"=draft."contractId"
        AND t."takeoverStatus"='confirmed' AND t."historicalBalanceConfirmedAt" IS NOT NULL;
    IF source_count>1 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_LEGACY' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(s."amountCents"),0)+historical_cents INTO legacy_cents
      FROM public."Settlement" s WHERE s."projectId"=p_project AND s."contractId"=draft."contractId"
      AND s.status IN ('effective','partially_paid','paid') AND s."sourceTakeoverId" IS NULL AND s."sourceType"<>'historical_takeover';
  ELSE
    IF draft."contractKind"='outside_fact' THEN
      PERFORM FROM public."ProjectAffiliateContractFact" c WHERE c."projectId"=p_project AND c."ledgerId"=draft."contractId"
        AND c."entryKind"='original' AND c.status='confirmed' FOR SHARE OF c;
      IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;
      IF EXISTS (SELECT FROM public."ProjectAffiliateSettlementFact" s WHERE s."projectId"=p_project AND s."contractLedgerId"=draft."contractId"
        AND s.status='confirmed' AND s."affiliateCompanyContractId" IS NOT NULL)
      THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_ALIAS' USING ERRCODE='23514'; END IF;
    ELSE
      PERFORM FROM public."ProjectAffiliateCompanyContract" c WHERE c.id=draft."contractId" AND c."projectId"=p_project AND c.status='confirmed' FOR SHARE OF c;
      IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;
    END IF;
    SELECT coalesce(sum(CASE s."effectDirection" WHEN 'increase' THEN s."amountCents"::numeric WHEN 'decrease' THEN -s."amountCents"::numeric END),0),
      count(*) FILTER (WHERE NOT coalesce(s."effectDirection" IN ('increase','decrease'),false))
      INTO legacy_cents,source_count FROM public."ProjectAffiliateSettlementFact" s
      WHERE s."projectId"=p_project AND s.status='confirmed'
        AND ((draft."contractKind"='upward' AND s."affiliateCompanyContractId"=draft."contractId")
          OR (draft."contractKind"='outside_fact' AND s."contractLedgerId"=draft."contractId" AND s."affiliateCompanyContractId" IS NULL));
    IF source_count>0 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_LEGACY' USING ERRCODE='23514'; END IF;
  END IF;

  SELECT count(*),jsonb_agg(jsonb_build_object('fileId',f.id,'originalName',f."originalName",'mimeType',f."mimeType") ORDER BY f.id)
    INTO attachment_count,attachments FROM (
      SELECT file.id,file."originalName",file."mimeType" FROM public."SignedContractSettlementAttachment" a
      JOIN public."FileObject" file ON file.id=a."fileId" AND file."storageStatus"='active' AND file."contentSha256"=a.sha256
      WHERE a."settlementId"=draft.id FOR SHARE OF a,file
    ) f;
  IF attachment_count=0 OR attachment_count<>(SELECT count(*) FROM public."SignedContractSettlementAttachment" a WHERE a."settlementId"=draft.id)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_FILE' USING ERRCODE='22023'; END IF;

  SELECT coalesce(sum(s."amountYuan") FILTER (WHERE s.state='confirmed'),0)+legacy_cents/100,
    coalesce(sum(s."amountYuan") FILTER (WHERE s.state='pending_review' AND s."amountYuan"<0),0)
    INTO confirmed_yuan,pending_deductions
    FROM public."SignedContractSettlement" s WHERE s."projectId"=p_project AND s."contractKind"=draft."contractKind"
      AND s."contractId"=draft."contractId" AND s.state IN ('confirmed','pending_review') AND s.id<>draft.id;
  expected_yuan := confirmed_yuan+draft."amountYuan";
  IF expected_yuan<0 OR (draft."amountYuan"<0 AND expected_yuan+pending_deductions<0)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CAPACITY' USING ERRCODE='23514'; END IF;

  submitted_at := clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SignedContractSettlement" s SET state='pending_review',"submittedAt"=submitted_at,
    "reviewedAt"=NULL,"reviewedByUserId"=NULL,"reviewReason"=NULL,revision=s.revision+1,"updatedAt"=submitted_at
    WHERE s.id=draft.id RETURNING s.* INTO draft;
  INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId","createdAt")
    VALUES(gen_random_uuid()::text,p_actor,'settlement.signed_submitted','settlement',draft.id,submitted_at);
  RETURN to_jsonb(draft) || jsonb_build_object(
    'amountYuan',draft."amountYuan"::text,'confirmationNo',draft."confirmationNo"::text,'attachments',attachments,
    'createdAt',to_char(draft."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(draft."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'submittedAt',to_char(draft."submittedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'canUpdate',false,'canReview',position_roles.director OR membership_roles.director,'selfReview',true,
    'confirmedYuan',round(confirmed_yuan,4)::text,'expectedYuan',round(expected_yuan,4)::text,
    'duplicateNumber',EXISTS (
      SELECT FROM public."SignedContractSettlement" original WHERE original.id<>draft.id
        AND original."projectId"=p_project AND original."contractKind"=draft."contractKind"
        AND original."contractId"=draft."contractId" AND original.number=draft.number
    )
  );
END;
$submit$;

REVOKE ALL ON FUNCTION public.jg_submit_signed_settlement_draft_v1(text,text,text,integer,text,text) FROM PUBLIC;

COMMIT;
