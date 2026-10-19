-- Return the stored insertion watermark without a second client round trip.
-- A changed return type requires DROP/CREATE. This single DO statement is atomic;
-- preserve ownership/ACLs and fail closed rather than cascading dependencies.
DO $migration$
DECLARE
  metadata RECORD;
  privilege RECORD;
  signature CONSTANT TEXT := 'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)';
BEGIN
  SELECT p.proowner, COALESCE(p.proacl, acldefault('f', p.proowner)) AS acl,
         obj_description(p.oid, 'pg_proc') AS comment
  INTO STRICT metadata FROM pg_proc p WHERE p.oid = signature::regprocedure;
  -- Do not flatten delegated grant chains into new owner grants.
  IF EXISTS (SELECT 1 FROM aclexplode(metadata.acl) a WHERE a.grantor <> metadata.proowner) THEN
    RAISE EXCEPTION 'POL108 writer has delegated grants; review required';
  END IF;
  EXECUTE 'DROP FUNCTION ' || signature;
  EXECUTE $definition$
CREATE FUNCTION public."appendOperatingImpactThroughService"(
  p_payload "OperatingLedgerImpactWritePayload",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE("id" TEXT, "createdAt" TIMESTAMP(3))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);

  RETURN QUERY
  INSERT INTO public."OperatingImpactEntry"(
    "id", "factId", "projectId", "sourceType", "sourceBusinessId",
    "sourceImpactKey", "idempotencyKey", "impactKind", "amountCents",
    "direction", "subjectRole", "subjectKind", "subjectId", "costCategoryCode",
    "fundPurpose", "description", "impactSnapshot", "paymentExecutionId",
    "fundExecutionId", "fundExecutionCaseId", "executionAllocationLineId"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."factId", p_payload."projectId", p_payload."sourceType",
    p_payload."sourceBusinessId", p_payload."sourceImpactKey",
    p_payload."idempotencyKey", p_payload."impactKind", p_payload."amountCents",
    p_payload."direction", p_payload."subjectRole", p_payload."subjectKind",
    p_payload."subjectId", p_payload."costCategoryCode", p_payload."fundPurpose",
    p_payload."description", p_payload."impactSnapshot", p_payload."paymentExecutionId",
    p_payload."fundExecutionId", p_payload."fundExecutionCaseId",
    p_payload."executionAllocationLineId"
  )
  RETURNING "OperatingImpactEntry"."id", "OperatingImpactEntry"."createdAt";
END;
$$;
$definition$;
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I', signature, pg_get_userbyid(metadata.proowner));
  -- Remove default grants too: ALTER DEFAULT PRIVILEGES must not widen access.
  FOR privilege IN
    SELECT a.* FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = signature::regprocedure
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', signature,
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END);
  END LOOP;
  FOR privilege IN SELECT * FROM aclexplode(metadata.acl)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s%s', signature,
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END,
      CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('COMMENT ON FUNCTION %s IS %L', signature, metadata.comment);
END;
$migration$;
