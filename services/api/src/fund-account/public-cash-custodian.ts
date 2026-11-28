import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export async function currentPublicCashCustodian(tx: Prisma.TransactionClient, accountId: string) {
  const custody = await tx.publicCashCustody.findUnique({ where: { accountId }, select: { currentCustodianId: true } });
  return custody?.currentCustodianId ?? null;
}

export async function assertPublicCashCustodian(tx: Prisma.TransactionClient, accountId: string, actorId: string) {
  const custodian = await currentPublicCashCustodian(tx, accountId);
  if (custodian && custodian !== actorId) throw new ForbiddenException("当前公共现金操作由具名保管人办理");
}
