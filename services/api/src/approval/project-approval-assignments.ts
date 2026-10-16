import { Prisma } from "@prisma/client";

export interface ProjectApprovalAssignment {
  projectId: string;
  userId: string;
  roleKey: string;
  userIsActive: boolean;
}

/** Read both supported project assignment stores under the approval transaction. */
export function loadProjectApprovalAssignments(
  tx: Prisma.TransactionClient,
  projectId: string,
  roleKeys?: readonly string[],
  userId?: string
): Promise<ProjectApprovalAssignment[]> {
  return tx.$queryRaw<ProjectApprovalAssignment[]>(Prisma.sql`
    WITH members AS MATERIALIZED (
       SELECT pm."projectId", pm."userId", pm."positionKey" AS "roleKey", u."isActive" AS "userIsActive"
       FROM "ProjectMember" pm INNER JOIN "User" u ON u."id" = pm."userId"
       WHERE pm."projectId" = ${projectId} AND u."isActive" = TRUE
       ${roleKeys?.length ? Prisma.sql`AND pm."positionKey" IN (${Prisma.join([...roleKeys])})` : Prisma.empty}
       ${userId ? Prisma.sql`AND pm."userId" = ${userId}` : Prisma.empty}
       FOR SHARE OF pm, u
    ), positions AS MATERIALIZED (
       SELECT up."projectId", up."userId", p."key" AS "roleKey", u."isActive" AS "userIsActive"
       FROM "UserPosition" up
       INNER JOIN "Position" p ON p."id" = up."positionId"
       INNER JOIN "User" u ON u."id" = up."userId"
       WHERE up."projectId" = ${projectId} AND u."isActive" = TRUE
       ${roleKeys?.length ? Prisma.sql`AND p."key" IN (${Prisma.join([...roleKeys])})` : Prisma.empty}
       ${userId ? Prisma.sql`AND up."userId" = ${userId}` : Prisma.empty}
       FOR SHARE OF up, p, u
    )
    SELECT * FROM members UNION SELECT * FROM positions
  `);
}
