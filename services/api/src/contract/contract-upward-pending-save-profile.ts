import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { DIRECT_PENDING_DB_RECIPE } from "./contract-direct-pending-recipe";

export const UPWARD_SAVE_ROUTINE_BODIES = {
  version: "bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f",
  attachment: "0a0b17642f39c96064f1184fcd03e4151569136c385b2ea0d94ff67dbc5963cf",
  slot: "86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999",
  save: "ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50",
  binding: "637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028",
  after: "1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059",
  file: "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
  exclusive: "e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999"
};
const unavailable = () => new ServiceUnavailableException("对上直签保存资格尚未核对，请保留资料稍后办理");
const generatedUnavailable = () => new ServiceUnavailableException("对上生成提交资格尚未核对，请保留草稿稍后办理");
const sealHandoffUnavailable = () => new ServiceUnavailableException("对上生成合同盖章交接资格尚未就绪，审批仍保留在当前轮次");
const generatedBindingBody = "08c0c90d9c755152e26fb05d6a1e343fbd6d9c415f2722ff96c395b00452130e";
const transactionIdentity = ["databaseOid", "namespaceOid", "anchorOwnerOid", "currentRoleOid",
  "sessionRoleOid", "bindingOid", "backendPid", "transactionId"] as const;

function isOid(value: unknown): boolean {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 4294967295n;
}

