import type {
  ContractPaymentApplicationPreviewReadModel,
  ContractPaymentStageOptionReadModel
} from "@jiangkong/shared-domain";
import type { PrimaryTableCol } from "tdesign-vue-next";
import { centsTextToYuanText } from "../../lib/money";

export type PaymentTone = "default" | "primary" | "warning" | "danger" | "success";

export interface PaymentLedgerFilters {
  projectId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  keyword: string;
}

export type PaymentFilterKey = keyof PaymentLedgerFilters;

export interface PaymentFilterField {
  key: PaymentFilterKey;
  label: string;
  placeholder: string;
  type: "select" | "keyword" | "date";
}

export interface PaymentSummaryItem {
  label: string;
  value: string;
  tone: PaymentTone;
}

export interface GenericDirectCapacityItem {
  label: string;
  value: string;
}

export type PaymentCreateSourceType = "settlement" | "signed_settlement" | "contract_due" | "contract_advance";

export interface PaymentCreateSourceOption {
  value: PaymentCreateSourceType;
  label: string;
}

export interface PaymentLedgerRow {
  contractRelationshipLabel?: string;
  projectId?: string;
  signingParty?: string;
  counterparty?: string;
  id: string;
  paymentNo: string;
  contractNo: string;
  settlementNo: string;
  project: string;
  requestedAmount: string;
  approvalStatus: string;
  approvalTone: PaymentTone;
  paymentStatus: string;
  paymentTone: PaymentTone;
  currentNode: string;
  ownerDepartment: string;
  pendingOwner: string;
  stalledFor: string;
  returnReason: string;
  nextAction: string;
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
  invoiceRequirement: string;
  dueStatus: string;
  includableAmount: string;
  isDue: boolean;
}

export type PaymentCapacityExplanationOperator =
  ContractPaymentApplicationPreviewReadModel["capacityExplanation"][number]["operator"];

export interface PaymentCapacityExplanationItem {
  label: string;
  value: string;
  operator: PaymentCapacityExplanationOperator;
  note: string;
  tone: PaymentTone;
}

