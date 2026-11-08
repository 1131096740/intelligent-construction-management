-- Task16-only fresh resource baseline ACL. Source/mock only; never a migration.
BEGIN;
SET LOCAL search_path=pg_catalog,public,pg_temp;
SET LOCAL lock_timeout='5s';
LOCK TABLE public._prisma_migrations IN SHARE MODE;
__TRANSACTION_GUARD__
CREATE TEMP VIEW jg_task16_acl_now AS
  SELECT 'relation'::text AS kind,c.oid AS object_oid,0::smallint AS column_number,
         a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,
      pg_catalog.acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
  UNION ALL
  SELECT 'column',c.oid,att.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid=c.oid AND att.attnum<>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(att.attacl,'{}'::aclitem[])) a
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
  UNION ALL
  SELECT 'function',p.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE n.nspname='public'
  UNION ALL
  SELECT 'type',t.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_type t
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))) a
   WHERE t.oid IN ('public."OperatingLedgerFactWritePayloadV2"'::regtype,'public."OperatingLedgerImpactWritePayloadV2"'::regtype)
  UNION ALL
  SELECT 'schema',n.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE n.nspname='public'
  UNION ALL
  SELECT 'database',d.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a;
CREATE TEMP TABLE jg_task16_acl_before ON COMMIT PRESERVE ROWS AS SELECT * FROM pg_temp.jg_task16_acl_now;
DO $roles$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer')) THEN RAISE EXCEPTION 'task16 restricted role already exists'; END IF;
 CREATE ROLE jg_task01_runtime LOGIN PASSWORD '__RUNTIME_PASSWORD__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
 CREATE ROLE jg_task01_observer LOGIN PASSWORD '__OBSERVER_PASSWORD__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
 ALTER ROLE jg_task01_runtime SET search_path=pg_catalog,public;
 ALTER ROLE jg_task01_observer SET search_path=pg_catalog,public;
 ALTER ROLE jg_task01_observer SET default_transaction_read_only=on;
END $roles$;
DO $database_acl$ DECLARE d RECORD; BEGIN
 FOR d IN SELECT datname FROM pg_catalog.pg_database LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM PUBLIC,jg_task01_runtime,jg_task01_observer',d.datname);
 END LOOP;
 EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO jg_task01_runtime,jg_task01_observer',pg_catalog.current_database());
