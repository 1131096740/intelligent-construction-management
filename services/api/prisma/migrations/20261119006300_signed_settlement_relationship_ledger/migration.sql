BEGIN;

CREATE FUNCTION public.jg_read_signed_settlement_relationship_ledger_v1(
  p_projects text, p_actor text, p_cutoff text, p_expiry text, p_proof text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $ledger$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  cutoff timestamp without time zone;
  projects jsonb;
  rows jsonb;
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$'
    OR p_cutoff !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LEDGER_WITNESS' USING ERRCODE='42501'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LEDGER_WITNESS' USING ERRCODE='42501'; END IF;

  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  SELECT convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_relationship_ledger_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_projects,p_actor,p_cutoff
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LEDGER_WITNESS' USING ERRCODE='42501'; END IF;

  PERFORM FROM public."User" u WHERE u.id=p_actor AND u."isActive";
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_LEDGER_ACTOR' USING ERRCODE='42501'; END IF;
  cutoff := p_cutoff::timestamptz AT TIME ZONE 'UTC';
  projects := p_projects::jsonb;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'projectId',s."projectId",'contractKind',s."contractKind",'number',s.number,
    'amountYuan',s."amountYuan"::text,'reviewedAt',to_char(s."reviewedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedContractSource',s."confirmedContractSource"
  )),'[]'::jsonb) INTO rows
  FROM (
    SELECT f.id,f."projectId",f."contractKind",f.number,f."amountYuan",f."reviewedAt",f."confirmedContractSource"
    FROM public."SignedContractSettlement" f
    WHERE f.state='confirmed' AND f."reviewedAt" <= cutoff
      AND f."projectId" IN (SELECT jsonb_array_elements_text(projects))
      AND EXISTS (SELECT FROM public."Project" p WHERE p.id=f."projectId" AND p."isActive")
    LIMIT 10001
  ) s;
  RETURN rows;
END;
$ledger$;

REVOKE ALL ON FUNCTION public.jg_read_signed_settlement_relationship_ledger_v1(text,text,text,text,text) FROM PUBLIC;

COMMIT;
