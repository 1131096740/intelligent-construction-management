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

LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,
  public."ContractSignedChange", public."SignedContractSettlementAttachment" IN SHARE ROW EXCLUSIVE MODE;

DO $outside_forward$
DECLARE
  anchor_oid OID:=current_user::regrole::oid;
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  role_ids OID[];
  login_ids OID[];
  executor_name NAME;
  target RECORD;
  relation_oid OID;
  column_no SMALLINT;
  table_acl ACLITEM[];
  column_acl ACLITEM[];
BEGIN
  SELECT * INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1;
  login_ids:=ARRAY[binding."issuerSessionOid",binding."runtimeSessionOid"];
  role_ids:=login_ids||ARRAY[binding."issuerOwnerOid",binding."executorOwnerOid"];
  IF current_user IS DISTINCT FROM session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=anchor_oid AND oid=binding."databaseOid")
    OR binding."protocolVersion"<>1 OR binding."anchorOwnerOid"<>anchor_oid
    OR binding."namespaceOid"<>to_regnamespace('public')::oid
    OR anchor_oid=ANY(role_ids) OR binding."ordinaryApplicationRoleOid"=ANY(role_ids)
    OR (SELECT count(*) FROM pg_roles r WHERE r.oid=ANY(role_ids) AND r.rolcanlogin=(r.oid=ANY(login_ids))
      AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
      AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN(m.member,m.roleid)))<>4
    OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure(
      'public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)')
      AND p.proowner=binding."executorOwnerOid" AND p.pronamespace=binding."namespaceOid" AND p.prosecdef
      AND has_function_privilege(binding."runtimeSessionOid",p.oid,'EXECUTE')
      AND NOT has_function_privilege(binding."ordinaryApplicationRoleOid",p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_FILE_BINDING_OWNER' USING ERRCODE='55000';
  END IF;
  SELECT rolname INTO STRICT executor_name FROM pg_roles WHERE oid=binding."executorOwnerOid";

  -- These are the two reference columns registered by the signed-file binding successor.
  -- Match the original installer's column-only ACL for the confined execution owner.
  FOR target IN SELECT * FROM (VALUES
    ('ContractSignedChange','appendixFormalFileId'),
    ('SignedContractSettlementAttachment','fileId')
  ) AS checked(relation_name,column_name) LOOP
    SELECT c.oid,a.attnum,c.relacl,a.attacl INTO STRICT relation_oid,column_no,table_acl,column_acl
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relname=target.relation_name AND c.relnamespace=binding."namespaceOid" AND c.relowner=anchor_oid
        AND c.relkind='r' AND c.relpersistence='p' AND NOT(c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
        AND a.attname=target.column_name AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
        AND a.atttypid='pg_catalog.text'::regtype AND a.attgenerated='' AND a.attidentity='';
    IF NOT EXISTS(SELECT FROM public.jg_file_business_collision_columns() c
        WHERE c."tableName"=target.relation_name AND c."columnName"=target.column_name)
      OR has_column_privilege(binding."executorOwnerOid",relation_oid,column_no,'SELECT')
      OR EXISTS(SELECT FROM unnest(login_ids) login(oid)
        WHERE has_table_privilege(login.oid,relation_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(login.oid,relation_oid,'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_FILE_BINDING_PREIMAGE' USING ERRCODE='55000';
    END IF;

    EXECUTE format('GRANT SELECT (%I) ON public.%I TO %I',target.column_name,target.relation_name,executor_name);

    IF NOT has_column_privilege(binding."executorOwnerOid",relation_oid,column_no,'SELECT')
      OR has_table_privilege(binding."executorOwnerOid",relation_oid,'SELECT')
      OR (SELECT relacl FROM pg_class WHERE oid=relation_oid) IS DISTINCT FROM table_acl
      OR EXISTS(SELECT FROM unnest(login_ids) login(oid)
        WHERE has_table_privilege(login.oid,relation_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(login.oid,relation_oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      OR EXISTS(
        WITH actual AS (
          SELECT a.* FROM pg_attribute p CROSS JOIN LATERAL aclexplode(p.attacl) a
          WHERE p.attrelid=relation_oid AND p.attnum=column_no
        ), expected AS (
          SELECT * FROM aclexplode(column_acl)
          UNION ALL SELECT anchor_oid,binding."executorOwnerOid",'SELECT'::text,false
        )
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
        UNION ALL
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      ) THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_FILE_BINDING_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$outside_forward$;
COMMIT;
