import type { SettlementStatus } from "@jiangkong/shared-domain";

export const SETTLEMENT_LINE_OCCUPANCY_STATUSES = [
  "in_approval",
  "approval_pending",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
] as const satisfies readonly SettlementStatus[];
