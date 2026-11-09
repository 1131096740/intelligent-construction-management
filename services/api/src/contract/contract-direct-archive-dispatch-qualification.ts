import { nativeDirectBodies, readDirectArchiveNativeAdmission } from "./contract-direct-archive-native-admission";
import { hasGeneratedUpwardOperatingInstallation, upwardOperatingParentBody } from "./contract-generated-upward-operating-installation";
import { qualifyUpwardPendingSave, UPWARD_SAVE_ROUTINE_BODIES } from "./contract-upward-pending-save-profile";
import { qualifyUpwardPendingCreate, UPWARD_CREATE_DISPATCH_BODY } from "./contract-upward-pending-create";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

type RecordValue = Record<string, unknown>;

const parent = "public.jg_contract_archive_v2_parent_guard()";
const version = "public.jg_contract_direct_pending_version_guard_v1()";
const attachment = "public.jg_contract_direct_pending_attachment_guard_v1()";
const slot = "public.jg_guard_contract_direct_archive_slot_v1()";
const bindingGuard = "public.jg_guard_contract_direct_archive_dispatch_binding_v1()";
const postBodies = {
  [parent]: "f9de843279039250da6f56cc481d8d1f80e247431c7060aa637821a7bae7eff8",
  [version]: "82b74ba31f58fbec7e9365966e5551f67169ec8a8a70b26f6c96f7f3a01e550e"
};
const helpers = [
  ["public.jg_assert_contract_direct_archive_write_profile_v1()", "aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616", false, "3802"],
  ['public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")', "8fa9e8b88c4a9334658b05f8f0bf0e9b370df1ed0eceb3887d72c35dd95c802d", true, "archiveTypeOid"],
  ["public.jg_require_contract_direct_archive_transition_profile_v1()", "45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b", false, "3802"],
  ['public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")', "c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157", true, "versionTypeOid"],
  [slot, "cc7b0b876f7f396ed11d3b6f583af25c106b2ef967244648a93c730233efdf8b", false, "2279"],
  [bindingGuard, "40831a77884f198d09985af3317cf396c706e21161e45e5fb2e042ebe776e8e8", false, "2279"]
] as const;
const triggers = [
  ["ContractArchiveFile_v2_immutable", "archiveOid", parent, 31],
  ["jg_direct_pending_version_shape", "versionOid", version, 23],
  ["ContractDraftAttachment_direct_archive_transfer_v1", "slotOid", slot, 31],
  ["jg_direct_archive_dispatch_binding_immutable", "bindingOid", bindingGuard, 31],
  ["jg_direct_archive_dispatch_binding_no_truncate", "bindingOid", bindingGuard, 34]
] as const;

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 4294967295n;
}
function unavailable(): never {
  throw new ServiceUnavailableException("直签归档接线资格尚未完整核对，请保留原件稍后办理");
}

export async function readDirectArchiveDispatchOid(tx: Prisma.TransactionClient): Promise<string | null> {
  try {
    const rows = await tx.$queryRaw<Array<{ relationOid: string | null; slotTriggerCount: number; bindingRoutineCount: number }>>(Prisma.sql`
      /* contract_direct_archive_dispatch_probe_v1 */
      SELECT c.oid::text AS "relationOid",
        (SELECT count(*)::integer FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid
          WHERE r.relnamespace=n.oid AND t.tgname='ContractDraftAttachment_direct_archive_transfer_v1') AS "slotTriggerCount",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p WHERE p.pronamespace=n.oid
          AND p.proname='jg_guard_contract_direct_archive_dispatch_binding_v1') AS "bindingRoutineCount"
      FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c
        ON c.relnamespace=n.oid AND c.relname='jg_contract_direct_archive_dispatch_binding_v1'
      WHERE n.nspname='public'
    `);
    if (rows.length === 1) {
      const row = rows[0];
      if (row.relationOid === null && row.slotTriggerCount === 0 && row.bindingRoutineCount === 0) return null;
      if (oid(row.relationOid) && row.slotTriggerCount === 1 && row.bindingRoutineCount === 1) return row.relationOid;
    }
  } catch {
    // Failed observations never establish absence.
  }
  unavailable();
}

