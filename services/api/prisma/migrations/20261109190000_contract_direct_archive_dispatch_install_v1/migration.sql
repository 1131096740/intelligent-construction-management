BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Attach the exact direct-only dispatch and retain the closed 210 profile and
-- original 204 completion guard. This installation cannot activate writes.
CREATE TABLE public.jg_contract_direct_archive_dispatch_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion"='contract-direct-archive-dispatch-v1/1'),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "links" JSONB NOT NULL CHECK (jsonb_typeof("links")='object'),
  "bindings" JSONB NOT NULL CHECK (jsonb_typeof("bindings")='object')
);
REVOKE ALL ON TABLE public.jg_contract_direct_archive_dispatch_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_dispatch_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $dispatch_binding_guard$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION '直签归档接线绑定不可改写' USING ERRCODE='23514'; END IF;
  IF current_user::regrole::oid IS DISTINCT FROM NEW."anchorOwnerOid"
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_dispatch_binding_v1) THEN
    RAISE EXCEPTION '直签归档接线绑定仅接受可信安装身份' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$dispatch_binding_guard$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_dispatch_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_direct_archive_dispatch_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_dispatch_binding_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_dispatch_binding_v1();
CREATE TRIGGER jg_direct_archive_dispatch_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_dispatch_binding_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_dispatch_binding_v1();

DO $dispatch_install$
DECLARE
  pending RECORD; prepared RECORD; retained RECORD; item RECORD; f RECORD; existing_trigger RECORD;
  old_body TEXT; new_body TEXT; old_metadata JSONB; actual_routine JSONB; legacy JSONB;
  database_oid OID; public_oid OID; app_name TEXT; target_oid OID; actual_sha TEXT;
  post_routines JSONB:='{}'::jsonb; helper_routines JSONB:='{}'::jsonb; post_triggers JSONB; links JSONB;
  slot_oid OID:=pg_catalog.to_regclass('public."ContractDraftAttachment"');
  binding_oid OID:=pg_catalog.to_regclass('public.jg_contract_direct_archive_dispatch_binding_v1');
