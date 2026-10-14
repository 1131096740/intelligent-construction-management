import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ROLE='jiangkong_backup_reader';
const creators=['jg_pol275_owner','jiangkong','postgres'];
const id=name=>{if(!/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(name))throw Error('unsafe fixed database identity');return '"'+name+'"';};
// This prepares an executable NOLOGIN permission transaction only. Password,
// private connection installation and LOGIN are distinct approved operations.
// It never executes SQL, generates credentials or grants production authority.
export function buildBackupPermissionSql(input){
 const {database,databaseIdentitySha256,helperDefinitionSha256}=input;
 id(database);
 if(!/^[a-f0-9]{64}$/.test(databaseIdentitySha256??'')||!/^[a-f0-9]{64}$/.test(helperDefinitionSha256??'')||[...(input.creators??[])].sort().join(',')!==creators.join(','))throw Error('incomplete fixed permission material');
 const original=readFileSync(new URL('./db-backup-read-role.sql',import.meta.url),'utf8');
 if((original.match(/^BEGIN READ ONLY;$/gm)??[]).length!==1||!original.trimEnd().endsWith('ROLLBACK;'))throw Error('strict backup preflight framing changed');
 const preflight=original.replace(/^BEGIN READ ONLY;\r?\n/m,'').replace(/ROLLBACK;\s*$/,'');
 const identityGuard=`IF current_database()<> '${database}' OR (SELECT encode(sha256(convert_to(system_identifier::text||'|'||current_database()||'|public','UTF8')),'hex') FROM pg_control_system())<>'${databaseIdentitySha256}' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'Fixed backup target mismatch'; END IF;`;
 const helperGuard=`IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.assert_fund_movement_write_context()') AND pg_get_userbyid(proowner)='jiangkong' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='${helperDefinitionSha256}') THEN RAISE EXCEPTION 'Helper definition or owner drift'; END IF;`;
 const defaults=action=>creators.flatMap(owner=>['TABLES','SEQUENCES'].map(kind=>`ALTER DEFAULT PRIVILEGES FOR ROLE ${id(owner)} IN SCHEMA public ${action==='GRANT'?'GRANT SELECT ON '+kind+' TO':'REVOKE SELECT ON '+kind+' FROM'} ${ROLE};`)).join('\n');
 const begin="BEGIN;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='2s';\n";
 const applySql=begin+`DO $guard$ BEGIN
${identityGuard}
${helperGuard}
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}') THEN RAISE EXCEPTION 'Backup role already exists'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.assert_fund_movement_write_context()') AND proacl IS NULL) THEN RAISE EXCEPTION 'Original helper ACL changed'; END IF;
IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','S','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND (n.nspname<>'public' OR pg_get_userbyid(c.relowner) NOT IN ('jiangkong','jg_pol275_owner','postgres'))) THEN RAISE EXCEPTION 'Unknown object creator or schema'; END IF;
IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_(toast|temp)') THEN RAISE EXCEPTION 'Unknown user schema requires separate permission review'; END IF;
END $guard$;
CREATE ROLE ${ROLE} NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE EXECUTE ON FUNCTION public.assert_fund_movement_write_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_fund_movement_write_context() TO jiangkong_runtime;
GRANT CONNECT ON DATABASE ${id(database)} TO ${ROLE};
GRANT USAGE ON SCHEMA public TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE};
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};
${defaults('GRANT')}
SET LOCAL ROLE ${ROLE};
${preflight}
RESET ROLE;
COMMIT;
`;
 const inspectSql=`BEGIN READ ONLY; SELECT json_build_object('roleOid',oid::bigint,'loginEnabled',rolcanlogin,'superuser',rolsuper,'createsRoles',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname='${ROLE}'; ROLLBACK;`;
 const rollbackSql=roleOid=>{
  if(!Number.isSafeInteger(roleOid)||roleOid<1||roleOid>4294967295)throw Error('recorded new role OID required');
  return begin+`DO $guard$ BEGIN
${identityGuard}
${helperGuard}
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}' AND oid=${roleOid}) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}' AND oid<>${roleOid}) THEN RAISE EXCEPTION 'Owned role identity drift'; END IF;
IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=${roleOid} OR member=${roleOid}) THEN RAISE EXCEPTION 'Unexpected membership'; END IF;
IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.assert_fund_movement_write_context()'))<>2 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.assert_fund_movement_write_context()') AND (pg_get_userbyid(a.grantee) NOT IN ('jiangkong','jiangkong_runtime') OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN RAISE EXCEPTION 'Helper after ACL drift'; END IF;
END $guard$;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM ${ROLE};
REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE};
${defaults('REVOKE')}
REVOKE USAGE ON SCHEMA public FROM ${ROLE};
REVOKE CONNECT ON DATABASE ${id(database)} FROM ${ROLE};
DROP ROLE ${ROLE};
GRANT EXECUTE ON FUNCTION public.assert_fund_movement_write_context() TO PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_fund_movement_write_context() FROM jiangkong_runtime;
COMMIT;
`;
 };
 return {applySql,inspectSql,rollbackSql,readGuardSha256:createHash('sha256').update(original).digest('hex'),credentialsGenerated:false,productionApplied:false,loginEnabled:false};
}
