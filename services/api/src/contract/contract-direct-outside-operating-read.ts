import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type ContractArchiveFile } from "@prisma/client";
import { assertDirectPendingSourceContinuity, assertDirectPendingSourceQualification } from "./contract-direct-pending-source";

import { directOutsideOperatingReaderCatalog, matchesDirectOutsideOperatingReader } from "./contract-direct-outside-operating-reader-catalog";

type Row = Record<string, unknown>;
type Qualification = Awaited<ReturnType<typeof assertDirectPendingSourceQualification>>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function unavailable(): never {
  throw new ServiceUnavailableException("表外直签原标识和固定原件尚未完整核对，请保留原标识");
}

export function usesDirectOutsideOperatingProof(parent: ContractArchiveFile) {
  return parent.archiveSource === "direct_signed" &&
    record(record(parent.authoritySnapshot)?.operatingConsequence)?.mode === "projection_required";
}

/** This proof has an independent catalog, original claim and fixed generations. */
export async function readDirectOutsideOperatingProof(tx: Prisma.TransactionClient, parent: ContractArchiveFile,
  prior?: Qualification): Promise<{ proof: Row; originals: unknown }> {
  if (!usesDirectOutsideOperatingProof(parent) || parent.archiveProtocolVersion !== 2 || parent.status !== "confirmed") unavailable();
  const qualification = prior ?? await assertDirectPendingSourceQualification(tx);
  const completionOid = qualification.retention?.completion?.actual.relationOid;
  if (typeof completionOid !== "string" || !qualification.dispatch) unavailable();
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    /* contract_direct_outside_operating_archive_read_v2 */
    ${directOutsideOperatingReaderCatalog}
    SELECT q.*,public.jg_read_direct_outside_operating_archive_v2(${parent.id}::pg_catalog.text) AS envelope FROM qualified q
  `);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || !matchesDirectOutsideOperatingReader(row, qualification.bootstrap, completionOid)) unavailable();
  const envelope = record(row.envelope);
  const proof = record(envelope?.proof);
  if (!proof || proof.proofProtocolVersion !== 1 || proof.archiveId !== parent.id || proof.contractVersionId !== parent.contractVersionId
    || proof.authoritySha256 !== parent.authoritySha256 || proof.idempotencyKey !== parent.idempotencyKey
    || proof.requestSha256 !== parent.requestSha256 || proof.sourceRevision !== parent.sourceRevision
    || proof.handlerUserId !== parent.uploadedByUserId) unavailable();
  await assertDirectPendingSourceContinuity(tx, qualification);
  return { proof, originals: envelope?.originals };
}
