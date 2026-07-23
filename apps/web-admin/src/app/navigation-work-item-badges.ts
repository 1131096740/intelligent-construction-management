import type { WorkItemsReadModel } from "../api/core-flow-read.api";

export function navigationWorkItemBadgeCounts(
  workItems: WorkItemsReadModel | null | undefined
) {
  const pendingCount = workItems?.queueMeta?.pending?.total ?? workItems?.queues.pending.length ?? 0;
  const approvalCount = workItems?.approvalCenter.pendingApproval.length ?? 0;

  return {
    "/首页": normalizeCount(pendingCount),
    "/审批中心": normalizeCount(approvalCount)
  };
}

function normalizeCount(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
