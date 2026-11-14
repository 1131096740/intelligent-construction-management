import { discoverUpwardLegacyProjection, qualifiedUpwardRoutineSha } from "./contract-upward-archive-catalog";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { legacyCompletionName as oldCompletionGuard, readDirectArchiveCompletionOid,
  readDirectArchiveCompletionQualification } from "./contract-direct-archive-completion-qualification";

function unavailable(): never {
  throw new ServiceUnavailableException("直签原件交接资格尚未完整核对，请保留原件稍后办理");
}

type Row = Record<string, unknown>;
export const directArchiveRetentionFileTrigger = "FileObject_contract_direct_archive_retention_v1";
const registry = "jg_contract_direct_archive_retention_binding_v1";
const completionGuard = "jg_require_contract_direct_archive_complete_v1";
const registryGuard = "jg_guard_contract_direct_archive_retention_binding_v1";
const fileGuard = "jg_protect_contract_direct_archive_file_v1";
const oldPhysicalFileGuard = "jg_protect_contract_direct_review_file_v1";
const proofRoutine = "jg_contract_direct_archive_proof_v1";
const digestRoutine = "jg_contract_direct_archive_request_sha_v1";

const routineDescriptors = [
  [registryGuard, "167157e946edc0539ce6136797ac9a1787bb02239bf06997f8b65a85ed161391", "plpgsql", "2279", "v", "u", false],
  [fileGuard, "8c6801d789cdf60419d6e5d2239110197f164dabab444ef96f2e50c8ec88e40b", "plpgsql", "2279", "v", "u", false],
  [completionGuard, "326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5", "plpgsql", "2279", "v", "u", false],
  [oldPhysicalFileGuard, "6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20", "plpgsql", "2279", "v", "u", false],
  [oldCompletionGuard, "4f6b00903b08ac6c1b42bb0feea706271c34a4d2c1f27d9669f8da7b9420a329", "plpgsql", "2279", "v", "u", false],
  [proofRoutine, "4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f", "plpgsql", "3802", "s", "u", true],
  [digestRoutine, "f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf", "sql", "25", "i", "s", true]
] as const;

const triggerDescriptors = [
  ["jg_direct_archive_retention_binding_immutable", registry, registryGuard, 31, false],
  ["jg_direct_archive_retention_binding_no_truncate", registry, registryGuard, 34, false],
  [directArchiveRetentionFileTrigger, "FileObject", fileGuard, 31, false],
  ["FileObject_contract_direct_review_retention_v1", "FileObject", oldPhysicalFileGuard, 31, false],
  ["ContractArchiveFile_direct_complete_v1", "ContractArchiveFile", completionGuard, 5, true],
  ["ContractArchiveEvidenceFile_direct_complete_v1", "ContractArchiveEvidenceFile", completionGuard, 5, true],
  ["ContractArchiveFile_v2_complete", "ContractArchiveFile", oldCompletionGuard, 5, true],
  ["ContractArchiveEvidenceFile_v2_complete", "ContractArchiveEvidenceFile", oldCompletionGuard, 5, true]
] as const;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
}

export async function readDirectArchiveRetentionOid(tx: Prisma.TransactionClient): Promise<string | null> {
  try {
    const rows = await tx.$queryRaw<Array<{ relationOid: string | null; routineCount: number; triggerCount: number }>>(Prisma.sql`
      /* contract_direct_archive_retention_probe_v1 */
      SELECT c.oid::text AS "relationOid",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p WHERE p.pronamespace=n.oid AND p.proname IN (
          'jg_guard_contract_direct_archive_retention_binding_v1','jg_protect_contract_direct_archive_file_v1','jg_require_contract_direct_archive_complete_v1'
        )) AS "routineCount",
        (SELECT count(*)::integer FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class target ON target.oid=t.tgrelid
          WHERE target.relnamespace=n.oid AND t.tgname IN (
            'jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate',
            'FileObject_contract_direct_archive_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1'
          )) AS "triggerCount"
      FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c
        ON c.relnamespace=n.oid AND c.relname='jg_contract_direct_archive_retention_binding_v1'
      WHERE n.nspname='public'
    `);
    const row = rows.length === 1 ? rows[0] : null;
    if (row?.relationOid === null && row.routineCount === 0 && row.triggerCount === 0) {
      if (await readDirectArchiveCompletionOid(tx) !== null) unavailable();
      return null;
    }
    if (row && oid(row.relationOid) && row.routineCount === 3 && row.triggerCount === 5) return row.relationOid;
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    unavailable();
  }
  unavailable();
}

