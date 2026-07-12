import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import type { PrimaryTableCol } from "tdesign-vue-next";
import { centsTextToYuanText } from "../../lib/money";

export type SettlementTone = "default" | "primary" | "warning" | "danger" | "success";

export interface SettlementLedgerFilters {
  project: string;
  contractNo: string;
  settlementStatus: string;
  archiveStatus: string;
  keyword: string;
}

export type SettlementFilterKey = keyof SettlementLedgerFilters;

export interface SettlementFilterField {
  key: SettlementFilterKey;
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

export interface SettlementSourceLinePreviewRow extends SettlementSourceLineReadModel {
  contractAmount: string;
  settledAmount: string;
  remainingAmount: string;
  statusText: string;
}

export const settlementSourceLineColumns: PrimaryTableCol<SettlementSourceLinePreviewRow>[] = [
  { colKey: "billName", title: "清单", width: 120 },
  { colKey: "itemCode", title: "编码", width: 92 },
  { colKey: "itemName", title: "合同清单项", minWidth: 180 },
  { colKey: "unit", title: "单位", width: 68 },
  { colKey: "quantity", title: "合同数量", width: 110, align: "right" },
  { colKey: "contractAmount", title: "合同金额", width: 126, align: "right" },
  { colKey: "settledAmount", title: "已占用", width: 126, align: "right" },
  { colKey: "remainingAmount", title: "剩余", width: 126, align: "right" },
  { colKey: "statusText", title: "核对结果", minWidth: 180 }
];

export function toSettlementSourceLinePreviewRows(
  rows: readonly SettlementSourceLineReadModel[]
): SettlementSourceLinePreviewRow[] {
  return rows.map((row) => ({
    ...row,
    itemCode: row.itemCode ?? "-",
    contractAmount: `¥${centsTextToYuanText(row.contractAmountCents)}`,
    settledAmount: `¥${centsTextToYuanText(row.settledAmountCents)}`,
    remainingAmount: `¥${centsTextToYuanText(row.remainingAmountCents)}`,
    statusText: row.exception?.message ?? (row.provisional ? "暂估项，结算时需重点核对" : "可用")
  }));
}

export const settlementRules = [
  "只能从已生效合同版本创建结算",
  "结算单签字盖章并归档确认后才生效",
  "结算未生效前不可创建付款申请",
  "历史结算绑定当时的付款条款版本"
];

export function emptySettlementLedgerFilters(): SettlementLedgerFilters {
  return {
    project: "",
    contractNo: "",
    settlementStatus: "",
    archiveStatus: "",
    keyword: ""
  };
}

export function filterSettlementLedgerRows(
  rows: readonly SettlementLedgerRow[],
  filters: SettlementLedgerFilters
): SettlementLedgerRow[] {
  return rows.filter((row) => {
    const statusText = `${row.currentNode} ${row.nextAction} ${row.returnReason}`;
    const keywordText = [
      row.settlementNo,
      row.contractNo,
      row.project,
      row.period,
      row.currentNode,
      row.pendingOwner,
      row.nextAction
    ].join(" ");

    return (
      includesText(row.project, filters.project) &&
      includesText(row.contractNo, filters.contractNo) &&
      includesText(statusText, filters.settlementStatus) &&
      includesText(statusText, filters.archiveStatus) &&
      includesText(keywordText, filters.keyword)
    );
  });
}

function includesText(value: string, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }

  return value.toLocaleLowerCase().includes(normalized);
}
