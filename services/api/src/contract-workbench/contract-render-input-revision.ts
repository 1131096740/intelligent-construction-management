import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const EDITABLE_CONTRACT_VERSION_STATUSES = ["draft"];

export async function bumpContractRenderInputRevision(
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
  const newRevision = expectedRevision + 1;
  await tx.contractGeneratedDocument.updateMany({
    where: {
      contractVersionId,
      status: "success",
      sourceRevision: { lt: newRevision }
    },
    data: { status: "stale" }
  });
  return newRevision;
}
