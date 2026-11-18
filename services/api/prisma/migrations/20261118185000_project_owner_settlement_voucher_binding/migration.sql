BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
ALTER FUNCTION public.jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_project_owner_settlement;

CREATE FUNCTION public.jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT * FROM public.jg_file_business_binding_columns_before_project_owner_settlement()
  UNION ALL
  VALUES ('ProjectOwnerSettlementEntry', 'voucherFileId', FALSE);
$$;

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
