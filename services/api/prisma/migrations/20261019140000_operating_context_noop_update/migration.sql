-- Every call still verifies the secret and performs the original cleanup.
-- Compare typed values; CURRENT_TIMESTAMP is constant within one transaction.
CREATE OR REPLACE FUNCTION "authorizeOperatingLedgerWrite"(
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stored_secret_hash TEXT;
BEGIN
  SELECT "secretHash"
    INTO stored_secret_hash
    FROM public."OperatingLedgerWriteSecret"
    WHERE "id" = 1;

  IF p_actor_user_id IS NULL
     OR btrim(p_actor_user_id) = ''
     OR stored_secret_hash IS NULL
     OR p_secret IS NULL
     OR public.crypt(p_secret, stored_secret_hash) <> stored_secret_hash THEN
    RAISE EXCEPTION '经营账写入授权上下文无效' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."OperatingLedgerWriteContext"
   WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '1 day';

  INSERT INTO public."OperatingLedgerWriteContext"(
    "backendPid",
    "transactionId",
    "actorUserId"
  )
  VALUES (pg_backend_pid(), txid_current(), p_actor_user_id)
  ON CONFLICT ("backendPid", "transactionId") DO UPDATE
    SET "actorUserId" = EXCLUDED."actorUserId",
        "createdAt" = CURRENT_TIMESTAMP
    WHERE ("OperatingLedgerWriteContext"."actorUserId", "OperatingLedgerWriteContext"."createdAt")
      IS DISTINCT FROM (EXCLUDED."actorUserId", EXCLUDED."createdAt");
END;
$$;

