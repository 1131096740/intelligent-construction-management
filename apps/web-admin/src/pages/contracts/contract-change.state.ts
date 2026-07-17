import type { RoleKey } from "@jiangkong/shared-domain";
import { roleLabels } from "../settings/approval-flow-readonly.config";

export const CONTRACT_NAME_DRAFT_KEY = "contractName";
export const POSTGRES_BIGINT_MAX_TEXT = "9223372036854775807";

const CHANGE_TYPES = new Set(["original", "historical_takeover", "change", "supplement"]);
const CHANGE_DIRECTIONS = new Set(["increase", "decrease", "unchanged"]);
const AMOUNT_LIMIT_TYPES = new Set(["capped", "unlimited"]);
const CONTRACT_VERSION_STATUSES = new Set([
  "draft", "in_approval", "approval_rejected", "approved_pending_seal", "in_seal",
  "seal_approved_pending_archive", "pending_archive_confirm", "effective", "superseded", "voided"
]);
const ENHANCED_REASONS = new Set([
  "unlimited_amount_change",
  "cumulative_change_strictly_over_ten_percent"
]);
const KNOWN_ROUTE_KEYS = new Set([...Object.keys(roleLabels), "chairman_or_general_manager"]);
const APPROVAL_ROUTE_LABELS = new Set([
  "合同变更",
  "合同变更（历史）",
  "增强合同变更（历史）",
  "历史路线未冻结",
  "原合同"
]);

type ContractApprovalRouteLabel =
  | "合同变更"
  | "合同变更（历史）"
  | "增强合同变更（历史）"
  | "历史路线未冻结"
  | "原合同";

export interface NormalizedChangeVersion {
  id: string;
  contractId: string;
  versionNo: number;
  changeType: string;
  status: string;
  amountCents: string;
  baseVersionId: string | null;
  supersedesVersionId: string | null;
  changeReason: string | null;
  changeDirection: string | null;
  changeAmountCents: string | null;
  originalBaseAmountCents: string | null;
  cumulativeIncreaseCents: string;
  cumulativeDecreaseCents: string;
  amountLimitType: "capped" | "unlimited";
  enhancedApproval: boolean;
  enhancedApprovalReasons: string[];
  approvalRoute: Array<{ name: string; mode: "any"; roleKeys: string[] }>;
  approvalRouteLabel: ContractApprovalRouteLabel | null;
}

export interface NormalizedChangeEligibility {
  eligible: boolean;
  reason: string | null;
  currentEffective: NormalizedChangeVersion | null;
  activeChange: NormalizedChangeVersion | null;
}

export interface NormalizedArchiveEffect {
  status: "pending" | "completed";
  replacesVersionNo: number;
  beforeAmountCents: string;
  afterAmountCents: string;
  historyReferencesStable: true;
}

export interface NormalizedContractChangeVersion {
  versionNo: number;
  status: string;
  changeType: string;
  changeReason: string | null;
  changeDirection: string | null;
  changeAmountCents: string | null;
  amountCents: string;
  approvalRoute: string[];
  approvalRouteLabel: string | null;
  archiveEffect: NormalizedArchiveEffect | null;
}

export interface NormalizedWorkbenchChange {
  isChange: true;
  baseVersion: { id: string; versionNo: number; status: "effective"; amountCents: string };
  changeType: "change" | "supplement";
  changeReason: string;
  changeDirection: "increase" | "decrease" | "unchanged";
  changeAmountCents: string;
  originalBaseAmountCents: string;
  cumulativeIncreaseCents: string;
  cumulativeDecreaseCents: string;
  amountLimitType: "capped" | "unlimited";
  enhancedApproval: boolean;
  enhancedApprovalReasons: string[];
  approvalRoute: string[];
  approvalRouteLabel: ContractApprovalRouteLabel | null;
  changePolicy: {
    version: 1;
    editableFieldKeys: string[];
    editableClauseKeys: string[];
    coreClauseKeys: string[];
  };
}

export interface ContractChangePolicyView {
  valid: boolean;
  isChange: boolean;
  editableFieldKeys: string[];
  editableClauseKeys: string[];
  coreClauseKeys: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim() === value && value.length > 0 ? value : null;
}

function nullableId(value: unknown): string | null | undefined {
  return value === null ? null : id(value) ?? undefined;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function isPostgresBigIntText(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return false;
  return value.length < POSTGRES_BIGINT_MAX_TEXT.length ||
    (value.length === POSTGRES_BIGINT_MAX_TEXT.length && value <= POSTGRES_BIGINT_MAX_TEXT);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => id(item) !== null)
    ? [...new Set(value as string[])]
    : null;
}

