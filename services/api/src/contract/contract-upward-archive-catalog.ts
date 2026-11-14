import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UPWARD_PROJECTION_SOURCE_SHA256, UPWARD_SOURCE_DEFINERS } from "./contract-upward-direct-source-pins";

type Row = Record<string, unknown>;
type SqlClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type UpwardLegacyProjection = Readonly<{
  databaseOid: string; namespaceOid: string; anchorOwnerOid: string; currentRoleOid: string; sessionRoleOid: string;
  backendPid: number; transactionId: string; sourceClosureSha256: string;
  routines: readonly Readonly<{ signature: string; oid: string; ownerOid: string; namespaceOid: string; beforeSha256: string; afterSha256: string }>[];
  constraint: Readonly<{ beforeOid: string; afterOid: string; beforeSha256: string; afterSha256: string }>;
  definers: readonly Readonly<{ signature: string; oid: string; bodySha256: string }>[];
}>;
function row(value: unknown): Row | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }
function oid(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 4294967295n; }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function unavailable(): never { throw new ServiceUnavailableException("对上登记后继资格或原有来源接线已变化，请保留资料稍后办理"); }
const signatures = [
  'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")',
  "public.jg_check_contract_upward_pending_save_v1()", "public.jg_guard_generated_upward_seal_completion_v1()",
  'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")', "public.jg_guard_contract_direct_archive_slot_v1()",
  "public.jg_contract_archive_v2_complete_guard()", "public.jg_require_contract_direct_archive_complete_v1()",
  "public.jg_require_contract_direct_archive_generations_v1()", "public.jg_contract_archive_v2_ownership_day(text)",
  "public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)",
  "public.jg_check_contract_direct_upward_issuer_v2()",
  "public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)"
] as const;

/** Old 256 has neither object. Probe only pg_catalog before naming a new callable.
 * Dormant private source also leaves independent old qualification in charge;
 * an installed but corrupt projection cannot turn into an old-source success. */
export async function discoverUpwardLegacyProjection(tx: SqlClient): Promise<UpwardLegacyProjection | null> {
  const probes = await tx.$queryRaw<Row[]>(Prisma.sql`
    /* contract_upward_archive_projection_probe_v2 */
    WITH observed AS (
      SELECT d.oid::text AS "databaseOid",n.oid::text AS "namespaceOid",d.datdba::text AS "anchorOwnerOid",
        current_user::regrole::oid::text AS "currentRoleOid",session_user::regrole::oid::text AS "sessionRoleOid",
        pg_backend_pid() AS "backendPid",txid_current()::text AS "transactionId",p.oid::text AS "projectionOid",
        to_regclass('public.jg_contract_direct_upward_closure_v2')::oid::text AS "closureOid",
        p.proowner=d.datdba AND p.pronamespace=n.oid AND p.prokind='f' AND p.prosecdef
          AND p.provolatile='v' AND p.proparallel='u' AND NOT(p.proisstrict OR p.proretset OR p.proleakproof)
          AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
          AND l.lanname='plpgsql' AND p.prorettype='pg_catalog.jsonb'::regtype
          AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
          AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=${UPWARD_PROJECTION_SOURCE_SHA256}
          AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'
              OR a.grantee NOT IN(p.proowner,current_user::regrole::oid) OR a.grantee<>p.proowner AND a.is_grantable)
          AS exact,
        has_function_privilege(current_user,p.oid,'EXECUTE') AS executable
      FROM pg_catalog.pg_database d JOIN pg_catalog.pg_namespace n ON n.nspname='public'
      LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()')
      LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE d.datname=current_database()
    ) SELECT *,CASE WHEN "projectionOid" IS NULL AND "closureOid" IS NULL THEN 'absent'
      WHEN exact AND NOT executable THEN 'dormant' WHEN exact AND executable AND current_user=session_user THEN 'qualified'
      ELSE 'invalid' END AS status FROM observed
  `);
  const probe = probes.length === 1 ? probes[0] : null;
  if (!probe) unavailable();
  if (probe.status === "absent" && probe.projectionOid === null && probe.closureOid === null) return null;
  if (probe.status === "dormant" && oid(probe.projectionOid) && oid(probe.closureOid)) return null;
  if (probe.status !== "qualified" || !["databaseOid", "namespaceOid", "anchorOwnerOid", "currentRoleOid", "sessionRoleOid", "projectionOid", "closureOid"]
    .every(key => oid(probe[key])) || probe.currentRoleOid !== probe.sessionRoleOid || probe.currentRoleOid === probe.anchorOwnerOid
    || !Number.isSafeInteger(probe.backendPid) || Number(probe.backendPid) < 1 || typeof probe.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(probe.transactionId)) unavailable();
  const reads = await tx.$queryRaw<Array<{ projection: unknown }>>(Prisma.sql`
    /* contract_upward_archive_projection_read_v2 */
    SELECT public.jg_upward_archive_catalog_projection_v2() AS projection
  `);
  const value = reads.length === 1 ? row(reads[0].projection) : null;
  if (!value || value.protocolVersion !== 2 || value.recipeVersion !== "contract-upward-direct-archive-v2/1" || !sha(value.sourceClosureSha256)
    || !["databaseOid", "namespaceOid", "anchorOwnerOid", "currentRoleOid", "sessionRoleOid", "backendPid", "transactionId"].every(key => value[key] === probe[key])
    || !Array.isArray(value.routines) || value.routines.length !== signatures.length || !Array.isArray(value.definers)
    || value.definers.length !== Object.keys(UPWARD_SOURCE_DEFINERS).length) unavailable();
  const routines = value.routines.map(row);
  if (routines.some(item => !item || !oid(item.oid) || !oid(item.ownerOid) || item.namespaceOid !== probe.namespaceOid
    || typeof item.signature !== "string" || !(signatures as readonly string[]).includes(item.signature)
    || !sha(item.beforeSha256) || !sha(item.afterSha256) || item.beforeSha256 === item.afterSha256)
    || new Set(routines.map(item => item!.signature)).size !== signatures.length || new Set(routines.map(item => item!.oid)).size !== signatures.length) unavailable();
  const constraint = row(value.constraint);
  if (!constraint || !oid(constraint.beforeOid) || !oid(constraint.afterOid) || constraint.beforeOid === constraint.afterOid
    || !sha(constraint.beforeSha256) || !sha(constraint.afterSha256) || constraint.beforeSha256 === constraint.afterSha256) unavailable();
  const definers = value.definers.map(row);
  if (definers.some(item => !item || !oid(item.oid) || typeof item.signature !== "string"
    || UPWARD_SOURCE_DEFINERS[item.signature] !== item.bodySha256) || new Set(definers.map(item => item!.signature)).size !== Object.keys(UPWARD_SOURCE_DEFINERS).length) unavailable();
  return value as UpwardLegacyProjection;
}

