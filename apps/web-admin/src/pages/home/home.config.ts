import type {
  WorkItemReadModel,
  WorkItemsReadModel,
  WorkbenchSummaryCardReadModel,
  WorkbenchSummaryReadModel
} from "../../api/core-flow-read.api";

export interface WorkbenchCardViewModel extends WorkbenchSummaryCardReadModel {
  countText: string;
  toneClass: string;
}

export interface WorkbenchQueueViewModel {
  id: "pending" | "blocked" | "started";
  title: string;
  description: string;
  cards: WorkbenchCardViewModel[];
}

export interface WorkItemQueueViewModel {
  id: "pending" | "blocked" | "started" | "drafts";
  title: string;
  description: string;
  items: WorkItemViewModel[];
  total: number;
  truncated: boolean;
}

export interface WorkItemViewModel extends WorkItemReadModel {
  toneClass: string;
}

export type HomeWorkItemSort = "blocker" | "overdue" | "amount" | "stayed";

export interface HomeWorkItemFilters {
  project: string;
  businessType: string;
  status: string;
  keyword: string;
  sort: HomeWorkItemSort;
}

export interface HomeWorkItemRow extends WorkItemViewModel {
  queueId: WorkItemQueueViewModel["id"];
  queueTitle: string;
  businessTypeLabel: string;
  statusLabel: string;
  statusTone: "default" | "primary" | "warning" | "danger" | "success";
  stayMinutes: number;
  amountRiskValue: number;
  sourceIndex: number;
}

export interface HomeSummaryItem {
  label: string;
  value: string;
  tone: "default" | "primary" | "warning" | "danger" | "success";
}

export function toWorkbenchCards(
  summary: WorkbenchSummaryReadModel | null | undefined
): WorkbenchCardViewModel[] {
  return (summary?.cards ?? []).map((card) => ({
    ...card,
    countText: String(card.count),
    toneClass: `tone-${card.tone}`
  }));
}

export function toWorkbenchQueues(
  summary: WorkbenchSummaryReadModel | null | undefined
): WorkbenchQueueViewModel[] {
  const queues: WorkbenchQueueViewModel[] = [
    {
      id: "pending",
      title: "待我处理",
      description: "需要你当前岗位继续处理的接管、审批、归档和付款事项。",
      cards: []
    },
    {
      id: "blocked",
      title: "阻塞事项",
      description: "会影响付款、归档或试运行事实链的风险项。",
      cards: []
    },
    {
      id: "started",
      title: "我发起的进行中",
      description: "现有摘要接口暂未返回逐单发起记录，待后端工作项模型补齐。",
      cards: []
    }
  ];

  for (const card of toWorkbenchCards(summary)) {
    queues[queueIndexForCard(card)].cards.push(card);
  }

  return queues;
}

export function hasWorkbenchPermissionData(
  summary: WorkbenchSummaryReadModel | null | undefined
): boolean {
  return (summary?.cards.length ?? 0) > 0;
}

export function hasOpenWorkbenchItems(cards: readonly WorkbenchCardViewModel[]): boolean {
  return cards.some((card) => card.count > 0);
}

export function toWorkItemQueues(
  workItems: WorkItemsReadModel | null | undefined
): WorkItemQueueViewModel[] {
  return queueDefs.map((queue) => {
    const items = (workItems?.queues[queue.id] ?? []).map((item) => ({
      ...item,
      toneClass: `tone-${item.tone}`
    }));
    const meta = workItems?.queueMeta?.[queue.id];
    return {
      ...queue,
      items,
      total: meta?.total ?? items.length,
      truncated: meta?.truncated ?? false
    };
  });
}

export function hasWorkItemPermissionData(
  workItems: WorkItemsReadModel | null | undefined
): boolean {
  return (workItems?.visibleProjectCount ?? 0) > 0;
}

export function hasOpenWorkItems(queues: readonly WorkItemQueueViewModel[]): boolean {
  return queues.some((queue) => queue.total > 0);
}

export function emptyHomeWorkItemFilters(): HomeWorkItemFilters {
  return {
    project: "",
    businessType: "",
    status: "",
    keyword: "",
    sort: "blocker"
  };
}

export function homeWorkItemSummaryItems(
  queues: readonly WorkItemQueueViewModel[],
  visibleProjectCount: number
): HomeSummaryItem[] {
  const counts = new Map(queues.map((queue) => [queue.id, queue.total]));
  return [
    { label: "待我处理", value: String(counts.get("pending") ?? 0), tone: "primary" },
    { label: "阻塞事项", value: String(counts.get("blocked") ?? 0), tone: "danger" },
    { label: "我发起的进行中", value: String(counts.get("started") ?? 0), tone: "default" },
    { label: "我的草稿", value: String(counts.get("drafts") ?? 0), tone: "default" },
    { label: "可见项目", value: String(visibleProjectCount), tone: "default" }
  ];
}