function routeKeys(value: unknown): string[] | null {
  const keys = stringArray(value);
  return keys && keys.length > 0 && keys.every((key) => KNOWN_ROUTE_KEYS.has(key)) ? keys : null;
}

function reasons(value: unknown): string[] | null {
  const values = stringArray(value);
  return values && values.every((reason) => ENHANCED_REASONS.has(reason)) ? values : null;
}

function normalizeApprovalNodes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const nodes = value.map((item) => {
    const node = record(item);
    const roleKeys = routeKeys(node?.["roleKeys"]);
    return node && id(node["name"]) && node["mode"] === "any" && roleKeys
      ? { name: node["name"] as string, mode: "any" as const, roleKeys }
      : null;
  });
  return nodes.every((node) => node !== null) ? nodes as Array<NonNullable<(typeof nodes)[number]>> : null;
}

function approvalRouteLabel(value: unknown): ContractApprovalRouteLabel | null | undefined {
  if (value === undefined) return null;
  return typeof value === "string" && APPROVAL_ROUTE_LABELS.has(value)
    ? value as ContractApprovalRouteLabel
    : undefined;
}

function validRouteLabelForChangeType(
  changeType: unknown,
  label: ContractApprovalRouteLabel | null,
  hasFrozenRoute: boolean
) {
  if (label === null) return hasFrozenRoute;
  if (changeType === "change") {
    return (hasFrozenRoute && (label === "合同变更" || label === "合同变更（历史）" ||
      label === "增强合同变更（历史）")) || (!hasFrozenRoute && label === "历史路线未冻结");
  }
  if (changeType === "supplement") {
    return (hasFrozenRoute && (label === "合同变更（历史）" ||
      label === "增强合同变更（历史）")) || (!hasFrozenRoute && label === "历史路线未冻结");
  }
  return hasFrozenRoute && label === "原合同";
}

export function normalizeChangeVersion(value: unknown): NormalizedChangeVersion | null {
  const source = record(value);
  if (!source) return null;
  const versionId = id(source["id"]);
  const contractId = id(source["contractId"]);
  const versionNo = integer(source["versionNo"]);
  const changeType = source["changeType"];
  const status = source["status"];
  const baseVersionId = nullableId(source["baseVersionId"]);
  const supersedesVersionId = nullableId(source["supersedesVersionId"]);
  const changeReason = source["changeReason"] === null ? null : id(source["changeReason"]);
  const changeDirection = source["changeDirection"] === null ? null : source["changeDirection"];
  const changeAmountCents = source["changeAmountCents"] === null ? null : source["changeAmountCents"];
  const originalBaseAmountCents = source["originalBaseAmountCents"] === null ? null : source["originalBaseAmountCents"];
  const amountLimitType = source["amountLimitType"];
  const rawApprovalRoute = source["approvalRoute"];
  const approvalRoute = Array.isArray(rawApprovalRoute) && rawApprovalRoute.length === 0
    ? []
    : normalizeApprovalNodes(rawApprovalRoute);
  const normalizedApprovalRouteLabel = approvalRouteLabel(source["approvalRouteLabel"]);
  const enhancedReasons = reasons(source["enhancedApprovalReasons"]);
  if (
    !versionId || !contractId || !versionNo || !CHANGE_TYPES.has(String(changeType)) ||
    !CONTRACT_VERSION_STATUSES.has(String(status)) || baseVersionId === undefined ||
    supersedesVersionId === undefined || changeReason === undefined ||
    !(changeDirection === null || CHANGE_DIRECTIONS.has(String(changeDirection))) ||
    !(changeAmountCents === null || isPostgresBigIntText(changeAmountCents)) ||
    !(originalBaseAmountCents === null || isPostgresBigIntText(originalBaseAmountCents)) ||
    !isPostgresBigIntText(source["amountCents"]) ||
    !isPostgresBigIntText(source["cumulativeIncreaseCents"]) ||
    !isPostgresBigIntText(source["cumulativeDecreaseCents"]) ||
    !AMOUNT_LIMIT_TYPES.has(String(amountLimitType)) || typeof source["enhancedApproval"] !== "boolean" ||
    !enhancedReasons || !approvalRoute || normalizedApprovalRouteLabel === undefined ||
    !validRouteLabelForChangeType(changeType, normalizedApprovalRouteLabel, approvalRoute.length > 0)
  ) return null;
  const isChange = changeType === "change" || changeType === "supplement";
  if (isChange !== Boolean(baseVersionId && changeReason && changeDirection !== null && changeAmountCents !== null && originalBaseAmountCents !== null)) {
    return null;
  }
  if (!isChange && (baseVersionId !== null || changeReason !== null || changeDirection !== null || changeAmountCents !== null)) {
    return null;
  }
  if (isChange && ((changeDirection === "unchanged") !== (changeAmountCents === "0"))) return null;
  return {
    id: versionId,
    contractId,
    versionNo,
    changeType: String(changeType),
    status: String(status),
    amountCents: source["amountCents"],
    baseVersionId,
    supersedesVersionId,
    changeReason,
    changeDirection: changeDirection === null ? null : String(changeDirection),
    changeAmountCents,
    originalBaseAmountCents,
    cumulativeIncreaseCents: source["cumulativeIncreaseCents"],
    cumulativeDecreaseCents: source["cumulativeDecreaseCents"],
    amountLimitType: amountLimitType as "capped" | "unlimited",
    enhancedApproval: source["enhancedApproval"],
    enhancedApprovalReasons: enhancedReasons,
    approvalRoute,
    approvalRouteLabel: normalizedApprovalRouteLabel
  };
}

