import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type ReviewReferenceCatalog = "legacy" | "ready";
type FileCleanupTarget = { id: string; bucket: string; objectKey: string };
type FileCleanupCohort = FileCleanupTarget & { storageStatus: string; purgeReceiptId: string | null };

const RETENTION_MIGRATION = "20261109110000_contract_direct_review_retention_v1";

function unavailable(): never {
  throw new ServiceUnavailableException("履约复核原件保留状态暂时无法核对");
}

/** The old relation-free branch is separate SQL so PostgreSQL never parses a missing table. */
export async function reviewReferenceCatalog(
  tx: Prisma.TransactionClient,
  purpose: "cleanup" | "ticket" = "cleanup"
): Promise<ReviewReferenceCatalog> {
  const [row, ...extra] = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
    /* contract_economic_review_file_reference_catalog */
    WITH scope AS (
      SELECT pg_catalog.to_regnamespace('public')::oid AS namespace,
        pg_catalog.to_regclass('public."ContractEconomicReviewFileReference"')::oid AS refs,
        pg_catalog.to_regclass('public."ContractEconomicReview"')::oid AS reviews,
        pg_catalog.to_regclass('public.jg_contract_direct_review_retention_binding_v1')::oid AS binding
    ), fields("name", "type") AS (VALUES
      ('reviewId',25),('sourceRef',25),('displayOrder',23),('sourceContractVersionId',25),
      ('directInputProtocolVersion',23),('sourceRevision',23),('inputSha256',25),('fileId',25),
      ('mimeType',25),('sizeBytes',23),('contentSha256',25),('bucket',25),('objectKey',25)
    ), binding_fields("name", "type") AS (VALUES
      ('protocolVersion',23),('applicationRoleOid',26),('databaseOid',26),('anchorOwnerOid',26),('bindings',3802)
    )
    SELECT CASE
      WHEN refs IS NULL AND binding IS NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class p WHERE p.oid=reviews AND p.relnamespace=namespace
          AND p.relkind='r' AND NOT p.relrowsecurity AND NOT p.relforcerowsecurity
      ) AND NOT EXISTS(
        SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=reviews AND a.attnum>0
          AND NOT a.attisdropped AND a.attname='directSourcePins'
      ) THEN 'legacy'
      WHEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_class p ON p.oid=reviews
          JOIN pg_catalog.pg_class b ON b.oid=binding
        WHERE r.oid=refs AND r.relnamespace=namespace AND p.relnamespace=namespace AND b.relnamespace=namespace
          AND r.relowner=p.relowner AND b.relowner=p.relowner
          AND b.relowner=(SELECT pr.proowner FROM pg_catalog.pg_proc pr WHERE pr.oid=pg_catalog.to_regprocedure(
            'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",pg_catalog.text,pg_catalog.text)'))
          AND r.relkind='r' AND p.relkind='r' AND b.relkind='r'
          AND NOT r.relrowsecurity AND NOT r.relforcerowsecurity
          AND NOT p.relrowsecurity AND NOT p.relforcerowsecurity
          AND NOT b.relrowsecurity AND NOT b.relforcerowsecurity
          AND (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=refs AND a.attnum>0 AND NOT a.attisdropped)=13
          AND NOT EXISTS (SELECT 1 FROM fields f WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=refs AND a.attnum>0
              AND NOT a.attisdropped AND a.attname=f.name AND a.atttypid=f.type::oid
              AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
              AND ((${purpose}='cleanup' AND f.name NOT IN ('fileId','objectKey'))
                OR pg_catalog.has_column_privilege(current_user,refs,a.attnum,'SELECT'))
          ))
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=reviews AND a.attnum>0
            AND NOT a.attisdropped AND a.attname='directSourcePins' AND a.atttypid='pg_catalog.jsonb'::regtype)
          AND (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=binding AND a.attnum>0 AND NOT a.attisdropped)=5
          AND NOT EXISTS (SELECT 1 FROM binding_fields f WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=binding AND a.attnum>0
              AND NOT a.attisdropped AND a.attname=f.name AND a.atttypid=f.type::oid
              AND a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated=''
          ))
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
            JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='protocolVersion' AND NOT a.attisdropped
            JOIN pg_catalog.pg_index idx ON idx.indexrelid=k.conindid AND idx.indrelid=k.conrelid
            WHERE k.conrelid=binding AND k.contype='p' AND k.conkey=ARRAY[a.attnum]::smallint[]
              AND k.convalidated AND NOT k.condeferrable AND idx.indisprimary AND idx.indisunique
              AND idx.indisvalid AND idx.indisready)
      ) THEN 'ready'
      ELSE 'unavailable'
    END AS state FROM scope
  `);
  if (extra.length || !row) return unavailable();
  if (row.state === "ready") {
    const ledger = await tx.$queryRaw<Array<{ completed: boolean }>>(Prisma.sql`
      /* contract_economic_review_file_reference_completed_206 */
      SELECT (count(*)=1 AND count(*) FILTER (WHERE finished_at IS NOT NULL)=1) AS completed
      FROM public."_prisma_migrations" WHERE migration_name=${RETENTION_MIGRATION} AND rolled_back_at IS NULL
    `);
    if (ledger.length !== 1 || ledger[0]?.completed !== true) return unavailable();
    return "ready";
  }
  if (row.state !== "legacy") return unavailable();
  const ledger = await tx.$queryRaw<Array<{ applied: boolean }>>(Prisma.sql`
    /* contract_economic_review_file_reference_migration */
    SELECT EXISTS (SELECT 1 FROM public."_prisma_migrations"
      WHERE migration_name=${RETENTION_MIGRATION} AND rolled_back_at IS NULL) AS applied
  `);
  if (ledger.length !== 1 || ledger[0]?.applied !== false) return unavailable();
  return "legacy";
}

/** Legacy databases do not have the shared key lock, but visible aliases are still unsafe. */
export async function hasExactLegacyCleanupKey(
  tx: Prisma.TransactionClient, target: Pick<FileCleanupTarget, "id" | "objectKey">
): Promise<boolean> {
  if (!target.objectKey) return false;
  const rows = await tx.$queryRaw<Array<{ exact: boolean }>>(Prisma.sql`
    /* contract_economic_review_legacy_cleanup_key */
    SELECT (count(*)=1 AND min(cohort."id")=${target.id}) IS TRUE AS exact
    FROM (SELECT "id" FROM public."FileObject" WHERE "objectKey"=${target.objectKey} LIMIT 2) cohort
  `);
  return rows.length === 1 && rows[0]?.exact === true;
}

export async function contractReviewRetainedObjectKeys(
  tx: Prisma.TransactionClient, targets: readonly FileCleanupTarget[]
): Promise<Set<string>> {
  if (!targets.length) return new Set();
  if (await reviewReferenceCatalog(tx) === "legacy") return new Set();
  return queryReviewRetainedObjectKeys(tx, targets);
}

async function queryReviewRetainedObjectKeys(
  tx: Prisma.TransactionClient, targets: readonly FileCleanupTarget[]
): Promise<Set<string>> {
  const keys = [...new Set(targets.map(row => row.objectKey))].sort();
  if (keys.some(key => !key)) return unavailable();
  const rows = await tx.$queryRaw<Array<{ fileId: string; objectKey: string }>>(Prisma.sql`
    /* contract_economic_review_cleanup_retention */
    SELECT DISTINCT r."fileId",r."objectKey"
    FROM public."ContractEconomicReviewFileReference" r
    WHERE r."objectKey" IN (${Prisma.join(keys)})
    UNION
    SELECT DISTINCT f."id" AS "fileId", f."objectKey" FROM public."FileObject" f
    JOIN public."ContractDraftAttachment" a ON a."fileId"=f."id"
    WHERE a."slotKey"='direct_signed_originals_v1' AND f."objectKey" IN (${Prisma.join(keys)})
  `);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.fileId !== "string" || !row.fileId || !keys.includes(row.objectKey))) return unavailable();
  return new Set(rows.map(row => row.objectKey));
}

/** Key-only storage is ambiguous when more than one DB file can address the key. */
export async function lockContractReviewCleanupCohort(
  tx: Prisma.TransactionClient, targets: readonly FileCleanupTarget[],
  catalog?: ReviewReferenceCatalog
): Promise<FileCleanupCohort[] | null> {
  if (!targets.length) return [];
  const state = catalog ?? await reviewReferenceCatalog(tx);
  if (state === "legacy") return [];
  const keys = [...new Set(targets.map(row => row.objectKey))].sort();
  if (keys.length !== targets.length || keys.some(key => !key)) return null;
  const rows = await tx.$queryRaw<FileCleanupCohort[]>(Prisma.sql`
    /* contract_economic_review_cleanup_cohort */
    SELECT "id","bucket","objectKey","storageStatus","purgeReceiptId" FROM public."FileObject"
    WHERE "objectKey" IN (${Prisma.join(keys)}) ORDER BY "id" FOR UPDATE NOWAIT
  `);
  if (rows.length !== targets.length || !targets.every(target => rows.some(row =>
    row.id === target.id && row.bucket === target.bucket && row.objectKey === target.objectKey
  ))) return null;
  for (const key of keys) {
    const witness = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      /* contract_economic_review_cleanup_key */
      SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
        'jg:contract-direct-review-object-key-v1:' || ${key}, 0)) AS locked
    `);
    if (witness.length !== 1 || witness[0]?.locked !== true) return null;
  }
  // An alias might have committed while the F cohort was being locked.
  const [cohort] = await tx.$queryRaw<Array<{ ids: string[] }>>(Prisma.sql`
    /* contract_economic_review_cleanup_cohort_recheck */
    SELECT pg_catalog.array_agg("id" ORDER BY "id") AS ids FROM public."FileObject"
    WHERE "objectKey" IN (${Prisma.join(keys)})
  `);
  if (!Array.isArray(cohort?.ids) || cohort.ids.length !== rows.length ||
    rows.some((row, index) => row.id !== cohort.ids[index])) return null;
  if ((await queryReviewRetainedObjectKeys(tx, targets)).size) return null;
  return rows;
}