async function qualifyGeneratedSuccessor(tx: Prisma.TransactionClient, direct: Record<string, unknown>) {
  const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    /* contract_generated_upward_submission_catalog_v1 */
    WITH proof AS (
      SELECT n.*, p.tableoid AS previous_oid, p."subjectConstraintSha256" AS subject_sha,
        p."upwardConstraintSha256" AS previous_upward_sha, c.oid AS successor_oid
      FROM public.jg_contract_generated_upward_submission_binding_v1 n
      JOIN public.jg_contract_upward_pending_save_binding_v1 p ON p."protocolVersion"=1
        AND p.tableoid=n."predecessorOid" AND p."databaseOid"=n."databaseOid"
        AND p."namespaceOid"=n."namespaceOid" AND p."ownerOid"=n."ownerOid"
        AND p."applicationRoleOid"=n."applicationRoleOid"
        AND encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex')=n."predecessorSha256"
      JOIN pg_catalog.pg_database d ON d.oid=n."databaseOid" AND d.datname=pg_catalog.current_database()
      JOIN pg_catalog.pg_class c ON c.oid=n.tableoid
        AND c.oid=pg_catalog.to_regclass('public.jg_contract_generated_upward_submission_binding_v1')
        AND c.relowner=n."ownerOid" AND c.relnamespace=n."namespaceOid"
        AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      WHERE n."protocolVersion"=1 AND n."namespaceOid"=pg_catalog.to_regnamespace('public')
        AND n."applicationRoleOid"=current_user::regrole::oid
        AND n."applicationRoleOid"=session_user::regrole::oid
    )
    SELECT b."databaseOid"::text AS "databaseOid", b."namespaceOid"::text AS "namespaceOid",
      b."ownerOid"::text AS "anchorOwnerOid", b."applicationRoleOid"::text AS "currentRoleOid",
      (session_user::regrole::oid)::text AS "sessionRoleOid", b.previous_oid::text AS "bindingOid",
      b.successor_oid::text AS "successorOid", b."upwardConstraintOid"::text AS "constraintOid",
      b."predecessorSha256" AS "predecessorSha256", b."upwardConstraintSha256" AS "constraintSha256",
      COALESCE(to_jsonb(b)->'sealHandoffEnabled'='true'::jsonb,FALSE) AS "sealHandoffEnabled",
      pg_catalog.pg_backend_pid() AS "backendPid", pg_catalog.txid_current()::text AS "transactionId",
      b."upwardConstraintSha256"<>b.previous_upward_sha
      AND (SELECT count(*) FROM (VALUES
        (b."subjectConstraintOid",'ContractVersion_signing_subject_check',b.subject_sha),
        (b."upwardConstraintOid",'ContractVersion_upward_draft_source_check',b."upwardConstraintSha256")
      ) AS wanted(oid,name,sha)
        JOIN pg_catalog.pg_constraint c ON c.oid=wanted.oid AND c.conname=wanted.name
          AND c.conrelid='public."ContractVersion"'::regclass AND c.contype='c' AND c.convalidated AND c.conislocal
          AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=wanted.sha)=2
      AND pg_catalog.has_table_privilege(b."applicationRoleOid",b.successor_oid,'SELECT')
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
        WHERE c.oid=b.successor_oid AND a.grantee=b."applicationRoleOid" AND a.grantor=b."ownerOid"
          AND a.privilege_type='SELECT' AND NOT a.is_grantable)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
        WHERE c.oid=b.successor_oid AND (a.grantor<>b."ownerOid" OR a.grantee<>b."ownerOid" AND
          (a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=b.successor_oid
        AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
        AND pg_catalog.has_table_privilege(r.oid,b.successor_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      AND (SELECT count(*) FROM pg_catalog.pg_trigger h
        JOIN pg_catalog.pg_proc p ON p.oid=h.tgfoid
          AND p.oid=pg_catalog.to_regprocedure('public.jg_guard_generated_upward_submission_binding_v1()')
          AND p.pronamespace=b."namespaceOid" AND p.proowner=b."ownerOid" AND NOT p.prosecdef
          AND p.prorettype='pg_catalog.trigger'::regtype AND p.prokind='f' AND p.provolatile='v'
          AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
          AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=${generatedBindingBody}
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
        WHERE h.tgrelid=b.successor_oid AND h.tgenabled='O' AND NOT h.tgisinternal
          AND NOT h.tgdeferrable AND NOT h.tginitdeferred AND h.tgqual IS NULL AND h.tgnargs=0 AND h.tgattr::text=''
          AND ((h.tgname='jg_generated_upward_submission_binding_immutable' AND h.tgtype=31)
            OR (h.tgname='jg_generated_upward_submission_binding_no_truncate' AND h.tgtype=34)))=2
      AND (SELECT count(*) FROM pg_catalog.pg_trigger h WHERE h.tgrelid=b.successor_oid)=2
      AS "exactSuccessor"
    FROM proof b
  `);
  const result = rows.length === 1 ? rows[0] : null;
  if (!result || result.exactSuccessor !== true || result.successorOid !== direct.successorOid
    || !isOid(result.constraintOid) || !transactionIdentity.every(key => result[key] === direct[key])
    || ![result.predecessorSha256, result.constraintSha256].every(value =>
      typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))) throw unavailable();
  return result;
}

export async function qualifyUpwardPendingSave(
  tx: Prisma.TransactionClient
): Promise<Record<string, unknown> & { generatedSuccessor?: Record<string, unknown> }> {
  try {
    const exclusiveDefinitions = DIRECT_PENDING_DB_RECIPE.triggers.find(trigger =>
      trigger.name === "jg_direct_pending_attachment_exclusive")?.definitions;
    if (!exclusiveDefinitions?.length) throw unavailable();
    const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      /* contract_upward_pending_save_catalog_v1 */
      WITH expected(role,signature) AS (VALUES
        ('version','public.jg_contract_direct_pending_version_guard_v1()'),
        ('attachment','public.jg_contract_direct_pending_attachment_guard_v1()'),
        ('slot','public.jg_guard_contract_direct_archive_slot_v1()'),
        ('save','public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")'),
        ('binding','public.jg_guard_upward_pending_save_binding_v1()'),
        ('after','public.jg_check_contract_upward_pending_save_v1()'),
        ('file','public.jg_contract_direct_pending_file_guard_v1()'),
        ('exclusive','public.jg_enforce_exclusive_file_business_binding()')
      ), scoped AS (
        SELECT b.*,r.oid AS rel_oid,c.tableoid AS create_oid
        FROM public.jg_contract_upward_pending_save_binding_v1 b
        JOIN public.jg_contract_upward_pending_create_binding_v1 c ON c."protocolVersion"=1
          AND c."applicationRoleOid"=b."applicationRoleOid" AND c."databaseOid"=b."databaseOid"
          AND c."namespaceOid"=b."namespaceOid" AND c."ownerOid"=b."ownerOid"
          AND c."versionRoutineOid"=b."versionRoutineOid"
          AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."createBindingSha256"
        JOIN pg_catalog.pg_database db ON db.oid=b."databaseOid" AND db.datname=pg_catalog.current_database()
        JOIN pg_catalog.pg_class r ON r.oid=b.tableoid AND r.relowner=b."ownerOid" AND r.relnamespace=b."namespaceOid"
          AND r.relkind='r' AND NOT r.relrowsecurity AND NOT r.relforcerowsecurity
        WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid
          AND b."applicationRoleOid"=session_user::regrole::oid AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      ), routines AS (
        SELECT e.role,p.oid,encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS body
        FROM scoped b CROSS JOIN expected e
        JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
        WHERE p.proowner=b."ownerOid" AND p.pronamespace=b."namespaceOid" AND NOT p.prosecdef
          AND p.prokind='f' AND NOT p.proretset AND NOT p.proisstrict AND p.proparallel='u'
          AND ((e.role='slot' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[])
            OR (e.role='exclusive' AND p.proconfig IS NULL)
            OR (e.role NOT IN ('slot','exclusive') AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]))
          AND p.provolatile='v' AND p.pronargdefaults=0 AND p.provariadic=0
          AND ((e.role='save' AND p.prorettype='public."ContractVersion"'::regtype)
            OR (e.role<>'save' AND p.prorettype='pg_catalog.trigger'::regtype))
          AND (e.role<>'version' OR p.oid=b."versionRoutineOid")
          AND (e.role<>'attachment' OR p.oid=b."attachmentRoutineOid")
          AND (e.role<>'slot' OR p.oid=b."slotRoutineOid")
      ), hooks(role,name,rel,kind) AS (VALUES
        ('version','jg_direct_pending_version_shape','public."ContractVersion"',23),
        ('attachment','jg_direct_pending_attachment_source','public."ContractDraftAttachment"',23),
        ('slot','ContractDraftAttachment_direct_archive_transfer_v1','public."ContractDraftAttachment"',31),
        ('binding','jg_upward_pending_save_binding_immutable','public.jg_contract_upward_pending_save_binding_v1',31),
        ('binding','jg_upward_pending_save_binding_no_truncate','public.jg_contract_upward_pending_save_binding_v1',34),
        ('after','jg_upward_pending_save_persistent_proof','public."ContractVersion"',17),
        ('file','jg_direct_pending_file_retained','public."FileObject"',27),
        ('exclusive','jg_direct_pending_attachment_exclusive','public."ContractDraftAttachment"',23)
      )
      SELECT b."databaseOid"::text AS "databaseOid", b."namespaceOid"::text AS "namespaceOid",
        b."ownerOid"::text AS "anchorOwnerOid", b."applicationRoleOid"::text AS "currentRoleOid",
        (session_user::regrole::oid)::text AS "sessionRoleOid", b.rel_oid::text AS "bindingOid",
        b."createBindingSha256" AS "createBindingSha256", b.create_oid::text AS "createBindingOid",
        b."versionRoutineOid"::text AS "versionRoutineOid", b."attachmentRoutineOid"::text AS "attachmentRoutineOid",
        b."slotRoutineOid"::text AS "slotRoutineOid", pg_catalog.pg_backend_pid() AS "backendPid",
        pg_catalog.txid_current()::text AS "transactionId",
        pg_catalog.to_regclass('public.jg_contract_generated_upward_submission_binding_v1')::oid::text AS "successorOid",
        pg_catalog.has_table_privilege(b."applicationRoleOid",
          pg_catalog.to_regclass('public.jg_contract_generated_upward_submission_binding_v1'),'SELECT') AS "successorReadable",
        (SELECT jsonb_object_agg(role,body) FROM routines) AS "routineBodies",
        (SELECT jsonb_object_agg(h.name,t.oid::text) FROM hooks h JOIN routines f ON f.role=h.role
          JOIN pg_catalog.pg_trigger t ON t.tgfoid=f.oid AND t.tgname=h.name AND t.tgtype=h.kind
          AND t.tgrelid=pg_catalog.to_regclass(h.rel) AND t.tgenabled='O' AND NOT t.tgisinternal
          AND NOT t.tgdeferrable AND NOT t.tginitdeferred
          AND ((h.role<>'exclusive' AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
            OR (h.role='exclusive' AND t.tgqual IS NOT NULL AND t.tgnargs=2
              AND pg_catalog.pg_get_triggerdef(t.oid,false) IN (${Prisma.join(exclusiveDefinitions)})))
        ) AS "triggerOids",
        EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public."ContractVersion"'::regclass
          AND c.contype='c' AND c.convalidated AND c.conname='ContractVersion_upward_draft_source_check'
          AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=b."upwardConstraintSha256")
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public."ContractVersion"'::regclass
            AND c.contype='c' AND c.convalidated AND c.conname='ContractVersion_signing_subject_check'
            AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=b."subjectConstraintSha256")
          AS "dualIdentityCheck",
        NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER') AND
          (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,b."ownerOid",'MEMBER')
            OR pg_catalog.has_schema_privilege(r.oid,b."namespaceOid",'CREATE')
            OR pg_catalog.has_table_privilege(r.oid,b.rel_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=b.rel_oid AND a.attnum>0
              AND NOT a.attisdropped AND pg_catalog.has_column_privilege(r.oid,b.rel_oid,a.attnum,'INSERT,UPDATE,REFERENCES'))))
          AS "restrictedRole",
        pg_catalog.has_table_privilege(b."applicationRoleOid",b.rel_oid,'SELECT')
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.oid=b.rel_oid AND a.grantee=b."applicationRoleOid" AND a.privilege_type='SELECT' AND NOT a.is_grantable)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.oid=b.rel_oid AND (a.grantor<>b."ownerOid" OR a.grantee<>b."ownerOid" AND
              (a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=b.rel_oid
            AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.jg_contract_upward_pending_read_v1(text,text)')
            AND p.pronamespace=b."namespaceOid" AND p.proowner=b."ownerOid" AND NOT p.prosecdef AND p.provolatile='s'
            AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4')
          AND (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
            WHERE p.oid IN ((SELECT oid FROM routines WHERE role='save'),
              pg_catalog.to_regprocedure('public.jg_contract_upward_pending_read_v1(text,text)'))
              AND a.grantee=b."applicationRoleOid" AND a.grantor=b."ownerOid" AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)=2
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
            WHERE p.oid IN ((SELECT oid FROM routines WHERE role='save'),
              pg_catalog.to_regprocedure('public.jg_contract_upward_pending_read_v1(text,text)'))
              AND (a.grantor<>b."ownerOid" OR a.grantee<>b."ownerOid" AND
                (a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
          AS "privateTechnicalAcl"
      FROM scoped b
    `);
    const result = rows.length === 1 ? rows[0] : null;
    const hooks = result?.triggerOids;
    const names = ["jg_direct_pending_version_shape", "jg_direct_pending_attachment_source", "ContractDraftAttachment_direct_archive_transfer_v1",
      "jg_upward_pending_save_binding_immutable", "jg_upward_pending_save_binding_no_truncate", "jg_upward_pending_save_persistent_proof",
      "jg_direct_pending_file_retained", "jg_direct_pending_attachment_exclusive"];
    if (!result || !["databaseOid", "namespaceOid", "anchorOwnerOid", "currentRoleOid", "sessionRoleOid", "bindingOid", "createBindingOid", "versionRoutineOid",
      "attachmentRoutineOid", "slotRoutineOid"].every(key => isOid(result[key]))
      || result.currentRoleOid !== result.sessionRoleOid || result.currentRoleOid === result.anchorOwnerOid
      || typeof result.backendPid !== "number" || !Number.isSafeInteger(result.backendPid) || result.backendPid <= 0
      || typeof result.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(result.transactionId)
      || typeof result.createBindingSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(result.createBindingSha256)
      || !isDeepStrictEqual(result.routineBodies, UPWARD_SAVE_ROUTINE_BODIES) || !hooks || typeof hooks !== "object"
      || Object.keys(hooks).length !== names.length || !names.every(name => isOid((hooks as Record<string, unknown>)[name]))
      || result.restrictedRole !== true || result.privateTechnicalAcl !== true) throw unavailable();
    if (result.successorOid == null) {
      if (result.dualIdentityCheck !== true) throw unavailable();
      return result;
    }
    if (!isOid(result.successorOid) || result.successorReadable !== true) throw unavailable();
    return { ...result, generatedSuccessor: await qualifyGeneratedSuccessor(tx, result) };
  } catch {
    throw unavailable();
  }
}

