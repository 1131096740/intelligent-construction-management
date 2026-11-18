BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
DO $registry$
DECLARE
  old_oid oid := 'public.jg_file_business_binding_columns()'::regprocedure;
  owner_id oid;
  owner_name TEXT;
  original_acl aclitem[];
  installer TEXT := current_user;
  privilege RECORD;
BEGIN
  SELECT proowner, proacl INTO STRICT owner_id, original_acl FROM pg_proc WHERE oid = old_oid;
  SELECT rolname INTO STRICT owner_name FROM pg_roles WHERE oid = owner_id;
  IF EXISTS (SELECT 1 FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id))) WHERE grantor <> owner_id) THEN
    RAISE EXCEPTION 'owner settlement voucher cannot change a third-party file registry grant';
  END IF;

  EXECUTE format('SET LOCAL ROLE %I', owner_name);
  ALTER FUNCTION public.jg_file_business_binding_columns()
    RENAME TO jg_file_business_binding_columns_before_owner_settlement;
  EXECUTE $new_registry$
    CREATE FUNCTION public.jg_file_business_binding_columns()
    RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
    LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$
      SELECT * FROM public.jg_file_business_binding_columns_before_owner_settlement()
      UNION ALL
      VALUES ('ProjectOwnerSettlementEntry', 'voucherFileId', FALSE);
    $body$;
  $new_registry$;
  FOR privilege IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
    WHERE oid = 'public.jg_file_business_binding_columns()'::regprocedure), acldefault('f', owner_id)))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns() FROM %s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END);
  END LOOP;
  FOR privilege IN SELECT grantee, is_grantable FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id)))
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns() TO %s%s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END,
      CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('SET LOCAL ROLE %I', installer);
END;
$registry$;

-- Old restricted writers only need a yes/no answer for the exact file they are binding.
CREATE FUNCTION public.jg_project_owner_settlement_voucher_bound(candidate TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectOwnerSettlementEntry" WHERE "voucherFileId" = candidate
  );
$$;

REVOKE ALL ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) FROM PUBLIC;

DO $migration$
DECLARE
  definition TEXT := pg_get_functiondef('public.jg_enforce_exclusive_file_business_binding()'::regprocedure);
  previous TEXT := E'      ELSE\n        EXECUTE format(\n';
  replacement TEXT := E'      ELSIF current_binding."tableName" = ''ProjectOwnerSettlementEntry''\n'
    || E'        AND current_binding."columnName" = ''voucherFileId'' THEN\n'
    || E'        binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);\n'
    || previous;
BEGIN
  IF cardinality(string_to_array(definition, previous)) <> 2 THEN
    RAISE EXCEPTION 'owner settlement voucher expected the current central binding guard';
  END IF;
  EXECUTE replace(definition, previous, replacement);
END;
$migration$;

CREATE FUNCTION public.jg_guard_project_owner_settlement_voucher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(190731, 13);
  IF public.jg_has_exclusive_file_business_binding(NEW."voucherFileId") THEN
    RAISE EXCEPTION '该文件已绑定独占业务事实，不能再用于其他业务'
      USING ERRCODE = '23505', CONSTRAINT = 'exclusive_file_business_binding_guard';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_project_owner_settlement_voucher() FROM PUBLIC;

CREATE TRIGGER jg_efb_project_owner_settlement_voucher
BEFORE INSERT ON public."ProjectOwnerSettlementEntry"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_project_owner_settlement_voucher();

COMMIT;
