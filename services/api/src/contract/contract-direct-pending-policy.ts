import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { hasDirectSigningInput } from "./contract-direct-pending-source";

export class DirectPendingSourceUnavailableError extends ConflictException {}

export function assertNotDirectPendingVersion(version: { draftData?: unknown } | null) {
  if (hasDirectSigningInput(version?.draftData)) throw new DirectPendingSourceUnavailableError("已签合同待登记资料须保留原件，当前入口暂不支持此办理方式");
}

/** The reserved source is not an approval, archive, copy or cleanup authority. */
export async function assertNotDirectPendingSource(tx: Prisma.TransactionClient, versionId: string) {
  const version = await tx.contractVersion.findUnique({ where: { id: versionId }, select: { draftData: true } });
  assertNotDirectPendingVersion(version);
}
