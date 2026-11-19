-- Optional source-only transition. The migration leaves all runtime entrypoints closed.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_observe_direct_outside_runtime_tls_v2() RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $observe$
  SELECT current_user IS NOT DISTINCT FROM session_user
    AND pg_catalog.inet_client_addr() IS NOT NULL
    AND pg_catalog.current_setting('session_replication_role')='origin'
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s
      WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl IS TRUE);
$observe$;
REVOKE ALL ON FUNCTION public.jg_observe_direct_outside_runtime_tls_v2() FROM PUBLIC;

CREATE FUNCTION public.jg_install_direct_outside_runtime_tls_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  before_stage RECORD;
  runtime_role NAME;
  executor_role NAME;
  stage_oid OID:='public.jg_stage_direct_outside_operating_archive_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure;
  observer_oid OID:='public.jg_observe_direct_outside_runtime_tls_v2()'::regprocedure;
  before_guard CONSTANT TEXT:=$old$NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl)$old$;
  after_guard CONSTANT TEXT:=$new$NOT (CASE WHEN EXISTS (
    SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 i
    JOIN pg_catalog.pg_database d ON d.oid=i."databaseOid" AND d.datname=pg_catalog.current_database()
      AND d.datdba=i."anchorOwnerOid"
    JOIN pg_catalog.pg_roles r ON r.oid=i."runtimeSessionOid" AND r.rolname=session_user
      AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    JOIN pg_catalog.pg_roles x ON x.oid=i."executorOwnerOid" AND x.rolname=current_user AND NOT x.rolcanlogin
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.jg_observe_direct_outside_runtime_tls_v2()')
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='sql'
    WHERE i."protocolVersion"=1 AND i."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND p.pronamespace=i."namespaceOid" AND p.proowner=r.oid AND p.prokind='f' AND p.prosecdef
      AND p.provolatile='v' AND p.proparallel='u' AND NOT (p.proisstrict OR p.proretset OR p.proleakproof)
      AND p.pronargs=0 AND p.pronargdefaults=0 AND p.prosupport=0 AND p.prorettype='pg_catalog.bool'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7'
      AND (SELECT count(*)=2 AND count(*) FILTER (WHERE a.grantee=x.oid AND NOT a.is_grantable)=1
        AND count(*) FILTER (WHERE a.grantee=r.oid)=1 AND bool_and(a.grantor=r.oid AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a)
  ) THEN public.jg_observe_direct_outside_runtime_tls_v2() IS TRUE ELSE FALSE END)$new$;
  after_stage TEXT;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND r.rolsuper)
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid() AND s.ssl IS TRUE) THEN
    RAISE EXCEPTION '表外直签连接观察须由当前管理 TLS 会话安装' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,
    public.jg_contract_direct_archive_native_nonce_v1 IN SHARE MODE NOWAIT;
  SELECT i.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 i
  JOIN pg_catalog.pg_database d ON d.oid=i."databaseOid" AND d.datname=pg_catalog.current_database()
    AND d.datdba=i."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')
  WHERE i."protocolVersion"=1 AND i."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT r.rolname,x.rolname INTO STRICT runtime_role,executor_role FROM pg_catalog.pg_roles r
  JOIN pg_catalog.pg_roles x ON x.oid=binding."executorOwnerOid"
  WHERE r.oid=binding."runtimeSessionOid" AND r.rolcanlogin AND NOT x.rolcanlogin
    AND r.oid<>x.oid AND r.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."issuerOwnerOid",binding."issuerSessionOid")
    AND x.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."issuerOwnerOid",binding."issuerSessionOid")
    AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR x.rolsuper OR x.rolcreaterole OR x.rolcreatedb OR x.rolreplication OR x.rolbypassrls)
    AND NOT pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity s WHERE s.usesysid=r.oid);
  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT before_stage FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=stage_oid AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT (p.prosecdef OR p.proretset OR p.proleakproof)
    AND p.prorettype='pg_catalog.text'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='469a0638a339626b8d2ca710c7b541e984063d1915c1267c4b0fba4826b6f555'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
      WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='sql'
      WHERE p.oid=observer_oid AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.prosecdef
        AND NOT (p.proisstrict OR p.proretset OR p.proleakproof) AND p.prosupport=0
        AND p.pronargs=0 AND p.pronargdefaults=0 AND p.prorettype='pg_catalog.bool'::regtype
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7'
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR cardinality(string_to_array(before_stage.prosrc,before_guard))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(stage_oid),before_stage.prosrc))<>2 THEN
    RAISE EXCEPTION '表外直签连接观察安装前态不匹配' USING ERRCODE='55000';
  END IF;
  after_stage:=replace(before_stage.prosrc,before_guard,after_guard);
  IF encode(public.digest(convert_to(after_stage,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '143a343765785198800cf359321d8a9689fdd18e22194cbe8f94fbfa56205fd4' THEN
    RAISE EXCEPTION '表外直签首写连接检查后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE format('ALTER FUNCTION public.jg_observe_direct_outside_runtime_tls_v2() OWNER TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_observe_direct_outside_runtime_tls_v2() TO %I',executor_role);
  EXECUTE replace(pg_catalog.pg_get_functiondef(stage_oid),before_stage.prosrc,after_stage);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=stage_oid AND p.prosrc=after_stage
      AND to_jsonb(p)-'prosrc'=before_stage.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=observer_oid AND p.proowner=binding."runtimeSessionOid"
      AND (SELECT count(*)=2 AND count(*) FILTER (WHERE a.grantee=binding."executorOwnerOid" AND NOT a.is_grantable)=1
        AND count(*) FILTER (WHERE a.grantee=binding."runtimeSessionOid")=1
        AND bool_and(a.grantor=binding."runtimeSessionOid" AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a)) THEN
    RAISE EXCEPTION '表外直签连接观察例程身份或授权后态不匹配' USING ERRCODE='55000';
  END IF;
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_runtime_tls_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
    WHERE p.oid IN ('public.jg_install_direct_outside_runtime_tls_v2()'::regprocedure,
      'public.jg_observe_direct_outside_runtime_tls_v2()'::regprocedure)
    AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签连接观察源码默认必须私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
