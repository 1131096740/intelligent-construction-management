import { readFileBindingCatalog } from "../database/registered-payment-catalog";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { projectCollisionExecuteAcls } from "./contract-direct-pending-collision-acl";
import { markTask12DirectSourceDiagnostic as mark } from "./task12-direct-source-diagnostic";

type Catalog = Record<string, unknown>;
const registry = "public.jg_file_business_binding_columns()";
const enforcer = "public.jg_enforce_exclusive_file_business_binding()";
const postPath = ["search_path=pg_catalog, public, pg_temp"];
const wrapperBody = "46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3";
// Registry generations that still pass the owner-settlement witness: the
// owner-settlement-only registry and the signed-change/settlement registry.
const settlementRegistryBodies: readonly string[] = [
  "6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f",
  "2a2b941651afd8763a7932f8ea110e845eb0851783ea86726b1da78ed20ded85"
];
const settlementPath = ["search_path=pg_catalog, public"];
const settlementEnforcerBody = "2525f5adb08dac1a782f8bb689c68fa2073f5b72c4cd13df26808fd4660e42b1";
const normalVoucherEnforcerBody = "2743ad737af5f75986dd94508e6e0d8a998c8a78b3ce08f023db56b2e7324505";
const a08DraftVoucherEnforcerBody = "c8b62d1c944bfbcdb541713bd366e2e148e530ea9fd5ea13200feb4372e3d915";
const registeredVoucherEnforcerBody = "c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b";
const outsidePairEnforcerBody = "07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29";
const outsideEvidenceEnforcerBody = "30d0ba55bb974923629f652d55b12ddfe53735a6bebaa69132b1ae0044ad467c";
const settlementEnforcerBodies: readonly string[] = [settlementEnforcerBody, normalVoucherEnforcerBody, a08DraftVoucherEnforcerBody, registeredVoucherEnforcerBody, outsidePairEnforcerBody, outsideEvidenceEnforcerBody];
const voucherGuardBody = "91b57f66e67bb1d888d1d0e8803cabbe08c289b01d2a6e810bfa69fe82a48d62";
const voucherColumns = ["executionId", "fileId", "uploadedByUserId", "contentSha256", "createdAt"];
const record = (value: unknown): Catalog | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Catalog : null;
const oid = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
const executorAcl = (owner: unknown, callers: unknown[]) => callers.map(caller => JSON.stringify([owner,caller,"EXECUTE",false])).sort();

