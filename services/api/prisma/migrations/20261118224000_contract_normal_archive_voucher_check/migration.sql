BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_check_normal_archive_voucher_v1(p_version text, p_file text, p_archive text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $voucher$
DECLARE
  target record;
  current_xmin text := mod(pg_current_xact_id()::text::numeric,4294967296)::text;
  locked integer;
BEGIN
  IF NOT ((pg_trigger_depth()=0 AND p_archive IS NULL) OR (pg_trigger_depth()=1 AND p_archive IS NOT NULL))
    OR current_setting('session_replication_role')<>'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_SCOPE' USING ERRCODE='42501';
  END IF;

  SELECT b.originals,b.applicant_id INTO STRICT target
  FROM public.jg_normal_generated_archive_activation_binding_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.ordinary_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname ~ '^jg_fixture_app_[a-f0-9]{24}$' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS(SELECT FROM pg_auth_members member WHERE app.oid IN (member.member,member.roleid))
  JOIN public."ContractVersion" v ON v.id=b.version_id AND v.id=p_version
    AND v.status='seal_approved_pending_archive' AND v."numericProtocolVersion"=2 AND v."versionNo"=1
    AND v."changeType"='original' AND v."supersedesVersionId" IS NULL AND v."signingSubjectType"='our_company'
    AND v."draftData"#>>'{contractBasics,relationship}'='inside'
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=b.project_id AND c."ownerUserId"=b.applicant_id
    AND c."contractTypeKey"='equipment_rental' AND c."voidedAt" IS NULL
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."ApprovalInstance" r ON r."businessId"=v.id AND r."businessType"='contract_version'
    AND r."flowType"='contract.approve' AND r."applicantUserId"=b.applicant_id AND r.status='approved'
  JOIN public."ContractSealTask" s ON s."contractVersionId"=v.id AND s."approvalInstanceId"=r.id
    AND s."handlerUserId"=b.applicant_id AND s.status='completed' AND s."completedAt" IS NOT NULL AND s."completedByUserId" IS NOT NULL
  WHERE b.singleton AND b.server_port=inet_server_port()
    AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
    AND (p_file=b.originals->0->>'fileId' OR p_file=b.originals->1->>'fileId')
    AND (b.originals->0->>'fileId')<>(b.originals->1->>'fileId')
    AND CASE WHEN p_archive IS NULL THEN NOT EXISTS(
      SELECT FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=v.id
    ) ELSE EXISTS(
      SELECT FROM public."ContractArchiveFile" a WHERE a.id=p_archive AND a."contractVersionId"=v.id
        AND a.xmin::text=current_xmin AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval'
        AND a.status='confirmed' AND a."idempotencyKey"=b.archive_request_key AND a."approvalInstanceId"=r.id AND a."sealTaskId"=s.id
        AND a."uploadedByUserId"=b.applicant_id AND a."confirmedByUserId"=b.applicant_id
        AND a."sourceRevision"=v."draftRevision" AND a."documentContentRevision"=v."documentContentRevision"
        AND a."documentContentFingerprint"=v."documentContentFingerprint"
        AND a."authoritySnapshot"->'fileManifest'=b.originals
    ) END
  FOR SHARE OF b,v,c,p,r,s NOWAIT;

  PERFORM 1 FROM public."FileObject" f
    JOIN jsonb_array_elements(target.originals) m ON f.id=m->>'fileId'
      AND f."uploadedByUserId"=target.applicant_id AND f."storageStatus"='active'
      AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
      AND f."contentSha256"=m->>'contentSha256' AND f."sizeBytes"=(m->>'sizeBytes')::integer
      AND f."mimeType"='application/pdf' AND f."mimeType"=m->>'mimeType'
    ORDER BY f.id FOR UPDATE OF f NOWAIT;
  GET DIAGNOSTICS locked=ROW_COUNT;
  IF locked<>2 THEN RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_FILES' USING ERRCODE='55000'; END IF;
  IF NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_BUSY' USING ERRCODE='55P03';
  END IF;
  RETURN public.jg_project_owner_settlement_voucher_bound(p_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_WITNESS' USING ERRCODE='55000';
END;
$voucher$;
REVOKE ALL ON FUNCTION public.jg_check_normal_archive_voucher_v1(text,text,text) FROM PUBLIC;

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
  target CONSTANT text := '        binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);';
  replacement CONSTANT text := $branch$        IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractArchiveEvidenceFile' AND TG_OP='INSERT'
          AND current_user=session_user AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_normal_archive_voucher_v1(text,text,text)','EXECUTE') THEN
          binding_exists := public.jg_check_normal_archive_voucher_v1(NEW."contractVersionId",candidate_file_id,NEW."archiveFileId");
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
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_upward_closure_v2 IN SHARE ROW EXCLUSIVE MODE;
  before_closure:=public.jg_require_contract_direct_upward_source_v2();
  SELECT to_jsonb(p)-'prosrc' AS metadata,p.prosrc INTO STRICT before_row FROM pg_proc p
    WHERE p.oid=guard_oid AND p.proowner=owner_oid AND NOT p.prosecdef;
  SELECT to_jsonb(t) INTO STRICT before_binding FROM pg_trigger t
    WHERE t.tgfoid=guard_oid AND t.tgrelid='public."ContractArchiveEvidenceFile"'::regclass
      AND t.tgname='jg_efb_contract_archive_v2_evidence' AND t.tgenabled='O' AND NOT t.tgisinternal;
  before_body:=before_row.prosrc;
  IF encode(sha256(convert_to(before_body,'UTF8')),'hex')<>'2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1'
    OR cardinality(string_to_array(before_body,target))<>2 THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_PREIMAGE' USING ERRCODE='55000';
  END IF;
  after_body:=replace(before_body,target,replacement);
  IF encode(sha256(convert_to(after_body,'UTF8')),'hex')<>'2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505' THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_DIGEST' USING ERRCODE='55000';
  END IF;
  definition:=pg_get_functiondef(guard_oid);
  IF cardinality(string_to_array(definition,before_body))<>2 THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_DEFINITION' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,before_body,after_body);
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=guard_oid AND p.prosrc=after_body AND to_jsonb(p)-'prosrc'=before_row.metadata)
    OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.oid=(before_binding->>'oid')::oid AND to_jsonb(t)=before_binding) THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_POSTIMAGE' USING ERRCODE='55000';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_require_contract_direct_upward_source_v2()','bf9ba05391f12deedb29516366e75131bce00b3e1ef4ba030d40e7d9132639d6','453e894e00209ce18445de091601b9f58c5644e7b85a48476a49e338e564df29',
      $old$encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1'$old$,$new$(encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1' AND to_regprocedure('public.jg_check_normal_archive_voucher_v1(text,text,text)') IS NULL
              OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505'
                AND EXISTS(SELECT FROM pg_proc h JOIN pg_language language ON language.oid=h.prolang
                  WHERE h.oid=to_regprocedure('public.jg_check_normal_archive_voucher_v1(text,text,text)')
                    AND h.pronamespace=binding."namespaceOid" AND h.proowner=binding."anchorOwnerOid"
                    AND h.prosecdef AND h.prokind='f' AND h.provolatile='v' AND h.proparallel='u'
                    AND NOT(h.proisstrict OR h.proleakproof OR h.proretset) AND language.lanname='plpgsql'
                    AND h.prorettype='pg_catalog.bool'::regtype AND h.pronargs=3 AND h.pronargdefaults=1
                    AND h.proargtypes='25 25 25'::oidvector AND h.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                    AND encode(sha256(convert_to(h.prosrc,'UTF8')),'hex')='cca53e10d26887d7c6ad4314f1c35a159135696b39b8d73bb7ed8823bd85abbe'
                    AND (SELECT count(*) FILTER(WHERE a.grantee=h.proowner)=1
                      AND bool_and(a.grantor=h.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
                        AND (a.grantee=h.proowner OR EXISTS(SELECT FROM public.jg_normal_generated_archive_activation_binding_v1 b
                          WHERE b.singleton AND b.ordinary_role_oid=a.grantee AND a.grantee=binding."applicationRoleOid")))
                      FROM aclexplode(h.proacl) a)))$new$,2),
    ('public.jg_upward_archive_catalog_projection_v2()','da70dd04b24f47b535b0123d465ca92b67b87185f846fca89a938a4f455654ed','70e7e6bafbbbade094822d721ab9422f8bb38ef82c4352d29a0ebcdf5c210df7',
      'bf9ba05391f12deedb29516366e75131bce00b3e1ef4ba030d40e7d9132639d6','453e894e00209ce18445de091601b9f58c5644e7b85a48476a49e338e564df29',1),
    ('public.jg_upward_direct_archive_admission_v1()','9fab3226f5baba20aa24f790eb1df477e45f062c57ca6175a22b13bda61f790c','eec718b28421b4aef7dfa96a3c2c4d5ec96d2224d7ce34eda0d09a2b77440b14',
      'da70dd04b24f47b535b0123d465ca92b67b87185f846fca89a938a4f455654ed','70e7e6bafbbbade094822d721ab9422f8bb38ef82c4352d29a0ebcdf5c210df7',1)
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
      RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_CLOSURE_PREIMAGE' USING ERRCODE='55000';
    END IF;
    after_body:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(after_body,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_CLOSURE_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,after_body);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=after_body AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_CLOSURE_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM before_closure THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_VOUCHER_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$splice$;
COMMIT;
