import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

type Catalog = Record<string, unknown>;
export const legacyCompletionName = "jg_contract_archive_v2_complete_guard";
const successorBodySha = "5e408b07516786874983ebdaea2d9c526d7056290df422ccc0861176445305ca";
const manifestBodySha = "ba4b6cc4fe752c03bc742760f7cb2c818ace1c4c95184504206ee1c8c00d0309";
const bindingBodySha = "d4be6bb841d6459e13537724ac423592f8db8ebd53df51a62a0e51a9fcfdd1a5";

function record(value: unknown): Catalog | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Catalog : null;
}
function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
}
function unavailable(): never {
  throw new ServiceUnavailableException("直签归档完成接线资格尚未完整核对，请保留原件稍后办理");
}

export async function readDirectArchiveCompletionOid(tx: Prisma.TransactionClient): Promise<string | null> {
  try {
    const rows = await tx.$queryRaw<Array<{ relationOid: string | null; routineCount: number; triggerCount: number }>>(Prisma.sql`
      /* contract_direct_archive_completion_probe_v1 */
      SELECT c.oid::text AS "relationOid",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p WHERE p.pronamespace=n.oid
          AND p.proname='jg_guard_contract_direct_archive_completion_binding_v1') AS "routineCount",
        (SELECT count(*)::integer FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class x ON x.oid=t.tgrelid
          WHERE x.relnamespace=n.oid AND t.tgname IN (
            'jg_direct_archive_completion_binding_immutable','jg_direct_archive_completion_binding_no_truncate')) AS "triggerCount"
      FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c
        ON c.relnamespace=n.oid AND c.relname='jg_contract_direct_archive_completion_binding_v1'
      WHERE n.nspname='public'
    `);
    const row = rows.length === 1 ? rows[0] : null;
    if (row?.relationOid === null && row.routineCount === 0 && row.triggerCount === 0) return null;
    if (row && oid(row.relationOid) && row.routineCount === 1 && row.triggerCount === 2) return row.relationOid;
  } catch {
    // Observation errors cannot establish absence.
  }
  unavailable();
}

