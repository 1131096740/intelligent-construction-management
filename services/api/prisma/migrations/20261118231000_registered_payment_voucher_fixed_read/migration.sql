BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- The existing owner-only scope already pins the exact file, payment and
-- selected actor. The read path additionally requires the committed voucher.
CREATE FUNCTION public.jg_read_registered_payment_voucher_binding_v1(p_execution text, p_file text, p_actor text)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $voucher$
DECLARE
  bound_file text;
BEGIN
  IF pg_trigger_depth() <> 0
    OR current_setting('session_replication_role') <> 'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_READ_SCOPE' USING ERRCODE='42501';
  END IF;

  SELECT f.id INTO STRICT bound_file
  FROM public.jg_registered_payment_voucher_check_binding_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.runtime_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname='jg_task01_runtime' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE app.oid IN (m.member,m.roleid))
  JOIN public."PaymentExecution" execution ON execution.id=b.execution_id
    AND execution."paymentRequestId"=b.payment_id AND execution."voucherFileId" IS NULL
  JOIN public."RegisteredPaymentFunding" funding ON funding."executionId"=execution.id
  JOIN public."PaymentRequest" payment ON payment.id=b.payment_id AND payment."projectId"=b.project_id
    AND payment."paymentSubjectType"='our_company'
  JOIN public."User" actor ON actor.id=b.actor_id AND actor."isActive"
  JOIN public."RegisteredPaymentVoucher" voucher ON voucher."executionId"=execution.id
    AND voucher."fileId"=b.file_id AND voucher."uploadedByUserId"=actor.id AND voucher."contentSha256"=b.content_sha256
  JOIN public."FileObject" f ON f.id=voucher."fileId" AND f."uploadedByUserId"=actor.id
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND f."contentSha256"=b.content_sha256 AND f."sizeBytes"=b.size_bytes AND f."mimeType"=b.mime_type
  WHERE b.singleton AND b.execution_id=p_execution AND b.file_id=p_file AND b.actor_id=p_actor
    AND b.server_port=inet_server_port() AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE');

  RETURN public.jg_project_owner_settlement_voucher_bound(bound_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_READ_BINDING' USING ERRCODE='55000';
END;
$voucher$;
REVOKE ALL ON FUNCTION public.jg_read_registered_payment_voucher_binding_v1(text,text,text) FROM PUBLIC;

DO $install$
DECLARE owner_oid oid := current_user::regrole::oid;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR public.jg_require_contract_direct_upward_source_v2() IS NULL
    OR EXISTS(SELECT FROM public.jg_registered_payment_voucher_check_binding_v1)
    OR NOT EXISTS(
      SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')
        AND p.proowner=owner_oid AND p.prosecdef
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid
              AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
             FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    ) THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_READ_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
