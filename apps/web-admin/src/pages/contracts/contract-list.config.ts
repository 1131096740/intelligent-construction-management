import type { PrimaryTableCol } from "tdesign-vue-next";

export type ContractStatusTone = "default" | "primary" | "warning" | "danger" | "success";

export interface ContractLedgerFilters {
  project: string;
  contractStatus: string;
  archiveStatus: string;
  paymentTermsVersion: string;
  keyword: string;
}

export type ContractFilterKey = keyof ContractLedgerFilters;

export interface ContractFilterField {
  key: ContractFilterKey;
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
  pendingOwner: string;
  stalledFor: string;
  returnReason: string;
  nextAction: string;
  updatedAt: string;
  paymentTermsVersion?: string;
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
  { colKey: "pendingOwner", title: "当前处理人", width: 104 },
  { colKey: "stalledFor", title: "停留时长", width: 88 },
  { colKey: "returnReason", title: "退回原因", minWidth: 136 },
  { colKey: "nextAction", title: "下一步动作", width: 112 },
  { colKey: "updatedAt", title: "更新时间", width: 104 },
  { colKey: "operation", title: "操作", width: 128, fixed: "right" }
];

export const contractLedgerRows: ContractLedgerRow[] = [];

export const contractPaginationBlockReason =
  "当前仅显示系统本次返回的记录，暂不支持翻页；请使用筛选缩小范围，避免把当前列表误认为全部记录。";

export function contractLedgerFilterOptions(rows: readonly ContractLedgerRow[]) {
  return {
    project: ledgerSelectOptions(rows.map((row) => row.project), "全部项目"),
    contractStatus: ledgerSelectOptions(rows.map((row) => row.currentNode), "全部合同状态"),
    archiveStatus: ledgerSelectOptions(rows.map(contractArchiveStatus), "全部归档状态"),
    paymentTermsVersion: ledgerSelectOptions(
      rows.map((row) => row.paymentTermsVersion ?? row.version),
      "全部付款条款版本"
    )
  };
}

export function emptyContractLedgerFilters(): ContractLedgerFilters {
  return {
    project: "",
    contractStatus: "",
    archiveStatus: "",
    paymentTermsVersion: "",
    keyword: ""
  };
}

export function filterContractLedgerRows(
  rows: readonly ContractLedgerRow[],
  filters: ContractLedgerFilters
): ContractLedgerRow[] {
  return rows.filter((row) => {
    const statusText = `${row.currentNode} ${row.nextAction} ${row.returnReason}`;
    const keywordText = [
      row.contractNo,
      row.name,
      row.project,
      row.counterparty,
      row.currentNode,
      row.pendingOwner,
      row.nextAction
    ].join(" ");

    return (
      includesText(row.project, filters.project) &&
      includesText(statusText, filters.contractStatus) &&
      includesText(contractArchiveStatus(row), filters.archiveStatus) &&
      includesText(row.paymentTermsVersion ?? row.version, filters.paymentTermsVersion) &&
      includesText(keywordText, filters.keyword)
    );
  });
}

function contractArchiveStatus(row: ContractLedgerRow) {
  const statusText = `${row.currentNode} ${row.nextAction}`;
  if (/已生效|发起结算/.test(statusText)) return "已生效";
  if (/归档/.test(statusText)) return "待归档确认";
  return "未进入归档";
}

function includesText(value: string, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }

  return value.toLocaleLowerCase().includes(normalized);
}

function ledgerSelectOptions(values: readonly string[], allLabel: string) {
  const unique = [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );
  return [{ label: allLabel, value: "" }, ...unique.map((value) => ({ label: value, value }))];
}
