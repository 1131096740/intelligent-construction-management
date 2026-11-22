BEGIN;

CREATE FUNCTION public.jg_list_signed_settlements_v1(p_project text, p_actor text, p_expiry text, p_proof text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $list$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  position_roles record;
  membership_roles record;
  director boolean;
  visible_rows jsonb;
BEGIN
  IF current_setting('session_replication_role')<>'origin'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_WITNESS' USING ERRCODE='42501'; END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  SELECT convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_list_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_project,p_actor
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_WITNESS' USING ERRCODE='42501'; END IF;

  PERFORM FROM public."User" actor WHERE actor.id=p_actor AND actor."isActive" FOR SHARE OF actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_DENIED' USING ERRCODE='42501'; END IF;
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
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM FROM public."Project" p WHERE p.id=p_project AND p."isActive" FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LIST_PROJECT' USING ERRCODE='P0002'; END IF;
  director := position_roles.director OR membership_roles.director;

  SELECT coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'amountYuan',s."amountYuan"::text,'confirmationNo',s."confirmationNo"::text,
      'createdAt',to_char(s."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt',to_char(s."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'submittedAt',to_char(s."submittedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reviewedAt',to_char(s."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'canUpdate',s."ownerUserId"=p_actor AND s.state IN ('draft','returned'),
      'canReview',director AND s.state='pending_review',
      'selfReview',s."ownerUserId"=p_actor,
      'attachments',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'fileId',file.id,'originalName',file."originalName",'mimeType',file."mimeType"
      ) ORDER BY file.id),'[]'::jsonb)
        FROM public."SignedContractSettlementAttachment" a JOIN public."FileObject" file ON file.id=a."fileId"
        WHERE a."settlementId"=s.id)
    ) ORDER BY s."createdAt" DESC,s.id DESC),'[]'::jsonb)
    INTO visible_rows FROM public."SignedContractSettlement" s
    WHERE s."projectId"=p_project AND (director OR s."ownerUserId"=p_actor OR s.state='confirmed');
  RETURN visible_rows;
END;
$list$;

REVOKE ALL ON FUNCTION public.jg_list_signed_settlements_v1(text,text,text,text) FROM PUBLIC;

COMMIT;
