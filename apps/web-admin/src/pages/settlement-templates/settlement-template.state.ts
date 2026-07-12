import type {
  SettlementTemplateRecommendationReadModel,
  SettlementTemplateVersionReadModel,
  SettlementTemplateVersionStatus
} from "../../api/settlement-template.api";
import {
  billAmountRoleOptions,
  contractTypeOptions,
  pricingModeOptions
} from "../contract-templates/contract-template.config";

export const settlementTemplateContractTypeOptions = contractTypeOptions;
export const settlementTemplateAmountRoleOptions = billAmountRoleOptions;
export const settlementTemplatePricingModeOptions = pricingModeOptions;

export const settlementTemplateFixedRules = {
  columnSchema: { sheetName: "本期结算明细" },
  printRules: { requirePrintArea: true },
  evidenceRules: { requiredColumns: ["证据说明"] },
  anomalyRules: { rejectNegativeOrdinaryRows: true }
} as const;

const statusLabels: Record<SettlementTemplateVersionStatus, string> = {
  draft: "草稿",
  submitted: "待发布",
  published: "已发布",
  stopped: "已停用"
};

export function settlementTemplateStatusLabel(status: SettlementTemplateVersionStatus) {
  return statusLabels[status];
}

export function settlementTemplateGovernance(version?: SettlementTemplateVersionReadModel) {
  const inspectionCurrent = Boolean(
    version?.inspectionReport &&
      version.inspectionRevision === version.draftRevision &&
      version.inspectionReport.blockingErrors.length === 0
  );
  const previewCurrent = Boolean(
    version?.latestPreview?.status === "succeeded" &&
      version.latestPreview.sourceRevision === version.draftRevision &&
      version.latestPreview.hasPreviewXlsx &&
      version.latestPreview.hasPreviewPdf
  );
  return {
    canSave: version?.status === "draft",
    canInspect: version?.status === "draft",
    canPreview: version?.status === "draft" && inspectionCurrent,
    canSubmit: version?.status === "draft" && inspectionCurrent && previewCurrent,
    canPublish: version?.status === "submitted" && inspectionCurrent && previewCurrent,
    canStop: version?.status === "published",
    canClone: version?.status === "published" || version?.status === "stopped",
    inspectionCurrent,
    previewCurrent
  };
}

export interface SettlementTemplateSelectionState {
  mode: "idle" | "loading" | "blocked" | "automatic" | "choice_required";
  choices: SettlementTemplateRecommendationReadModel["choices"];
  selectedVersionId: string;
  message: string;
}

export function emptySettlementTemplateSelection(): SettlementTemplateSelectionState {
  return { mode: "idle", choices: [], selectedVersionId: "", message: "请先选择有效合同。" };
}

export function resolveSettlementTemplateRecommendation(
  response: unknown
): SettlementTemplateSelectionState {
  if (!isRecommendationRecord(response) || !Array.isArray(response.choices)) {
    return malformedSettlementTemplateSelection();
  }
  const choices = response.choices;
  if (!choices.every(isRecommendationChoice)) {
    return malformedSettlementTemplateSelection();
  }
  const versionIds = choices.map((choice) => choice.templateVersionId);
  if (new Set(versionIds).size !== versionIds.length) {
    return malformedSettlementTemplateSelection();
  }
  if (choices.length === 0) {
    return blockedSettlementTemplateSelection(
      "当前合同没有可用的已发布结算模板，请联系合同主管配置并发布。"
    );
  }
  if (choices.length === 1) {
    if (
      response.selectionMode !== "automatic" ||
      !isRecommendationChoice(response.selected) ||
      response.selected.templateVersionId !== choices[0].templateVersionId
    ) {
      return malformedSettlementTemplateSelection();
    }
    const selected = choices[0];
    return {
      mode: "automatic",
      choices,
      selectedVersionId: selected.templateVersionId,
      message: `已自动匹配“${selected.templateName}”V${selected.versionNo}。`
    };
  }
  if (response.selectionMode !== "choice_required" || response.selected !== null) {
    return malformedSettlementTemplateSelection();
  }
  return {
    mode: "choice_required",
    choices,
    selectedVersionId: "",
    message: "当前合同有多个兼容模板，请明确选择。"
  };
}

export function blockedSettlementTemplateSelection(message: string): SettlementTemplateSelectionState {
  return { mode: "blocked", choices: [], selectedVersionId: "", message };
}

function malformedSettlementTemplateSelection() {
  return blockedSettlementTemplateSelection(
    "结算模板匹配结果异常，请重新选择有效合同。"
  );
}

function isRecommendationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecommendationChoice(
  value: unknown
): value is SettlementTemplateRecommendationReadModel["choices"][number] {
  if (!isRecommendationRecord(value)) return false;
  return (
    typeof value.templateVersionId === "string" &&
    Boolean(value.templateVersionId.trim()) &&
    value.templateVersionId === value.templateVersionId.trim() &&
    typeof value.templateName === "string" &&
    Boolean(value.templateName.trim()) &&
    typeof value.templateCode === "string" &&
    Boolean(value.templateCode.trim()) &&
    typeof value.versionNo === "number" &&
    Number.isInteger(value.versionNo) &&
    value.versionNo > 0 &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string" && Boolean(reason.trim()))
  );
}

export function canApplySettlementTemplateRecommendation(
  requestId: number,
  currentRequestId: number,
  requestedProjectId: string,
  currentProjectId: string,
  requestedContractVersionId: string,
  currentContractVersionId: string
) {
  return (
    requestId === currentRequestId &&
    requestedProjectId === currentProjectId &&
    requestedContractVersionId === currentContractVersionId
  );
}
