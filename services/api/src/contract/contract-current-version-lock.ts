import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export async function lockContractAndAssertCurrentEffective(
  tx: Prisma.TransactionClient,
  contractVersionId: string,
  lockForMutation = false
) {
  const target = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
  if (!target) throw new BadRequestException("未找到可结算的合同版本，请刷新合同后重试");
  if (lockForMutation && typeof (tx as { $queryRaw?: unknown }).$queryRaw === "function") {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Contract" WHERE "id" = ${target.contractId} FOR UPDATE
    `);
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE
    `);
  }
  if (target.status !== "effective") {
    throw new BadRequestException("合同尚未归档生效，不能创建结算。请先完成合同归档确认。");
  }
  const findFirst = (tx.contractVersion as { findFirst?: typeof tx.contractVersion.findFirst }).findFirst;
  const [version, latestEffective] = await Promise.all([
    tx.contractVersion.findUnique({ where: { id: contractVersionId } }),
    findFirst
      ? findFirst.call(tx.contractVersion, {
          where: { contractId: target.contractId, status: "effective" },
          orderBy: { versionNo: "desc" }
        })
      : Promise.resolve(target)
  ]);
  if (!version || version.status !== "effective" || latestEffective?.id !== version.id) {
    throw new BadRequestException("所选合同版本已不是当前最新生效版本，请刷新后重试");
  }
  return version;
}
