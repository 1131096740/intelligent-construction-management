BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;
LOCK TABLE public.jg_contract_direct_upward_closure_v2,
  public.jg_contract_direct_upward_execution_binding_v2,
  public.jg_contract_direct_upward_issuer_binding_v2 IN SHARE ROW EXCLUSIVE MODE;

DO $forward$
DECLARE
  owner_oid OID:=current_user::regrole::oid;
  namespace_oid OID:=to_regnamespace('public');
  core_sha CONSTANT TEXT:='c86b37cc155cb5cf424dd682f9767363da264eed8630a0dee9f02acde0dc3f49';
  core_before JSONB;
  closure_before JSONB;
  closure_sha TEXT;
  app_oid OID;
  expected RECORD;
  actual RECORD;
  next_body TEXT;
  definition TEXT;
BEGIN
  IF current_user IS DISTINCT FROM session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid) THEN
    RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_OWNER' USING ERRCODE='55000';
  END IF;

  SELECT to_jsonb(p) INTO STRICT core_before FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()')
      AND p.proowner=owner_oid AND p.pronamespace=namespace_oid AND p.prokind='f' AND l.lanname='plpgsql'
      AND NOT(p.prosecdef OR p.proisstrict OR p.proretset OR p.proleakproof)
      AND p.provolatile='v' AND p.proparallel='u' AND p.pronargs=0 AND p.pronargdefaults=0
      AND p.provariadic=0 AND p.prosupport=0 AND p.prorettype='pg_catalog.text'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=core_sha;
  SELECT to_jsonb(c),c."applicationRoleOid" INTO STRICT closure_before,app_oid
    FROM public.jg_contract_direct_upward_closure_v2 c;
  closure_sha:=public.jg_require_contract_direct_upward_source_v2();
  IF app_oid=owner_oid OR closure_sha IS DISTINCT FROM encode(sha256(convert_to(closure_before::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_CLOSURE' USING ERRCODE='55000';
  END IF;

  -- The verifier was advanced by the signed-change and signed-settlement file binding migration.
  -- Carry its identity through the two existing readers without changing their catalog or caller checks.
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_upward_archive_catalog_projection_v2()',true,
      '5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3',
      '486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7',
      '607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe',core_sha),
    ('public.jg_upward_direct_archive_admission_v1()',false,
      '0ae95bf1a1b3551b5a123869077432a74578cb5c49ca63e7a4be4320eecef462',
      '0a647f271a6ff2ec4bdf776c7a4950b26c4885babe980e08dec0182b2c1bae30',
      '5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3',
      '486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7')
  ) AS pins(signature,definer,prior_sha,next_sha,anchor,replacement) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid AND p.pronamespace=namespace_oid
        AND p.prokind='f' AND l.lanname='plpgsql' AND p.prosecdef=expected.definer
        AND NOT(p.proisstrict OR p.proretset OR p.proleakproof)
        AND p.provolatile='v' AND p.proparallel='u' AND p.pronargs=0 AND p.pronargdefaults=0
        AND p.provariadic=0 AND p.prosupport=0 AND p.prorettype='pg_catalog.jsonb'::regtype
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha
        AND (SELECT count(*)=2 AND count(*) FILTER(WHERE a.grantee=owner_oid)=1
          AND count(*) FILTER(WHERE a.grantee=app_oid AND NOT a.is_grantable)=1
          AND bool_and(a.grantor=owner_oid AND a.privilege_type='EXECUTE' AND a.grantee IN(owner_oid,app_oid))
          FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a);
    IF cardinality(string_to_array(actual.prosrc,expected.anchor))<>2 THEN
      RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_PREIMAGE' USING ERRCODE='55000';
    END IF;
    next_body:=replace(actual.prosrc,expected.anchor,expected.replacement);
    definition:=pg_get_functiondef(actual.oid);
    IF encode(sha256(convert_to(next_body,'UTF8')),'hex')<>expected.next_sha
      OR cardinality(string_to_array(definition,actual.prosrc))<>2 THEN
      RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_DEFINITION' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,next_body);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;

  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM closure_sha
    OR (SELECT to_jsonb(b) FROM public.jg_contract_direct_upward_closure_v2 b) IS DISTINCT FROM closure_before
    OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()'))
      IS DISTINCT FROM core_before THEN
    RAISE EXCEPTION 'UPWARD_ARCHIVE_VERIFIER_PIN_CLOSURE_DRIFT' USING ERRCODE='55000';
  END IF;
END;
$forward$;
COMMIT;