export function toHomeWorkItemRows(
  queues: readonly WorkItemQueueViewModel[]
): HomeWorkItemRow[] {
  let sourceIndex = 0;
  return queues.flatMap((queue) =>
    queue.items.map((item) => {
      const row = {
        ...item,
        queueId: queue.id,
        queueTitle: queue.title,
        businessTypeLabel: workItemBusinessTypeLabel(item),
        statusLabel: workItemStatusLabel(queue.id, item),
        statusTone: workItemStatusTone(queue.id, item),
        stayMinutes: parseStayedMinutes(item.stayedText),
        amountRiskValue: parseAmountRiskValue(item.amountText),
        sourceIndex
      } satisfies HomeWorkItemRow;
      sourceIndex += 1;
      return row;
    })
  );
}

export function filterAndSortHomeWorkItemRows(
  rows: readonly HomeWorkItemRow[],
  filters: HomeWorkItemFilters
): HomeWorkItemRow[] {
  const filtered = rows.filter((row) => {
    const keyword = filters.keyword.trim().toLocaleLowerCase();
    const searchable = [
      row.title,
      row.projectName,
      row.businessCode,
      row.currentNode,
      row.nextAction,
      row.amountText
    ].join(" ").toLocaleLowerCase();

    return (
      (!filters.project || row.projectName === filters.project) &&
      (!filters.businessType || row.businessTypeLabel === filters.businessType) &&
      (!filters.status || row.statusLabel === filters.status) &&
      (!keyword || searchable.includes(keyword))
    );
  });

  return [...filtered].sort((left, right) => {
    const difference = sortValue(right, filters.sort) - sortValue(left, filters.sort);
    return difference || left.sourceIndex - right.sourceIndex;
  });
}

export function homeWorkItemFilterOptions(rows: readonly HomeWorkItemRow[]) {
  return {
    project: selectOptions(rows.map((row) => row.projectName), "全部项目"),
    businessType: selectOptions(rows.map((row) => row.businessTypeLabel), "全部类型"),
    status: selectOptions(rows.map((row) => row.statusLabel), "全部状态")
  };
}

function queueIndexForCard(card: WorkbenchCardViewModel): number {
  if (
    card.tone === "danger" ||
    /阻塞|风险|未确认|退回|失败|容量不足|超额/.test(`${card.title}${card.description}`)
  ) {
    return 1;
  }

  if (/我发起|进行中/.test(`${card.title}${card.description}`)) {
    return 2;
  }

  return 0;
}

const queueDefs: Array<Omit<WorkItemQueueViewModel, "items" | "total" | "truncated">> = [
  {
    id: "pending",
    title: "待我处理",
    description: "需要你当前岗位继续处理的接管、审批、归档和付款事项。"
  },
  {
    id: "blocked",
    title: "阻塞事项",
    description: "会影响付款、归档或试运行事实链的风险项。"
  },
  {
    id: "started",
    title: "我发起的进行中",
    description: "由你发起、还在审批或办理中的单据。"
  },
  {
    id: "drafts",
    title: "我的草稿",
    description: "已保存但尚未提交的草稿，不计入待审批。"
  }
];

function workItemBusinessTypeLabel(item: WorkItemReadModel) {
  const labels: Record<string, string> = {
    contract_takeover: "历史接管",
    archive: "归档确认",
    approval: "付款审批",
    payment: "付款审批",
    payment_execution: "付款实付",
    blocker: "阻塞事项",
    contract: "合同",
    settlement: "结算",
    spot_procurement: "零星采购",
    spot_payment: "零星付款",
    template: "模板"
  };
  return labels[item.businessType ?? ""] ?? labels[item.type] ?? "其他业务";
}

function workItemStatusLabel(queueId: WorkItemQueueViewModel["id"], item: WorkItemReadModel) {
  const text = `${item.title} ${item.currentNode} ${item.nextAction}`;
  if (/超时|逾期/.test(text)) return "超时";
  if (queueId === "blocked" || item.type === "blocker") return "阻塞";
  if (queueId === "drafts") return "草稿";
  if (queueId === "started") return "进行中";
  return "待处理";
}

function workItemStatusTone(
  queueId: WorkItemQueueViewModel["id"],
  item: WorkItemReadModel
): HomeWorkItemRow["statusTone"] {
  const status = workItemStatusLabel(queueId, item);
  if (status === "超时" || status === "阻塞") return "danger";
  if (status === "草稿") return "default";
  if (status === "进行中") return "default";
  return item.tone;
}

function parseStayedMinutes(value: string) {
  const amount = Number(value.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  if (/天/.test(value)) return amount * 24 * 60;
  if (/小时/.test(value)) return amount * 60;
  return amount;
}

function parseAmountRiskValue(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function sortValue(row: HomeWorkItemRow, sort: HomeWorkItemSort) {
  if (sort === "overdue") return (row.statusLabel === "超时" ? 10 ** 12 : 0) + row.stayMinutes;
  if (sort === "amount") return row.amountRiskValue;
  if (sort === "stayed") return row.stayMinutes;
  return (
    (row.queueId === "blocked" ? 10 ** 12 : 0) +
    (row.statusLabel === "超时" ? 10 ** 9 : 0) +
    (row.tone === "danger" ? 10 ** 6 : 0) +
    row.stayMinutes
  );
}

function selectOptions(values: readonly string[], allLabel: string) {
  const unique = [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );
  return [{ label: allLabel, value: "" }, ...unique.map((value) => ({ label: value, value }))];
}
