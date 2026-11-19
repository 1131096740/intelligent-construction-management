-- Read the existing frozen operating basis without granting either channel table access.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_direct_outside_operating_basis_catalog_v2() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $basis_catalog$
BEGIN
  RETURN 4=(SELECT count(*) FROM (VALUES
    ('public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)',
      '11e79bd551fea5d39db59a739d92cc1db26a7eca0a1653178c362e9b433ee348','jsonb','s',FALSE,TRUE),
    ('public.jg_read_contract_direct_outside_review_scope_v2(text,text,text,integer,text,jsonb,timestamp)',
      'd26a8ac83fd5d378ae790a8104ae34828271e81a5d8814df82cadb032ed21ba4','jsonb','s',FALSE,TRUE),
    ('public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)',
      '0d58a2b5c5b3be145cfede1e672e3c981afccc5f2f88cc422c60c0c53a76d450','bool','v',TRUE,FALSE),
    ('public.jg_direct_outside_operating_channel_v2(boolean,uuid)',
      '33e0fab573b31ef36a8b080300d56e20963740ab2e8d3e305c1dfcaa83e0a569','text','v',FALSE,FALSE)
  ) expected(signature,body_sha,result_type,volatility,is_definer,owner_only)
  JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
    AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=current_user::regrole::oid
    AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype('pg_catalog.'||expected.result_type)
    AND p.prosecdef=expected.is_definer AND p.proisstrict AND NOT p.proretset
    AND p.provolatile::text=expected.volatility AND p.proparallel='u'
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.pronargdefaults=0 AND p.provariadic=0
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE NOT expected.owner_only OR (SELECT count(*)=1
      AND bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE')
    FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a));
END;
$basis_catalog$;

