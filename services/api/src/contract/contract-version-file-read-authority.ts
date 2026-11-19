import type { Prisma } from "@prisma/client";

/** One existing contract read authority, resolved only after Nest initialized. */
export const CONTRACT_VERSION_FILE_READ_AUTHORITY = Symbol("contract-version-file-read-authority");
export interface ContractVersionFileReadAuthority {
  assertCanReadVersionFile(tx: Prisma.TransactionClient, versionId: string, actorUserId: string): Promise<void>;
}
