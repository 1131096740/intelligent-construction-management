import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type FileObject } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { readSignedOriginalVersion, type GeneratedArchivePreparationReader } from "./contract-generated-archive-preparation";

export const DIRECT_ARCHIVE_EXECUTOR = Symbol("DIRECT_ARCHIVE_EXECUTOR");
export const DIRECT_ARCHIVE_ISSUER_CLIENT = Symbol("DIRECT_ARCHIVE_ISSUER_CLIENT");
export const DIRECT_ARCHIVE_RUNTIME_CLIENT = Symbol("DIRECT_ARCHIVE_RUNTIME_CLIENT");
export type DirectArchiveSqlClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type DirectArchiveRuntimeClient = {
  $transaction<T>(operation: (tx: DirectArchiveSqlClient) => Promise<T>): Promise<T>;
};

type Original = Readonly<Pick<FileObject, "bucket" | "objectKey" | "mimeType" | "sizeBytes"> & {
  fileId: string; displayOrder: number; contentSha256: string;
}>;
export type DirectArchiveExecution = Readonly<{
  actor: string; projectId: string; contractId: string; versionId: string; revision: number;
  inputSha256: string; key: string; nativeNonce: string; originals: readonly Original[];
}>;
export type DirectArchiveExecutor = Readonly<{ execute(command: DirectArchiveExecution): Promise<void> }>;

function unavailable(): never {
  throw new ServiceUnavailableException("直签登记写入资格尚未完整核对，请保留原件和本次标识");
}

/** The two clients must use separately provisioned logins. Neither client uses the ordinary application connection. */
export function nativeDirectArchiveExecutor(reader: GeneratedArchivePreparationReader,
  issuer: DirectArchiveSqlClient, executor: DirectArchiveRuntimeClient): DirectArchiveExecutor {
  return {
    async execute({ actor, projectId, contractId, versionId, revision, inputSha256, key, nativeNonce, originals }) {
      if (Object.is(issuer, executor)) unavailable();
      const evidence = [];
      for (const original of originals) {
        const verified = await readSignedOriginalVersion(reader, original);
        if (original.mimeType === "application/pdf") {
          const pdf = await PDFDocument.load(verified.buffer).catch(() => {
            throw new BadRequestException("归档PDF无法解析，请重新核对原件");
          });
          if (!pdf.getPageCount()) throw new BadRequestException("归档PDF不能为空");
        }
        await readSignedOriginalVersion(reader, { ...original, expectedGeneration: verified.objectGeneration });
        evidence.push({ ...original, objectGeneration: verified.objectGeneration });
      }
      const ordered = JSON.stringify(evidence);
      const admission = Prisma.sql`
        SELECT 1 WHERE CASE WHEN current_user=session_user
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl)
          THEN public.jg_contract_direct_archive_native_channel_v1()=${nativeNonce}::uuid ELSE FALSE END
      `;
      const intents = await issuer.$queryRaw<Array<{ intentId: string }>>(Prisma.sql`
        WITH admitted AS MATERIALIZED (${admission})
        SELECT public.jg_issue_contract_direct_archive_intent_v1(${actor}::text,${projectId}::text,${contractId}::text,
          ${versionId}::text,${revision}::integer,${inputSha256}::text,${key}::text,${ordered}::jsonb)::text AS "intentId" FROM admitted
      `);
      const intent = intents.length === 1 ? intents[0] : undefined;
      if (!intent || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(intent.intentId)) unavailable();
      const rows = await executor.$transaction(tx => tx.$queryRaw<Array<{ archiveId: string }>>(Prisma.sql`
        WITH admitted AS MATERIALIZED (${admission})
        SELECT public.jg_execute_contract_direct_archive_outside_v1(${intent.intentId}::uuid,${actor}::text,${projectId}::text,
          ${contractId}::text,${versionId}::text,${revision}::integer,${inputSha256}::text,${key}::text,${ordered}::jsonb) AS "archiveId" FROM admitted
      `));
      if (rows.length !== 1 || !rows[0].archiveId) unavailable();
    }
  };
}
