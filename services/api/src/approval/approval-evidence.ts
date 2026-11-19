import { hasVersionedApprovalNodes, isParallelApprovalRound, isApprovalDutyComplete, isParallelDutyNotificationEvent } from "./parallel-approval-protocol";
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
  if (hasVersionedApprovalNodes(frozenNodes) && !isParallelApprovalRound(frozenNodes)) throw new BadRequestException("审批职责协议版本无效，请联系管理员核对");
  if (isParallelApprovalRound(frozenNodes)) {
    if (!["approved", "approval_pending"].includes(status)) throw new BadRequestException("当前审批轮已结束，不能下载审批单");
    if (logs.some(log => (log.action === "system_notification" && !isParallelDutyNotificationEvent(log)) ||
      (log.action !== "approve" && Boolean(log.signatureFileIdSnapshot || log.signatureSha256Snapshot || log.signatureVersionIdSnapshot)))) {
      throw new BadRequestException("并联审批存在无法识别的签批或系统通知记录");
    }
    const approvals = logs.filter(log => log.action === "approve");
    if (logs.some(log => ["reject", "return_to_applicant", "withdraw"].includes(log.action))) throw new BadRequestException("当前审批轮已结束，不能下载审批单");
    const groups = frozenNodes.map(() => [] as T[]);
    for (const log of approvals) {
      const matches = frozenNodes.flatMap((node, index) => (node.roleKeys as string[]).includes(log.approvedRoleKey ?? "") ? [index] : []);
      if (matches.length !== 1 || groups[matches[0]].some(old => old.approvedRoleKey === log.approvedRoleKey)) throw new BadRequestException("并联审批职责记录缺失、重复或不唯一");
      groups[matches[0]].push(log);
    }
    const completedNodes: Array<Record<string, unknown>> = [];
    const ordered: T[] = [];
    for (const [index, node] of frozenNodes.entries()) {
      const recorded = groups[index].map(log => log.approvedRoleKey);
      const declared = Array.isArray(node.approvedRoleKeys) ? node.approvedRoleKeys : [];
      if (recorded.length !== declared.length || recorded.some(role => !declared.includes(role)) || (node.mode === "any" && recorded.length > 1)) throw new BadRequestException("并联职责签名与冻结版本不一致");
      if (status === "approved" && !isApprovalDutyComplete(node)) throw new BadRequestException("有效审批记录不完整，不能生成正式审批单");
      if (recorded.length) {
        // Serial verifier is reused only after a unique duty mapping; partial all-mode previews retain precisely the signed roles.
        const serialNode = {mode: node.mode, roleKeys: node.mode === "all" ? recorded : node.roleKeys};
        completedNodes.push(serialNode);
        ordered.push(...groups[index]);
      }
    }
    return completedNodes.length ? finalApprovalEvidence("approved", completedNodes, ordered) : [];
  }
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
