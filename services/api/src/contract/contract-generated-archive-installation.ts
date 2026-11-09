import { Prisma } from "@prisma/client";
import { generatedArchiveIngressCatalog, installedCompletionGuardBody, readNativeGeneratedArchiveWriter } from "./contract-generated-archive-write-authority";

export type GeneratedArchiveSealFile = { fileId: string; mimeType: string; sizeBytes: number; contentSha256: string };

export type GeneratedArchiveSealScope = Readonly<{
  relationship: "outside" | "upward";
  projectId: string;
  contractId: string;
  contractVersionId: string;
  approvalInstanceId: string;
  sealTaskId: string;
  handlerUserId: string;
  actorUserId: string;
  documentContentRevision: number;
  documentContentFingerprint: string;
  sourceRevision: number;
  layoutTemplateVersionId: string;
  sourceSha256: string;
  signingIdentity: Readonly<Record<string, unknown>>;
  generatedDocumentId: string;
  files: readonly [GeneratedArchiveSealFile, GeneratedArchiveSealFile];
}>;

export type GeneratedArchiveSealAuthority = {
  transaction: Prisma.TransactionClient;
  scope: GeneratedArchiveSealScope;
  installation: {
    databaseOid: string;
    namespaceOid: string;
    currentRoleOid: string;
    sessionRoleOid: string;
    archiveWriterOid: string;
    signedFileAuthorityOid: string;
    archiveReceiptReaderOid: string;
    operatingAuthorityOid: string;
    backendPid: number;
    transactionId: string;
  };
};

/** Only an installed archive authority can produce this evidence. The source candidate has no producer. */
export const readGeneratedArchiveSealAuthority: (
  tx: Prisma.TransactionClient,
  scope: GeneratedArchiveSealScope
) => Promise<GeneratedArchiveSealAuthority | null> = async () => null;

export type GeneratedArchiveSignedOriginal = Readonly<{
  fileId: string;
  displayOrder: number;
  bucket: string;
  objectKey: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  contentSha256: string;
  objectGeneration: string;
}>;

/** scope.actorUserId identifies the seal confirmer. */
export type GeneratedArchiveRequestBinding = Readonly<{
  protocolVersion: 1;
  archiveSource: "generated_approval";
  scope: GeneratedArchiveSealScope;
  uploaderUserId: string;
  idempotencyKey: string;
  requestSha256: string;
  originals: readonly GeneratedArchiveSignedOriginal[];
}>;

type GeneratedArchiveBindingWitness = Readonly<{
  transaction: Prisma.TransactionClient;
  installation: GeneratedArchiveSealAuthority["installation"];
  binding: GeneratedArchiveRequestBinding;
}>;

/**
 * The installed authority reads the exact attestation inside the caller's transaction.
 * The request supplies lookup coordinates. The authority must verify them independently.
 */
export const readGeneratedArchiveRequestBinding: (
  tx: Prisma.TransactionClient,
  binding: GeneratedArchiveRequestBinding
) => Promise<GeneratedArchiveBindingWitness | null> = async () => null;

export type GeneratedArchiveCompletion = Readonly<{
  protocolVersion: 1;
  policy: "operating_ledger_not_enabled";
  archiveId: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  approvalInstanceId: string;
  sealTaskId: string;
  uploaderUserId: string;
  idempotencyKey: string;
  requestSha256: string;
  authoritySha256: string;
  fileManifestSha256: string;
  archivedAt: string;
  evidenceIds: readonly string[];
  originals: readonly GeneratedArchiveSignedOriginal[];
}>;

export type GeneratedArchiveWriterAuthority = Readonly<{
  transaction: Prisma.TransactionClient;
  installation: GeneratedArchiveSealAuthority["installation"];
  binding: GeneratedArchiveRequestBinding;
  // Fixed originals are appended before activation. Completion is captured independently after activation and audit.
  appendOriginals: (command: GeneratedArchiveCompletion) => Promise<void>;
  appendCompletion: (archiveId: string) => Promise<void>;
}>;

/** A successor installer must independently qualify the writer, including its database activation and pin permissions. */
export const readGeneratedArchiveWriterAuthority: (
  tx: Prisma.TransactionClient,
  binding: GeneratedArchiveRequestBinding
) => Promise<GeneratedArchiveWriterAuthority | null> = readNativeGeneratedArchiveWriter;

const captureCompletionBody = "802380ee6a481f49a77986ab828b0b48d00d263313360dccf36991eb5387b3b3";
const guardCompletionBody = "b560be4e264168b89f208299b309b76240a6d589cba5ec5bb9bd201ae8c82eea";
const requireCompletionBody = "1efefbd2aacc26f74f4dfccee0f6a29fec45b241beb9e3838278db02f8f3fc13";

