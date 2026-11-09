import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractArchiveFile, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { assertDirectPendingSourceContinuity, assertDirectPendingSourceQualification } from "./contract-direct-pending-source";
import { readDirectArchiveGenerations } from "../file/contract-archive-generation-read";
import { directArchiveRequestSha } from "./contract-direct-archive-request";
import type { RegisterDirectSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";

const proofRoutine = {
  name: "jg_contract_direct_archive_proof_v1", sha256: "4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f",
  language: "plpgsql", volatility: "s", parallel: "u", returnTypeOid: "3802"
} as const;
const hashRoutine = {
  name: "jg_contract_direct_archive_request_sha_v1", sha256: "f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf",
  language: "sql", volatility: "i", parallel: "s", returnTypeOid: "25"
} as const;
const sha256 = /^[a-f0-9]{64}$/u;
const uuid4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function unavailable(): never {
  throw new ServiceUnavailableException("直签归档持久结果尚未完整核对，请保留原标识");
}

async function readProofRoutines(tx: Prisma.TransactionClient, anchor: RecordValue) {
  const rows = await tx.$queryRaw<RecordValue[]>(Prisma.sql`
    /* contract_direct_archive_proof_catalog_v1 */
    SELECT p.proname AS name,p.oid::text AS oid,p.proowner::text AS "ownerOid",p.pronamespace::text AS "namespaceOid",
      pg_catalog.encode(public.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS sha256,
      l.lanname AS language,p.provolatile AS volatility,p.proparallel AS parallel,p.prorettype::text AS "returnTypeOid",
      p.proconfig AS configuration,p.prosecdef AS "securityDefiner",p.proisstrict AS strict,p.proretset AS "returnsSet",p.prokind AS kind,
      pg_catalog.has_function_privilege(current_user::pg_catalog.regrole::oid,p.oid,'EXECUTE') AS executable,
      NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0) AS "noPublicExecute",
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user::pg_catalog.regrole::oid,r.oid,'MEMBER')
        AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION')) AS "noGrantOption",
      current_user::pg_catalog.regrole::oid::text AS "currentRoleOid",session_user::pg_catalog.regrole::oid::text AS "sessionRoleOid",
      pg_catalog.pg_backend_pid() AS "backendPid",pg_catalog.txid_current()::text AS "transactionId"
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid IN (
      pg_catalog.to_regprocedure('public.jg_contract_direct_archive_proof_v1(pg_catalog.text)'),
      pg_catalog.to_regprocedure('public.jg_contract_direct_archive_request_sha_v1(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.text[])')
    ) ORDER BY p.proname COLLATE "C"
  `);
  if (rows.length !== 2) unavailable();
  for (const expected of [proofRoutine, hashRoutine]) {
    const actual = rows.find(row => row.name === expected.name);
    if (!actual || typeof actual.oid !== "string" || !/^[1-9][0-9]*$/u.test(actual.oid)
      || actual.ownerOid !== anchor.anchorOwnerOid || actual.namespaceOid !== anchor.namespaceOid
      || actual.sha256 !== expected.sha256 || actual.language !== expected.language || actual.volatility !== expected.volatility
      || actual.parallel !== expected.parallel || actual.returnTypeOid !== expected.returnTypeOid || actual.kind !== "f"
      || actual.securityDefiner !== false || actual.strict !== true || actual.returnsSet !== false
      || !isDeepStrictEqual(actual.configuration, ["search_path=pg_catalog, pg_temp"])
      || actual.executable !== true || actual.noPublicExecute !== true || actual.noGrantOption !== true
      || actual.currentRoleOid !== anchor.currentRoleOid || actual.sessionRoleOid !== anchor.sessionRoleOid
      || actual.backendPid !== anchor.backendPid || actual.transactionId !== anchor.transactionId) unavailable();
  }
  return rows;
}

/** A prepared source witness alone cannot supply a durable direct-archive receipt. */
export async function assertDirectArchivePersistentProof(tx: Prisma.TransactionClient, owner: Contract,
  version: ContractVersion, durable: ContractArchiveFile) {
  try {
    const key = durable.idempotencyKey;
    if (!key || !uuid4.test(key) || durable.archiveProtocolVersion !== 2 || durable.archiveSource !== "direct_signed"
      || version.status !== "effective" || version.id !== durable.contractVersionId || version.contractId !== owner.id
      || durable.uploadedByUserId !== owner.ownerUserId || !durable.authoritySha256 || !sha256.test(durable.authoritySha256)) unavailable();
    const qualification = await assertDirectPendingSourceQualification(tx);
    if (qualification.transition === null || qualification.retention === null) unavailable();
    const routines = await readProofRoutines(tx, qualification.bootstrap);
    const rows = await tx.$queryRaw<Array<{ proof: unknown }>>(Prisma.sql`
      SELECT public.jg_contract_direct_archive_proof_v1(${durable.id}::pg_catalog.text) AS proof
    `);
    const proof = rows.length === 1 ? record(rows[0].proof) : null;
    if (!proof || proof.proofProtocolVersion !== 1 || proof.contractId !== owner.id || proof.projectId !== owner.projectId
      || proof.contractVersionId !== version.id || proof.archiveId !== durable.id || proof.handlerUserId !== durable.uploadedByUserId
      || proof.idempotencyKey !== key || proof.requestSha256 !== durable.requestSha256 || proof.authoritySha256 !== durable.authoritySha256
      || typeof proof.sourceRevision !== "number" || !Number.isSafeInteger(proof.sourceRevision)
      || proof.sourceRevision < 1 || proof.sourceRevision !== durable.sourceRevision
      || typeof proof.inputSha256 !== "string" || !sha256.test(proof.inputSha256)
      || !Array.isArray(proof.fileIds) || proof.fileIds.length < 1 || proof.fileIds.length > 20
      || proof.fileIds.some(id => typeof id !== "string" || !uuid4.test(id)) || new Set(proof.fileIds).size !== proof.fileIds.length) unavailable();
    const intent: RegisterDirectSignedContractV2Dto = { archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: key,
      expectedDraftRevision: proof.sourceRevision, expectedInputSha256: proof.inputSha256, fileIds: proof.fileIds,
      confirmedMatchingSignedDocument: true };
    const requestSha256 = directArchiveRequestSha(owner.id, version.id, durable.uploadedByUserId, intent);
    const result = { archiveId: durable.id, contractVersionId: version.id, status: "effective" as const, fileIds: intent.fileIds };
    if (requestSha256 !== durable.requestSha256 || !isDeepStrictEqual(proof.result, result) || !isDeepStrictEqual(durable.responseSnapshot, result)) unavailable();
    const originals = await readDirectArchiveGenerations(tx, durable);
    if (!isDeepStrictEqual(originals.map(original => original?.fileId), intent.fileIds)) unavailable();
    await assertDirectPendingSourceContinuity(tx, qualification);
    if (!isDeepStrictEqual(await readProofRoutines(tx, qualification.bootstrap), routines)) unavailable();
    return { status: "archived" as const, result, requestSha256, intent };
  } catch {
    unavailable();
  }
}
