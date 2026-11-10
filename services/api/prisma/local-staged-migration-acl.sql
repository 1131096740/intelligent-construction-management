-- Local owned-container fixture only. This file is never a product migration.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $scope$
DECLARE p jsonb := __PLAN__::jsonb; expected jsonb; actual jsonb;
BEGIN
  IF current_user <> 'jiangkong' OR session_user <> current_user
    OR (SELECT oid::text FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM p->>'databaseOid'
    OR current_database() IS DISTINCT FROM p->>'database'
    OR (SELECT datdba::text FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM p->>'actorOid'
    OR current_user::regrole::oid::text IS DISTINCT FROM p->>'actorOid'
    OR to_regnamespace('public')::oid::text IS DISTINCT FROM p->>'namespaceOid'
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM p->>'systemIdentifier'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR getdatabaseencoding()<>'UTF8' OR current_setting('session_replication_role')<>'origin'
    OR EXISTS(SELECT FROM pg_event_trigger)
    OR EXISTS(SELECT FROM pg_roles WHERE rolname=p->>'appName')
    OR to_regnamespace(p->>'schemaName') IS NOT NULL
  THEN RAISE EXCEPTION 'local fixture setup identity rejected'; END IF;
  SELECT jsonb_agg(jsonb_build_object('name',x->>'name','sha256',x->>'sha256') ORDER BY x->>'name')
    INTO expected FROM jsonb_array_elements(p->'migrations') WITH ORDINALITY e(x,n) WHERE n<=203;
  SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum) ORDER BY migration_name)
    INTO actual FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF actual IS DISTINCT FROM expected OR EXISTS(SELECT FROM public._prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL)
  THEN RAISE EXCEPTION 'local fixture exact203 ledger rejected'; END IF;
END $scope$;
CREATE ROLE __APP__ LOGIN PASSWORD NULL CONNECTION LIMIT 0 NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA __SCHEMA__ AUTHORIZATION jiangkong;
REVOKE ALL ON SCHEMA __SCHEMA__ FROM PUBLIC;
CREATE TABLE __SCHEMA__.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), plan jsonb NOT NULL,
  actor_oid oid NOT NULL, installer_oid oid NOT NULL, namespace_oid oid NOT NULL,
  application_oid oid NOT NULL, file_caller_setting text NOT NULL DEFAULT '[]',
  archive_oid oid NOT NULL, version_oid oid NOT NULL, anchor_oid oid NOT NULL,
  role_binding jsonb, object_binding jsonb, file_trigger_binding jsonb NOT NULL, file_routine_binding jsonb
);
CREATE TABLE __SCHEMA__.events (
  ordinal integer PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 4), payload jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA __SCHEMA__ FROM PUBLIC;
INSERT INTO __SCHEMA__.control(plan,actor_oid,installer_oid,namespace_oid,application_oid,
 archive_oid,version_oid,anchor_oid,file_trigger_binding) VALUES (__PLAN__::jsonb,
 current_user::regrole::oid,current_user::regrole::oid,to_regnamespace('public'),'__APP__'::regrole,
 'public."ContractArchiveFile"'::regclass,'public."ContractVersion"'::regclass,
 'public."protectProjectParticipatingCompanyEndDate"()'::regprocedure,
 (SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'relation',tgrelid::text,'function',tgfoid::text,
  'type',tgtype,'columns',tgattr::text,'enabled',tgenabled,'qual',tgqual::text,'args',encode(tgargs,'hex')) ORDER BY oid)
 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A') AND tgfoid IN (
  'public.jg_enforce_exclusive_file_business_binding()'::regprocedure,
  'public.jg_enforce_file_replacement_exclusive_binding()'::regprocedure)));

CREATE FUNCTION __SCHEMA__.role_catalog() RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,pg_temp AS $roles$
 SELECT jsonb_build_object('roles',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',rolname,
  'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,
  'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls,'limit',rolconnlimit)
  ORDER BY oid) FROM pg_roles),'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'member',member::text,'role',roleid::text,'grantor',grantor::text,'admin',admin_option,
  'inherit',inherit_option,'set',set_option) ORDER BY member,roleid,grantor),'[]'::jsonb) FROM pg_auth_members))
$roles$;
REVOKE ALL ON FUNCTION __SCHEMA__.role_catalog() FROM PUBLIC;

