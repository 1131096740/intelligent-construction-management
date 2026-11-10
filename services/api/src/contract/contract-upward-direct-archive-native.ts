import { BadRequestException } from "@nestjs/common";
import { Prisma, type ContractArchiveFile } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { PDFDocument } from "pdf-lib";
import { readSignedOriginalVersion, type GeneratedArchivePreparationReader } from "./contract-generated-archive-preparation";
import type { DirectArchiveRuntimeClient, DirectArchiveSqlClient } from "./contract-direct-archive-executor";
import { record, upwardArchiveUnavailable, type UpwardDirectArchiveAuthority } from "./contract-upward-direct-registration";

import { UPWARD_ARCHIVE_ADMISSION_SHA256 } from "./contract-upward-direct-source-pins";
export { UPWARD_ARCHIVE_ADMISSION_SHA256 } from "./contract-upward-direct-source-pins";

export async function readUpwardArchiveAdmission(tx: DirectArchiveSqlClient) {
  const rows = await tx.$queryRaw<Array<{ nonce: string; databaseOid: string; roleOid: string; backendPid: number; transactionId: string }>>(Prisma.sql`
    /* contract_upward_archive_admission_v1 */
    WITH source AS MATERIALIZED (
      SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_database d ON d.datname=current_database()
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=pg_catalog.to_regprocedure('public.jg_upward_direct_archive_admission_v1()')
        AND p.proowner=d.datdba AND p.pronamespace=pg_catalog.to_regnamespace('public')
        AND p.prokind='f' AND NOT p.prosecdef AND p.provolatile='v' AND p.proparallel='u'
        AND NOT(p.proisstrict OR p.proretset OR p.proleakproof) AND p.pronargs=0 AND p.pronargdefaults=0
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=${UPWARD_ARCHIVE_ADMISSION_SHA256}
        AND current_user=session_user AND current_setting('session_replication_role')='origin'
        AND has_function_privilege(current_user,p.oid,'EXECUTE')
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee=0 OR a.grantee<>p.proowner AND a.is_grantable)
    ) SELECT envelope->>'nonce' AS nonce,envelope->>'databaseOid' AS "databaseOid",envelope->>'roleOid' AS "roleOid",
      (envelope->>'backendPid')::integer AS "backendPid",envelope->>'transactionId' AS "transactionId"
    FROM (SELECT public.jg_upward_direct_archive_admission_v1() AS envelope FROM source) qualified
  `);
  const value = rows.length === 1 ? rows[0] : null;
  if (!value || !/^[a-f0-9-]{36}$/u.test(value.nonce) || !/^[1-9][0-9]*$/u.test(value.databaseOid)
    || !/^[1-9][0-9]*$/u.test(value.roleOid) || !Number.isSafeInteger(value.backendPid) || value.backendPid < 1
    || !/^[1-9][0-9]*$/u.test(value.transactionId)) upwardArchiveUnavailable();
  return value;
}

export function nativeUpwardDirectArchiveAuthority(reader: GeneratedArchivePreparationReader,
  issuer: DirectArchiveSqlClient, executor: DirectArchiveRuntimeClient): UpwardDirectArchiveAuthority {
  return {
    async prepare(tx, _owner, version, actor) {
      const before = await readUpwardArchiveAdmission(tx);
      const rows = await tx.$queryRaw<Array<{ input: unknown }>>(Prisma.sql`
        SELECT public.jg_prepare_upward_direct_archive_v1(${version.id}::text,${actor}::text) AS input
      `);
      const source = rows.length === 1 ? record(rows[0].input) : {};
      if (!isDeepStrictEqual(before, await readUpwardArchiveAdmission(tx)) || typeof source.qText !== "string"
        || typeof source.inputSha256 !== "string" || !source.Q) upwardArchiveUnavailable();
      return { Q: record(source.Q), qText: source.qText, inputSha256: source.inputSha256, nativeNonce: before.nonce };
    },
    async execute(command) {
      if (Object.is(issuer, executor)) upwardArchiveUnavailable();
      const evidence = [];
      for (const original of command.originals) {
        const verified = await readSignedOriginalVersion(reader, original);
        if (original.mimeType === "application/pdf") {
          const pdf = await PDFDocument.load(verified.buffer).catch(() => { throw new BadRequestException("归档PDF无法解析，请重新核对原件"); });
          if (!pdf.getPageCount()) throw new BadRequestException("归档PDF不能为空");
        }
        await readSignedOriginalVersion(reader, { ...original, expectedGeneration: verified.objectGeneration });
        evidence.push({ ...original, objectGeneration: verified.objectGeneration });
      }
      const source = Prisma.sql`${command.nativeNonce}::uuid,${command.actor}::text,${command.projectId}::text,
        ${command.contractId}::text,${command.versionId}::text,${command.revision}::integer,${command.inputSha256}::text,
        ${command.key}::text,${JSON.stringify(evidence)}::jsonb`;
      const rows = await issuer.$queryRaw<Array<{ intentId: string }>>(Prisma.sql`
        WITH admitted AS MATERIALIZED (
          SELECT 1 WHERE current_user=session_user
            AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl)
            AND public.jg_upward_issuer_channel_v2(${command.nativeNonce}::uuid) IS TRUE
        ) SELECT public.jg_issue_contract_direct_upward_intent_v2(${source})::text AS "intentId" FROM admitted
      `);
      if (rows.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(rows[0].intentId)) upwardArchiveUnavailable();
      const result = await executor.$transaction(tx => tx.$queryRaw<Array<{ archiveId: string }>>(Prisma.sql`
        SELECT public.jg_execute_contract_direct_upward_v2(${rows[0].intentId}::uuid,${source}) AS "archiveId"
      `));
      if (result.length !== 1 || !result[0].archiveId) upwardArchiveUnavailable();
    }
  };
}

/** Read-only qualified committed proof. Caller performs current business authorization first. */
export async function readUpwardDirectArchiveProof(tx: Prisma.TransactionClient, parent: ContractArchiveFile) {
  const before = await readUpwardArchiveAdmission(tx);
  const rows = await tx.$queryRaw<Array<{ proof: unknown }>>(Prisma.sql`
    SELECT public.jg_read_upward_direct_archive_v1(${parent.id}::text) AS proof
  `);
  const proof = rows.length === 1 ? record(rows[0].proof) : {};
  if (!isDeepStrictEqual(before, await readUpwardArchiveAdmission(tx)) || proof.archiveId !== parent.id
    || proof.contractVersionId !== parent.contractVersionId || proof.requestSha256 !== parent.requestSha256
    || proof.authoritySha256 !== parent.authoritySha256 || proof.sourceRevision !== parent.sourceRevision
    || proof.idempotencyKey !== parent.idempotencyKey || proof.handlerUserId !== parent.uploadedByUserId
    || !Array.isArray(proof.originals) || !proof.originals.length) upwardArchiveUnavailable();
  return proof;
}