/** Project only the exact current OID AND current sealed body; raced/tampered bodies stay raw and fail old pins. */
export function qualifiedUpwardRoutineSha(projection: UpwardLegacyProjection | null, routineOid: Prisma.Sql, actualSha: Prisma.Sql): Prisma.Sql {
  if (!projection) return actualSha;
  return Prisma.sql`CASE ${Prisma.join(projection.routines.map(item => Prisma.sql`WHEN ${routineOid}=${item.oid}::oid AND ${actualSha}=${item.afterSha256} THEN ${item.beforeSha256}`), " ")} ELSE ${actualSha} END`;
}
export function qualifiedUpwardConstraintOid(projection: UpwardLegacyProjection | null, priorOid: Prisma.Sql): Prisma.Sql {
  if (!projection) return priorOid;
  const item = projection.constraint;
  return Prisma.sql`CASE WHEN ${priorOid}=${item.beforeOid}::oid AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint upward_constraint_row
    WHERE upward_constraint_row.oid=${item.afterOid}::oid AND upward_constraint_row.conrelid='public."ContractVersion"'::regclass
      AND upward_constraint_row.conname='ContractVersion_upward_draft_source_check' AND upward_constraint_row.contype='c'
      AND upward_constraint_row.convalidated AND upward_constraint_row.conislocal
      AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(upward_constraint_row.oid,false),'UTF8'),'sha256'),'hex')=${item.afterSha256})
    THEN ${item.afterOid}::oid ELSE ${priorOid} END`;
}
export function qualifiedUpwardConstraintSha(projection: UpwardLegacyProjection | null, constraintOid: Prisma.Sql, actualSha: Prisma.Sql): Prisma.Sql {
  if (!projection) return actualSha;
  const item = projection.constraint;
  return Prisma.sql`CASE WHEN ${constraintOid}=${item.afterOid}::oid AND ${actualSha}=${item.afterSha256} THEN ${item.beforeSha256} ELSE ${actualSha} END`;
}
export function isQualifiedUpwardDefiner(projection: UpwardLegacyProjection | null, value: unknown): boolean {
  const item = row(value);
  return !!projection && !!item && projection.definers.some(expected => item.oid === expected.oid && item.bodySha256 === expected.bodySha256);
}
