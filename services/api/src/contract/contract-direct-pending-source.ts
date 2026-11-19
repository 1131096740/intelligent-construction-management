import { discoverUpwardLegacyProjection, isQualifiedUpwardDefiner } from "./contract-upward-archive-catalog";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { readDirectArchiveTransitionOid, readPreparedDirectArchiveTransition } from "./contract-direct-archive-transition";
import { readDirectArchiveRetentionOid, readDirectArchiveRetentionQualification } from "./contract-direct-archive-retention-qualification";
import { readDirectArchiveDispatchOid, readDirectArchiveDispatchQualification } from "./contract-direct-archive-dispatch-qualification";
import { hasGeneratedUpwardOperatingInstallation, outsideFactAppendBody } from "./contract-generated-upward-operating-installation";
import { directInputSignature } from "./contract-direct-archive-native-admission";
import { DIRECT_PENDING_DB_RECIPE } from "./contract-direct-pending-recipe";
import { projectCollisionExecuteAcls } from "./contract-direct-pending-collision-acl";
import { projectRegisteredFileBinding, registeredFileBindingCatalog } from "./contract-direct-pending-registered-binding";

type ObjectValue = Record<string, unknown>;
const factAppendSignature = 'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",pg_catalog.text,pg_catalog.text)';
function object(value: unknown): ObjectValue | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null; }
function oid(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 4294967295n; }
function unavailable(): never { throw new ServiceUnavailableException("已签合同来源资格尚未完整供应或已变化，请保留原件稍后办理"); }
function configuredSearchPath(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string" || !value[0].startsWith("search_path=")) unavailable();
  return value[0].slice("search_path=".length).split(",").map(part => part.trim());
}

/** Presence fails closed even when the persisted marker has malformed fields. */
export function hasDirectSigningInput(draftData: unknown): boolean {
  return !!draftData && typeof draftData === "object" && !Array.isArray(draftData) && Object.prototype.hasOwnProperty.call(draftData, "directSigningInput");
}

interface DirectPendingSourceQualification {
  environment: ObjectValue; bootstrap: ObjectValue; expected: ObjectValue; actual: ObjectValue;
  transition: Awaited<ReturnType<typeof readPreparedDirectArchiveTransition>> | null;
  retention: Awaited<ReturnType<typeof readDirectArchiveRetentionQualification>> | null;
  dispatch: Awaited<ReturnType<typeof readDirectArchiveDispatchQualification>> | null;
}

