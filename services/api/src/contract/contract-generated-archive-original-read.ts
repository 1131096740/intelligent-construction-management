import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractArchiveEvidenceFile, type ContractArchiveFile, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

type Row = Record<string, unknown>;
const appendBody = "13b8c39ba62c7b1ffdb9c1bfd3effe7c640f1a84b00938c4a7b88a37015a3a23";
const completionBody = "13d20bc2c371ac5e1e3bb0b542c1ab0f1edd5e1c10d66a06e040504bf6c123f4";
const sha = /^[a-f0-9]{64}$/u;

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function unavailable(): never {
  throw new ServiceUnavailableException("归档原件固定版本尚未完整核对，请保留本次标识");
}

export function requiresGeneratedArchiveOriginals(version: ContractVersion, archive: ContractArchiveFile) {
  if (archive.archiveSource !== "generated_approval") return false;
  const basis = object(object(archive.authoritySnapshot).sourceBasis);
  const frozenRelationship = object(object(basis.subjects).signingIdentity).relationship;
  const readinessRelationship = object(object(version.readinessSnapshot).signingIdentity).relationship;
  return version.signingSubjectType === "affiliate" || version.signingSubjectType === "upward"
    || [frozenRelationship, readinessRelationship].some(relationship => relationship === "outside" || relationship === "upward");
}

