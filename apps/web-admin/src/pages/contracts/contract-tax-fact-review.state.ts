import {
  canPerform,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  normalizeTaxRatePercent,
  type ContractInvoiceType,
  type ContractTaxFactSource,
  type ContractTaxMode,
  type RoleKey
} from "@jiangkong/shared-domain";
import type {
  ContractTaxFactCurrentReadModel,
  ContractTaxFactCurrentRowReadModel,
  ContractTaxFactRevisionKind,
  ContractTaxFactRevisionListReadModel,
  ContractTaxFactRevisionReadModel,
  ContractTaxFactRevisionStatus,
  SaveContractTaxFactRevisionPayload
} from "../../api/contract-tax-facts.api";

const ACTIVE_STATUSES: ContractTaxFactRevisionStatus[] = [
  "draft",
  "pending_finance_review",
  "pending_contract_confirmation"
];

export interface ContractTaxFactDraft {
  kind: ContractTaxFactRevisionKind;
  invoiceType: ContractInvoiceType | "";
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string;
  source: ContractTaxFactSource | "";
  confirmationExplanation: string;
  evidenceFileId: string;
  correctionReason: string;
  rowFacts: Array<{
    contractBillRowId: string;
    taxInclusiveUnitPrice: string;
    taxRatePercentOverride: string;
  }>;
}

export interface ContractTaxFactTimelineItem {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  summary: string;
  comments: string[];
}

export function buildContractTaxFactReviewState(input: {
  data: ContractTaxFactRevisionListReadModel;
  missingFields: string[];
  userId: string;
  roleKeys: readonly RoleKey[];
}) {
  const activeRevision =
    input.data.revisions.find((revision) => ACTIVE_STATUSES.includes(revision.status)) ?? null;
  const canRead = HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS.some((role) =>
    input.roleKeys.includes(role)
  );
  const canSupplement = canPerform("contract.tax_fact.supplement", input.roleKeys);
  const canFinance = canPerform("contract.tax_fact.finance_review", input.roleKeys);
  const canConfirm = canPerform("contract.tax_fact.confirm", input.roleKeys);
  const missingFields = input.missingFields.filter((field) => field.trim());
  const factsConfirmed =
    input.data.current.status === "confirmed" && missingFields.length === 0;

  return {
    canRead,
    canGoContractChange: canPerform("contract.create", input.roleKeys),
    activeRevision,
    canCreate: canRead && canSupplement && !activeRevision,
    createKind:
      input.data.current.status === "confirmed"
        ? ("correction" as const)
        : ("supplement" as const),
    canEdit:
      canRead &&
      canSupplement &&
      activeRevision?.status === "draft" &&
      activeRevision.createdByUserId === input.userId,
    canSubmitFinance:
      canRead &&
      canSupplement &&
      activeRevision?.status === "draft" &&
      activeRevision.createdByUserId === input.userId,
    canFinanceReview:
      canRead && canFinance && activeRevision?.status === "pending_finance_review",
    canContractConfirm:
      canRead && canConfirm && activeRevision?.status === "pending_contract_confirmation",
    gapText: missingFields.length ? missingFields.join("、") : "无",
    settlementReleaseText: factsConfirmed
      ? "税务事实已经财务复核和合同部确认，且当前缺口为零，已解除税务事实阻断；结算仍需满足合同有效、清单计价和其他业务条件。"
      : "相关结算需等待本次税务事实完成财务复核、合同部确认并且缺口清零后，才能解除税务事实阻断。",
    agreementChangeText:
      "本流程只补录遗漏事实或纠正系统录入错误，不改变双方已经签署的约定。若发票类型、税率或价格约定发生变化，请前往合同变更。",
    timeline: input.data.revisions.map(toTimelineItem)
  };
}

export function createContractTaxFactDraft(
  current: ContractTaxFactCurrentReadModel,
  revision: ContractTaxFactRevisionReadModel | null,
  currentRows: ContractTaxFactCurrentRowReadModel[] = []
): ContractTaxFactDraft {
  const source = revision ?? current;
  const beforeSnapshot = revision?.beforeSnapshot ?? {};
  const revisionRowById = new Map(
    revision?.rowFacts.map((row) => [row.contractBillRowId, row]) ?? []
  );
  return {
    kind:
      revision?.kind ?? (current.status === "confirmed" ? "correction" : "supplement"),
    invoiceType: source.invoiceType ?? "",
    taxMode: source.taxMode ?? "single_rate",
    defaultTaxRatePercent: source.defaultTaxRatePercent ?? "",
    source: ("source" in source ? source.source : null) ?? "",
    confirmationExplanation:
      ("confirmationExplanation" in source ? source.confirmationExplanation : null) ?? "",
    evidenceFileId: ("evidenceFileId" in source ? source.evidenceFileId : null) ?? "",
    correctionReason:
      typeof beforeSnapshot["correctionReason"] === "string"
        ? beforeSnapshot["correctionReason"]
        : "",
    rowFacts: currentRows.length
      ? currentRows.map((row) => {
          const revised = revisionRowById.get(row.contractBillRowId);
          return {
            contractBillRowId: row.contractBillRowId,
            taxInclusiveUnitPrice:
              revised?.taxInclusiveUnitPrice ?? row.taxInclusiveUnitPrice ?? "",
            taxRatePercentOverride:
              revised?.taxRatePercentOverride ??
              (row.taxRateSource === "row_override" ? row.taxRatePercent ?? "" : "")
          };
        })
      : revision?.rowFacts.map((row) => ({
          contractBillRowId: row.contractBillRowId,
          taxInclusiveUnitPrice: row.taxInclusiveUnitPrice ?? "",
          taxRatePercentOverride: row.taxRatePercentOverride ?? ""
        })) ?? []
  };
}

