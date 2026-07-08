import type { PrimaryTableCol } from "tdesign-vue-next";
import type { ApprovalDelegationReadModel } from "../../api/core-flow-read.api";

export type DelegationTone = "default" | "primary" | "warning" | "danger" | "success";

export interface DelegationLedgerRow extends ApprovalDelegationReadModel {
  scopeLabel: string;
  actingLabel: string;
  deadlineLabel: string;
  deadlineTone: DelegationTone;
}

export const delegationLedgerColumns: PrimaryTableCol<DelegationLedgerRow>[] = [
  { colKey: "fromUserName", title: "委托人", width: 112 },
  { colKey: "toUserName", title: "受托人", width: 112 },
  { colKey: "scopeLabel", title: "委托范围", minWidth: 160 },
  { colKey: "actingLabel", title: "处理标识", minWidth: 144 },
  { colKey: "startsAt", title: "生效时间", width: 176 },
  { colKey: "endsAt", title: "失效时间", width: 176 },
  { colKey: "deadlineLabel", title: "到期提醒", width: 112 },
  { colKey: "enabled", title: "状态", width: 96 },
  { colKey: "operation", title: "操作", width: 80, fixed: "right" }
];

export function mapDelegationLedgerRows(
  rows: ApprovalDelegationReadModel[],
  currentUserId: string | null | undefined,
  now: Date = new Date()
): DelegationLedgerRow[] {
  return rows.map((row) => ({
    ...row,
    scopeLabel: "合同/结算/付款审批",
    actingLabel: formatActingLabel(row, currentUserId),
    ...formatDeadline(row, now)
  }));
}

function formatActingLabel(
  row: ApprovalDelegationReadModel,
  currentUserId: string | null | undefined
): string {
  const fromName = row.fromUserName ?? row.fromUserId;
  const toName = row.toUserName ?? row.toUserId;

  if (currentUserId && row.toUserId === currentUserId) {
    return `代 ${fromName} 处理`;
  }

  if (currentUserId && row.fromUserId === currentUserId) {
    return `${toName} 代我处理`;
  }

  return `${fromName} -> ${toName}`;
}

function formatDeadline(
  row: ApprovalDelegationReadModel,
  now: Date
): Pick<DelegationLedgerRow, "deadlineLabel" | "deadlineTone"> {
  if (!row.enabled) {
    return { deadlineLabel: "已撤销", deadlineTone: "default" };
  }

  const startsAt = new Date(row.startsAt);
  const endsAt = new Date(row.endsAt);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { deadlineLabel: "期限异常", deadlineTone: "danger" };
  }

  if (startsAt.getTime() > now.getTime()) {
    return { deadlineLabel: "未生效", deadlineTone: "primary" };
  }

  if (endsAt.getTime() < now.getTime()) {
    return { deadlineLabel: "已过期", deadlineTone: "danger" };
  }

  const endsOn = startOfIsoDate(row.endsAt);
  const daysLeft = Math.round((endsOn.getTime() - startOfDay(now).getTime()) / 86400000);

  if (daysLeft <= 0) {
    return { deadlineLabel: "今日到期", deadlineTone: "danger" };
  }

  if (daysLeft === 1) {
    return { deadlineLabel: "明日到期", deadlineTone: "warning" };
  }

  if (daysLeft <= 6) {
    return { deadlineLabel: `${daysLeft} 天后到期`, deadlineTone: "warning" };
  }

  return { deadlineLabel: `${row.endsAt.slice(0, 10)} 到期`, deadlineTone: "success" };
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfIsoDate(value: string): Date {
  const [year = "0", month = "1", day = "1"] = value.slice(0, 10).split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}
