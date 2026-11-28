BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE public.jg_legacy_procurement_expense_voucher_binding_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL,
  runtime_role_oid oid NOT NULL,
  claim_id text NOT NULL,
  project_id text NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  file_id text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  mime_type text NOT NULL
);
REVOKE ALL ON TABLE public.jg_legacy_procurement_expense_voucher_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_check_legacy_procurement_expense_voucher_v1(
  p_claim text, p_project text, p_file text, p_actor text
)
RETURNS boolean LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $voucher$
DECLARE
  approved_instance text;
BEGIN
  IF pg_trigger_depth() NOT IN (0, 1)
    OR current_setting('session_replication_role') <> 'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_SCOPE' USING ERRCODE='42501';
  END IF;

  SELECT c."approvalInstanceId" INTO STRICT approved_instance
  FROM public.jg_legacy_procurement_expense_voucher_binding_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.runtime_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname='general_procurement_runtime' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE app.oid IN (m.member,m.roleid))
  JOIN public."ExpenseClaim" c ON c.id=b.claim_id AND c."projectId"=b.project_id
    AND c."approvalInstanceId"=b.approval_id
    AND c."generalProcurementId" IS NOT NULL AND c."claimType"='incidental_expense'
    AND c.status IN ('approved_pending_payment','partially_paid')
  WHERE b.singleton AND b.claim_id=p_claim AND b.project_id=p_project AND b.file_id=p_file AND b.actor_id=p_actor
    AND b.server_port=inet_server_port()
    AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
  FOR SHARE OF b NOWAIT FOR UPDATE OF c NOWAIT;

  IF NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_BUSY' USING ERRCODE='55P03';
  END IF;

  PERFORM 1 FROM public."ApprovalInstance" a
  JOIN public."User" u ON u.id=p_actor AND u."isActive"
  JOIN public."UserPosition" up ON up."userId"=u.id AND up."projectId" IS NULL
  JOIN public."Position" pos ON pos.id=up."positionId" AND pos.key='finance_staff'
  WHERE a.id=approved_instance AND a."businessId"=p_claim
    AND a."businessType"='expense_claim' AND a."flowType"='expense_claim.approve' AND a.status='approved'
  FOR SHARE OF a,u,up,pos NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_BINDING' USING ERRCODE='55000';
  END IF;

  PERFORM 1 FROM public.jg_legacy_procurement_expense_voucher_binding_v1 b
  JOIN public."FileObject" f ON f.id=b.file_id AND f.id=p_file AND f."uploadedByUserId"=b.actor_id
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND f."contentSha256"=b.content_sha256 AND f."sizeBytes"=b.size_bytes AND f."mimeType"=b.mime_type
  WHERE b.singleton
    AND NOT EXISTS (SELECT FROM public."ExpenseClaimPaymentExecution" e WHERE e."voucherFileId"=f.id)
    AND EXISTS (
    SELECT FROM public."AuditLog" a WHERE a.action='file.upload' AND a."businessType"='file_object'
      AND a."businessId"=f.id AND a."actorUserId"=f."uploadedByUserId"
      AND a.metadata->>'objectKey'=f."objectKey" AND a.metadata->>'bucket'=f.bucket
      AND a.metadata->>'sizeBytes'=f."sizeBytes"::text
  )
  FOR UPDATE OF f NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_BINDING' USING ERRCODE='55000';
  END IF;

  RETURN public.jg_project_owner_settlement_voucher_bound(p_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_BINDING' USING ERRCODE='55000';
END;
$voucher$;
REVOKE ALL ON FUNCTION public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text) FROM PUBLIC;

DO $install$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  original_oid oid := to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  raw_oid oid := to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)');
  original_body text;
  original_trigger jsonb;
  definition text;
  trigger_definition text;
  successor text;
  successor_oid oid;
  previous_closure text;
  needle CONSTANT text := $old$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$old$;
  replacement CONSTANT text := $new$        ELSIF TG_RELID='public."ExpenseClaimPaymentExecution"'::regclass AND TG_OP='INSERT'
          AND current_user=session_user AND current_user='general_procurement_runtime'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text)','EXECUTE') THEN
          binding_exists := COALESCE(public.jg_check_legacy_procurement_expense_voucher_v1(
            NEW."expenseClaimId", (SELECT c."projectId" FROM public."ExpenseClaim" c WHERE c.id=NEW."expenseClaimId"),
            candidate_file_id,NEW."recordedByUserId"), true);
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$new$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS (
      SELECT FROM pg_proc p WHERE p.oid=raw_oid AND p.proowner=owner_oid AND p.prosecdef
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid
               AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
             FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    ) THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public."ExpenseClaimPaymentExecution" IN SHARE ROW EXCLUSIVE MODE;
  previous_closure:=public.jg_require_contract_direct_upward_source_v2();
  SELECT to_jsonb(t),pg_get_triggerdef(t.oid) INTO STRICT original_trigger,trigger_definition
  FROM pg_trigger t
  WHERE t.tgrelid='public."ExpenseClaimPaymentExecution"'::regclass AND t.tgname='jg_efb_expense_claim_payment_execution_voucher'
    AND t.tgfoid=original_oid AND t.tgenabled='O' AND t.tgtype=23 AND NOT t.tgisinternal
    AND t.tgqual IS NULL AND t.tgconstraint=0 AND t.tgnargs=2
    AND encode(t.tgargs,'hex')='766f756368657246696c654964007472756500'
    AND t.tgattr::text=(SELECT attnum::text FROM pg_attribute
      WHERE attrelid=t.tgrelid AND attname='voucherFileId' AND NOT attisdropped);

  SELECT p.prosrc,pg_get_functiondef(p.oid) INTO STRICT original_body,definition
  FROM pg_proc p WHERE p.oid=original_oid AND p.proowner=owner_oid AND NOT p.prosecdef
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b';
  IF cardinality(string_to_array(original_body,needle))<>2
    OR cardinality(string_to_array(definition,original_body))<>2
    OR cardinality(string_to_array(definition,'public.jg_enforce_exclusive_file_business_binding()'))<>2
    OR cardinality(string_to_array(trigger_definition,'public.jg_enforce_exclusive_file_business_binding('))<>2
    OR trigger_definition NOT LIKE 'CREATE TRIGGER %' THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_TRIGGER_PREIMAGE' USING ERRCODE='55000';
  END IF;

  successor:=replace(original_body,needle,replacement);
  EXECUTE replace(replace(definition,original_body,successor),
    'public.jg_enforce_exclusive_file_business_binding()', 'public.jg_legacy_procurement_expense_voucher_guard_v1()');
  successor_oid:=to_regprocedure('public.jg_legacy_procurement_expense_voucher_guard_v1()');
  REVOKE ALL ON FUNCTION public.jg_legacy_procurement_expense_voucher_guard_v1() FROM PUBLIC;
  EXECUTE replace(regexp_replace(trigger_definition,'^CREATE TRIGGER ','CREATE OR REPLACE TRIGGER '),
    'public.jg_enforce_exclusive_file_business_binding(', 'public.jg_legacy_procurement_expense_voucher_guard_v1(');

  IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid=successor_oid AND p.proowner=owner_oid
                 AND NOT p.prosecdef AND p.prosrc=successor)
    OR NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgfoid=successor_oid
                   AND to_jsonb(t)-'tgfoid'=original_trigger-'tgfoid')
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM previous_closure THEN
    RAISE EXCEPTION 'LEGACY_PROCUREMENT_EXPENSE_VOUCHER_TRIGGER_POSTIMAGE' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
