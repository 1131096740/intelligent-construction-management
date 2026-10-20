import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export interface ApprovalEvidenceAction {
  id: string;
  action: string;
  actorUserId?: string;
  approvedRoleKey?: string | null;
  representedUserId?: string | null;
  signatureFileIdSnapshot?: string | null;
  signatureSha256Snapshot?: string | null;
  signatureVersionIdSnapshot?: string | null;
  metadata?: unknown;
}

export function approvalEvidenceMetadata(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/** The final settlement file is bound to the same ordered, immutable submission and approval actions. */
export function settlementApprovalActionSetHash(actions: readonly (ApprovalEvidenceAction & { createdAt: Date })[]) {
  const canonical = actions.map(action => ({
    id: action.id, action: action.action, actorUserId: action.actorUserId,
    approvedRoleKey: action.approvedRoleKey, representedUserId: action.representedUserId,
    signatureFileIdSnapshot: action.signatureFileIdSnapshot,
    signatureSha256Snapshot: action.signatureSha256Snapshot,
    signatureVersionIdSnapshot: action.signatureVersionIdSnapshot,
    createdAt: action.createdAt.toISOString(), metadata: action.metadata
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Replay the frozen instance, retaining actions rather than deduplicating people or roles. */
export function finalApprovalEvidence<T extends ApprovalEvidenceAction>(
  status: string,
  frozenNodes: unknown,
  logs: readonly T[]
): T[] {
  if (status !== "approved") throw new BadRequestException("仅最终审批通过的单据可以生成正式审批单");
  if (!Array.isArray(frozenNodes) || !frozenNodes.length) {
    throw new BadRequestException("审批节点证据缺失，不能生成正式审批单");
  }
  const nodes = frozenNodes as Array<{ mode: string; roleKeys: string[] }>;
  if (nodes.some(node => !node || !["any", "all"].includes(node.mode) || !Array.isArray(node.roleKeys) ||
    !node.roleKeys.length || node.roleKeys.some(role => typeof role !== "string" || !role.trim()))) {
    throw new BadRequestException("审批节点证据无效，不能生成正式审批单");
  }
  const approvals: T[][] = nodes.map(() => []);
  let index = 0;
  for (const log of logs) {
    if (["submit", "resubmit", "payer_changed_reapproval"].includes(log.action)) {
      approvals.forEach(group => group.splice(0));
      index = 0;
    } else if (log.action === "reject_previous") {
      index = Math.max(0, index - 1);
      approvals.slice(index).forEach(group => group.splice(0));
    } else if (["reject", "return_to_applicant", "withdraw", "terminate", "void", "abandon"].includes(log.action)) {
      approvals.forEach(group => group.splice(0));
      index = 0;
    } else if (log.action === "approve") {
      const node = nodes[index];
      if (!node || !Array.isArray(node.roleKeys) || !log.approvedRoleKey || !node.roleKeys.includes(log.approvedRoleKey) ||
          approvals[index].some(action => action.approvedRoleKey === log.approvedRoleKey)) {
        throw new BadRequestException("审批记录与冻结节点不一致，不能生成正式审批单");
      }
      approvals[index].push(log);
      if (node.mode === "any" || node.roleKeys.every(role => approvals[index].some(action => action.approvedRoleKey === role))) index++;
    }
  }
  if (index !== nodes.length) throw new BadRequestException("有效审批记录不完整，不能生成正式审批单");
  const effective = approvals.flat();
  for (const log of effective) {
    const metadata = approvalEvidenceMetadata(log.metadata);
    const name = metadata.approverName;
    if (log.representedUserId && log.representedUserId !== log.actorUserId &&
      (typeof metadata.representedName !== "string" || !metadata.representedName.trim())) {
      throw new BadRequestException("被代表审批人历史身份缺失，不能生成正式审批单");
    }
    if (!log.actorUserId || !log.signatureFileIdSnapshot || !log.signatureVersionIdSnapshot ||
        !/^[a-f0-9]{64}$/iu.test(log.signatureSha256Snapshot ?? "") || typeof name !== "string" || !name.trim()) {
      throw new BadRequestException("审批人或签名历史证据不完整，不能生成正式审批单；请核查原审批记录");
    }
  }
  return effective;
}
