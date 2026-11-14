import { discoverUpwardLegacyProjection, qualifiedUpwardRoutineSha } from "../contract/contract-upward-archive-catalog";
import { usesUpwardDirectArchive } from "../contract/contract-upward-direct-registration";
import { readUpwardDirectArchiveProof } from "../contract/contract-upward-direct-archive-native";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type ContractArchiveEvidenceFile, type ContractArchiveFile, type FileObject } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { assertDirectPendingSourceContinuity, assertDirectPendingSourceQualification } from "../contract/contract-direct-pending-source";
import { readDirectOutsideOperatingProof, usesDirectOutsideOperatingProof } from "../contract/contract-direct-outside-operating-read";

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function unavailable(): never {
  throw new ServiceUnavailableException("直签归档原件存储版本尚未完整核对，暂不能下载");
}

async function readCatalog(tx: Prisma.TransactionClient, completionOid: string, anchor: Row, executorOwnerOid?: string) {
  const projection = await discoverUpwardLegacyProjection(tx);
  const generationSignature = "public.jg_require_contract_direct_archive_generations_v1()";
  const qualifiedGeneration = projection?.routines.find(item => item.signature === generationSignature
    && item.beforeSha256 === "5b6ad408598dbde8798f62fa3ed3ea94d32a96faa2b64f3473112df7e2238a35");
  const generationBody = qualifiedGeneration ? Prisma.sql`${qualifiedGeneration.beforeSha256}`
    : Prisma.raw("'f258feb6ebac8a63d654ebd6f98557a7b5f88c67f982613002e234dffcbd503b'");
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    /* contract_direct_archive_generation_catalog_v1 */
    WITH recipe(name,signature,sha,volatility,result,strict,readable) AS (VALUES
      ('jg_guard_contract_direct_archive_generation_v1','public.jg_guard_contract_direct_archive_generation_v1()',
        '7826b70e6ddacaa89593c735420200e9a8ec04c3dab60f7496eea3dd35572e37','v','pg_catalog.trigger',false,false),
      ('jg_record_contract_direct_archive_generations_v1','public.jg_record_contract_direct_archive_generations_v1(text,uuid,text,text,text,text,integer,text,text,jsonb)',
        '7f383484f39d3e5b5be0cdb955a8a8910cc95dca5ee5d6d09242ce9ba94d08ed','v','pg_catalog.void',true,false),
      ('jg_read_contract_direct_archive_generations_v1','public.jg_read_contract_direct_archive_generations_v1(text)',
        '8b0a12bcc9694ff1170668eea06731ad8153faf07bed5b94f620c718f7d38622','s','pg_catalog.jsonb',true,true),
      ('jg_require_contract_direct_archive_generations_v1','public.jg_require_contract_direct_archive_generations_v1()',
        ${generationBody},'v','pg_catalog.trigger',false,false)
    ), routines AS (
      SELECT p.*,r.signature,r.sha,r.volatility,r.result,r.strict,r.readable,l.lanname
      FROM recipe r JOIN pg_catalog.pg_proc p ON p.proname=r.name
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::regnamespace
    ), expected_triggers(name,relation_oid,function_oid,kind,deferred) AS (VALUES
      ('jg_direct_archive_generation_append',pg_catalog.to_regclass('public.jg_contract_direct_archive_generation_v1')::oid,
        pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_generation_v1()')::oid,31,false),
      ('jg_direct_archive_generation_no_truncate',pg_catalog.to_regclass('public.jg_contract_direct_archive_generation_v1')::oid,
        pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_generation_v1()')::oid,34,false),
      ('ContractArchiveFile_direct_generations_v1','public."ContractArchiveFile"'::regclass::oid,
        pg_catalog.to_regprocedure('public.jg_require_contract_direct_archive_generations_v1()')::oid,5,true)
    ), observed_triggers AS (
      SELECT t.* FROM pg_catalog.pg_trigger t
      WHERE t.tgfoid IN (SELECT oid FROM routines) OR (t.tgrelid,t.tgname) IN (SELECT relation_oid,name FROM expected_triggers)
    )
    SELECT c.oid::text AS "relationOid",b.tableoid::text AS "completionOid",
      db.oid::text AS "databaseOid",session_user::regrole::oid::text AS "sessionRoleOid",
      current_user::regrole::oid::text AS "currentRoleOid",pg_catalog.pg_backend_pid() AS "backendPid",
      pg_catalog.txid_current()::text AS "transactionId",
      c.relowner=b."anchorOwnerOid" AND c.relnamespace=b."namespaceOid" AND c.relkind='r' AND c.relpersistence='p'
        AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid)
        AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
          =ARRAY['evidenceId:25','intentId:2950','payloadSha256:25','objectGeneration:25']
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND (a.attacl IS NOT NULL OR NOT a.attnotnull OR a.atthasdef OR a.attgenerated<>'' OR a.attidentity<>''))
        AND 1=(SELECT count(*) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
          WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1]::smallint[] AND k.convalidated
            AND NOT k.condeferrable AND i.indisvalid AND i.indisready)
        AND 2=(SELECT count(*) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f' AND k.convalidated
          AND NOT k.condeferrable AND k.confdeltype='r' AND k.confkey=ARRAY[1]::smallint[]
          AND ((k.conkey=ARRAY[1]::smallint[] AND k.confrelid='public."ContractArchiveEvidenceFile"'::regclass)
            OR (k.conkey=ARRAY[2]::smallint[] AND k.confrelid='public.jg_contract_direct_archive_intent_use_v1'::regclass)))
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
          WHERE acl.grantor<>c.relowner OR (acl.grantee<>c.relowner AND
            (acl.grantee<>b."applicationRoleOid" OR acl.privilege_type<>'SELECT' OR acl.is_grantable)
            ${executorOwnerOid ? Prisma.sql`AND (acl.grantee<>${executorOwnerOid}::oid
              OR acl.privilege_type NOT IN ('SELECT','INSERT') OR acl.is_grantable)` : Prisma.empty}))
        AND pg_catalog.has_table_privilege(b."applicationRoleOid",c.oid,'SELECT')
        AND 4=(SELECT count(*) FROM routines)
        AND NOT EXISTS(SELECT 1 FROM routines p WHERE p.oid IS DISTINCT FROM pg_catalog.to_regprocedure(p.signature)::oid
          OR p.proowner<>b."anchorOwnerOid" OR p.prokind<>'f' OR p.prosecdef OR p.proretset OR p.proparallel<>'u' OR p.lanname<>'plpgsql'
          OR p.prorettype IS DISTINCT FROM pg_catalog.to_regtype(p.result)::oid OR p.provolatile::text<>p.volatility
          OR p.proisstrict IS DISTINCT FROM p.strict OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
          OR ${qualifiedUpwardRoutineSha(projection, Prisma.sql`p.oid`, Prisma.sql`encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')`)} IS DISTINCT FROM p.sha${qualifiedGeneration ? Prisma.sql` OR (p.signature=${generationSignature}
            AND p.oid IS DISTINCT FROM ${qualifiedGeneration.oid}::oid)` : Prisma.empty}
          OR pg_catalog.has_function_privilege(b."applicationRoleOid",p.oid,'EXECUTE') IS DISTINCT FROM p.readable
          OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
            WHERE acl.grantor<>p.proowner OR (acl.grantee<>p.proowner AND
              (NOT p.readable OR acl.grantee<>b."applicationRoleOid" OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable)
              ${executorOwnerOid ? Prisma.sql`AND (p.proname NOT IN ('jg_read_contract_direct_archive_generations_v1',
                'jg_record_contract_direct_archive_generations_v1') OR acl.grantee<>${executorOwnerOid}::oid
                OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable)` : Prisma.empty})))
        AND 3=(SELECT count(*) FROM observed_triggers)
        AND 3=(SELECT count(*) FROM observed_triggers t JOIN expected_triggers x
          ON x.name=t.tgname AND x.relation_oid=t.tgrelid AND x.function_oid=t.tgfoid AND x.kind=t.tgtype
          WHERE t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred
            AND (t.tgconstraint<>0)=x.deferred AND t.tgnargs=0 AND t.tgattr::text='' AND encode(t.tgargs,'hex')='' AND t.tgqual IS NULL)
        AS qualified
    FROM public.jg_contract_direct_archive_completion_binding_v1 b
    JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.jg_contract_direct_archive_generation_v1')
    JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
    WHERE b.tableoid=${completionOid}::oid AND b."protocolVersion"=1
      AND b."databaseOid"=db.oid AND b."applicationRoleOid"=current_user::regrole::oid
      AND current_user=session_user AND pg_catalog.current_setting('session_replication_role')='origin'
  `);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.qualified !== true || row.completionOid !== completionOid
    || typeof row.relationOid !== "string" || !/^[1-9][0-9]{0,9}$/u.test(row.relationOid)
    || !(["databaseOid","sessionRoleOid","currentRoleOid","backendPid","transactionId"] as const).every(key => row[key] === anchor[key])) unavailable();
  return projection ? { ...row, upwardProjection: projection } : row;
}

export function assertDirectArchiveOriginals(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) unavailable();
  const originals = value.map(record);
  if (originals.some((row, index) => !row || row.displayOrder !== index || typeof row.fileId !== "string" || !row.fileId
    || typeof row.bucket !== "string" || !row.bucket || typeof row.objectKey !== "string" || !row.objectKey
    || typeof row.mimeType !== "string" || !["application/pdf","image/jpeg","image/png"].includes(row.mimeType)
    || typeof row.sizeBytes !== "number" || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1
    || typeof row.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.contentSha256)
    || typeof row.objectGeneration !== "string" || row.objectGeneration.length > 1024
    || !/^[\x21-\x7e]+$/u.test(row.objectGeneration)
    || row.objectGeneration.toLowerCase() === "null" || row.objectGeneration.includes(","))
    || new Set(originals.map(row => row?.fileId)).size !== originals.length) unavailable();
  return originals;
}

export async function readDirectArchiveGenerations(tx: Prisma.TransactionClient, parent: ContractArchiveFile) {
  try {
    if (parent.archiveProtocolVersion !== 2 || parent.archiveSource !== "direct_signed" || parent.status !== "confirmed"
      || typeof parent.authoritySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(parent.authoritySha256)) unavailable();
    if (usesUpwardDirectArchive(parent)) {
      return assertDirectArchiveOriginals((await readUpwardDirectArchiveProof(tx, parent)).originals);
    }
    if (usesDirectOutsideOperatingProof(parent)) {
      return assertDirectArchiveOriginals((await readDirectOutsideOperatingProof(tx, parent)).originals);
    }
    const prior = await assertDirectPendingSourceQualification(tx);
    const completionOid = prior.retention?.completion?.actual.relationOid;
    if (typeof completionOid !== "string" || !prior.dispatch) unavailable();
    const executorOwnerOid = prior.dispatch.native?.executorOwnerOid;
    const catalog = await readCatalog(tx, completionOid, prior.bootstrap, executorOwnerOid);
    const rows = await tx.$queryRaw<Array<{ proof: unknown }>>(Prisma.sql`
      SELECT public.jg_read_contract_direct_archive_generations_v1(${parent.id}::pg_catalog.text) AS proof
    `);
    const proof = rows.length === 1 ? record(rows[0].proof) : null;
    if (!proof || proof.protocolVersion !== 1 || proof.archiveId !== parent.id || proof.contractVersionId !== parent.contractVersionId
      || proof.authoritySha256 !== parent.authoritySha256) unavailable();
    const originals = assertDirectArchiveOriginals(proof.originals);
    if (!isDeepStrictEqual(await readCatalog(tx, completionOid, prior.bootstrap, executorOwnerOid), catalog)) unavailable();
    await assertDirectPendingSourceContinuity(tx, prior);
    return originals;
  } catch {
    unavailable();
  }
}

export async function readDirectArchiveGeneration(tx: Prisma.TransactionClient, parent: ContractArchiveFile,
  evidence: ContractArchiveEvidenceFile, file: FileObject) {
  if (parent.id !== evidence.archiveFileId || parent.contractVersionId !== evidence.contractVersionId || evidence.fileId !== file.id
    || file.storageStatus !== "active" || file.purgeReceiptId !== null || file.supersedesFileObjectId !== null
    || evidence.mimeType !== file.mimeType || evidence.sizeBytes !== file.sizeBytes || evidence.contentSha256 !== file.contentSha256) unavailable();
  const original = (await readDirectArchiveGenerations(tx, parent))[evidence.displayOrder];
  if (!original || original.fileId !== file.id || original.bucket !== file.bucket || original.objectKey !== file.objectKey
    || original.mimeType !== file.mimeType || original.sizeBytes !== file.sizeBytes || original.contentSha256 !== file.contentSha256
    || typeof original.objectGeneration !== "string") unavailable();
  return original.objectGeneration;
}
