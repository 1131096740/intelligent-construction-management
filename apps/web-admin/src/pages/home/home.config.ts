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
  id: "pending" | "blocked" | "started";
  title: string;
  description: string;
  items: WorkItemViewModel[];
}

export interface WorkItemViewModel extends WorkItemReadModel {
  toneClass: string;
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
  return queueDefs.map((queue) => ({
    ...queue,
    items: (workItems?.queues[queue.id] ?? []).map((item) => ({
      ...item,
      toneClass: `tone-${item.tone}`
    }))
  }));
}

export function hasWorkItemPermissionData(
  workItems: WorkItemsReadModel | null | undefined
): boolean {
  return (workItems?.visibleProjectCount ?? 0) > 0;
}

export function hasOpenWorkItems(queues: readonly WorkItemQueueViewModel[]): boolean {
  return queues.some((queue) => queue.items.length > 0);
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

const queueDefs: Array<Omit<WorkItemQueueViewModel, "items">> = [
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
  }
];
