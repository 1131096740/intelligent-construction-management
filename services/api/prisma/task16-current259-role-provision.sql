WITH catalog_roles AS (
 SELECT r.*, r.xmin::text AS role_xmin, CASE WHEN rolpassword IS NULL THEN 'absent'
   WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram' ELSE 'other' END AS password_kind
 FROM pg_authid r
), role_rows AS (
 SELECT oid,rolname, jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'limit',rolconnlimit,
 'password',password_kind,'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'inherit',rolinherit,
 'replication',rolreplication,'bypassRls',rolbypassrls,'unlimitedValidity',rolvaliduntil IS NULL) AS row,role_xmin
 FROM catalog_roles
), dedicated AS (
 SELECT oid,rolname,row,role_xmin FROM role_rows WHERE rolname IN (__NAMES__)
), binding_rows AS (
 __BINDINGS__
), database_rows AS (
 SELECT d.oid,d.datname,d.datdba,coalesce((SELECT jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
 ORDER BY a.grantor,a.grantee,a.privilege_type COLLATE "C",a.is_grantable)
 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb) AS acl
 FROM pg_database d
), state AS (
 SELECT jsonb_build_object(
 'ledger',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)
   ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations),
 'bindings',(SELECT jsonb_agg(b.row ORDER BY b.position) FROM binding_rows b),
 'app',(SELECT row FROM role_rows WHERE oid=__APP_OID__::oid),
 'roles',(SELECT coalesce(jsonb_agg(row||jsonb_build_object('xmin',role_xmin) ORDER BY rolname COLLATE "C"),'[]'::jsonb) FROM dedicated),
 'databases',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',datname,'owner',datdba::text,'acl',acl) ORDER BY datname COLLATE "C") FROM database_rows),
 'settings',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',s.setrole::text,'database',s.setdatabase::text,'config',s.setconfig) ORDER BY s.setrole,s.setdatabase),'[]'::jsonb)
   FROM pg_db_role_setting s JOIN dedicated r ON r.oid=s.setrole),
 'oldRoleSha256',encode(sha256(convert_to(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid)
    FROM pg_authid r WHERE r.rolname NOT IN (__NAMES__)),
   (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole) FROM pg_db_role_setting s WHERE s.setrole NOT IN (SELECT oid FROM dedicated))
 )::text,'UTF8')),'hex'),
 'membershipsSha256',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),'[]'::jsonb)::text,'UTF8')),'hex'),
 'protectedSha256',encode(sha256(convert_to(jsonb_build_array(
   (SELECT jsonb_agg(jsonb_build_array(c.oid::text,c.relowner::text,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
    FROM pg_class c WHERE c.relnamespace=to_regnamespace('public')),
   (SELECT jsonb_agg(jsonb_build_array(a.attrelid::text,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum)
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=to_regnamespace('public') AND a.attnum>0 AND NOT a.attisdropped),
   (SELECT jsonb_agg(jsonb_build_array(p.oid::text,p.proowner::text,p.proacl) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace=to_regnamespace('public')),
   (SELECT jsonb_agg(jsonb_build_array(t.oid::text,t.typowner::text,t.typacl) ORDER BY t.oid) FROM pg_type t WHERE t.typnamespace=to_regnamespace('public')),
   (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname !~ '^pg_(toast|temp)'),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.oid) FROM pg_default_acl a)
 )::text,'UTF8')),'hex'),
 'violations',(
   (SELECT count(*) FROM pg_authid r WHERE r.oid=current_user::regrole::oid AND NOT (r.rolsuper AND r.rolcanlogin))
   +(SELECT count(*) FROM pg_auth_members m WHERE m.member=__APP_OID__::oid OR m.roleid=__APP_OID__::oid
     OR m.member IN (SELECT oid FROM dedicated) OR m.roleid IN (SELECT oid FROM dedicated))
   +(SELECT count(*) FROM role_rows r WHERE (r.oid=__APP_OID__::oid OR r.oid IN (SELECT oid FROM dedicated)) AND has_schema_privilege(r.oid,'public','CREATE'))
   +(SELECT count(*) FROM pg_class c CROSS JOIN dedicated r WHERE c.relnamespace=to_regnamespace('public') AND CASE
     WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'SELECT,USAGE,UPDATE')
     WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END)
 )) AS row
)
SELECT jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,
   'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,
   'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',s.ssl,'clientAddress',host(inet_client_addr()),
   'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port(),'version',current_setting('server_version_num')::integer,
   'encoding',getdatabaseencoding(),'replication',current_setting('session_replication_role')),
 'backend',jsonb_build_object('pid',pg_backend_pid(),'start',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
 'logging',jsonb_build_object('statement',current_setting('log_statement'),'errorStatement',current_setting('log_min_error_statement'),
   'verbosity',current_setting('log_error_verbosity'),'errorParameters',current_setting('log_parameter_max_length_on_error'),
   'duration',current_setting('log_duration'),'minDurationStatement',current_setting('log_min_duration_statement'),
   'transactionSampleRate',current_setting('log_transaction_sample_rate'),'minDurationSample',current_setting('log_min_duration_sample'),
   'debugParse',current_setting('debug_print_parse'),'debugRewritten',current_setting('debug_print_rewritten'),'debugPlan',current_setting('debug_print_plan')),
 'access',(SELECT jsonb_agg(jsonb_build_object('roleOid',r.oid::text,'databaseOid',db.oid::text,
   'connect',has_database_privilege(r.oid,db.oid,'CONNECT'),'temporary',has_database_privilege(r.oid,db.oid,'TEMPORARY'),
   'create',has_database_privilege(r.oid,db.oid,'CREATE')) ORDER BY r.oid,db.oid)
   FROM role_rows r CROSS JOIN database_rows db WHERE r.oid=__APP_OID__::oid OR r.oid IN (SELECT oid FROM dedicated)),
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'writeXid',pg_current_xact_id_if_assigned()::text,'commitStatus',__COMMIT_STATUS__,'state',state.row) AS payload
FROM pg_database d JOIN pg_stat_activity a ON a.datid=d.oid AND a.pid=pg_backend_pid() JOIN pg_stat_ssl s ON s.pid=a.pid CROSS JOIN state
WHERE d.datname=current_database()
