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