-- Reachability follows actual LOGIN/definer roots and SET-membership edges.
-- Preserve explicit old routine callers as well as conservatively reachable invokers.
CREATE FUNCTION __SCHEMA__.file_callers() RETURNS oid[] LANGUAGE sql STABLE
SET search_path=pg_catalog,pg_temp AS $callers$
 WITH RECURSIVE routines AS (
  SELECT p.oid,p.proowner,p.prosecdef,p.prorettype FROM pg_proc p WHERE p.oid IN (
   'public.jg_enforce_exclusive_file_business_binding()'::regprocedure,
   'public.jg_enforce_file_replacement_exclusive_binding()'::regprocedure)),
 roots(oid) AS (
  SELECT oid FROM pg_roles WHERE rolcanlogin UNION
  SELECT proowner FROM pg_proc WHERE prosecdef AND pronamespace=to_regnamespace('public')),
 reachable(oid) AS (SELECT oid FROM roots UNION
  SELECT m.roleid FROM reachable r JOIN pg_auth_members m ON m.member=r.oid WHERE m.set_option),
 candidates(oid) AS (
  SELECT DISTINCT r.oid FROM reachable r WHERE has_schema_privilege(r.oid,'public','USAGE')
   AND has_function_privilege(r.oid,'public.jg_file_business_binding_columns()','EXECUTE')
   AND (EXISTS(SELECT FROM routines p WHERE p.prosecdef AND p.proowner=r.oid)
    OR EXISTS(SELECT FROM pg_trigger t JOIN routines f ON f.oid=t.tgfoid
     WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A')
      AND t.oid IN (SELECT (x->>'oid')::oid FROM __SCHEMA__.control ctl
        CROSS JOIN LATERAL jsonb_array_elements(ctl.file_trigger_binding) x) AND
      (((t.tgtype & 4)=4 AND has_any_column_privilege(r.oid,t.tgrelid,'INSERT')) OR
       ((t.tgtype & 16)=16 AND ((cardinality(t.tgattr::smallint[])=0 AND
        has_any_column_privilege(r.oid,t.tgrelid,'UPDATE')) OR EXISTS(
        SELECT FROM unnest(t.tgattr::smallint[]) a(attnum)
        WHERE has_column_privilege(r.oid,t.tgrelid,a.attnum,'UPDATE')))))))
 ) SELECT array_agg(DISTINCT oid ORDER BY oid) FROM candidates
$callers$;
REVOKE ALL ON FUNCTION __SCHEMA__.file_callers() FROM PUBLIC;

DO $old_acl$
DECLARE matrix jsonb := __MATRIX__::jsonb; ctl __SCHEMA__.control%ROWTYPE;
 item record; sig text; names text; f record; caller oid; callers oid[]; preserved oid[];
BEGIN
 SELECT * INTO STRICT ctl FROM __SCHEMA__.control;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO __APP__',current_database());
 GRANT USAGE ON SCHEMA public TO __APP__;
 FOR item IN SELECT key,value FROM jsonb_each(matrix->'reads') LOOP
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=to_regclass(format('public.%I',item.key))
    AND relowner=ctl.actor_oid AND relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity)
  THEN RAISE EXCEPTION 'local fixture old relation owner changed'; END IF;
  SELECT string_agg(format('%I',x),',') INTO names FROM jsonb_array_elements_text(item.value) x;
  EXECUTE format('GRANT SELECT (%s) ON public.%I TO __APP__',names,item.key);
 END LOOP;
 FOR item IN SELECT key,value FROM jsonb_each_text(matrix->'lock_columns') LOOP
  EXECUTE format('GRANT UPDATE (%I) ON public.%I TO __APP__',item.value,item.key);
 END LOOP;
 FOR sig IN SELECT jsonb_array_elements_text(matrix->'exec_signatures') LOOP
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure(sig) AND proowner=ctl.actor_oid)
  THEN RAISE EXCEPTION 'local fixture old function owner changed'; END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO __APP__',to_regprocedure(sig));
 END LOOP;
 callers := __SCHEMA__.file_callers();
 IF callers IS NULL OR NOT ctl.actor_oid=ANY(callers)
 THEN RAISE EXCEPTION 'local fixture real file caller closure missing'; END IF;
 -- Preserve dormant explicit old write callers without claiming they are runtime invokers.
 SELECT array_agg(DISTINCT role_oid ORDER BY role_oid) INTO preserved FROM (
  SELECT unnest(callers) AS role_oid UNION
  SELECT a.grantee FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE t.tgfoid='public.jg_enforce_exclusive_file_business_binding()'::regprocedure
    AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND a.grantee<>0
    AND a.privilege_type IN ('INSERT','UPDATE')
    AND has_function_privilege(a.grantee,'public.jg_file_business_binding_columns()','EXECUTE')
  UNION SELECT a.grantee FROM pg_trigger t JOIN pg_attribute c ON c.attrelid=t.tgrelid
   CROSS JOIN LATERAL aclexplode(c.attacl) a
   WHERE t.tgfoid='public.jg_enforce_exclusive_file_business_binding()'::regprocedure
    AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND a.grantee<>0
    AND a.privilege_type IN ('INSERT','UPDATE')
    AND has_function_privilege(a.grantee,'public.jg_file_business_binding_columns()','EXECUTE')
 ) old_callers;
 -- Close PUBLIC registry execution only after retaining the actual old closure.
 FOR item IN SELECT key,value FROM jsonb_each_text(matrix->'collision_routines') LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(item.key);
  IF f.proowner<>ctl.actor_oid OR f.prosecdef OR f.pronamespace<>ctl.namespace_oid
   OR encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>item.value
  THEN RAISE EXCEPTION 'local fixture collision source changed'; END IF;
  FOREACH caller IN ARRAY preserved LOOP
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f.oid::regprocedure,
    (SELECT rolname FROM pg_roles WHERE oid=caller));
  END LOOP;
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC RESTRICT',f.oid::regprocedure);
 END LOOP;
 UPDATE __SCHEMA__.control SET file_caller_setting='['||array_to_string(callers,',')||']',
  role_binding=__SCHEMA__.role_catalog(), file_routine_binding=(SELECT jsonb_agg(jsonb_build_object(
   'oid',oid::text,'owner',proowner::text,'body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
   'definer',prosecdef,'config',proconfig,'acl',proacl) ORDER BY oid) FROM pg_proc WHERE oid IN (
    'public.jg_enforce_exclusive_file_business_binding()'::regprocedure,
    'public.jg_enforce_file_replacement_exclusive_binding()'::regprocedure));