function assertDeparseEnvironment(value: unknown): ObjectValue {
  const environment = object(value);
  if (!environment || Object.keys(environment).sort().join(",") !== "catalogTextTypeOid,quoteAllIdentifiers,searchSchemas,temporarySchemaName,textTypeOid"
    || environment.quoteAllIdentifiers !== "off" || environment.textTypeOid !== "25" || environment.catalogTextTypeOid !== "25"
    || typeof environment.temporarySchemaName !== "string" || !(environment.temporarySchemaName === "-" || /^pg_temp_[0-9]+$/u.test(environment.temporarySchemaName))
    || !Array.isArray(environment.searchSchemas) || environment.searchSchemas.some(name => typeof name !== "string")) unavailable();
  // "-" represents OID zero; a real quoted schema named "-" must remain in the path.
  const operatorPath = environment.temporarySchemaName === "-" ? environment.searchSchemas
    : environment.searchSchemas.filter(name => name !== environment.temporarySchemaName);
  if (operatorPath[0] !== "pg_catalog") unavailable();
  return environment;
}
async function readDeparseEnvironment(tx: Prisma.TransactionClient): Promise<ObjectValue> {
  // No operator/relation lookup is needed before this independent premise check.
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT pg_catalog.current_schemas(true)::pg_catalog.text[] AS "searchSchemas",
      pg_catalog.pg_my_temp_schema()::pg_catalog.regnamespace::pg_catalog.text AS "temporarySchemaName",
      pg_catalog.to_regtype('text')::pg_catalog.oid::pg_catalog.text AS "textTypeOid",
      pg_catalog.to_regtype('pg_catalog.text')::pg_catalog.oid::pg_catalog.text AS "catalogTextTypeOid",
      pg_catalog.current_setting('quote_all_identifiers') AS "quoteAllIdentifiers"
  `);
  return assertDeparseEnvironment(rows.length === 1 ? rows[0] : null);
}

async function readBindingCatalog(tx: Prisma.TransactionClient): Promise<ObjectValue> {
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT jsonb_build_object(
      'bindingRelationOid', c.oid::text, 'bindingNamespaceOid',c.relnamespace::text,'bindingOwnerOid',c.relowner::text,
      'bindingKind',c.relkind,'bindingRls',c.relrowsecurity,'bindingForceRls',c.relforcerowsecurity,
      'anchorOwnerOid',anchor.proowner::text,'anchorSourceSha256',encode(public.digest(convert_to(anchor.prosrc,'UTF8'),'sha256'),'hex'),
      'anchorDefiner',anchor.prosecdef,'namespaceOid',ns.oid::text,'databaseOid',db.oid::text,
      'sessionRoleOid',(session_user::regrole::oid)::text,'currentRoleOid',(current_user::regrole::oid)::text,
      'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text,
      'unsafeRuntimeRole',EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER') AND
        (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER')
          OR pg_catalog.has_schema_privilege(r.oid,ns.oid,'CREATE') OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute at WHERE at.attrelid=c.oid AND at.attnum>0 AND NOT at.attisdropped AND pg_catalog.has_column_privilege(r.oid,c.oid,at.attnum,'INSERT,UPDATE,REFERENCES')))),
      'bindingColumns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',t.typname,'number',a.attnum,'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    ) AS catalog
    FROM pg_catalog.pg_database db JOIN pg_catalog.pg_namespace ns ON ns.nspname='public'
    LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.jg_contract_direct_pending_binding_v1') AND c.relnamespace=ns.oid
    LEFT JOIN pg_catalog.pg_proc anchor ON anchor.oid=pg_catalog.to_regprocedure('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)')
    WHERE db.datname=pg_catalog.current_database()
  `);
  const value = rows.length === 1 ? object(object(rows[0])?.catalog) : null;
  const anchor = DIRECT_PENDING_DB_RECIPE.routines.find(entry => entry.signature === factAppendSignature);
  if (!value || !oid(value.bindingRelationOid) || !oid(value.bindingNamespaceOid) || !oid(value.bindingOwnerOid) || !oid(value.anchorOwnerOid)
    || value.bindingOwnerOid !== value.anchorOwnerOid || value.bindingNamespaceOid !== value.namespaceOid || value.bindingKind !== "r"
    || value.bindingRls !== false || value.bindingForceRls !== false || value.anchorDefiner !== true
    || value.unsafeRuntimeRole !== false || !oid(value.sessionRoleOid) || value.sessionRoleOid !== value.currentRoleOid
    || !Number.isInteger(value.backendPid) || typeof value.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(value.transactionId)) unavailable();
  if (value.anchorSourceSha256 !== anchor?.bodySha256 && (value.anchorSourceSha256 !== outsideFactAppendBody
    || !await hasGeneratedUpwardOperatingInstallation(tx, value, true))) unavailable();
  const names = ["protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings"];
  const types = ["int4","text","oid","_oid","oid","oid","oid","jsonb"];
  if (!Array.isArray(value.bindingColumns) || value.bindingColumns.length !== names.length || value.bindingColumns.some((raw, index) => {
    const column = object(raw); return !column || column.name !== names[index] || column.type !== types[index] || column.number !== index+1 || column.notNull !== true || column.generated !== "" || column.identity !== "";
  })) unavailable();
  return value;
}

