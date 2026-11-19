import { qualifyUpwardPendingSave, UPWARD_SAVE_ROUTINE_BODIES } from "./contract-upward-pending-save-profile";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

export const UPWARD_CREATE_DISPATCH_BODY = "522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93";
const attachmentBody = "75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1";
const bindingBody = "5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d";
const createBindingBody = "1596a00b04dd2907b229d7ae1a4c53645d0c3f9d6837fef5c6396cda0707bd26";
const helperBody = "367527eea9629755f1ef287c36a52a76f9b768ac86bbaa475aa0422a564944be";

function unavailable(): never {
  throw new ServiceUnavailableException("对上已签合同来源暂时无法核对，请保留资料稍后办理");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 4294967295n;
}

export async function qualifyUpwardPendingCreate(tx: Prisma.TransactionClient,
  saveWitness?: Awaited<ReturnType<typeof qualifyUpwardPendingSave>>
) {
  try {
    const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      /* contract_upward_pending_create_catalog_v1 */
      WITH scope AS (
        SELECT n.oid AS ns, db.oid AS db, (session_user::regrole::oid) AS session_role, (current_user::regrole::oid) AS actor
        FROM pg_catalog.pg_namespace n CROSS JOIN pg_catalog.pg_database db
        WHERE n.nspname='public' AND db.datname=pg_catalog.current_database()
      ), installed AS (
        SELECT b.*,s.*,c.oid AS binding_rel,c.relowner AS owner
        FROM scope s JOIN public.jg_contract_direct_pending_binding_v1 b
          ON b."protocolVersion"=1 AND b."recipeVersion"='contract-direct-pending-input-v1/1'
          AND b."applicationRoleOid"=s.actor AND b."applicationRoleOid"=s.session_role
          AND b."databaseOid"=s.db AND b."anchorNamespaceOid"=s.ns
        JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.jg_contract_direct_pending_binding_v1')
          AND c.relnamespace=s.ns AND c.relowner=b."anchorOwnerOid"
          AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      ), attached AS (
        SELECT t.oid,t.tgfoid,t.tgname,p.prosrc
        FROM installed s JOIN pg_catalog.pg_trigger t ON t.tgname IN (
          'jg_direct_pending_version_shape','jg_direct_pending_attachment_source','jg_direct_pending_binding_immutable')
        JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid AND p.pronamespace=s.ns AND p.proowner=s.owner
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
        WHERE NOT t.tgisinternal AND t.tgenabled='O' AND NOT t.tgdeferrable AND NOT t.tginitdeferred
          AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
          AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
          AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proretset AND NOT p.proisstrict
          AND p.prorettype='pg_catalog.trigger'::regtype AND p.prokind='f' AND p.pronargs=0 AND p.proparallel='u'
          AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
          AND t.oid::text=s.bindings#>>ARRAY['triggers',t.tgname,'oid']
          AND t.tgfoid::text=s.bindings#>>ARRAY['triggers',t.tgname,'functionOid']
          AND ((t.tgname='jg_direct_pending_version_shape' AND t.tgtype=23 AND t.tgrelid=pg_catalog.to_regclass('public."ContractVersion"'))
            OR (t.tgname='jg_direct_pending_attachment_source' AND t.tgtype=23 AND t.tgrelid=pg_catalog.to_regclass('public."ContractDraftAttachment"'))
            OR (t.tgname='jg_direct_pending_binding_immutable' AND t.tgtype=31 AND t.tgrelid=s.binding_rel))
      )
      SELECT s.db::text AS "databaseOid",s.ns::text AS "namespaceOid",s.owner::text AS "ownerOid",
        s.actor::text AS "applicationRoleOid",s.session_role::text AS "sessionRoleOid",
        s.binding_rel::text AS "bindingOid",ub.oid::text AS "createBindingOid",previous.tableoid::text AS "dispatchBindingOid",
        u."versionTriggerOid"::text AS "versionTriggerOid",u."versionRoutineOid"::text AS "versionRoutineOid",
        u."attachmentTriggerOid"::text AS "attachmentTriggerOid",
        u."directDispatchSha256" AS "directDispatchSha256", h.oid::text AS "helperOid",
        encode(public.digest(convert_to(to_jsonb(u)::text,'UTF8'),'sha256'),'hex') AS "createBindingSha256",
        pg_catalog.pg_backend_pid() AS "backendPid",
        pg_catalog.txid_current()::text AS "transactionId",
        encode(public.digest(convert_to(h.prosrc,'UTF8'),'sha256'),'hex') AS "helperBody",
        (SELECT count(*)::int FROM attached) AS "triggerCount",
        (SELECT count(*)::int FROM pg_catalog.pg_trigger t WHERE t.tgrelid=ub.oid AND t.tgfoid=ug.oid
          AND NOT t.tgisinternal AND t.tgenabled='O' AND NOT t.tgdeferrable AND NOT t.tginitdeferred
          AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
          AND ((t.tgname='jg_upward_pending_create_binding_immutable' AND t.tgtype=31)
            OR (t.tgname='jg_upward_pending_create_binding_no_truncate' AND t.tgtype=34))) AS "createBindingTriggerCount",
        encode(public.digest(convert_to(ug.prosrc,'UTF8'),'sha256'),'hex') AS "createBindingBody",
        ((SELECT array_agg(format('%s:%s',a.attname,a.atttypid) ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a WHERE a.attrelid=ub.oid AND a.attnum>0 AND NOT a.attisdropped
            AND a.attnotnull AND a.attgenerated='' AND a.attidentity='' AND NOT a.atthasdef)
          = ARRAY['protocolVersion:23','applicationRoleOid:26','databaseOid:26','namespaceOid:26','ownerOid:26',
          'directDispatchSha256:25','versionTriggerOid:26','versionRoutineOid:26','attachmentTriggerOid:26','helperOid:26']
          AND 10=(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=ub.oid AND a.attnum>0 AND NOT a.attisdropped)
          AND 2=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=ub.oid)) AS "bindingShape",
        (SELECT encode(public.digest(convert_to(a.prosrc,'UTF8'),'sha256'),'hex')
          FROM attached a WHERE a.tgname='jg_direct_pending_version_shape') AS "versionBody",
        (SELECT encode(public.digest(convert_to(a.prosrc,'UTF8'),'sha256'),'hex')
          FROM attached a WHERE a.tgname='jg_direct_pending_attachment_source') AS "attachmentBody",
        (SELECT encode(public.digest(convert_to(a.prosrc,'UTF8'),'sha256'),'hex')
          FROM attached a WHERE a.tgname='jg_direct_pending_binding_immutable') AS "bindingBody",
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(s.actor,r.oid,'MEMBER') AND
          (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,s.owner,'MEMBER')
            OR pg_catalog.has_schema_privilege(r.oid,s.ns,'CREATE')
            OR pg_catalog.has_table_privilege(r.oid,s.binding_rel,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_table_privilege(r.oid,ub.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_table_privilege(r.oid,dp.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (s.binding_rel,ub.oid,dp.oid) AND a.attnum>0 AND NOT a.attisdropped
              AND pg_catalog.has_column_privilege(r.oid,a.attrelid,a.attnum,'INSERT,UPDATE,REFERENCES')))) AS "safeRole",
        pg_catalog.has_table_privilege(s.actor,ub.oid,'SELECT')
          AND (SELECT count(*) FROM pg_catalog.aclexplode(ub.relacl) a WHERE a.grantee<>s.owner)=1
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(ub.relacl) a
            WHERE a.grantor<>s.owner OR a.grantee<>s.owner AND
              (a.grantee<>s.actor OR a.privilege_type<>'SELECT' OR a.is_grantable))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=ub.oid
            AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) AS "privateRegistryRead",
        pg_catalog.has_function_privilege(s.actor,h.oid,'EXECUTE')
          AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(h.proacl) a
            WHERE a.grantee=s.actor AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
          AND (SELECT count(*) FROM pg_catalog.aclexplode(h.proacl) a WHERE a.grantee<>s.owner)=1
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(h.proacl,pg_catalog.acldefault('f',h.proowner))) a
            WHERE a.grantor<>s.owner OR a.grantee<>s.owner AND
              (a.grantee<>s.actor OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) AS "privateExecute"
      FROM installed s JOIN pg_catalog.pg_proc h ON h.oid=pg_catalog.to_regprocedure(
        'public.jg_guard_contract_upward_pending_create_v1(public."ContractVersion")')
        AND h.pronamespace=s.ns AND h.proowner=s.owner AND NOT h.prosecdef AND h.prokind='f'
        AND h.prorettype='public."ContractVersion"'::regtype AND h.provolatile='s' AND h.proparallel='u'
        AND NOT h.proretset AND NOT h.proisstrict AND h.pronargdefaults=0 AND h.provariadic=0
        AND h.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
      JOIN pg_catalog.pg_language l ON l.oid=h.prolang AND l.lanname='plpgsql'
      JOIN public.jg_contract_upward_pending_create_binding_v1 u
        ON u."protocolVersion"=1 AND u."applicationRoleOid"=s.actor
        AND u."databaseOid"=s.db AND u."namespaceOid"=s.ns AND u."ownerOid"=s.owner
        AND u."helperOid"=h.oid
        AND u."versionTriggerOid"=(SELECT a.oid FROM attached a WHERE a.tgname='jg_direct_pending_version_shape')
        AND u."versionRoutineOid"=(SELECT a.tgfoid FROM attached a WHERE a.tgname='jg_direct_pending_version_shape')
        AND u."attachmentTriggerOid"=(SELECT a.oid FROM attached a WHERE a.tgname='jg_direct_pending_attachment_source')
      JOIN public.jg_contract_direct_archive_dispatch_binding_v1 previous
        ON previous."protocolVersion"=1 AND previous."recipeVersion"='contract-direct-archive-dispatch-v1/1'
        AND previous."applicationRoleOid"=s.actor AND previous."databaseOid"=s.db AND previous."namespaceOid"=s.ns
        AND previous."anchorOwnerOid"=s.owner
        AND encode(public.digest(convert_to(to_jsonb(previous)::text,'UTF8'),'sha256'),'hex')=u."directDispatchSha256"
      JOIN pg_catalog.pg_class dp ON dp.oid=previous.tableoid AND dp.relnamespace=s.ns AND dp.relowner=s.owner
        AND dp.relkind='r' AND NOT dp.relrowsecurity AND NOT dp.relforcerowsecurity
      JOIN pg_catalog.pg_class ub ON ub.oid=u.tableoid AND ub.relnamespace=s.ns AND ub.relowner=s.owner
        AND ub.relkind='r' AND NOT ub.relrowsecurity AND NOT ub.relforcerowsecurity
      JOIN pg_catalog.pg_proc ug ON ug.oid=pg_catalog.to_regprocedure('public.jg_guard_upward_pending_create_binding_v1()')
        AND ug.pronamespace=s.ns AND ug.proowner=s.owner AND NOT ug.prosecdef AND NOT ug.proisstrict
        AND ug.prorettype='pg_catalog.trigger'::regtype AND ug.provolatile='v' AND ug.prokind='f'
        AND ug.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
    `);
    const row = rows.length === 1 ? record(rows[0]) : null;
    if (!row || !["databaseOid", "namespaceOid", "ownerOid", "applicationRoleOid", "sessionRoleOid", "bindingOid", "createBindingOid", "helperOid",
      "dispatchBindingOid", "versionTriggerOid", "versionRoutineOid", "attachmentTriggerOid"].every(key => oid(row[key]))
      || row.applicationRoleOid !== row.sessionRoleOid || row.applicationRoleOid === row.ownerOid
      || typeof row.backendPid !== "number" || !Number.isSafeInteger(row.backendPid) || row.backendPid <= 0
      || typeof row.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(row.transactionId)
      || typeof row.directDispatchSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.directDispatchSha256)
      || row.createBindingTriggerCount !== 2 || row.createBindingBody !== createBindingBody
      || row.triggerCount !== 3
      || row.bindingBody !== bindingBody || row.helperBody !== helperBody || row.safeRole !== true || row.privateExecute !== true
      || row.privateRegistryRead !== true || row.bindingShape !== true) unavailable();
    if (row.versionBody === UPWARD_SAVE_ROUTINE_BODIES.version && row.attachmentBody === UPWARD_SAVE_ROUTINE_BODIES.attachment) {
      const witness = saveWitness ?? await qualifyUpwardPendingSave(tx);
      const triggers = record(witness.triggerOids);
      if (!triggers || witness.createBindingSha256 !== row.createBindingSha256 || witness.createBindingOid !== row.createBindingOid
        || witness.versionRoutineOid !== row.versionRoutineOid || triggers.jg_direct_pending_version_shape !== row.versionTriggerOid
        || triggers.jg_direct_pending_attachment_source !== row.attachmentTriggerOid || witness.databaseOid !== row.databaseOid
        || witness.namespaceOid !== row.namespaceOid || witness.anchorOwnerOid !== row.ownerOid
        || witness.currentRoleOid !== row.applicationRoleOid || witness.sessionRoleOid !== row.sessionRoleOid
        || witness.backendPid !== row.backendPid || witness.transactionId !== row.transactionId) unavailable();
      return { ...row, saveWitness: witness };
    }
    if (row.versionBody !== UPWARD_CREATE_DISPATCH_BODY || row.attachmentBody !== attachmentBody || saveWitness) unavailable();
    return row;
  } catch {
    unavailable();
  }
}

export async function assertUpwardPendingCreateContinuity(
  tx: Prisma.TransactionClient, before: Awaited<ReturnType<typeof qualifyUpwardPendingCreate>>
) {
  if (!isDeepStrictEqual(before, await qualifyUpwardPendingCreate(tx))) unavailable();
}

export function upwardPendingCreateMarker() {
  return {
    protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
    enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null
  };
}
