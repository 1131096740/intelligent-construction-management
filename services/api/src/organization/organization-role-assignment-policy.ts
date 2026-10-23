import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Called only inside the caller's Serializable personnel transaction. */
export async function assertEngineeringDirectorAvailable(tx: Prisma.TransactionClient, targetUserId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('organization:engineering_department_director'))`;
  const position = await tx.position.findUnique({ where: { key: "engineering_department_director" }, select: { id: true } });
  if (!position) throw new ConflictException("公司工程技术部主管岗位配置不存在，请联系管理员核对");
  const assignments = await tx.userPosition.findMany({
    where: { positionId: position.id, projectId: null, ...(targetUserId ? { userId: { not: targetUserId } } : {}) },
    select: { userId: true }
  });
  if (assignments.length && await tx.user.findFirst({
    where: { id: { in: assignments.map(row => row.userId) }, isActive: true }, select: { id: true }
  })) {
    throw new ConflictException("已有启用的公司工程技术部主管，请先完成原岗位交接");
  }
}
