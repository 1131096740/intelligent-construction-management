import { describe, expect, it } from "vitest";
import {
  hasOpenWorkbenchItems,
  hasOpenWorkItems,
  hasWorkbenchPermissionData,
  hasWorkItemPermissionData,
  emptyHomeWorkItemFilters,
  filterAndSortHomeWorkItemRows,
  homeWorkItemSummaryItems,
  toHomeWorkItemRows,
  toWorkbenchCards,
  toWorkbenchQueues,
  toWorkItemQueues
} from "./home.config";
import type { WorkbenchSummaryReadModel, WorkItemsReadModel } from "../../api/core-flow-read.api";

describe("home workbench card helpers", () => {
  const summary: WorkbenchSummaryReadModel = {
    generatedAt: "2026-07-03T10:00:00.000Z",
    visibleProjectCount: 1,
    cards: [
      {
        id: "contract_takeover_todo",
        title: "待接管合同",
        count: 3,
        description: "历史合同草稿或待补充资料，需要补录后提交复核。",
        targetPath: "/历史合同接管",
        actionText: "去接管",
        tone: "primary"
      },
      {
        id: "approved_pending_payment",
        title: "已批待付款",
        count: 1,
        description: "付款审批已通过，等待出纳登记实付和凭证。",
        targetPath: "/付款管理",
        actionText: "去付款",
        tone: "warning"
      }
    ]
  };

  it("renders Chinese card titles and counts from backend summary", () => {
    const cards = toWorkbenchCards(summary);

    expect(cards.map((card) => [card.title, card.countText, card.toneClass])).toEqual([
      ["待接管合同", "3", "tone-primary"],
      ["已批待付款", "1", "tone-warning"]
    ]);
    expect(hasOpenWorkbenchItems(cards)).toBe(true);
  });

  it("keeps backend jump links intact", () => {
    expect(toWorkbenchCards(summary).map((card) => card.targetPath)).toEqual([
      "/历史合同接管",
      "/付款管理"
    ]);
  });

  it("treats all-zero cards as a no-open-item state", () => {
    const cards = toWorkbenchCards({
      ...summary,
      cards: summary.cards.map((card) => ({ ...card, count: 0 }))
    });

    expect(hasWorkbenchPermissionData({ ...summary, cards })).toBe(true);
    expect(hasOpenWorkbenchItems(cards)).toBe(false);
  });

  it("treats empty card data as no visible business permission", () => {
    const emptySummary = { ...summary, cards: [] };

    expect(toWorkbenchCards(emptySummary)).toEqual([]);
    expect(hasWorkbenchPermissionData(emptySummary)).toBe(false);
  });

  it("groups summary cards into pending, blocked and started queues", () => {
    const queues = toWorkbenchQueues({
      ...summary,
      cards: [
        ...summary.cards,
        {
          id: "payment_blocked",
          title: "付款阻塞风险",
          count: 2,
          description: "付款容量不足或资料缺失。",
          targetPath: "/付款管理",
          actionText: "查看风险",
          tone: "danger"
        }
      ]
    });

    expect(queues.map((queue) => queue.title)).toEqual([
      "待我处理",
      "阻塞事项",
      "我发起的进行中"
    ]);
    expect(queues[0].cards.map((card) => card.id)).toEqual([
      "contract_takeover_todo",
      "approved_pending_payment"
    ]);
    expect(queues[1].cards.map((card) => card.id)).toEqual(["payment_blocked"]);
    expect(queues[2].cards).toEqual([]);
  });

  it("maps real work items into the three workbench queues", () => {
    const workItems: WorkItemsReadModel = {
      generatedAt: "2026-07-07T10:00:00.000Z",
      visibleProjectCount: 1,
      queues: {
        pending: [
          {
            id: "approval:1",
            type: "approval",
            title: "付款审批：测试合同",
            projectName: "测试项目",
            businessCode: "FK-001",
            amountText: "¥1,000.00",
            currentNode: "董事长/总经理或签",
            stayedText: "已停留 2 小时",
            nextAction: "处理当前审批",
            targetPath: "/付款管理/FK-001",
            tone: "warning"
          }
        ],
        blocked: [],
        started: [],
        drafts: []
      },
      approvalCenter: {
        pendingApproval: [],
        startedByMe: [],
        handledByMe: [],
        delegatedToMe: [],
        overdueReminder: []
      }
    };

    const queues = toWorkItemQueues(workItems);

    expect(hasWorkItemPermissionData(workItems)).toBe(true);
    expect(hasOpenWorkItems(queues)).toBe(true);
    expect(queues[0].items[0]).toMatchObject({
      id: "approval:1",
      toneClass: "tone-warning",
      targetPath: "/付款管理/FK-001"
    });
  });

  it("builds compact summary items without changing the three queue meanings", () => {
    const queues = toWorkItemQueues(workItemsFixture());

    expect(homeWorkItemSummaryItems(queues, 2)).toEqual([
      { label: "待我处理", value: "2", tone: "primary" },
      { label: "阻塞事项", value: "1", tone: "danger" },
      { label: "我发起的进行中", value: "1", tone: "default" },
      { label: "我的草稿", value: "1", tone: "default" },
      { label: "可见项目", value: "2", tone: "default" }
    ]);
  });

  it("keeps saved drafts in an independent queue without counting them as pending", () => {
    const queues = toWorkItemQueues(workItemsFixture());
    const rows = toHomeWorkItemRows(queues);

    expect(queues.map((queue) => queue.title)).toEqual([
      "待我处理",
      "阻塞事项",
      "我发起的进行中",
      "我的草稿"
    ]);
    expect(queues[0].items.map((item) => item.id)).not.toContain("takeover:draft-1");
    expect(queues[3].items.map((item) => item.id)).toEqual(["takeover:draft-1"]);
    expect(rows.find((row) => row.id === "takeover:draft-1")).toMatchObject({
      queueId: "drafts",
      statusLabel: "草稿",
      statusTone: "default"
    });
    expect(homeWorkItemSummaryItems(queues, 2)[0]).toEqual({
      label: "待我处理",
      value: "2",
      tone: "primary"
    });
  });

  it("uses the server draft total when the returned draft queue is truncated", () => {
    const workItems = workItemsFixture();
    workItems.queueMeta = {
      pending: { total: 2, returned: 2, truncated: false },
      blocked: { total: 1, returned: 1, truncated: false },
      started: { total: 1, returned: 1, truncated: false },
      drafts: { total: 42, returned: 1, truncated: true }
    };

    const queues = toWorkItemQueues(workItems);

    expect(queues[3]).toMatchObject({ total: 42, truncated: true });
    expect(homeWorkItemSummaryItems(queues, 2)).toContainEqual({
      label: "我的草稿",
      value: "42",
      tone: "default"
    });
  });

  it("filters work items by project, business type, status and keyword", () => {
    const rows = toHomeWorkItemRows(toWorkItemQueues(workItemsFixture()));

    expect(
      filterAndSortHomeWorkItemRows(rows, {
        ...emptyHomeWorkItemFilters(),
        project: "项目甲",
        businessType: "付款审批",
        status: "超时",
        keyword: "FK-002"
      }).map((row) => row.id)
    ).toEqual(["approval:overdue"]);
  });

  it("supports blocker, overdue, amount-risk and staying-time sorting", () => {
    const rows = toHomeWorkItemRows(toWorkItemQueues(workItemsFixture()));

    expect(filterAndSortHomeWorkItemRows(rows, { ...emptyHomeWorkItemFilters(), sort: "blocker" })[0].id)
      .toBe("blocker:1");
    expect(filterAndSortHomeWorkItemRows(rows, { ...emptyHomeWorkItemFilters(), sort: "overdue" })[0].id)
      .toBe("approval:overdue");
    expect(filterAndSortHomeWorkItemRows(rows, { ...emptyHomeWorkItemFilters(), sort: "amount" })[0].id)
      .toBe("approval:overdue");
    expect(filterAndSortHomeWorkItemRows(rows, { ...emptyHomeWorkItemFilters(), sort: "stayed" })[0].id)
      .toBe("blocker:1");
  });
});

