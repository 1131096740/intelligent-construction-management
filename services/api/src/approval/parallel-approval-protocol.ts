export function hasVersionedApprovalNodes(nodes: unknown): boolean {
  return Array.isArray(nodes) && nodes.some(node => node && typeof node === "object" &&
    ("protocolVersion" in node || "executionMode" in node));
}

/** Versioned opt-in: unmarked frozen arrays retain their serial contract. */
export function isParallelApprovalRound(nodes: unknown): nodes is Array<Record<string, unknown>> {
  return Array.isArray(nodes) && nodes.length > 0 && nodes.every(node =>
    node && typeof node === "object" && !Array.isArray(node) &&
    node.protocolVersion === 1 && node.executionMode === "parallel" &&
    Array.isArray(node.roleKeys) && node.roleKeys.length > 0 &&
    node.roleKeys.every((role: unknown) => typeof role === "string") &&
    ["any", "all"].includes(node.mode));
}

export function isApprovalDutyComplete(node: Record<string, unknown>): boolean {
  const roles = node.roleKeys as string[];
  const approved = Array.isArray(node.approvedRoleKeys) ? node.approvedRoleKeys : [];
  return node.mode === "all" ? roles.every(role => approved.includes(role)) : roles.some(role => approved.includes(role));
}

export function activeApprovalNodeIndexes(nodes: unknown, currentNodeIndex: number): number[] {
  return isParallelApprovalRound(nodes)
    ? nodes.flatMap((node, index) => isApprovalDutyComplete(node) ? [] : [index])
    : hasVersionedApprovalNodes(nodes) ? [] : [currentNodeIndex];
}

export const SPOT_PARALLEL_NOTIFICATION_KIND = "spot_parallel_duty_notification_v1";
export function isParallelDutyNotificationEvent(log: { action: string; metadata?: unknown }): boolean {
  const value = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata) ? log.metadata as Record<string, unknown> : {};
  return log.action === "system_notification" && value.kind === SPOT_PARALLEL_NOTIFICATION_KIND &&
    ["queued", "dispatch_claimed", "accepted", "failed", "unknown", "cancelled"].includes(String(value.event)) &&
    typeof value.recipientId === "string" && value.recipientId.trim().length > 0 &&
    Number.isInteger(value.nodeIndex) && Number(value.nodeIndex) >= 0;
}
