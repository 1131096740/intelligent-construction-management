-- Apply after the migrated schema and the existing prepared Task16/24/26 runtime.
CREATE FUNCTION public."jg_open_principal_return_approval"(
  round_id TEXT, application_id TEXT, applicant_id TEXT, duties JSONB
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF jsonb_typeof(duties) IS DISTINCT FROM 'array' OR jsonb_array_length(duties) NOT IN (3,4) THEN
   RAISE EXCEPTION 'principal return requires its exact approval duty set';
 END IF;
 INSERT INTO public."ApprovalInstance" ("id","businessType","businessId","flowType","status","currentNodeIndex","applicantUserId","frozenNodes","updatedAt")
 VALUES (round_id,'registered_principal_return',application_id,'registered_principal_return','approval_pending',0,applicant_id,duties,CURRENT_TIMESTAMP);
 RETURN round_id;
END $$;
REVOKE ALL ON FUNCTION public."jg_open_principal_return_approval"(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;

CREATE FUNCTION public."jg_assert_principal_return_approval_binding"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE linked public."RegisteredPrincipalReturnApplication"; expected JSONB;
BEGIN
 SELECT * INTO linked FROM public."RegisteredPrincipalReturnApplication" application
 WHERE application."approvalInstanceId" = NEW.id AND application.id = NEW."businessId"
   AND application."createdByUserId" = NEW."applicantUserId"
   AND application.xmin::text = (txid_current() % 4294967296)::text;
 IF linked.id IS NULL OR NEW."flowType" <> 'registered_principal_return' OR NEW.status <> 'approval_pending'
    OR NEW."currentNodeIndex" <> 0 OR linked.status <> 'pending' OR linked.revision <> 1 THEN
   RAISE EXCEPTION 'principal return approval round must originate from its same-transaction application';
 END IF;

 SELECT jsonb_agg(jsonb_build_object(
   'protocolVersion',1,'executionMode','parallel','mode','any','roleKeys',duties.roles,
   'approvedRoleKeys','[]'::jsonb,'roleScopesByRole',duties.scopes) ORDER BY duties.ordinal)
 INTO expected
 FROM (VALUES
   (1,'["comprehensive_director"]'::jsonb,'{"comprehensive_director":"global"}'::jsonb),
   (2,'["project_manager"]'::jsonb,'{"project_manager":"project"}'::jsonb),
   (3,'["finance_director"]'::jsonb,'{"finance_director":"global"}'::jsonb),
   (4,'["general_manager","chairman"]'::jsonb,'{"general_manager":"global","chairman":"global"}'::jsonb)
 ) AS duties(ordinal,roles,scopes)
 WHERE duties.ordinal <> 2 OR linked."projectId" IS NOT NULL;
 IF NEW."frozenNodes" IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'principal return approval requires the exact project or company duties';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredPrincipalReturnApproval_binding"
 AFTER INSERT ON public."ApprovalInstance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (NEW."businessType" = 'registered_principal_return')
 EXECUTE FUNCTION public."jg_assert_principal_return_approval_binding"();

DO $$
DECLARE runtime_name TEXT := nullif(current_setting('jg.task16_runtime_role', true),''); runtime_role RECORD;
BEGIN
 SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname = runtime_name;
 IF runtime_role.oid IS NULL OR NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolcreaterole
   OR runtime_role.rolcreatedb OR runtime_role.rolreplication OR runtime_role.rolbypassrls OR runtime_role.rolinherit
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_role.oid)
   OR NOT has_table_privilege(runtime_name,'public."RegisteredPaymentProjectAdvance"','SELECT')
   OR NOT has_table_privilege(runtime_name,'public."RegisteredFundAdvanceReceipt"','SELECT')
   OR NOT has_table_privilege(runtime_name,'public."RegisteredFundCompanyOwnedReceipt"','SELECT')
   OR NOT has_column_privilege(runtime_name,'public."RegisteredFundAccount"','writeRevision','UPDATE')
   OR has_any_column_privilege(runtime_name,'public."OperatingFact"','INSERT,UPDATE')
   OR has_any_column_privilege(runtime_name,'public."OperatingImpactEntry"','INSERT,UPDATE')
   OR has_table_privilege(runtime_name,'public."OperatingLedgerWriteSecret"','SELECT')
   OR EXISTS (
     SELECT 1 FROM pg_catalog.pg_class relation
     WHERE relation.oid = ANY(ARRAY[
       'public."RegisteredPrincipalReturnSource"'::regclass,
       'public."RegisteredPrincipalReturnApplication"'::regclass,
       'public."RegisteredPrincipalReturnPayment"'::regclass,
       'public."RegisteredPrincipalReturnAllocation"'::regclass,
       'public."RegisteredPrincipalReturnCommand"'::regclass])
       AND (relation.relowner = runtime_role.oid
         OR has_table_privilege(runtime_name,relation.oid,'UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES')
         OR has_any_column_privilege(runtime_name,relation.oid,'UPDATE, REFERENCES'))
   ) THEN RAISE EXCEPTION 'principal return requires the existing restricted payment runtime'; END IF;
 EXECUTE format('GRANT EXECUTE ON FUNCTION public."jg_open_principal_return_approval"(TEXT,TEXT,TEXT,JSONB) TO %I', runtime_name);
 EXECUTE format('GRANT SELECT, INSERT ON public."RegisteredPrincipalReturnSource", public."RegisteredPrincipalReturnApplication", public."RegisteredPrincipalReturnPayment", public."RegisteredPrincipalReturnAllocation", public."RegisteredPrincipalReturnCommand" TO %I', runtime_name);
 EXECUTE format('GRANT UPDATE ("writeRevision") ON public."RegisteredPrincipalReturnSource" TO %I', runtime_name);
 EXECUTE format('GRANT UPDATE ("status", "approvedYuan", "paidYuan", "revision") ON public."RegisteredPrincipalReturnApplication" TO %I', runtime_name);
END $$;