async function readCatalog(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    /* contract_generated_archive_original_catalog_v1 */
    WITH recipe(name,relation,fn,kind,deferred,sha) AS (VALUES
      ('jg_generated_archive_original_append','public.jg_contract_generated_archive_original_v1',
        'public.jg_guard_generated_archive_original_v1()',31,FALSE,${appendBody}),
      ('jg_generated_archive_original_no_truncate','public.jg_contract_generated_archive_original_v1',
        'public.jg_guard_generated_archive_original_v1()',34,FALSE,${appendBody}),
      ('jg_generated_archive_originals_complete','public."ContractArchiveFile"',
        'public.jg_require_generated_archive_originals_v1()',5,TRUE,${completionBody})
    )
    SELECT c.oid::text AS "relationOid", a.oid::text AS "anchorOid", c.relowner::text AS "ownerOid", d.oid::text AS "databaseOid",
      current_user::regrole::oid::text AS "roleOid",
      pg_catalog.pg_backend_pid() AS "backendPid", pg_catalog.txid_current()::text AS "transactionId",
      c.relowner<>current_user::regrole::oid AND current_user=session_user
      AND pg_catalog.current_setting('session_replication_role')='origin'
      AND c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relkind='r' AND c.relpersistence='p'
      AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid)
      AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
        =ARRAY['evidenceId:25','archiveId:25','bucket:25','objectKey:25','objectGeneration:25','scope:3802']
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND (a.attacl IS NOT NULL OR NOT a.attnotnull OR a.atthasdef OR a.attgenerated<>'' OR a.attidentity<>''))
      AND 2=(SELECT count(*) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
        WHERE k.conrelid=c.oid AND k.convalidated AND NOT k.condeferrable AND i.indisvalid AND i.indisready
          AND ((k.contype='p' AND k.conkey=ARRAY[1]::smallint[])
            OR (k.contype='u' AND k.conkey=ARRAY[2,3,4]::smallint[])))
      AND 2=(SELECT count(*) FROM pg_catalog.pg_constraint k
        JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attname='id' AND k.confkey=ARRAY[a.attnum]::smallint[]
        WHERE k.conrelid=c.oid AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND k.confdeltype='r'
          AND ((k.conkey=ARRAY[1]::smallint[] AND k.confrelid='public."ContractArchiveEvidenceFile"'::regclass)
            OR (k.conkey=ARRAY[2]::smallint[] AND k.confrelid='public."ContractArchiveFile"'::regclass)))
      AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=current_user::regrole::oid
        AND a.grantor=c.relowner AND a.privilege_type='SELECT' AND NOT a.is_grantable)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantor<>c.relowner OR a.grantee<>c.relowner
        AND (a.grantee<>current_user::regrole::oid OR a.privilege_type<>'SELECT' OR a.is_grantable))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
        AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
          OR pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'CREATE')
          OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
      AND 3=(SELECT count(*) FROM recipe x
        JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.fn)
          AND p.proowner=c.relowner AND p.pronamespace=c.relnamespace AND NOT p.prosecdef
          AND p.prokind='f' AND p.provolatile='v' AND p.prorettype='pg_catalog.trigger'::regtype
          AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
          AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=x.sha
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
        JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid AND t.tgname=x.name AND t.tgrelid=pg_catalog.to_regclass(x.relation)
          AND t.tgtype=x.kind AND t.tgenabled='O' AND NOT t.tgisinternal
          AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred AND (t.tgconstraint<>0)=x.deferred
          AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgqual IS NULL
        WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
      AND 2=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid) AS qualified
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_class a
      ON a.oid=pg_catalog.to_regclass('public.jg_contract_generated_upward_seal_binding_v1')
        AND a.relowner=c.relowner AND a.relnamespace=c.relnamespace AND a.relkind='r' AND a.relpersistence='p'
        AND NOT a.relrowsecurity AND NOT a.relforcerowsecurity
    CROSS JOIN pg_catalog.pg_database d
    WHERE c.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_original_v1') AND d.datname=pg_catalog.current_database()
  `);
  const result = rows.length === 1 ? rows[0] : null;
  if (!result || result.qualified !== true || !["relationOid","anchorOid","ownerOid","databaseOid","roleOid"].every(key => {
    const value = result[key];
    return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4_294_967_295;
  }) || result.ownerOid === result.roleOid
    || typeof result.backendPid !== "number" || !Number.isSafeInteger(result.backendPid) || result.backendPid < 1
    || typeof result.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(result.transactionId)) unavailable();
  return result;
}

/** Reads only fixed-version evidence. The receipt and file callers enforce their own business authorization. */
export async function readGeneratedArchiveOriginals(tx: Prisma.TransactionClient, owner: Contract, version: ContractVersion,
  archive: ContractArchiveFile, evidence: readonly ContractArchiveEvidenceFile[]) {
  try {
    const relationship = version.signingSubjectType === "affiliate" ? "outside" : version.signingSubjectType === "upward" ? "upward" : null;
    const signing = object(object(version.readinessSnapshot).signingIdentity);
    const authority = object(archive.authoritySnapshot);
    const basis = object(authority.sourceBasis);
    if (!relationship || signing.relationship !== relationship || !isDeepStrictEqual(object(basis.subjects).signingIdentity, signing)
      || archive.archiveSource !== "generated_approval" || archive.archiveProtocolVersion !== 2 || archive.status !== "confirmed"
      || archive.contractVersionId !== version.id || version.contractId !== owner.id || owner.voidedAt
      || owner.ownerUserId !== archive.uploadedByUserId || archive.confirmedByUserId !== archive.uploadedByUserId
      || !archive.approvalInstanceId || !archive.sealTaskId || !archive.confirmedAt || !archive.idempotencyKey
      || version.effectiveAt?.getTime() !== archive.confirmedAt.getTime()
      || authority.projectId !== owner.projectId || authority.contractId !== owner.id || authority.contractVersionId !== version.id
      || authority.requestSha256 !== archive.requestSha256 || authority.fileManifestSha256 !== archive.fileManifestSha256
      || !archive.requestSha256 || !sha.test(archive.requestSha256)
      || !archive.authoritySha256 || !sha.test(archive.authoritySha256) || !archive.fileManifestSha256 || !sha.test(archive.fileManifestSha256)
      || archive.documentContentRevision !== version.documentContentRevision
      || archive.documentContentFingerprint !== version.documentContentFingerprint
      || evidence.length < 1 || evidence.length > 20) unavailable();
    const catalog = await readCatalog(tx);
    const task = await tx.contractSealTask.findUnique({ where: { id: archive.sealTaskId } });
    const round = await tx.approvalInstance.findUnique({ where: { id: archive.approvalInstanceId } });
    if (!task || task.id !== archive.sealTaskId || task.status !== "completed" || task.contractVersionId !== version.id
      || task.approvalInstanceId !== archive.approvalInstanceId || task.handlerUserId !== archive.uploadedByUserId
      || !task.completedByUserId || !task.completedAt || task.completedAt > archive.confirmedAt
      || !round || round.id !== archive.approvalInstanceId || round.status !== "approved" || round.businessId !== version.id
      || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.applicantUserId !== archive.uploadedByUserId
      || !Array.isArray(round.frozenNodes) || !isDeepStrictEqual(object(round.frozenNodes[0]).submissionSnapshot, version.readinessSnapshot)) unavailable();
    const expectedScope = {
      protocolVersion: 1, archiveSource: "generated_approval", relationship, projectId: owner.projectId, contractId: owner.id,
      contractVersionId: version.id, approvalInstanceId: archive.approvalInstanceId, sealTaskId: archive.sealTaskId,
      uploaderUserId: archive.uploadedByUserId, sealConfirmerUserId: task.completedByUserId,
      idempotencyKey: archive.idempotencyKey, requestSha256: archive.requestSha256, authoritySha256: archive.authoritySha256,
      fileManifestSha256: archive.fileManifestSha256, documentContentRevision: archive.documentContentRevision,
      documentContentFingerprint: archive.documentContentFingerprint
    };
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
      /* contract_generated_archive_original_read_v1 */
      SELECT p."evidenceId",p."scope",p."bucket",p."objectKey",p."objectGeneration",
        e."fileId",e."displayOrder",e."mimeType",e."sizeBytes",e."contentSha256"
      FROM public.jg_contract_generated_archive_original_v1 p
      JOIN pg_catalog.pg_class c ON c.oid=p.tableoid
      JOIN public.jg_contract_generated_upward_seal_binding_v1 b
        ON b.tableoid=${String(catalog.anchorOid)}::pg_catalog.oid AND b."protocolVersion"=1
        AND b."ownerOid"=c.relowner AND b."namespaceOid"=c.relnamespace
        AND b."applicationRoleOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
      JOIN public."ContractArchiveEvidenceFile" e ON e."id"=p."evidenceId" AND e."archiveFileId"=p."archiveId"
      JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=p."bucket" AND f."objectKey"=p."objectKey"
        AND f."mimeType"=e."mimeType" AND f."sizeBytes"=e."sizeBytes" AND f."contentSha256"=e."contentSha256"
        AND f."uploadedByUserId"=${archive.uploadedByUserId} AND f."storageStatus"='active'
        AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
      WHERE p.tableoid=${String(catalog.relationOid)}::pg_catalog.oid AND p."archiveId"=${archive.id}
        AND e."contractVersionId"=${version.id}
      ORDER BY e."displayOrder" LIMIT 21
    `);
    if (rows.length !== evidence.length || new Set(rows.map(row => JSON.stringify([row.bucket,row.objectKey]))).size !== rows.length) unavailable();
    const originals = rows.map((row, index) => {
      const file = evidence[index];
      if (row.evidenceId !== file.id || row.fileId !== file.fileId || row.displayOrder !== index || file.displayOrder !== index
        || file.archiveFileId !== archive.id || file.contractVersionId !== version.id
        || row.mimeType !== "application/pdf" || row.mimeType !== file.mimeType || row.sizeBytes !== file.sizeBytes
        || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || row.contentSha256 !== file.contentSha256 || !sha.test(file.contentSha256)
        || typeof row.bucket !== "string" || !row.bucket.trim() || typeof row.objectKey !== "string" || !row.objectKey.trim()
        || typeof row.objectGeneration !== "string" || row.objectGeneration.length > 1024
        || !/^[\x21-\x7e]+$/u.test(row.objectGeneration) || row.objectGeneration.toLowerCase() === "null" || row.objectGeneration.includes(",")
        || !isDeepStrictEqual(row.scope, expectedScope)) unavailable();
      return { fileId: file.fileId, displayOrder: index, mimeType: "application/pdf" as const, sizeBytes: file.sizeBytes,
        contentSha256: file.contentSha256, bucket: row.bucket, objectKey: row.objectKey, objectGeneration: row.objectGeneration };
    });
    if (!isDeepStrictEqual(await readCatalog(tx), catalog)) unavailable();
    return originals;
  } catch {
    unavailable();
  }
}
