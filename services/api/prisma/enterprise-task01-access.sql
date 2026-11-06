-- PREPARED / NOT EXECUTED. Only the task-owned new cluster driver may substitute
-- the three fixed markers below. A missing permission stops; it never grants more.
BEGIN;
DO $inputs$
BEGIN
  PERFORM pg_catalog.set_config('app.task01_access_plan', '__TASK01_ACCESS_PLAN_JSON__', true);
  PERFORM pg_catalog.set_config('app.task01_runtime_password', '__TASK01_RUNTIME_PASSWORD__', true);
  PERFORM pg_catalog.set_config('app.task01_observer_password', '__TASK01_OBSERVER_PASSWORD__', true);
END;
$inputs$;

DO $scope$
BEGIN
  IF current_user <> 'jg_task01_owner' OR current_database() !~ '^jg_task01_[a-f0-9]{32}$'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer')) THEN
    RAISE EXCEPTION 'TASK01_CATALOG_SCOPE_REJECTED';
  END IF;
END;
$scope$;
CREATE TEMP VIEW jg_task01_acl_now AS
  SELECT 'relation'::text AS kind,c.oid AS object_oid,0::smallint AS column_number,
         a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,
      pg_catalog.acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
  UNION ALL
  SELECT 'column',c.oid,att.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(att.attacl,'{}'::aclitem[])) a
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
  UNION ALL
  SELECT 'function',p.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE n.nspname='public'
  UNION ALL
  SELECT 'schema',n.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE n.nspname='public'
  UNION ALL
  SELECT 'database',d.oid,0::smallint,a.grantor,a.grantee,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a;
CREATE TEMP TABLE jg_task01_acl_before ON COMMIT DROP AS SELECT * FROM jg_task01_acl_now;

DO $admission$
DECLARE
  plan jsonb := current_setting('app.task01_access_plan')::jsonb;
  runtime_password text := current_setting('app.task01_runtime_password');
  observer_password text := current_setting('app.task01_observer_password');
  role_name text;
  relation record;
  database_name text;
  columns_sql text;
  privilege_name text;
  table_plan jsonb;
  role_plan jsonb;
  expected_columns jsonb;
  signature text;