export const paymentFilterFields: PaymentFilterField[] = [
  {
    key: "projectId",
    label: "项目",
    placeholder: "全部项目",
    type: "select"
  },
  {
    key: "dateFrom",
    label: "开始日期",
    placeholder: "不限",
    type: "date"
  },
  {
    key: "dateTo",
    label: "结束日期",
    placeholder: "不限",
    type: "date"
  },
  {
    key: "status",
    label: "审批/实付状态",
    placeholder: "全部状态",
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
  { label: "正式申请金额", value: "0", tone: "default" },
  { label: "已实付金额", value: "0", tone: "success" },
  { label: "待审批", value: "0", tone: "warning" },
  { label: "已批待付", value: "0", tone: "warning" },
  { label: "已实付", value: "0", tone: "success" }
];

export const paymentCreateSourceOptions: PaymentCreateSourceOption[] = [
  { value: "contract_due", label: "合同累计结算付款" },
  { value: "settlement", label: "单张结算付款" },
  { value: "signed_settlement", label: "已签结算最近确认一期" },
  { value: "contract_advance", label: "合同预付款" }
];

export const paymentLedgerColumns: PrimaryTableCol<PaymentLedgerRow>[] = [
  { colKey: "contractRelationshipLabel", title: "合同分类", minWidth: 180 },
  { colKey: "paymentNo", title: "付款编号", width: 104 },
  { colKey: "contractNo", title: "关联合同", minWidth: 168 },
  { colKey: "settlementNo", title: "付款来源", width: 104 },
  { colKey: "project", title: "项目", minWidth: 120 },
  { colKey: "requestedAmount", title: "申请金额", width: 96, align: "right" },
  { colKey: "approvalStatus", title: "审批状态", width: 96 },
  { colKey: "paymentStatus", title: "实付状态", width: 96 },
  { colKey: "currentNode", title: "当前节点", width: 112 },
  { colKey: "pendingOwner", title: "当前处理人", width: 104 },
  { colKey: "stalledFor", title: "停留时长", width: 88 },
  { colKey: "returnReason", title: "退回原因", minWidth: 136 },
  { colKey: "nextAction", title: "下一步动作", width: 112 },
  { colKey: "updatedAt", title: "更新时间", width: 96 },
  { colKey: "operation", title: "操作", width: 128, fixed: "right" }
];

export const paymentApplicationPreviewColumns: PrimaryTableCol<PaymentApplicationPreviewRow>[] = [
  { colKey: "source", title: "来源", width: 120 },
  { colKey: "currentSettlementAmount", title: "本期结算金额", width: 124, align: "right" },
  { colKey: "cumulativeBeforeAmount", title: "期前累计结算金额", width: 140, align: "right" },
  { colKey: "cumulativeAfterAmount", title: "期后累计结算金额", width: 140, align: "right" },
  { colKey: "effectiveAt", title: "生效日期", width: 108 },
  { colKey: "expectedPayableAt", title: "预计可付日", width: 108 },
  { colKey: "paymentRule", title: "付款规则", minWidth: 168 },
  { colKey: "invoiceRequirement", title: "发票要求", width: 112 },
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

export const paymentPaginationBlockReason =
  "当前页由服务端按权限范围分页返回；上方视图数量与统计覆盖当前账号可见的全部记录。";

/** 服务端筛选的项目选项来自台账返回行；状态合并审批与实付标签。 */
export function paymentLedgerFilterOptions(rows: readonly PaymentLedgerRow[]) {
  return {
    projectId: ledgerSelectOptions(
      rows.map((row) => row.projectId ?? ""),
      "全部项目"
    ),
    status: ledgerSelectOptions(
      [...rows.map((row) => row.approvalStatus), ...rows.map((row) => row.paymentStatus)],
      "全部状态"
    )
  };
}

export function emptyPaymentLedgerFilters(): PaymentLedgerFilters {
  return {
    projectId: "",
    dateFrom: "",
    dateTo: "",
    status: "",
    keyword: ""
  };
}

/** 兼容旧单测的纯函数；页面筛选以服务端为准，不在此扩大可见范围。 */
export function filterPaymentLedgerRows(
  rows: readonly PaymentLedgerRow[],
  filters: PaymentLedgerFilters
): PaymentLedgerRow[] {
  return rows.filter((row) => {
    const keywordText = [
      row.paymentNo,
      row.contractNo,
      row.settlementNo,
      row.project,
      row.approvalStatus,
      row.paymentStatus,
      row.currentNode,
      row.pendingOwner,
      row.nextAction
    ].join(" ");

    return (
      (!filters.projectId || (row.projectId ?? "") === filters.projectId) &&
      includesText(`${row.approvalStatus} ${row.paymentStatus}`, filters.status) &&
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

function ledgerSelectOptions(values: readonly string[], allLabel: string) {
  const unique = [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );
  return [{ label: allLabel, value: "" }, ...unique.map((value) => ({ label: value, value }))];
}

function formatPaymentCents(amountCents: string | null) {
  return amountCents === null ? "无法计算余额" : `¥${centsTextToYuanText(amountCents)}`;
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
    invoiceRequirement: row.invoiceRequirement,
    dueStatus: row.isDue ? "已到账期" : "未到账期",
    includableAmount: formatPaymentCents(row.includableAmountCents),
    isDue: row.isDue
  }));
}

export function toPaymentCapacityExplanationItems(
  preview: ContractPaymentApplicationPreviewReadModel
): PaymentCapacityExplanationItem[] {
  return preview.capacityExplanation.map((item) => ({
    label: item.label,
    value: formatCapacityExplanationAmount(item.amountCents, item.operator),
    operator: item.operator,
    note: item.note ?? "",
    tone: item.tone ?? "default"
  }));
}

export function toGenericDirectCapacityItems(
  preview: ContractPaymentApplicationPreviewReadModel,
  stage: ContractPaymentStageOptionReadModel | null
): GenericDirectCapacityItem[] {
  const stageMissing = "请选择付款阶段";
  return [
    {
      label: "合同金额",
      value: formatPaymentCents(preview.genericContractCapacity.contractAmountCents)
    },
    {
      label: "合同累计占用",
      value: formatPaymentCents(preview.genericContractCapacity.contractOccupiedCents)
    },
    {
      label: "合同剩余额度",
      value: formatPaymentCents(preview.genericContractCapacity.contractRemainingCents)
    },
    {
      label: "阶段约定额度",
      value: stage ? formatPaymentCents(stage.payableCents) : stageMissing
    },
    {
      label: "本阶段已占用",
      value: stage ? formatPaymentCents(stage.occupiedCents) : stageMissing
    },
    {
      label: "本次最多可申请",
      value: stage ? formatPaymentCents(stage.maxRequestableCents) : stageMissing
    }
  ];
}

export function paymentApplicationPreviewRowClassName(row: Pick<PaymentApplicationPreviewRow, "isDue">) {
  return row.isDue ? "" : "preview-row-not-due";
}

function formatCapacityExplanationAmount(
  amountCents: string,
  operator: PaymentCapacityExplanationOperator
) {
  const amount = formatPaymentCents(amountCents);
  if (operator === "subtract") {
    return `-${amount}`;
  }
  if (operator === "result") {
    return `=${amount}`;
  }

  return `+${amount}`;
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
