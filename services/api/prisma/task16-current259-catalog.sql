-- Fixed current259 owner catalog projection. Caller executes through its owned resource.
WITH cfg AS (SELECT __CONFIG__::jsonb AS p),
roles AS (SELECT r.* FROM pg_catalog.pg_roles r,cfg WHERE r.oid IN
 ((p->'identity'->>'ownerOid')::oid,(p->'identity'->>'runtimeOid')::oid,(p->'identity'->>'observerOid')::oid)),
restricted AS (SELECT r.*,v.plan FROM roles r,cfg CROSS JOIN LATERAL
 (VALUES(p->'runtime'),(p->'observer')) v(plan) WHERE r.rolname=v.plan->>'role'),
capabilities AS (
 SELECT r.rolname::text AS role,'column'::text AS kind,c.relname::text AS object,a.attname::text AS member,
  op.privilege,pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,op.privilege||' WITH GRANT OPTION') AS grantable
 FROM restricted r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) op(privilege)
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
  AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,op.privilege)
 UNION ALL
 SELECT r.rolname,'table',c.relname,'',op.privilege,
  pg_catalog.has_table_privilege(r.oid,c.oid,op.privilege||' WITH GRANT OPTION')
 FROM restricted r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES'),('DELETE'),('TRUNCATE'),('TRIGGER')) op(privilege)
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND pg_catalog.has_table_privilege(r.oid,c.oid,op.privilege)
 UNION ALL
 SELECT r.rolname,'sequence',c.relname,'',op.privilege,
  pg_catalog.has_sequence_privilege(r.oid,c.oid,op.privilege||' WITH GRANT OPTION')
 FROM restricted r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN (VALUES('USAGE'),('SELECT'),('UPDATE')) op(privilege)
 WHERE n.nspname='public' AND c.relkind='S' AND pg_catalog.has_sequence_privilege(r.oid,c.oid,op.privilege)
),
other_acl AS (
 SELECT 'relation' AS kind,c.oid::text AS object,'0' AS member,a.*
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault(
  (CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
 UNION ALL
 SELECT 'column',c.oid::text,t.attnum::text,a.* FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute t ON t.attrelid=c.oid AND t.attnum>0 AND NOT t.attisdropped
 CROSS JOIN LATERAL pg_catalog.aclexplode(t.attacl) a WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'function',f.oid::text,'0',a.* FROM pg_catalog.pg_proc f
 JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a,cfg
 WHERE n.nspname='public' AND f.oid IS DISTINCT FROM pg_catalog.to_regprocedure(p->>'readerSignature')
 UNION ALL
 SELECT 'type',t.oid::text,'0',a.* FROM pg_catalog.pg_type t
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))) a
 WHERE t.oid IN ('public."OperatingLedgerFactWritePayloadV2"'::regtype,'public."OperatingLedgerImpactWritePayloadV2"'::regtype)
 UNION ALL
 SELECT 'schema',n.oid::text,'0',a.* FROM pg_catalog.pg_namespace n
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'database',d.oid::text,'0',a.* FROM pg_catalog.pg_database d
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
),
reader AS (SELECT f.*,f.xmin AS catalog_xmin,l.lanname FROM pg_catalog.pg_proc f
 JOIN pg_catalog.pg_language l ON l.oid=f.prolang,cfg WHERE f.oid=pg_catalog.to_regprocedure(p->>'readerSignature'))
