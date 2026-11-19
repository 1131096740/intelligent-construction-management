import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { readDirectArchiveNativeAdmission } from "./contract-direct-archive-native-admission";
import { DIRECT_PENDING_DB_RECIPE } from "./contract-direct-pending-recipe";

type Catalog = Record<string, unknown>;
type Native = NonNullable<Awaited<ReturnType<typeof readDirectArchiveNativeAdmission>>>;
type ExecuteGrant = [string,string,"EXECUTE",boolean];

const registry = "public.jg_file_business_binding_columns()";
const registeredAlias = "public.jg_file_business_binding_columns_before_registered_payment()";
const collisionSignatures = DIRECT_PENDING_DB_RECIPE.routines.map(row => row.signature).filter(signature =>
  signature.startsWith("public.jg_file_business_binding_columns") || [
    "public.jg_file_business_collision_columns()",
    "public.jg_has_exclusive_file_business_binding(pg_catalog.text)",
    "public.jg_enforce_exclusive_file_business_binding()"
  ].includes(signature)
);
const record = (value: unknown): Catalog | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Catalog : null;
const oid = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value)<=4294967295;

function executeGrants(value: unknown): value is ExecuteGrant[] {
  return Array.isArray(value) && value.length>0 && value.every(row => Array.isArray(row) && row.length===4
    && oid(row[0]) && oid(row[1]) && row[2]==="EXECUTE" && typeof row[3]==="boolean");
}

