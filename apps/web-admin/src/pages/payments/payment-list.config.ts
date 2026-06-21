import type { PrimaryTableCol } from "tdesign-vue-next";

export type PaymentTone = "default" | "primary" | "warning" | "success";

export interface PaymentFilterField {
  key: string;
  label: string;
  placeholder: string;
  type: "select" | "keyword";
}

export interface PaymentSummaryItem {
  label: string;
  value: string;
  tone: PaymentTone;
}

export interface PaymentLedgerRow {
  id: string;
  paymentNo: string;
  settlementNo: string;
  project: string;
  requestedAmount: string;
  approvalStatus: string;
  approvalTone: PaymentTone;
  paymentStatus: string;
  paymentTone: PaymentTone;
  currentNode: string;
  ownerDepartment: string;
  updatedAt: string;
}

export const paymentFilterFields: PaymentFilterField[] = [
  {
    key: "project",
    label: "项目",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "settlementNo",
    label: "结算编号",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "approvalStatus",
    label: "审批状态",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "paymentStatus",
    label: "实付状态",
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

export const paymentSummaryItems: PaymentSummaryItem[] = [
  { label: "全部付款", value: "0", tone: "default" },
  { label: "待审批", value: "0", tone: "warning" },
  { label: "或签审批", value: "0", tone: "primary" },
  { label: "已批待付", value: "0", tone: "warning" },
  { label: "已实付", value: "0", tone: "success" }
];

export const paymentLedgerColumns: PrimaryTableCol<PaymentLedgerRow>[] = [
  { colKey: "paymentNo", title: "付款编号", width: 104 },
  { colKey: "settlementNo", title: "关联结算", width: 104 },
  { colKey: "project", title: "项目", minWidth: 120 },
  { colKey: "requestedAmount", title: "申请金额", width: 96, align: "right" },
  { colKey: "approvalStatus", title: "审批状态", width: 96 },
  { colKey: "paymentStatus", title: "实付状态", width: 96 },
  { colKey: "currentNode", title: "当前节点", width: 112 },
  { colKey: "ownerDepartment", title: "责任部门", width: 88 },
  { colKey: "updatedAt", title: "更新时间", width: 96 },
  { colKey: "operation", title: "操作", width: 64, fixed: "right" }
];

export const paymentLedgerRows: PaymentLedgerRow[] = [];

export const paymentRules = [
  "只能从已生效结算创建付款申请",
  "所有付款审批需董事长/总经理二选一或签",
  "审批通过后进入 approved_pending_payment，不代表已付款",
  "出纳/财务登记实付并上传付款凭证"
];
