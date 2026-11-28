-- Repair only the two unsealed read-only projection routines. The v2 source
-- verifier, its binding, prepare routine, triggers and privileges remain intact.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;
LOCK TABLE public.jg_contract_direct_upward_closure_v2,
  public.jg_contract_direct_upward_execution_binding_v2,
  public.jg_contract_direct_upward_issuer_binding_v2 IN SHARE ROW EXCLUSIVE MODE;

DO $forward$
DECLARE
  owner_id OID:=current_user::regrole::oid;
  namespace_id OID:=to_regnamespace('public');
  core_oid OID:=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()');
  projection_oid OID:=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()');
  admission_oid OID:=to_regprocedure('public.jg_upward_direct_archive_admission_v1()');
  closure_count INTEGER; app_oid OID; closure_before JSONB; closure_sha TEXT;
  old_projection RECORD; old_admission RECORD; old_body TEXT; new_body TEXT; definition TEXT;
  expected RECORD; actual RECORD;
BEGIN
  IF current_user IS DISTINCT FROM session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname=current_database() AND d.datdba=owner_id)
    OR core_oid IS NULL OR projection_oid IS NULL OR admission_oid IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=core_oid AND p.proowner=owner_id AND p.pronamespace=namespace_id AND p.prokind='f'
        AND l.lanname='plpgsql' AND NOT(p.prosecdef OR p.proisstrict OR p.proretset OR p.proleakproof)
        AND p.provolatile='v' AND p.proparallel='u' AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.prorettype='pg_catalog.text'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee') THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_SOURCE' USING ERRCODE='55000';
  END IF;

  SELECT count(*) INTO closure_count FROM public.jg_contract_direct_upward_closure_v2;
  IF closure_count=0 THEN
    IF EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_execution_binding_v2)
      OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2) THEN
      RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_PARTIAL' USING ERRCODE='55000';
    END IF;
    app_oid:=owner_id;
  ELSIF closure_count=1 THEN
    SELECT to_jsonb(c),c."applicationRoleOid" INTO STRICT closure_before,app_oid
      FROM public.jg_contract_direct_upward_closure_v2 c;
    IF app_oid=owner_id THEN RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_ROLE' USING ERRCODE='55000'; END IF;
    closure_sha:=public.jg_require_contract_direct_upward_source_v2();
    IF closure_sha IS DISTINCT FROM encode(sha256(convert_to(closure_before::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_CLOSURE' USING ERRCODE='55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_CLOSURE' USING ERRCODE='55000';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    (projection_oid,true,'785c21ee595eb128fa0911d3f18c9718457615f1d6df1abf532bf4159659210c'),
    (admission_oid,false,'1bba1794defdbf5dcff695f445e5d4f7dbcff2b34d2fcbe5e53a9decda6c5ff1')
  ) AS checks(oid,definer,body_sha) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=expected.oid AND p.proowner=owner_id AND p.pronamespace=namespace_id AND p.prokind='f'
        AND l.lanname='plpgsql' AND p.prosecdef=expected.definer AND NOT(p.proisstrict OR p.proretset OR p.proleakproof)
        AND p.provolatile='v' AND p.proparallel='u' AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
        AND (SELECT count(*)=CASE WHEN closure_count=0 THEN 1 ELSE 2 END
          AND count(*) FILTER(WHERE acl.grantee=owner_id)=1
          AND (closure_count=0 OR count(*) FILTER(WHERE acl.grantee=app_oid AND NOT acl.is_grantable)=1)
          AND bool_and(acl.grantor=owner_id AND acl.privilege_type='EXECUTE'
            AND (acl.grantee=owner_id OR (acl.grantee=app_oid AND NOT acl.is_grantable)))
          FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl);
    IF expected.oid=projection_oid THEN old_projection:=actual; ELSE old_admission:=actual; END IF;
  END LOOP;

  old_body:=old_projection.prosrc;
  IF cardinality(string_to_array(old_body,'9af4c2c58ac1adabb2580d76f90130c856dd1743f608824859a44d1bb5b3c0c4'))<>2 THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_ANCHOR' USING ERRCODE='55000';
  END IF;
  new_body:=replace(old_body,'9af4c2c58ac1adabb2580d76f90130c856dd1743f608824859a44d1bb5b3c0c4',
    'c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee');
  IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b' THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_BODY' USING ERRCODE='55000';
  END IF;
  definition:=pg_get_functiondef(projection_oid);
  IF cardinality(string_to_array(definition,old_body))<>2 THEN RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_DEFINITION' USING ERRCODE='55000'; END IF;
  EXECUTE replace(definition,old_body,new_body);

  old_body:=old_admission.prosrc;
  IF cardinality(string_to_array(old_body,'785c21ee595eb128fa0911d3f18c9718457615f1d6df1abf532bf4159659210c'))<>2 THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_ANCHOR' USING ERRCODE='55000';
  END IF;
  new_body:=replace(old_body,'785c21ee595eb128fa0911d3f18c9718457615f1d6df1abf532bf4159659210c',
    'ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b');
  IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'c95e8553897ff36853c9503fee242087c23a28479e02b3225f5fc24bfc3259c2' THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_BODY' USING ERRCODE='55000';
  END IF;
  definition:=pg_get_functiondef(admission_oid);
  IF cardinality(string_to_array(definition,old_body))<>2 THEN RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_DEFINITION' USING ERRCODE='55000'; END IF;
  EXECUTE replace(definition,old_body,new_body);

  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=projection_oid
      AND to_jsonb(p)-'prosrc'=old_projection.metadata
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=admission_oid
      AND to_jsonb(p)-'prosrc'=old_admission.metadata
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c95e8553897ff36853c9503fee242087c23a28479e02b3225f5fc24bfc3259c2') THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_POSTIMAGE' USING ERRCODE='55000';
  END IF;
  IF closure_count=1 AND (public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM closure_sha
    OR (SELECT to_jsonb(c) FROM public.jg_contract_direct_upward_closure_v2 c) IS DISTINCT FROM closure_before) THEN
    RAISE EXCEPTION 'UPWARD_PROJECTION_FORWARD_CLOSURE_DRIFT' USING ERRCODE='55000';
  END IF;
END;
$forward$;
COMMIT;
