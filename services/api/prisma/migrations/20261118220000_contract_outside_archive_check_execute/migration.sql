-- Extend the existing CHECK capability only after the original archive
-- installers have sealed both relationship profiles. Cold deployment keeps
-- the predecessor intact until the original owner completes that installation.
BEGIN;

CREATE FUNCTION public.jg_activate_outside_archive_check_execute_v1() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $activate$
DECLARE
  owner_oid oid:=current_user::regrole::oid;
  predicate_oid oid:=to_regprocedure('public.jg_upward_archive_constraint_v2(public."ContractVersion")');
  version_oid oid:='public."ContractVersion"'::regclass;
  outside_binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  closure_before public.jg_contract_direct_upward_closure_v2%ROWTYPE;
  executor_name name;
  source_sha text;
  predicate_before jsonb;
  predicate_acl jsonb;
  expected record;
  original record;
  next_source text;
  verifier record;
  verifier_definition text;
  qualified_source text;
  voucher_successor CONSTANT text := $voucher$
          OR (t.tgname=ANY(ARRAY['jg_direct_pending_attachment_exclusive','jg_efb_17','jg_efb_4','jg_efb_contract_archive_v2_evidence','jg_efb_contract_draft_attachment'])
            AND p.oid=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')
            AND item->>'routineBodySha256'='e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999'
            AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1'
            AND (SELECT count(*)=5 AND count(DISTINCT entry->'metadata'->>'tgname')=5
              AND bool_and(entry->'metadata'->>'tgname'=ANY(ARRAY['jg_direct_pending_attachment_exclusive','jg_efb_17','jg_efb_4','jg_efb_contract_archive_v2_evidence','jg_efb_contract_draft_attachment'])
                AND entry->>'routineBodySha256'='e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999')
              FROM jsonb_array_elements(binding."triggers") entry
              WHERE (entry->'routineMetadata'->>'oid')::oid=p.oid))$voucher$;
  voucher_coherence CONSTANT text := $coherence$
        AND (p.oid IS DISTINCT FROM to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')
          OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999'
            AND NOT EXISTS(SELECT 1 FROM public."_prisma_migrations"
              WHERE migration_name='20261118185000_project_owner_settlement_voucher_binding'))
          OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1'
            AND (SELECT count(*)=1 AND count(*) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
              AND checksum='b47da44e7716d1509bc1b9d82a42a269f86a3fb8df33c435891f12925cf40ebf')=1
              FROM public."_prisma_migrations" WHERE migration_name='20261118185000_project_owner_settlement_voucher_binding')
            AND (SELECT count(*)=3 AND bool_and(f.pronamespace=binding."namespaceOid"
                AND f.proowner=binding."anchorOwnerOid" AND f.prosecdef=x.definer
                AND f.prorettype=x.result::regtype AND f.provolatile=x.volatility::"char" AND f.proparallel=x.parallel::"char"
                AND f.proconfig=ARRAY['search_path=pg_catalog, public'] AND NOT(f.proisstrict OR f.proleakproof)
                AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=x.body_sha
                AND (NOT x.definer OR NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) acl
                  WHERE acl.grantor<>f.proowner OR acl.grantee<>f.proowner OR acl.privilege_type<>'EXECUTE')))
              FROM (VALUES
               ('public.jg_project_owner_settlement_voucher_bound(text)',true,'pg_catalog.bool','s','u','fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'),
               ('public.jg_file_business_binding_columns()',false,'pg_catalog.record','s','s','6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f'),
               ('public.jg_guard_project_owner_settlement_voucher()',true,'pg_catalog.trigger','v','u','4f94fad240e5fbc3cdaf23f93823ec61fa586a893108421e32db12b4e0978788')
              ) x(signature,definer,result,volatility,parallel,body_sha)
              JOIN pg_proc f ON f.oid=to_regprocedure(x.signature))
            AND EXISTS(SELECT 1 FROM pg_trigger voucher
              WHERE voucher.tgrelid=to_regclass('public."ProjectOwnerSettlementEntry"')
                AND voucher.tgname='jg_efb_project_owner_settlement_voucher'
                AND voucher.tgfoid=to_regprocedure('public.jg_guard_project_owner_settlement_voucher()')
                AND voucher.tgtype=7 AND voucher.tgenabled='O'
                AND NOT(voucher.tgisinternal OR voucher.tgdeferrable OR voucher.tginitdeferred)
                AND voucher.tgqual IS NULL AND voucher.tgnargs=0 AND voucher.tgattr::text='')))$coherence$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=owner_oid) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_OWNER' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_upward_closure_v2,
    public.jg_contract_direct_archive_intent_binding_v1 IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT closure_before FROM public.jg_contract_direct_upward_closure_v2 WHERE "protocolVersion"=2;
  SELECT * INTO STRICT outside_binding FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
  -- Accept the #412 successor before evaluating the original closure, while
  -- keeping the predecessor predicate ACL until the normal grant checks pass.
  SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT verifier
    FROM pg_proc p WHERE p.oid=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()')
      AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee';
  verifier_definition:=pg_get_functiondef(verifier.oid);
  IF cardinality(string_to_array(verifier_definition,verifier.prosrc))<>2
    OR cardinality(string_to_array(verifier.prosrc,$guard_before$        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$guard_before$))<>2 THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_VOUCHER_PREIMAGE' USING ERRCODE='55000';
  END IF;
  qualified_source:=replace(verifier.prosrc,$guard_before$        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$guard_before$,
    $guard_after$        AND (encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$guard_after$||voucher_successor||')'||voucher_coherence);
  IF encode(sha256(convert_to(qualified_source,'UTF8')),'hex')<>'da949989b3b4d7b0740841f406747758a20a6e3a21fc3b21511f059d31163584' THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_VOUCHER_SOURCE' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(verifier_definition,verifier.prosrc,qualified_source);
  source_sha:=public.jg_require_contract_direct_upward_source_v2();
  EXECUTE verifier_definition;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=verifier.oid AND p.prosrc=verifier.prosrc
    AND to_jsonb(p)-'prosrc'=verifier.metadata) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_VOUCHER_RESTORE' USING ERRCODE='55000';
  END IF;
  IF outside_binding."anchorOwnerOid"<>owner_oid
    OR outside_binding."ordinaryApplicationRoleOid"<>closure_before."applicationRoleOid"
    OR outside_binding."executorOwnerOid" IN (owner_oid,closure_before."applicationRoleOid",
      outside_binding."issuerOwnerOid",outside_binding."issuerSessionOid",outside_binding."runtimeSessionOid") THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_BINDING' USING ERRCODE='55000';
  END IF;
  SELECT r.rolname INTO STRICT executor_name FROM pg_roles r
    JOIN pg_proc e ON e.oid=to_regprocedure('public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)')
      AND e.proowner=r.oid AND e.prosecdef
    WHERE r.oid=outside_binding."executorOwnerOid"
      AND NOT(r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE r.oid IN(m.member,m.roleid));
  SELECT to_jsonb(p)-'proacl', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee)
    FROM aclexplode(p.proacl) a), '[]'::jsonb)
    INTO STRICT predicate_before,predicate_acl FROM pg_proc p
    JOIN pg_class v ON v.oid=version_oid AND v.relowner=owner_oid
    WHERE p.oid=predicate_oid AND p.proowner=owner_oid AND p.pronamespace=v.relnamespace
      AND has_function_privilege(closure_before."applicationRoleOid",p.oid,'EXECUTE')
      AND NOT has_function_privilege(outside_binding."executorOwnerOid",p.oid,'EXECUTE');
  IF jsonb_array_length(predicate_acl)<>2 THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_ACL' USING ERRCODE='55000';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_require_contract_direct_upward_source_v2()','c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee','1ae814013d8b88372a4d1a057f6507d9a2bfd1b06b64e7f3aacc6bfbc88596b6',
      $before$      AND has_function_privilege(binding."applicationRoleOid",predicate.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(predicate.proacl,acldefault('f',predicate.proowner))) acl
        WHERE acl.grantor<>predicate.proowner OR acl.grantee NOT IN(predicate.proowner,binding."applicationRoleOid")
          OR acl.privilege_type<>'EXECUTE' OR acl.grantee<>predicate.proowner AND acl.is_grantable))$before$,$after$      AND has_function_privilege(binding."applicationRoleOid",predicate.oid,'EXECUTE')
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles executor
        WHERE executor.oid=outside."executorOwnerOid" AND executor.oid NOT IN(predicate.proowner,binding."applicationRoleOid")
          AND NOT(executor.rolcanlogin OR executor.rolsuper OR executor.rolinherit OR executor.rolcreatedb
            OR executor.rolcreaterole OR executor.rolreplication OR executor.rolbypassrls)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE executor.oid IN(m.member,m.roleid)))
      AND has_function_privilege(outside."executorOwnerOid",predicate.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(predicate.proacl,acldefault('f',predicate.proowner))) acl
        WHERE acl.grantor<>predicate.proowner OR acl.grantee NOT IN(predicate.proowner,binding."applicationRoleOid",outside."executorOwnerOid")
          OR acl.privilege_type<>'EXECUTE' OR acl.grantee<>predicate.proowner AND acl.is_grantable))$after$),
    ('public.jg_upward_archive_catalog_projection_v2()','ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b','f4254d80288f89f9ab18e5bc74cb30800234424616b7633643d5bbece2674ad5',
      $before$c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee$before$,$after$1ae814013d8b88372a4d1a057f6507d9a2bfd1b06b64e7f3aacc6bfbc88596b6$after$),
    ('public.jg_upward_direct_archive_admission_v1()','c95e8553897ff36853c9503fee242087c23a28479e02b3225f5fc24bfc3259c2','bc891187984689e844362dce318c574a67ec16e582bfdf446481562c0641078b',
      $before$ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b$before$,$after$f4254d80288f89f9ab18e5bc74cb30800234424616b7633643d5bbece2674ad5$after$)
  ) recipe(signature,before_sha,after_sha,before_anchor,after_anchor) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
      FROM pg_proc p
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.before_sha;
    IF cardinality(string_to_array(original.prosrc,expected.before_anchor))<>2
      OR cardinality(string_to_array(pg_get_functiondef(original.oid),original.prosrc))<>2 THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_SOURCE_ANCHOR' USING ERRCODE='55000';
    END IF;
    next_source:=replace(original.prosrc,expected.before_anchor,expected.after_anchor);
    IF expected.signature='public.jg_require_contract_direct_upward_source_v2()' THEN
      IF cardinality(string_to_array(next_source,$trigger_before$        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$trigger_before$))<>2 THEN
        RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_TRIGGER_SOURCE_ANCHOR' USING ERRCODE='55000';
      END IF;
      next_source:=replace(next_source,$trigger_before$        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$trigger_before$,$trigger_after$        AND (encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256'$trigger_after$||voucher_successor||$trigger_after$
          OR (t.tgrelid='public."ContractVersion"'::regclass AND p.proowner=binding."anchorOwnerOid"
            AND p.pronamespace=binding."namespaceOid" AND (
              (t.tgname='ContractVersion_require_active_participant'
                AND p.oid=to_regprocedure('public."requireActiveProjectParticipatingCompany"()')
                AND item->>'routineBodySha256'='ba713bc2f3d6c7faa9390f75fd9f459a7d2bd2791d62a39fa33a97b291f0ccfc'
                AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1e5c1ae87f5227d928ce16e58d89334e60edfb3e3fcbb3648dd94893cc3daff6'
                AND EXISTS(SELECT 1 FROM pg_proc counterpart
                  WHERE counterpart.oid=to_regprocedure('public."lockProjectConstructionEnterpriseFromFormalFact"()')
                    AND encode(sha256(convert_to(counterpart.prosrc,'UTF8')),'hex') IN (
                      'c57288b55b9bac928d32850b0e3171d2089ab1b7f417eb85e7c1282b6d2d90ca',
                      'a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f')))
              OR (t.tgname='ContractVersion_lock_construction_enterprise'
                AND p.oid=to_regprocedure('public."lockProjectConstructionEnterpriseFromFormalFact"()')
                AND item->>'routineBodySha256'='e651e3554e2938ebaa2c07578e109b1ad049188d4984820fe3bc017ca1879839'
                AND EXISTS(SELECT 1 FROM pg_proc counterpart
                  WHERE counterpart.oid=to_regprocedure('public."requireActiveProjectParticipatingCompany"()')
                    AND encode(sha256(convert_to(counterpart.prosrc,'UTF8')),'hex')='1e5c1ae87f5227d928ce16e58d89334e60edfb3e3fcbb3648dd94893cc3daff6')
                AND (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c57288b55b9bac928d32850b0e3171d2089ab1b7f417eb85e7c1282b6d2d90ca'
                  OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f'
                    AND EXISTS(SELECT 1 FROM pg_proc entry
                      WHERE entry.oid=to_regprocedure('public.jg_lock_direct_outside_non_operating_assignment_v1(text)')
                        AND entry.proowner=binding."anchorOwnerOid" AND entry.pronamespace=binding."namespaceOid"
                        AND entry.prosecdef AND entry.proisstrict AND entry.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                        AND encode(sha256(convert_to(entry.prosrc,'UTF8')),'hex')='22b310925d2630fb7408870030273fd3fd6c42ee0d507fb208cbefd750966af9'
                        AND (SELECT count(*)=2 AND count(*) FILTER(WHERE a.grantee=outside."executorOwnerOid" AND NOT a.is_grantable)=1
                          AND bool_and(a.grantor=entry.proowner AND a.privilege_type='EXECUTE'
                            AND a.grantee IN(entry.proowner,outside."executorOwnerOid"))
                          FROM aclexplode(entry.proacl) a))))))))$trigger_after$||voucher_coherence);
    END IF;
    IF encode(sha256(convert_to(next_source,'UTF8')),'hex')<>expected.after_sha THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_SOURCE_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_get_functiondef(original.oid),original.prosrc,next_source);
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=original.oid AND p.prosrc=next_source
      AND to_jsonb(p)-'prosrc'=original.metadata) THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_SOURCE_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_upward_archive_constraint_v2(public."ContractVersion") TO %I',executor_name);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=predicate_oid AND to_jsonb(p)-'proacl'=predicate_before
    AND (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee) FROM aclexplode(p.proacl) a
      WHERE a.grantee<>outside_binding."executorOwnerOid")=predicate_acl
    AND (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantor=owner_oid
      AND a.grantee=outside_binding."executorOwnerOid" AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)=1)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM source_sha
    OR (SELECT to_jsonb(c) FROM public.jg_contract_direct_upward_closure_v2 c WHERE c."protocolVersion"=2)
      IS DISTINCT FROM to_jsonb(closure_before) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_CHECK_POSTIMAGE' USING ERRCODE='55000';
  END IF;
  RETURN true;
END;
$activate$;
REVOKE ALL ON FUNCTION public.jg_activate_outside_archive_check_execute_v1() FROM PUBLIC;

DO $upgrade$
BEGIN
  IF EXISTS(SELECT FROM public.jg_contract_direct_upward_closure_v2) THEN
    PERFORM public.jg_activate_outside_archive_check_execute_v1();
  END IF;
END;
$upgrade$;

COMMIT;
