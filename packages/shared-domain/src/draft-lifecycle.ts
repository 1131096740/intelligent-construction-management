export const DRAFT_LIFECYCLE_KINDS = [
  "local_unsaved",
  "pristine_draft",
  "approval_draft",
  "formal_record",
  "technical_temporary"
] as const;

export type DraftLifecycleKind = (typeof DRAFT_LIFECYCLE_KINDS)[number];

export const DRAFT_LIFECYCLE_KIND_LABELS: Readonly<Record<DraftLifecycleKind, string>> = {
  local_unsaved: "未保存填写",
  pristine_draft: "纯净草稿",
  approval_draft: "审批型草稿",
  formal_record: "正式业务记录",
  technical_temporary: "技术临时数据"
};

export const DRAFT_LEDGER_VIEWS = [
  "formal_ledger",
  "my_drafts",
  "returned_for_revision",
  "ended"
] as const;

export type DraftLedgerView = (typeof DRAFT_LEDGER_VIEWS)[number];

export const DRAFT_LEDGER_VIEW_LABELS: Readonly<Record<DraftLedgerView, string>> = {
  formal_ledger: "正式台账",
  my_drafts: "我的草稿",
  returned_for_revision: "退回待修改",
  ended: "已结束"
};

export const DRAFT_LIFECYCLE_ACTIONS = [
  "discard_local",
  "delete_pristine_draft",
  "abandon_application",
  "withdraw",
  "void",
  "terminate",
  "discard_version"
] as const;

export type DraftLifecycleAction = (typeof DRAFT_LIFECYCLE_ACTIONS)[number];

export const DRAFT_LIFECYCLE_ACTION_LABELS: Readonly<Record<DraftLifecycleAction, string>> = {
  discard_local: "放弃填写",
  delete_pristine_draft: "删除草稿",
  abandon_application: "放弃申请",
  withdraw: "撤回申请",
  void: "作废",
  terminate: "异常终止",
  discard_version: "废弃版本"
};

export interface DraftLifecyclePresentation {
  kind: DraftLifecycleKind;
  ledgerView: DraftLedgerView;
  availableActions: DraftLifecycleAction[];
  blockingReasons: string[];
}

export interface LifecycleLedgerPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LifecycleLedgerViewCount {
  formal_ledger: number;
  my_drafts: number;
  returned_for_revision: number;
  ended: number;
}

/** A server-owned ledger slice. Counts always describe the full visible set. */
export interface LifecycleLedgerPage<T> {
  rows: T[];
  meta: LifecycleLedgerPageMeta;
  summary: LifecycleLedgerViewCount;
}

export const CONTRACT_WORKBENCH_VIEWS = [
  "pending_action",
  "my_drafts",
  "in_approval",
  "pending_seal",
  "pending_archive",
  "effective",
  "all"
] as const;

export type ContractWorkbenchView = (typeof CONTRACT_WORKBENCH_VIEWS)[number];

export interface ContractWorkbenchLedgerViewCount {
  pending_action: number;
  my_drafts: number;
  in_approval: number;
  pending_seal: number;
  pending_archive: number;
  effective: number;
  all: number;
}

/** Server-owned contract-root workbench projection; legacy lifecycle views remain separate. */
export interface ContractWorkbenchLedgerPage<T> {
  rows: T[];
  meta: LifecycleLedgerPageMeta;
  summary: ContractWorkbenchLedgerViewCount;
}

export const SETTLEMENT_WORKBENCH_VIEWS = [
  "pending_action",
  "my_drafts",
  "in_approval",
  "pending_archive",
  "effective",
  "all"
] as const;

export type SettlementWorkbenchView = (typeof SETTLEMENT_WORKBENCH_VIEWS)[number];

export interface SettlementWorkbenchLedgerViewCount {
  pending_action: number;
  my_drafts: number;
  in_approval: number;
  pending_archive: number;
  effective: number;
  all: number;
}

/** Server-owned settlement-root workbench projection; legacy lifecycle views remain separate. */
export interface SettlementWorkbenchLedgerPage<T> {
  rows: T[];
  meta: LifecycleLedgerPageMeta;
  summary: SettlementWorkbenchLedgerViewCount;
}

export function draftLifecycleKindLabel(value: DraftLifecycleKind) {
  return DRAFT_LIFECYCLE_KIND_LABELS[value];
}

export function draftLedgerViewLabel(value: DraftLedgerView) {
  return DRAFT_LEDGER_VIEW_LABELS[value];
}

export function draftLifecycleActionLabel(value: DraftLifecycleAction) {
  return DRAFT_LIFECYCLE_ACTION_LABELS[value];
}