export const registeredFileBindingCatalog = Prisma.sql`
  (WITH routines AS (
    SELECT watched.kind,p.oid,p.proowner,p.proacl,
      jsonb_build_object('oid',p.oid::text,'namespaceOid',p.pronamespace::text,'ownerOid',p.proowner::text,
        'bodySha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),'securityDefiner',p.prosecdef,
        'configuration',p.proconfig,'acl',p.proacl,'language',l.lanname,'returnType',t.typname,
        'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'returnsSet',p.proretset) AS metadata,
      (p.prokind='f' AND NOT p.proleakproof AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.prosqlbody IS NULL AND CASE WHEN watched.kind='voucherGuard' THEN p.proallargtypes IS NULL
        ELSE p.proallargtypes=ARRAY[25,25,16]::oid[] AND p.proargmodes=ARRAY['t','t','t']::"char"[]
          AND p.proargnames=ARRAY['tableName','columnName','exclusive']::text[] END) AS shape,
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
        ORDER BY a.grantor,a.grantee,a.privilege_type),'[]'::jsonb) FROM pg_catalog.aclexplode(
        CASE WHEN p.proacl IS NULL THEN pg_catalog.acldefault('f',p.proowner) WHEN cardinality(p.proacl)>0 THEN p.proacl END) a) AS acl
    FROM (VALUES ('alias','public.jg_file_business_binding_columns_before_registered_payment()'),
      ('wrapper','public.jg_file_business_binding_columns()'),
      ('settlementPrior','public.jg_file_business_binding_columns_before_owner_settlement()'),
      ('voucherGuard','public.jg_registered_payment_voucher_file_immutable()')) watched(kind,signature)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(watched.signature)
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_type t ON t.oid=p.prorettype
  ), access_roles AS (
    SELECT oid FROM caller_roles UNION SELECT g.grantee FROM routines r
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(r.proacl)>0 THEN r.proacl END) g
    WHERE r.kind='wrapper' AND g.grantee<>0
  ), voucher AS (
    SELECT c.* FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public."RegisteredPaymentVoucher"')
  ), voucher_columns AS (
    SELECT a.* FROM voucher v JOIN pg_catalog.pg_attribute a ON a.attrelid=v.oid AND a.attnum>0 AND NOT a.attisdropped
  ), hooks AS (
    SELECT watched.kind,jsonb_build_object('oid',t.oid::text,'functionOid',t.tgfoid::text,
      'shape',t.tgtype=watched.flags AND t.tgenabled='O' AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
        AND t.tgqual IS NULL AND t.tgconstraint=0 AND t.tgattr::text='' AND t.tgnargs=watched.nargs
        AND encode(t.tgargs,'hex')=watched.args AND t.tgnewtable IS NULL AND t.tgoldtable IS NULL) AS proof
    FROM (VALUES ('file','public."FileObject"','RegisteredPaymentVoucher_file_immutable',27,0,''),
      ('voucher','public."RegisteredPaymentVoucher"','jg_efb_registered_payment_voucher',7,2,'66696c654964007472756500'))
      watched(kind,relation,name,flags,nargs,args)
    JOIN pg_catalog.pg_trigger t ON t.tgrelid=pg_catalog.to_regclass(watched.relation) AND t.tgname=watched.name
  )
  SELECT jsonb_build_object(
    'alias',(SELECT metadata FROM routines WHERE kind='alias'),'aliasShape',(SELECT shape FROM routines WHERE kind='alias'),
    'wrapperShape',(SELECT shape FROM routines WHERE kind='wrapper'),'wrapperAcl',(SELECT acl FROM routines WHERE kind='wrapper'),
    'settlementPrior',(SELECT metadata FROM routines WHERE kind='settlementPrior'),
    'settlementPriorShape',(SELECT shape FROM routines WHERE kind='settlementPrior'),
    'voucherGuard',(SELECT metadata FROM routines WHERE kind='voucherGuard'),
    'voucherGuardShape',(SELECT shape FROM routines WHERE kind='voucherGuard'),
    'voucherGuardAcl',(SELECT acl FROM routines WHERE kind='voucherGuard'),
    'fileTrigger',(SELECT proof FROM hooks WHERE kind='file'),
    'voucher',(SELECT jsonb_build_object('oid',v.oid::text,'namespaceOid',v.relnamespace::text,'ownerOid',v.relowner::text,
      'shape',v.relkind='r' AND v.relpersistence='p' AND NOT (v.relispartition OR v.relrowsecurity OR v.relforcerowsecurity)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=v.oid OR i.inhparent=v.oid),
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'typeOid',a.atttypid::text,
        'typeModifier',a.atttypmod,'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(g.grantor::text,g.grantee::text,g.privilege_type,g.is_grantable)
          ORDER BY g.grantor,g.grantee,g.privilege_type),'[]'::jsonb)
          FROM pg_catalog.aclexplode(CASE WHEN cardinality(a.attacl)>0 THEN a.attacl END) g)) ORDER BY a.attnum) FROM voucher_columns a),
      'fileKey',EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=v.oid AND k.contype='u' AND k.convalidated
        AND NOT k.condeferrable AND k.conkey=ARRAY[2]::smallint[])
        AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute f
          ON f.attrelid=k.confrelid AND f.attname='id' AND f.attnum>0 AND NOT f.attisdropped
          WHERE k.conrelid=v.oid AND k.confrelid=pg_catalog.to_regclass('public."FileObject"')
          AND k.conname='RegisteredPaymentVoucher_fileId_fkey' AND k.contype='f' AND k.convalidated
          AND NOT (k.condeferrable OR k.condeferred) AND k.confupdtype='r' AND k.confdeltype='r'
          AND k.conkey=ARRAY[2]::smallint[] AND k.confkey=ARRAY[f.attnum]),
      'tableAclOwnerOnly',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(
        CASE WHEN v.relacl IS NULL THEN pg_catalog.acldefault('r',v.relowner) WHEN cardinality(v.relacl)>0 THEN v.relacl END) a
        WHERE a.grantor<>v.relowner OR a.grantee<>v.relowner),
      'exclusiveTrigger',(SELECT proof FROM hooks WHERE kind='voucher')) FROM voucher v),
    'callerAccess',(SELECT jsonb_agg(jsonb_build_object('oid',caller.oid::text,
      'aliasExecute',pg_catalog.has_function_privilege(caller.oid,(SELECT oid FROM routines WHERE kind='alias'),'EXECUTE'),
      'wrapperExecute',pg_catalog.has_function_privilege(caller.oid,(SELECT oid FROM routines WHERE kind='wrapper'),'EXECUTE'),
      'voucherSelect',ARRAY(SELECT a.attname FROM voucher_columns a
        WHERE EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE pg_catalog.pg_has_role(caller.oid,role.oid,'MEMBER')
          AND pg_catalog.has_column_privilege(role.oid,a.attrelid,a.attnum,'SELECT')) ORDER BY a.attname COLLATE "C"),
      'broadVoucherAccess',EXISTS(SELECT 1 FROM voucher v JOIN pg_catalog.pg_roles role
        ON pg_catalog.pg_has_role(caller.oid,role.oid,'MEMBER')
        WHERE pg_catalog.has_table_privilege(role.oid,v.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(role.oid,v.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION'))
        ) ORDER BY caller.oid) FROM access_roles caller))
  )
`;

