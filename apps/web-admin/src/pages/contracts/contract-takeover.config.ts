import type { PrimaryTableCol } from "tdesign-vue-next";
import type {
  ContractLifecycleStatus,
  ContractTakeoverCentsValue,
  ContractTakeoverLevel,
  ContractTakeoverReadModel,
  ContractTakeoverStatus
} from "../../api/core-flow-read.api";

export type ContractTakeoverTone = "default" | "primary" | "warning" | "danger" | "success";

export interface ContractTakeoverOption<T extends string> {
  value: T;
  label: string;
}

export interface ContractTakeoverTableRow {
  id: string;
  contractNo: string;
  contractName: string;
  counterparty: string;
  amount: string;
  takeoverLevel: ContractTakeoverLevel;
  takeoverLevelLabel: string;
  takeoverStatus: ContractTakeoverStatus;
  takeoverStatusLabel: string;
  takeoverStatusTone: ContractTakeoverTone;
  lifecycleStatus: ContractLifecycleStatus;
  lifecycleStatusLabel: string;
  signedAt: string;
  historicalSettled: string;
  historicalPaid: string;
  historicalPending: string;
  historicalProxyPaid: string;
  updatedAt: string;
  takeover: ContractTakeoverReadModel;
}

export const takeoverLevelOptions: Array<ContractTakeoverOption<ContractTakeoverLevel>> = [
  { value: "A", label: "A级：资料完整，可直接接管" },
  { value: "B", label: "B级：资料基本完整，需补少量说明" },
  { value: "C", label: "C级：资料缺口明显，接管后重点跟踪" }
];

export const lifecycleStatusOptions: Array<ContractTakeoverOption<ContractLifecycleStatus>> = [
  { value: "signed_not_started", label: "已签未开工" },
  { value: "in_progress", label: "履约中" },
  { value: "suspended", label: "暂停履约" },
  { value: "completed", label: "已履约完成" },
  { value: "terminated", label: "已终止" },
  { value: "disputed", label: "争议中" }
];

export const contractTakeoverColumns: PrimaryTableCol<ContractTakeoverTableRow>[] = [
  { colKey: "contractNo", title: "合同编号", width: 132 },
  { colKey: "contractName", title: "合同名称", minWidth: 180 },
  { colKey: "counterparty", title: "相对方", minWidth: 140 },
  { colKey: "amount", title: "合同金额", width: 116, align: "right" },
  { colKey: "takeoverLevelLabel", title: "接管等级", width: 104 },
  { colKey: "takeoverStatusLabel", title: "接管状态", width: 112 },
  { colKey: "lifecycleStatusLabel", title: "履约状态", width: 112 },
  { colKey: "historicalPaid", title: "历史已付", width: 116, align: "right" },
  { colKey: "historicalPending", title: "在途/待付", width: 116, align: "right" },
  { colKey: "updatedAt", title: "更新时间", width: 112 },
  { colKey: "operation", title: "操作", width: 168, fixed: "right" }
];

export function takeoverLevelLabel(value: ContractTakeoverLevel): string {
  return takeoverLevelOptions.find((option) => option.value === value)?.label.slice(0, 2) ?? value;
}

export function lifecycleStatusLabel(value: ContractLifecycleStatus): string {
  return lifecycleStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function takeoverStatusLabel(status: ContractTakeoverStatus): string {
  const labels: Record<ContractTakeoverStatus, string> = {
    draft: "草稿",
    pending_review: "待复核",
    confirmed: "已接管",
    needs_supplement: "待补充",
    voided: "已作废"
  };

  return labels[status] ?? status;
}

export function takeoverStatusTone(status: ContractTakeoverStatus): ContractTakeoverTone {
  const tones: Record<ContractTakeoverStatus, ContractTakeoverTone> = {
    draft: "default",
    pending_review: "warning",
    confirmed: "success",
    needs_supplement: "primary",
    voided: "danger"
  };

  return tones[status] ?? "default";
}

export function canSubmitTakeoverReview(takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">) {
  return takeover.takeoverStatus === "draft" || takeover.takeoverStatus === "needs_supplement";
}

export function canConfirmTakeover(takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">) {
  return takeover.takeoverStatus === "pending_review";
}

export function yuanToCents(
  value: string,
  label: string,
  options: { allowZero?: boolean } = {}
): number {
  const trimmed = value.trim();
  if (!trimmed && options.allowZero) {
    return 0;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`${label}必须是非负数字，最多保留两位小数`);
  }

  const [yuan, cents = ""] = trimmed.split(".");
  const amountCents = BigInt(yuan) * 100n + BigInt(cents.padEnd(2, "0"));
  if (!options.allowZero && amountCents <= 0n) {
    throw new Error(`${label}必须大于 0`);
  }
  if (amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label}超过系统支持范围`);
  }

  return Number(amountCents);
}

export function centsToYuanText(value: ContractTakeoverCentsValue | bigint): string {
  const amountCents = centsValueToBigInt(value);
  const sign = amountCents < 0n ? "-" : "";
  const absolute = amountCents < 0n ? -amountCents : amountCents;
  const yuan = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  const yuanText = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `¥${sign}${yuanText}.${cents}`;
}

export function formatTakeoverDate(value: string | null | undefined): string {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未记录";
  }

  return value.slice(0, 10);
}

export function toContractTakeoverTableRow(
  takeover: ContractTakeoverReadModel
): ContractTakeoverTableRow {
  return {
    id: takeover.id,
    contractNo: takeover.contractNo,
    contractName: takeover.contractName,
    counterparty: takeover.counterparty,
    amount: centsToYuanText(takeover.amountCents),
    takeoverLevel: takeover.takeoverLevel,
    takeoverLevelLabel: takeoverLevelLabel(takeover.takeoverLevel),
    takeoverStatus: takeover.takeoverStatus,
    takeoverStatusLabel: takeoverStatusLabel(takeover.takeoverStatus),
    takeoverStatusTone: takeoverStatusTone(takeover.takeoverStatus),
    lifecycleStatus: takeover.lifecycleStatus,
    lifecycleStatusLabel: lifecycleStatusLabel(takeover.lifecycleStatus),
    signedAt: formatTakeoverDate(takeover.signedAt),
    historicalSettled: centsToYuanText(takeover.historicalSettledCents),
    historicalPaid: centsToYuanText(takeover.historicalPaidCents),
    historicalPending: centsToYuanText(
      centsValueToBigInt(takeover.historicalApprovalPendingPaymentCents) +
        centsValueToBigInt(takeover.historicalApprovedPendingPaymentCents)
    ),
    historicalProxyPaid: centsToYuanText(takeover.historicalProxyPaidCents),
    updatedAt: formatTakeoverDate(takeover.updatedAt),
    takeover
  };
}

function centsValueToBigInt(value: ContractTakeoverCentsValue | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("金额分值必须是整数");
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error("金额分值必须是整数字符串");
  }
  return BigInt(value);
}
