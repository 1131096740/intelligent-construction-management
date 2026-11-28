import type { WorkItemReadModel } from "../../api/core-flow-read.api";

export type ApprovalCenterTabKey = "pendingApproval" | "startedByMe" | "participated" | "viewable";

export interface ApprovalCenterTab {
  key: ApprovalCenterTabKey;
  label: string;
  emptyText: string;
}

/** 四视图：委托并入待审批，逾期只作为筛选条件；我参与的/我可查看由审批进度接口提供。 */
export const approvalCenterTabs: ApprovalCenterTab[] = [
  { key: "pendingApproval", label: "待我审批", emptyText: "当前没有需要你处理的审批。" },
  { key: "startedByMe", label: "我发起的", emptyText: "当前没有由你发起且仍在办理中的审批。" },
  { key: "participated", label: "我参与的", emptyText: "暂无与你相关的审批流程。" },
  { key: "viewable", label: "我可查看", emptyText: "当前没有你有查看权但未参与的审批流程。" }
];

export interface ApprovalCenterFilters {
  keyword: string;
  projectName: string;
  applicantName: string;
  status: string;
  overdueOnly: boolean;
}

export const emptyApprovalCenterFilters: ApprovalCenterFilters = {
  keyword: "", projectName: "", applicantName: "", status: "", overdueOnly: false
};

function queryValue(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

/** 分组深链（G8）把视图与筛选带进审批中心；未知视图回落到待我审批。 */
export function readApprovalCenterQuery(query: Record<string, unknown>): {
  view: ApprovalCenterTabKey;
  filters: ApprovalCenterFilters;
} {
  const view = queryValue(query.view);
  return {
    view: approvalCenterTabs.some(tab => tab.key === view)
      ? (view as ApprovalCenterTabKey)
      : "pendingApproval",
    filters: {
      keyword: queryValue(query.keyword),
      projectName: queryValue(query.project),
      applicantName: queryValue(query.applicant),
      status: queryValue(query.status),
      overdueOnly: queryValue(query.overdue) === "1"
    }
  };
}

export const approvalStatusLabels: Record<string, string> = {
  in_progress: "审批中",
  approval_pending: "审批中",
  approved: "已通过",
  rejected: "已驳回",
  returned: "已退回",
  withdrawn: "已撤回"
};

export function approvalStatusLabel(status?: string): string {
  return status ? approvalStatusLabels[status] ?? "流程中" : "流程中";
}

export function filterApprovalItems(items: WorkItemReadModel[], filters: ApprovalCenterFilters): WorkItemReadModel[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return items.filter(item => {
    if (filters.overdueOnly && item.overdue !== true) return false;
    if (filters.projectName && item.projectName !== filters.projectName) return false;
    if (filters.applicantName && item.applicantName !== filters.applicantName) return false;
    if (filters.status && item.businessStatus !== filters.status) return false;
    if (!keyword) return true;
    return [item.title, item.businessCode, item.projectName, item.applicantName, item.amountText,
      approvalStatusLabel(item.businessStatus)].some(value => (value ?? "").toLowerCase().includes(keyword));
  });
}

export function approvalFilterOptions(items: WorkItemReadModel[]) {
  const unique = (values: Array<string | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  return {
    projects: unique(items.map(item => item.projectName)),
    applicants: unique(items.map(item => item.applicantName)),
    statuses: unique(items.map(item => item.businessStatus))
      .map(status => ({ label: approvalStatusLabel(status), value: status }))
  };
}

export function parallelCompletionText(item: WorkItemReadModel): string {
  return item.parallelCompletion ? `并联完成 ${item.parallelCompletion.completed}/${item.parallelCompletion.total}` : "";
}

/** 待审批卡片展示本次要处理的主要事项与对象、金额。 */
export function approvalItemSummary(item: WorkItemReadModel) {
  return {
    title: item.title,
    object: [item.projectName, item.businessCode].filter(Boolean).join(" · "),
    amount: item.amountText,
    current: item.currentNode
  };
}

export function approvalItemInstanceId(item: WorkItemReadModel): string | null {
  return item.id.startsWith("approval:") ? item.id.slice("approval:".length) : null;
}