export async function assertUpwardPendingSaveContinuity(
  tx: Prisma.TransactionClient, before: Awaited<ReturnType<typeof qualifyUpwardPendingSave>>
) {
  if (!isDeepStrictEqual(before, await qualifyUpwardPendingSave(tx))) throw unavailable();
}

export async function qualifyGeneratedUpwardSubmission(tx: Prisma.TransactionClient) {
  try {
    const result = await qualifyUpwardPendingSave(tx);
    if (!result.generatedSuccessor) throw generatedUnavailable();
    return result;
  } catch {
    throw generatedUnavailable();
  }
}

export async function assertGeneratedUpwardSubmissionContinuity(
  tx: Prisma.TransactionClient, before: Awaited<ReturnType<typeof qualifyGeneratedUpwardSubmission>>
) {
  if (!isDeepStrictEqual(before, await qualifyGeneratedUpwardSubmission(tx))) throw generatedUnavailable();
}

export async function qualifyGeneratedUpwardSealHandoff(tx: Prisma.TransactionClient) {
  const qualification = await qualifyGeneratedUpwardSubmission(tx).catch(() => { throw sealHandoffUnavailable(); });
  if (qualification.generatedSuccessor?.sealHandoffEnabled !== true) throw sealHandoffUnavailable();
  return qualification;
}

export async function assertGeneratedUpwardSealHandoffContinuity(
  tx: Prisma.TransactionClient, before: Awaited<ReturnType<typeof qualifyGeneratedUpwardSealHandoff>>
) {
  if (!isDeepStrictEqual(before, await qualifyGeneratedUpwardSealHandoff(tx))) throw sealHandoffUnavailable();
}

/** Avoid aborting a legacy read transaction on an absent or unreadable registry. */
export async function discoverUpwardPendingSave(tx: Prisma.TransactionClient) {
  try {
    const rows = await tx.$queryRaw<Array<{ readable: boolean | null }>>(Prisma.sql`
      /* contract_upward_pending_save_probe_v1 */
      SELECT pg_catalog.has_table_privilege(current_user::regrole::oid,
        pg_catalog.to_regclass('public.jg_contract_upward_pending_save_binding_v1'),'SELECT') AS readable
    `);
    if (rows.length === 1 && rows[0].readable === true) return await qualifyUpwardPendingSave(tx);
  } catch {
    // The ordinary upward read still needs its own exact pre-save qualification.
  }
  return undefined;
}