export function normalizeChangeEligibility(
  value: unknown,
  requestedVersionId: string
): NormalizedChangeEligibility | null {
  const source = record(value);
  if (!source || typeof source["eligible"] !== "boolean") return null;
  const current = source["currentEffective"] === null ? null : normalizeChangeVersion(source["currentEffective"]);
  const active = source["activeChange"] === null ? null : normalizeChangeVersion(source["activeChange"]);
  const reason = source["reason"] === null ? null : id(source["reason"]);
  if (current === null && source["currentEffective"] !== null) return null;
  if (active === null && source["activeChange"] !== null) return null;
  if (reason === undefined || (current && current.status !== "effective")) return null;
  if (source["eligible"] && (!current || current.id !== requestedVersionId || active || reason !== null)) return null;
  if (current && active && current.contractId !== active.contractId) return null;
  return { eligible: source["eligible"], reason, currentEffective: current, activeChange: active };
}

function normalizeArchiveEffect(value: unknown): NormalizedArchiveEffect | null {
  const source = record(value);
  if (!source || (source["status"] !== "pending" && source["status"] !== "completed") ||
    !integer(source["replacesVersionNo"]) || !isPostgresBigIntText(source["beforeAmountCents"]) ||
    !isPostgresBigIntText(source["afterAmountCents"]) || source["historyReferencesStable"] !== true) return null;
  return {
    status: source["status"],
    replacesVersionNo: source["replacesVersionNo"] as number,
    beforeAmountCents: source["beforeAmountCents"],
    afterAmountCents: source["afterAmountCents"],
    historyReferencesStable: true
  };
}