async function readExpectedBinding(tx: Prisma.TransactionClient): Promise<ObjectValue> {
  // No FOR SHARE: the application remains SELECT-only. Natural ACCESS SHARE
  // plus controlled stop-write migrations is not a concurrent-DDL proof.
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT "protocolVersion","recipeVersion","applicationRoleOid"::text AS "applicationRoleOid",
      ARRAY(SELECT role_oid::text FROM unnest("fileCallerOids") AS f(role_oid) ORDER BY role_oid) AS "fileCallerOids",
      "databaseOid"::text AS "databaseOid","anchorNamespaceOid"::text AS "anchorNamespaceOid","anchorOwnerOid"::text AS "anchorOwnerOid","bindings"
    FROM public.jg_contract_direct_pending_binding_v1 WHERE "protocolVersion"=1
  `);
  const value = rows.length === 1 ? object(rows[0]) : null;
  if (!value || value.protocolVersion !== 1 || value.recipeVersion !== DIRECT_PENDING_DB_RECIPE.recipeVersion || !oid(value.applicationRoleOid)
    || !oid(value.databaseOid) || !oid(value.anchorNamespaceOid) || !oid(value.anchorOwnerOid) || !Array.isArray(value.fileCallerOids)
    || !value.fileCallerOids.length || value.fileCallerOids.some(id => !oid(id)) || new Set(value.fileCallerOids).size !== value.fileCallerOids.length
    || !object(value.bindings)) unavailable();
  return value;
}

async function readActualCatalog(tx: Prisma.TransactionClient, expected: ObjectValue): Promise<ObjectValue> {
  const request = { recipe: DIRECT_PENDING_DB_RECIPE, fileCallerOids: expected.fileCallerOids };
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    WITH requested AS (SELECT ${JSON.stringify(request)}::jsonb AS spec),
    selected_tables AS (SELECT key AS name FROM requested,jsonb_each((spec#>'{recipe,sourceReads}')||(spec#>'{recipe,attachmentReads}')||(spec#>'{recipe,legacyRetentionReads}')) UNION SELECT 'jg_contract_direct_pending_binding_v1'),
    selected_routines AS (SELECT item FROM requested,jsonb_array_elements(spec#>'{recipe,routines}') item),
    relation_observations AS (
      SELECT t.name,c.oid,c.relnamespace,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
        (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'typeOid',a.atttypid::text,'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity) ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
      FROM selected_tables t LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(format('public.%I',t.name))
    ), routine_observations AS (
      SELECT r.item->>'signature' AS signature,p.oid,p.pronamespace,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.provolatile,p.proparallel,p.proisstrict,p.proretset,
        l.lanname,t.typname AS return_type,encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS body_sha
      FROM selected_routines r LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(r.item->>'signature')
        LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang LEFT JOIN pg_catalog.pg_type t ON t.oid=p.prorettype
    ), caller_roles AS (SELECT current_user::regrole::oid AS oid UNION SELECT value::oid FROM requested,jsonb_array_elements_text(spec->'fileCallerOids')),
    read_requirements AS (
      SELECT current_user::regrole::oid AS role_oid,entry.key AS table_name,col.value AS column_name
      FROM requested,jsonb_each(spec#>'{recipe,sourceReads}') entry,jsonb_array_elements_text(entry.value) col
      UNION SELECT current_user::regrole::oid,entry.key,col.value FROM requested,jsonb_each(spec#>'{recipe,attachmentReads}') entry,jsonb_array_elements_text(entry.value) col
      UNION SELECT cr.oid,entry.key,col.value FROM requested,caller_roles cr,jsonb_each(spec#>'{recipe,legacyRetentionReads}') entry,jsonb_array_elements_text(entry.value) col
    )
    SELECT jsonb_build_object(
      'relations',(SELECT jsonb_object_agg(name,jsonb_build_object('oid',oid::text,'namespaceOid',relnamespace::text,'ownerOid',relowner::text,'columns',columns)) FROM relation_observations),
      'routines',(SELECT jsonb_object_agg(signature,jsonb_build_object('oid',oid::text,'namespaceOid',pronamespace::text,'ownerOid',proowner::text,'bodySha256',body_sha,'securityDefiner',prosecdef,'configuration',proconfig,'acl',proacl,'language',lanname,'returnType',return_type,'volatility',provolatile,'parallel',proparallel,'strict',proisstrict,'returnsSet',proretset)) FROM routine_observations),
      'deparseEnvironment',jsonb_build_object('searchSchemas',pg_catalog.current_schemas(true),'temporarySchemaName',pg_catalog.pg_my_temp_schema()::pg_catalog.regnamespace::pg_catalog.text,'textTypeOid',pg_catalog.to_regtype('text')::pg_catalog.oid::pg_catalog.text,'catalogTextTypeOid',pg_catalog.to_regtype('pg_catalog.text')::pg_catalog.oid::pg_catalog.text,'quoteAllIdentifiers',pg_catalog.current_setting('quote_all_identifiers')),
      'triggerDefinitionReadable',NOT EXISTS(SELECT 1 FROM requested,jsonb_array_elements_text(spec#>'{recipe,applicationCatalogExecSignatures}') fn WHERE pg_catalog.has_function_privilege(current_user::regrole::oid,pg_catalog.to_regprocedure(fn.value),'EXECUTE') IS DISTINCT FROM TRUE),
      'schemaUsage',NOT EXISTS(SELECT 1 FROM caller_roles WHERE NOT pg_catalog.has_schema_privilege(oid,'public','USAGE')),
      'catalogReadable',NOT EXISTS(SELECT 1 FROM caller_roles cr WHERE NOT pg_catalog.has_schema_privilege(cr.oid,'pg_catalog','USAGE'))
        AND NOT EXISTS(SELECT 1 FROM caller_roles cr,requested,jsonb_array_elements_text(spec#>'{recipe,catalogGuardReads,pg_catalog.pg_class}') col WHERE NOT pg_catalog.has_column_privilege(cr.oid,'pg_catalog.pg_class'::regclass,col.value,'SELECT'))
        AND NOT EXISTS(SELECT 1 FROM caller_roles cr,requested,jsonb_array_elements_text(spec#>'{recipe,catalogGuardFunctions}') fn WHERE NOT pg_catalog.has_function_privilege(cr.oid,pg_catalog.to_regprocedure(fn.value),'EXECUTE')),
      'allColumnsReadable',NOT EXISTS(SELECT 1 FROM read_requirements WHERE NOT pg_catalog.has_column_privilege(role_oid,pg_catalog.to_regclass(format('public.%I',table_name)),column_name,'SELECT')),
      'rlsAbsent',NOT EXISTS(SELECT 1 FROM relation_observations WHERE oid IS NULL OR relkind<>'r' OR relrowsecurity OR relforcerowsecurity),
      'routineExecutable',NOT EXISTS(SELECT 1 FROM routine_observations,requested WHERE spec#>'{recipe,applicationExecSignatures}' ? signature AND (oid IS NULL OR NOT pg_catalog.has_function_privilege(current_user::regrole::oid,oid,'EXECUTE')))
        AND NOT EXISTS(SELECT 1 FROM caller_roles cr,requested,jsonb_array_elements_text(spec#>'{recipe,fileExecSignatures}') fn WHERE NOT pg_catalog.has_function_privilege(cr.oid,pg_catalog.to_regprocedure(fn.value),'EXECUTE')),
      'digestExecutable',NOT EXISTS(SELECT 1 FROM caller_roles WHERE NOT pg_catalog.has_function_privilege(oid,'public.digest(bytea,text)'::regprocedure,'EXECUTE')),
      'builtinsExecutable',NOT EXISTS(SELECT 1 FROM requested,pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND spec#>'{recipe,builtinNames}' ? p.proname AND NOT pg_catalog.has_function_privilege(current_user::regrole::oid,p.oid,'EXECUTE'))
        AND NOT EXISTS(SELECT 1 FROM requested,jsonb_array_elements_text(spec#>'{recipe,builtinNames}') required WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname=required.value))
        AND NOT EXISTS(SELECT 1 FROM requested,pg_catalog.pg_operator op JOIN pg_catalog.pg_namespace n ON n.oid=op.oprnamespace LEFT JOIN pg_catalog.pg_type l ON l.oid=op.oprleft LEFT JOIN pg_catalog.pg_type r ON r.oid=op.oprright WHERE n.nspname='pg_catalog' AND spec#>'{recipe,operatorNames}' ? op.oprname AND spec#>'{recipe,operatorTypeNames}' ? l.typname AND spec#>'{recipe,operatorTypeNames}' ? r.typname AND NOT pg_catalog.has_function_privilege(current_user::regrole::oid,op.oprcode,'EXECUTE'))
        AND NOT EXISTS(SELECT 1 FROM requested,pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='pg_catalog' AND spec#>'{recipe,operatorTypeNames}' ? t.typname AND (NOT pg_catalog.has_function_privilege(current_user::regrole::oid,t.typinput,'EXECUTE') OR NOT pg_catalog.has_function_privilege(current_user::regrole::oid,t.typoutput,'EXECUTE'))),
      'attachmentFileLockable',pg_catalog.has_any_column_privilege(current_user::regrole::oid,'public."FileObject"'::regclass,'UPDATE') AND pg_catalog.has_function_privilege(current_user::regrole::oid,'pg_catalog.pg_advisory_xact_lock(integer,integer)'::regprocedure,'EXECUTE'),
      'originalNumberWritable',pg_catalog.has_column_privilege(current_user::regrole::oid,'public."ContractVersion"'::regclass,'originalSignedNumber','INSERT') AND pg_catalog.has_column_privilege(current_user::regrole::oid,'public."ContractVersion"'::regclass,'originalSignedNumber','UPDATE'),
      'originalNumberNonunique',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attname='originalSignedNumber' WHERE i.indrelid='public."ContractVersion"'::regclass AND i.indisunique AND a.attnum=ANY(i.indkey)),
      'noCallerObjectOwnership',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles member WHERE pg_catalog.pg_has_role(current_user::regrole::oid,member.oid,'MEMBER') AND
        (member.rolsuper OR member.rolcreaterole OR member.rolbypassrls OR member.rolreplication OR pg_catalog.has_schema_privilege(member.oid,'public','CREATE')
          OR member.oid IN (SELECT relowner FROM relation_observations UNION SELECT proowner FROM routine_observations))),
      'noBindingWrite',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles member WHERE pg_catalog.pg_has_role(current_user::regrole::oid,member.oid,'MEMBER') AND
        (pg_catalog.has_table_privilege(member.oid,'public.jg_contract_direct_pending_binding_v1'::regclass,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.jg_contract_direct_pending_binding_v1'::regclass AND a.attnum>0 AND NOT a.attisdropped AND pg_catalog.has_column_privilege(member.oid,a.attrelid,a.attnum,'INSERT,UPDATE,REFERENCES')))),
      'noBindingGrantOption',NOT EXISTS(SELECT 1 FROM (SELECT acl.grantee,acl.is_grantable FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl WHERE c.oid='public.jg_contract_direct_pending_binding_v1'::regclass UNION ALL SELECT acl.grantee,acl.is_grantable FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE a.attrelid='public.jg_contract_direct_pending_binding_v1'::regclass AND a.attnum>0 AND NOT a.attisdropped) rights WHERE rights.is_grantable AND CASE WHEN rights.grantee=0 THEN TRUE ELSE pg_catalog.pg_has_role(current_user::regrole::oid,rights.grantee,'MEMBER') END),
      'triggers',(SELECT jsonb_object_agg(item->>'name',jsonb_build_object('oid',tg.oid::text,'relationOid',tg.tgrelid::text,'functionOid',tg.tgfoid::text,'type',tg.tgtype,'enabled',tg.tgenabled,'deferrable',tg.tgdeferrable,'initiallyDeferred',tg.tginitdeferred,'hasCondition',tg.tgqual IS NOT NULL,'definition',CASE WHEN tg.tgqual IS NULL THEN NULL ELSE pg_catalog.pg_get_triggerdef(tg.oid,false) END,'internal',tg.tgisinternal,'argumentCount',tg.tgnargs,'attributes',tg.tgattr::text,'arguments',encode(tg.tgargs,'hex'))) FROM requested,jsonb_array_elements(spec#>'{recipe,triggers}') item LEFT JOIN pg_catalog.pg_trigger tg ON tg.tgrelid=pg_catalog.to_regclass(format('public.%I',item->>'table')) AND tg.tgname=item->>'name'),
      'registeredFileBinding',${registeredFileBindingCatalog},
      'accessibleDefiners',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',p.oid::text,'signature',p.oid::regprocedure::text,'bodySha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')) ORDER BY p.oid),'[]'::jsonb)
        FROM pg_catalog.pg_proc p WHERE p.prosecdef AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles member WHERE pg_catalog.pg_has_role(current_user::regrole::oid,member.oid,'MEMBER') AND pg_catalog.has_function_privilege(member.oid,p.oid,'EXECUTE'))),
      'sessionRoleOid',(session_user::regrole::oid)::text,'currentRoleOid',(current_user::regrole::oid)::text,'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text
    ) AS actual
  `);
  const value = rows.length === 1 ? object(object(rows[0])?.actual) : null;
  if (!value) unavailable();
  return value;
}

