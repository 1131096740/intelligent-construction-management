export const APPROVAL_NODE_MODES = ["all", "any"] as const;
export type ApprovalNodeMode = (typeof APPROVAL_NODE_MODES)[number];

export const APPROVAL_ACTIONS = [
  "submit",
  "approve",
  "reject_previous",
  "return_to_applicant",
  "withdraw",
  "transfer",
  "delegate",
  "archive_confirm",
  "archive_reject"
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