export function normalizeContractChangeVersions(value: unknown): NormalizedContractChangeVersion[] | null {
  if (!Array.isArray(value)) return null;
  const versions = value.map((item) => {
    const source = record(item);
    if (!source) return null;
    const versionNo = integer(source["versionNo"]);
    const status = source["status"];
    const changeType = source["changeType"];
    const changeReason = source["changeReason"] === null ? null : id(source["changeReason"]);
    const changeDirection = source["changeDirection"] === null ? null : source["changeDirection"];
    const changeAmountCents = source["changeAmountCents"] === null ? null : source["changeAmountCents"];
    const rawApprovalRoute = source["approvalRoute"];
    const approvalRoute = Array.isArray(rawApprovalRoute) && rawApprovalRoute.length === 0
      ? []
      : routeKeys(rawApprovalRoute);
    const normalizedApprovalRouteLabel = approvalRouteLabel(source["approvalRouteLabel"]);
    const archiveEffect = source["archiveEffect"] === null ? null : normalizeArchiveEffect(source["archiveEffect"]);
    if (!versionNo || !CONTRACT_VERSION_STATUSES.has(String(status)) ||
      !CHANGE_TYPES.has(String(changeType)) || changeReason === undefined ||
      !(changeDirection === null || CHANGE_DIRECTIONS.has(String(changeDirection))) ||
      !(changeAmountCents === null || isPostgresBigIntText(changeAmountCents)) ||
      !isPostgresBigIntText(source["amountCents"]) || !approvalRoute || normalizedApprovalRouteLabel === undefined ||
      !validRouteLabelForChangeType(changeType, normalizedApprovalRouteLabel, approvalRoute.length > 0) ||
      (source["archiveEffect"] !== null && !archiveEffect)) return null;
    return { versionNo, status: String(status), changeType: String(changeType), changeReason,
      changeDirection: changeDirection === null ? null : String(changeDirection), changeAmountCents,
      amountCents: source["amountCents"], approvalRoute,
      approvalRouteLabel: normalizedApprovalRouteLabel, archiveEffect };
  });
  if (versions.some((version) => version === null)) return null;
  const normalized = versions as Array<NonNullable<(typeof versions)[number]>>;
  const versionNos = new Set(normalized.map((version) => version.versionNo));
  const amountByVersionNo = new Map(normalized.map((version) => [version.versionNo, version.amountCents]));
  if (versionNos.size !== normalized.length ||
    normalized.some((version, index) => index > 0 && normalized[index - 1]!.versionNo <= version.versionNo) ||
    normalized.some((version) => {
      const isChange = version.changeType === "change" || version.changeType === "supplement";
      if (isChange !== Boolean(version.changeReason && version.changeDirection !== null && version.changeAmountCents !== null)) return true;
      if (!isChange && (version.changeReason !== null || version.changeDirection !== null || version.changeAmountCents !== null || version.archiveEffect !== null)) return true;
      if (isChange && ((version.changeDirection === "unchanged") !== (version.changeAmountCents === "0"))) return true;
      if (!version.archiveEffect) return false;
      const effect = version.archiveEffect;
      return effect.replacesVersionNo >= version.versionNo || !versionNos.has(effect.replacesVersionNo) ||
        effect.beforeAmountCents !== amountByVersionNo.get(effect.replacesVersionNo) ||
        effect.afterAmountCents !== version.amountCents ||
        (effect.status === "pending" && version.status !== "pending_archive_confirm") ||
        (effect.status === "completed" && version.status !== "effective" && version.status !== "superseded");
    })) return null;
  return normalized;
}

export function normalizeWorkbenchChange(workbench: unknown): NormalizedWorkbenchChange | null {
  const source = record(workbench);
  const contract = record(source?.["contract"]);
  const version = record(source?.["version"]);
  const template = record(version?.["templateSnapshot"]);
  if (!source || !contract || !version || !template ||
    (version["changeType"] !== "change" && version["changeType"] !== "supplement")) return null;
  const change = record(source["change"]);
  const base = record(change?.["baseVersion"]);
  const policy = record(change?.["changePolicy"]);
  const editableFieldKeys = stringArray(policy?.["editableFieldKeys"]);
  const editableClauseKeys = stringArray(policy?.["editableClauseKeys"]);
  const coreClauseKeys = stringArray(policy?.["coreClauseKeys"]);
  const rawApprovalRoute = change?.["approvalRoute"];
  const approvalRoute = Array.isArray(rawApprovalRoute) && rawApprovalRoute.length === 0
    ? []
    : routeKeys(rawApprovalRoute);
  const normalizedApprovalRouteLabel = approvalRouteLabel(change?.["approvalRouteLabel"]);
  const enhancedReasons = reasons(change?.["enhancedApprovalReasons"]);
  const fieldSchema = Array.isArray(template["fieldSchema"]) ? template["fieldSchema"].map((item) => id(record(item)?.["key"])) : null;
  const clauseSchema = Array.isArray(template["clauseSchema"]) ? template["clauseSchema"].map((item) => id(record(item)?.["key"])) : null;
  if (!change || change["isChange"] !== true || !id(contract["id"]) ||
    id(version["contractId"]) !== contract["id"] || id(version["baseVersionId"]) !== base?.["id"] ||
    !isPostgresBigIntText(version["amountCents"]) || !base || !id(base["id"]) || !integer(base["versionNo"]) ||
    base["status"] !== "effective" || !isPostgresBigIntText(base["amountCents"]) ||
    change["changeType"] !== version["changeType"] || !id(change["changeReason"]) ||
    !CHANGE_DIRECTIONS.has(String(change["changeDirection"])) || !isPostgresBigIntText(change["changeAmountCents"]) ||
    !isPostgresBigIntText(change["originalBaseAmountCents"]) ||
    !isPostgresBigIntText(change["cumulativeIncreaseCents"]) || !isPostgresBigIntText(change["cumulativeDecreaseCents"]) ||
    !AMOUNT_LIMIT_TYPES.has(String(change["amountLimitType"])) || typeof change["enhancedApproval"] !== "boolean" ||
    !enhancedReasons || !approvalRoute || normalizedApprovalRouteLabel === undefined ||
    !validRouteLabelForChangeType(version["changeType"], normalizedApprovalRouteLabel, approvalRoute.length > 0) ||
    policy?.["version"] !== 1 || !editableFieldKeys || !editableClauseKeys ||
    !coreClauseKeys || editableClauseKeys.some((key) => coreClauseKeys.includes(key)) || !fieldSchema || !clauseSchema ||
    fieldSchema.some((key) => key === null) || clauseSchema.some((key) => key === null) ||
    editableFieldKeys.some((key) => !fieldSchema.includes(key)) ||
    [...editableClauseKeys, ...coreClauseKeys].some((key) => !clauseSchema.includes(key))) return null;
  if ((change["changeDirection"] === "unchanged") !== (change["changeAmountCents"] === "0")) return null;
  return {
    isChange: true,
    baseVersion: { id: base["id"] as string, versionNo: base["versionNo"] as number, status: "effective", amountCents: base["amountCents"] },
    changeType: change["changeType"] as "change" | "supplement",
    changeReason: change["changeReason"] as string,
    changeDirection: change["changeDirection"] as "increase" | "decrease" | "unchanged",
    changeAmountCents: change["changeAmountCents"],
    originalBaseAmountCents: change["originalBaseAmountCents"],
    cumulativeIncreaseCents: change["cumulativeIncreaseCents"],
    cumulativeDecreaseCents: change["cumulativeDecreaseCents"],
    amountLimitType: change["amountLimitType"] as "capped" | "unlimited",
    enhancedApproval: change["enhancedApproval"], enhancedApprovalReasons: enhancedReasons, approvalRoute,
    approvalRouteLabel: normalizedApprovalRouteLabel,
    changePolicy: { version: 1, editableFieldKeys, editableClauseKeys, coreClauseKeys }
  };
}

