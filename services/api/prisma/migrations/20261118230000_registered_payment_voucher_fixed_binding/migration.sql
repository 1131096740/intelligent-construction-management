BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE public.jg_registered_payment_voucher_check_binding_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL,
  runtime_role_oid oid NOT NULL,
  execution_id text NOT NULL,
  payment_id text NOT NULL,
  project_id text NOT NULL,
  actor_id text NOT NULL,
  file_id text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  mime_type text NOT NULL
);
REVOKE ALL ON TABLE public.jg_registered_payment_voucher_check_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_check_registered_payment_voucher_binding_v1(p_execution text, p_file text, p_actor text)
RETURNS boolean LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $voucher$
DECLARE
  bound_file text;
BEGIN
  IF pg_trigger_depth() NOT IN (0, 1)
    OR current_setting('session_replication_role') <> 'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_SCOPE' USING ERRCODE='42501';
  END IF;

  -- The original attach transaction locks the same execution before the
  -- shared file advisory lock. A direct invocation must use the same order.
  PERFORM 1 FROM public."PaymentExecution" execution
  WHERE execution.id=p_execution AND execution."voucherFileId" IS NULL
    AND EXISTS (
      SELECT FROM public.jg_registered_payment_voucher_check_binding_v1 b
      JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
        AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
      JOIN pg_roles app ON app.oid=b.runtime_role_oid AND app.oid=session_user::regrole::oid
        AND app.rolname='jg_task01_runtime' AND app.rolcanlogin
        AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
        AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE app.oid IN (m.member,m.roleid))
      WHERE b.singleton AND b.execution_id=p_execution AND b.file_id=p_file AND b.actor_id=p_actor
        AND b.payment_id=execution."paymentRequestId"
        AND b.server_port=inet_server_port()
        AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
        AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
    )
  FOR UPDATE OF execution NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_BINDING' USING ERRCODE='55000';
  END IF;
  IF NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_BUSY' USING ERRCODE='55P03';
  END IF;

  SELECT f.id INTO STRICT bound_file
  FROM public.jg_registered_payment_voucher_check_binding_v1 b
  JOIN public."PaymentExecution" execution ON execution.id=b.execution_id AND execution."paymentRequestId"=b.payment_id
  JOIN public."RegisteredPaymentFunding" funding ON funding."executionId"=execution.id
  JOIN public."PaymentRequest" payment ON payment.id=b.payment_id AND payment."projectId"=b.project_id
    AND payment."paymentSubjectType"='our_company'
  JOIN public."User" actor ON actor.id=b.actor_id AND actor."isActive"
  JOIN public."FileObject" f ON f.id=b.file_id AND f."uploadedByUserId"=actor.id
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND f."contentSha256"=b.content_sha256 AND f."sizeBytes"=b.size_bytes AND f."mimeType"=b.mime_type
  WHERE b.singleton AND b.execution_id=p_execution AND b.file_id=p_file AND b.actor_id=p_actor
    AND NOT EXISTS (SELECT FROM public."RegisteredPaymentVoucher" existing WHERE existing."executionId"=execution.id)
  FOR SHARE OF b NOWAIT FOR UPDATE OF f NOWAIT;

  RETURN public.jg_project_owner_settlement_voucher_bound(bound_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_BINDING' USING ERRCODE='55000';
END;
$voucher$;
REVOKE ALL ON FUNCTION public.jg_check_registered_payment_voucher_binding_v1(text,text,text) FROM PUBLIC;

DO $splice$
DECLARE
  guard_oid oid := to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  owner_oid oid := current_user::regrole::oid;
  expected record;
  actual record;
  previous_closure text;
  voucher_trigger jsonb;
  definition text;
  successor text;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS(SELECT FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')
        AND p.proowner=owner_oid AND p.prosecdef
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid
              AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
             FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public.jg_contract_direct_upward_closure_v2 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public."RegisteredPaymentVoucher" IN SHARE ROW EXCLUSIVE MODE;
  previous_closure:=public.jg_require_contract_direct_upward_source_v2();
  SELECT to_jsonb(t) INTO STRICT voucher_trigger
  FROM pg_trigger t WHERE t.tgfoid=guard_oid AND t.tgrelid='public."RegisteredPaymentVoucher"'::regclass
    AND t.tgname='jg_efb_registered_payment_voucher' AND t.tgenabled='O' AND t.tgtype=7 AND NOT t.tgisinternal
    AND t.tgqual IS NULL AND t.tgconstraint=0 AND t.tgattr::text='' AND t.tgnargs=2
    AND encode(t.tgargs,'hex')='66696c654964007472756500';

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_enforce_exclusive_file_business_binding()','c8b62d1c944bfbcdb541713bd366e2e148e530ea9fd5ea13200feb4372e3d915','c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b',$old$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$old$,$new$        ELSIF TG_RELID='public."RegisteredPaymentVoucher"'::regclass AND TG_OP='INSERT'
          AND current_user=session_user AND current_user='jg_task01_runtime'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_registered_payment_voucher_binding_v1(text,text,text)','EXECUTE') THEN
          binding_exists := public.jg_check_registered_payment_voucher_binding_v1(NEW."executionId",candidate_file_id,NEW."uploadedByUserId");
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$new$,1),
    ('public.jg_require_contract_direct_upward_source_v2()','a7ab89578c9a81cddf4f2642e66e12fd629994e7b4ff9888dca1f5e41bcdd7fb','554a64629d5c4131ce4be30bf09b253a948f2244e126d0146adaf376ce0aca58',$old$c8b62d1c944bfbcdb541713bd366e2e148e530ea9fd5ea13200feb4372e3d915'$old$,$new$c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b' AND EXISTS(SELECT FROM pg_proc h JOIN pg_language l ON l.oid=h.prolang
                  JOIN pg_class c ON c.oid=to_regclass('public.jg_registered_payment_voucher_check_binding_v1')
                  WHERE h.oid=to_regprocedure('public.jg_check_registered_payment_voucher_binding_v1(text,text,text)')
                    AND h.pronamespace=binding."namespaceOid" AND h.proowner=binding."anchorOwnerOid"
                    AND c.relowner=h.proowner AND c.relnamespace=h.pronamespace AND c.relkind='r'
                    AND NOT (c.relrowsecurity OR c.relforcerowsecurity OR c.relispartition)
                    AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
                      WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner)
                    AND NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0
                      AND NOT a.attisdropped AND a.attacl IS NOT NULL)
                    AND h.prosecdef AND h.proisstrict AND h.prokind='f' AND h.provolatile='v' AND h.proparallel='u'
                    AND NOT (h.proleakproof OR h.proretset) AND l.lanname='plpgsql'
                    AND h.prorettype='pg_catalog.bool'::regtype AND h.pronargs=3 AND h.pronargdefaults=0
                    AND h.proargtypes='25 25 25'::oidvector AND h.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                    AND encode(sha256(convert_to(h.prosrc,'UTF8')),'hex')='fb6eae7151e69fa1742039f9633db994c3e66d558175bbd1ab9e5015bfb58bde'
                    AND (SELECT count(*) FILTER(WHERE a.grantee=h.proowner)=1
                      AND bool_and(a.grantor=h.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
                        AND (a.grantee=h.proowner OR EXISTS(SELECT FROM public.jg_registered_payment_voucher_check_binding_v1 b
                          JOIN pg_roles r ON r.oid=b.runtime_role_oid AND r.rolname='jg_task01_runtime'
                          WHERE b.singleton AND b.runtime_role_oid=a.grantee AND b.database_oid=binding."databaseOid")))
                      FROM aclexplode(h.proacl) a))$new$,2),
    ('public.jg_upward_archive_catalog_projection_v2()','53661a5ad39cb85840a66cc2fa12df81005ed663d8ae2fdaeba4e97d448f9bca','f245e2713b56b32545b5f930247481da448a7a4278824a909b5326a71fa1b6d0',$old$a7ab89578c9a81cddf4f2642e66e12fd629994e7b4ff9888dca1f5e41bcdd7fb$old$,$new$554a64629d5c4131ce4be30bf09b253a948f2244e126d0146adaf376ce0aca58$new$,1),
    ('public.jg_upward_direct_archive_admission_v1()','836f71dca78f01bc2b1de12a2812a264364b67cc237c04147fb7536116b9db49','c6003492b764e96398aeecfcff241fc4dd7978350d1a89a89a538bf8bd829df9',$old$53661a5ad39cb85840a66cc2fa12df81005ed663d8ae2fdaeba4e97d448f9bca$old$,$new$f245e2713b56b32545b5f930247481da448a7a4278824a909b5326a71fa1b6d0$new$,1)
  ) pins(signature,prior_sha,next_sha,anchor,replacement,occurrences)
  LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid
        AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>expected.occurrences+1 THEN
      RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_PREIMAGE' USING ERRCODE='55000';
    END IF;
    successor:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(successor,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_SUCCESSOR' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,successor);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=successor
      AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;

  IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.oid=(voucher_trigger->>'oid')::oid AND to_jsonb(t)=voucher_trigger)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM previous_closure THEN
    RAISE EXCEPTION 'REGISTERED_PAYMENT_VOUCHER_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$splice$;

COMMIT;
