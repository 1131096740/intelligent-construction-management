import type { ContractPaymentApplicationPreviewReadModel } from "@jiangkong/shared-domain";
import type { PrimaryTableCol } from "tdesign-vue-next";

export type PaymentTone = "default" | "primary" | "warning" | "danger" | "success";

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

export type PaymentCreateSourceType = "settlement" | "contract_due" | "contract_advance";

export interface PaymentCreateSourceOption {
  value: PaymentCreateSourceType;
  label: string;
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

export type PaymentApplicationPreviewSection =
  ContractPaymentApplicationPreviewReadModel["sections"][number];

export interface PaymentApplicationPreviewRow {
  id: string;
  source: string;
  currentSettlementAmount: string;
  cumulativeBeforeAmount: string;
  cumulativeAfterAmount: string;
  effectiveAt: string;
  expectedPayableAt: string;
  paymentRule: string;
  dueStatus: string;
  includableAmount: string;
  isDue: boolean;
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
    label: "付款来源",
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

export const paymentCreateSourceOptions: PaymentCreateSourceOption[] = [
  { value: "contract_due", label: "合同累计结算付款" },
  { value: "settlement", label: "单张结算付款" },
  { value: "contract_advance", label: "合同预付款" }
];

export const paymentLedgerColumns: PrimaryTableCol<PaymentLedgerRow>[] = [
  { colKey: "paymentNo", title: "付款编号", width: 104 },
  { colKey: "settlementNo", title: "付款来源", width: 104 },
  { colKey: "project", title: "项目", minWidth: 120 },
  { colKey: "requestedAmount", title: "申请金额", width: 96, align: "right" },
  { colKey: "approvalStatus", title: "审批状态", width: 96 },
  { colKey: "paymentStatus", title: "实付状态", width: 96 },
  { colKey: "currentNode", title: "当前节点", width: 112 },
  { colKey: "ownerDepartment", title: "责任部门", width: 88 },
  { colKey: "updatedAt", title: "更新时间", width: 96 },
  { colKey: "operation", title: "操作", width: 64, fixed: "right" }
];

export const paymentApplicationPreviewColumns: PrimaryTableCol<PaymentApplicationPreviewRow>[] = [
  { colKey: "source", title: "来源", width: 120 },
  { colKey: "currentSettlementAmount", title: "本期结算金额", width: 124, align: "right" },
  { colKey: "cumulativeBeforeAmount", title: "期前累计结算金额", width: 140, align: "right" },
  { colKey: "cumulativeAfterAmount", title: "期后累计结算金额", width: 140, align: "right" },
  { colKey: "effectiveAt", title: "生效日期", width: 108 },
  { colKey: "expectedPayableAt", title: "预计可付日", width: 108 },
  { colKey: "paymentRule", title: "付款规则", minWidth: 168 },
  { colKey: "dueStatus", title: "当前是否到账期", width: 124 },
  { colKey: "includableAmount", title: "本行可计入金额", width: 132, align: "right" }
];

export const paymentLedgerRows: PaymentLedgerRow[] = [];

export const paymentRules = [
  "普通付款按合同累计已生效结算发起，单张结算入口保留兼容",
  "所有付款审批需董事长/总经理二选一或签",
  "审批通过后进入已批待付，不代表已付款",
  "出纳/财务登记实付并上传付款凭证"
];

function formatPaymentCents(amountCents: number) {
  return `¥${(amountCents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPaymentDate(value: string | null, fallback: string) {
  return value ? value.slice(0, 10) : fallback;
}

export function toPaymentApplicationPreviewRows(
  section: PaymentApplicationPreviewSection
): PaymentApplicationPreviewRow[] {
  return section.rows.map((row) => ({
    id: row.id,
    source: row.source,
    currentSettlementAmount: formatPaymentCents(row.currentSettlementAmountCents),
    cumulativeBeforeAmount: formatPaymentCents(row.cumulativeBeforeAmountCents),
    cumulativeAfterAmount: formatPaymentCents(row.cumulativeAfterAmountCents),
    effectiveAt: formatPaymentDate(row.effectiveAt, "未生效"),
    expectedPayableAt: formatPaymentDate(row.expectedPayableAt, "待计算"),
    paymentRule: row.paymentRule,
    dueStatus: row.isDue ? "已到账期" : "未到账期",
    includableAmount: formatPaymentCents(row.includableAmountCents),
    isDue: row.isDue
  }));
}

export function paymentApplicationPreviewRowClassName(row: Pick<PaymentApplicationPreviewRow, "isDue">) {
  return row.isDue ? "" : "preview-row-not-due";
}

export function canShowContractPaymentApplicationPreview(
  sourceType: PaymentCreateSourceType,
  preview: ContractPaymentApplicationPreviewReadModel | null,
  previewContractVersionId: string,
  currentContractVersionId: string
) {
  return (
    sourceType === "contract_due" &&
    Boolean(preview) &&
    previewContractVersionId.trim() !== "" &&
    previewContractVersionId.trim() === currentContractVersionId.trim()
  );
}