/** Keep the installed 205 ACL as history. Any drift needs the entire exact 237 executor grant set. */
export async function projectCollisionExecuteAcls(
  tx: Prisma.TransactionClient, actual: Catalog, original: Catalog, bootstrap: Catalog, native: Native | null
): Promise<Catalog | null> {
  const routines = record(actual.routines);
  const alias = record(record(actual.registeredFileBinding)?.alias);
  if (!routines || collisionSignatures.length!==24) return null;
  const observed = collisionSignatures.map(signature => ({
    signature, currentSignature: signature===registry && alias ? registeredAlias : signature,
    current: signature===registry && alias ? alias : record(routines[signature]),
    historical: record(original[signature])
  }));
  const changed = observed.filter(row => !isDeepStrictEqual(row.current?.acl,row.historical?.acl));
  if (changed.length===0) return {};
  if (changed.length!==24 || !native || native.executorOwnerOid===native.ownerOid || native.executorOwnerOid===native.currentRoleOid
    || observed.some(({current,historical}) => !current || !historical || !oid(historical.oid) || current.oid!==historical.oid
      || current.ownerOid!==native.ownerOid || historical.ownerOid!==native.ownerOid
      || current.namespaceOid!==native.namespaceOid || historical.namespaceOid!==native.namespaceOid
      || !Array.isArray(current.acl) || !Array.isArray(historical.acl))
    || new Set(observed.map(row => row.historical?.oid)).size!==24) return null;

  const requested = observed.map(({signature,currentSignature}) => ({ signature,currentSignature }));
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    /* contract_direct_pending_collision_execute_overlay_v1 */
    WITH wanted AS (
      SELECT signature,"currentSignature" FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
        AS w(signature text,"currentSignature" text)
    ), bound AS (
      SELECT p."bindings"->'routines' AS routines,p."anchorOwnerOid" AS owner,p."databaseOid" AS database,
        p."anchorNamespaceOid" AS namespace,r.oid AS executor,
        NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
          AND r.oid<>ALL(p."fileCallerOids") AND r.oid NOT IN (p."anchorOwnerOid",p."applicationRoleOid")
          AND NOT pg_catalog.has_schema_privilege(r.oid,p."anchorNamespaceOid",'CREATE')
          AND pg_catalog.pg_has_role(p."anchorOwnerOid",r.oid,'USAGE')
          AND pg_catalog.pg_has_role(p."anchorOwnerOid",r.oid,'SET')
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
            AND (pg_catalog.pg_has_role(r.oid,other.oid,'MEMBER') OR (NOT other.rolsuper AND other.oid<>p."anchorOwnerOid"
              AND pg_catalog.pg_has_role(other.oid,r.oid,'MEMBER')))) AS role_qualified
      FROM public.jg_contract_direct_pending_binding_v1 p
      JOIN pg_catalog.pg_database d ON d.oid=p."databaseOid" AND d.datname=pg_catalog.current_database()
        AND d.datdba=p."anchorOwnerOid"
      JOIN pg_catalog.pg_roles r ON r.oid=${native.executorOwnerOid}::oid
      WHERE p."protocolVersion"=1 AND p."recipeVersion"='contract-direct-pending-input-v1/1'
        AND p.tableoid=${bootstrap.bindingRelationOid}::oid AND p."anchorNamespaceOid"=pg_catalog.to_regnamespace('public')
        AND p."applicationRoleOid"=current_user::regrole::oid AND current_user=session_user
        AND pg_catalog.current_setting('session_replication_role')='origin'
    )
    SELECT jsonb_build_object('databaseOid',b.database::text,'ownerOid',b.owner::text,'namespaceOid',b.namespace::text,
      'currentRoleOid',current_user::regrole::oid::text,'sessionRoleOid',session_user::regrole::oid::text,
      'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text,
      'executorOid',b.executor::text,'roleQualified',b.role_qualified,
      'routines',(SELECT jsonb_agg(jsonb_build_object('signature',w.signature,'oid',p.oid::text,
        'historicalRawAcl',old.raw_acl,'liveRawAcl',p.proacl,
        'historicalAcl',(SELECT jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable))
          FROM pg_catalog.aclexplode(CASE WHEN cardinality(old.acl)>0 THEN old.acl END) a),
        'liveAcl',(SELECT jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable))
          FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a),
        'historicalDenied',EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(old.acl)>0 THEN old.acl END) a
          WHERE a.grantee IN (0,b.executor) OR a.grantor=b.executor OR a.grantee IN (
            SELECT role.oid FROM pg_catalog.pg_roles role WHERE role.rolname IN ('jg_task01_runtime','jg_task01_observer'))),
        'executable',pg_catalog.has_function_privilege(b.executor,p.oid,'EXECUTE')) ORDER BY w.signature)
        FROM wanted w JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(w."currentSignature")
          AND p.pronamespace=b.namespace AND p.proowner=b.owner AND NOT p.prosecdef AND p.prokind='f'
          AND p.oid::text=b.routines->w.signature->>'oid'
        CROSS JOIN LATERAL (SELECT b.routines->w.signature->'acl' AS raw_acl,
          ARRAY(SELECT raw::aclitem FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(b.routines->w.signature->'acl')='array' THEN b.routines->w.signature->'acl'
            ELSE '[]'::jsonb END) AS entry(raw)) AS acl) old)) AS proof
    FROM bound b
  `);
  const proof = rows.length===1 ? record(record(rows[0])?.proof) : null;
  if (!proof || proof.roleQualified!==true || proof.executorOid!==native.executorOwnerOid
    || !["databaseOid","ownerOid","namespaceOid","currentRoleOid","sessionRoleOid","backendPid","transactionId"]
      .every(key => proof[key]===native[key as keyof Native])
    || !Array.isArray(proof.routines) || proof.routines.length!==24) return null;
  const bySignature = new Map(proof.routines.map(raw => {
    const row = record(raw);
    return [row?.signature,row];
  }));
  const extra: ExecuteGrant = [native.ownerOid,native.executorOwnerOid,"EXECUTE",false];
  const ordered = (acl: ExecuteGrant[]) => acl.map(row => JSON.stringify(row)).sort();
  for (const {signature,current,historical} of observed) {
    const row = bySignature.get(signature);
    if (!row || row.oid!==historical?.oid || row.historicalDenied!==false || row.executable!==true
      || !isDeepStrictEqual(row.historicalRawAcl,historical?.acl) || !isDeepStrictEqual(row.liveRawAcl,current?.acl)
      || !executeGrants(row.historicalAcl) || !executeGrants(row.liveAcl)
      || row.historicalAcl.some(grant => grant[0]===native.executorOwnerOid || grant[1]===native.executorOwnerOid)
      || !isDeepStrictEqual(ordered(row.liveAcl),ordered([...row.historicalAcl,extra]))) return null;
  }
  return Object.fromEntries(observed.map(({signature,historical}) => [signature,historical?.acl]));
}
