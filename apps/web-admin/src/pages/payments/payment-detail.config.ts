import type { PrimaryTableCol } from "tdesign-vue-next";

export type PaymentDetailTone = "default" | "primary" | "warning" | "danger" | "success";

export interface PaymentDetailMetaItem {
  label: string;
  value: string;
  tone?: PaymentDetailTone;
}

export interface PaymentDetailStep {
  label: string;
  status: string;
  owner: string;
  tone: PaymentDetailTone;
}

export interface PaymentFlowSummaryItem {
  label: string;
  value: string;
  tone?: PaymentDetailTone;
}

export interface PaymentExecutionAllocationRow {
  id: string;
  executionCode: string;
  settlementNo: string;
  stageName: string;
  allocationType: string;
  amount: string;
}

export interface PaymentExecutionCoverageRow {
  id: string;
  executionCode: string;
  paidAt: string;
  paidAmount: string;
  voucherName: string;
  financeRecordedAmount: string;
  unrecordedAmount: string;
  coverageStatus: string;
}

export const paymentDetailTitle = "FK-2026-006 · 5月材料结算付款申请";

export const paymentDetailMeta: PaymentDetailMetaItem[] = [
  { label: "审批状态", value: "已通过", tone: "success" },
  { label: "实付状态", value: "已批待付", tone: "warning" },
  { label: "付款条款版本", value: "v1 随合同生效" },
  { label: "关联合同版本", value: "合同 v1" },
  { label: "责任部门", value: "财务部" },
  { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
];

export const paymentBaseInfo: PaymentDetailMetaItem[] = [
  { label: "付款编号", value: "FK-2026-006" },
  { label: "关联结算", value: "JS-2026-018 · 5月材料结算单" },
  { label: "结算状态", value: "已生效" },
  { label: "付款阶段", value: "当期结算款" },
  { label: "付款比例", value: "80%" },
  { label: "付款账期", value: "30天" },
  { label: "发票要求", value: "需提供发票" },
  { label: "申请金额", value: "¥256,000.00" },
  { label: "申请人", value: "项目经理 张工" }
];

export const paymentApprovalSteps: PaymentDetailStep[] = [
  { label: "付款申请", status: "已提交", owner: "经办人", tone: "success" },
  { label: "综合部主管审批", status: "已通过", owner: "综合部主管", tone: "success" },
  { label: "项目经理审批", status: "已通过", owner: "项目经理", tone: "success" },
  { label: "财务总监审批", status: "已通过", owner: "财务总监", tone: "success" },
  { label: "董事长/总经理或签", status: "已通过", owner: "董事长或总经理", tone: "success" },
  { label: "审批通过", status: "已批待付", owner: "系统", tone: "warning" }
];

export const paymentExecutionSteps: PaymentDetailStep[] = [
  { label: "已批待付", status: "当前状态", owner: "财务部", tone: "warning" },
  { label: "出纳付款登记", status: "待处理", owner: "出纳/财务", tone: "primary" },
  { label: "付款凭证上传", status: "待处理", owner: "出纳/财务", tone: "default" },
  { label: "财务入账", status: "待处理", owner: "财务部", tone: "default" },
  { label: "付款完成", status: "未完成", owner: "系统", tone: "danger" }
];

export function buildPaymentFlowSummary(
  meta: readonly PaymentDetailMetaItem[],
  baseInfo: readonly PaymentDetailMetaItem[]
): PaymentFlowSummaryItem[] {
  return [
    pickSummaryItem(meta, "审批状态"),
    pickSummaryItem(meta, "实付状态"),
    pickSummaryItem(baseInfo, "申请金额"),
    pickSummaryItem(meta, "责任部门"),
    pickSummaryItem(meta, "下一步动作")
  ];
}

export const paymentExecutionAllocationColumns: PrimaryTableCol<PaymentExecutionAllocationRow>[] = [
  { colKey: "executionCode", title: "实付记录", width: 128 },
  { colKey: "settlementNo", title: "结算单", width: 128 },
  { colKey: "stageName", title: "付款阶段", minWidth: 128 },
  { colKey: "allocationType", title: "分摊/抵扣类型", width: 128 },
  { colKey: "amount", title: "分摊金额", width: 112, align: "right" }
];

export const paymentExecutionCoverageColumns: PrimaryTableCol<PaymentExecutionCoverageRow>[] = [
  { colKey: "executionCode", title: "实付记录", width: 128 },
  { colKey: "paidAt", title: "实付时间", width: 156 },
  { colKey: "paidAmount", title: "实付金额", width: 112, align: "right" },
  { colKey: "voucherName", title: "付款凭证", minWidth: 180 },
  { colKey: "financeRecordedAmount", title: "已入账", width: 112, align: "right" },
  { colKey: "unrecordedAmount", title: "未入账", width: 112, align: "right" },
  { colKey: "coverageStatus", title: "覆盖状态", width: 112 }
];

export const paymentTraceRules = [
  "付款申请来自已生效结算或合同累计结算付款",
  "合同累计结算付款实付后自动形成分摊台账",
  "审批通过进入已批待付",
  "审批通过不等于实际付款完成",
  "实付登记必须上传付款凭证并写入审计日志"
];

export const paymentExecutionBlockMessage =
  "付款审批已通过，但尚未登记实际付款；必须由出纳/财务登记实付金额并上传付款凭证后，才能进入财务入账与付款完成。";

function pickSummaryItem(
  items: readonly PaymentDetailMetaItem[],
  label: string
): PaymentFlowSummaryItem {
  const item = items.find((candidate) => candidate.label === label);
  return { label, value: item?.value ?? "-", tone: item?.tone };
}
