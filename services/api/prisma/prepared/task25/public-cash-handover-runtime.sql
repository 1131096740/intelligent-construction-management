-- Install after the cash-handover migration and the #406 payment fence.
-- Historical Task16 and Task24 authority files stay fixed.
DO $$
DECLARE runtime_name TEXT := nullif(current_setting('jg.task16_runtime_role', true),''); runtime_role RECORD;
BEGIN
 SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname=runtime_name;
 IF runtime_role.oid IS NULL OR NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolcreaterole
   OR runtime_role.rolcreatedb OR runtime_role.rolreplication OR runtime_role.rolbypassrls OR runtime_role.rolinherit
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=runtime_role.oid OR roleid=runtime_role.oid)
   OR NOT has_column_privilege(runtime_name,'public."RegisteredFundAccount"','writeRevision','UPDATE')
   OR NOT has_column_privilege(runtime_name,'public."RegisteredFundTransfer"','revision','UPDATE')
 THEN RAISE EXCEPTION 'cash custody requires the existing restricted transfer runtime'; END IF;
 EXECUTE format('GRANT SELECT, INSERT ON public."PublicCashCustody", public."PublicCashHandover", public."PublicCashHandoverReceipt" TO %I',runtime_name);
 EXECUTE format('GRANT UPDATE ("currentCustodianId") ON public."PublicCashCustody" TO %I',runtime_name);
END $$;