SELECT pg_catalog.jsonb_build_object(
 'phase',p->>'phase','nonce',p->>'nonce','sourceSha',p->>'sourceSha','sealSha256',p->>'sealSha256',
 'schemaSha256',p->>'schemaSha256',
 'identity',pg_catalog.jsonb_build_object('database',pg_catalog.current_database(),'databaseOid',d.oid::text,
  'namespaceOid',pg_catalog.to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,
  'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'currentRole',current_user,'sessionRole',session_user,'backendPid',pg_catalog.pg_backend_pid(),
  'backendStart',pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'tls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=a.pid),false),
  'version',pg_catalog.current_setting('server_version_num')::integer,
  'replication',pg_catalog.current_setting('session_replication_role'),
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on'),
 'ledger',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',migration_name,
   'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)
   ORDER BY migration_name COLLATE "C"),'[]'::jsonb) FROM public._prisma_migrations),
 'roles',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',r.oid::text,'name',r.rolname,
   'superuser',r.rolsuper,'inherit',r.rolinherit,'canLogin',r.rolcanlogin,'createRole',r.rolcreaterole,
   'createDb',r.rolcreatedb,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,
   'memberships',(SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid),
   'createSchema',pg_catalog.has_schema_privilege(r.oid,'public','CREATE'),
   'usageSchema',pg_catalog.has_schema_privilege(r.oid,'public','USAGE'),
   'connectDatabase',pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT'),
   'createDatabaseSchema',pg_catalog.has_database_privilege(r.oid,d.oid,'CREATE'),
   'temporary',pg_catalog.has_database_privilege(r.oid,d.oid,'TEMP'),
   'otherDatabases',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(db.oid::text,op.name)
     ORDER BY db.oid,op.name),'[]'::jsonb) FROM pg_catalog.pg_database db
     CROSS JOIN (VALUES('CONNECT'),('CREATE'),('TEMP')) op(name)
     WHERE db.oid<>d.oid AND pg_catalog.has_database_privilege(r.oid,db.oid,op.name)),
   'readOnlyDefault',(SELECT coalesce((SELECT value='default_transaction_read_only=on'
      FROM pg_catalog.pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) value
      WHERE s.setrole=r.oid AND s.setdatabase IN (0,d.oid)
       AND value LIKE 'default_transaction_read_only=%' ORDER BY s.setdatabase DESC LIMIT 1),false)))
   ORDER BY r.rolname COLLATE "C"),'[]'::jsonb) FROM roles r),
 'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',x.item->>'table',
   'oid',c.oid::text,'owner',r.rolname,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity)
   ORDER BY (x.item->>'table') COLLATE "C") FROM pg_catalog.jsonb_array_elements(p->'relations') x(item)
   LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',x.item->>'table'))
   LEFT JOIN pg_catalog.pg_roles r ON r.oid=c.relowner),
 'readerColumns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.col->>0,x.col->>1,
   ns.nspname,t.typname,a.attnotnull) ORDER BY (x.col->>0) COLLATE "C",(x.col->>1) COLLATE "C")
   FROM pg_catalog.jsonb_array_elements(p->'readerColumns') x(col)
   LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',x.col->>0))
   LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=x.col->>1 AND a.attnum>0 AND NOT a.attisdropped
   LEFT JOIN pg_catalog.pg_type t ON t.oid=a.atttypid LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid=t.typnamespace),
 'publicAclViolations',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(kind,object,member,
   grantor::text,grantee::text,privilege_type,is_grantable) ORDER BY kind,object,member,grantor,privilege_type),'[]'::jsonb)
   FROM other_acl WHERE grantee=0),
 'capabilities',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(role,kind,object,member,privilege,grantable)
   ORDER BY role COLLATE "C",kind COLLATE "C",object COLLATE "C",member COLLATE "C",privilege COLLATE "C"),'[]'::jsonb) FROM capabilities),
 'functions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.rolname,s.signature,
   pg_catalog.to_regprocedure(s.signature)::oid::text,
   coalesce(pg_catalog.has_function_privilege(r.oid,pg_catalog.to_regprocedure(s.signature),'EXECUTE'),false),
   coalesce(pg_catalog.has_function_privilege(r.oid,pg_catalog.to_regprocedure(s.signature),'EXECUTE WITH GRANT OPTION'),false))
   ORDER BY r.rolname COLLATE "C",s.signature COLLATE "C"),'[]'::jsonb)
   FROM restricted r CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(r.plan->'functions') s(signature)),
 'guardsVerified',(__GUARDS__),
 'extraFunctions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.rolname,f.oid::text)
   ORDER BY r.rolname COLLATE "C",f.oid),'[]'::jsonb) FROM restricted r CROSS JOIN pg_catalog.pg_proc f
   WHERE f.pronamespace=pg_catalog.to_regnamespace('public') AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')
    AND NOT EXISTS(SELECT FROM pg_catalog.jsonb_array_elements_text(r.plan->'functions') s(signature)
      WHERE f.oid=pg_catalog.to_regprocedure(s.signature))),
 'otherAclSha256',(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(kind,object,member,grantor::text,grantee::text,privilege_type,is_grantable)
   ORDER BY kind,object,member,grantor,grantee,privilege_type)::text,'[]'),'UTF8')),'hex') FROM other_acl),
 'writeXid',pg_catalog.pg_current_xact_id_if_assigned()::text,
 'commitStatus',CASE WHEN p->>'phase'='committed' THEN pg_catalog.pg_xact_status((p->>'installXid')::xid8) END,
 'reader',(SELECT pg_catalog.jsonb_build_object('oid',r.oid::text,'ownerOid',r.proowner::text,
   'namespaceOid',r.pronamespace::text,'kind',r.prokind,'language',r.lanname,'definer',r.prosecdef,
   'volatility',r.provolatile,'parallel',r.proparallel,'leakproof',r.proleakproof,'strict',r.proisstrict,
   'returnsSet',r.proretset,'resultType',r.prorettype::regtype::text,'inputCount',r.pronargs,
   'defaults',r.pronargdefaults,'variadic',r.provariadic::text,'support',r.prosupport::oid::text,
   'names',r.proargnames,'modes',r.proargmodes::text[],
   'types',ARRAY(SELECT t::regtype::text FROM unnest(r.proallargtypes) WITH ORDINALITY x(t,n) ORDER BY n),
   'config',r.proconfig,'bodySha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(r.prosrc,'UTF8')),'hex'),
   'xmin',r.catalog_xmin::text,'acl',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
     g.grantor::text,g.grantee::text,g.privilege_type,g.is_grantable) ORDER BY g.grantee,g.grantor,g.privilege_type)
     FROM pg_catalog.aclexplode(coalesce(r.proacl,pg_catalog.acldefault('f',r.proowner))) g)) FROM reader r)
) AS result
FROM cfg CROSS JOIN pg_catalog.pg_database d JOIN pg_catalog.pg_stat_activity a ON a.datid=d.oid
WHERE d.datname=pg_catalog.current_database() AND a.pid=pg_catalog.pg_backend_pid();