function hasExactExecute(value: unknown, owner: unknown, roles: unknown[]): boolean {
  return Array.isArray(value) && isDeepStrictEqual(value.map(row => JSON.stringify(row)).sort(),executorAcl(owner,roles));
}

function validVoucherRead(column: Catalog, owner: unknown, roles: string[], allowed: (role: string) => boolean): boolean {
  const acl = column.acl;
  if (!Array.isArray(acl) || acl.some(grant => !Array.isArray(grant) || grant.length !== 4 || !oid(grant[1]))) return false;
  return roles.every(role => {
    const entries = acl.filter(grant => grant[1] === role);
    const directRead = isDeepStrictEqual(entries,[[owner,role,"SELECT",false]]);
    return column.name === "fileId" ? directRead : entries.length === 0 || (allowed(role) && directRead);
  });
}

/** Only a complete B6 cut may project the two exact changes back to the immutable 205 binding. */
export function projectRegisteredFileBinding(actual: Catalog, bound: Catalog, expected: Catalog, collisionAcls: Catalog, executor?: string, ownerSettlementVoucher = false): Catalog | null {
  const observed = record(actual.registeredFileBinding);
  if (!observed) return null;
  const prior = record(observed.settlementPrior);
  if (observed.settlementPrior != null && !prior) return null;
  if (!prior && ["alias","voucher","voucherGuard","fileTrigger"].every(key => observed[key] === null)) return {};
  const current = record(actual.routines), original = record(bound.routines);
  const oldRegistry = record(original?.[registry]), oldEnforcer = record(original?.[enforcer]);
  const alias = record(observed.alias), wrapper = record(current?.[registry]), enforce = record(current?.[enforcer]);
  const historicalAcl = (signature: string, row: Catalog | null) =>
    row && Object.hasOwn(collisionAcls, signature) ? { ...row, acl: collisionAcls[signature] } : row;
  const settlement = prior !== null;
  const settlementRegistryBody = record(wrapper)?.bodySha256;
  const enforcerBody = settlement ? enforce?.bodySha256 : oldEnforcer?.bodySha256;
  if (settlement && (!ownerSettlementVoucher || observed.settlementPriorShape !== true ||
    !alias || !wrapper || !oid(prior.oid) || prior.oid === wrapper.oid ||
    Object.values(original ?? {}).some(value => record(value)?.oid === prior.oid) ||
    !isDeepStrictEqual(prior, { ...alias, oid: prior.oid, acl: wrapper.acl, bodySha256: wrapperBody }) ||
    (typeof settlementRegistryBody !== "string" || !settlementRegistryBodies.includes(settlementRegistryBody)) ||
    (typeof enforcerBody !== "string" || !settlementEnforcerBodies.includes(enforcerBody)))) return null;
  const guard = record(observed.voucherGuard), voucher = record(observed.voucher);
  const fileTrigger = record(observed.fileTrigger), exclusive = record(voucher?.exclusiveTrigger);
  const owner = expected.anchorOwnerOid, namespace = expected.anchorNamespaceOid;
  const fileCallers = [...new Set([expected.applicationRoleOid,...(expected.fileCallerOids as unknown[])])];
  const accessRoles = [...new Set([...fileCallers,owner,...(executor ? [executor] : [])])];
  const roles = accessRoles.filter(role => role !== owner).filter(oid);
  if (!oldRegistry || !oldEnforcer || !alias || !wrapper || !enforce || !guard || !voucher || !fileTrigger || !exclusive
    || !oid(owner) || !oid(namespace) || fileCallers.some(role => !oid(role))
    || oldRegistry.ownerOid !== owner || oldRegistry.namespaceOid !== namespace
    || observed.aliasShape !== true || observed.wrapperShape !== true || observed.voucherGuardShape !== true
    || !isDeepStrictEqual(historicalAcl(registry,alias),{...oldRegistry,configuration:postPath})
    || !isDeepStrictEqual(historicalAcl(enforcer,enforce),{...oldEnforcer,configuration:postPath,...(settlement ? { bodySha256: enforcerBody } : {})})
    || !oid(wrapper.oid) || !oid(guard.oid) || wrapper.oid === guard.oid || prior?.oid === guard.oid
    || Object.values(original ?? {}).some(value => [wrapper.oid,guard.oid].includes(record(value)?.oid as string))
    || !isDeepStrictEqual(wrapper,{...alias,oid:wrapper.oid,acl:wrapper.acl,bodySha256:settlement?settlementRegistryBody:wrapperBody,configuration:settlement?settlementPath:postPath})
    || !hasExactExecute(observed.wrapperAcl,owner,[owner,...roles])
    || guard.ownerOid !== owner || guard.namespaceOid !== namespace || guard.bodySha256 !== voucherGuardBody
    || !isDeepStrictEqual(guard.configuration,postPath) || guard.language !== "plpgsql" || guard.returnType !== "trigger"
    || guard.volatility !== "v" || guard.parallel !== "u" || guard.strict !== false || guard.returnsSet !== false || guard.securityDefiner !== false
    || !hasExactExecute(observed.voucherGuardAcl,owner,[owner])
    || !oid(fileTrigger.oid) || fileTrigger.functionOid !== guard.oid || fileTrigger.shape !== true
    || !oid(exclusive.oid) || exclusive.oid === fileTrigger.oid || exclusive.functionOid !== oldEnforcer.oid || exclusive.shape !== true
    || !oid(voucher.oid) || voucher.namespaceOid !== namespace || voucher.ownerOid !== owner || voucher.shape !== true
    || voucher.fileKey !== true || voucher.tableAclOwnerOnly !== true) return null;
  const extraAppReads = ["executionId","contentSha256"];
  const columns = voucher.columns;
  if (!Array.isArray(columns) || columns.length !== voucherColumns.length || columns.some((raw,index) => {
    const column = record(raw);
    return !column || column.name !== voucherColumns[index] || column.number !== index+1
      || column.typeOid !== (index===4 ? "1114" : "25") || column.typeModifier !== (index===4 ? 3 : -1) || column.notNull !== true || column.generated !== "" || column.identity !== ""
      || !validVoucherRead(column,owner,roles,role => role === expected.applicationRoleOid && extraAppReads.includes(String(column.name)));
  })) return null;
  const access = observed.callerAccess;
  if (!Array.isArray(access) || access.length !== accessRoles.length
    || accessRoles.some(role => {
      const found = access.map(record).filter(entry => entry?.oid === role);
      const row = found[0];
      return found.length !== 1 || !row || row.aliasExecute !== true || row.wrapperExecute !== true
        || (role !== owner && (row.broadVoucherAccess !== false || !Array.isArray(row.voucherSelect) || !row.voucherSelect.includes("fileId")
          || row.voucherSelect.some(column => column !== "fileId" && !(role === expected.applicationRoleOid && extraAppReads.includes(column)))));
    })) return null;
  return { [registry]: oldRegistry, [enforcer]: oldEnforcer };
}

