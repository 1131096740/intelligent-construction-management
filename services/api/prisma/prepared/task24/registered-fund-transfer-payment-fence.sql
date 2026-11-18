-- Apply after Task16 registered-funding only on the #406 successor.
-- The exact historical Task16 installation files remain byte-identical.
-- Install privileges for the explicitly selected, already-provisioned payment runtime.
DO $$
DECLARE runtime_name TEXT := nullif(current_setting('jg.task16_runtime_role', true),''); runtime_role RECORD;
 allocation oid := 'public."RegisteredFundPaymentAllocation"'::regclass; fence pg_catalog.pg_trigger;
BEGIN
 SELECT * INTO fence FROM pg_catalog.pg_trigger
  WHERE tgrelid=allocation AND tgname='RegisteredFundPaymentAllocation_transfer_capacity';
 IF fence.oid IS NULL THEN
  CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_transfer_capacity"
   AFTER INSERT ON public."RegisteredFundPaymentAllocation"
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
   EXECUTE FUNCTION public."jg_registered_fund_transfer_account_trigger"();
 ELSIF fence.tgfoid<>'public.jg_registered_fund_transfer_account_trigger()'::regprocedure OR fence.tgtype<>5
   OR fence.tgenabled NOT IN ('O','A') OR NOT fence.tgdeferrable OR NOT fence.tginitdeferred
 THEN RAISE EXCEPTION 'registered payment has a different transfer capacity fence'; END IF;
 SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname=runtime_name;
 IF runtime_role.oid IS NULL OR NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolcreaterole
   OR runtime_role.rolcreatedb OR runtime_role.rolreplication OR runtime_role.rolbypassrls OR runtime_role.rolinherit
   OR NOT has_column_privilege(runtime_name,'public."RegisteredFundAccount"','writeRevision','UPDATE')
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=runtime_role.oid OR roleid=runtime_role.oid)
 THEN RAISE EXCEPTION 'fund transfer requires the existing restricted payment runtime'; END IF;
 EXECUTE format('GRANT SELECT, INSERT ON public."RegisteredFundTransfer",public."RegisteredFundTransferLine",public."RegisteredFundTransferAction" TO %I',runtime_name);
 EXECUTE format('GRANT UPDATE ("status","revision") ON public."RegisteredFundTransfer" TO %I',runtime_name);
 EXECUTE format('GRANT SELECT ("transferId"), INSERT ("transferId") ON public."FundAccountBalanceRegistration" TO %I',runtime_name);
 EXECUTE format('GRANT SELECT ("receivedTransferLineId"), INSERT ("receivedTransferLineId") ON public."FundAccountSourceBatch" TO %I',runtime_name);
END $$;
