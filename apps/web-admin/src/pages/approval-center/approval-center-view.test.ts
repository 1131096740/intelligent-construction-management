import { describe, expect, it } from "vitest";
import type { WorkItemReadModel } from "../../api/core-flow-read.api";
import {
  approvalCenterTabs,
  readApprovalCenterQuery,
  approvalItemInstanceId,
  approvalItemSummary,
  filterApprovalItems,
  parallelCompletionText,
  emptyApprovalCenterFilters
} from "./approval-center-view";

function item(overrides: Partial<WorkItemReadModel> = {}): WorkItemReadModel {
  return {
    id: "approval:instance-1",
    type: "approval",
    title: "付款审批：钢材采购合同",
    projectName: "一号项目",
    businessCode: "FK-001",
    amountText: "¥1,200.00",
    currentNode: "财务主管",
    stayedText: "已停留 2 小时",
    nextAction: "处理当前审批",
    targetPath: "/付款管理/FK-001",
    tone: "warning",
    applicantName: "张三",
    businessStatus: "in_progress",
    overdue: false,
    canHandle: true,
    parallelCompletion: { completed: 2, total: 5 },
    ...overrides
  };
}

describe("审批中心四视图与筛选", () => {
  it("固定四个视图，委托并入待审批且逾期不是独立视图", () => {
    expect(approvalCenterTabs.map(tab => tab.key)).toEqual(["pendingApproval", "startedByMe", "participated", "viewable"]);
    expect(approvalCenterTabs.some(tab => tab.key === ("delegatedToMe" as never))).toBe(false);
    expect(approvalCenterTabs.some(tab => tab.key === ("overdueReminder" as never))).toBe(false);
  });

  it("按项目、发起人、状态、关键词和逾期筛选，逾期不是视图切换", () => {
    const items = [
      item(),
      item({ id: "approval:instance-2", title: "结算审批：劳务分包", businessCode: "JS-002",
        applicantName: "李四", businessStatus: "approval_pending", overdue: true, projectName: "二号项目" })
    ];
    expect(filterApprovalItems(items, emptyApprovalCenterFilters)).toHaveLength(2);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, projectName: "二号项目" }).map(i => i.id)).toEqual(["approval:instance-2"]);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, applicantName: "张三" }).map(i => i.id)).toEqual(["approval:instance-1"]);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, status: "approval_pending" }).map(i => i.id)).toEqual(["approval:instance-2"]);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, keyword: "劳务" }).map(i => i.id)).toEqual(["approval:instance-2"]);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, keyword: "审批中" })).toHaveLength(2);
    expect(filterApprovalItems(items, { ...emptyApprovalCenterFilters, overdueOnly: true }).map(i => i.id)).toEqual(["approval:instance-2"]);
  });

  it("摘要显示主要事项、对象/金额和并联完成数，并能定位实例", () => {
    const summary = approvalItemSummary(item());
    expect(summary).toEqual({ title: "付款审批：钢材采购合同", object: "一号项目 · FK-001", amount: "¥1,200.00", current: "财务主管" });
    expect(parallelCompletionText(item())).toBe("并联完成 2/5");
    expect(parallelCompletionText(item({ parallelCompletion: undefined }))).toBe("");
    expect(approvalItemInstanceId(item())).toBe("instance-1");
    expect(approvalItemInstanceId(item({ id: "handled-approval:log-1" }))).toBeNull();
  });

  it("从 query 恢复视图与筛选，未知视图回落到待我审批", () => {
    expect(readApprovalCenterQuery({ view: "startedByMe", keyword: "钢材", project: "一号项目", status: "in_progress", applicant: "张三", overdue: "1" }))
      .toEqual({
        view: "startedByMe",
        filters: {
          keyword: "钢材",
          projectName: "一号项目",
          applicantName: "张三",
          status: "in_progress",
          overdueOnly: true
        }
      });
    expect(readApprovalCenterQuery({ view: "unknown" }).view).toBe("pendingApproval");
    expect(readApprovalCenterQuery({}).filters).toEqual(emptyApprovalCenterFilters);
  });
});