CREATE FUNCTION public.jg_read_direct_outside_operating_basis_v2(
  p_issue BOOLEAN,p_nonce UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,
  p_revision INTEGER,p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $read_basis$
DECLARE
  bridge CONSTANT OID:='public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure;
BEGIN
  -- The original invoker checks the role graph first. Independently bind the
  -- bridge grant and actual login to the same database, nonce and direction.
  IF pg_catalog.inet_client_addr() IS NULL
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR pg_catalog.current_setting('transaction_isolation')<>'read committed'
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_native_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
        AND d.datdba=b."anchorOwnerOid"
      JOIN pg_catalog.pg_proc p ON p.oid=bridge AND p.proowner=b."anchorOwnerOid" AND p.pronamespace=b."namespaceOid"
      JOIN pg_catalog.pg_roles login ON login.oid=session_user::regrole::oid AND login.rolcanlogin
      JOIN pg_catalog.pg_roles internal ON internal.oid=CASE WHEN p_issue THEN b."issuerOwnerOid" ELSE b."executorOwnerOid" END
        AND NOT (internal.rolcanlogin OR internal.rolsuper OR internal.rolcreaterole OR internal.rolcreatedb
          OR internal.rolreplication OR internal.rolbypassrls)
      WHERE b."namespaceOid"=pg_catalog.to_regnamespace('public')
        AND b."anchorOwnerOid"=current_user::regrole::oid AND b."nonce"=p_nonce
        AND login.oid=CASE WHEN p_issue THEN b."issuerSessionOid" ELSE b."runtimeSessionOid" END
        AND pg_catalog.has_function_privilege(internal.oid,p.oid,'EXECUTE')
        AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[b."issuerSessionOid",b."runtimeSessionOid",b."ordinaryApplicationRoleOid"]) AS excluded(role_oid)
          WHERE pg_catalog.has_function_privilege(excluded.role_oid,p.oid,'EXECUTE'))
        AND (SELECT count(*)=3
          AND count(*) FILTER (WHERE a.grantee IN (b."issuerOwnerOid",b."executorOwnerOid") AND NOT a.is_grantable)=2
          AND count(*) FILTER (WHERE a.grantee=p.proowner)=1
          AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
          FROM pg_catalog.aclexplode(p.proacl) a))
    OR public.jg_direct_outside_operating_basis_catalog_v2() IS DISTINCT FROM TRUE
    OR public.jg_verify_direct_outside_native_nonce_v2(p_issue,p_nonce) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '表外直签经营依据读取通道不匹配' USING ERRCODE='42501';
  END IF;

  RETURN public.jg_contract_direct_archive_outside_operating_basis_v2(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
END;
$read_basis$;

CREATE FUNCTION public.jg_install_direct_outside_operating_basis_bridge_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install_basis$
DECLARE
  binding public.jg_contract_direct_archive_native_binding_v1%ROWTYPE;
  bridge CONSTANT OID:='public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure;
  nonce_guard CONSTANT OID:='public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)'::regprocedure;
  owners OID[];
  logins OID[];
  issuer_name NAME;
  executor_name NAME;
  target RECORD;
  prior RECORD;
  next_body TEXT;
  before_call CONSTANT TEXT:=$raw_basis$payload:=public.jg_contract_direct_archive_outside_operating_basis_v2(
    $raw_basis$;
  issue_call CONSTANT TEXT:=$issue_bridge$payload:=public.jg_read_direct_outside_operating_basis_v2(TRUE,p_nonce,
    $issue_bridge$;
  claim_call CONSTANT TEXT:=$claim_bridge$payload:=public.jg_read_direct_outside_operating_basis_v2(FALSE,p_nonce,
    $claim_bridge$;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR pg_catalog.inet_client_addr() IS NULL
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '表外直签经营依据安装需要当前所有者 TLS 会话' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,public.jg_contract_direct_archive_native_nonce_v1
    IN SHARE MODE NOWAIT;
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_native_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    AND d.datdba=b."anchorOwnerOid"
  WHERE b."anchorOwnerOid"=current_user::regrole::oid AND b."namespaceOid"=pg_catalog.to_regnamespace('public');

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
          AND pg_catalog.pg_has_role(other.oid,r.oid,'MEMBER')))))
    OR public.jg_direct_outside_operating_basis_catalog_v2() IS DISTINCT FROM TRUE
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=nonce_guard
      AND (SELECT count(*)=3 AND count(*) FILTER (WHERE a.grantee=ANY(owners) AND NOT a.is_grantable)=2
        AND count(*) FILTER (WHERE a.grantee=p.proowner)=1 AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(p.proacl) a))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=bridge AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND p.prosecdef AND NOT p.proretset
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND p.pronargdefaults=0 AND p.provariadic=0
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='f5a182f71b74730300db10eb75ca9bec98fd9279c51eb267a637748b0158c09a'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE')
          FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION '表外直签经营依据安装角色或前态不匹配' USING ERRCODE='55000';
  END IF;
  SELECT r.rolname INTO STRICT issuer_name FROM pg_catalog.pg_roles r WHERE r.oid=owners[1];
  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r WHERE r.oid=owners[2];

  FOR target IN SELECT * FROM (VALUES
    ('public.jg_issue_contract_direct_outside_operating_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)',
      'aa20f7cefe8f1db6435300e415d2fb05204860e5f52019fab416e4f4b4c563e6',
      '5a8b200ab7dd46ab186421f00c36f064c53cddb45fadad892cca26840a964ba2','uuid',issue_call),
    ('public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
      'd975a30e898859d54c1bea6152242ef233d947d458953d6e38e62df2088ddb9c',
      'a901e768b48f9b8def24c9d4fd99139fcc27f2074fa2caa17472695589a64075','jsonb',claim_call)
  ) expected(signature,before_sha,after_sha,result_type,next_call) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE p.oid=pg_catalog.to_regprocedure(target.signature) AND p.proowner=binding."anchorOwnerOid"
      AND p.pronamespace=binding."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
      AND p.prorettype=pg_catalog.to_regtype('pg_catalog.'||target.result_type)
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.pronargdefaults=0 AND p.provariadic=0
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=target.before_sha
      AND (SELECT count(*)=1 AND bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a);
    next_body:=replace(prior.prosrc,before_call,target.next_call);
    IF cardinality(string_to_array(prior.prosrc,before_call))<>2
      OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2
      OR encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM target.after_sha THEN
      RAISE EXCEPTION '表外直签经营依据分派不匹配' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid
      AND p.prosrc=next_body AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
      RAISE EXCEPTION '表外直签经营依据分派未保留原对象和权限' USING ERRCODE='55000';
    END IF;
  END LOOP;

  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb) TO %I,%I',
    issuer_name,executor_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=bridge
      AND (SELECT count(*)=3 AND count(*) FILTER (WHERE a.grantee=ANY(owners) AND NOT a.is_grantable)=2
        AND count(*) FILTER (WHERE a.grantee=p.proowner)=1 AND bool_and(a.grantor=p.proowner AND a.privilege_type='EXECUTE')
        FROM pg_catalog.aclexplode(p.proacl) a))
    OR EXISTS(SELECT 1 FROM unnest(logins||ARRAY[binding."ordinaryApplicationRoleOid"]) AS excluded(role_oid)
      WHERE pg_catalog.has_function_privilege(excluded.role_oid,bridge,'EXECUTE')) THEN
    RAISE EXCEPTION '表外直签经营依据读取权限后态不匹配' USING ERRCODE='55000';
  END IF;
END;
$install_basis$;

REVOKE ALL ON FUNCTION public.jg_direct_outside_operating_basis_catalog_v2(),
  public.jg_read_direct_outside_operating_basis_v2(BOOLEAN,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_install_direct_outside_operating_basis_bridge_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF 3<>(SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN (
    'public.jg_direct_outside_operating_basis_catalog_v2()'::regprocedure,
    'public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure,
    'public.jg_install_direct_outside_operating_basis_bridge_v2()'::regprocedure)
    AND p.proowner=current_user::regrole::oid
    AND (SELECT count(*)=1 AND bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE')
      FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION '表外直签经营依据读取和安装默认须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
