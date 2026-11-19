-- Validate the original channel nonce inside the anchor without expanding V1 ACL.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_verify_direct_outside_native_nonce_v2(p_issue BOOLEAN,p_nonce UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $verify_nonce$
BEGIN
  IF pg_catalog.inet_client_addr() IS NULL
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
        AND d.datdba=b."anchorOwnerOid"
      JOIN pg_catalog.pg_roles login ON login.oid=session_user::regrole::oid AND login.rolcanlogin
        AND NOT (login.rolsuper OR login.rolcreaterole OR login.rolcreatedb OR login.rolreplication OR login.rolbypassrls)
      WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
        AND b."anchorOwnerOid"=current_user::regrole::oid
        AND login.oid=CASE WHEN p_issue THEN b."issuerSessionOid" ELSE b."runtimeSessionOid" END) THEN
    RETURN FALSE;
  END IF;

  -- The original function checks the bound nonce, role graph and file callers.
  RETURN COALESCE(public.jg_contract_direct_archive_native_channel_v1()=p_nonce,FALSE);
END;
$verify_nonce$;

CREATE FUNCTION public.jg_install_direct_outside_operating_nonce_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install_nonce$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  target OID:='public.jg_direct_outside_operating_channel_v2(boolean,uuid)'::regprocedure;
  verifier OID:='public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)'::regprocedure;
  v1 OID:='public.jg_contract_direct_archive_native_channel_v1()'::regprocedure;
  role_guard OID:='public.jg_check_contract_direct_archive_intent_roles_v1(boolean)'::regprocedure;
  owners OID[];
  logins OID[];
  issuer_name TEXT;
  executor_name TEXT;
  prior RECORD;
  v1_catalog JSONB;
  next_body TEXT;
  before_call CONSTANT TEXT:=$before_nonce$public.jg_contract_direct_archive_native_channel_v1() IS DISTINCT FROM p_nonce$before_nonce$;
  after_call CONSTANT TEXT:=$after_nonce$public.jg_verify_direct_outside_native_nonce_v2(p_issue,p_nonce) IS DISTINCT FROM TRUE$after_nonce$;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '表外直签 nonce 安装需要当前所有者 TLS 会话' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,public.jg_contract_direct_archive_native_nonce_v1
    IN SHARE MODE NOWAIT;
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid;
  owners:=ARRAY[binding."issuerOwnerOid",binding."executorOwnerOid"];
  logins:=ARRAY[binding."issuerSessionOid",binding."runtimeSessionOid"];
  IF (SELECT count(DISTINCT role_oid) FROM unnest(owners||logins) AS bound(role_oid))<>4
    OR binding."anchorOwnerOid"=ANY(owners||logins) OR binding."ordinaryApplicationRoleOid"=ANY(owners||logins)
    OR 4<>(SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.oid=ANY(owners||logins)
      AND r.rolcanlogin=(r.oid=ANY(logins))
      AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
        AND (pg_catalog.pg_has_role(r.oid,other.oid,'MEMBER') OR (other.oid<>binding."anchorOwnerOid" AND NOT other.rolsuper
          AND pg_catalog.pg_has_role(other.oid,r.oid,'MEMBER'))))) THEN
    RAISE EXCEPTION '表外直签 nonce 安装角色不匹配' USING ERRCODE='55000';
  END IF;
  SELECT r.rolname INTO STRICT issuer_name FROM pg_catalog.pg_roles r WHERE r.oid=binding."issuerOwnerOid";
  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r WHERE r.oid=binding."executorOwnerOid";

  SELECT to_jsonb(p) INTO STRICT v1_catalog FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=v1 AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND p.prosecdef AND NOT p.proretset
    AND p.prorettype='pg_catalog.uuid'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='21d5cf73c09bd4b46d1a953980efde6e18f53430c5c203695856ee15c867ad9a'
    AND (SELECT count(*)=3 AND count(*) FILTER (WHERE a.grantee=ANY(logins) AND NOT a.is_grantable)=2
      AND count(*) FILTER (WHERE a.grantee=p.proowner)=1 AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
      FROM pg_catalog.aclexplode(p.proacl) a)
    AND NOT EXISTS(SELECT 1 FROM unnest(owners) AS owner_id(oid)
      WHERE pg_catalog.has_function_privilege(owner_id.oid,p.oid,'EXECUTE'));

  SELECT p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=target AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
    AND p.prorettype='pg_catalog.text'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='945d5562b121a6418cc319495d96c294d39a820388dcb56ffe605010b245eab2'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE p.oid=verifier AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND p.prosecdef AND NOT p.proretset
      AND p.prorettype='pg_catalog.bool'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='0d58a2b5c5b3be145cfede1e672e3c981afccc5f2f88cc422c60c0c53a76d450'
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=role_guard AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='19afa3783a3a18126af58e7e61633367ec6d745eb602e88cbe36d7c7a790cde9'
        AND pg_catalog.has_function_privilege(owners[1],p.oid,'EXECUTE')
        AND pg_catalog.has_function_privilege(owners[2],p.oid,'EXECUTE'))
    OR cardinality(string_to_array(prior.prosrc,before_call))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(target),prior.prosrc))<>2 THEN
    RAISE EXCEPTION '表外直签 nonce 分派前态不匹配' USING ERRCODE='55000';
  END IF;
  next_body:=replace(prior.prosrc,before_call,after_call);
  IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '33e0fab573b31ef36a8b080300d56e20963740ab2e8d3e305c1dfcaa83e0a569' THEN
    RAISE EXCEPTION '表外直签 nonce 分派后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),prior.prosrc,next_body);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid) TO %I,%I',issuer_name,executor_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosrc=next_body AND to_jsonb(p)-'prosrc'=prior.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v1 AND to_jsonb(p)=v1_catalog)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=verifier
      AND (SELECT count(*)=3 AND count(*) FILTER (WHERE a.grantee=ANY(owners) AND NOT a.is_grantable)=2
        AND count(*) FILTER (WHERE a.grantee=p.proowner)=1 AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(p.proacl) a))
    OR EXISTS(SELECT 1 FROM unnest(logins||ARRAY[binding."ordinaryApplicationRoleOid"]) AS login(oid)
      WHERE pg_catalog.has_function_privilege(login.oid,verifier,'EXECUTE')) THEN
    RAISE EXCEPTION '表外直签 nonce 分派目录或权限后态不匹配' USING ERRCODE='55000';
  END IF;
END;
$install_nonce$;

REVOKE ALL ON FUNCTION public.jg_verify_direct_outside_native_nonce_v2(BOOLEAN,UUID),
  public.jg_install_direct_outside_operating_nonce_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
    pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)'::regprocedure,
      'public.jg_install_direct_outside_operating_nonce_v2()'::regprocedure)
    AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签 nonce 核验和安装默认须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
