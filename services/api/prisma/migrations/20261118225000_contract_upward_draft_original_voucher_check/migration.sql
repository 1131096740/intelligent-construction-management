BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE TABLE public.jg_a08_direct_original_voucher_binding_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL,
  ordinary_role_oid oid NOT NULL,
  project_id text NOT NULL,
  version_id text NOT NULL,
  applicant_id text NOT NULL,
  file_id text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png'))
);
REVOKE ALL ON TABLE public.jg_a08_direct_original_voucher_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_check_a08_direct_original_voucher_v1(p_version text, p_file text)
RETURNS boolean LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $voucher$
DECLARE
  target record;
BEGIN
  IF pg_trigger_depth() NOT IN (0, 1)
    OR current_setting('session_replication_role') <> 'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_SCOPE' USING ERRCODE='42501';
  END IF;

  SELECT b.file_id INTO STRICT target
  FROM public.jg_a08_direct_original_voucher_binding_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.ordinary_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname ~ '^jg_fixture_app_[a-f0-9]{24}$' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members member WHERE app.oid IN (member.member,member.roleid))
  JOIN public."ContractVersion" v ON v.id=b.version_id AND v.id=p_version
    AND v.status='draft' AND v."numericProtocolVersion"=2 AND v."versionNo"=1 AND v."changeType"='original'
    AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL
    AND v."effectiveAt" IS NULL AND v."endedAt" IS NULL
    AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
    AND v."draftData"#>>'{directSigningInput,relationship}'='upward'
    AND v."draftData"#>>'{directSigningInput,protocolVersion}'='2'
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=b.project_id
    AND c."ownerUserId"=b.applicant_id AND c."contractTypeKey"='material_purchase' AND c."voidedAt" IS NULL
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."FileObject" f ON f.id=b.file_id AND f.id=p_file AND f."uploadedByUserId"=b.applicant_id
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND f."contentSha256"=b.content_sha256 AND f."sizeBytes"=b.size_bytes AND f."mimeType"=b.mime_type
  WHERE b.singleton AND b.server_port=inet_server_port()
    AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
  FOR SHARE OF b,v,c,p NOWAIT FOR UPDATE OF f NOWAIT;

  IF NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_BUSY' USING ERRCODE='55P03';
  END IF;
  RETURN public.jg_project_owner_settlement_voucher_bound(target.file_id);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'A08_DRAFT_VOUCHER_BINDING' USING ERRCODE='55000';
END;
$voucher$;
REVOKE ALL ON FUNCTION public.jg_check_a08_direct_original_voucher_v1(text,text) FROM PUBLIC;

