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

export function draftLifecycleKindLabel(value: DraftLifecycleKind) {
  return DRAFT_LIFECYCLE_KIND_LABELS[value];
}

export function draftLedgerViewLabel(value: DraftLedgerView) {
  return DRAFT_LEDGER_VIEW_LABELS[value];
}

export function draftLifecycleActionLabel(value: DraftLifecycleAction) {
  return DRAFT_LIFECYCLE_ACTION_LABELS[value];
}