export function normalizeContractTaxFactDraft(
  draft: ContractTaxFactDraft
): SaveContractTaxFactRevisionPayload {
  const defaultTaxRatePercent = optionalTaxRate(draft.defaultTaxRatePercent, "默认税率");
  const rowFacts = draft.rowFacts.map((row, index) => ({
    contractBillRowId: requiredText(row.contractBillRowId, `第 ${index + 1} 条清单行`),
    taxInclusiveUnitPrice: optionalTwoDecimal(
      row.taxInclusiveUnitPrice,
      `第 ${index + 1} 条含税单价`
    ),
    taxRatePercentOverride: optionalTaxRate(
      row.taxRatePercentOverride,
      `第 ${index + 1} 条例外税率`
    )
  }));

  return {
    kind: draft.kind,
    invoiceType: draft.invoiceType || undefined,
    taxMode: draft.taxMode,
    defaultTaxRatePercent,
    source: draft.source || undefined,
    confirmationExplanation: optionalText(draft.confirmationExplanation),
    evidenceFileId: optionalText(draft.evidenceFileId),
    correctionReason:
      draft.kind === "correction" ? optionalText(draft.correctionReason) : undefined,
    rowFacts
  };
}

export function taxFactSubmissionDisabledReason(draft: ContractTaxFactDraft): string {
  if (!draft.invoiceType) return "请选择发票类型";
  if (!draft.defaultTaxRatePercent.trim()) return "请填写默认税率";
  try {
    optionalTaxRate(draft.defaultTaxRatePercent, "默认税率");
  } catch (error) {
    return error instanceof Error ? error.message : "默认税率格式不正确";
  }
  if (!draft.source) return "请选择税务事实来源";
  if (!draft.evidenceFileId.trim() && !draft.confirmationExplanation.trim()) {
    return "未上传依据附件时，请填写税务事实确认说明";
  }
  if (draft.kind === "correction" && !draft.correctionReason.trim()) {
    return "纠正已确认事实时，请填写更正原因";
  }
  try {
    normalizeContractTaxFactDraft(draft);
  } catch (error) {
    return error instanceof Error ? error.message : "清单计价事实格式不正确";
  }
  return "";
}

export function revisionStatusLabel(status: ContractTaxFactRevisionStatus): string {
  const labels: Record<ContractTaxFactRevisionStatus, string> = {
    draft: "草稿",
    pending_finance_review: "待财务复核",
    pending_contract_confirmation: "待合同部确认",
    confirmed: "已确认",
    rejected: "已退回"
  };
  return labels[status];
}

function toTimelineItem(revision: ContractTaxFactRevisionReadModel): ContractTaxFactTimelineItem {
  const comments = [
    revision.financeReviewComment
      ? `财务意见：${revision.financeReviewComment}`
      : "",
    revision.contractReviewComment
      ? `合同部意见：${revision.contractReviewComment}`
      : ""
  ].filter(Boolean);
  return {
    id: revision.id,
    title: `第 ${revision.revisionNo} 次${
      revision.kind === "correction" ? "更正" : "补录"
    }`,
    status: revisionStatusLabel(revision.status),
    updatedAt: formatDateTime(revision.updatedAt),
    summary: [
      revision.invoiceType ? `发票类型：${invoiceTypeLabel(revision.invoiceType)}` : "发票类型：—",
      `默认税率：${
        revision.defaultTaxRatePercent ? `${revision.defaultTaxRatePercent}%` : "—"
      }`,
      `清单价格事实：${revision.rowFacts.length} 条`
    ].join("；"),
    comments
  };
}

function invoiceTypeLabel(value: ContractInvoiceType) {
  return value === "vat_special" ? "增值税专用发票" : "增值税普通发票";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function optionalTaxRate(value: string, label: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  try {
    return normalizeTaxRatePercent(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : "税率格式不正确";
    throw new Error(message.replace(/^税率/u, label));
  }
}

function optionalTwoDecimal(value: string, label: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(normalized)) {
    throw new Error(`${label}必须是非负数字且最多保留 2 位小数`);
  }
  return normalized;
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请选择${label}`);
  return normalized;
}

function optionalText(value: string) {
  return value.trim() || undefined;
}