END $old_acl$;

CREATE FUNCTION __SCHEMA__.caller_acl_commands(
  stage integer, ctl __SCHEMA__.control
) RETURNS text[] LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $caller_acl$
DECLARE
  archive_added text[] := ARRAY[
    'archiveProtocolVersion','archiveSource','approvalInstanceId','sealTaskId','idempotencyKey',
    'requestSha256','sourceRevision','documentContentRevision','documentContentFingerprint',
    'authoritySnapshot','authoritySha256','fileManifestSha256','responseSnapshot'];
  evidence_columns text[] := ARRAY[
    'id','archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256'];
  binding_columns text[] := ARRAY[
    'protocolVersion','recipeVersion','applicationRoleOid','fileCallerOids','databaseOid',
    'anchorNamespaceOid','anchorOwnerOid','bindings'];
  app_roles oid[] := ARRAY[ctl.application_oid];
  file_roles oid[];
  review_roles oid[] := ARRAY[]::oid[];
  common_roles oid[] := ARRAY[]::oid[];
  role_ids oid[];
  relation_oid oid;
  routine_oid oid;
  target record;
  recipient record;
  columns_sql text;
  commands text[] := ARRAY[]::text[];
BEGIN
  SELECT pg_catalog.array_agg(v.item::text::oid ORDER BY v.ordinality) INTO STRICT file_roles
  FROM pg_catalog.jsonb_array_elements(ctl.file_caller_setting::jsonb) WITH ORDINALITY AS v(item, ordinality);
  IF stage = 204 THEN
    -- This is the original $callability$ role closure, including the old
    -- participant stop callers that can both update endedAt and execute its fence.
    SELECT pg_catalog.array_agg(DISTINCT p.proowner ORDER BY p.proowner) INTO review_roles
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)'::regprocedure,
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure,
      'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)'::regprocedure,
      'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'::regprocedure);
    common_roles := ARRAY(
      SELECT DISTINCT role_oid FROM (
        SELECT pg_catalog.unnest(app_roles || review_roles) AS role_oid
        UNION ALL
        SELECT r.oid FROM pg_catalog.pg_roles r
        WHERE pg_catalog.has_column_privilege(r.oid, 'public."ProjectParticipatingCompany"', 'endedAt', 'UPDATE')
          AND pg_catalog.has_function_privilege(r.oid, 'public."serializeProjectParticipatingCompanyMutation"(text)', 'EXECUTE')
      ) required ORDER BY role_oid);
  ELSIF stage <> 205 THEN
    RAISE EXCEPTION 'task16 ACL stage rejected';
  END IF;

  role_ids := ARRAY(SELECT DISTINCT id FROM pg_catalog.unnest(app_roles || file_roles || common_roles) AS r(id) ORDER BY id);
  IF pg_catalog.cardinality(role_ids) NOT BETWEEN 1 AND 256
    OR EXISTS (SELECT FROM pg_catalog.unnest(role_ids) r(oid)
      WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE pg_roles.oid=r.oid))
  THEN RAISE EXCEPTION 'local fixture caller identity changed'; END IF;

  FOR target IN SELECT v.object_name, v.privilege, v.column_names, v.roles
    FROM (VALUES
      (204, 'ContractArchiveFile', 'SELECT', archive_added, common_roles),
      (204, 'ContractArchiveEvidenceFile', 'SELECT', evidence_columns, common_roles),
      (204, 'ContractArchiveEvidenceFile', 'INSERT', evidence_columns, app_roles),
      (204, 'ContractArchiveEvidenceFile', 'SELECT', ARRAY['id','fileId'],
        ARRAY(SELECT id FROM pg_catalog.unnest(file_roles) AS r(id) WHERE NOT id = ANY(common_roles))),
      (205, 'jg_contract_direct_pending_binding_v1', 'SELECT', binding_columns, app_roles),
      (205, 'ContractVersion', 'SELECT', ARRAY['originalSignedNumber'], app_roles),
      (205, 'ContractVersion', 'INSERT', ARRAY['originalSignedNumber'], app_roles),
      (205, 'ContractVersion', 'UPDATE', ARRAY['originalSignedNumber'], app_roles)
    ) AS v(stage_no,object_name,privilege,column_names,roles) WHERE v.stage_no = stage
    ORDER BY v.object_name COLLATE "C", v.privilege COLLATE "C", v.column_names
  LOOP
    relation_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', target.object_name));
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = relation_oid AND c.relnamespace = ctl.namespace_oid AND c.relowner = ctl.actor_oid
        AND c.relkind = 'r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
        AND (target.object_name <> 'ContractArchiveFile' OR c.oid = ctl.archive_oid)
        AND (target.object_name <> 'ContractVersion' OR c.oid = ctl.version_oid)
        AND (target.object_name NOT IN ('ContractArchiveEvidenceFile','jg_contract_direct_pending_binding_v1') OR NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
          WHERE a.grantee <> c.relowner OR a.grantor <> c.relowner))
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(target.column_names) AS required(name)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = relation_oid
          AND a.attname = required.name AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NULL)
    ) THEN RAISE EXCEPTION 'task16 ACL relation or new column drift'; END IF;
    FOR recipient IN SELECT oid, rolname FROM pg_catalog.pg_roles
      WHERE oid = ANY(target.roles) AND oid NOT IN (ctl.actor_oid, ctl.installer_oid) ORDER BY oid
    LOOP
      SELECT pg_catalog.string_agg(pg_catalog.format('%I', item.name), ', ' ORDER BY item.ordinality)
        INTO columns_sql FROM pg_catalog.unnest(target.column_names) WITH ORDINALITY AS item(name, ordinality)
        WHERE NOT pg_catalog.has_column_privilege(recipient.oid, relation_oid, item.name, target.privilege);
      IF columns_sql IS NOT NULL THEN
        commands := pg_catalog.array_append(commands, pg_catalog.format('GRANT %s (%s) ON TABLE public.%I TO %I',
          target.privilege, columns_sql, target.object_name, recipient.rolname));
      END IF;
    END LOOP;
  END LOOP;

  FOR target IN SELECT v.signature, v.roles FROM (VALUES
    (204, 'public.jg_assert_contract_archive_v2_manifest(pg_catalog.text)', common_roles),
    (204, 'public.jg_contract_archive_v2_ownership_day(pg_catalog.text)', common_roles),
    (204, 'public.jg_contract_review_archive_v2_ownership_day(public."OperatingFact")', review_roles),
    (205, 'public.jg_contract_direct_pending_version_guard_v1()', app_roles),
    (205, 'public.jg_contract_direct_pending_input_v1(pg_catalog.text)', app_roles),
    (205, 'public.jg_contract_direct_pending_attachment_guard_v1()', app_roles),
    (205, 'public.jg_contract_direct_pending_file_guard_v1()', app_roles || file_roles)
  ) AS v(stage_no,signature,roles) WHERE v.stage_no = stage ORDER BY v.signature COLLATE "C"
  LOOP
    routine_oid := pg_catalog.to_regprocedure(target.signature);
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = routine_oid AND p.pronamespace = ctl.namespace_oid AND p.proowner = ctl.actor_oid
        AND p.prokind = 'f' AND NOT p.prosecdef
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee <> p.proowner OR a.grantor <> p.proowner)
    ) THEN RAISE EXCEPTION 'task16 ACL new routine drift'; END IF;
    FOR recipient IN SELECT oid, rolname FROM pg_catalog.pg_roles WHERE oid = ANY(target.roles)
      AND oid NOT IN (ctl.actor_oid, ctl.installer_oid)
      AND NOT pg_catalog.has_function_privilege(oid, routine_oid, 'EXECUTE') ORDER BY oid
    LOOP
      commands := pg_catalog.array_append(commands, pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %I',
        target.signature, recipient.rolname));
    END LOOP;
  END LOOP;
  RETURN commands;
