import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
export async function companyTransferRoles(tx: Prisma.TransactionClient, userId: string): Promise<string[]> { const rows = await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`SELECT p."key" FROM "UserPosition" up JOIN "Position" p ON p."id"=up."positionId" JOIN "User" u ON u."id"=up."userId" WHERE up."userId"=${userId} AND up."projectId" IS NULL AND u."isActive"=TRUE`); return rows.map(r => r.key); }
export async function requireCompanyFinance(tx: Prisma.TransactionClient, userId: string) { const roles = await companyTransferRoles(tx, userId); if (!roles.some(r => ["finance_staff", "finance_director"].includes(r))) throw new ForbiddenException("公司自有资金须由公司层级财务办理"); return roles; }

export const companyTransferFinanceRoles = ["finance_staff", "finance_director"];
export function hasCompanyTransferFinance(roles: readonly string[]) {
  return roles.some(role => companyTransferFinanceRoles.includes(role));
}

export async function companyTransferCashAccess(
  tx: Prisma.TransactionClient,
  visibility: import("../auth/project-visibility.service").ProjectVisibilityService,
  actor: string,
  projects: Array<string|null>,
  roles: readonly string[]
) {
  if (hasCompanyTransferFinance(roles)) return true;
  const ids = [...new Set(projects.filter((id):id is string=>!!id))];
  if (projects.some(id=>!id)) return false;
  const visible = await visibility.visibleProjectIdsInTransaction(tx,actor);
  if (ids.some(id=>!visible.includes(id))) return false;
  const byProject = await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,ids);
  return ids.every(id=>hasCompanyTransferFinance(byProject.get(id) ?? []));
}
