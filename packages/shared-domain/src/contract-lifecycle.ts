export type ContractLifecycleStage =
  | "unsubmitted_draft"
  | "returned_editable"
  | "ended_retained"
  | "deleting"
  | "protected_formal";

export type ContractLifecycleHistoryRetention =
  | "none"
  | "active_process"
  | "three_calendar_months"
  | "permanent";

export interface ContractLifecycleCapabilities {
  canView: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canAbandon: boolean;
  canPhysicallyDelete: boolean;
  canDownload: boolean;
  historyRetention: ContractLifecycleHistoryRetention;
}