BEGIN
  IF current_user <> 'jg_task01_owner'
     OR current_database() !~ '^jg_task01_[a-f0-9]{32}$'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba
                    WHERE d.datname=current_database() AND r.rolname=current_user)
     OR runtime_password !~ '^[a-f0-9]{96}$' OR observer_password !~ '^[a-f0-9]{96}$'
     OR runtime_password = observer_password OR plan->>'schemaVersion' <> '1'
     OR plan->'runtime'->>'role' <> 'jg_task01_runtime' OR plan->'observer'->>'role' <> 'jg_task01_observer'
     OR (SELECT count(*) FROM pg_catalog.pg_database) <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname NOT IN (current_database(), 'postgres', 'template0', 'template1'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer')) THEN
    RAISE EXCEPTION 'TASK01_FRESH_CLUSTER_ADMISSION_REJECTED';
  END IF;
  EXECUTE format('CREATE ROLE jg_task01_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1', runtime_password);
  EXECUTE format('CREATE ROLE jg_task01_observer LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1', observer_password);
  ALTER ROLE jg_task01_observer SET default_transaction_read_only = on;
  FOR database_name IN SELECT datname FROM pg_catalog.pg_database LOOP
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC, jg_task01_runtime, jg_task01_observer', database_name);
  END LOOP;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO jg_task01_runtime, jg_task01_observer', current_database());
  REVOKE ALL ON SCHEMA public FROM PUBLIC, jg_task01_runtime, jg_task01_observer;
  GRANT USAGE ON SCHEMA public TO jg_task01_runtime, jg_task01_observer;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, jg_task01_runtime, jg_task01_observer;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, jg_task01_runtime, jg_task01_observer;
  REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, jg_task01_runtime, jg_task01_observer;

  -- Make the column reset explicit before checking the effective column matrix.
  FOR relation IN SELECT c.oid, c.relname FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) INTO columns_sql
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation.oid AND a.attnum>0 AND NOT a.attisdropped;
    IF columns_sql IS NOT NULL THEN
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        EXECUTE format('REVOKE %s (%s) ON TABLE public.%I FROM PUBLIC, jg_task01_runtime, jg_task01_observer', privilege_name, columns_sql, relation.relname);
      END LOOP;
    END IF;
  END LOOP;

  FOR role_plan IN SELECT plan->'runtime' UNION ALL SELECT plan->'observer' LOOP
    role_name := role_plan->>'role';
    FOR table_plan IN SELECT value FROM jsonb_array_elements(role_plan->'tables') LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relname=table_plan->>'table' AND c.relkind IN ('r','p')
                       AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
        RAISE EXCEPTION 'TASK01_TABLE_OR_RLS_REVIEW_REQUIRED';
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['select','insert','update'] LOOP
        expected_columns := coalesce(table_plan->privilege_name, '[]'::jsonb);
        IF jsonb_array_length(expected_columns)>0 THEN
          SELECT string_agg(format('%I', value), ', ') INTO columns_sql FROM jsonb_array_elements_text(expected_columns);
          EXECUTE format('GRANT %s (%s) ON TABLE public.%I TO %I', upper(privilege_name), columns_sql, table_plan->>'table', role_name);
        END IF;
      END LOOP;
    END LOOP;
    FOR signature IN SELECT value FROM jsonb_array_elements_text(role_plan->'functions') LOOP
      -- This object is installed immediately after this transaction, so its
      -- explicit grant and effective verification are in the identity script.
      IF signature = 'public.jg_task01_connection_identity()' THEN CONTINUE; END IF;
      IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'TASK01_FUNCTION_REVIEW_REQUIRED'; END IF;
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', signature, role_name);
    END LOOP;
  END LOOP;
END;
$admission$;

DO $effective$
DECLARE
  plan jsonb := current_setting('app.task01_access_plan')::jsonb;
  role_plan jsonb;
  role_name text;
  object_row record;
  column_row record;
  database_row record;
  permission text;
  expected boolean;
