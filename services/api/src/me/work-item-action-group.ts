/**
 * 首页动作分组投影（Issue #423 / UI-01）。
 *
 * 20 余个待办生产者已经在 `WorkItem.type` / `businessType` / 节点文案上
 * 表达了「这一步在办什么」。本模块只做一层集中投影，不改变任何队列契约，
 * 避免在 23 处生产者里散落分组标签而漏标。新增生产者只要沿用既有 `type`
 * 就会自动落组；新增业务类型可在 `BUSINESS_TYPE_GROUPS` 显式覆盖。
 */
export type WorkItemActionGroupKey =
  | "approval"
  | "review"
  | "procurement"
  | "payment"
  | "supplement"
  | "other";

export interface WorkItemActionGroupDefinition {
  key: Exclude<WorkItemActionGroupKey, "other">;
  title: string;
  description: string;
  targetPath: string;
}

/** 顺序即首页展示顺序：审批 → 复核 → 采购 → 付款 → 补资料。 */
export const WORK_ITEM_ACTION_GROUPS: readonly WorkItemActionGroupDefinition[] = [
  {
    key: "approval",
    title: "待审批",
    description: "等待你当前岗位审批或同意的单据。",
    targetPath: "/审批中心?view=pendingApproval"
  },
  {
    key: "review",
    title: "待复核",
    description: "需要你核对依据并确认的复核事项。",
    targetPath: "/审批中心"
  },
  {
    key: "procurement",
    title: "待采购",
    description: "审批已通过、等你按需采购或登记的申请。",
    targetPath: "/综合采购申请"
  },
  {
    key: "payment",
    title: "待付款",
    description: "已批准待实付，等你登记付款与凭证。",
    targetPath: "/付款管理"
  },
  {
    key: "supplement",
    title: "待补资料",
    description: "缺资料、缺上传或待补录的事项。",
    targetPath: "/历史合同接管"
  }
] as const;

export interface WorkItemActionGroupInput {
  id: string;
  type: string;
  businessType?: string;
  title?: string;
  currentNode?: string;
  nextAction?: string;
  actionGroup?: WorkItemActionGroupKey;
}

export interface WorkItemActionGroupProjection<T extends WorkItemActionGroupInput> {
  key: Exclude<WorkItemActionGroupKey, "other">;
  title: string;
  description: string;
  count: number;
  targetPath: string;
  items: T[];
}

/**
 * 业务类型覆盖：这些类型虽然常常 `type=approval`，但实际是「复核/核验」职责，
 * 不属于审批动作。其余类型沿用 `type` 的默认分组。
 */
const BUSINESS_TYPE_GROUPS: Record<string, WorkItemActionGroupKey> = {
  receipt_review: "review",
  contract_economic_review: "review",
  upward_contract_amount_revision: "review",
  contract_bank_verification: "review",
  contract_proxy_execution: "review",
  upward_receipt_match: "review"
};

const UPLOAD_OR_SIGNATURE = /上传|签署|盖章|补录|填写|补充/;
const SEAL = /用章/;
const RECHECK = /复核|核对|核验|确认/;

export function workItemActionGroup(item: WorkItemActionGroupInput): WorkItemActionGroupKey {
  if (item.actionGroup) return item.actionGroup;
  const businessTypeGroup = item.businessType
    ? BUSINESS_TYPE_GROUPS[item.businessType]
    : undefined;
  if (businessTypeGroup) return businessTypeGroup;

  const text = `${item.title ?? ""} ${item.currentNode ?? ""} ${item.nextAction ?? ""}`;
  if (item.type === "approval") return "approval";
  if (item.type === "procurement") return "procurement";
  if (item.type === "payment_execution") return "payment";
  if (item.type === "archive") {
    if (UPLOAD_OR_SIGNATURE.test(text)) return "supplement";
    if (SEAL.test(text)) return "approval";
    return "review";
  }
  if (item.type === "contract_takeover") {
    return RECHECK.test(text) && !UPLOAD_OR_SIGNATURE.test(text) ? "review" : "supplement";
  }
  return "other";
}

/** 只返回非空分组；计数取全量，摘要最多 3 条，保持生产者顺序。 */
export function groupWorkItems<T extends WorkItemActionGroupInput>(
  items: readonly T[]
): WorkItemActionGroupProjection<T>[] {
  const grouped = new Map<Exclude<WorkItemActionGroupKey, "other">, T[]>();
  for (const item of items) {
    const key = workItemActionGroup(item);
    if (key === "other") continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  return WORK_ITEM_ACTION_GROUPS.flatMap((definition) => {
    const bucket = grouped.get(definition.key);
    if (!bucket?.length) return [];
    return [{
      ...definition,
      count: bucket.length,
      items: bucket.slice(0, 3)
    }];
  });
}
