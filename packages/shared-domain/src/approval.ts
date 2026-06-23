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
  "remind",
  "archive_confirm",
  "archive_reject"
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/**
 * 审批超时催办（最小模型）。
 *
 * - 以审批实例上一次"真实动作"时间（提交/审批等，体现在 `ApprovalInstance.updatedAt`）为基准。
 * - 超过 SLA 即视为超时，可催办；催办本身不改写实例（不影响 `updatedAt`），仅记一条
 *   `ApprovalActionLog`（action = "remind"），因此重复催办用 `reminderIntervalHours` 节流。
 */
export const DEFAULT_APPROVAL_SLA_HOURS = 48;
export const DEFAULT_APPROVAL_REMINDER_INTERVAL_HOURS = 24;

const MILLIS_PER_HOUR = 3_600_000;

export function approvalElapsedHours(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / MILLIS_PER_HOUR;
}

export function isApprovalOverdue(
  lastActivityAt: Date,
  now: Date,
  slaHours: number = DEFAULT_APPROVAL_SLA_HOURS
): boolean {
  return approvalElapsedHours(lastActivityAt, now) >= slaHours;
}

export interface ApprovalReminderEligibility {
  /** 审批实例状态；仅进行中（in_progress）可催办。 */
  status: string;
  /** 上一次真实动作时间（ApprovalInstance.updatedAt）。 */
  lastActivityAt: Date;
  /** 最近一次催办时间（最新 remind 动作日志），用于节流。 */
  lastRemindedAt?: Date | null;
  now: Date;
  slaHours?: number;
  reminderIntervalHours?: number;
}

export function canRemindApproval(input: ApprovalReminderEligibility): boolean {
  if (input.status !== "in_progress") {
    return false;
  }

  if (!isApprovalOverdue(input.lastActivityAt, input.now, input.slaHours ?? DEFAULT_APPROVAL_SLA_HOURS)) {
    return false;
  }

  if (input.lastRemindedAt) {
    const interval = input.reminderIntervalHours ?? DEFAULT_APPROVAL_REMINDER_INTERVAL_HOURS;
    if (approvalElapsedHours(input.lastRemindedAt, input.now) < interval) {
      return false;
    }
  }

  return true;
}
