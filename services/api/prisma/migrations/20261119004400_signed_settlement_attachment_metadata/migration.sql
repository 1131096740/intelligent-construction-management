BEGIN;

CREATE TABLE public.jg_signed_settlement_attachment_witness_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (pg_catalog.octet_length("key") = 32)
);
REVOKE ALL ON TABLE public.jg_signed_settlement_attachment_witness_key FROM PUBLIC;

-- The application receives only the fields shown in the attachment dialog.
CREATE FUNCTION public.jg_read_signed_settlement_attachment_metadata_v1(
  p_project text, p_settlement text, p_file text, p_actor text, p_expiry text, p_proof text
)
RETURNS TABLE ("fileId" text, "originalName" text, "mimeType" text)
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $read$
DECLARE
  key_bytes bytea;
  payload text;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_INVALID' USING ERRCODE = '42501';
  END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_EXPIRED' USING ERRCODE = '42501';
  END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  SELECT string_agg(encode(convert_to(value, 'UTF8'), 'hex'), ':' ORDER BY ordinal)
  INTO payload
  FROM unnest(ARRAY[
    'signed_settlement_attachment_metadata_v1', current_database()::text, session_user::text,
    pg_current_xact_id()::text, pg_backend_pid()::text, p_expiry, p_project, p_settlement, p_file, p_actor
  ]) WITH ORDINALITY fields(value, ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(convert_to(payload, 'UTF8'), key_bytes, 'sha256'), 'hex') IS DISTINCT FROM p_proof THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT f.id, f."originalName", f."mimeType"
    FROM public."SignedContractSettlement" s
    JOIN public."SignedContractSettlementAttachment" a ON a."settlementId"=s.id
    JOIN public."FileObject" f ON f.id=a."fileId"
    JOIN public."Project" project ON project.id=s."projectId" AND project."isActive"
    JOIN public."User" actor ON actor.id=p_actor AND actor."isActive"
    WHERE s.id=p_settlement AND project.id=p_project AND f.id=p_file
      AND f."uploadedByUserId"=s."ownerUserId" AND f."storageStatus"='active'
      AND f."contentSha256"=a.sha256 AND f."supersedesFileObjectId" IS NULL
      AND f."mimeType" IN ('application/pdf','image/jpeg','image/png')
      AND starts_with(f."objectKey", 'uploads/signed-contract-settlement/'
        || encode(sha256(convert_to(project.id, 'UTF8')), 'hex') || '/')
      AND (
        EXISTS (
          SELECT FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
          WHERE up."userId"=actor.id AND (up."projectId" IS NULL OR up."projectId"=project.id)
            AND (pos.key='contract_director' OR (pos.key='contract_staff' AND (s."ownerUserId"=actor.id OR s.state='confirmed')))
          FOR SHARE OF up,pos
        ) OR EXISTS (
          SELECT FROM public."ProjectMember" member WHERE member."userId"=actor.id AND member."projectId"=project.id
            AND (member."positionKey"='contract_director' OR (member."positionKey"='contract_staff' AND (s."ownerUserId"=actor.id OR s.state='confirmed')))
          FOR SHARE OF member
        )
      )
    FOR SHARE OF s,a,f,project,actor;
END;
$read$;

REVOKE ALL ON FUNCTION public.jg_read_signed_settlement_attachment_metadata_v1(text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