/** A complete retention witness protects existing reads but never qualifies a write. */
export async function readDirectArchiveRetentionQualification(tx: Prisma.TransactionClient, relationOid: string,
  preparation: { binding: Row; actual: Row } | null, anchor: Row) {
  try {
    if (!preparation) unavailable();
    const projection = await discoverUpwardLegacyProjection(tx);
    const rows = await tx.$queryRaw<Array<{ binding: Row; actual: Row }>>(Prisma.sql`
      /* contract_direct_archive_retention_catalog_v1 */
      WITH installed AS (
        SELECT b.*,b.tableoid AS relation_oid FROM public.jg_contract_direct_archive_retention_binding_v1 b
      ), prepared AS (
        SELECT p.*,p.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
        FROM public.jg_contract_direct_archive_binding_v1 p WHERE p."protocolVersion"=1
      ), selected_relations AS (
        SELECT relname,oid FROM pg_catalog.pg_class WHERE oid IN (
          pg_catalog.to_regclass('public.jg_contract_direct_archive_retention_binding_v1'),pg_catalog.to_regclass('public."FileObject"'),
          pg_catalog.to_regclass('public."ContractArchiveFile"'),pg_catalog.to_regclass('public."ContractArchiveEvidenceFile"'))
      ), selected_routines AS (
        SELECT p.*,l.lanname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid IN (
          pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_retention_binding_v1()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_archive_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_require_contract_direct_archive_complete_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_review_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_proof_v1(pg_catalog.text)'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_request_sha_v1(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.text[])')
        )
      ), selected_triggers AS (
        SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgfoid IN (SELECT oid FROM selected_routines)
          OR (t.tgrelid IN (SELECT oid FROM selected_relations) AND t.tgname IN (
            'jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate',
            'FileObject_contract_direct_archive_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1',
            'ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete','FileObject_contract_direct_review_retention_v1'))
      ), reachable AS (
        SELECT r.oid,r.rolsuper,r.rolcreaterole,r.rolreplication,r.rolbypassrls FROM pg_catalog.pg_roles r
        WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
      ), file_reads(table_name,column_name) AS (
        VALUES ('public."ContractArchiveFile"','id'),('public."ContractArchiveFile"','contractVersionId'),
          ('public."ContractArchiveFile"','archiveProtocolVersion'),('public."ContractArchiveFile"','archiveSource'),
          ('public."ContractArchiveEvidenceFile"','archiveFileId'),('public."ContractArchiveEvidenceFile"','contractVersionId'),
          ('public."ContractArchiveEvidenceFile"','fileId'),('public."FileObject"','id'),('public."FileObject"','objectKey'),
          ('public."ContractEconomicReviewFileReference"','fileId'),('public."ContractEconomicReviewFileReference"','objectKey')
      ), completion_reads(table_name,column_name) AS (
        SELECT table_name,column_name FROM file_reads UNION ALL VALUES
          ('public."ContractArchiveFile"','confirmedAt'),('public."ContractArchiveFile"','authoritySnapshot'),
          ('public."ContractVersion"','id'),('public."ContractVersion"','contractId'),
          ('public."ContractVersion"','affiliateAssignmentId'),('public."ContractVersion"','affiliateBusinessPartyVersionId'),
          ('public."Contract"','id'),('public."Contract"','projectId'),
          ('public."Project"','id'),('public."Project"','isActive'),('public."Project"','operatingLedgerEffectiveDate'),
          ('public."ProjectAffiliateAssignment"','id'),('public."ProjectAffiliateAssignment"','projectId'),
          ('public."ProjectAffiliateAssignment"','effectiveFrom'),('public."ProjectAffiliateAssignment"','endedAt'),
          ('public."ProjectAffiliateAssignment"','businessPartyVersionId'),('public."ProjectAffiliateAssignment"','businessPartyId'),
          ('public."OperatingFact"','sourceType'),('public."OperatingFact"','sourceBusinessId'),
          ('public."OperatingImpactEntry"','sourceType'),('public."OperatingImpactEntry"','sourceBusinessId')
      )
      SELECT jsonb_build_object(
        'protocolVersion',b."protocolVersion",'recipeVersion',b."recipeVersion",'applicationRoleOid',b."applicationRoleOid"::text,
        'databaseOid',b."databaseOid"::text,'anchorOwnerOid',b."anchorOwnerOid"::text,
        'preparationRelationOid',b."preparationRelationOid"::text,'preparationSha256',b."preparationSha256",'bindings',b."bindings"
      ) AS binding, jsonb_build_object(
        'applicationRoleOid',p."applicationRoleOid"::text,'databaseOid',db.oid::text,'anchorOwnerOid',c.relowner::text,
        'preparationRelationOid',p.relation_oid::text,'preparationSha256',p.sha,
        'currentRoleOid',current_user::regrole::oid::text,'sessionRoleOid',session_user::regrole::oid::text,
        'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text,
        'bindings',jsonb_build_object(
          'relations',(SELECT jsonb_object_agg(relname,oid::text) FROM selected_relations),
          'routines',(SELECT jsonb_object_agg(proname,jsonb_build_object(
            'oid',oid::text,'owner',proowner::text,'namespace',pronamespace::text,
            'sha',${qualifiedUpwardRoutineSha(projection, Prisma.sql`oid`, Prisma.sql`encode(public.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex')`)},
            'language',lanname,'returnType',prorettype::text,'volatility',provolatile,'parallel',proparallel,
            'securityDefiner',prosecdef,'strict',proisstrict,'returnsSet',proretset,'configuration',proconfig,'acl',proacl,
            'noPublicExecute',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl WHERE acl.grantee=0)
          )) FROM selected_routines),
          'triggers',(SELECT jsonb_object_agg(tgname,jsonb_build_object(
            'oid',t.oid::text,'relation',t.tgrelid::text,'routine',t.tgfoid::text,'type',t.tgtype,'enabled',t.tgenabled,
            'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'condition',t.tgqual IS NOT NULL,'internal',t.tgisinternal,
            'args',encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY k(num,pos)
              JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.pos)
          )) FROM selected_triggers t)
        ),
        'triggerCount',(SELECT count(*)::integer FROM selected_triggers),
        'registryQualified', c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
          AND c.relowner=p."anchorOwnerOid" AND c.relnamespace=p."anchorNamespaceOid" AND p."databaseOid"=db.oid
          AND pg_catalog.current_setting('session_replication_role')='origin'
          AND 8=(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
          AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND a.attidentity='' AND a.attgenerated='')
            =ARRAY['protocolVersion:23','recipeVersion:25','applicationRoleOid:26','databaseOid:26','anchorOwnerOid:26',
              'preparationRelationOid:26','preparationSha256:25','bindings:3802']
          AND 1=(SELECT count(*) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1]::smallint[]
            AND k.convalidated AND NOT k.condeferrable AND EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=k.conindid AND i.indisvalid AND i.indisready))
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
            WHERE acl.grantee<>c.relowner AND (acl.grantee<>p."applicationRoleOid" OR acl.privilege_type<>'SELECT' OR acl.is_grantable))
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
          AND NOT EXISTS(SELECT 1 FROM reachable r WHERE r.rolsuper OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
            OR r.oid=c.relowner OR r.oid IN (SELECT proowner FROM selected_routines)
            OR pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'CREATE')
            OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION')
            OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
            OR EXISTS(SELECT 1 FROM selected_routines f WHERE pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE WITH GRANT OPTION'))),
        'applicationCompletionReads',pg_catalog.has_table_privilege(p."applicationRoleOid",c.oid,'SELECT')
          AND NOT EXISTS(SELECT 1 FROM completion_reads needed WHERE
            pg_catalog.has_column_privilege(p."applicationRoleOid",pg_catalog.to_regclass(needed.table_name),needed.column_name,'SELECT') IS DISTINCT FROM TRUE)
          AND NOT EXISTS(SELECT 1 FROM selected_routines f WHERE f.proname IN (
            'jg_require_contract_direct_archive_complete_v1','jg_contract_direct_archive_proof_v1','jg_contract_direct_archive_request_sha_v1')
            AND pg_catalog.has_function_privilege(p."applicationRoleOid",f.oid,'EXECUTE') IS DISTINCT FROM TRUE),
        'fileCallers',(SELECT jsonb_agg(jsonb_build_object('roleOid',caller::text,
          'exactReads',pg_catalog.has_schema_privilege(caller,c.relnamespace,'USAGE') AND NOT EXISTS(
            SELECT 1 FROM file_reads needed WHERE pg_catalog.has_column_privilege(caller,pg_catalog.to_regclass(needed.table_name),needed.column_name,'SELECT') IS DISTINCT FROM TRUE),
          'executable',pg_catalog.has_function_privilege(caller,pg_catalog.to_regprocedure('public.jg_protect_contract_direct_archive_file_v1()'),'EXECUTE')
            AND pg_catalog.has_function_privilege(caller,pg_catalog.to_regprocedure('public.jg_protect_contract_direct_review_file_v1()'),'EXECUTE')
        ) ORDER BY caller) FROM unnest(p."fileCallerOids") AS file_roles(caller))
      ) AS actual
      FROM installed b CROSS JOIN prepared p JOIN pg_catalog.pg_class c ON c.oid=b.relation_oid
      JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
    `);
    const result = rows.length === 1 ? rows[0] : null;
    const binding = result?.binding, actual = result?.actual;
    if (!binding || !actual || binding.protocolVersion !== 1 || binding.recipeVersion !== "contract-direct-archive-retention-v1/1"
      || binding.applicationRoleOid !== preparation.binding.applicationRoleOid || binding.anchorOwnerOid !== preparation.binding.anchorOwnerOid
      || binding.databaseOid !== preparation.binding.databaseOid || binding.preparationRelationOid !== preparation.actual.relationOid
      || typeof binding.preparationSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(binding.preparationSha256)
      || !["applicationRoleOid","anchorOwnerOid","databaseOid","preparationRelationOid","preparationSha256"].every(key => binding[key] === actual[key])
      || !["currentRoleOid","sessionRoleOid","backendPid","transactionId"].every(key => actual[key] === anchor[key])
      || actual.registryQualified !== true || actual.applicationCompletionReads !== true
      || !Array.isArray(actual.fileCallers) || !isDeepStrictEqual(actual.fileCallers.map(caller => record(caller)?.roleOid), preparation.binding.fileCallerOids)
      || actual.fileCallers.some(caller => record(caller)?.exactReads !== true || record(caller)?.executable !== true)) unavailable();
    const installed = record(binding.bindings), observed = record(actual.bindings);
    if (!installed || !observed) unavailable();
    const completionOid = await readDirectArchiveCompletionOid(tx);
    const completion = completionOid === null ? null
      : await readDirectArchiveCompletionQualification(tx, completionOid, relationOid, anchor, installed, observed);
    const catalog: Row = completion?.legacyCatalog ?? observed;
    if (!isDeepStrictEqual(installed, catalog)) unavailable();
    const relations = record(catalog.relations), routines = record(catalog.routines), triggers = record(catalog.triggers);
    if (!relations || relations[registry] !== relationOid || !["FileObject","ContractArchiveFile","ContractArchiveEvidenceFile"].every(name => oid(relations[name]))
      || Object.keys(relations).length !== 4 || !routines || Object.keys(routines).length !== routineDescriptors.length
      || !triggers || Object.keys(triggers).length !== triggerDescriptors.length || actual.triggerCount !== triggerDescriptors.length) unavailable();
    for (const [name, sha, language, returnType, volatility, parallel, strict] of routineDescriptors) {
      const routine = record(routines[name]);
      const configuration = name === oldCompletionGuard ? "search_path=pg_catalog, public" : "search_path=pg_catalog, pg_temp";
      if (!routine || !oid(routine.oid) || !oid(routine.owner)
        || (name !== oldCompletionGuard && routine.owner !== binding.anchorOwnerOid) || routine.namespace !== anchor.namespaceOid
        || routine.sha !== sha || routine.language !== language || routine.returnType !== returnType || routine.volatility !== volatility
        || routine.parallel !== parallel || routine.strict !== strict || routine.returnsSet !== false || routine.securityDefiner !== false
        || routine.noPublicExecute !== true || !isDeepStrictEqual(routine.configuration, [configuration])) unavailable();
    }
    for (const [name, table, routine, type, deferred] of triggerDescriptors) {
      const trigger = record(triggers[name]);
      if (!trigger || !oid(trigger.oid) || trigger.relation !== relations[table] || trigger.routine !== record(routines[routine])?.oid
        || trigger.type !== type || trigger.enabled !== "O" || trigger.deferred !== deferred || trigger.initiallyDeferred !== deferred
        || trigger.condition !== false || trigger.internal !== false || trigger.args !== "" || !isDeepStrictEqual(trigger.columns, [])) unavailable();
    }
    return { binding, actual, completion, fileTrigger: triggers[directArchiveRetentionFileTrigger] };
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    unavailable();
  }
}