async function readCompletionCatalog(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<Array<{ binding: unknown; actual: unknown }>>(Prisma.sql`
    /* contract_direct_archive_completion_catalog_v1 */
    WITH registry AS (
      SELECT b.*,b.tableoid AS relation_oid FROM public.jg_contract_direct_archive_completion_binding_v1 b
    ), priors AS (
      SELECT r.tableoid AS retention_oid,encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS retention_sha,
        d.tableoid AS dispatch_oid,encode(public.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex') AS dispatch_sha
      FROM public.jg_contract_direct_archive_retention_binding_v1 r
      CROSS JOIN public.jg_contract_direct_archive_dispatch_binding_v1 d
      WHERE r."protocolVersion"=1 AND d."protocolVersion"=1
        AND d."links"->>'retentionOid'=r.tableoid::text
        AND d."links"->>'retentionSha'=encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex')
    ), watched_procs(key,oid) AS (
      VALUES ('completion',pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()')::oid),
        ('manifest',pg_catalog.to_regprocedure('public.jg_assert_contract_archive_v2_manifest(pg_catalog.text)')::oid),
        ('registry',pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_completion_binding_v1()')::oid)
    ), guard AS (
      SELECT p.* FROM watched_procs w JOIN pg_catalog.pg_proc p ON p.oid=w.oid WHERE w.key='registry'
    ), watched_triggers AS (
      SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgfoid IN (SELECT oid FROM guard)
        OR t.tgrelid='public.jg_contract_direct_archive_completion_binding_v1'::regclass
    )
    SELECT jsonb_build_object('protocolVersion',b."protocolVersion",'recipeVersion',b."recipeVersion",
      'applicationRoleOid',b."applicationRoleOid"::text,'databaseOid',b."databaseOid"::text,'namespaceOid',b."namespaceOid"::text,
      'anchorOwnerOid',b."anchorOwnerOid"::text,'links',b."links",'bindings',b."bindings") AS binding,
      jsonb_build_object(
        'applicationRoleOid',current_user::regrole::oid::text,'databaseOid',db.oid::text,'namespaceOid',c.relnamespace::text,
        'anchorOwnerOid',c.relowner::text,'relationOid',c.oid::text,
        'links',jsonb_build_object('retentionOid',prior.retention_oid::text,'retentionSha',prior.retention_sha,
          'dispatchOid',prior.dispatch_oid::text,'dispatchSha',prior.dispatch_sha),
        'bindings',jsonb_build_object(
          'procedures',(SELECT jsonb_object_agg(w.key,(to_jsonb(p)-'prosrc')||jsonb_build_object(
            'oid',p.oid::text,'sha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')))
            FROM watched_procs w JOIN pg_catalog.pg_proc p ON p.oid=w.oid),
          'registryTriggers',(SELECT jsonb_object_agg(tgname,oid::text) FROM watched_triggers)),
        'guardsClosed',2=(SELECT count(*) FROM (VALUES
            ('public.jg_assert_contract_direct_archive_write_profile_v1()','aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616'),
            ('public.jg_require_contract_direct_archive_transition_profile_v1()','45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b')
          ) helpers(signature,sha) JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(helpers.signature)
          WHERE encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=helpers.sha
            AND p.proowner=c.relowner AND NOT p.prosecdef
            AND pg_catalog.has_function_privilege(current_user::regrole::oid,p.oid,'EXECUTE') IS FALSE),
        'registryQualified', c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
          AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_catalog.current_setting('session_replication_role')='origin'
          AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
              AND a.attnotnull AND NOT a.atthasdef AND a.attacl IS NULL AND a.attgenerated='' AND a.attidentity='')
            =ARRAY['protocolVersion:23','recipeVersion:25','applicationRoleOid:26','databaseOid:26',
              'namespaceOid:26','anchorOwnerOid:26','links:3802','bindings:3802']
          AND 8=(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
          AND 1=(SELECT count(*) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
            WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1]::smallint[] AND k.convalidated
              AND NOT k.condeferrable AND i.indisvalid AND i.indisready)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
            WHERE acl.grantee<>c.relowner AND (acl.grantee<>current_user::regrole::oid OR acl.privilege_type<>'SELECT' OR acl.is_grantable))
          AND pg_catalog.has_table_privilege(current_user::regrole::oid,c.oid,'SELECT')
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class a WHERE a.oid IN (
              'public."ContractArchiveFile"'::regclass,'public."ContractArchiveEvidenceFile"'::regclass)
            AND (a.relkind<>'r' OR a.relrowsecurity OR a.relforcerowsecurity))
          AND NOT EXISTS(SELECT 1 FROM watched_procs w JOIN pg_catalog.pg_proc p ON p.oid=w.oid
            WHERE pg_catalog.pg_has_role(current_user::regrole::oid,p.proowner,'MEMBER')
              OR pg_catalog.has_function_privilege(current_user::regrole::oid,p.oid,'EXECUTE WITH GRANT OPTION'))
          AND 1=(SELECT count(*) FROM guard g JOIN pg_catalog.pg_language l ON l.oid=g.prolang
            WHERE g.proowner=c.relowner AND g.pronamespace=c.relnamespace AND g.prokind='f' AND g.prorettype='pg_catalog.trigger'::regtype
              AND g.provolatile='v' AND g.proparallel='u' AND NOT g.prosecdef AND NOT g.proisstrict AND NOT g.proretset
              AND l.lanname='plpgsql' AND g.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
              AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(g.proacl,pg_catalog.acldefault('f',g.proowner))) acl
                WHERE acl.grantee<>g.proowner OR acl.grantor<>g.proowner))
          AND 2=(SELECT count(*) FROM watched_triggers)
          AND 2=(SELECT count(*) FROM watched_triggers t JOIN guard g ON g.oid=t.tgfoid
            WHERE t.tgrelid=c.oid AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable
              AND NOT t.tginitdeferred AND t.tgnargs=0 AND t.tgattr::text='' AND encode(t.tgargs,'hex')='' AND t.tgqual IS NULL
              AND ((t.tgname='jg_direct_archive_completion_binding_immutable' AND t.tgtype=31)
                OR (t.tgname='jg_direct_archive_completion_binding_no_truncate' AND t.tgtype=34))),
        'currentRoleOid',current_user::regrole::oid::text,'sessionRoleOid',session_user::regrole::oid::text,
        'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text
      ) AS actual
    FROM registry b CROSS JOIN priors prior JOIN pg_catalog.pg_class c ON c.oid=b.relation_oid
    JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
  `);
}