async function readCatalog(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<Array<{ binding: unknown; actual: unknown }>>(Prisma.sql`
    /* contract_direct_archive_dispatch_catalog_v1 */
    WITH registry AS (
      SELECT b.*,b.tableoid AS relation_oid FROM public.jg_contract_direct_archive_dispatch_binding_v1 b
    ), predecessors AS (
      SELECT p.tableoid AS pending_oid, encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS pending_sha,
        q.tableoid AS prepare_oid, encode(public.digest(convert_to(to_jsonb(q)::text,'UTF8'),'sha256'),'hex') AS prepare_sha,
        r.tableoid AS retention_oid, encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS retention_sha
      FROM public.jg_contract_direct_pending_binding_v1 p
      CROSS JOIN public.jg_contract_direct_archive_binding_v1 q
      CROSS JOIN public.jg_contract_direct_archive_retention_binding_v1 r
      WHERE p."protocolVersion"=1 AND q."protocolVersion"=1 AND r."protocolVersion"=1
    ), helper_rows AS (
      SELECT signature,p.*,l.lanname
      FROM unnest(ARRAY[${Prisma.join(helpers.map(([signature]) => signature))}]::text[]) signatures(signature)
      JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(signature)
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    ), watched_triggers AS (
      SELECT t.* FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public.jg_contract_direct_archive_dispatch_binding_v1'::regclass OR t.tgfoid IN (
        pg_catalog.to_regprocedure(${parent}),pg_catalog.to_regprocedure(${version}),
        pg_catalog.to_regprocedure(${slot}),pg_catalog.to_regprocedure(${bindingGuard}))
    ), app_reads(table_name,column_name) AS (VALUES
      ('public."Contract"','id'),('public."Contract"','ownerUserId'),('public."Contract"','voidedAt'),
      ('public."ContractVersion"','id'),('public."ContractVersion"','contractId'),('public."ContractVersion"','status'),
      ('public."ContractVersion"','numericProtocolVersion'),('public."ContractVersion"','versionNo'),
      ('public."ContractVersion"','changeType'),('public."ContractVersion"','draftRevision'),('public."ContractVersion"','draftData'),
      ('public."ContractVersion"','effectiveAt'),('public."ContractVersion"','firstSubmittedAt'),('public."ContractVersion"','endedAt'),
      ('public."ContractArchiveFile"','id'),('public."ContractArchiveFile"','contractVersionId'),
      ('public."ContractArchiveFile"','archiveProtocolVersion'),('public."ContractArchiveFile"','archiveSource'),
      ('public."ContractArchiveFile"','status'),('public."ContractArchiveFile"','sourceRevision'),
      ('public."ContractArchiveFile"','uploadedByUserId'),('public."ContractArchiveFile"','confirmedByUserId'),
      ('public."ContractArchiveFile"','authoritySnapshot'),('public."ContractArchiveFile"','authoritySha256'),('public."ContractArchiveFile"','fileManifestSha256')
    )
    SELECT jsonb_build_object('protocolVersion',b."protocolVersion",'recipeVersion',b."recipeVersion",
      'applicationRoleOid',b."applicationRoleOid"::text,'databaseOid',b."databaseOid"::text,'namespaceOid',b."namespaceOid"::text,
      'anchorOwnerOid',b."anchorOwnerOid"::text,'links',b."links",'bindings',b."bindings") AS binding,
      jsonb_build_object(
        'applicationRoleOid',(current_user::regrole::oid)::text,'databaseOid',db.oid::text,
        'namespaceOid',c.relnamespace::text,'anchorOwnerOid',c.relowner::text,
        'dispatchRowSha256',encode(public.digest(convert_to((to_jsonb(b)-'relation_oid')::text,'UTF8'),'sha256'),'hex'),
        'links',jsonb_build_object('pendingOid',prior.pending_oid::text,'pendingSha',prior.pending_sha,
          'prepareOid',prior.prepare_oid::text,'prepareSha',prior.prepare_sha,'retentionOid',prior.retention_oid::text,'retentionSha',prior.retention_sha),
        'helpers',(SELECT jsonb_object_agg(h.signature,(to_jsonb(h)-ARRAY['signature','lanname','prosrc'])||
          jsonb_build_object('oid',h.oid::text,'proowner',h.proowner::text,'pronamespace',h.pronamespace::text,'prorettype',h.prorettype::text,
            'language',h.lanname,'bodySha256',encode(public.digest(convert_to(h.prosrc,'UTF8'),'sha256'),'hex'))) FROM helper_rows h),
        'triggers',(SELECT jsonb_object_agg(t.tgname,to_jsonb(t)||jsonb_build_object(
          'oid',t.oid::text,'tgrelid',t.tgrelid::text,'tgfoid',t.tgfoid::text,'tgattr',t.tgattr::text,'tgargs',encode(t.tgargs,'hex'))) FROM watched_triggers t),
        'triggerCount',(SELECT count(*)::integer FROM watched_triggers),
        'relations',jsonb_build_object('bindingOid',c.oid::text,'archiveOid',a.oid::text,'archiveTypeOid',a.reltype::text,
          'versionOid',v.oid::text,'versionTypeOid',v.reltype::text,'slotOid',s.oid::text),
        'registryQualified', c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class x WHERE x.oid IN (a.oid,v.oid,s.oid,'public."Contract"'::regclass)
            AND (x.relkind<>'r' OR x.relrowsecurity OR x.relforcerowsecurity))
          AND (SELECT array_agg(format('%s:%s',at.attname,at.atttypid) ORDER BY at.attnum)
            FROM pg_catalog.pg_attribute at WHERE at.attrelid=c.oid AND at.attnum>0 AND NOT at.attisdropped
              AND at.attnotnull AND at.attgenerated='' AND at.attidentity='' AND NOT at.atthasdef AND at.attacl IS NULL)
            = ARRAY['protocolVersion:23','recipeVersion:25','applicationRoleOid:26','databaseOid:26','namespaceOid:26','anchorOwnerOid:26','links:3802','bindings:3802']
          AND 8=(SELECT count(*) FROM pg_catalog.pg_attribute at WHERE at.attrelid=c.oid AND at.attnum>0 AND NOT at.attisdropped)
          AND 1=(SELECT count(*) FROM pg_catalog.pg_constraint key WHERE key.conrelid=c.oid AND key.contype='p'
            AND key.conkey=ARRAY[1]::smallint[] AND key.convalidated AND NOT key.condeferrable)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
            WHERE acl.grantee<>c.relowner AND (acl.grantee<>current_user::regrole::oid OR acl.privilege_type<>'SELECT' OR acl.is_grantable))
          AND pg_catalog.has_table_privilege(current_user::regrole::oid,c.oid,'SELECT'),
        'legacySlotReads',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r
          WHERE (pg_catalog.has_table_privilege(r.oid,s.oid,'INSERT,UPDATE,DELETE')
            OR pg_catalog.has_any_column_privilege(r.oid,s.oid,'INSERT,UPDATE'))
            AND EXISTS(SELECT 1 FROM unnest(ARRAY['id','contractId','draftData']) fields(name)
              WHERE pg_catalog.has_column_privilege(r.oid,v.oid,fields.name,'SELECT') IS DISTINCT FROM TRUE)),
        'applicationSlotReads',NOT EXISTS(SELECT 1 FROM app_reads fields
          WHERE pg_catalog.has_column_privilege(current_user::regrole::oid,pg_catalog.to_regclass(fields.table_name),fields.column_name,'SELECT') IS DISTINCT FROM TRUE)
          AND pg_catalog.has_any_column_privilege(current_user::regrole::oid,'public."Contract"'::regclass,'UPDATE')
          AND pg_catalog.has_any_column_privilege(current_user::regrole::oid,v.oid,'UPDATE'),
        'helpersPrivate',NOT EXISTS(SELECT 1 FROM helper_rows h
          WHERE pg_catalog.has_function_privilege(h.proowner,h.oid,'EXECUTE') IS DISTINCT FROM TRUE OR EXISTS(
            SELECT 1 FROM pg_catalog.aclexplode(COALESCE(h.proacl,pg_catalog.acldefault('f',h.proowner))) acl
            WHERE acl.grantee<>h.proowner OR acl.grantor<>h.proowner)),
        'currentRoleOid',(current_user::regrole::oid)::text,'sessionRoleOid',(session_user::regrole::oid)::text,
        'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text
      ) AS actual
    FROM registry b CROSS JOIN predecessors prior
    JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
    JOIN pg_catalog.pg_class c ON c.oid=b.relation_oid
    JOIN pg_catalog.pg_class a ON a.oid='public."ContractArchiveFile"'::regclass
    JOIN pg_catalog.pg_class v ON v.oid='public."ContractVersion"'::regclass
    JOIN pg_catalog.pg_class s ON s.oid='public."ContractDraftAttachment"'::regclass
  `);
}

