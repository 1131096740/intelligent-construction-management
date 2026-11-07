-- Task16-only registered normal-case ACL delta; not a product migration.
SET standard_conforming_strings=on;
BEGIN;
SET LOCAL search_path=pg_catalog,public,pg_temp;
SET LOCAL lock_timeout='5s';
LOCK TABLE public._prisma_migrations IN SHARE MODE;
__TRANSACTION_GUARD__
__CHECKER_DEFINITIONS__
DO $check_existing$ BEGIN PERFORM pg_temp.jg_task16_registered_check(__PLAN_JSON__::jsonb,false); END $check_existing$;
-- Only the reviewed delta. Do not reset baseline or intrinsic history ACLs.
DO $column_grants$ DECLARE role_plan JSONB; table_plan JSONB; op TEXT; cols TEXT; signature TEXT; BEGIN
 FOR role_plan IN SELECT (__PLAN_JSON__::jsonb)->'delta' UNION ALL SELECT (__PLAN_JSON__::jsonb)->'observerDelta' LOOP
 FOR table_plan IN SELECT value FROM pg_catalog.jsonb_array_elements(role_plan->'tables') LOOP
  FOREACH op IN ARRAY ARRAY['select','insert','update'] LOOP
   IF pg_catalog.jsonb_array_length(table_plan->op)>0 THEN
    SELECT pg_catalog.string_agg(pg_catalog.format('%I',value),',') INTO cols FROM pg_catalog.jsonb_array_elements_text(table_plan->op);
    EXECUTE pg_catalog.format('GRANT %s (%s) ON TABLE public.%I TO %I',pg_catalog.upper(op),cols,table_plan->>'table',role_plan->>'role');
   END IF;
  END LOOP;
 END LOOP;
 FOR signature IN SELECT value FROM pg_catalog.jsonb_array_elements_text(role_plan->'functions') LOOP
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %I',signature::regprocedure,role_plan->>'role');
 END LOOP;
 END LOOP;
END $column_grants$;
CREATE FUNCTION public.jg_task16_runtime_reference_read_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $reference_guard$__REFERENCE_GUARD_BODY__$reference_guard$;
REVOKE ALL ON FUNCTION public.jg_task16_runtime_reference_read_only() FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
__CREATE_REFERENCE_TRIGGERS__
DO $check_before_commit$ BEGIN PERFORM pg_temp.jg_task16_registered_check(__PLAN_JSON__::jsonb,true); END $check_before_commit$;
COMMIT;
SET search_path=pg_catalog,public,pg_temp;
__COMMITTED_IDENTITY__