END $database_acl$;
REVOKE ALL ON SCHEMA public FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
GRANT USAGE ON SCHEMA public TO jg_task01_runtime,jg_task01_observer;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
ALTER DEFAULT PRIVILEGES FOR ROLE jg_task01_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
ALTER DEFAULT PRIVILEGES FOR ROLE jg_task01_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
ALTER DEFAULT PRIVILEGES FOR ROLE jg_task01_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
DO $column_acl$ DECLARE t RECORD; cols TEXT; privilege TEXT; BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
  SELECT pg_catalog.string_agg(pg_catalog.format('%I',a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped;
  IF cols IS NOT NULL THEN
   FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    EXECUTE pg_catalog.format('REVOKE %s (%s) ON TABLE public.%I FROM PUBLIC,jg_task01_runtime,jg_task01_observer',privilege,cols,t.relname);
   END LOOP;
  END IF;
 END LOOP;
END $column_acl$;
CREATE FUNCTION public.jg_task01_connection_identity()
RETURNS TABLE("loginRole" TEXT,"databaseOid" TEXT,"systemIdentifier" TEXT,"backendPid" INTEGER,tls BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $identity$__IDENTITY_BODY__$identity$;
REVOKE ALL ON FUNCTION public.jg_task01_connection_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jg_task01_connection_identity() TO jg_task01_runtime,jg_task01_observer;
GRANT EXECUTE ON FUNCTION public.assert_inter_entity_relationship_lineage(TEXT,TEXT) TO jg_task01_runtime;
CREATE FUNCTION public.jg_task16_runtime_version_read_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $version_guard$__VERSION_GUARD_BODY__$version_guard$;
REVOKE ALL ON FUNCTION public.jg_task16_runtime_version_read_only() FROM PUBLIC,jg_task01_runtime,jg_task01_observer;
CREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion"
FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_version_read_only();
ALTER TABLE public."ContractVersion" ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only;
DO $column_grants$ DECLARE role_plan JSONB; table_plan JSONB; op TEXT; cols TEXT; BEGIN
 FOR role_plan IN SELECT (__PLAN_JSON__::jsonb)->'runtime' UNION ALL SELECT (__PLAN_JSON__::jsonb)->'observer' LOOP
  FOR table_plan IN SELECT value FROM pg_catalog.jsonb_array_elements(role_plan->'tables') LOOP
   FOREACH op IN ARRAY ARRAY['select','insert','update'] LOOP
    IF pg_catalog.jsonb_array_length(table_plan->op)>0 THEN
     SELECT pg_catalog.string_agg(pg_catalog.format('%I',value),',') INTO cols FROM pg_catalog.jsonb_array_elements_text(table_plan->op);
     EXECUTE pg_catalog.format('GRANT %s (%s) ON TABLE public.%I TO %I',pg_catalog.upper(op),cols,table_plan->>'table',role_plan->>'role');
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $column_grants$;
CREATE FUNCTION pg_temp.jg_task16_baseline_check(plan JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $matrix$
DECLARE role_plan JSONB; table_plan JSONB; role_name TEXT; role_oid OID; rel RECORD; col RECORD; f RECORD; d RECORD; proof JSONB; op TEXT; expected BOOLEAN; owner_oid OID;
BEGIN
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_owner';
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public' AND n.nspowner IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'))) THEN RAISE EXCEPTION 'task16 public schema owner changed'; END IF;
 FOR role_plan IN SELECT plan->'runtime' UNION ALL SELECT plan->'observer' LOOP
  role_name:=role_plan->>'role'; SELECT oid INTO STRICT role_oid FROM pg_catalog.pg_roles WHERE rolname=role_name;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=role_oid AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolconnlimit<>1))
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=role_oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=role_oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=role_oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=role_oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datdba=role_oid)
   OR pg_catalog.has_parameter_privilege(role_oid,'session_replication_role','SET')
   OR pg_catalog.has_schema_privilege(role_oid,'public','CREATE')
   OR NOT pg_catalog.has_schema_privilege(role_oid,'public','USAGE') THEN RAISE EXCEPTION 'task16 restricted role unsafe'; END IF;
  IF role_name='jg_task01_observer' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=role_oid AND 'default_transaction_read_only=on'=ANY(rolconfig)) THEN RAISE EXCEPTION 'task16 observer not read only'; END IF;
  FOR d IN SELECT oid,datname FROM pg_catalog.pg_database LOOP
   IF pg_catalog.has_database_privilege(role_oid,d.oid,'CONNECT') IS DISTINCT FROM (d.datname=pg_catalog.current_database()) OR pg_catalog.has_database_privilege(role_oid,d.oid,'CREATE') OR pg_catalog.has_database_privilege(role_oid,d.oid,'TEMP') THEN RAISE EXCEPTION 'task16 database capability mismatch'; END IF;
  END LOOP;
  FOR rel IN SELECT c.oid,c.relname,c.relkind,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
   IF rel.relowner IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=coalesce((plan->'legacyRelationOwners')->>rel.relname,'jg_task01_owner')) THEN RAISE EXCEPTION 'task16 baseline relation owner changed'; END IF;
   IF rel.relkind='S' THEN
    IF pg_catalog.has_sequence_privilege(role_oid,rel.oid,'USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'task16 sequence capability mismatch'; END IF;
   ELSE
    IF pg_catalog.has_table_privilege(role_oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'task16 table-level capability rejected'; END IF;
    SELECT value INTO table_plan FROM pg_catalog.jsonb_array_elements(role_plan->'tables') WHERE value->>'table'=rel.relname;
    FOR col IN SELECT a.attnum,a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=rel.oid AND a.attnum<>0 AND NOT a.attisdropped LOOP
     FOREACH op IN ARRAY ARRAY['select','insert','update','references'] LOOP
      expected:=coalesce((table_plan->op)?col.attname,false);
      IF pg_catalog.has_column_privilege(role_oid,rel.oid,col.attnum,pg_catalog.upper(op)) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'task16 effective column matrix mismatch'; END IF;
     END LOOP;
    END LOOP;
   END IF;
  END LOOP;
  FOR f IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
   IF f.proowner IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=coalesce((SELECT mapped.value FROM pg_catalog.jsonb_each_text(plan->'legacyFunctionOwners') mapped WHERE pg_catalog.to_regprocedure(mapped.key)=f.oid),'jg_task01_owner')) THEN RAISE EXCEPTION 'task16 baseline function owner changed'; END IF;
   IF pg_catalog.has_function_privilege(role_oid,f.oid,'EXECUTE') IS DISTINCT FROM EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(role_plan->'functions') signature WHERE pg_catalog.to_regprocedure(signature.value)=f.oid) THEN RAISE EXCEPTION 'task16 effective function matrix mismatch'; END IF;
  END LOOP;
 END LOOP;
 FOR proof IN SELECT value FROM pg_catalog.jsonb_array_elements(plan->'functionProofs') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(proof->>'signature') AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prosrc=proof->>'body' AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')) THEN RAISE EXCEPTION 'task16 baseline invoker helper source changed'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.jg_task01_connection_identity()'::regprocedure AND p.proowner=owner_oid AND p.prosecdef AND p.prosrc=__IDENTITY_BODY_LITERAL__ AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'task16 identity function changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='jg_task16_runtime_version_read_only' AND t.tgrelid='public."ContractVersion"'::regclass AND t.tgtype=19 AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=0 AND p.oid='public.jg_task16_runtime_version_read_only()'::regprocedure AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prorettype='pg_catalog.trigger'::regtype AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND p.prosrc=__VERSION_GUARD_LITERAL__ AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'task16 lock-only version guard missing or changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.jg_task16_acl_now a WHERE a.grantee=0 OR (a.is_grantable AND a.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer')))) THEN RAISE EXCEPTION 'task16 public or grant option capability rejected'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl a CROSS JOIN LATERAL pg_catalog.aclexplode(a.defaclacl) x WHERE a.defaclrole=owner_oid AND (a.defaclnamespace=0 OR a.defaclnamespace='public'::regnamespace) AND x.grantee IN (0,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer'))) THEN RAISE EXCEPTION 'task16 future default grants unsafe'; END IF;
 IF EXISTS((SELECT * FROM pg_temp.jg_task16_acl_before WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')) EXCEPT SELECT * FROM pg_temp.jg_task16_acl_now WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')))
 UNION ALL
 (SELECT * FROM pg_temp.jg_task16_acl_now WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')) EXCEPT SELECT * FROM pg_temp.jg_task16_acl_before WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')))) THEN RAISE EXCEPTION 'task16 unrelated grantee ACL changed'; END IF;
 RETURN TRUE;
END $matrix$;
DO $check_before_commit$ BEGIN PERFORM pg_temp.jg_task16_baseline_check(__PLAN_JSON__::jsonb); END $check_before_commit$;
DO $schema203_before_commit$ BEGIN IF NOT (__SCHEMA203_PROOF_SQL__) OR (__SCHEMA203_TYPE_ACL_SQL__) IS DISTINCT FROM __SCHEMA203_TYPE_ACL_JSON__::jsonb THEN RAISE EXCEPTION 'task16 schema203 caller/type changed before baseline commit'; END IF; END $schema203_before_commit$;
COMMIT;
__COMMITTED_IDENTITY__
