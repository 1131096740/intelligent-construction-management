BEGIN;

CREATE FUNCTION public.jg_review_signed_settlement_draft_v1(
  p_project text, p_settlement text, p_actor text, p_revision integer, p_decision text, p_reason text,
  p_password_proven boolean, p_expiry text, p_proof text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $review$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  reviewed_at timestamp(3);
  credential text;
  locked_credential text;
  self_review boolean;
  frozen_source jsonb;
  confirmation_no bigint;
  counterparty_version text;
  draft public."SignedContractSettlement"%ROWTYPE;
  version record;
  source_count bigint;
  historical_cents numeric;
  legacy_cents numeric;
  confirmed_yuan numeric;
  attachments jsonb;
  attachment_count bigint;
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR NOT coalesce(p_expiry ~ '^[0-9]{10}$' AND p_proof ~ '^[0-9a-f]{64}$',false)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_WITNESS' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(p_decision IN ('confirm','return') AND p_revision>0,false)
    OR p_password_proven IS NULL OR (p_reason IS NOT NULL AND (btrim(p_reason)='' OR length(p_reason)>500))
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_INPUT' USING ERRCODE='22023'; END IF;
  IF p_decision='return' AND p_reason IS NULL
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_REASON' USING ERRCODE='22023'; END IF;

  IF p_password_proven THEN
    SELECT actor."passwordHash" INTO credential FROM public."User" actor WHERE actor.id=p_actor;
  END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_draft_witness_key WHERE singleton;
  SELECT convert_to(string_agg(coalesce(encode(convert_to(value,'UTF8'),'hex'),'-'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_draft_review_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_project,p_settlement,p_actor,p_revision::text,
      p_decision,p_reason,CASE WHEN p_password_proven THEN 'proven' ELSE 'none' END,credential
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof THEN
    IF p_password_proven THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CREDENTIAL' USING ERRCODE='23514'; END IF;
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_WITNESS' USING ERRCODE='42501';
  END IF;

  SELECT CASE WHEN p_password_proven THEN actor."passwordHash" ELSE NULL END INTO locked_credential
    FROM public."Project" p JOIN public."User" actor ON actor.id=p_actor AND actor."isActive"
    WHERE p.id=p_project AND p."isActive" FOR SHARE OF p,actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
  IF p_password_proven AND locked_credential IS DISTINCT FROM credential
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CREDENTIAL' USING ERRCODE='23514'; END IF;
  IF NOT (EXISTS (
    SELECT FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
    WHERE up."userId"=p_actor AND (up."projectId" IS NULL OR up."projectId"=p_project)
      AND pos.key='contract_director' FOR SHARE OF up,pos
  ) OR EXISTS (
    SELECT FROM public."ProjectMember" m
    WHERE m."projectId"=p_project AND m."userId"=p_actor AND m."positionKey"='contract_director' FOR SHARE OF m
  )) THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_DENIED' USING ERRCODE='42501'; END IF;

  SELECT s.* INTO draft FROM public."SignedContractSettlement" s WHERE s.id=p_settlement AND s."projectId"=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_MISSING' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('signed-settlement:'||draft."contractKind"||':'||draft."contractId",0));
  SELECT s.* INTO draft FROM public."SignedContractSettlement" s
    WHERE s.id=p_settlement AND s."projectId"=p_project FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_MISSING' USING ERRCODE='P0002'; END IF;
  IF draft.state<>'pending_review' OR draft.revision<>p_revision
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;
  self_review := draft."ownerUserId"=p_actor;
  IF self_review AND (p_reason IS NULL OR NOT p_password_proven OR credential IS NULL)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_SELF' USING ERRCODE='22023'; END IF;
  IF p_decision='confirm' AND (draft.number IS NULL OR btrim(draft.number)='' OR draft."amountYuan" IS NULL OR draft."amountYuan"=0)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_REQUIRED' USING ERRCODE='22023'; END IF;

  IF draft."contractKind"='downstream' THEN
    SELECT v.id,v."versionNo",c.name,c.counterparty,c."contractTypeKey",v."signingSubjectType",v."companyEntityIdSnapshot",
      v."companyEntityVersionId",v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId",v."affiliateNameSnapshot",
      v."companyEntityNameSnapshot" INTO version
      FROM public."ContractVersion" v
      JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=p_project AND c."voidedAt" IS NULL
      WHERE c.id=draft."contractId" AND v.status='effective' ORDER BY v."versionNo" DESC LIMIT 1 FOR SHARE OF v,c;
    IF NOT FOUND OR NOT coalesce(
      (version."signingSubjectType"='our_company' AND (nullif(version."companyEntityIdSnapshot",'') IS NOT NULL OR nullif(version."companyEntityVersionId",'') IS NOT NULL))
      OR (version."signingSubjectType"='affiliate' AND nullif(version."affiliateAssignmentId",'') IS NOT NULL AND nullif(version."affiliateBusinessPartyVersionId",'') IS NOT NULL),false)
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;

    IF p_decision='confirm' THEN
      SELECT party."businessPartyVersionId" INTO counterparty_version FROM public."ContractPartySnapshot" party
        WHERE party."contractVersionId"=version.id AND party."roleKey"='party_b'
        ORDER BY party."displayOrder" LIMIT 1 FOR SHARE OF party;
      frozen_source := jsonb_build_object(
        'relationship',CASE WHEN version."signingSubjectType"='affiliate' THEN 'outside' ELSE 'inside' END,
        'sourceRecordId',version.id,'sourceVersion',version."versionNo",'contractTypeKey',version."contractTypeKey",
        'name',version.name,'signingParty',CASE WHEN version."signingSubjectType"='affiliate' THEN version."affiliateNameSnapshot" ELSE version."companyEntityNameSnapshot" END,
        'counterparty',version.counterparty,'payerKind',CASE WHEN version."signingSubjectType"='affiliate' THEN 'construction_enterprise' ELSE 'participating_company' END,
        'payerVersionId',CASE WHEN version."signingSubjectType"='affiliate' THEN version."affiliateBusinessPartyVersionId" ELSE version."companyEntityVersionId" END,
        'counterpartyKind','downstream_counterparty','counterpartyVersionId',counterparty_version,
        'companyEntityId',CASE WHEN version."signingSubjectType"='affiliate' THEN NULL ELSE version."companyEntityIdSnapshot" END,
        'affiliateAssignmentId',version."affiliateAssignmentId",'affiliateBusinessPartyVersionId',version."affiliateBusinessPartyVersionId"
      );
      SELECT count(*),coalesce(sum(t."historicalSettledCents"),0) INTO source_count,historical_cents
        FROM public."ContractTakeover" t WHERE t."projectId"=p_project AND t."contractId"=draft."contractId"
          AND t."takeoverStatus"='confirmed' AND t."historicalBalanceConfirmedAt" IS NOT NULL;
      IF source_count>1 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_LEGACY' USING ERRCODE='23514'; END IF;
      SELECT coalesce(sum(s."amountCents"),0)+historical_cents INTO legacy_cents
        FROM public."Settlement" s WHERE s."projectId"=p_project AND s."contractId"=draft."contractId"
        AND s.status IN ('effective','partially_paid','paid') AND s."sourceTakeoverId" IS NULL AND s."sourceType"<>'historical_takeover';
    END IF;
  ELSE
    IF draft."contractKind"='outside_fact' THEN
      SELECT jsonb_build_object(
        'relationship','outside','sourceRecordId',c.id,'sourceVersion',c."documentVersion",'contractTypeKey',c."contractType",
        'name',c."externalContractReference",'signingParty',c."affiliateNameSnapshot",'counterparty',c."counterpartyName",
        'payerKind','construction_enterprise','payerVersionId',c."affiliateBusinessPartyVersionId",
        'counterpartyKind','downstream_counterparty','counterpartyVersionId',c."counterpartyVersionId",'companyEntityId',NULL,
        'affiliateAssignmentId',c."affiliateAssignmentId",'affiliateBusinessPartyVersionId',c."affiliateBusinessPartyVersionId"
      ) INTO frozen_source FROM public."ProjectAffiliateContractFact" c
        WHERE c."projectId"=p_project AND c."ledgerId"=draft."contractId" AND c."entryKind"='original' AND c.status='confirmed'
        LIMIT 1 FOR SHARE OF c;
      IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;
      IF EXISTS (SELECT FROM public."ProjectAffiliateSettlementFact" s WHERE s."projectId"=p_project AND s."contractLedgerId"=draft."contractId"
        AND s.status='confirmed' AND s."affiliateCompanyContractId" IS NOT NULL)
      THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_ALIAS' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT jsonb_build_object(
        'relationship','upward','sourceRecordId',c.id,'sourceVersion',c."documentVersion",'contractTypeKey',NULL,
        'name',c."contractName",'signingParty',c."affiliateNameSnapshot",'counterparty',c."companyEntityNameSnapshot",
        'payerKind','construction_enterprise','payerVersionId',c."affiliateBusinessPartyVersionId",
        'counterpartyKind','participating_company','counterpartyVersionId',c."companyEntityVersionId",'companyEntityId',c."companyEntityId",
        'affiliateAssignmentId',c."affiliateAssignmentId",'affiliateBusinessPartyVersionId',c."affiliateBusinessPartyVersionId"
      ) INTO frozen_source FROM public."ProjectAffiliateCompanyContract" c
        WHERE c.id=draft."contractId" AND c."projectId"=p_project AND c.status='confirmed' FOR SHARE OF c;
      IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;
    END IF;
    IF p_decision='confirm' THEN
      SELECT coalesce(sum(CASE s."effectDirection" WHEN 'increase' THEN s."amountCents"::numeric WHEN 'decrease' THEN -s."amountCents"::numeric END),0),
        count(*) FILTER (WHERE NOT coalesce(s."effectDirection" IN ('increase','decrease'),false))
        INTO legacy_cents,source_count FROM public."ProjectAffiliateSettlementFact" s
        WHERE s."projectId"=p_project AND s.status='confirmed'
          AND ((draft."contractKind"='upward' AND s."affiliateCompanyContractId"=draft."contractId")
            OR (draft."contractKind"='outside_fact' AND s."contractLedgerId"=draft."contractId" AND s."affiliateCompanyContractId" IS NULL));
      IF source_count>0 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_LEGACY' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;

  SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('fileId',f.id,'originalName',f."originalName",'mimeType',f."mimeType") ORDER BY f.id),'[]'::jsonb)
    INTO attachment_count,attachments FROM (
      SELECT file.id,file."originalName",file."mimeType" FROM public."SignedContractSettlementAttachment" a
      JOIN public."FileObject" file ON file.id=a."fileId"
      WHERE a."settlementId"=draft.id AND (p_decision='return' OR (file."storageStatus"='active' AND file."contentSha256"=a.sha256))
      FOR SHARE OF a,file
    ) f;
  IF p_decision='confirm' THEN
    IF attachment_count=0 OR attachment_count<>(SELECT count(*) FROM public."SignedContractSettlementAttachment" a WHERE a."settlementId"=draft.id)
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_FILE' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(s."amountYuan"),0)+legacy_cents/100,coalesce(max(s."confirmationNo"),0)+1
      INTO confirmed_yuan,confirmation_no FROM public."SignedContractSettlement" s
      WHERE s."projectId"=p_project AND s."contractKind"=draft."contractKind" AND s."contractId"=draft."contractId" AND s.state='confirmed';
    IF confirmed_yuan+draft."amountYuan"<0
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CAPACITY' USING ERRCODE='23514'; END IF;
  END IF;

  reviewed_at := clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SignedContractSettlement" s SET state=CASE WHEN p_decision='confirm' THEN 'confirmed' ELSE 'returned' END,
    "reviewedAt"=reviewed_at,"reviewedByUserId"=p_actor,"reviewReason"=p_reason,
    "confirmationNo"=confirmation_no,"confirmedContractSource"=CASE WHEN p_decision='confirm' THEN frozen_source ELSE NULL END,
    revision=s.revision+1,"updatedAt"=reviewed_at
    WHERE s.id=draft.id RETURNING s.* INTO draft;
  INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId",metadata,"createdAt")
    VALUES(gen_random_uuid()::text,p_actor,CASE WHEN p_decision='confirm' THEN 'settlement.signed_confirmed' ELSE 'settlement.signed_returned' END,
      'settlement',draft.id,jsonb_build_object('reason',p_reason,'selfReview',self_review,'amountYuan',draft."amountYuan"::text),reviewed_at);
  RETURN to_jsonb(draft) || jsonb_build_object(
    'amountYuan',draft."amountYuan"::text,'confirmationNo',draft."confirmationNo"::text,'attachments',attachments,
    'createdAt',to_char(draft."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(draft."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'submittedAt',to_char(draft."submittedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reviewedAt',to_char(draft."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'canUpdate',self_review AND p_decision='return','canReview',false,'selfReview',self_review
  );
END;
$review$;

REVOKE ALL ON FUNCTION public.jg_review_signed_settlement_draft_v1(text,text,text,integer,text,text,boolean,text,text) FROM PUBLIC;

COMMIT;