/** A presence check or caller-supplied JSON can never open this source. */
export async function assertDirectPendingSourceQualification(tx: Prisma.TransactionClient): Promise<DirectPendingSourceQualification> {
  const upwardProjection = await discoverUpwardLegacyProjection(tx);
  try {
    const environment = await readDeparseEnvironment(tx);
    const transitionOid = await readDirectArchiveTransitionOid(tx);
    const retentionOid = await readDirectArchiveRetentionOid(tx);
    const dispatchOid = await readDirectArchiveDispatchOid(tx);
    const bootstrap = await readBindingCatalog(tx);
    const expected = await readExpectedBinding(tx);
    if (expected.applicationRoleOid !== bootstrap.currentRoleOid || expected.applicationRoleOid !== bootstrap.sessionRoleOid
      || expected.databaseOid !== bootstrap.databaseOid || expected.anchorNamespaceOid !== bootstrap.namespaceOid || expected.anchorOwnerOid !== bootstrap.anchorOwnerOid) unavailable();
    const actual = await readActualCatalog(tx, expected);
    if (!isDeepStrictEqual(assertDeparseEnvironment(actual.deparseEnvironment), environment)) unavailable();
    for (const field of ["triggerDefinitionReadable","schemaUsage","catalogReadable","allColumnsReadable","rlsAbsent","routineExecutable","digestExecutable","builtinsExecutable","attachmentFileLockable","originalNumberWritable","originalNumberNonunique","noCallerObjectOwnership","noBindingWrite","noBindingGrantOption"]) if (actual[field] !== true) unavailable();
    if (actual.sessionRoleOid !== expected.applicationRoleOid || actual.currentRoleOid !== expected.applicationRoleOid
      || actual.backendPid !== bootstrap.backendPid || actual.transactionId !== bootstrap.transactionId) unavailable();
    const bound = object(expected.bindings), relations = object(actual.relations), routines = object(actual.routines);
    if (!bound || !relations || !routines || !isDeepStrictEqual(bound.relations, relations)) unavailable();
    const requiredColumns: Record<string, readonly string[]> = {};
    for (const [table, columns] of Object.entries(DIRECT_PENDING_DB_RECIPE.sourceReads)) requiredColumns[table] = columns;
    for (const [table, columns] of Object.entries({...DIRECT_PENDING_DB_RECIPE.attachmentReads,...DIRECT_PENDING_DB_RECIPE.legacyRetentionReads})) requiredColumns[table] = [...new Set([...(requiredColumns[table] ?? []), ...columns])];
    requiredColumns.jg_contract_direct_pending_binding_v1 = ["protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings"];
    if (Object.keys(relations).length !== Object.keys(requiredColumns).length) unavailable();
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const relation = object(relations[table]);
      if (!relation || !Array.isArray(relation.columns) || !columns.every(name => relation.columns instanceof Array && relation.columns.filter(raw => object(raw)?.name === name).length === 1)) unavailable();
      const originalNumber = table === "ContractVersion" ? relation.columns.map(object).find(column => column?.name === "originalSignedNumber") : null;
      if (table === "ContractVersion" && (!originalNumber || String(originalNumber.typeOid) !== "25" || originalNumber.notNull !== false)) unavailable();
    }
    const expectedRoutines = object(bound.routines);
    if (!expectedRoutines || Object.keys(routines).length !== DIRECT_PENDING_DB_RECIPE.routines.length || Object.keys(expectedRoutines).length !== DIRECT_PENDING_DB_RECIPE.routines.length) unavailable();
    const dispatch = dispatchOid === null ? null
      : await readDirectArchiveDispatchQualification(tx, dispatchOid, bootstrap, bound, actual, transitionOid, retentionOid);
    const collisionAcls = await projectCollisionExecuteAcls(tx, actual, expectedRoutines, bootstrap, dispatch?.native ?? null);
    if (!collisionAcls) unavailable();
    const fileBinding = projectRegisteredFileBinding(actual, bound, expected, collisionAcls, dispatch?.native?.executorOwnerOid);
    if (!fileBinding) unavailable();
    for (const descriptor of DIRECT_PENDING_DB_RECIPE.routines) {
      const current = object(fileBinding[descriptor.signature] ?? dispatch?.legacyProjection[descriptor.signature] ?? routines[descriptor.signature]);
      const observedOutside = descriptor.signature === factAppendSignature && bootstrap.anchorSourceSha256 === outsideFactAppendBody;
      if (observedOutside && current?.bodySha256 !== outsideFactAppendBody) unavailable();
      const identity = object(expectedRoutines[descriptor.signature]);
      let observation = current && observedOutside ? { ...current, bodySha256: descriptor.bodySha256 } : current;
      if (observation && Object.hasOwn(collisionAcls, descriptor.signature)) {
        observation = { ...observation, acl: collisionAcls[descriptor.signature] };
      }
      if (dispatch?.native && observation && descriptor.signature === directInputSignature) {
        observation = { ...observation, acl: identity?.acl };
      }
      if (!observation || !identity || !isDeepStrictEqual(identity, observation) || observation.bodySha256 !== descriptor.bodySha256
        || observation.securityDefiner !== descriptor.securityDefiner || observation.language !== descriptor.language || observation.returnType !== descriptor.returnType
        || observation.volatility !== descriptor.volatility || observation.parallel !== descriptor.parallel || observation.strict !== descriptor.strict || observation.returnsSet !== descriptor.returnsSet
        || !isDeepStrictEqual(configuredSearchPath(observation.configuration), descriptor.searchPath)) unavailable();
    }
    const triggers = object(actual.triggers), installedTriggers = object(bound.triggers);
    if (!triggers || !installedTriggers || Object.keys(triggers).length !== DIRECT_PENDING_DB_RECIPE.triggers.length
      || Object.keys(installedTriggers).length !== DIRECT_PENDING_DB_RECIPE.triggers.length) unavailable();
    for (const descriptor of DIRECT_PENDING_DB_RECIPE.triggers) {
      const trigger = object(triggers[descriptor.name]), installed = object(installedTriggers[descriptor.name]), relation = object(relations[descriptor.table]);
      if (!trigger || !installed || !relation || trigger.relationOid !== relation.oid || trigger.type !== descriptor.type || trigger.enabled !== "O" || trigger.deferrable !== false || trigger.initiallyDeferred !== false || trigger.internal !== false || trigger.argumentCount !== descriptor.argumentCount || trigger.arguments !== descriptor.arguments) unavailable();
      const expectedAttributes = descriptor.columns.map(name => {
        const column = Array.isArray(relation.columns) ? relation.columns.map(object).find(value => value?.name === name) : null;
        if (!column || !Number.isSafeInteger(column.number)) unavailable();
        return String(column.number);
      }).join(" ");
      if (trigger.attributes !== expectedAttributes) unavailable();
      if (descriptor.definitions === null) {
        if (trigger.hasCondition !== false || trigger.definition !== null || !isDeepStrictEqual(installed, trigger)) unavailable();
      } else {
        if (trigger.hasCondition !== true || !descriptor.definitions.some(definition => definition === trigger.definition)
          || !descriptor.definitions.some(definition => definition === installed.definition)) unavailable();
        // Only the two separately validated whole definitions may differ. Keep
        // the raw current and installed observations for transaction continuity.
        if (!isDeepStrictEqual({ ...installed, definition: null }, { ...trigger, definition: null })) unavailable();
      }
      const routine = object(routines[descriptor.function]);
      // The existing exclusive trigger routine is pinned by the preserved old
      // chain's installation qualification; its OID is recorded in the binding.
      if (!routine || trigger.functionOid !== routine.oid) unavailable();
    }
    if (!Array.isArray(actual.accessibleDefiners)) unavailable();
    for (const value of actual.accessibleDefiners) {
      const definer = object(value);
      if (!definer || (!isQualifiedUpwardDefiner(upwardProjection, definer) && !DIRECT_PENDING_DB_RECIPE.allowedSecurityDefiners.some(descriptor => {
        const known = object(routines[descriptor.signature]);
        const allowedBody = descriptor.signature === factAppendSignature ? bootstrap.anchorSourceSha256 : descriptor.bodySha256;
        return known && known.oid === definer.oid && definer.bodySha256 === allowedBody;
      }))) unavailable();
    }
    const transition = transitionOid === null ? null : await readPreparedDirectArchiveTransition(tx, transitionOid, expected, bootstrap);
    const retention = retentionOid === null ? null : await readDirectArchiveRetentionQualification(tx, retentionOid, transition, bootstrap);
    if (dispatch && (!transition || !retention || dispatch.links.pendingSha !== transition.binding.pendingSha256
      || dispatch.links.prepareSha !== retention.binding.preparationSha256
      || dispatch.archiveRelationOid !== object(object(retention.actual.bindings)?.relations)?.ContractArchiveFile)) unavailable();
    return { environment, bootstrap, expected, actual, transition, retention, dispatch, ...(upwardProjection ? { upwardProjection } : {}) };
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    // Missing object/rights and observation errors are never proof of absence or
    // permission. No underlying DB diagnostics or credentials reach the user.
    unavailable();
  }
}

export async function assertDirectPendingSourceContinuity(tx: Prisma.TransactionClient, before: DirectPendingSourceQualification): Promise<void> {
  const after = await assertDirectPendingSourceQualification(tx);
  if (!isDeepStrictEqual(after, before)) unavailable();
}