export function contractChangePolicyView(workbench: unknown): ContractChangePolicyView {
  const source = record(workbench);
  const version = record(source?.["version"]);
  if (!source || !version) {
    return { valid: false, isChange: false, editableFieldKeys: [], editableClauseKeys: [], coreClauseKeys: [] };
  }
  const type = version?.["changeType"];
  if (type === "original" || type === "historical_takeover") {
    return { valid: true, isChange: false, editableFieldKeys: [], editableClauseKeys: [], coreClauseKeys: [] };
  }
  const normalized = normalizeWorkbenchChange(workbench);
  return normalized
    ? { valid: true, isChange: true, ...normalized.changePolicy }
    : { valid: false, isChange: true, editableFieldKeys: [], editableClauseKeys: [], coreClauseKeys: [] };
}

export function canApplyExpectedWorkbenchVersion(expectedVersionId: string, receivedVersionId: unknown) {
  return !expectedVersionId || receivedVersionId === expectedVersionId;
}

export function isCurrentChangeSubmission(
  capturedToken: number,
  currentToken: number,
  capturedRouteContractId: string,
  currentRouteContractId: string
) {
  return capturedToken === currentToken && capturedRouteContractId === currentRouteContractId;
}

const ROUTE_LABELS: Record<string, string> = {
  ...roleLabels as Record<RoleKey, string>,
  chairman_or_general_manager: "董事长/总经理或签"
};

export function contractApprovalRouteText(roleKeys: unknown) {
  const keys = routeKeys(roleKeys);
  if (!keys) return "审批路线数据异常，已停止展示";
  return keys.map((key) => ROUTE_LABELS[key] ?? "未知审批岗位（内部标识已隐藏）").join(" → ");
}

export function contractEnhancedReasonText(value: unknown) {
  const values = reasons(value);
  if (!values) return "增强审批原因数据异常，已停止展示";
  return values.map((reason) => reason === "unlimited_amount_change"
    ? "无限额合同发生金额变化"
    : "累计增减严格超过原始金额 10%").join("；");
}

export function contractChangeTypeLabel(value: unknown) {
  return value === "original" ? "原始合同" : value === "historical_takeover" ? "历史接管合同" :
    value === "change" ? "合同变更" : value === "supplement" ? "补充协议（历史）" : "未知变更类型";
}
