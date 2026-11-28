import { ServiceUnavailableException } from "@nestjs/common";
import type { Contract, ContractArchiveFile, ContractVersion, Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { readGeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";
import { assertContractV2ArchivePersistentProof } from "./contract-v2-archive-persistent-proof";

export const GENERATED_UPWARD_OPERATING_ACTIVATION = Symbol("GENERATED_UPWARD_OPERATING_ACTIVATION");

export type UpwardActivationBinding = Readonly<{
  mode: "internal_reference_only";
  projectId: string;
  contractVersionId: string;
  archiveId: string;
  requestSha256: string;
  authoritySha256: string;
  sourceBasisSha256: string;
  approvalInstanceId: string;
  sealTaskId: string;
  archivedAt: string;
  operatingLedgerEffectiveDateSnapshot: string;
}>;

/** Independently qualify the native policy and reconstruct the stored binding in the supplied transaction. */
export interface GeneratedUpwardOperatingActivation {
  readBeforeActivation(tx: Prisma.TransactionClient, binding: UpwardActivationBinding):
    Promise<{ transaction: Prisma.TransactionClient; binding: UpwardActivationBinding } | null>;
}

export function generatedOperatingUnavailable() {
  return new ServiceUnavailableException("生成合同经营依据尚未核对，请保留原件和本次标识");
}

export async function requireGeneratedUpwardActivation(tx: Prisma.TransactionClient, contract: Contract, version: ContractVersion,
  archive: ContractArchiveFile, ledgerDay: string, authority: GeneratedUpwardOperatingActivation | undefined) {
  if (version.signingSubjectType !== "upward" || !authority || !archive.confirmedAt || !archive.approvalInstanceId || !archive.sealTaskId) {
    throw generatedOperatingUnavailable();
  }
  const snapshot = archive.authoritySnapshot;
  const raw = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
  const consequence = raw.operatingConsequence;
  const sha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  if (!sha(archive.requestSha256) || !sha(archive.authoritySha256) || !sha(raw.sourceBasisSha256) || !isDeepStrictEqual(consequence, {
    protocolVersion: 1, mode: "internal_reference_only", operatingLedgerEffectiveDateSnapshot: ledgerDay, expectedSource: null
  })) throw generatedOperatingUnavailable();

  const binding: UpwardActivationBinding = Object.freeze({
    mode: "internal_reference_only", projectId: contract.projectId, contractVersionId: version.id, archiveId: archive.id,
    requestSha256: archive.requestSha256, authoritySha256: archive.authoritySha256, sourceBasisSha256: raw.sourceBasisSha256,
    approvalInstanceId: archive.approvalInstanceId, sealTaskId: archive.sealTaskId,
    archivedAt: archive.confirmedAt.toISOString(), operatingLedgerEffectiveDateSnapshot: ledgerDay
  });
  const witness = await authority.readBeforeActivation(tx, binding).catch(() => null);
  if (!witness || witness.transaction !== tx || !isDeepStrictEqual(witness.binding, binding)) throw generatedOperatingUnavailable();
  return binding;
}

export async function assertGeneratedUpwardHasNoOperatingFact(tx: Prisma.TransactionClient, contractVersionId: string) {
  const source = { sourceType: "contract_version", sourceBusinessId: contractVersionId };
  if (await tx.operatingFact.count({ where: source }) || await tx.operatingImpactEntry.count({ where: source })) {
    throw generatedOperatingUnavailable();
  }
}

/** Callers must independently authorize access. The installed archive proof precedes any projection or replay exclusion. */
export async function readQualifiedGeneratedUpwardReference(tx: Prisma.TransactionClient, contract: Contract, version: ContractVersion,
  archive: ContractArchiveFile) {
  if (version.numericProtocolVersion !== 2 || version.signingSubjectType !== "upward"
    || archive.archiveProtocolVersion !== 2 || archive.archiveSource !== "generated_approval") throw generatedOperatingUnavailable();
  await assertContractV2ArchivePersistentProof(tx, contract, version, archive);
  const policy = readGeneratedArchiveOperatingPolicy({ archive, contract, version });
  if (policy && policy.mode !== "upward_internal_reference") throw generatedOperatingUnavailable();
  await assertGeneratedUpwardHasNoOperatingFact(tx, version.id);
  return policy?.reference ?? null;
}
