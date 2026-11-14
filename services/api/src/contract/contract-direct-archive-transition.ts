import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

type CatalogRecord = Record<string, unknown>;
const guardBodySha256 = "88713aea758f69f6a42d6bd1329cdeeab386f1e535ac1dc69a59e3eac24f93a3";
const identityFields = ["applicationRoleOid", "fileCallerOids", "databaseOid", "anchorNamespaceOid", "anchorOwnerOid"] as const;
const predecessorFields = ["pendingRelationOid", "reviewRelationOid", "pendingSha256", "reviewSha256"] as const;

function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
}

function unavailable(): never {
  throw new ServiceUnavailableException("直签登记资格尚未完整核对，请保留原件稍后办理");
}

/** An explicit empty catalog observation is the only path to the old profile. */
export async function readDirectArchiveTransitionOid(tx: Prisma.TransactionClient): Promise<string | null> {
  try {
    const rows = await tx.$queryRaw<Array<{ relationOid: string | null; guardRoutineCount: number }>>(Prisma.sql`
      /* contract_direct_archive_transition_probe */
      SELECT c.oid::text AS "relationOid",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p
          WHERE p.pronamespace=n.oid AND p.proname='jg_contract_direct_archive_binding_guard_v1') AS "guardRoutineCount"
      FROM pg_catalog.pg_namespace n
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname='jg_contract_direct_archive_binding_v1'
      WHERE n.nspname='public'
    `);
    const row = rows.length === 1 ? rows[0] : null;
    if (row?.relationOid === null && row.guardRoutineCount === 0) return null;
    if (row && oid(row.relationOid) && row.guardRoutineCount === 1) return row.relationOid;
  } catch {
    unavailable();
  }
  unavailable();
}