/** Read the database-owned completion. The caller still checks current access and the full original evidence. */
export async function readGeneratedArchiveCompletion(tx: Prisma.TransactionClient, archiveId: string) {
  const [relation] = await tx.$queryRaw<{ relationOid: string | null }[]>(Prisma.sql`
    /* contract_generated_archive_completion_relation_v1 */
    SELECT pg_catalog.to_regclass('public.jg_contract_generated_archive_completion_v1')::pg_catalog.oid::text AS "relationOid"
  `);
  const relationOid = relation?.relationOid;
  if (!relationOid || !/^[1-9][0-9]{0,9}$/u.test(relationOid) || Number(relationOid) > 4_294_967_295) return null;

  const rows = await tx.$queryRaw<{ completion: unknown }[]>(Prisma.sql`
    /* contract_generated_archive_completion_read_v1 */
    WITH ingress AS (${generatedArchiveIngressCatalog}),
    recipe(fn, result_type, body, successor) AS (VALUES
      ('public.jg_capture_generated_archive_completion_v1(text)', 'pg_catalog.jsonb', ${captureCompletionBody}, NULL),
      ('public.jg_guard_generated_archive_completion_v1()', 'pg_catalog.trigger', ${guardCompletionBody}, ${installedCompletionGuardBody}),
      ('public.jg_require_generated_archive_completion_v1()', 'pg_catalog.trigger', ${requireCompletionBody}, NULL)
    ), trigger_recipe(name, relation, fn, kind, deferred) AS (VALUES
      ('jg_generated_archive_completion_append', 'public.jg_contract_generated_archive_completion_v1',
        'public.jg_guard_generated_archive_completion_v1()', 31, FALSE),
      ('jg_generated_archive_completion_no_truncate', 'public.jg_contract_generated_archive_completion_v1',
        'public.jg_guard_generated_archive_completion_v1()', 34, FALSE),
      ('jg_generated_archive_completion_verify', 'public.jg_contract_generated_archive_completion_v1',
        'public.jg_guard_generated_archive_completion_v1()', 5, TRUE),
      ('jg_generated_archive_completion_required', 'public."ContractArchiveFile"',
        'public.jg_require_generated_archive_completion_v1()', 5, TRUE)
    )
    SELECT m."completion"
    FROM public.jg_contract_generated_archive_completion_v1 m
    JOIN pg_catalog.pg_class c ON c.oid=m.tableoid
    JOIN pg_catalog.pg_class anchor ON anchor.oid=pg_catalog.to_regclass('public.jg_contract_generated_upward_seal_binding_v1')
      AND anchor.relowner=c.relowner AND anchor.relnamespace=c.relnamespace AND anchor.relkind='r'
      AND anchor.relpersistence='p' AND NOT anchor.relrowsecurity AND NOT anchor.relforcerowsecurity
    JOIN public.jg_contract_generated_upward_seal_binding_v1 b ON b.tableoid=anchor.oid AND b."protocolVersion"=1
      AND b."ownerOid"=c.relowner AND b."namespaceOid"=c.relnamespace
      AND b."applicationRoleOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE m.tableoid=${relationOid}::pg_catalog.oid AND m."archiveId"=${archiveId}
      AND c.relowner<>b."applicationRoleOid" AND c.relnamespace=pg_catalog.to_regnamespace('public')
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND pg_catalog.current_setting('session_replication_role')='origin'
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid)
      AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=ARRAY['archiveId:25','completion:3802']
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND (a.attacl IS NOT NULL OR NOT a.attnotnull OR a.atthasdef OR a.attgenerated<>'' OR a.attidentity<>''))
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
        WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1]::smallint[] AND k.convalidated
          AND NOT k.condeferrable AND i.indisvalid AND i.indisready)
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a
        ON a.attrelid=k.confrelid AND a.attname='id' AND k.confkey=ARRAY[a.attnum]::smallint[]
        WHERE k.conrelid=c.oid AND k.contype='f' AND k.conkey=ARRAY[1]::smallint[] AND k.convalidated
          AND NOT k.condeferrable AND k.confdeltype='r' AND k.confrelid='public."ContractArchiveFile"'::regclass)
      AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=b."applicationRoleOid"
        AND a.grantor=c.relowner AND a.privilege_type='SELECT' AND NOT a.is_grantable)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantor<>c.relowner OR a.grantee<>c.relowner
        AND (a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
        AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER')
          OR pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'CREATE')
          OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
      AND 3=(SELECT count(*) FROM recipe x
        JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.fn) AND p.proowner=c.relowner
          AND p.pronamespace=c.relnamespace AND p.prokind='f' AND p.provolatile='v'
          AND p.prorettype=pg_catalog.to_regtype(x.result_type)
          AND ((NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
            AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=x.body)
            OR (p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
              AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=x.successor
              AND EXISTS(SELECT 1 FROM ingress i WHERE i.relowner=c.relowner AND i.relnamespace=c.relnamespace)))
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
        WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
      AND 4=(SELECT count(*) FROM trigger_recipe x JOIN pg_catalog.pg_trigger t
        ON t.tgfoid=pg_catalog.to_regprocedure(x.fn) AND t.tgname=x.name AND t.tgrelid=pg_catalog.to_regclass(x.relation)
        AND t.tgtype=x.kind AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred AND (t.tgconstraint<>0)=x.deferred
        AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgqual IS NULL)
      AND 3=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
    LIMIT 2
  `);
  return rows.length === 1 ? { transaction: tx, completion: rows[0].completion } : null;
}
