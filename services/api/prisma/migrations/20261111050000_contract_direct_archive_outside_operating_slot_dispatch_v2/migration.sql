-- Extend only the two witness calls inside the installed 213 slot trigger.
-- The optional installer runs after 235 and the enabled direct parent splice.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_install_direct_outside_operating_slot_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  upward public.jg_contract_upward_pending_save_binding_v1%ROWTYPE;
  prior RECORD;
  prior_trigger RECORD;
  executor_name TEXT;
  new_body TEXT;
  slot_trigger_oid OID;
  registered_slot JSONB;
  target OID:='public.jg_guard_contract_direct_archive_slot_v1()'::regprocedure;
  handoff OID:='public.jg_require_direct_outside_operating_handoff_v2(text,text)'::regprocedure;
  anchor CONSTANT TEXT:='public.jg_require_contract_direct_archive_transition_profile_v1()';
  branch CONSTANT TEXT:=$branch$(CASE WHEN a."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required' THEN
    public.jg_require_direct_outside_operating_handoff_v2(a."id",v."id")
  ELSE public.jg_require_contract_direct_archive_transition_profile_v1() END)$branch$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 nonce ON nonce."protocolVersion"=1
    AND nonce."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM binding."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '表外直签原件槽只能由当前数据库绑定所有者安装' USING ERRCODE='55000';
  END IF;
  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r
  WHERE r.oid=binding."executorOwnerOid" AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole
    OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.oid NOT IN (binding."anchorOwnerOid",binding."ordinaryApplicationRoleOid",binding."runtimeSessionOid",
      binding."issuerOwnerOid",binding."issuerSessionOid")
    AND NOT has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
      AND (pg_has_role(r.oid,other.oid,'MEMBER') OR (other.oid<>binding."anchorOwnerOid" AND NOT other.rolsuper
        AND pg_has_role(other.oid,r.oid,'MEMBER'))));
  SELECT u.* INTO STRICT upward FROM public.jg_contract_upward_pending_save_binding_v1 u
  JOIN public.jg_contract_upward_pending_create_binding_v1 c ON c."protocolVersion"=1
    AND c."databaseOid"=u."databaseOid" AND c."namespaceOid"=u."namespaceOid" AND c."ownerOid"=u."ownerOid"
    AND c."applicationRoleOid"=u."applicationRoleOid" AND c."versionRoutineOid"=u."versionRoutineOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=u."createBindingSha256"
  WHERE u."protocolVersion"=1 AND u."databaseOid"=binding."databaseOid" AND u."namespaceOid"=binding."namespaceOid"
    AND u."ownerOid"=binding."anchorOwnerOid" AND u."applicationRoleOid"=binding."ordinaryApplicationRoleOid";
  SELECT (d."bindings"#>>'{triggers,ContractDraftAttachment_direct_archive_transfer_v1,oid}')::oid,
    d."bindings"->'helpers'->'public.jg_guard_contract_direct_archive_slot_v1()'
    INTO STRICT slot_trigger_oid,registered_slot FROM public.jg_contract_direct_archive_dispatch_binding_v1 d
  WHERE d."protocolVersion"=1 AND d."databaseOid"=binding."databaseOid" AND d."namespaceOid"=binding."namespaceOid"
    AND d."anchorOwnerOid"=binding."anchorOwnerOid" AND d."applicationRoleOid"=binding."ordinaryApplicationRoleOid"
    AND (d."bindings"->'helpers'->'public.jg_guard_contract_direct_archive_slot_v1()'->>'oid')::oid=target;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
  WHERE p.oid=target AND p.oid=upward."slotRoutineOid" AND p.proowner=binding."anchorOwnerOid"
    AND p.pronamespace=binding."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.prosecdef AND NOT p.proretset AND NOT p.proisstrict AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND p.prorettype='pg_catalog.trigger'::regtype
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_language l WHERE l.oid=p.prolang AND l.lanname='plpgsql')
    AND to_jsonb(p.proacl) IS NOT DISTINCT FROM NULLIF(registered_slot->'proacl','null'::jsonb)
    AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner)
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
      '86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999';
  SELECT t.* INTO STRICT prior_trigger FROM pg_catalog.pg_trigger t
  WHERE t.oid=slot_trigger_oid AND t.tgfoid=target AND t.tgrelid='public."ContractDraftAttachment"'::regclass
    AND t.tgname='ContractDraftAttachment_direct_archive_transfer_v1' AND t.tgtype=31 AND t.tgenabled='O'
    AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgqual IS NULL
    AND t.tgnargs=0 AND t.tgattr::text='';
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid='public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")'::regprocedure
        AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
          'b211330ea1a8e4bad49fb29fa05543c3a4a7028cc6424c48975cdfe010e0ca4b')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=handoff AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=
          '1cb5e286db906047355bdd2248cffb0fc48a308cfd1940bb8b59f92c577b05f6'
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR cardinality(string_to_array(prior.prosrc,anchor))<>3
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(target),prior.prosrc))<>2 THEN
    RAISE EXCEPTION '表外直签原件槽分派的原件与父归档前态不一致' USING ERRCODE='55000';
  END IF;
  new_body:=replace(prior.prosrc,anchor,branch);
  IF encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '99d80f7a4bb9105acda415aa7cedd6dba0266849cb9b945cb5e7b0aaf6885164' THEN
    RAISE EXCEPTION '表外直签原件槽分派的精确后态不一致' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosrc=new_body
      AND to_jsonb(p)-'prosrc'=prior.metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=slot_trigger_oid AND to_jsonb(t)=to_jsonb(prior_trigger)) THEN
    RAISE EXCEPTION '表外直签原件槽分派改变了原触发器或例程身份' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_require_direct_outside_operating_handoff_v2(text,text) TO %I',executor_name);
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_operating_slot_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid='public.jg_install_direct_outside_operating_slot_v2()'::regprocedure
      AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签原件槽分派安装器默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
