import { describe, expect, it } from "vitest";
import type { WorkItemsReadModel } from "../api/core-flow-read.api";
import { navigationWorkItemBadgeCounts } from "./navigation-work-item-badges";

function workItemsFixture(): WorkItemsReadModel {
  return {
    generatedAt: "2026-07-23T00:00:00.000Z",
    visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [], drafts: [] },
    queueMeta: {
      pending: { total: 101, returned: 30, truncated: true },
      blocked: { total: 0, returned: 0, truncated: false },
      started: { total: 0, returned: 0, truncated: false },
      drafts: { total: 0, returned: 0, truncated: false }
    },
    approvalCenter: {
      pendingApproval: [{ id: "approval-1" } as WorkItemsReadModel["queues"]["pending"][number]],
      startedByMe: [],
      handledByMe: [],
      delegatedToMe: [],
      overdueReminder: []
    }
  };
}

describe("navigation work-item badges", () => {
  it("uses authoritative queue totals and pending approval facts", () => {
    expect(navigationWorkItemBadgeCounts(workItemsFixture())).toEqual({
      "/首页": 101,
      "/审批中心": 1
    });
  });

  it("does not invent a badge when the work-item projection is unavailable", () => {
    expect(navigationWorkItemBadgeCounts(null)).toEqual({
      "/首页": 0,
      "/审批中心": 0
    });
  });
});
