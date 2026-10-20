import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadProjectApprovalAssignments } from "../approval/project-approval-assignments";

export async function assertSettlementApplicant(
  tx: Prisma.TransactionClient,
  contract: { projectId: string; contractTypeKey: string | null },
  actorUserId: string
) {
  const engineering = ["labor_subcontract", "professional_subcontract"].includes(contract.contractTypeKey ?? "");
  const roles = engineering ? ["engineering_tech", "engineering_foreman", "engineering_director"] : ["contract_staff"];
  const projectAssignments = await loadProjectApprovalAssignments(tx, contract.projectId, roles, actorUserId);
  if (projectAssignments.some(row => row.userId === actorUserId && row.projectId === contract.projectId && row.userIsActive && roles.includes(row.roleKey))) return;
  if (!engineering) {
    const global = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT up."userId" FROM "UserPosition" up
      JOIN "Position" p ON p."id" = up."positionId"
      JOIN "User" u ON u."id" = up."userId"
      WHERE up."userId" = ${actorUserId} AND up."projectId" IS NULL
        AND p."key" = 'contract_staff' AND u."isActive" = TRUE
      FOR SHARE OF up, p, u
    `);
    if (global.length) return;
  }
  throw new ForbiddenException(engineering
    ? "劳务、专业分包结算须由同项目的施工员、工长或项目总工发起"
    : "材料、设备结算须由合同员发起");
}
