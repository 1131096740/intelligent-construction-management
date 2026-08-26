import type { RoleKey } from "./roles";

export const CLEARING_EVENT_KINDS = Object.freeze([
  "estimated",
  "withheld",
  "pending_reconciliation",
  "final_confirmed",
  "supplemental",
  "returned"
] as const);

export type ClearingEventKind = (typeof CLEARING_EVENT_KINDS)[number];

export const CLEARING_WORKFLOW_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "confirmed",
  "returned",
  "cancelled"
] as const);

export type ClearingWorkflowStatus = (typeof CLEARING_WORKFLOW_STATUSES)[number];

export const CLEARING_CATEGORIES = Object.freeze([
  "management_fee",
  "final_tax",
  "deposit",
  "insurance_fee",
  "service_fee",
  "assigned_management_salary",
  "other_controlled_deduction"
] as const);

export type ClearingCategory = (typeof CLEARING_CATEGORIES)[number];

export const CLEARING_ACTIONS = Object.freeze([
  "read",
  "prepare",
  "submit",
  "attest",
  "confirm",
  "return",
  "reopen"
] as const);

export type ClearingAction = (typeof CLEARING_ACTIONS)[number];

const CLEARING_ACTION_ROLES = Object.freeze({
  read: ["finance_staff", "finance_director"],
  prepare: ["finance_staff", "finance_director"],
  submit: ["finance_staff", "finance_director"],
  attest: ["finance_staff", "finance_director"],
  confirm: ["finance_director"],
  return: ["finance_director"],
  reopen: ["finance_director"]
} as const satisfies Readonly<Record<ClearingAction, readonly RoleKey[]>>);

export function clearingActionRoles(action: ClearingAction): readonly RoleKey[] {
  return CLEARING_ACTION_ROLES[action];
}

export function isClearingEventKind(value: unknown): value is ClearingEventKind {
  return CLEARING_EVENT_KINDS.includes(value as ClearingEventKind);
}

export function isClearingWorkflowStatus(
  value: unknown
): value is ClearingWorkflowStatus {
  return CLEARING_WORKFLOW_STATUSES.includes(value as ClearingWorkflowStatus);
}

export function isClearingCategory(value: unknown): value is ClearingCategory {
  return CLEARING_CATEGORIES.includes(value as ClearingCategory);
}