const witnessKey = Symbol("registeredExclusiveWitness");
export type RegisteredExclusiveWitness = Readonly<{
  [witnessKey]: true;
  transaction: Prisma.TransactionClient;
  routineOid: string;
  triggerOid: string;
  successorBodySha256?: string;
}>;

export function registeredExclusiveOids(tx: Prisma.TransactionClient, witness?: RegisteredExclusiveWitness) {
  return witness?.[witnessKey] === true && witness.transaction === tx ? witness : undefined;
}

export async function qualifyDirectPendingFileBinding(
  tx: Prisma.TransactionClient, actual: Catalog, bound: Catalog, expected: Catalog, bootstrap: Catalog,
  native: Parameters<typeof projectCollisionExecuteAcls>[4]
) {
  const original = record(bound.routines);
  if (!original) return null;
  mark("COLLISION_ACL");
  const collisionAcls = await projectCollisionExecuteAcls(tx, actual, original, bootstrap, native);
  if (!collisionAcls) return null;
  mark("FILE_BINDING");
  const settlementInstalled = record(record(actual.registeredFileBinding)?.settlementPrior) !== null;
  const settlement = settlementInstalled ? await readFileBindingCatalog(tx) : null;
  const fileBinding = projectRegisteredFileBinding(actual, bound, expected, collisionAcls, native?.executorOwnerOid,
    settlement?.registeredPayment === true && settlement.ownerSettlementVoucher === true);
  if (!fileBinding) return null;

  const routineOid = record(fileBinding[enforcer])?.oid;
  const directAttachment = record(record(bound.triggers)?.jg_direct_pending_attachment_exclusive);
  const triggerOid = directAttachment?.oid;
  if (Object.hasOwn(fileBinding, enforcer) && (!oid(routineOid) || !oid(triggerOid) || directAttachment?.functionOid !== routineOid)) return null;
  const liveBody = record(record(actual.routines)?.[enforcer])?.bodySha256;
  const successorBodySha256 = settlementInstalled &&
    typeof liveBody === "string" && settlementEnforcerBodies.includes(liveBody) ? liveBody : undefined;
  const exclusive: RegisteredExclusiveWitness | undefined = oid(routineOid) && oid(triggerOid)
    ? Object.freeze({ [witnessKey]: true as const, transaction: tx, routineOid, triggerOid, ...(successorBodySha256 ? { successorBodySha256 } : {}) })
    : undefined;
  return { collisionAcls, fileBinding, exclusive };
}