/** This profile extends observation only. Its old guards still forbid registration. */
export async function readPreparedDirectArchiveTransition(tx: Prisma.TransactionClient, relationOid: string,
  pendingExpected: CatalogRecord, pendingCatalog: CatalogRecord) {
  try {
    const rows = await tx.$queryRaw<Array<{ binding: CatalogRecord; actual: CatalogRecord }>>(Prisma.sql`
      /* contract_direct_archive_transition_binding */
      WITH registry AS (
        SELECT b.*, b.tableoid AS "registryOid" FROM public.jg_contract_direct_archive_binding_v1 b
      ), pending AS (
        SELECT p.*, p.tableoid AS "relationOid", pg_catalog.encode(public.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS "sha"
        FROM public.jg_contract_direct_pending_binding_v1 p WHERE p."protocolVersion"=1
      ), review AS (
        SELECT r.*, r.tableoid AS "relationOid", pg_catalog.encode(public.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS "sha"
        FROM public.jg_contract_direct_review_retention_binding_v1 r WHERE r."protocolVersion"=1
      ), reachable AS (
        SELECT oid, rolsuper, rolcreaterole, rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles WHERE pg_catalog.pg_has_role(current_user::pg_catalog.regrole::oid,oid,'MEMBER')
      )
      SELECT pg_catalog.jsonb_build_object(
        'protocolVersion',b."protocolVersion",'recipeVersion',b."recipeVersion",
        'applicationRoleOid',b."applicationRoleOid"::text,'fileCallerOids',ARRAY(SELECT caller::text FROM unnest(b."fileCallerOids") AS f(caller) ORDER BY caller),
        'databaseOid',b."databaseOid"::text,'anchorNamespaceOid',b."anchorNamespaceOid"::text,'anchorOwnerOid',b."anchorOwnerOid"::text,
        'pendingRelationOid',b."pendingRelationOid"::text,'reviewRelationOid',b."reviewRelationOid"::text,'pendingSha256',b."pendingSha256",'reviewSha256',b."reviewSha256"
      ) AS binding,
      pg_catalog.jsonb_build_object(
        'applicationRoleOid',p."applicationRoleOid"::text,'fileCallerOids',ARRAY(SELECT caller::text FROM unnest(p."fileCallerOids") AS f(caller) ORDER BY caller),
        'databaseOid',db.oid::text,'anchorNamespaceOid',c.relnamespace::text,'anchorOwnerOid',c.relowner::text,
        'pendingRelationOid',p."relationOid"::text,'reviewRelationOid',r."relationOid"::text,'pendingSha256',p."sha",'reviewSha256',r."sha",
        'relationOid',c.oid::text,'guardRoutineOid',g.oid::text,
        'guardBodySha256',pg_catalog.encode(public.digest(pg_catalog.convert_to(g.prosrc,'UTF8'),'sha256'),'hex'),
        'currentRoleOid',current_user::pg_catalog.regrole::oid::text,'sessionRoleOid',session_user::pg_catalog.regrole::oid::text,
        'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text,
        'catalogCompatible',p."applicationRoleOid"=r."applicationRoleOid" AND p."databaseOid"=r."databaseOid" AND p."databaseOid"=db.oid
          AND p."anchorOwnerOid"=r."anchorOwnerOid" AND p."anchorOwnerOid"=c.relowner
          AND c.relnamespace=p."anchorNamespaceOid" AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
          AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
              AND a.attgenerated='' AND a.attidentity='')=ARRAY['protocolVersion:23','recipeVersion:25','applicationRoleOid:26','fileCallerOids:1028',
                'databaseOid:26','anchorNamespaceOid:26','anchorOwnerOid:26','pendingRelationOid:26','reviewRelationOid:26','pendingSha256:25','reviewSha256:25']
          AND 11=(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
          AND 1=(SELECT count(*) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1]::smallint[]
            AND k.convalidated AND NOT k.condeferrable AND EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=k.conindid AND i.indisvalid AND i.indisready))
          AND g.pronamespace=c.relnamespace AND g.proowner=c.relowner AND NOT g.prosecdef
          AND g.prorettype='pg_catalog.trigger'::pg_catalog.regtype::oid AND l.lanname='plpgsql'
          AND g.provolatile='v' AND g.proparallel='u' AND NOT g.proisstrict AND NOT g.proretset AND g.pronargs=0
          AND g.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
          AND 1=(SELECT count(*) FROM pg_catalog.pg_proc p2 WHERE p2.pronamespace=c.relnamespace AND p2.proname=g.proname)
          AND 2=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid OR t.tgfoid=g.oid)
          AND 2=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND t.tgfoid=g.oid AND t.tgenabled='O'
            AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
            AND ((t.tgname='jg_direct_archive_binding_immutable' AND t.tgtype=31) OR (t.tgname='jg_direct_archive_binding_no_truncate' AND t.tgtype=34)))
          AND pg_catalog.current_setting('session_replication_role')='origin',
        'callerReadOnly',pg_catalog.has_table_privilege(current_user::pg_catalog.regrole::oid,c.oid,'SELECT')
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee=0)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee=0)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(g.proacl,pg_catalog.acldefault('f',g.proowner))) a WHERE a.grantee=0)
          AND NOT EXISTS(SELECT 1 FROM reachable x WHERE x.rolsuper OR x.rolcreaterole OR x.rolreplication OR x.rolbypassrls
            OR x.oid IN (c.relowner,g.proowner) OR pg_catalog.has_schema_privilege(x.oid,c.relnamespace,'CREATE')
            OR pg_catalog.has_table_privilege(x.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION')
            OR pg_catalog.has_any_column_privilege(x.oid,c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
            OR pg_catalog.has_function_privilege(x.oid,g.oid,'EXECUTE'))
      ) AS actual
      FROM registry b CROSS JOIN pending p CROSS JOIN review r
      JOIN pg_catalog.pg_class c ON c.oid=b."registryOid"
      JOIN pg_catalog.pg_proc g ON g.oid=pg_catalog.to_regprocedure('public.jg_contract_direct_archive_binding_guard_v1()')
      JOIN pg_catalog.pg_language l ON l.oid=g.prolang
      JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
    `);
    const row = rows.length === 1 ? rows[0] : null;
    const binding = row?.binding, actual = row?.actual;
    if (!binding || !actual || binding.protocolVersion !== 1 || binding.recipeVersion !== "contract-direct-archive-preparation-v1/1"
      || actual.relationOid !== relationOid || !oid(actual.guardRoutineOid) || actual.guardBodySha256 !== guardBodySha256
      || actual.catalogCompatible !== true || actual.callerReadOnly !== true
      || actual.currentRoleOid !== pendingCatalog.currentRoleOid || actual.sessionRoleOid !== pendingCatalog.sessionRoleOid
      || actual.backendPid !== pendingCatalog.backendPid || actual.transactionId !== pendingCatalog.transactionId
      || !identityFields.every(field => isDeepStrictEqual(binding[field], pendingExpected[field]) && isDeepStrictEqual(actual[field], binding[field]))
      || !predecessorFields.every(field => actual[field] === binding[field])
      || binding.pendingRelationOid !== pendingCatalog.bindingRelationOid || !oid(binding.reviewRelationOid)
      || ![binding.pendingSha256, binding.reviewSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))) unavailable();
    return { binding, actual };
  } catch {
    unavailable();
  }
}