BEGIN
  FOR role_plan IN SELECT plan->'runtime' UNION ALL SELECT plan->'observer' LOOP
    role_name := role_plan->>'role';
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls OR NOT rolcanlogin OR rolconnlimit<>1))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=role_name))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=role_name))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=role_name))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=role_name))
      OR has_schema_privilege(role_name,'public','CREATE') THEN
      RAISE EXCEPTION 'TASK01_EFFECTIVE_ROLE_REJECTED';
    END IF;
    IF NOT has_schema_privilege(role_name,'public','USAGE') THEN RAISE EXCEPTION 'TASK01_SCHEMA_USAGE_MISSING'; END IF;
    FOR database_row IN SELECT oid,datname FROM pg_catalog.pg_database LOOP
      IF has_database_privilege(role_name,database_row.oid,'CREATE,TEMPORARY')
         OR has_database_privilege(role_name,database_row.oid,'CONNECT') IS DISTINCT FROM (database_row.datname=current_database()) THEN
        RAISE EXCEPTION 'TASK01_EFFECTIVE_DATABASE_REJECTED';
      END IF;
    END LOOP;
    FOR object_row IN SELECT c.oid,c.relname,c.relkind FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' LOOP
      IF object_row.relkind IN ('r','p','v','m','f') THEN
        FOREACH permission IN ARRAY ARRAY['DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
          IF has_table_privilege(role_name,object_row.oid,permission) THEN RAISE EXCEPTION 'TASK01_UNEXPECTED_TABLE_CAPABILITY'; END IF;
        END LOOP;
        FOR column_row IN SELECT attnum,attname FROM pg_catalog.pg_attribute
            WHERE attrelid=object_row.oid AND attnum>0 AND NOT attisdropped LOOP
          FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
            SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(role_plan->'tables') t
                           WHERE t->>'table'=object_row.relname
                             AND coalesce(t->lower(permission),'[]'::jsonb) ? column_row.attname) INTO expected;
            IF has_column_privilege(role_name,object_row.oid,column_row.attnum,permission) IS DISTINCT FROM expected THEN
              RAISE EXCEPTION 'TASK01_EFFECTIVE_COLUMN_MATRIX_MISMATCH';
            END IF;
          END LOOP;
        END LOOP;
      ELSIF object_row.relkind='S' AND has_sequence_privilege(role_name,object_row.oid,'USAGE,SELECT,UPDATE') THEN
        RAISE EXCEPTION 'TASK01_UNEXPECTED_SEQUENCE_CAPABILITY';
      END IF;
    END LOOP;
    FOR object_row IN SELECT p.oid FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
      SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_plan->'functions') f
                     WHERE f <> 'public.jg_task01_connection_identity()' AND to_regprocedure(f)=object_row.oid) INTO expected;
      IF has_function_privilege(role_name,object_row.oid,'EXECUTE') IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'TASK01_EFFECTIVE_FUNCTION_MATRIX_MISMATCH';
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jg_task01_acl_now WHERE grantee=0)
     OR EXISTS (SELECT 1 FROM jg_task01_acl_now WHERE is_grantable
                 AND grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_runtime','jg_task01_observer'))) THEN
    RAISE EXCEPTION 'TASK01_PUBLIC_OR_GRANT_OPTION_REJECTED';
  END IF;
  -- PUBLIC removal and the two new roles are intentional. The two implicit
  -- owner identities remain trusted; every other direct grantee must be intact.
  IF EXISTS (
    (SELECT * FROM jg_task01_acl_before WHERE grantee<>0 AND grantee NOT IN
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_owner','pg_database_owner','jg_task01_runtime','jg_task01_observer'))
     EXCEPT
     SELECT * FROM jg_task01_acl_now WHERE grantee<>0 AND grantee NOT IN
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_owner','pg_database_owner','jg_task01_runtime','jg_task01_observer')))
    UNION ALL
    (SELECT * FROM jg_task01_acl_now WHERE grantee<>0 AND grantee NOT IN
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_owner','pg_database_owner','jg_task01_runtime','jg_task01_observer'))
     EXCEPT
     SELECT * FROM jg_task01_acl_before WHERE grantee<>0 AND grantee NOT IN
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_owner','pg_database_owner','jg_task01_runtime','jg_task01_observer')))
  ) THEN RAISE EXCEPTION 'TASK01_UNRELATED_ACL_DELTA_REJECTED'; END IF;
END;
$effective$;
SELECT json_build_object(
  'status','effective-acl-verified-before-commit',
  'scope','initial-explicit-upper-bound-not-minimal',
  'before',(SELECT coalesce(json_agg(row_to_json(a) ORDER BY kind,object_oid,column_number,grantor,grantee,privilege_type,is_grantable),'[]'::json) FROM jg_task01_acl_before a),
  'after',(SELECT coalesce(json_agg(row_to_json(a) ORDER BY kind,object_oid,column_number,grantor,grantee,privilege_type,is_grantable),'[]'::json) FROM jg_task01_acl_now a),
  'roles',(SELECT json_agg(row_to_json(r)) FROM (
    SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit
      FROM pg_catalog.pg_roles WHERE rolname IN ('jg_task01_owner','jg_task01_runtime','jg_task01_observer') ORDER BY rolname) r),
  'relations',(SELECT json_agg(row_to_json(r)) FROM (
    SELECT c.oid,c.relname,c.relkind,c.relowner,
      (SELECT json_agg(json_build_object('number',a.attnum,'name',a.attname) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.oid) r),
  'functions',(SELECT json_agg(row_to_json(f)) FROM (
    SELECT p.oid,p.proname,p.proowner,p.prosecdef,p.proconfig,pg_catalog.oidvectortypes(p.proargtypes) AS argument_types
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid) f)
);
COMMIT;