/** Validate the complete postimage before letting the old 209 verifier compare its own preimage. */
export async function readDirectArchiveCompletionQualification(
  tx: Prisma.TransactionClient, relationOid: string, retentionOid: string, anchor: Catalog,
  installed209: Catalog, observed209: Catalog
) {
  try {
    const rows = await readCompletionCatalog(tx);
    const binding = rows.length === 1 ? record(rows[0].binding) : null;
    const actual = rows.length === 1 ? record(rows[0].actual) : null;
    if (!binding || !actual || binding.protocolVersion !== 1 || binding.recipeVersion !== "contract-direct-archive-completion-dispatch-v1/1"
      || actual.relationOid !== relationOid || actual.registryQualified !== true || actual.guardsClosed !== true) unavailable();
    const identity = {
      applicationRoleOid: anchor.currentRoleOid, databaseOid: anchor.databaseOid,
      namespaceOid: anchor.namespaceOid, anchorOwnerOid: anchor.anchorOwnerOid
    };
    for (const [key, value] of Object.entries(identity)) {
      if (!oid(value) || binding[key] !== value || actual[key] !== value) unavailable();
    }
    if (!["currentRoleOid","sessionRoleOid","backendPid","transactionId"].every(key => actual[key] === anchor[key])) unavailable();
    const links = record(binding.links);
    if (!links || Object.keys(links).length !== 4 || links.retentionOid !== retentionOid || !oid(links.dispatchOid)
      || ["retentionSha","dispatchSha"].some(key => typeof links[key] !== "string" || !/^[0-9a-f]{64}$/u.test(links[key]))
      || !isDeepStrictEqual(links, actual.links)) unavailable();

    const bound = record(binding.bindings), procedures = record(bound?.procedures), triggers = record(bound?.registryTriggers);
    if (!bound || Object.keys(bound).length !== 2 || !isDeepStrictEqual(bound, actual.bindings)
      || !procedures || Object.keys(procedures).length !== 3 || !triggers || Object.keys(triggers).length !== 2
      || !oid(triggers.jg_direct_archive_completion_binding_immutable) || !oid(triggers.jg_direct_archive_completion_binding_no_truncate)
      || triggers.jg_direct_archive_completion_binding_immutable === triggers.jg_direct_archive_completion_binding_no_truncate) unavailable();
    for (const [key, sha] of Object.entries({ completion: successorBodySha, manifest: manifestBodySha, registry: bindingBodySha })) {
      const procedure = record(procedures[key]);
      if (!procedure || !oid(procedure.oid) || procedure.sha256 !== sha || procedure.prosecdef !== false
        || !isDeepStrictEqual(procedure.proconfig, [key === "registry" ? "search_path=pg_catalog, pg_temp" : "search_path=pg_catalog, public"])) unavailable();
    }
    const installedRoutine = record(record(installed209.routines)?.[legacyCompletionName]);
    const observedRoutines = record(observed209.routines);
    if (!installedRoutine || !oid(installedRoutine.oid) || record(procedures.completion)?.oid !== installedRoutine.oid
      || !observedRoutines || !isDeepStrictEqual(observedRoutines[legacyCompletionName], { ...installedRoutine, sha: successorBodySha })) unavailable();
    return { binding, actual, legacyCatalog: { ...observed209, routines: { ...observedRoutines, [legacyCompletionName]: installedRoutine } } };
  } catch {
    unavailable();
  }
}
