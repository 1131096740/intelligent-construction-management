import type { PrimaryTableCol } from "tdesign-vue-next";

export type ContractStatusTone = "default" | "primary" | "warning" | "success";

export interface ContractFilterField {
  key: string;
  label: string;
  placeholder: string;
  type: "select" | "keyword";
}

export interface ContractSummaryItem {
  label: string;
  value: string;
  tone: ContractStatusTone;
}

export interface ContractLedgerRow {
  id: string;
  contractNo: string;
  name: string;
  project: string;
  counterparty: string;
  amount: string;
  version: string;
  currentNode: string;
  nodeTone: ContractStatusTone;
  ownerDepartment: string;
  updatedAt: string;
}

export const contractFilterFields: ContractFilterField[] = [
  {
    key: "project",
    label: "项目",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "contractStatus",
    label: "合同状态",
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
    key: "paymentTermsVersion",
    label: "付款条款版本",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "keyword",
    label: "关键词",
    placeholder: "编号/名称/相对方",
    type: "keyword"
  }
];

export const contractSummaryItems: ContractSummaryItem[] = [
  { label: "全部合同", value: "0", tone: "default" },
  { label: "审批中", value: "0", tone: "warning" },
  { label: "待用章", value: "0", tone: "warning" },
  { label: "待归档", value: "0", tone: "primary" },
  { label: "已生效", value: "0", tone: "success" }
];

export const contractLedgerColumns: PrimaryTableCol<ContractLedgerRow>[] = [
  { colKey: "contractNo", title: "合同编号", width: 110 },
  { colKey: "name", title: "合同名称", minWidth: 150 },
  { colKey: "project", title: "项目", width: 116 },
  { colKey: "counterparty", title: "相对方", width: 116 },
  { colKey: "amount", title: "金额", width: 88, align: "right" },
  { colKey: "version", title: "版本", width: 64 },
  { colKey: "currentNode", title: "当前节点", width: 96 },
  { colKey: "ownerDepartment", title: "责任部门", width: 88 },
  { colKey: "updatedAt", title: "更新时间", width: 104 },
  { colKey: "operation", title: "操作", width: 64, fixed: "right" }
];

export const contractLedgerRows: ContractLedgerRow[] = [];
