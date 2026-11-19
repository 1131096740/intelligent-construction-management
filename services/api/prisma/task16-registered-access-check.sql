-- Sole Task16 metadata checker definitions; no roles/grants/product DML.
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
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
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
CREATE FUNCTION pg_temp.jg_task16_registered_check(plan JSONB, final_stage BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $matrix$
DECLARE role_plan JSONB; table_plan JSONB; role_name TEXT; role_oid OID; rel RECORD; col RECORD; f RECORD; d RECORD; proof JSONB; op TEXT; expected BOOLEAN; owner_oid OID;
BEGIN
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_owner';
 IF NOT (__SCHEMA203_PROOF_SQL__) OR (__SCHEMA203_TYPE_ACL_SQL__) IS DISTINCT FROM __SCHEMA203_TYPE_ACL_JSON__::jsonb THEN RAISE EXCEPTION 'task16 schema203 caller/type continuity changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public' AND n.nspowner IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'))) THEN RAISE EXCEPTION 'task16 public schema owner changed'; END IF;
 FOR role_plan IN SELECT (CASE WHEN final_stage THEN plan ELSE plan->'before' END)->'runtime' UNION ALL SELECT (CASE WHEN final_stage THEN plan ELSE plan->'before' END)->'observer' LOOP
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
    IF pg_catalog.has_table_privilege(role_oid,rel.oid,'SELECT,INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'task16 table-level capability rejected'; END IF;
    expected:=final_stage AND role_name='jg_task01_runtime' AND rel.oid=pg_catalog.to_regclass('public."AuthRateLimit"') AND rel.relkind='r' AND coalesce(role_plan->'technicalAuthRateLimitDelete'='true'::jsonb,false);
    IF pg_catalog.has_table_privilege(role_oid,rel.oid,'DELETE') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'task16 exact technical delete matrix mismatch'; END IF;
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
 FOR proof IN SELECT value FROM pg_catalog.jsonb_array_elements(plan->'baselineFunctionProofs') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(proof->>'signature') AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prosrc=proof->>'body' AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND p.proconfig IS NULL AND p.prorettype='pg_catalog.void'::regtype AND NOT p.proretset AND NOT p.proisstrict AND p.provolatile='v' AND p.proparallel='u') THEN RAISE EXCEPTION 'task16 baseline invoker helper source changed'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.jg_task01_connection_identity()'::regprocedure AND p.proowner=owner_oid AND p.prosecdef AND p.prosrc=__IDENTITY_BODY_LITERAL__ AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'task16 identity function changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='jg_task16_runtime_version_read_only' AND t.tgrelid='public."ContractVersion"'::regclass AND t.tgtype=19 AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=0 AND p.oid='public.jg_task16_runtime_version_read_only()'::regprocedure AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prorettype='pg_catalog.trigger'::regtype AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND p.prosrc=__VERSION_GUARD_LITERAL__ AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'task16 lock-only version guard missing or changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.jg_task16_acl_now a WHERE a.grantee=0 OR (a.is_grantable AND a.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer')))) THEN RAISE EXCEPTION 'task16 public or grant option capability rejected'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl a CROSS JOIN LATERAL pg_catalog.aclexplode(a.defaclacl) x WHERE a.defaclrole=owner_oid AND (a.defaclnamespace=0 OR a.defaclnamespace='public'::regnamespace) AND x.grantee IN (0,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer'))) THEN RAISE EXCEPTION 'task16 future default grants unsafe'; END IF;
 IF EXISTS((SELECT * FROM pg_temp.jg_task16_acl_before WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')) EXCEPT SELECT * FROM pg_temp.jg_task16_acl_now WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')))
 UNION ALL
 (SELECT * FROM pg_temp.jg_task16_acl_now WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')) EXCEPT SELECT * FROM pg_temp.jg_task16_acl_before WHERE grantee<>0 AND grantee NOT IN (owner_oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pg_database_owner'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_runtime'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_observer')))) THEN RAISE EXCEPTION 'task16 unrelated grantee ACL changed'; END IF;

 IF NOT (__FUNCTION_PROOF_SQL__) THEN RAISE EXCEPTION 'task16 registered full function source changed'; END IF;
 IF final_stage THEN
  IF NOT (__REFERENCE_GUARD_SQL__) THEN RAISE EXCEPTION 'task16 lock-only reference guard missing or changed'; END IF;
 ELSE
  IF NOT (__REFERENCE_ABSENT_SQL__) THEN RAISE EXCEPTION 'task16 reference instrumentation already exists'; END IF;
 END IF;
 IF (__OBJECT_WITNESS_SQL__) IS DISTINCT FROM __OBJECT_WITNESS_JSON__::jsonb THEN RAISE EXCEPTION 'task16 installed object catalog changed'; END IF;
 RETURN TRUE;
END $matrix$;
