import type { RoleKey } from "@jiangkong/shared-domain";
import type { CompanyTransfer, Prisma } from "@prisma/client";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyTransferRoles } from "./company-transfer.access";

type RepaymentReference = Pick<CompanyTransfer, "kind" | "sourceProjectId" | "destinationProjectId" |
  "originalProxyId" | "originalFundMovementRelationshipId" | "originalInterEntityRelationshipId"> & { originalOperationalPaymentId?: string | null };

export function isProjectProxyRepayment(row: RepaymentReference, movementEntryKind?: string): boolean {
  return row.kind === "repayment" && !!row.sourceProjectId && row.sourceProjectId === row.destinationProjectId &&
    !!(row.originalProxyId || row.originalInterEntityRelationshipId || row.originalOperationalPaymentId ||
      (row.originalFundMovementRelationshipId && movementEntryKind === "proxy_payment"));
}

export function companyRepaymentDuties() {
  const duties: { name: string; roleKeys: RoleKey[] }[] = [
    { name: "综合部主管", roleKeys: ["comprehensive_director"] },
    { name: "项目经理", roleKeys: ["project_manager"] },
    { name: "财务主管", roleKeys: ["finance_director"] },
    { name: "董事长或总经理", roleKeys: ["chairman", "general_manager"] },
  ];
  return duties.map(duty => ({
    ...duty, protocolVersion: 1, executionMode: "parallel", mode: "any", approvedRoleKeys: [] as RoleKey[],
    roleScopesByRole: Object.fromEntries(duty.roleKeys.map(role => [role, role === "project_manager" ? "project" : "global"])),
  }));
}

export async function companyRepaymentApprovals(
  tx: Prisma.TransactionClient, visibility: ProjectVisibilityService, actorUserId: string,
  projectId: string, applicantUserId: string, nodes: Record<string, unknown>[], currentNodeIndex: number,
) {
  const globalRoleKeys = await companyTransferRoles(tx, actorUserId) as RoleKey[];
  const visible = await visibility.visibleProjectIdsInTransaction(tx, actorUserId);
  const projectRoleKeys = visible.includes(projectId) ?
    (await visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId])).get(projectId) ?? [] : [];
  const actorRoleKeys = [...globalRoleKeys, ...projectRoleKeys];
  return activeApprovalNodeIndexes(nodes, currentNodeIndex).flatMap(nodeIndex => {
    const node = nodes[nodeIndex];
    const identity = resolveApprovalReviewIdentity({
      node, actorUserId, actorRoleKeys, actorRoleScopes: { globalRoleKeys, projectRoleKeys },
    });
    return identity ? [{ nodeIndex, roleKeys: node.roleKeys as RoleKey[], requiresSelfPassword: actorUserId === applicantUserId, identity }] : [];
  });
}
