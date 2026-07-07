import type { PrimaryTableCol } from "tdesign-vue-next";

export type SettlementTone = "default" | "primary" | "warning" | "danger" | "success";

export interface SettlementFilterField {
  key: string;
  label: string;
  placeholder: string;
  type: "select" | "keyword";
}

export interface SettlementSummaryItem {
  label: string;
  value: string;
  tone: SettlementTone;
}

export interface SettlementLedgerRow {
  id: string;
  settlementNo: string;
  contractNo: string;
  project: string;
  period: string;
  amount: string;
  paymentTermsVersion: string;
  currentNode: string;
  nodeTone: SettlementTone;
  ownerDepartment: string;
  pendingOwner: string;
  stalledFor: string;
  returnReason: string;
  nextAction: string;
  updatedAt: string;
}

export const settlementFilterFields: SettlementFilterField[] = [
  {
    key: "project",
    label: "项目",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "contractNo",
    label: "合同编号",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "settlementStatus",
    label: "结算状态",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "archiveStatus",
    label: "归档状态",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "keyword",
    label: "关键词",
    placeholder: "编号/合同/相对方",
    type: "keyword"
  }
];

export const settlementSummaryItems: SettlementSummaryItem[] = [
  { label: "全部结算", value: "0", tone: "default" },
  { label: "审批中", value: "0", tone: "warning" },
  { label: "待归档确认", value: "0", tone: "primary" },
  { label: "已生效", value: "0", tone: "success" },
  { label: "可申请付款", value: "0", tone: "success" }
];

export const settlementLedgerColumns: PrimaryTableCol<SettlementLedgerRow>[] = [
  { colKey: "settlementNo", title: "结算编号", width: 112 },
  { colKey: "contractNo", title: "关联合同", width: 112 },
  { colKey: "project", title: "项目", minWidth: 140 },
  { colKey: "period", title: "结算期间", width: 112 },
  { colKey: "amount", title: "结算金额", width: 112, align: "right" },
  { colKey: "paymentTermsVersion", title: "付款条款版本", width: 126 },
  { colKey: "currentNode", title: "当前节点", width: 116 },
  { colKey: "pendingOwner", title: "当前处理人", width: 104 },
  { colKey: "stalledFor", title: "停留时长", width: 88 },
  { colKey: "returnReason", title: "退回原因", minWidth: 136 },
  { colKey: "nextAction", title: "下一步动作", width: 112 },
  { colKey: "updatedAt", title: "更新时间", width: 112 },
  { colKey: "operation", title: "操作", width: 128, fixed: "right" }
];

export const settlementLedgerRows: SettlementLedgerRow[] = [];

export const settlementRules = [
  "只能从已生效合同版本创建结算",
  "结算单签字盖章并归档确认后才生效",
  "结算未生效前不可创建付款申请",
  "历史结算绑定当时的付款条款版本"
];
