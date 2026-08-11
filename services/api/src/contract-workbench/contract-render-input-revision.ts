import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const EDITABLE_CONTRACT_VERSION_STATUSES = ["draft"];

export async function bumpContractAggregateRevision(
  tx: Prisma.TransactionClient,
  contractVersionId: string,
  expectedRevision: number
) {
  const updated = await tx.contractVersion.updateMany({
    where: {
      id: contractVersionId,
      draftRevision: expectedRevision,
      status: { in: EDITABLE_CONTRACT_VERSION_STATUSES }
    },
    data: {
      draftRevision: { increment: 1 },
      readinessSnapshot: Prisma.DbNull
    }
  });
  if (updated.count !== 1) {
    throw new BadRequestException("合同草稿已变化，请刷新后重试");
  }
  return expectedRevision + 1;
}
