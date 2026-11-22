BEGIN;

CREATE FUNCTION public.jg_signed_settlement_confirmed_projection_v1(p_project text, p_actor text, p_kind text, p_contract text, p_view text, p_expiry text, p_proof text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $projection$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  position_roles record;
  membership_roles record;
  can_read_attachments boolean;
  signed_yuan numeric;
  legacy_cents numeric;
  historical_cents numeric;
  source_count bigint;
  visible_rows jsonb;
BEGIN
  IF current_setting('session_replication_role')<>'origin'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_view NOT IN ('overview','payment') OR p_kind NOT IN ('downstream','outside_fact','upward')
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_INPUT' USING ERRCODE='22023'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_WITNESS' USING ERRCODE='42501'; END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  SELECT convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_confirmed_projection_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_project,p_actor,p_kind,p_contract,p_view
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_WITNESS' USING ERRCODE='42501'; END IF;

  PERFORM FROM public."User" actor WHERE actor.id=p_actor AND actor."isActive" FOR SHARE OF actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_DENIED' USING ERRCODE='42501'; END IF;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role IN ('contract_director','contract_staff')),false) AS contract_role INTO position_roles
    FROM (
      SELECT pos.key AS role FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
      WHERE up."userId"=p_actor AND (up."projectId" IS NULL OR up."projectId"=p_project)
        AND (pos.key IN ('contract_staff','contract_director')
          OR (p_view='payment' AND up."projectId"=p_project AND pos.key='project_manager')) FOR SHARE OF up,pos
    ) scoped;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role IN ('contract_director','contract_staff')),false) AS contract_role INTO membership_roles
    FROM (
      SELECT m."positionKey" AS role FROM public."ProjectMember" m
      WHERE m."projectId"=p_project AND m."userId"=p_actor AND (m."positionKey" IN ('contract_staff','contract_director')
          OR (p_view='payment' AND m."positionKey"='project_manager')) FOR SHARE OF m
    ) scoped;
  IF position_roles.allowed+membership_roles.allowed=0
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM FROM public."Project" p WHERE p.id=p_project AND p."isActive" FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_PROJECT' USING ERRCODE='P0002'; END IF;
  can_read_attachments := position_roles.contract_role OR membership_roles.contract_role;

  IF p_kind='downstream' THEN
    SELECT count(*),coalesce(sum(t."historicalSettledCents"),0) INTO source_count,historical_cents
      FROM public."ContractTakeover" t WHERE t."projectId"=p_project AND t."contractId"=p_contract
        AND t."takeoverStatus"='confirmed' AND t."historicalBalanceConfirmedAt" IS NOT NULL;
    IF source_count>1 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_LEGACY' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(s."amountCents"),0)+historical_cents INTO legacy_cents
      FROM public."Settlement" s WHERE s."projectId"=p_project AND s."contractId"=p_contract
        AND s.status IN ('effective','partially_paid','paid') AND s."sourceTakeoverId" IS NULL AND s."sourceType"<>'historical_takeover';
  ELSE
    SELECT coalesce(sum(CASE s."effectDirection" WHEN 'increase' THEN s."amountCents"::numeric WHEN 'decrease' THEN -s."amountCents"::numeric END),0),
      count(*) FILTER (WHERE NOT coalesce(s."effectDirection" IN ('increase','decrease'),false))
      INTO legacy_cents,source_count FROM public."ProjectAffiliateSettlementFact" s
      WHERE s."projectId"=p_project AND s.status='confirmed'
        AND ((p_kind='upward' AND s."affiliateCompanyContractId"=p_contract)
          OR (p_kind='outside_fact' AND s."contractLedgerId"=p_contract AND s."affiliateCompanyContractId" IS NULL));
    IF source_count>0 THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_LEGACY' USING ERRCODE='23514'; END IF;
  END IF;

  SELECT coalesce(sum(s."amountYuan"),0) INTO signed_yuan FROM public."SignedContractSettlement" s
    WHERE s."projectId"=p_project AND s."contractKind"=p_kind AND s."contractId"=p_contract AND s.state='confirmed';
  visible_rows := '[]'::jsonb;
  IF p_view='payment' THEN
    IF EXISTS (SELECT FROM public."SignedContractSettlement" s
      WHERE s."projectId"=p_project AND s."contractKind"=p_kind AND s."contractId"=p_contract AND s.state='confirmed'
        AND (s.number IS NULL OR s."amountYuan" IS NULL OR s."reviewedAt" IS NULL OR s."confirmationNo" IS NULL))
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_RECORD' USING ERRCODE='23514'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'number',s.number,'amountYuan',s."amountYuan"::text,'confirmationNo',s."confirmationNo"::text,
      'confirmedAt',to_char(s."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attachmentFileIds',CASE WHEN can_read_attachments THEN (
        SELECT coalesce(jsonb_agg(a."fileId" ORDER BY a."fileId"),'[]'::jsonb)
        FROM public."SignedContractSettlementAttachment" a WHERE a."settlementId"=s.id
      ) ELSE '[]'::jsonb END
    )),'[]'::jsonb) INTO visible_rows FROM public."SignedContractSettlement" s
    WHERE s."projectId"=p_project AND s."contractKind"=p_kind AND s."contractId"=p_contract AND s.state='confirmed';
  END IF;
  RETURN jsonb_build_object('confirmedYuan',round(signed_yuan+legacy_cents/100,4)::text,'canReadSignedAttachments',can_read_attachments,'rows',visible_rows);
END;
$projection$;

REVOKE ALL ON FUNCTION public.jg_signed_settlement_confirmed_projection_v1(text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