END
$caller_acl$;

REVOKE ALL ON FUNCTION __SCHEMA__.caller_acl_commands(integer,__SCHEMA__.control) FROM PUBLIC;

CREATE FUNCTION __SCHEMA__.application_qualified() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $application$
DECLARE ctl __SCHEMA__.control%ROWTYPE; matrix jsonb:=__MATRIX__::jsonb;
 reads jsonb; inserts jsonb; updates jsonb; allowed text[]; app record; rel record; col record;
 wanted_select boolean; wanted_update boolean; wanted_insert boolean; file_oid oid; sig text;
BEGIN
 SELECT * INTO STRICT ctl FROM __SCHEMA__.control;
 SELECT * INTO STRICT app FROM pg_authid WHERE oid=ctl.application_oid AND rolname=ctl.plan->>'appName';
 IF app.rolsuper OR app.rolinherit OR app.rolcreatedb OR app.rolcreaterole OR app.rolreplication OR app.rolbypassrls
  OR NOT app.rolcanlogin OR app.rolconnlimit<>0 OR app.rolpassword IS NOT NULL
  OR EXISTS(SELECT FROM pg_auth_members WHERE member=app.oid OR roleid=app.oid)
  OR has_schema_privilege(app.oid,'public','CREATE') OR NOT has_schema_privilege(app.oid,'public','USAGE')
  OR pg_has_role(app.oid,ctl.actor_oid,'MEMBER')
  OR EXISTS(SELECT FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=app.oid
   AND (deptype='o' OR dbid NOT IN (0,(ctl.plan->>'databaseOid')::oid)))
 THEN RETURN false; END IF;
 reads:=matrix->'reads';
 reads:=jsonb_set(reads,'{ContractArchiveFile}',(reads->'ContractArchiveFile')||
  '["archiveProtocolVersion","archiveSource","approvalInstanceId","sealTaskId","idempotencyKey","requestSha256","sourceRevision","documentContentRevision","documentContentFingerprint","authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot"]'::jsonb);
 reads:=jsonb_set(reads,'{ContractVersion}',(reads->'ContractVersion')||'["originalSignedNumber"]'::jsonb);
 reads:=reads||'{"ContractArchiveEvidenceFile":["id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256"],"jg_contract_direct_pending_binding_v1":["protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings"]}'::jsonb;
 inserts:='{"ContractArchiveEvidenceFile":["id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256"],"ContractVersion":["originalSignedNumber"]}'::jsonb;
 SELECT jsonb_object_agg(key,jsonb_build_array(value)) INTO updates FROM jsonb_each_text(matrix->'lock_columns');
 updates:=jsonb_set(updates,'{ContractVersion}',(updates->'ContractVersion')||'["originalSignedNumber"]'::jsonb);
 FOR rel IN SELECT * FROM pg_class WHERE relnamespace=ctl.namespace_oid AND relkind IN ('r','p','v','m','f') LOOP
  IF (reads ? rel.relname::text) AND (rel.relkind<>'r' OR rel.relowner<>ctl.actor_oid OR rel.relrowsecurity OR rel.relforcerowsecurity)
   THEN RETURN false; END IF;
  IF has_table_privilege(app.oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   THEN RETURN false; END IF;
  FOR col IN SELECT * FROM pg_attribute WHERE attrelid=rel.oid AND attnum>0 AND NOT attisdropped LOOP
   wanted_select:=coalesce((reads->rel.relname::text) ? col.attname::text,false);
   wanted_insert:=coalesce((inserts->rel.relname::text) ? col.attname::text,false);
   wanted_update:=coalesce((updates->rel.relname::text) ? col.attname::text,false);
   IF has_column_privilege(app.oid,rel.oid,col.attnum,'SELECT') IS DISTINCT FROM wanted_select
    OR has_column_privilege(app.oid,rel.oid,col.attnum,'INSERT') IS DISTINCT FROM wanted_insert
    OR has_column_privilege(app.oid,rel.oid,col.attnum,'UPDATE') IS DISTINCT FROM wanted_update
    OR has_column_privilege(app.oid,rel.oid,col.attnum,'REFERENCES')
    OR EXISTS(SELECT FROM aclexplode(col.attacl) a WHERE a.grantee=app.oid
     AND (a.grantor<>ctl.actor_oid OR a.is_grantable))
   THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_each(reads) t(name,columns) CROSS JOIN LATERAL jsonb_array_elements_text(t.columns) x(name)
   WHERE NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',t.name))
     AND attname=x.name AND attnum>0 AND NOT attisdropped))
 THEN RETURN false; END IF;
 SELECT array_agg(value) INTO allowed FROM jsonb_array_elements_text(matrix->'exec_signatures');
 allowed:=allowed||ARRAY['public.jg_file_business_binding_columns_before_contract_archive_v2()',
  'public.jg_assert_contract_archive_v2_manifest(pg_catalog.text)',
  'public.jg_contract_archive_v2_ownership_day(pg_catalog.text)',
  'public.jg_contract_direct_pending_version_guard_v1()',
  'public.jg_contract_direct_pending_input_v1(pg_catalog.text)',
  'public.jg_contract_direct_pending_attachment_guard_v1()',
  'public.jg_contract_direct_pending_file_guard_v1()'];
 IF EXISTS(SELECT FROM unnest(allowed) AS granted(signature) WHERE to_regprocedure(granted.signature) IS NULL
   OR NOT has_function_privilege(app.oid,to_regprocedure(granted.signature),'EXECUTE'))
  OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=app.oid
   AND (p.pronamespace<>ctl.namespace_oid OR a.grantor<>ctl.actor_oid OR a.is_grantable OR
    NOT p.oid=ANY(ARRAY(SELECT to_regprocedure(granted.signature)::oid FROM unnest(allowed) AS granted(signature)))))
  OR EXISTS(SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=app.oid
   AND (n.oid<>ctl.namespace_oid OR a.privilege_type<>'USAGE' OR a.is_grantable))
  OR EXISTS(SELECT FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee=app.oid
   AND (d.oid<>(ctl.plan->>'databaseOid')::oid OR a.privilege_type<>'CONNECT' OR a.is_grantable))
 THEN RETURN false; END IF;
 FOR file_oid IN SELECT value::text::oid FROM jsonb_array_elements(ctl.file_caller_setting::jsonb) LOOP
  IF NOT has_column_privilege(file_oid,'public."ContractArchiveEvidenceFile"','id','SELECT')
    OR NOT has_column_privilege(file_oid,'public."ContractArchiveEvidenceFile"','fileId','SELECT')
    OR NOT has_column_privilege(file_oid,'public."ContractDraftAttachment"','fileId','SELECT')
    OR NOT has_column_privilege(file_oid,'public."ContractDraftAttachment"','slotKey','SELECT')
    OR NOT has_function_privilege(file_oid,'public.jg_contract_direct_pending_file_guard_v1()','EXECUTE')
   THEN RETURN false; END IF;
  FOR sig IN SELECT jsonb_object_keys(matrix->'collision_routines') UNION ALL
    SELECT 'public.jg_file_business_binding_columns_before_contract_archive_v2()' LOOP
   IF NOT has_function_privilege(file_oid,to_regprocedure(sig),'EXECUTE') THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $application$;