function workItemsFixture(): WorkItemsReadModel {
  const base = {
    type: "approval" as const,
    projectName: "项目甲",
    businessCode: "FK-001",
    businessType: "payment",
    amountText: "¥1,000.00",
    currentNode: "财务审批",
    stayedText: "已停留 2 小时",
    nextAction: "处理付款审批",
    targetPath: "/付款管理/FK-001",
    tone: "warning" as const
  };

  return {
    generatedAt: "2026-07-14T08:00:00.000Z",
    visibleProjectCount: 2,
    queues: {
      pending: [
        { ...base, id: "approval:1", title: "付款审批" },
        {
          ...base,
          id: "approval:overdue",
          title: "付款审批已超时",
          businessCode: "FK-002",
          amountText: "¥500,000.00",
          stayedText: "已停留 3 天",
          tone: "danger"
        }
      ],
      blocked: [
        {
          ...base,
          id: "blocker:1",
          type: "blocker",
          title: "付款资料阻塞",
          businessCode: "FK-003",
          amountText: "¥20,000.00",
          stayedText: "已停留 5 天",
          tone: "danger"
        }
      ],
      started: [
        {
          ...base,
          id: "started:1",
          title: "我发起的付款",
          businessCode: "FK-004",
          amountText: "¥5,000.00",
          stayedText: "已停留 1 小时",
          tone: "default"
        }
      ],
      drafts: [
        {
          ...base,
          id: "takeover:draft-1",
          type: "contract_takeover",
          title: "历史合同草稿",
          businessCode: "LS-001",
          currentNode: "草稿填写",
          nextAction: "继续补录后提交复核",
          tone: "default"
        }
      ]
    },
    approvalCenter: {
      pendingApproval: [],
      startedByMe: [],
      handledByMe: [],
      delegatedToMe: [],
      overdueReminder: []
    }
  };
}
