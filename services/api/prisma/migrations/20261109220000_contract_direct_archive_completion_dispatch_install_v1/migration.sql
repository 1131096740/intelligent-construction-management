BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Atomic source attachment. The unchanged 210 profile remains closed, and
-- the existing 209 direct completion checks remain independently deferred.
LOCK TABLE public."ContractArchiveFile", public."ContractArchiveEvidenceFile" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.jg_contract_direct_archive_completion_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "links" JSONB NOT NULL CHECK (jsonb_typeof("links")='object'),
  "bindings" JSONB NOT NULL CHECK (jsonb_typeof("bindings")='object')
);
REVOKE ALL ON TABLE public.jg_contract_direct_archive_completion_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_completion_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $completion_binding_guard$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION '直签归档完成接线绑定不可改写' USING ERRCODE='23514'; END IF;
  IF current_user::regrole::oid IS DISTINCT FROM NEW."anchorOwnerOid"
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_completion_binding_v1) THEN
    RAISE EXCEPTION '直签归档完成接线绑定只接受可信安装身份' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$completion_binding_guard$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_completion_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_direct_archive_completion_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_completion_binding_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_completion_binding_v1();
CREATE TRIGGER jg_direct_archive_completion_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_completion_binding_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_completion_binding_v1();

DO $completion_dispatch_install$
DECLARE
  retained RECORD; dispatch RECORD; f RECORD; item RECORD; t RECORD;
  database_oid OID; public_oid OID:=pg_catalog.to_regnamespace('public');
  binding_oid OID:='public.jg_contract_direct_archive_completion_binding_v1'::regclass;
  old_completion_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()');
  direct_completion_oid OID:=pg_catalog.to_regprocedure('public.jg_require_contract_direct_archive_complete_v1()');
  app_name TEXT; old_body TEXT; next_body TEXT; old_metadata JSONB; observed JSONB; expected JSONB;
  procedures JSONB; registry_triggers JSONB;
  anchor TEXT:=E'  PERFORM public.jg_assert_contract_archive_v2_manifest(aid);\n';
  splice TEXT:=E'  IF TG_TABLE_SCHEMA=''public'' AND TG_OP=''INSERT''\n    AND TG_TABLE_NAME IN (''ContractArchiveFile'',''ContractArchiveEvidenceFile'')\n    AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" direct_parent WHERE direct_parent."id"=aid\n      AND direct_parent."archiveProtocolVersion"=2 AND direct_parent."archiveSource"=''direct_signed'') THEN\n    PERFORM public.jg_require_contract_direct_archive_transition_profile_v1();\n    IF public.jg_contract_direct_archive_proof_v1(aid) IS NULL THEN\n      RAISE EXCEPTION ''直签归档、原件交接与版本生效必须同事务完整提交'' USING ERRCODE=''23514'';\n    END IF;\n    RETURN NEW;\n  END IF;\n';
