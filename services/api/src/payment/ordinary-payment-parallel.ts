import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { approvalEvidenceMetadata, finalApprovalEvidence, type ApprovalEvidenceAction } from "../approval/approval-evidence";
import { Prisma } from "@prisma/client";
import { resolveApprovalReviewIdentity, type ApprovalActorRoleScopes, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { activeApprovalNodeIndexes, isApprovalDutyComplete, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { REGISTERED_PAYMENT_EXECUTION_NOTICE_KIND } from "./registered-payment-notification.service";

export const PAYMENT_DUTY_NOTICE_KIND = "payment_approval_duty_notification";
export const PAYMENT_DUTY_NOTICE_OUTCOMES = new Set(["dispatch_claimed", "accepted", "failed", "unknown", "cancelled"]);

export function hasOrdinaryPaymentParallelMarker(nodes: unknown): boolean {
  return Array.isArray(nodes) && nodes.some(node =>
    node && typeof node === "object" && "ordinaryPaymentParallel" in node);
}

export function isOrdinaryPaymentParallelRound(nodes: unknown): nodes is Array<Record<string, unknown>> {
  return isParallelApprovalRound(nodes) && nodes.every(node => node.ordinaryPaymentParallel === true);
}

export function ordinaryPaymentParallelNodes<T extends Record<string, unknown>>(nodes: readonly T[]) {
  return nodes.map(node => ({ ...node, ordinaryPaymentParallel: true, protocolVersion: 1, executionMode: "parallel" }));
}

function ordinaryPaymentDelegation(value: unknown) {
  const row = approvalEvidenceMetadata(value);
  if (row.kind !== "delegate" || row.ordinaryPaymentDelegation !== true ||
      typeof row.fromUserId !== "string" || !row.fromUserId ||
      typeof row.toUserId !== "string" || !row.toUserId || row.fromUserId === row.toUserId ||
      typeof row.fromRoleKey !== "string" || typeof row.delegationActionId !== "string" || !row.delegationActionId ||
      typeof row.startsAt !== "string" || typeof row.endsAt !== "string") return null;
  const startsAt = Date.parse(row.startsAt);
  const endsAt = Date.parse(row.endsAt);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt < endsAt
    ? { startsAt, endsAt, fromUserId: row.fromUserId, fromRoleKey: row.fromRoleKey,
      toUserId: row.toUserId, delegationActionId: row.delegationActionId, ordinaryPaymentDutyIndex: row.ordinaryPaymentDutyIndex } : null;
}

export function isOrdinaryPaymentAssignmentActive(value: unknown, nodeIndex: number, now = Date.now()) {
  if (approvalEvidenceMetadata(value).kind === "transfer") return true;
  const delegation = ordinaryPaymentDelegation(value);
  return Boolean(delegation && delegation.ordinaryPaymentDutyIndex === nodeIndex && delegation.startsAt <= now && now < delegation.endsAt);
}

export function isLiveOrdinaryPaymentDelegation(
  node: FrozenApprovalNode, assignment: unknown, index: number,
  principalRoles: ReadonlyMap<string, ApprovalActorRoleScopes | undefined>
) {
  const scoped = ordinaryPaymentDelegation(assignment);
  if (!scoped || !isOrdinaryPaymentAssignmentActive(assignment, index)) return false;
  const roleScopes = principalRoles.get(scoped.fromUserId);
  const role = scoped.fromRoleKey as RoleKey;
  if (!roleScopes || !Array.isArray(node.roleKeys) || !node.roleKeys.includes(role) || !canPerform("payment.approve", [role])) return false;
  return resolveApprovalReviewIdentity({
    node: { ...node, roleKeys: [role], assignments: [] },
    actorUserId: scoped.fromUserId,
    actorRoleKeys: resolveEffectiveRoleKeys([...roleScopes.globalRoleKeys], [...roleScopes.projectRoleKeys]),
    actorRoleScopes: roleScopes
  })?.approvedRoleKey === role;
}

export async function loadOrdinaryPaymentDelegationPrincipals(
  tx: Prisma.TransactionClient, nodes: unknown, actorUserId: string, projectId: string,
  loadRoleScopes: (userId: string) => Promise<ApprovalActorRoleScopes>,
  options: { dutyIndex?: number; lock?: true } = {}
) {
  const principalIds = new Set<string>();
  if (isOrdinaryPaymentParallelRound(nodes)) {
    for (const [index, node] of nodes.entries()) {
      if ((options.dutyIndex !== undefined && options.dutyIndex !== index) ||
          isApprovalDutyComplete(node) || !Array.isArray(node.assignments)) continue;
      for (const assignment of node.assignments) {
        const scoped = ordinaryPaymentDelegation(assignment);
        if (scoped?.toUserId === actorUserId && isOrdinaryPaymentAssignmentActive(assignment, index)) {
          principalIds.add(scoped.fromUserId);
        }
      }
    }
  }
  const ids = [...principalIds];
  if (!ids.length) return new Map<string, ApprovalActorRoleScopes>();
  if (options.lock) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT u.id FROM "UserPosition" u JOIN "Position" p ON p.id = u."positionId"
      WHERE u."userId" IN (${Prisma.join(ids)}) AND (u."projectId" IS NULL OR u."projectId" = ${projectId})
      ORDER BY u.id FOR SHARE OF u, p`;
    await tx.$queryRaw`SELECT id FROM "ProjectMember" WHERE "userId" IN (${Prisma.join(ids)}) AND "projectId" = ${projectId}
      ORDER BY id FOR SHARE`;
  }
  const active = await tx.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  return new Map(await Promise.all(active.map(async user => [user.id, await loadRoleScopes(user.id)] as const)));
}

export function resolveOrdinaryPaymentDuty(
  nodes: unknown, index: number,
  identity: Omit<Parameters<typeof resolveApprovalReviewIdentity>[0], "node"> & {
    delegationPrincipals?: ReadonlyMap<string, ApprovalActorRoleScopes | undefined>;
  },
  directOnly = false
) {
  if (!isOrdinaryPaymentParallelRound(nodes) || !activeApprovalNodeIndexes(nodes, index).includes(index)) return null;
  const node = nodes[index];
  const assignments = !directOnly && Array.isArray(node.assignments)
    ? node.assignments.filter(assignment => approvalEvidenceMetadata(assignment).kind === "transfer" ||
      (identity.delegationPrincipals && isLiveOrdinaryPaymentDelegation(node, assignment, index, identity.delegationPrincipals)))
    : [];
  const resolved = resolveApprovalReviewIdentity({
    ...identity, node: { ...node, assignments },
    ...(directOnly ? { activeDelegators: [] } : {})
  });
  if (!resolved || !canPerform("payment.approve", [resolved.approvedRoleKey])) return null;
  const source = resolved.viaAssignment ? assignments.find(value => {
    const assignment = approvalEvidenceMetadata(value);
    return assignment.toUserId === identity.actorUserId && assignment.fromUserId === resolved.representedUserId &&
      assignment.fromRoleKey === resolved.approvedRoleKey;
  }) : undefined;
  const ordinaryPaymentDelegationActionId = ordinaryPaymentDelegation(source)?.delegationActionId;
  return { ...resolved, ...(ordinaryPaymentDelegationActionId ? { ordinaryPaymentDelegationActionId } : {}) };
}

export function paymentParallelRoundEvidence<T extends ApprovalEvidenceAction>(
  status: string, nodes: unknown, logs: readonly T[], round?: { id: string; businessId: string }
): T[] {
  if (!isOrdinaryPaymentParallelRound(nodes)) {
    if (hasOrdinaryPaymentParallelMarker(nodes)) throw new BadRequestException("原付款审批职责切换记录无效");
    return finalApprovalEvidence(status, nodes, logs);
  }
  const badHistory = () => new BadRequestException("付款审批签批或通知证据与冻结职责不一致");
  const originalIds = new Map<string, number>();
  const isLegacy = nodes.some(node => typeof node.legacyPaymentNoticeRevision === "string");
  for (const [index, node] of nodes.entries()) {
    const original = node.legacyPaymentApprovalActionId;
    if (original === undefined) continue;
    if (!isLegacy || typeof original !== "string" || !original.trim() || originalIds.has(original)) throw badHistory();
    originalIds.set(original, index);
  }
  const notified = new Set(logs.filter(log => {
    const metadata = approvalEvidenceMetadata(log.metadata);
    return log.action === "system_notification" && metadata.kind === PAYMENT_DUTY_NOTICE_KIND &&
      metadata.event === "queued" && typeof metadata.nodeIndex === "number" &&
      Number.isInteger(metadata.nodeIndex) && nodes[metadata.nodeIndex] && typeof metadata.recipientId === "string";
  }).map(log => log.id));

  const delegations = new Map(logs.filter(log => log.action === "delegate").map(log => [log.id, log]));
  const effective: T[] = [];
  const executionNotices: T[] = [];
  const seenOriginal = new Set<string>();
  for (const log of logs) {
    const metadata = approvalEvidenceMetadata(log.metadata);
    if (metadata.ordinaryPaymentDelegationActionId !== undefined) {
      const id = metadata.ordinaryPaymentDelegationActionId;
      const source = typeof id === "string" ? delegations.get(id) : undefined;
      const scoped = ordinaryPaymentDelegation(source?.metadata);
      if (!scoped || scoped.delegationActionId !== id || !["approve", "return_to_applicant"].includes(log.action) ||
          scoped.ordinaryPaymentDutyIndex !== metadata.ordinaryPaymentDutyIndex || scoped.fromRoleKey !== log.approvedRoleKey ||
          scoped.toUserId !== log.actorUserId || scoped.fromUserId !== log.representedUserId) throw badHistory();
    }
    if (log.action !== "approve" && (log.signatureFileIdSnapshot || log.signatureSha256Snapshot ||
        log.signatureVersionIdSnapshot)) throw badHistory();
    if (log.action === "system_notification") {
      if (metadata.kind === REGISTERED_PAYMENT_EXECUTION_NOTICE_KIND) {
        executionNotices.push(log);
        continue;
      }
      if (metadata.kind !== PAYMENT_DUTY_NOTICE_KIND || (!notified.has(log.id) && (typeof metadata.event !== "string" ||
            !PAYMENT_DUTY_NOTICE_OUTCOMES.has(metadata.event) || typeof metadata.intentId !== "string" ||
            !notified.has(metadata.intentId)))) throw badHistory();
    } else if (log.action === "approve") {
      const originalIndex = originalIds.get(log.id);
      const duty = originalIndex ?? metadata.ordinaryPaymentDutyIndex;
      if (duty === undefined && isLegacy) continue; // Superseded serial signatures stay in the immutable log.
      if (typeof duty !== "number" || !Number.isInteger(duty) ||
          !(nodes[duty]?.roleKeys as string[] | undefined)?.includes(log.approvedRoleKey ?? "")) throw badHistory();
      if (originalIndex !== undefined) seenOriginal.add(log.id);
      effective.push(log);
    } else if (log.action === "delegate" && metadata.ordinaryPaymentDelegation === true) {
      const assignment = ordinaryPaymentDelegation(metadata);
      const index = metadata.ordinaryPaymentDutyIndex;
      if (!assignment || assignment.delegationActionId !== log.id || typeof index !== "number" || !Number.isInteger(index) ||
          !(nodes[index]?.roleKeys as string[] | undefined)?.includes(log.approvedRoleKey ?? "") ||
          assignment.fromRoleKey !== log.approvedRoleKey || assignment.fromUserId !== log.actorUserId ||
          assignment.fromUserId !== log.representedUserId) throw badHistory();
    } else if (["reject", "return_to_applicant", "withdraw"].includes(log.action)) {
      effective.push(log); // The shared verifier refuses signed forms for ended rounds.
    } else if (log.action !== "remind" && (!isLegacy || !["reject_previous", "transfer", "delegate"].includes(log.action))) {
      throw badHistory();
    }
  }
  if (originalIds.size !== seenOriginal.size) throw badHistory();
  const signatures = finalApprovalEvidence(status, nodes, effective);
  if (executionNotices.length && (status !== "approved" || !round ||
      !matchesApprovedPaymentExecutionNotices(executionNotices, signatures, round))) throw badHistory();
  return signatures;
}

function matchesApprovedPaymentExecutionNotices(
  notices: readonly ApprovalEvidenceAction[], signatures: readonly ApprovalEvidenceAction[],
  round: { id: string; businessId: string }
): boolean {
  const kind = REGISTERED_PAYMENT_EXECUTION_NOTICE_KIND;
  const hash = (...values: string[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
  const receiptKey = (...values: string[]) => hash(kind, ...values);
  const anchorId = receiptKey(round.businessId, round.id, "approved_anchor");
  const records = notices.map(log => ({ log, metadata: approvalEvidenceMetadata(log.metadata) }));
  const anchor = records.find(({ log }) => log.id === anchorId);
  const approval = signatures.find(log => log.id === anchor?.metadata.finalActionId);
  const evidence = approval as (ApprovalEvidenceAction & { createdAt?: Date; approvalInstanceId?: string }) | undefined;
  if (!anchor || !approval || anchor.metadata.event !== "approved_anchor" || anchor.metadata.origin !== "approval_transaction" ||
      evidence?.approvalInstanceId !== round.id || !(evidence.createdAt instanceof Date) ||
      anchor.metadata.finalActionFingerprint !== hash(approval.id, round.id, approval.actorUserId ?? "",
        approval.approvedRoleKey ?? "", approval.representedUserId ?? "", approval.signatureFileIdSnapshot ?? "",
        approval.signatureVersionIdSnapshot ?? "", approval.signatureSha256Snapshot ?? "", evidence.createdAt.toISOString())) return false;
  const queued = new Set(records.filter(({ metadata }) => metadata.event === "queued").map(({ log }) => log.id));
  return records.every(({ log, metadata }) => {
    if (metadata.paymentId !== round.businessId || metadata.roundId !== round.id || log.actorUserId !== approval.actorUserId ||
        log.signatureFileIdSnapshot || log.signatureSha256Snapshot || log.signatureVersionIdSnapshot) return false;
    if (log.id === anchorId) return true;
    if (metadata.duty !== "payment_execution" || typeof metadata.recipientId !== "string") return false;
    if (metadata.event === "queued") {
      if (metadata.anchorId !== anchorId) return false;
      return metadata.origin === "approval_transaction"
        ? log.id === receiptKey(round.businessId, round.id, "payment_execution", metadata.recipientId)
        : metadata.origin === "manual_retry" && typeof metadata.retryOf === "string" && queued.has(metadata.retryOf) &&
          log.id === receiptKey(metadata.retryOf, "retry");
    }
    return typeof metadata.intentId === "string" && queued.has(metadata.intentId) && (
      metadata.event === "dispatch_started" && log.id === receiptKey(metadata.intentId, "dispatch_claim") ||
      metadata.event === "dispatch_result" && log.id === receiptKey(metadata.intentId, "dispatch_result")
    );
  });
}