/** Project exactly two already-matched body digests for the unchanged 205 verifier. */
export async function readDirectArchiveDispatchQualification(
  tx: Prisma.TransactionClient, dispatchOid: string, bootstrap: RecordValue, legacy: RecordValue, observed: RecordValue,
  transitionOid: string | null, retentionOid: string | null
) {
  try {
    const rows = await readCatalog(tx);
    const binding = rows.length === 1 ? object(rows[0].binding) : null;
    const actual = rows.length === 1 ? object(rows[0].actual) : null;
    if (!binding || !actual || binding.protocolVersion !== 1 || binding.recipeVersion !== "contract-direct-archive-dispatch-v1/1") unavailable();
    const identity = {
      applicationRoleOid: bootstrap.currentRoleOid, databaseOid: bootstrap.databaseOid,
      namespaceOid: bootstrap.namespaceOid, anchorOwnerOid: bootstrap.anchorOwnerOid
    };
    for (const [key, value] of Object.entries(identity)) {
      if (!oid(value) || binding[key] !== value || actual[key] !== value) unavailable();
    }
    if (actual.currentRoleOid !== bootstrap.currentRoleOid || actual.sessionRoleOid !== bootstrap.sessionRoleOid
      || actual.backendPid !== bootstrap.backendPid || actual.transactionId !== bootstrap.transactionId
      || ["registryQualified","legacySlotReads","applicationSlotReads"].some(key => actual[key] !== true)
      || typeof actual.helpersPrivate !== "boolean") unavailable();
    const native = actual.helpersPrivate ? null : await readDirectArchiveNativeAdmission(tx, bootstrap);
    if (!actual.helpersPrivate && !native) unavailable();

    const links = object(binding.links);
    if (!links || !transitionOid || !retentionOid || links.pendingOid !== bootstrap.bindingRelationOid
      || links.prepareOid !== transitionOid || links.retentionOid !== retentionOid || Object.keys(links).length !== 6
      || ["pendingSha","prepareSha","retentionSha"].some(key => typeof links[key] !== "string" || !/^[0-9a-f]{64}$/u.test(links[key]))
      || !isDeepStrictEqual(links, actual.links)) unavailable();

    const installed = object(binding.bindings), relations = object(actual.relations), oldRelations = object(legacy.relations);
    const oldRoutines = object(legacy.routines), currentRoutines = object(observed.routines), installedRoutines = object(installed?.routines);
    const installedHelpers = object(installed?.helpers), currentHelpers = object(actual.helpers), currentTriggers = object(actual.triggers);
    if (!installed || Object.keys(installed).length !== 3 || !oldRoutines || !currentRoutines || !installedRoutines
      || Object.keys(installedRoutines).length !== Object.keys(postBodies).length || !installedHelpers || !currentHelpers || !currentTriggers
      || !relations || Object.keys(relations).length !== 6 || Object.values(relations).some(value => !oid(value))
      || relations.bindingOid !== dispatchOid || relations.versionOid !== object(oldRelations?.ContractVersion)?.oid
      || relations.slotOid !== object(oldRelations?.ContractDraftAttachment)?.oid
      || !isDeepStrictEqual(installed.triggers, currentTriggers)
      || Object.keys(installedHelpers).length !== helpers.length || Object.keys(currentHelpers).length !== helpers.length || Object.keys(currentTriggers).length !== triggers.length
      || actual.triggerCount !== triggers.length) unavailable();

    const legacyProjection: RecordValue = {};
    let upwardCreate: Awaited<ReturnType<typeof qualifyUpwardPendingCreate>> | null = null;
    let upwardSave: Awaited<ReturnType<typeof qualifyUpwardPendingSave>> | undefined;
    for (const [signature, bodySha256] of Object.entries(postBodies)) {
      const legacyRoutine = object(oldRoutines[signature]);
      if (!legacyRoutine || !oid(legacyRoutine.oid)) unavailable();
      const post = { ...legacyRoutine, bodySha256 };
      if (!isDeepStrictEqual(installedRoutines[signature], post)) unavailable();
      const successorBody = object(currentRoutines[signature])?.bodySha256;
      if (signature === parent && successorBody === upwardOperatingParentBody) {
        if (!isDeepStrictEqual(currentRoutines[signature], { ...post, bodySha256: successorBody })
          || !await hasGeneratedUpwardOperatingInstallation(tx, actual)) unavailable();
      } else if (signature === version && (successorBody === UPWARD_CREATE_DISPATCH_BODY || successorBody === UPWARD_SAVE_ROUTINE_BODIES.version)
        && isDeepStrictEqual(currentRoutines[signature], { ...post, bodySha256: successorBody })) {
        if (successorBody === UPWARD_SAVE_ROUTINE_BODIES.version) upwardSave = await qualifyUpwardPendingSave(tx);
        const witness = await qualifyUpwardPendingCreate(tx, upwardSave);
        const legacyTriggers = object(legacy.triggers);
        if (witness.directDispatchSha256 !== actual.dispatchRowSha256 || witness.dispatchBindingOid !== dispatchOid
          || witness.databaseOid !== identity.databaseOid || witness.namespaceOid !== identity.namespaceOid
          || witness.ownerOid !== identity.anchorOwnerOid || witness.applicationRoleOid !== identity.applicationRoleOid
          || witness.sessionRoleOid !== actual.sessionRoleOid || witness.backendPid !== actual.backendPid
          || witness.transactionId !== actual.transactionId || witness.bindingOid !== bootstrap.bindingRelationOid
          || witness.versionRoutineOid !== legacyRoutine.oid
          || witness.versionTriggerOid !== object(legacyTriggers?.jg_direct_pending_version_shape)?.oid
          || witness.attachmentTriggerOid !== object(legacyTriggers?.jg_direct_pending_attachment_source)?.oid) unavailable();
        upwardCreate = witness;
      } else if (!isDeepStrictEqual(currentRoutines[signature], post)) unavailable();
      legacyProjection[signature] = legacyRoutine;
    }
    if (upwardSave) {
      const originalAttachment = object(oldRoutines[attachment]);
      const slotMeta = object(currentHelpers[slot]);
      const oldTriggers = object(legacy.triggers);
      const successorTriggers = object(upwardSave.triggerOids);
      if (!originalAttachment || !slotMeta || !successorTriggers
        || !isDeepStrictEqual(currentRoutines[attachment], { ...originalAttachment, bodySha256: UPWARD_SAVE_ROUTINE_BODIES.attachment })
        || upwardSave.attachmentRoutineOid !== originalAttachment.oid || upwardSave.slotRoutineOid !== slotMeta.oid
        || successorTriggers.ContractDraftAttachment_direct_archive_transfer_v1 !== object(currentTriggers.ContractDraftAttachment_direct_archive_transfer_v1)?.oid
        || successorTriggers.jg_direct_pending_file_retained !== object(oldTriggers?.jg_direct_pending_file_retained)?.oid
        || successorTriggers.jg_direct_pending_attachment_exclusive !== object(oldTriggers?.jg_direct_pending_attachment_exclusive)?.oid) unavailable();
      legacyProjection[attachment] = originalAttachment;
    }
    for (const [signature, bodySha256, strict, resultType] of helpers) {
      const installedHelper = object(installedHelpers[signature]);
      const routine = object(currentHelpers[signature]);
      const nativeBody = native && nativeDirectBodies[signature];
      const currentBody = nativeBody || (upwardSave && signature === slot ? UPWARD_SAVE_ROUTINE_BODIES.slot : bodySha256);
      const compared = nativeBody && routine ? { ...routine, proacl: installedHelper?.proacl } : routine;
      if (!installedHelper || installedHelper.bodySha256 !== bodySha256
        || !isDeepStrictEqual(compared, { ...installedHelper, bodySha256: currentBody })) unavailable();
      if (!routine || !oid(routine.oid) || routine.proowner !== identity.anchorOwnerOid
        || routine.pronamespace !== identity.namespaceOid || routine.bodySha256 !== currentBody
        || routine.language !== "plpgsql" || routine.prokind !== "f" || routine.prosecdef !== false || routine.proretset !== false
        || routine.provolatile !== "v" || routine.proparallel !== "u" || routine.proisstrict !== strict
        || !isDeepStrictEqual(routine.proconfig, ["search_path=pg_catalog, pg_temp"])
        || routine.prorettype !== (relations[resultType] ?? resultType)) unavailable();
    }
    for (const [name, relation, routine, type] of triggers) {
      const trigger = object(currentTriggers[name]);
      const triggerFunction = object(installedRoutines[routine]) ?? object(currentHelpers[routine]);
      if (!trigger || !oid(trigger.oid) || trigger.tgrelid !== relations[relation]
        || !triggerFunction || trigger.tgfoid !== triggerFunction.oid
        || trigger.tgtype !== type || trigger.tgenabled !== "O" || trigger.tgisinternal !== false
        || trigger.tgdeferrable !== false || trigger.tginitdeferred !== false || trigger.tgnargs !== 0
        || trigger.tgattr !== "" || trigger.tgargs !== "" || trigger.tgqual !== null) unavailable();
      if (routine === version && trigger.oid !== object(object(legacy.triggers)?.[name])?.oid) unavailable();
    }
    return { binding, actual, native, upwardCreate, upwardSave, legacyProjection, archiveRelationOid: relations.archiveOid, links };
  } catch {
    unavailable();
  }
}