DO $splice$
DECLARE
  guard_oid oid := to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  helper_oid oid := to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)');
  owner_oid oid := current_user::regrole::oid;
  before_row record;
  expected record;
  actual record;
  before_closure text;
  before_binding jsonb;
  before_body text;
  after_body text;
  definition text;
  target CONSTANT text := $target$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$target$;
  replacement CONSTANT text := $branch$        ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractDraftAttachment'
          AND TG_OP IN ('INSERT','UPDATE') AND to_jsonb(NEW)->>'slotKey'='direct_signed_originals_v1'
          AND current_user=session_user AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_a08_direct_original_voucher_v1(text,text)','EXECUTE') THEN
          binding_exists := public.jg_check_a08_direct_original_voucher_v1(NEW."contractVersionId",candidate_file_id);
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$branch$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=helper_oid AND p.proowner=owner_oid AND p.prosecdef
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
      AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
           FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_upward_closure_v2 IN SHARE ROW EXCLUSIVE MODE;
  before_closure:=public.jg_require_contract_direct_upward_source_v2();
  SELECT to_jsonb(p)-'prosrc' AS metadata,p.prosrc INTO STRICT before_row FROM pg_proc p
    WHERE p.oid=guard_oid AND p.proowner=owner_oid AND NOT p.prosecdef;
  SELECT to_jsonb(t) INTO STRICT before_binding FROM pg_trigger t
    WHERE t.tgfoid=guard_oid AND t.tgrelid='public."ContractDraftAttachment"'::regclass
      AND t.tgname='jg_direct_pending_attachment_exclusive' AND t.tgenabled='O' AND NOT t.tgisinternal;
  before_body:=before_row.prosrc;
  IF encode(sha256(convert_to(before_body,'UTF8')),'hex')<>'2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505'
    OR cardinality(string_to_array(before_body,target))<>2 THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_PREIMAGE' USING ERRCODE='55000';
  END IF;
  after_body:=replace(before_body,target,replacement);
  IF encode(sha256(convert_to(after_body,'UTF8')),'hex')<>'c8b62d1c944bfbcdb541713bd366e2e148e530ea9fd5ea13200feb4372e3d915' THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_DIGEST' USING ERRCODE='55000';
  END IF;
  definition:=pg_get_functiondef(guard_oid);
  IF cardinality(string_to_array(definition,before_body))<>2 THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_DEFINITION' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,before_body,after_body);
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=guard_oid AND p.prosrc=after_body AND to_jsonb(p)-'prosrc'=before_row.metadata)
    OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.oid=(before_binding->>'oid')::oid AND to_jsonb(t)=before_binding) THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_POSTIMAGE' USING ERRCODE='55000';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_require_contract_direct_upward_source_v2()','453e894e00209ce18445de091601b9f58c5644e7b85a48476a49e338e564df29','a7ab89578c9a81cddf4f2642e66e12fd629994e7b4ff9888dca1f5e41bcdd7fb',
      $old$encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505'$old$,$new$(encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505' AND to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)') IS NULL
              OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c8b62d1c944bfbcdb541713bd366e2e148e530ea9fd5ea13200feb4372e3d915'
                AND EXISTS(SELECT FROM pg_proc h JOIN pg_language l ON l.oid=h.prolang
                  JOIN pg_class c ON c.oid=to_regclass('public.jg_a08_direct_original_voucher_binding_v1')
                  WHERE h.oid=to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)')
                    AND h.pronamespace=binding."namespaceOid" AND h.proowner=binding."anchorOwnerOid"
                    AND c.relowner=h.proowner AND c.relnamespace=h.pronamespace AND c.relkind='r'
                    AND NOT (c.relrowsecurity OR c.relforcerowsecurity OR c.relispartition)
                    AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
                      WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner)
                    AND NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0
                      AND NOT a.attisdropped AND a.attacl IS NOT NULL)
                    AND h.prosecdef AND h.proisstrict AND h.prokind='f' AND h.provolatile='v' AND h.proparallel='u'
                    AND NOT(h.proleakproof OR h.proretset) AND l.lanname='plpgsql'
                    AND h.prorettype='pg_catalog.bool'::regtype AND h.pronargs=2 AND h.pronargdefaults=0
                    AND h.proargtypes='25 25'::oidvector AND h.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                    AND encode(sha256(convert_to(h.prosrc,'UTF8')),'hex')='d81674e3e0e51236d4927b11a3c90c59b1d385fd01044f0cde1604d05c115ab3'
                    AND (SELECT count(*) FILTER(WHERE a.grantee=h.proowner)=1
                      AND bool_and(a.grantor=h.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
                        AND (a.grantee=h.proowner OR EXISTS(SELECT FROM public.jg_a08_direct_original_voucher_binding_v1 b
                          WHERE b.singleton AND b.ordinary_role_oid=a.grantee AND a.grantee=binding."applicationRoleOid")))
                      FROM aclexplode(h.proacl) a)))$new$,2),
    ('public.jg_upward_archive_catalog_projection_v2()','70e7e6bafbbbade094822d721ab9422f8bb38ef82c4352d29a0ebcdf5c210df7','53661a5ad39cb85840a66cc2fa12df81005ed663d8ae2fdaeba4e97d448f9bca',
      '453e894e00209ce18445de091601b9f58c5644e7b85a48476a49e338e564df29','a7ab89578c9a81cddf4f2642e66e12fd629994e7b4ff9888dca1f5e41bcdd7fb',1),
    ('public.jg_upward_direct_archive_admission_v1()','eec718b28421b4aef7dfa96a3c2c4d5ec96d2224d7ce34eda0d09a2b77440b14','836f71dca78f01bc2b1de12a2812a264364b67cc237c04147fb7536116b9db49',
      '70e7e6bafbbbade094822d721ab9422f8bb38ef82c4352d29a0ebcdf5c210df7','53661a5ad39cb85840a66cc2fa12df81005ed663d8ae2fdaeba4e97d448f9bca',1)
  ) AS pins(signature,prior_sha,next_sha,anchor,replacement,occurrences)
  LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid
        AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>expected.occurrences+1 THEN
      RAISE EXCEPTION 'A08_DRAFT_VOUCHER_CLOSURE_PREIMAGE' USING ERRCODE='55000';
    END IF;
    after_body:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(after_body,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'A08_DRAFT_VOUCHER_CLOSURE_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,after_body);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=after_body AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'A08_DRAFT_VOUCHER_CLOSURE_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM before_closure THEN
    RAISE EXCEPTION 'A08_DRAFT_VOUCHER_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$splice$;
COMMIT;
