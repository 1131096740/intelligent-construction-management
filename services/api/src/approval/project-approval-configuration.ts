import { BadRequestException } from "@nestjs/common";
import { GLOBAL_BUSINESS_ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { loadProjectApprovalAssignments } from "./project-approval-assignments";

/** Validate the existing role-based route without changing its assignment rules. */
export async function assertProjectApprovalNodesConfigured(
  tx: Prisma.TransactionClient,
  projectId: string,
  nodes: readonly { name: string; roleKeys: readonly RoleKey[] }[],
  applicantUserId: string
): Promise<void> {
  const roleKeys = [...new Set(nodes.flatMap((node) => [...node.roleKeys]))];
  const globalRoles = roleKeys.filter((role) => GLOBAL_BUSINESS_ROLE_KEYS.includes(role));
  const [members, globals] = await Promise.all([
    loadProjectApprovalAssignments(tx, projectId, roleKeys),
    globalRoles.length ? tx.$queryRaw<Array<{ userId: string; roleKey: string }>>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey" FROM "UserPosition" up
      INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE up."projectId" IS NULL AND u."isActive" = TRUE
        AND p."key" IN (${Prisma.join(globalRoles)})
      FOR SHARE OF up, p, u
    `) : []
  ]);
  const assignments = [...members, ...globals];
  const now = new Date();
  const delegates = assignments.some((row) => row.userId === applicantUserId)
    ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT d."id" FROM "ApprovalDelegation" d
      INNER JOIN "User" recipient ON recipient."id" = d."toUserId"
      WHERE d."fromUserId" = ${applicantUserId} AND d."toUserId" <> ${applicantUserId}
        AND recipient."isActive" = TRUE AND d."enabled" = TRUE
        AND d."actionKey" IS NULL AND d."resourceType" IS NULL AND d."resourceId" IS NULL
        AND d."startsAt" <= ${now} AND d."endsAt" > ${now}
      FOR SHARE OF d, recipient
    `) : [];
  const configured = new Set(assignments
    .filter((row) => row.userId !== applicantUserId || row.roleKey === "chairman" || row.roleKey === "general_manager" || delegates.length > 0)
    .map((row) => row.roleKey));
  for (const node of nodes) {
    if (!node.roleKeys.some((role) => configured.has(role))) {
      throw new BadRequestException(`${node.name}缺少当前有效审批人，请先完成该项目的组织配置`);
    }
  }
}
