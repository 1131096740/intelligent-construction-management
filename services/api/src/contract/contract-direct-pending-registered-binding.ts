import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

type Catalog = Record<string, unknown>;
const registry = "public.jg_file_business_binding_columns()";
const enforcer = "public.jg_enforce_exclusive_file_business_binding()";
const postPath = ["search_path=pg_catalog, public, pg_temp"];
const wrapperBody = "46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3";
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
export function projectRegisteredFileBinding(actual: Catalog, bound: Catalog, expected: Catalog, collisionAcls: Catalog, executor?: string): Catalog | null {
  const observed = record(actual.registeredFileBinding);
  if (!observed) return null;
  if (["alias","voucher","voucherGuard","fileTrigger"].every(key => observed[key] === null)) return {};
  const current = record(actual.routines), original = record(bound.routines);
  const oldRegistry = record(original?.[registry]), oldEnforcer = record(original?.[enforcer]);
  const alias = record(observed.alias), wrapper = record(current?.[registry]), enforce = record(current?.[enforcer]);
  const historicalAcl = (signature: string, row: Catalog | null) =>
    row && Object.hasOwn(collisionAcls, signature) ? { ...row, acl: collisionAcls[signature] } : row;
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
    || !isDeepStrictEqual(historicalAcl(enforcer,enforce),{...oldEnforcer,configuration:postPath})
    || !oid(wrapper.oid) || !oid(guard.oid) || wrapper.oid === guard.oid
    || Object.values(original ?? {}).some(value => [wrapper.oid,guard.oid].includes(record(value)?.oid as string))
    || !isDeepStrictEqual(wrapper,{...alias,oid:wrapper.oid,acl:wrapper.acl,bodySha256:wrapperBody})
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