REVOKE ALL ON FUNCTION __SCHEMA__.application_qualified() FROM PUBLIC;

CREATE FUNCTION __SCHEMA__.verify_control() RETURNS __SCHEMA__.control
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $verify$
DECLARE ctl __SCHEMA__.control%ROWTYPE; objects jsonb; r record;
BEGIN
 SELECT * INTO STRICT ctl FROM __SCHEMA__.control WHERE singleton;
 IF current_user<>'jiangkong' OR current_user<>session_user
  OR current_database() IS DISTINCT FROM ctl.plan->>'database'
  OR current_user::regrole::oid<>ctl.actor_oid
  OR (SELECT oid::text FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM ctl.plan->>'databaseOid'
  OR (SELECT datdba FROM pg_database WHERE datname=current_database())<>ctl.actor_oid
  OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM ctl.plan->>'systemIdentifier'
  OR to_regnamespace('public')<>ctl.namespace_oid
  OR current_setting('session_replication_role')<>'origin'
  OR getdatabaseencoding()<>'UTF8'
  OR (SELECT jsonb_agg(jsonb_build_object('oid',t.oid::text,'relation',t.tgrelid::text,'function',t.tgfoid::text,
    'type',t.tgtype,'columns',t.tgattr::text,'enabled',t.tgenabled,'qual',t.tgqual::text,'args',encode(t.tgargs,'hex')) ORDER BY t.oid)
    FROM pg_trigger t WHERE t.oid IN (SELECT (x->>'oid')::oid FROM jsonb_array_elements(ctl.file_trigger_binding) x))
      IS DISTINCT FROM ctl.file_trigger_binding
  OR (SELECT jsonb_agg(jsonb_build_object('oid',p.oid::text,'owner',p.proowner::text,
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl)
    ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN (
      SELECT (x->>'oid')::oid FROM jsonb_array_elements(ctl.file_routine_binding) x))
    IS DISTINCT FROM ctl.file_routine_binding
  OR __SCHEMA__.role_catalog() IS DISTINCT FROM ctl.role_binding
  OR __SCHEMA__.file_callers() IS DISTINCT FROM ARRAY(SELECT x::text::oid FROM jsonb_array_elements(ctl.file_caller_setting::jsonb) x)
 THEN RAISE EXCEPTION 'local fixture scope changed'; END IF;
 SELECT * INTO STRICT r FROM pg_roles WHERE oid=ctl.application_oid AND rolname=ctl.plan->>'appName';
 IF r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
   OR NOT r.rolcanlogin OR r.rolconnlimit<>0
   OR EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
   OR has_schema_privilege(r.oid,'public','CREATE')
   OR pg_has_role(r.oid,ctl.actor_oid,'MEMBER')
 THEN RAISE EXCEPTION 'local fixture app identity escaped'; END IF;
 SELECT jsonb_build_object('schemaOid',to_regnamespace('__SCHEMA__')::oid::text,
  'schemaOwner',(SELECT nspowner::text FROM pg_namespace WHERE oid=to_regnamespace('__SCHEMA__')),
  'relations',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',relname,'owner',relowner::text)
   ORDER BY oid) FROM pg_class WHERE relnamespace=to_regnamespace('__SCHEMA__') AND relkind='r'),
  'functions',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',proname,'owner',proowner::text,
   'definer',prosecdef,'body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'config',proconfig,'acl',proacl)
   ORDER BY oid) FROM pg_proc WHERE pronamespace=to_regnamespace('__SCHEMA__')),
  'event',(SELECT jsonb_build_object('oid',oid::text,'owner',evtowner::text,'function',evtfoid::text,
   'enabled',evtenabled,'event',evtevent,'tags',evttags) FROM pg_event_trigger WHERE evtname='__SCHEMA__'))
 INTO objects;
 IF ctl.object_binding IS NOT NULL AND objects IS DISTINCT FROM ctl.object_binding
 THEN RAISE EXCEPTION 'local fixture control objects changed'; END IF;
 RETURN ctl;