BEGIN
  SELECT oid INTO STRICT database_oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT r.*,r.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS sha
  INTO STRICT retained FROM public.jg_contract_direct_archive_retention_binding_v1 r WHERE r."protocolVersion"=1;
  SELECT d.*,d.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex') AS sha
  INTO STRICT dispatch FROM public.jg_contract_direct_archive_dispatch_binding_v1 d WHERE d."protocolVersion"=1;
  IF current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR current_user::regrole::oid IS DISTINCT FROM retained."anchorOwnerOid"
    OR dispatch."anchorOwnerOid" IS DISTINCT FROM retained."anchorOwnerOid" OR dispatch."namespaceOid" IS DISTINCT FROM public_oid
    OR dispatch."databaseOid" IS DISTINCT FROM database_oid OR retained."databaseOid" IS DISTINCT FROM database_oid
    OR dispatch."applicationRoleOid" IS DISTINCT FROM retained."applicationRoleOid"
    OR retained."recipeVersion" IS DISTINCT FROM 'contract-direct-archive-retention-v1/1'
    OR dispatch."recipeVersion" IS DISTINCT FROM 'contract-direct-archive-dispatch-v1/1'
    OR dispatch."links"->>'retentionOid' IS DISTINCT FROM retained.relation_oid::text
    OR dispatch."links"->>'retentionSha' IS DISTINCT FROM retained.sha
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=retained.relation_oid AND c.relowner=retained."anchorOwnerOid" AND c.relnamespace=public_oid)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=dispatch.relation_oid AND c.relowner=retained."anchorOwnerOid" AND c.relnamespace=public_oid) THEN
    RAISE EXCEPTION '直签归档完成接线缺少可信保留前态';
  END IF;
  SELECT r.rolname INTO STRICT app_name FROM pg_catalog.pg_roles r WHERE r.oid=retained."applicationRoleOid"
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls;
  IF pg_catalog.pg_has_role(retained."applicationRoleOid",retained."anchorOwnerOid",'MEMBER')
    OR pg_catalog.has_schema_privilege(retained."applicationRoleOid",public_oid,'CREATE')
    OR pg_catalog.has_schema_privilege(retained."applicationRoleOid",public_oid,'USAGE') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '直签归档完成接线应用身份不正确';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('public.jg_assert_contract_direct_archive_write_profile_v1()', 'aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616'),
    ('public.jg_require_contract_direct_archive_transition_profile_v1()', '45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b')
  ) helpers(signature,sha) LOOP
    SELECT p.*,l.lanname,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=pg_catalog.to_regprocedure(item.signature);
    IF encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM item.sha
      OR f.proowner IS DISTINCT FROM retained."anchorOwnerOid" OR f.pronamespace IS DISTINCT FROM public_oid
      OR f.prokind<>'f' OR f.prosecdef OR f.proretset OR f.proisstrict OR f.provolatile<>'v' OR f.proparallel<>'u'
      OR f.lanname<>'plpgsql' OR f.prorettype IS DISTINCT FROM 'pg_catalog.jsonb'::regtype::oid
      OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl
        WHERE acl.grantee<>f.proowner OR acl.grantor<>f.proowner)
      OR pg_catalog.has_function_privilege(retained."applicationRoleOid",f.oid,'EXECUTE') IS DISTINCT FROM FALSE
      OR (f.metadata||jsonb_build_object('oid',f.oid::text,'proowner',f.proowner::text,
        'pronamespace',f.pronamespace::text,'prorettype',f.prorettype::text,'language',f.lanname,'bodySha256',item.sha))
        IS DISTINCT FROM dispatch."bindings"->'helpers'->item.signature THEN
      RAISE EXCEPTION '直签归档完成接线写入资格未保持关闭';
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM (VALUES
    (old_completion_oid,'jg_contract_archive_v2_complete_guard','4f6b00903b08ac6c1b42bb0feea706271c34a4d2c1f27d9669f8da7b9420a329'),
    (direct_completion_oid,'jg_require_contract_direct_archive_complete_v1','326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5'),
    (pg_catalog.to_regprocedure('public.jg_contract_direct_archive_proof_v1(pg_catalog.text)')::oid,
      'jg_contract_direct_archive_proof_v1','4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f')
  ) routines(oid,name,sha) LOOP
    SELECT p.*,l.lanname,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=item.oid;
    observed:=jsonb_build_object('oid',f.oid::text,'owner',f.proowner::text,'namespace',f.pronamespace::text,
      'sha',encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex'),
      'language',f.lanname,'returnType',f.prorettype::text,'volatility',f.provolatile,'parallel',f.proparallel,
      'securityDefiner',f.prosecdef,'strict',f.proisstrict,'returnsSet',f.proretset,'configuration',f.proconfig,'acl',f.proacl,
      'noPublicExecute',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl WHERE acl.grantee=0));
    IF observed IS DISTINCT FROM retained."bindings"->'routines'->item.name OR observed->>'sha' IS DISTINCT FROM item.sha
      OR f.prokind<>'f' OR f.prosecdef OR f.proretset OR f.pronamespace IS DISTINCT FROM public_oid
      OR observed->'noPublicExecute' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION '原归档完成与保留例程已变化';
    END IF;
    IF item.oid=old_completion_oid THEN
      IF f.prorettype IS DISTINCT FROM 'pg_catalog.trigger'::regtype::oid OR f.lanname<>'plpgsql'
        OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict
        OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
        OR NOT pg_catalog.pg_has_role(current_user::regrole::oid,f.proowner,'MEMBER') THEN
        RAISE EXCEPTION '旧归档完成守卫身份不正确';
      END IF;
      old_body:=f.prosrc;
      old_metadata:=f.metadata;
    END IF;
  END LOOP;

  IF 4<>(SELECT count(*) FROM pg_catalog.pg_trigger completion_trigger WHERE completion_trigger.tgfoid IN (old_completion_oid,direct_completion_oid)) THEN
    RAISE EXCEPTION '原归档完成延迟触发器库存不正确';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"'::regclass::oid,old_completion_oid),
    ('ContractArchiveEvidenceFile_v2_complete','public."ContractArchiveEvidenceFile"'::regclass::oid,old_completion_oid),
    ('ContractArchiveFile_direct_complete_v1','public."ContractArchiveFile"'::regclass::oid,direct_completion_oid),
    ('ContractArchiveEvidenceFile_direct_complete_v1','public."ContractArchiveEvidenceFile"'::regclass::oid,direct_completion_oid)
  ) triggers(name,relation_oid,routine_oid) LOOP
    SELECT trigger_row.* INTO STRICT t FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgname=item.name AND trigger_row.tgrelid=item.relation_oid;
    expected:=retained."bindings"->'triggers'->item.name;
    IF t.tgfoid IS DISTINCT FROM item.routine_oid OR t.tgtype<>5 OR t.tgenabled<>'O'
      OR NOT t.tgdeferrable OR NOT t.tginitdeferred OR t.tgisinternal OR t.tgqual IS NOT NULL
      OR t.tgnargs<>0 OR t.tgattr::text<>'' OR encode(t.tgargs,'hex')<>'' OR t.tgconstraint=0
      OR jsonb_build_object('oid',t.oid::text,'relation',t.tgrelid::text,'routine',t.tgfoid::text,'type',t.tgtype,
        'enabled',t.tgenabled,'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
        'condition',false,'internal',t.tgisinternal,'args','','columns','[]'::jsonb) IS DISTINCT FROM expected THEN
      RAISE EXCEPTION '原归档完成延迟触发器已变化';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."ContractArchiveFile"'::regclass,'public."ContractArchiveEvidenceFile"'::regclass)
      AND (c.relkind<>'r' OR c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION '归档父记录的来源判断不能被过滤';
  END IF;

  IF (length(old_body)-length(replace(old_body,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION '旧归档完成守卫的接线位置已变化';
  END IF;
  next_body:=replace(old_body,anchor,splice||anchor);
  IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    'e70210dc13f30a299a555b39ef19da04862895c9317ae1db3e917b7f156c1b72' THEN
    RAISE EXCEPTION '直签归档完成接线后态与固定源码不一致';
  END IF;

  EXECUTE replace(pg_catalog.pg_get_functiondef(old_completion_oid),old_body,next_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=old_completion_oid
    AND p.prosrc=next_body AND to_jsonb(p)-'prosrc'=old_metadata) THEN
    RAISE EXCEPTION '归档完成接线破坏原例程身份或权限';
  END IF;

  SELECT jsonb_object_agg(selected.key,(to_jsonb(p)-'prosrc')||jsonb_build_object(
    'oid',p.oid::text,'sha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')))
  INTO procedures FROM (VALUES
    ('completion',old_completion_oid),
    ('manifest',pg_catalog.to_regprocedure('public.jg_assert_contract_archive_v2_manifest(pg_catalog.text)')::oid),
    ('registry',pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_completion_binding_v1()')::oid)
  ) selected(key,oid) JOIN pg_catalog.pg_proc p ON p.oid=selected.oid;
  IF procedures->'manifest'->>'sha256' IS DISTINCT FROM '5a0a5558b214ef0b5ca051ce93300772ef66efdc4ef43840add57c63bb0ffebf'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=(procedures->'manifest'->>'oid')::oid AND p.pronamespace=public_oid AND p.prokind='f'
        AND p.prorettype='pg_catalog.void'::regtype::oid AND l.lanname='plpgsql'
        AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']
        AND NOT pg_catalog.pg_has_role(retained."applicationRoleOid",p.proowner,'MEMBER')
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl WHERE acl.grantee=0)) THEN
    RAISE EXCEPTION '原生成审批归档清单权威已变化';
  END IF;

  SELECT jsonb_object_agg(registry_trigger.tgname,registry_trigger.oid::text) INTO registry_triggers FROM pg_catalog.pg_trigger registry_trigger
  WHERE registry_trigger.tgrelid=binding_oid;
  IF registry_triggers IS NULL OR 2<>(SELECT count(*) FROM jsonb_object_keys(registry_triggers))
    OR procedures->'registry'->>'sha256' IS DISTINCT FROM 'd4be6bb841d6459e13537724ac423592f8db8ebd53df51a62a0e51a9fcfdd1a5'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=(procedures->'registry'->>'oid')::oid
      AND p.proowner=retained."anchorOwnerOid" AND p.pronamespace=public_oid
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        WHERE acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '归档完成接线技术绑定身份不正确';
  END IF;

  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_direct_archive_completion_binding_v1 TO %I',app_name);
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
    WHERE c.oid=binding_oid AND acl.grantee<>c.relowner AND
      (acl.grantee<>retained."applicationRoleOid" OR acl.privilege_type<>'SELECT' OR acl.is_grantable)) THEN
    RAISE EXCEPTION '归档完成接线技术绑定存在未经认可的授权';
  END IF;
  INSERT INTO public.jg_contract_direct_archive_completion_binding_v1
    ("protocolVersion","recipeVersion","applicationRoleOid","databaseOid","namespaceOid","anchorOwnerOid","links","bindings")
  VALUES(1,'contract-direct-archive-completion-dispatch-v1/1',retained."applicationRoleOid",database_oid,public_oid,retained."anchorOwnerOid",
    jsonb_build_object('retentionOid',retained.relation_oid::text,'retentionSha',retained.sha,'dispatchOid',dispatch.relation_oid::text,'dispatchSha',dispatch.sha),
    jsonb_build_object('procedures',procedures,'registryTriggers',registry_triggers));
END;
$completion_dispatch_install$;

COMMIT;
