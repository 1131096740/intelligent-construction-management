import type { RoleKey } from "./roles";

export const WAGE_STATEMENT_VERSION_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "confirmed",
  "review_returned",
  "superseded"
] as const);

export type WageStatementVersionStatus =
  (typeof WAGE_STATEMENT_VERSION_STATUSES)[number];

export const WAGE_STATEMENT_VERSION_KINDS = Object.freeze([
  "base",
  "normal",
  "supplemental",
  "correction",
  "reversal"
] as const);

export type WageStatementVersionKind =
  (typeof WAGE_STATEMENT_VERSION_KINDS)[number];

export const WAGE_COST_COMPONENT_CODES = Object.freeze([
  "gross_wage",
  "project_post_allowance",
  "project_bonus",
  "employer_social_insurance",
  "employer_housing_fund",
  "other_evidenced_labor_cost"
] as const);

export type WageCostComponentCode = (typeof WAGE_COST_COMPONENT_CODES)[number];

export const WAGE_CREDITOR_CATEGORIES = Object.freeze([
  "employee_net_pay",
  "withheld_individual_income_tax",
  "employee_social_insurance",
  "employee_housing_fund",
  "employer_social_insurance",
  "employer_housing_fund",
  "other_controlled_payee"
] as const);

export type WageCreditorCategory = (typeof WAGE_CREDITOR_CATEGORIES)[number];

export const WAGE_CREDITOR_SUBJECT_TYPES = Object.freeze([
  "employee_user",
  "business_party"
] as const);

export type WageCreditorSubjectType = (typeof WAGE_CREDITOR_SUBJECT_TYPES)[number];

export const WAGE_PAYABLE_REF_DIRECTIONS = Object.freeze([
  "increase",
  "decrease"
] as const);

export type WagePayableRefDirection = (typeof WAGE_PAYABLE_REF_DIRECTIONS)[number];

export const WAGE_STATEMENT_ACTIONS = Object.freeze([
  "prepare",
  "submit",
  "confirm",
  "return"
] as const);

export type WageStatementAction = (typeof WAGE_STATEMENT_ACTIONS)[number];

const WAGE_STATEMENT_ACTION_ROLES = Object.freeze({
  prepare: ["finance_staff", "finance_director"],
  submit: ["finance_staff", "finance_director"],
  confirm: ["finance_director"],
  return: ["finance_director"]
} as const satisfies Readonly<Record<WageStatementAction, readonly RoleKey[]>>);

export function wageStatementActionRoles(action: WageStatementAction): readonly RoleKey[] {
  return WAGE_STATEMENT_ACTION_ROLES[action];
}

export function isWageStatementVersionStatus(value: unknown): value is WageStatementVersionStatus {
  return WAGE_STATEMENT_VERSION_STATUSES.includes(value as WageStatementVersionStatus);
}