END $verify$;
REVOKE ALL ON FUNCTION __SCHEMA__.verify_control() FROM PUBLIC;

CREATE FUNCTION __SCHEMA__.observe() RETURNS event_trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $event$
DECLARE ctl __SCHEMA__.control%ROWTYPE; stage integer; next_order integer; q text;
 wanted record; actual record; first_row jsonb; stage_row jsonb; observed_backend_pid integer:=pg_backend_pid();
 started text; xid text:=pg_current_xact_id()::text; command text; source_row jsonb;
BEGIN
 SELECT * INTO STRICT ctl FROM __SCHEMA__.verify_control();
 IF current_setting('app.local_migration_nonce',true) IS DISTINCT FROM ctl.plan->>'nonce'
  OR current_setting('app.contract_archive_v2_application_role_oid',true) IS DISTINCT FROM ctl.application_oid::text
  OR current_setting('app.contract_archive_v2_file_caller_oids',true) IS DISTINCT FROM ctl.file_caller_setting
 THEN RAISE EXCEPTION 'local fixture migration startup rejected'; END IF;
 q:=encode(sha256(convert_to(current_query(),'UTF8')),'hex');
 IF q='296c6e2f502bc782bd83ab59190505e27b80623d1da1a3b6dddb72c414eb686f' THEN stage:=204;
 ELSIF q='2ca118b29e8e75745a1ac7d6f8de3fbfa70fa5774b3d95c48c6119caff8b316a' THEN stage:=205;
 ELSE RAISE EXCEPTION 'local fixture exact migration query rejected'; END IF;
 SELECT coalesce(max(ordinal),0)+1 INTO next_order FROM __SCHEMA__.events;
 -- Remaining DDL in the same exact migration may follow the last grant anchor.
 -- Exhausted anchors produce no further grants or trace entries.
 IF next_order>4 OR (stage=204 AND next_order>2) THEN RETURN; END IF;
 IF stage=205 AND next_order<3
 THEN RAISE EXCEPTION 'local fixture stage order changed'; END IF;
 SELECT * INTO STRICT wanted FROM (VALUES
  (1,'ALTER TABLE','pg_class','ContractArchiveFile',ctl.archive_oid,NULL::text),
  (2,'CREATE FUNCTION','pg_proc','protectProjectParticipatingCompanyEndDate',ctl.anchor_oid,
   'bf63fd6b2e56aa7d6562f0ab2793ee9f87fd3ffaacb03aee7f3f7162e34c5faa'),
  (3,'ALTER TABLE','pg_class','ContractVersion',ctl.version_oid,NULL::text),
  (4,'ALTER FUNCTION','pg_proc','jg_contract_direct_pending_file_guard_v1',NULL::oid,
   '106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1')
 ) v(n,tag,catalog,name,expected_oid,body) WHERE n=next_order;
 SELECT DISTINCT d.objid,d.objsubid,p.prosrc,p.proowner,p.pronargs INTO actual
 FROM pg_event_trigger_ddl_commands() d
 LEFT JOIN pg_class c ON d.classid='pg_class'::regclass AND c.oid=d.objid
 LEFT JOIN pg_proc p ON d.classid='pg_proc'::regclass AND p.oid=d.objid
 WHERE d.command_tag=wanted.tag AND d.classid=to_regclass('pg_catalog.'||wanted.catalog)
  AND d.schema_name='public' AND d.objsubid=0 AND NOT d.in_extension
  AND ((c.relname=wanted.name AND c.relnamespace=ctl.namespace_oid) OR
    (p.proname=wanted.name AND p.pronamespace=ctl.namespace_oid AND p.pronargs=0));
 IF NOT FOUND THEN RETURN; END IF;
 IF (wanted.expected_oid IS NOT NULL AND wanted.expected_oid<>actual.objid)
  OR (wanted.body IS NOT NULL AND (actual.proowner<>ctl.actor_oid OR
   encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM wanted.body))
 THEN RAISE EXCEPTION 'local fixture migration object changed'; END IF;
 SELECT to_char(activity.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') INTO STRICT started
 FROM pg_stat_activity AS activity WHERE activity.pid=observed_backend_pid AND activity.usesysid=ctl.actor_oid;
 SELECT payload INTO first_row FROM __SCHEMA__.events WHERE ordinal=1;
 IF next_order>1 AND ((first_row->>'backendPid')::integer<>observed_backend_pid OR first_row->>'backendStart'<>started)
 THEN RAISE EXCEPTION 'local fixture migration backend changed'; END IF;
 IF next_order=3 AND (first_row->>'transactionId')::numeric>=xid::numeric
 THEN RAISE EXCEPTION 'local fixture migration transaction reused'; END IF;
 IF next_order IN (2,4) THEN
  SELECT payload INTO STRICT stage_row FROM __SCHEMA__.events WHERE ordinal=next_order-1;
  IF stage_row->>'transactionId'<>xid THEN RAISE EXCEPTION 'local fixture anchor transaction changed'; END IF;
 END IF;
 SELECT jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,
  'rolledBack',rolled_back_at IS NOT NULL) INTO STRICT source_row FROM public._prisma_migrations
 WHERE migration_name=ctl.plan->'migrations'->(stage-2)->>'name'
  AND checksum=ctl.plan->'migrations'->(stage-2)->>'sha256' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;
 INSERT INTO __SCHEMA__.events VALUES(next_order,jsonb_build_object(
  'ordinal',next_order,'stage',stage,'tag',wanted.tag,'catalog',wanted.catalog,'name',wanted.name,
  'objectOid',actual.objid::text,'bodySha256',wanted.body,'querySha256',q,
  'backendPid',observed_backend_pid,'backendStart',started,'transactionId',xid,
  'runId',ctl.plan->>'runId','nonce',ctl.plan->>'nonce','databaseOid',ctl.plan->>'databaseOid',
  'systemIdentifier',ctl.plan->>'systemIdentifier','actorOid',ctl.actor_oid::text,
  'appOid',ctl.application_oid::text,'fileCallerOids',ctl.file_caller_setting::jsonb,'preceding',source_row));
 IF next_order IN (2,4) THEN
  FOREACH command IN ARRAY __SCHEMA__.caller_acl_commands(stage,ctl) LOOP EXECUTE command; END LOOP;
 END IF;
