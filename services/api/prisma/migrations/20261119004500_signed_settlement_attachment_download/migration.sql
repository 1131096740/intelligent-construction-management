BEGIN;

CREATE FUNCTION public.jg_read_signed_settlement_attachment_download_v1(
  p_project text, p_settlement text, p_file text, p_actor text, p_expiry text, p_proof text
)
RETURNS TABLE (id text, bucket text, "objectKey" text, "originalName" text, "mimeType" text,
  "sizeBytes" integer, "contentSha256" text, "storageStatus" text)
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $download$
DECLARE
  key_bytes bytea;
  scope_fields text[];
  payload bytea;
  metadata_proof text;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  IF current_setting('session_replication_role') <> 'origin'
    OR p_expiry !~ '^[0-9]{10}$' OR p_proof !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_DOWNLOAD_WITNESS_INVALID' USING ERRCODE='42501';
  END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_DOWNLOAD_WITNESS_EXPIRED' USING ERRCODE='42501';
  END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  scope_fields := ARRAY[current_database()::text, session_user::text,
    pg_current_xact_id()::text, pg_backend_pid()::text, p_expiry, p_project, p_settlement, p_file, p_actor];
  SELECT convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY['signed_settlement_attachment_download_v1'] || scope_fields) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_DOWNLOAD_WITNESS_MISMATCH' USING ERRCODE='42501';
  END IF;

  -- Reuse the exact existing binding, original and actor checks under the same transaction locks.
  SELECT encode(public.hmac(convert_to(string_agg(encode(convert_to(value,'UTF8'),'hex'),':' ORDER BY ordinal),'UTF8'),
      key_bytes,'sha256'),'hex') INTO metadata_proof
    FROM unnest(ARRAY['signed_settlement_attachment_metadata_v1'] || scope_fields) WITH ORDINALITY fields(value,ordinal);
  RETURN QUERY
    SELECT f.id,f.bucket,f."objectKey",f."originalName",f."mimeType",f."sizeBytes",f."contentSha256",f."storageStatus"
    FROM public.jg_read_signed_settlement_attachment_metadata_v1(
      p_project,p_settlement,p_file,p_actor,p_expiry,metadata_proof
    ) accepted
    JOIN public."FileObject" f ON f.id=accepted."fileId"
    WHERE NOT EXISTS (SELECT FROM public."ContractArchiveEvidenceFile" archive WHERE archive."fileId"=f.id)
      AND NOT EXISTS (SELECT FROM public."WageApprovedSourceVersion" wage WHERE wage."evidenceFileId"=f.id);
END;
$download$;

REVOKE ALL ON FUNCTION public.jg_read_signed_settlement_attachment_download_v1(text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
