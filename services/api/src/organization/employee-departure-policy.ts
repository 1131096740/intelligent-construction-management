import type { Prisma } from "@prisma/client";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { pendingRoleKeysForApprovalNode } from "../approval/approval-node-access";
import { frozenCandidateUserIds, type FrozenApprovalNode, type FrozenApprovalAssignment } from "../approval/approval-review-identity";

type ApprovalResponsibility = { applicantUserId: string; currentNodeIndex: number; frozenNodes: Prisma.JsonValue };
type DelegationResponsibility = { fromUserId: string; toUserId: string; endsAt: Date };

export function employeeDepartureBlockingReasons(userId: string, approvals: ApprovalResponsibility[], delegations: DelegationResponsibility[], now: Date) {
  const reasons: string[] = [];
  if (approvals.some((row) => row.applicantUserId === userId)) reasons.push("仍有审批中的本人申请，请先完成或在原业务办理交接");
  if (delegations.some((row) => (row.fromUserId === userId || row.toUserId === userId) && row.endsAt >= now)) reasons.push("仍有当前或未来有效审批委托，请先处理委托");
  for (const row of approvals) {
    if (!Array.isArray(row.frozenNodes) || !Number.isInteger(row.currentNodeIndex) || row.currentNodeIndex < 0 || row.currentNodeIndex >= row.frozenNodes.length) {
      reasons.push("存在无法安全核对的审批数据，请先在原业务核实"); break;
    }
    if (row.frozenNodes.slice(row.currentNodeIndex).some((node) => containsResponsibility(node, userId))) {
      reasons.push("仍有当前或未来冻结审批任务，请先完成或在原业务交接"); break;
    }
  }
  return reasons;
}

export async function evaluateEmployeeDeparture(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const [approvals, delegations] = await Promise.all([
    tx.approvalInstance.findMany({ where: { status: { in: ["in_progress", "approval_pending"] } },
      select: { applicantUserId: true, currentNodeIndex: true, frozenNodes: true } }),
    tx.approvalDelegation.findMany({ where: { enabled: true, endsAt: { gte: now }, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: { fromUserId: true, toUserId: true, endsAt: true } })
  ]);
  return employeeDepartureBlockingReasons(userId, approvals, delegations, now);
}

function containsResponsibility(node: unknown, userId: string) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return true;
  const frozen = node as FrozenApprovalNode;
  const pendingRoles: readonly string[] = pendingRoleKeysForApprovalNode(frozen);
  const roleKeys = Array.isArray(frozen.roleKeys) ? frozen.roleKeys.filter((role): role is string => typeof role === "string") : [];
  const preciseRoles = Array.isArray(frozen.roleKeys) && frozen.roleKeys.every((role) =>
    typeof role === "string" && ROLE_KEYS.includes(role as RoleKey)) &&
    (frozen.approvedRoleKeys === undefined || (Array.isArray(frozen.approvedRoleKeys) && frozen.approvedRoleKeys.every((role) => roleKeys.includes(role))));
  if (frozenCandidateUserIds(frozen).includes(userId)) {
    const byRole = frozen.candidateUserIdsByRole;
    const mappedRoles = preciseRoles && byRole && typeof byRole === "object" && !Array.isArray(byRole)
      ? roleKeys.filter((role) => Array.isArray((byRole as Record<string, unknown>)[role]) &&
        ((byRole as Record<string, unknown>)[role] as unknown[]).includes(userId)) : [];
    // A role mapping can prove that this person's signatures are complete.
    // Legacy unions or incomplete mappings cannot prove it and remain blocked.
    if (!mappedRoles.length || mappedRoles.some((role) => pendingRoles.includes(role))) return true;
  }
  const assignments = Array.isArray(frozen.assignments) ? frozen.assignments as FrozenApprovalAssignment[] : [];
  return assignments.some((assignment) => (assignment.toUserId === userId || assignment.fromUserId === userId) &&
    (!preciseRoles || typeof assignment.fromRoleKey !== "string" || !roleKeys.includes(assignment.fromRoleKey) || pendingRoles.includes(assignment.fromRoleKey)));
}