END $event$;
REVOKE ALL ON FUNCTION __SCHEMA__.observe() FROM PUBLIC;
CREATE EVENT TRIGGER __SCHEMA__ ON ddl_command_end
 WHEN TAG IN ('ALTER TABLE','CREATE FUNCTION','ALTER FUNCTION') EXECUTE FUNCTION __SCHEMA__.observe();
-- Bind actual object identities after all definitions exist, before any migration DDL.
UPDATE __SCHEMA__.control SET object_binding=(SELECT jsonb_build_object(
 'schemaOid',to_regnamespace('__SCHEMA__')::oid::text,
 'schemaOwner',(SELECT nspowner::text FROM pg_namespace WHERE oid=to_regnamespace('__SCHEMA__')),
 'relations',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',relname,'owner',relowner::text)
  ORDER BY oid) FROM pg_class WHERE relnamespace=to_regnamespace('__SCHEMA__') AND relkind='r'),
 'functions',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',proname,'owner',proowner::text,
  'definer',prosecdef,'body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'config',proconfig,'acl',proacl)
  ORDER BY oid) FROM pg_proc WHERE pronamespace=to_regnamespace('__SCHEMA__')),
 'event',(SELECT jsonb_build_object('oid',oid::text,'owner',evtowner::text,'function',evtfoid::text,
  'enabled',evtenabled,'event',evtevent,'tags',evttags) FROM pg_event_trigger WHERE evtname='__SCHEMA__')));
SELECT jsonb_build_object('runId',plan->>'runId','appOid',application_oid::text,
 'fileCallerOids',file_caller_setting::jsonb,'schemaOid',to_regnamespace('__SCHEMA__')::oid::text,
 'controlOid','__SCHEMA__.control'::regclass::oid::text,
 'eventOid',(SELECT oid::text FROM pg_event_trigger WHERE evtname='__SCHEMA__'),'qualified',true)
FROM __SCHEMA__.verify_control();
COMMIT;
