import type { PrimaryTableCol } from "tdesign-vue-next";

export type DetailTone = "default" | "primary" | "warning" | "danger" | "success";

export interface DetailMetaItem {
  label: string;
  value: string;
  tone?: DetailTone;
}

export interface EffectivenessStep {
  label: string;
  status: string;
  tone: DetailTone;
}

export interface PaymentTermStage {
  id: string;
  version: string;
  status: string;
  contractVersion: string;
  basis: string;
  ratio: string;
  accountPeriod: string;
  triggerEvent: string;
  advanceDeductionMode?: string;
  advanceDeductionRatioBps?: number | null;
  advanceDeductionStartRatioBps?: number | null;
}

export interface ContractSettlementLedgerRow {
  id: string;
  settlementNo: string;
  period: string;
  settlementDate: string;
  settlementMethod: string;
  currentAmount: string;
  cumulativeBeforeAmount: string;
  cumulativeAfterAmount: string;
  approvalStatus: string;
  archiveStatus: string;
}

export interface ContractPaymentLedgerRow {
  id: string;
  paymentNo: string;
  settlementNo: string;
  requestedAmount: string;
  approvedAmount: string;
  paidAmount: string;
  paymentDate: string;
  approvalStatus: string;
  paymentStatus: string;
  voucherStatus: string;
}

export interface ContractFundTimelineItem {
  id: string;
  type: "settlement" | "payment";
  title: string;
  date: string;
  amount: string;
  description: string;
  tone: DetailTone;
}

export const contractDetailTitle = "HT-2026-001 · 钢材采购合同";

export const contractDetailMeta: DetailMetaItem[] = [
  { label: "当前状态", value: "待用章", tone: "warning" },
  { label: "当前版本", value: "原合同 v1" },
  { label: "付款条款", value: "v1 随合同生效" },
  { label: "责任部门", value: "合同部" },
  { label: "当前处理人", value: "王工" },
  { label: "下一步动作", value: "办理用章", tone: "warning" }
];

export const contractBaseInfo: DetailMetaItem[] = [
  { label: "项目", value: "一标段主体工程" },
  { label: "相对方", value: "材料供应商" },
  { label: "合同金额", value: "¥1,200,000.00" },
  { label: "签订日期", value: "2026-06-18" },
  { label: "合同类型", value: "材料采购" },
  { label: "创建人", value: "项目经理 张工" }
];

export const contractEffectivenessSteps: EffectivenessStep[] = [
  { label: "合同审批", status: "已通过", tone: "success" },
  { label: "用章", status: "待处理", tone: "warning" },
  { label: "归档上传", status: "未开始", tone: "default" },
  { label: "主管确认", status: "未开始", tone: "default" },
  { label: "合同生效", status: "阻塞", tone: "danger" }
];

export const contractPaymentTermColumns: PrimaryTableCol<PaymentTermStage>[] = [
  { colKey: "version", title: "版本", width: 72 },
  { colKey: "status", title: "状态", width: 112 },
  { colKey: "contractVersion", title: "适用合同版本", width: 132 },
  { colKey: "basis", title: "计算依据", width: 120 },
  { colKey: "ratio", title: "比例", width: 82 },
  { colKey: "accountPeriod", title: "账期", width: 92 },
  { colKey: "triggerEvent", title: "触发事件", minWidth: 148 },
  { colKey: "operation", title: "操作", width: 72, fixed: "right" }
];

export const contractPaymentTermStages: PaymentTermStage[] = [
  {
    id: "term-stage-current-settlement",
    version: "v1",
    status: "随合同生效",
    contractVersion: "合同 v1",
    basis: "当期结算",
    ratio: "80%",
    accountPeriod: "30天",
    triggerEvent: "结算归档生效"
  },
  {
    id: "term-stage-retention",
    version: "v1",
    status: "随合同生效",
    contractVersion: "合同 v1",
    basis: "质保金",
    ratio: "20%",
    accountPeriod: "365天",
    triggerEvent: "质保期满"
  }
];

export const contractSettlementBlockMessage =
  "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。";

export const contractSettlementLedgerColumns: PrimaryTableCol<ContractSettlementLedgerRow>[] = [
  { colKey: "settlementNo", title: "结算编号", width: 150 },
  { colKey: "period", title: "期次", width: 112 },
  { colKey: "settlementDate", title: "更新时间", width: 150 },
  { colKey: "settlementMethod", title: "结算方式", width: 120 },
  { colKey: "currentAmount", title: "本期结算金额", width: 140, align: "right" },
  { colKey: "cumulativeBeforeAmount", title: "期前累计结算", width: 140, align: "right" },
  { colKey: "cumulativeAfterAmount", title: "期后累计结算", width: 140, align: "right" },
  { colKey: "approvalStatus", title: "审批状态", width: 112 },
  { colKey: "archiveStatus", title: "归档状态", width: 112 },
  { colKey: "operation", title: "操作", width: 72, fixed: "right" }
];

export const contractPaymentLedgerColumns: PrimaryTableCol<ContractPaymentLedgerRow>[] = [
  { colKey: "paymentNo", title: "付款申请单号", width: 150 },
  { colKey: "settlementNo", title: "关联结算", width: 150 },
  { colKey: "requestedAmount", title: "申请金额", width: 120, align: "right" },
  { colKey: "approvedAmount", title: "已批金额", width: 120, align: "right" },
  { colKey: "paidAmount", title: "已实付金额", width: 120, align: "right" },
  { colKey: "paymentDate", title: "最近付款日期", width: 150 },
  { colKey: "approvalStatus", title: "审批状态", width: 112 },
  { colKey: "paymentStatus", title: "付款状态", width: 112 },
  { colKey: "voucherStatus", title: "凭证状态", width: 112 },
  { colKey: "operation", title: "操作", width: 72, fixed: "right" }
];

export function buildContractFundTimeline(
  settlementRows: readonly ContractSettlementLedgerRow[],
  paymentRows: readonly ContractPaymentLedgerRow[]
): ContractFundTimelineItem[] {
  const settlementItems = settlementRows.map((row) => ({
    id: `settlement:${row.id}`,
    type: "settlement" as const,
    title: `结算 ${row.settlementNo}`,
    date: row.settlementDate,
    amount: row.currentAmount,
    description: `${row.period} · 累计 ${row.cumulativeAfterAmount} · ${row.archiveStatus}`,
    tone: toneFromStatus(`${row.approvalStatus} ${row.archiveStatus}`)
  }));
  const paymentItems = paymentRows.map((row) => ({
    id: `payment:${row.id}`,
    type: "payment" as const,
    title: `付款 ${row.paymentNo}`,
    date: row.paymentDate,
    amount: row.paidAmount,
    description: `申请 ${row.requestedAmount} · 已批 ${row.approvedAmount} · ${row.paymentStatus}`,
    tone: toneFromStatus(`${row.approvalStatus} ${row.paymentStatus} ${row.voucherStatus}`)
  }));

  return [...settlementItems, ...paymentItems].sort((left, right) => {
    const rightTime = sortableDateTime(right.date);
    const leftTime = sortableDateTime(left.date);
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });
}

function toneFromStatus(statusText: string): DetailTone {
  if (/驳回|阻断|作废|失败/.test(statusText)) return "danger";
  if (/待|审批中|未/.test(statusText)) return "warning";
  if (/生效|已批|已付|完成|已上传|已归档/.test(statusText)) return "success";
  return "default";
}

function sortableDateTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