BEGIN
  SELECT oid INTO STRICT database_oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  public_oid:=pg_catalog.to_regnamespace('public');
  SELECT p.*,p.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT pending FROM public.jg_contract_direct_pending_binding_v1 p WHERE p."protocolVersion"=1;
  SELECT p.*,p.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT prepared FROM public.jg_contract_direct_archive_binding_v1 p WHERE p."protocolVersion"=1;
  SELECT r.*,r.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT retained FROM public.jg_contract_direct_archive_retention_binding_v1 r WHERE r."protocolVersion"=1;
  IF pending."recipeVersion" IS DISTINCT FROM 'contract-direct-pending-input-v1/1'
    OR prepared."recipeVersion" IS DISTINCT FROM 'contract-direct-archive-preparation-v1/1'
    OR retained."recipeVersion" IS DISTINCT FROM 'contract-direct-archive-retention-v1/1'
    OR current_user::regrole::oid IS DISTINCT FROM pending."anchorOwnerOid"
    OR pending."anchorNamespaceOid" IS DISTINCT FROM public_oid OR prepared."anchorNamespaceOid" IS DISTINCT FROM public_oid
    OR pending."databaseOid" IS DISTINCT FROM database_oid OR prepared."databaseOid" IS DISTINCT FROM database_oid
    OR retained."databaseOid" IS DISTINCT FROM database_oid
    OR prepared."anchorOwnerOid" IS DISTINCT FROM pending."anchorOwnerOid" OR retained."anchorOwnerOid" IS DISTINCT FROM pending."anchorOwnerOid"
    OR prepared."applicationRoleOid" IS DISTINCT FROM pending."applicationRoleOid"
    OR retained."applicationRoleOid" IS DISTINCT FROM pending."applicationRoleOid"
    OR prepared."pendingRelationOid" IS DISTINCT FROM pending.relation_oid OR prepared."pendingSha256" IS DISTINCT FROM pending.sha
    OR retained."preparationRelationOid" IS DISTINCT FROM prepared.relation_oid OR retained."preparationSha256" IS DISTINCT FROM prepared.sha THEN
    RAISE EXCEPTION '直签归档接线缺少完整可信前态';
  END IF;
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles r WHERE r.oid=pending."applicationRoleOid"
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls;
  IF pg_catalog.pg_has_role(pending."applicationRoleOid",pending."anchorOwnerOid",'MEMBER')
    OR pg_catalog.has_schema_privilege(pending."applicationRoleOid",public_oid,'CREATE')
    OR NOT pg_catalog.has_schema_privilege(pending."applicationRoleOid",public_oid,'USAGE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=slot_oid AND t.tgname='ContractDraftAttachment_direct_archive_transfer_v1') THEN
    RAISE EXCEPTION '直签归档接线应用身份或专用槽前态不正确';
  END IF;

  -- Verify all callable detached targets, including the intentionally closed
  -- 210 profile, before touching either original dispatcher.
  FOR item IN SELECT * FROM (VALUES
    ('public.jg_assert_contract_direct_archive_write_profile_v1()', 'aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616', false,'pg_catalog.jsonb'),
    ('public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")', '8fa9e8b88c4a9334658b05f8f0bf0e9b370df1ed0eceb3887d72c35dd95c802d', true,'public."ContractArchiveFile"'),
    ('public.jg_require_contract_direct_archive_transition_profile_v1()', '45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b', false,'pg_catalog.jsonb'),
    ('public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")', 'c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157', true,'public."ContractVersion"'),
    ('public.jg_guard_contract_direct_archive_slot_v1()', 'cc7b0b876f7f396ed11d3b6f583af25c106b2ef967244648a93c730233efdf8b', false,'pg_catalog.trigger'),
    ('public.jg_guard_contract_direct_archive_dispatch_binding_v1()', '40831a77884f198d09985af3317cf396c706e21161e45e5fb2e042ebe776e8e8', false,'pg_catalog.trigger')
  ) targets(signature,body_sha,expected_strict,result_type) LOOP
    SELECT proc.*,l.lanname,to_jsonb(proc)-'prosrc' AS metadata INTO STRICT f
    FROM pg_catalog.pg_proc proc JOIN pg_catalog.pg_language l ON l.oid=proc.prolang
    WHERE proc.oid=pg_catalog.to_regprocedure(item.signature);
    actual_sha:=encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex');
    IF actual_sha IS DISTINCT FROM item.body_sha OR f.pronamespace IS DISTINCT FROM public_oid
      OR f.prorettype IS DISTINCT FROM pg_catalog.to_regtype(item.result_type)
      OR f.proowner IS DISTINCT FROM pending."anchorOwnerOid" OR f.prokind<>'f' OR f.prosecdef OR f.proretset
      OR f.proisstrict IS DISTINCT FROM item.expected_strict OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.lanname<>'plpgsql'
      OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR pg_catalog.has_function_privilege(f.proowner,f.oid,'EXECUTE') IS DISTINCT FROM TRUE
      OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl
        WHERE acl.grantee<>f.proowner OR acl.grantor<>f.proowner) THEN
      RAISE EXCEPTION '直签归档接线目标不符合精确源码或角色资格';
    END IF;
    helper_routines:=helper_routines||jsonb_build_object(item.signature,f.metadata||jsonb_build_object(
      'oid',f.oid::text,'proowner',f.proowner::text,'pronamespace',f.pronamespace::text,'prorettype',f.prorettype::text,
      'language',f.lanname,'bodySha256',actual_sha));
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc proc
    WHERE proc.oid=pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()')
    AND encode(public.digest(convert_to(proc.prosrc,'UTF8'),'sha256'),'hex')='4f6b00903b08ac6c1b42bb0feea706271c34a4d2c1f27d9669f8da7b9420a329'
    AND proc.oid::text=retained."bindings"#>>'{routines,jg_contract_archive_v2_complete_guard,oid}') THEN
    RAISE EXCEPTION '直签归档接线原完成守卫已漂移';
  END IF;

  -- Exact old source and complete runtime identity must match the trusted
  -- 205 record. The body splice preserves all non-body catalog attributes.
  FOR item IN SELECT * FROM (VALUES
    ('public.jg_contract_archive_v2_parent_guard()', 'cf2ec4a4f164edf43024c0569e24cd6cd67b191620c6dc6034923d84bc4948b4',
      'f9de843279039250da6f56cc481d8d1f80e247431c7060aa637821a7bae7eff8', 'public."ContractArchiveFile"', 'ContractArchiveFile_v2_immutable',31,
      E'  -- The model can express direct_signed; its authority is not enabled in Face A.\n',
      E'  IF NEW."archiveSource" IS NOT DISTINCT FROM ''direct_signed'' THEN\n    RETURN public.jg_guard_contract_direct_archive_parent_v1(NEW::public."ContractArchiveFile");\n  END IF;\n'),
    ('public.jg_contract_direct_pending_version_guard_v1()', '5226ea72ac28bf9af8f7e8a5acff4eb97d0f4aacd8d879fe1c08d3c9cc20b400',
      '82b74ba31f58fbec7e9365966e5551f67169ec8a8a70b26f6c96f7f3a01e550e', 'public."ContractVersion"', 'jg_direct_pending_version_shape',23,
      E'  d := NEW."draftData" -> ''directSigningInput'';\n',
      E'  IF TG_OP = ''UPDATE'' THEN\n    IF OLD."draftData" ? ''directSigningInput'' AND (OLD."status" = ''effective'' OR NEW."status" = ''effective'') THEN\n      RETURN public.jg_guard_contract_direct_archive_version_transition_v1(OLD::public."ContractVersion", NEW::public."ContractVersion");\n    END IF;\n  END IF;\n')
  ) dispatch(signature,old_sha,new_sha,relation,trigger_name,trigger_type,anchor,splice) LOOP
    target_oid:=pg_catalog.to_regprocedure(item.signature);
    SELECT proc.*,l.lanname,rt.typname,to_jsonb(proc)-'prosrc' AS metadata INTO STRICT f
    FROM pg_catalog.pg_proc proc JOIN pg_catalog.pg_language l ON l.oid=proc.prolang
    JOIN pg_catalog.pg_type rt ON rt.oid=proc.prorettype WHERE proc.oid=target_oid;
    old_body:=f.prosrc;
    old_metadata:=f.metadata;
    actual_sha:=encode(public.digest(convert_to(old_body,'UTF8'),'sha256'),'hex');
    legacy:=pending."bindings"->'routines'->item.signature;
    actual_routine:=jsonb_build_object('oid',f.oid::text,'namespaceOid',f.pronamespace::text,'ownerOid',f.proowner::text,
      'bodySha256',actual_sha,'securityDefiner',f.prosecdef,'configuration',f.proconfig,'acl',f.proacl,'language',f.lanname,
      'returnType',f.typname,'volatility',f.provolatile,'parallel',f.proparallel,'strict',f.proisstrict,'returnsSet',f.proretset);
    IF actual_routine IS DISTINCT FROM legacy OR actual_sha IS DISTINCT FROM item.old_sha
      OR f.pronamespace IS DISTINCT FROM public_oid OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
      OR NOT pg_catalog.pg_has_role(current_user::regrole::oid,f.proowner,'MEMBER')
      OR (length(old_body)-length(replace(old_body,item.anchor,'')))/length(item.anchor)<>1 THEN
      RAISE EXCEPTION '直签归档原分派源码或身份已漂移';
    END IF;
    SELECT t.* INTO STRICT existing_trigger FROM pg_catalog.pg_trigger t WHERE t.tgfoid=target_oid;
    IF existing_trigger.tgrelid IS DISTINCT FROM pg_catalog.to_regclass(item.relation)
      OR existing_trigger.tgname IS DISTINCT FROM item.trigger_name OR existing_trigger.tgtype IS DISTINCT FROM item.trigger_type
      OR existing_trigger.tgenabled<>'O' OR existing_trigger.tgisinternal OR existing_trigger.tgdeferrable OR existing_trigger.tginitdeferred
      OR existing_trigger.tgnargs<>0 OR existing_trigger.tgattr::text<>'' OR existing_trigger.tgqual IS NOT NULL THEN
      RAISE EXCEPTION '直签归档原触发器接线已漂移';
    END IF;
    IF item.trigger_name='jg_direct_pending_version_shape' AND
      pending."bindings"#>>'{triggers,jg_direct_pending_version_shape,oid}' IS DISTINCT FROM existing_trigger.oid::text THEN
      RAISE EXCEPTION '待登记原版本触发器身份已漂移';
    END IF;
    new_body:=replace(old_body,item.anchor,item.splice||item.anchor);
    IF encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM item.new_sha THEN
      RAISE EXCEPTION '直签归档后态源码与固定预期不一致';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(target_oid),old_body,new_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc proc WHERE proc.oid=target_oid
      AND proc.prosrc=new_body AND to_jsonb(proc)-'prosrc'=old_metadata) THEN
      RAISE EXCEPTION '直签归档后态破坏既有例程身份或授权';
    END IF;
    post_routines:=post_routines||jsonb_build_object(item.signature,legacy||jsonb_build_object('bodySha256',item.new_sha));
  END LOOP;

  -- Every role that can touch the existing slot must be able to take the
  -- new guard's non-direct early return. Missing privileges abort installation.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class r
    WHERE r.oid IN ('public."Contract"'::regclass,'public."ContractVersion"'::regclass,
      'public."ContractArchiveFile"'::regclass,slot_oid)
      AND (r.relkind<>'r' OR r.relrowsecurity OR r.relforcerowsecurity)) THEN
    RAISE EXCEPTION '直签归档接线依赖的原表读取不能被过滤';
  END IF;
  -- PG16 assigns implicit DML to the built-in writer even in an isolated
  -- database. Exclude its own privilege row only while no caller can assume
  -- it or invoke a SECURITY DEFINER routine owned by it.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=6182 AND r.rolname='pg_write_all_data'
      AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=6182 OR m.member=6182)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner=6182 AND p.prosecdef) THEN
    RAISE EXCEPTION '内置附件写角色的隔离资格已漂移' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles slot_caller
    WHERE slot_caller.oid<>6182
      AND (pg_catalog.has_table_privilege(slot_caller.oid,slot_oid,'INSERT,UPDATE,DELETE')
      OR pg_catalog.has_any_column_privilege(slot_caller.oid,slot_oid,'INSERT,UPDATE'))
      AND EXISTS (SELECT 1 FROM unnest(ARRAY['id','contractId','draftData']) AS fields(name)
        WHERE pg_catalog.has_column_privilege(slot_caller.oid,'public."ContractVersion"'::regclass,fields.name,'SELECT') IS DISTINCT FROM TRUE)) THEN
    RAISE EXCEPTION '旧附件调用者缺少准确的版本来源读取资格';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
      ('public."Contract"','id'),('public."Contract"','ownerUserId'),('public."Contract"','voidedAt'),
      ('public."ContractVersion"','id'),('public."ContractVersion"','contractId'),('public."ContractVersion"','status'),
      ('public."ContractVersion"','numericProtocolVersion'),('public."ContractVersion"','versionNo'),
      ('public."ContractVersion"','changeType'),('public."ContractVersion"','draftRevision'),('public."ContractVersion"','draftData'),
      ('public."ContractVersion"','effectiveAt'),('public."ContractVersion"','firstSubmittedAt'),('public."ContractVersion"','endedAt'),
      ('public."ContractArchiveFile"','id'),('public."ContractArchiveFile"','contractVersionId'),
      ('public."ContractArchiveFile"','archiveProtocolVersion'),('public."ContractArchiveFile"','archiveSource'),
      ('public."ContractArchiveFile"','status'),('public."ContractArchiveFile"','sourceRevision'),
      ('public."ContractArchiveFile"','uploadedByUserId'),('public."ContractArchiveFile"','confirmedByUserId'),
      ('public."ContractArchiveFile"','authoritySnapshot'),('public."ContractArchiveFile"','authoritySha256'),('public."ContractArchiveFile"','fileManifestSha256')
    ) fields(table_name,column_name)
    WHERE pg_catalog.has_column_privilege(pending."applicationRoleOid",pg_catalog.to_regclass(fields.table_name),fields.column_name,'SELECT') IS DISTINCT FROM TRUE)
    OR NOT pg_catalog.has_any_column_privilege(pending."applicationRoleOid",'public."Contract"'::regclass,'UPDATE')
    OR NOT pg_catalog.has_any_column_privilege(pending."applicationRoleOid",'public."ContractVersion"'::regclass,'UPDATE') THEN
    RAISE EXCEPTION '现有合同应用角色缺少专用槽兼容读取或行锁资格';
  END IF;

  CREATE TRIGGER "ContractDraftAttachment_direct_archive_transfer_v1"
  BEFORE INSERT OR UPDATE OR DELETE ON public."ContractDraftAttachment"
  FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_slot_v1();

  SELECT jsonb_object_agg(t.tgname,to_jsonb(t)||jsonb_build_object(
    'oid',t.oid::text,'tgrelid',t.tgrelid::text,'tgfoid',t.tgfoid::text,'tgattr',t.tgattr::text,'tgargs',encode(t.tgargs,'hex'))) INTO post_triggers FROM pg_catalog.pg_trigger t
  WHERE (t.tgrelid,t.tgname) IN (
    ('public."ContractArchiveFile"'::regclass,'ContractArchiveFile_v2_immutable'),
    ('public."ContractVersion"'::regclass,'jg_direct_pending_version_shape'),
    (slot_oid,'ContractDraftAttachment_direct_archive_transfer_v1'),
    (binding_oid,'jg_direct_archive_dispatch_binding_immutable'),
    (binding_oid,'jg_direct_archive_dispatch_binding_no_truncate'));
  IF (SELECT count(*) FROM jsonb_object_keys(post_triggers))<>5 THEN RAISE EXCEPTION '直签归档接线后态不完整'; END IF;
  links:=jsonb_build_object('pendingOid',pending.relation_oid::text,'pendingSha',pending.sha,
    'prepareOid',prepared.relation_oid::text,'prepareSha',prepared.sha,'retentionOid',retained.relation_oid::text,'retentionSha',retained.sha);

  -- Only the already bound application can read the new technical metadata.
  -- No DML, grant option or helper EXECUTE is supplied.
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_direct_archive_dispatch_binding_v1 TO %I',app_name);
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class r CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) acl
    WHERE r.oid=binding_oid AND acl.grantee<>r.relowner
      AND (acl.grantee<>pending."applicationRoleOid" OR acl.privilege_type<>'SELECT' OR acl.is_grantable)) THEN
    RAISE EXCEPTION '直签归档技术绑定存在未经认可的授权';
  END IF;
  INSERT INTO public.jg_contract_direct_archive_dispatch_binding_v1("protocolVersion","recipeVersion","applicationRoleOid","databaseOid",
    "namespaceOid","anchorOwnerOid","links","bindings")
  VALUES(1,'contract-direct-archive-dispatch-v1/1',pending."applicationRoleOid",database_oid,public_oid,pending."anchorOwnerOid",
    links,jsonb_build_object('routines',post_routines,'helpers',helper_routines,'triggers',post_triggers));
END;
$dispatch_install$;

COMMIT;
