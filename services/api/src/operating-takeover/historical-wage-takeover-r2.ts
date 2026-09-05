import {
  HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS,
  HISTORICAL_WAGE_POSITION_CATALOG_VERSION,
  HISTORICAL_WAGE_POSITION_CATEGORY_LABELS
} from "./historical-wage-takeover.adapter";
import {
  canonicalPol219CreditorStableKey,
  canonicalizePol219Set,
  computePol219AssignedWageExclusionSet,
  computePol219HistoricalWageBalanceReconciliationFingerprint,
  computePol219HistoricalWageSourceVersionFingerprint,
  computePol219VerifiedPaymentExecutionSet,
  normalizePol219BusinessText,
  normalizePol219ControlledId,
  normalizePol219DateOnly,
  normalizePol219EvidenceCoordinate,
  normalizePol219EvidenceReference,
  normalizePol219Hash,
  normalizePol219NullableBusinessText,
  normalizePol219NullableControlledId,
  normalizePol219NonNegativeInteger,
  strictJcs,
  type Pol219EvidenceCoordinate,
  type Pol219EvidenceReference
} from "./historical-wage-takeover-fingerprint";
import { fingerprint } from "./operating-takeover.utils";

export type HistoricalWageCreditorCategoryCode = keyof typeof HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS;
export type HistoricalWagePositionCategoryCode = keyof typeof HISTORICAL_WAGE_POSITION_CATEGORY_LABELS;
export type HistoricalWageDebtStatus = "settled" | "partially_settled" | "outstanding";

export type HistoricalWageBalanceSourceTarget = {
  kind: "historical_wage_balance_reconciliation_version";
  reservedTargetId: null;
  reconciliationAuthorityVersionId: string;
  reconciliationReference: string;
  schemaVersion: 1;
  sourceVersionFingerprint: string;
  reconciliationFingerprint: null;
  asOfDate: string;
  employmentCompanyId: string;
  employmentCompanyNameSnapshot: string;
  employmentCompanyCreditCodeSnapshot: string;
  projectId: string;
  projectCodeSnapshot: string;
  projectNameSnapshot: string;
  wageMonth: string;
  catalogVersion: string;
  positionCategoryCode: HistoricalWagePositionCategoryCode;
  positionCategoryLabelSnapshot: string;
  wageCreditorCategoryCode: HistoricalWageCreditorCategoryCode;
  wageCreditorCategoryLabelSnapshot: string;
  currencyCode: "CNY";
  debtStatus: HistoricalWageDebtStatus;
  grossDebtCents: bigint;
  historicallySettledCents: bigint;
  outstandingBalanceCents: bigint;
  evidence: Pol219EvidenceReference[];
  supportingPaymentExecutions: Array<{ paymentExecutionId: string; paymentExecutionFingerprint: string }>;
};

export type HistoricalWagePaymentSourceTarget = {
  kind: "existing_verified_payment_execution_set";
  paymentExecutionIds: string[];
  paymentExecutionSetFingerprint: string;
  paymentExecutions: ReturnType<typeof computePol219VerifiedPaymentExecutionSet>["payload"]["paymentExecutions"];
};

export type HistoricalWageSummaryTargetSource = HistoricalWageBalanceSourceTarget | HistoricalWagePaymentSourceTarget;

export type HistoricalWageSummaryLineR2 = {
  creditorCategoryCode: HistoricalWageCreditorCategoryCode;
  creditorCategoryLabel: string;
  creditorIdentityKind: "aggregate_creditor_scope";
  creditorPartyVersionId: string | null;
  controlledScopeCode: string | null;
  controlledScopeDescription: string | null;
  controlledScopeEvidenceCoordinate: Pol219EvidenceCoordinate | null;
  grossDebtCents: bigint;
  historicallySettledCents: bigint;
  outstandingBalanceCents: bigint;
  debtStatus: HistoricalWageDebtStatus;
  targetBusinessKey: string;
  creditorStableKey: string;
  target: HistoricalWageSummaryTargetSource;
};

export type HistoricalWageSummarySnapshotR2 = {
  schemaVersion: 1;
  sourceDiscriminator: "historical_wage_summary";
  sourceObjectId: string;
  sourceObjectCoordinate: Pol219EvidenceCoordinate;
  originalSourceVersion: string;
  originalBusinessNumber: string;
  asOfDate: string | null;
  basisDate: string | null;
  sourceHeader: ReturnType<typeof computePol219HistoricalWageSourceVersionFingerprint>["payload"]["sourceHeader"];
  originalControlledScopeDescription: string | null;
  evidence: Pol219EvidenceReference[];
  sourceDeclarerSnapshot: unknown;
  sourceEvidenceReviewerSnapshot: unknown;
  sourceVersionPayload: ReturnType<typeof computePol219HistoricalWageSourceVersionFingerprint>["payload"];
  sourceVersionFingerprint: string;
  employmentCompanyId: string;
  projectId: string;
  wageMonth: string;
  catalogVersion: string;
  positionCategoryCode: HistoricalWagePositionCategoryCode;
  positionCategoryLabel: string;
  evidenceCoordinate: Pol219EvidenceCoordinate;
  lines: HistoricalWageSummaryLineR2[];
  assignedWageExclusions: ReturnType<typeof computePol219AssignedWageExclusionSet>["payload"]["assignedWageExclusions"];
  assignedWageExclusionSetFingerprint: string;
  raw: Record<string, unknown>;
};

const SUMMARY_KEYS = [
  "schemaVersion", "sourceDiscriminator", "sourceObjectId", "sourceObjectCoordinate", "originalSourceVersion",
  "originalBusinessNumber", "asOfDate", "basisDate", "sourceHeader", "originalControlledScopeDescription",
  "evidence", "sourceDeclarerSnapshot", "sourceEvidenceReviewerSnapshot", "sourceVersionFingerprint", "lines",
  "assignedWageExclusions", "assignedWageExclusionSetFingerprint"
] as const;

const LINE_KEYS = [
  "creditorCategoryCode", "creditorCategoryLabel", "creditorIdentityKind", "creditorPartyVersionId",
  "controlledScopeCode", "controlledScopeDescription", "controlledScopeEvidenceCoordinate", "grossDebtCents",
  "historicallySettledCents", "outstandingBalanceCents", "debtStatus", "target"
] as const;

const BALANCE_TARGET_KEYS = [
  "kind", "reconciliationAuthorityVersionId", "reconciliationReference", "schemaVersion", "sourceVersionFingerprint",
  "reconciliationFingerprint", "asOfDate", "employmentCompanyId", "employmentCompanyNameSnapshot",
  "employmentCompanyCreditCodeSnapshot", "projectId", "projectCodeSnapshot", "projectNameSnapshot", "wageMonth",
  "catalogVersion", "positionCategoryCode", "positionCategoryLabelSnapshot", "wageCreditorCategoryCode",
  "wageCreditorCategoryLabelSnapshot", "currencyCode", "debtStatus", "grossDebtCents", "historicallySettledCents",
  "outstandingBalanceCents", "evidence", "supportingPaymentExecutions"
] as const;

const PAYMENT_TARGET_KEYS = ["kind", "paymentExecutionIds", "paymentExecutionSetFingerprint", "paymentExecutions"] as const;

export function parseHistoricalWageSummarySnapshot(value: unknown): HistoricalWageSummarySnapshotR2 | null {
  if (!isRecord(value)) return null;
  return parseHistoricalWageSummaryAuthority(value.historicalWageSummaryAuthority);
}

export function parseHistoricalWageSummaryAuthority(value: unknown): HistoricalWageSummarySnapshotR2 | null {
  try {
    const item = exactRecord(value, SUMMARY_KEYS, "historicalWageSummaryAuthority");
    if (item.schemaVersion !== 1 || item.sourceDiscriminator !== "historical_wage_summary") return null;
    const sourceHeader = sourceHeaderValue(item.sourceHeader);
    const rawLines = arrayValue(item.lines, true);
    const parsedLines = rawLines.map((line) => parseSummaryLine(line, sourceHeader));
    const sourceResult = computePol219HistoricalWageSourceVersionFingerprint({
      schemaVersion: 1,
      sourceDiscriminator: "historical_wage_summary",
      sourceObjectId: item.sourceObjectId,
      sourceObjectCoordinate: item.sourceObjectCoordinate,
      originalSourceVersion: item.originalSourceVersion,
      originalBusinessNumber: item.originalBusinessNumber,
      asOfDate: item.asOfDate,
      basisDate: item.basisDate,
      sourceHeader,
      creditorSourceFacts: parsedLines.map((line) => ({
        categoryCode: line.creditorCategoryCode,
        categoryLabelSnapshot: line.creditorCategoryLabel,
        creditorIdentityKind: line.creditorIdentityKind,
        creditorPartyVersionId: line.creditorPartyVersionId,
        controlledScopeCode: line.controlledScopeCode,
        controlledScopeDescription: line.controlledScopeDescription,
        controlledScopeEvidenceCoordinate: line.controlledScopeEvidenceCoordinate,
        grossDebtCents: line.grossDebtCents.toString(),
        historicallySettledCents: line.historicallySettledCents.toString(),
        outstandingBalanceCents: line.outstandingBalanceCents.toString(),
        debtStatus: line.debtStatus
      })),
      originalControlledScopeDescription: item.originalControlledScopeDescription,
      evidence: item.evidence,
      sourceEvidenceReviewerSnapshot: item.sourceEvidenceReviewerSnapshot
    });
    assertClaim(item.sourceVersionFingerprint, sourceResult.fingerprint, "sourceVersionFingerprint");
    const exclusions = computePol219AssignedWageExclusionSet(item.assignedWageExclusions);
    assertClaim(item.assignedWageExclusionSetFingerprint, exclusions.fingerprint, "assignedWageExclusionSetFingerprint");
    const lines = canonicalSummaryLines(parsedLines.map((line) => finishTarget(line, sourceResult.fingerprint)));
    const positionCategoryCode = sourceHeader.positionCategoryCode as HistoricalWagePositionCategoryCode;
    if (
      sourceHeader.catalogVersion !== HISTORICAL_WAGE_POSITION_CATALOG_VERSION ||
      !(positionCategoryCode in HISTORICAL_WAGE_POSITION_CATEGORY_LABELS) ||
      HISTORICAL_WAGE_POSITION_CATEGORY_LABELS[positionCategoryCode] !== sourceHeader.positionCategoryLabelSnapshot
    ) return null;
    return {
      schemaVersion: 1,
      sourceDiscriminator: "historical_wage_summary",
      sourceObjectId: sourceResult.payload.sourceObjectId,
      sourceObjectCoordinate: sourceResult.payload.sourceObjectCoordinate,
      originalSourceVersion: sourceResult.payload.originalSourceVersion,
      originalBusinessNumber: sourceResult.payload.originalBusinessNumber,
      asOfDate: sourceResult.payload.asOfDate,
      basisDate: sourceResult.payload.basisDate,
      sourceHeader,
      originalControlledScopeDescription: sourceResult.payload.originalControlledScopeDescription,
      evidence: sourceResult.payload.evidence,
      sourceDeclarerSnapshot: JSON.parse(strictJcs(item.sourceDeclarerSnapshot)) as unknown,
      sourceEvidenceReviewerSnapshot: sourceResult.payload.sourceEvidenceReviewerSnapshot,
      sourceVersionPayload: sourceResult.payload,
      sourceVersionFingerprint: sourceResult.fingerprint,
      employmentCompanyId: sourceHeader.employmentCompanyId,
      projectId: sourceHeader.projectId,
      wageMonth: sourceHeader.wageMonth,
      catalogVersion: sourceHeader.catalogVersion,
      positionCategoryCode,
      positionCategoryLabel: sourceHeader.positionCategoryLabelSnapshot,
      evidenceCoordinate: sourceResult.payload.sourceObjectCoordinate,
      lines,
      assignedWageExclusions: exclusions.payload.assignedWageExclusions,
      assignedWageExclusionSetFingerprint: exclusions.fingerprint,
      raw: canonicalRecord(item)
    };
  } catch {
    return null;
  }
}

export function historicalWageSummarySelectionSnapshot(snapshot: HistoricalWageSummarySnapshotR2) {
  return {
    schemaVersion: 1,
    sourceVersionFingerprint: snapshot.sourceVersionFingerprint,
    sourceVersionPayload: snapshot.sourceVersionPayload,
    targetClosure: snapshot.lines.map((line) => ({
      creditorStableKey: line.creditorStableKey,
      targetBusinessKey: line.targetBusinessKey,
      target: selectionTarget(line.target)
    })),
    assignedWageExclusions: snapshot.assignedWageExclusions,
    assignedWageExclusionSetFingerprint: snapshot.assignedWageExclusionSetFingerprint
  };
}

export function historicalWageSummarySelectionFingerprint(snapshot: HistoricalWageSummarySnapshotR2): string {
  return fingerprint(historicalWageSummarySelectionSnapshot(snapshot));
}

function parseSummaryLine(value: unknown, header: ReturnType<typeof sourceHeaderValue>) {
  const item = exactRecord(value, LINE_KEYS, "historical wage summary line");
  const creditorCategoryCode = normalizePol219ControlledId(item.creditorCategoryCode, "creditorCategoryCode") as HistoricalWageCreditorCategoryCode;
  const creditorCategoryLabel = normalizePol219BusinessText(item.creditorCategoryLabel, "creditorCategoryLabel");
  if (
    !(creditorCategoryCode in HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS) ||
    HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS[creditorCategoryCode] !== creditorCategoryLabel ||
    item.creditorIdentityKind !== "aggregate_creditor_scope"
  ) throw new TypeError("historical wage creditor scope 无效");
  const creditorPartyVersionId = normalizePol219NullableControlledId(item.creditorPartyVersionId, "creditorPartyVersionId");
  const controlledScopeCode = normalizePol219NullableControlledId(item.controlledScopeCode, "controlledScopeCode");
  const controlledScopeDescription = normalizePol219NullableBusinessText(item.controlledScopeDescription, "controlledScopeDescription");
  const controlledScopeEvidenceCoordinate = item.controlledScopeEvidenceCoordinate === null
    ? null
    : normalizePol219EvidenceCoordinate(item.controlledScopeEvidenceCoordinate);
  if (creditorCategoryCode === "other_controlled_payee" && (!controlledScopeDescription || !controlledScopeEvidenceCoordinate)) {
    throw new TypeError("other_controlled_payee 缺少受控范围说明或证据坐标");
  }
  const grossDebtCents = BigInt(normalizePol219NonNegativeInteger(integerInput(item.grossDebtCents)));
  const historicallySettledCents = BigInt(normalizePol219NonNegativeInteger(integerInput(item.historicallySettledCents)));
  const outstandingBalanceCents = BigInt(normalizePol219NonNegativeInteger(integerInput(item.outstandingBalanceCents)));
  const debtStatus = debtStatusValue(item.debtStatus);
  assertDebt(grossDebtCents, historicallySettledCents, outstandingBalanceCents, debtStatus);
  return {
    creditorCategoryCode,
    creditorCategoryLabel,
    creditorIdentityKind: "aggregate_creditor_scope" as const,
    creditorPartyVersionId,
    controlledScopeCode,
    controlledScopeDescription,
    controlledScopeEvidenceCoordinate,
    grossDebtCents,
    historicallySettledCents,
    outstandingBalanceCents,
    debtStatus,
    target: parseTarget(item.target, header, {
      creditorCategoryCode,
      creditorCategoryLabel,
      grossDebtCents,
      historicallySettledCents,
      outstandingBalanceCents,
      debtStatus
    })
  };
}

function parseTarget(
  value: unknown,
  header: ReturnType<typeof sourceHeaderValue>,
  line: Pick<HistoricalWageSummaryLineR2, "creditorCategoryCode" | "creditorCategoryLabel" | "grossDebtCents" | "historicallySettledCents" | "outstandingBalanceCents" | "debtStatus">
) {
  if (!isRecord(value)) throw new TypeError("historical wage target 必须是 object");
  if (value.kind === "existing_verified_payment_execution_set") {
    const item = exactRecord(value, PAYMENT_TARGET_KEYS, "historical wage payment target");
    const result = computePol219VerifiedPaymentExecutionSet(item.paymentExecutions);
    assertClaim(item.paymentExecutionSetFingerprint, result.fingerprint, "paymentExecutionSetFingerprint");
    if (item.paymentExecutionIds !== null) {
      const claimedIds = arrayValue(item.paymentExecutionIds, true).map((id) => normalizePol219ControlledId(id, "paymentExecutionId"));
      if (strictJcs(claimedIds) !== strictJcs(result.payload.paymentExecutionIds)) throw new TypeError("paymentExecutionIds 不是服务端派生顺序");
    }
    if (line.debtStatus !== "settled" || line.outstandingBalanceCents !== 0n || line.historicallySettledCents !== line.grossDebtCents) {
      throw new TypeError("payment target 仅能证明全额 settled line");
    }
    if (result.payload.paymentExecutions.reduce((sum, payment) => sum + BigInt(payment.amountCents), 0n) !== line.grossDebtCents) {
      throw new TypeError("payment target 金额不闭合");
    }
    return {
      kind: "existing_verified_payment_execution_set" as const,
      paymentExecutionIds: result.payload.paymentExecutionIds,
      paymentExecutionSetFingerprint: result.fingerprint,
      paymentExecutions: result.payload.paymentExecutions
    };
  }
  const item = exactRecord(value, BALANCE_TARGET_KEYS, "historical wage balance target");
  if (item.kind !== "historical_wage_balance_reconciliation_version" || item.schemaVersion !== 1 || item.reconciliationFingerprint !== null) {
    throw new TypeError("balance target 混入服务端预留/指纹责任");
  }
  const sourceClaim = item.sourceVersionFingerprint;
  if (sourceClaim !== null && typeof sourceClaim !== "string") throw new TypeError("sourceVersionFingerprint assertion 无效");
  return {
    kind: "historical_wage_balance_reconciliation_version" as const,
    reservedTargetId: null,
    reconciliationAuthorityVersionId: normalizePol219ControlledId(item.reconciliationAuthorityVersionId, "reconciliationAuthorityVersionId"),
    reconciliationReference: normalizePol219BusinessText(item.reconciliationReference, "reconciliationReference"),
    schemaVersion: 1 as const,
    sourceVersionFingerprint: sourceClaim,
    reconciliationFingerprint: null,
    asOfDate: normalizePol219DateOnly(item.asOfDate, "asOfDate"),
    employmentCompanyId: exactMatch(item.employmentCompanyId, header.employmentCompanyId, "employmentCompanyId"),
    employmentCompanyNameSnapshot: exactMatchText(item.employmentCompanyNameSnapshot, header.employmentCompanyNameSnapshot, "employmentCompanyNameSnapshot"),
    employmentCompanyCreditCodeSnapshot: exactMatch(item.employmentCompanyCreditCodeSnapshot, header.employmentCompanyCreditCodeSnapshot, "employmentCompanyCreditCodeSnapshot"),
    projectId: exactMatch(item.projectId, header.projectId, "projectId"),
    projectCodeSnapshot: exactMatchText(item.projectCodeSnapshot, header.projectCodeSnapshot, "projectCodeSnapshot"),
    projectNameSnapshot: exactMatchText(item.projectNameSnapshot, header.projectNameSnapshot, "projectNameSnapshot"),
    wageMonth: exactMatch(item.wageMonth, header.wageMonth, "wageMonth"),
    catalogVersion: exactMatch(item.catalogVersion, header.catalogVersion, "catalogVersion"),
    positionCategoryCode: exactMatch(item.positionCategoryCode, header.positionCategoryCode, "positionCategoryCode") as HistoricalWagePositionCategoryCode,
    positionCategoryLabelSnapshot: exactMatchText(item.positionCategoryLabelSnapshot, header.positionCategoryLabelSnapshot, "positionCategoryLabelSnapshot"),
    wageCreditorCategoryCode: exactMatch(item.wageCreditorCategoryCode, line.creditorCategoryCode, "wageCreditorCategoryCode") as HistoricalWageCreditorCategoryCode,
    wageCreditorCategoryLabelSnapshot: exactMatchText(item.wageCreditorCategoryLabelSnapshot, line.creditorCategoryLabel, "wageCreditorCategoryLabelSnapshot"),
    currencyCode: exactMatch(item.currencyCode, "CNY", "currencyCode") as "CNY",
    debtStatus: exactMatch(item.debtStatus, line.debtStatus, "debtStatus") as HistoricalWageDebtStatus,
    grossDebtCents: exactAmount(item.grossDebtCents, line.grossDebtCents, "grossDebtCents"),
    historicallySettledCents: exactAmount(item.historicallySettledCents, line.historicallySettledCents, "historicallySettledCents"),
    outstandingBalanceCents: exactAmount(item.outstandingBalanceCents, line.outstandingBalanceCents, "outstandingBalanceCents"),
    evidence: canonicalizePol219Set(
      arrayValue(item.evidence, true).map(normalizePol219EvidenceReference),
      (evidence) => `${evidence.fileObjectId}\u0000${strictJcs(evidence.evidenceCoordinate)}`
    ),
    supportingPaymentExecutions: canonicalizePol219Set(
      arrayValue(item.supportingPaymentExecutions, false).map(supportingPayment),
      (payment) => payment.paymentExecutionId.toLowerCase()
    )
  };
}

function finishTarget(
  line: ReturnType<typeof parseSummaryLine>,
  sourceVersionFingerprint: string
): HistoricalWageSummaryLineR2 {
  let target: HistoricalWageSummaryTargetSource;
  let targetBusinessKey: string;
  if (line.target.kind === "existing_verified_payment_execution_set") {
    target = line.target;
    targetBusinessKey = line.target.paymentExecutionSetFingerprint;
  } else {
    if (line.target.sourceVersionFingerprint !== null && line.target.sourceVersionFingerprint !== sourceVersionFingerprint) {
      throw new TypeError("balance target sourceVersionFingerprint assertion 不一致");
    }
    target = { ...line.target, sourceVersionFingerprint };
    targetBusinessKey = line.target.reconciliationAuthorityVersionId;
  }
  const creditorStableKey = canonicalPol219CreditorStableKey({
    categoryCode: line.creditorCategoryCode,
    creditorIdentityKind: line.creditorIdentityKind,
    creditorPartyVersionId: line.creditorPartyVersionId,
    controlledScopeCode: line.controlledScopeCode,
    controlledScopeDescription: line.controlledScopeDescription,
    targetKind: target.kind,
    targetBusinessKey
  });
  return { ...line, target, targetBusinessKey, creditorStableKey };
}

function selectionTarget(target: HistoricalWageSummaryTargetSource) {
  if (target.kind === "existing_verified_payment_execution_set") return target;
  return { ...target, reservedTargetId: null, reconciliationFingerprint: null };
}

function sourceHeaderValue(value: unknown) {
  const source = computePol219HistoricalWageSourceVersionFingerprint({
    schemaVersion: 1,
    sourceDiscriminator: "historical_wage_summary",
    sourceObjectId: "header-validation",
    sourceObjectCoordinate: {
      sourceObjectSha256: "0".repeat(64), worksheetName: null, rowNumber: null, columnNumber: null, normalizedRowSha256: "0".repeat(64)
    },
    originalSourceVersion: "header-validation",
    originalBusinessNumber: "header-validation",
    asOfDate: null,
    basisDate: null,
    sourceHeader: value,
    creditorSourceFacts: [{
      categoryCode: "employee_net_pay", categoryLabelSnapshot: "员工实发工资", creditorIdentityKind: "aggregate_creditor_scope",
      creditorPartyVersionId: null, controlledScopeCode: null, controlledScopeDescription: null,
      controlledScopeEvidenceCoordinate: null,
      grossDebtCents: "0", historicallySettledCents: "0", outstandingBalanceCents: "0", debtStatus: "settled"
    }],
    originalControlledScopeDescription: null,
    evidence: [{
      fileObjectId: "header-validation", contentSha256: "0".repeat(64), evidenceCoordinate: {
        sourceObjectSha256: "0".repeat(64), worksheetName: null, rowNumber: null, columnNumber: null, normalizedRowSha256: "0".repeat(64)
      }
    }],
    sourceEvidenceReviewerSnapshot: null
  });
  return source.payload.sourceHeader;
}

function supportingPayment(value: unknown) {
  const item = exactRecord(value, ["paymentExecutionId", "paymentExecutionFingerprint"], "supporting payment");
  return {
    paymentExecutionId: normalizePol219ControlledId(item.paymentExecutionId, "paymentExecutionId"),
    paymentExecutionFingerprint: normalizePol219Hash(item.paymentExecutionFingerprint as string)
  };
}

function assertClaim(value: unknown, computed: string, label: string) {
  if (value === null) return;
  if (typeof value !== "string" || normalizePol219Hash(value) !== computed) throw new TypeError(`${label} assertion 不一致`);
}

function assertDebt(gross: bigint, settled: bigint, outstanding: bigint, status: HistoricalWageDebtStatus) {
  if (gross !== settled + outstanding) throw new TypeError("historical wage debt 不平");
  if (
    (status === "settled" && (outstanding !== 0n || settled !== gross)) ||
    (status === "outstanding" && (settled !== 0n || outstanding !== gross)) ||
    (status === "partially_settled" && (settled <= 0n || outstanding <= 0n))
  ) throw new TypeError("historical wage debtStatus 不一致");
}

function debtStatusValue(value: unknown): HistoricalWageDebtStatus {
  if (value !== "settled" && value !== "partially_settled" && value !== "outstanding") throw new TypeError("debtStatus 无效");
  return value;
}

function exactMatch(value: unknown, expected: string, label: string): string {
  const normalized = normalizePol219ControlledId(value, label);
  if (normalized !== expected) throw new TypeError(`${label} 未闭合`);
  return normalized;
}

function exactMatchText(value: unknown, expected: string, label: string): string {
  const normalized = normalizePol219BusinessText(value, label);
  if (normalized !== expected) throw new TypeError(`${label} 未闭合`);
  return normalized;
}

function exactAmount(value: unknown, expected: bigint, label: string): bigint {
  const normalized = BigInt(normalizePol219NonNegativeInteger(integerInput(value)));
  if (normalized !== expected) throw new TypeError(`${label} 未闭合`);
  return normalized;
}

function integerInput(value: unknown): string | bigint {
  if (typeof value !== "string" && typeof value !== "bigint") throw new TypeError("金额必须是 canonical decimal string 或 bigint");
  return value;
}

function arrayValue(value: unknown, nonEmpty: boolean): unknown[] {
  if (!Array.isArray(value) || (nonEmpty && !value.length)) throw new TypeError("数组形状无效");
  for (let index = 0; index < value.length; index += 1) if (!(index in value)) throw new TypeError("数组不得有空洞");
  return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} 必须是 object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) throw new TypeError(`${label} 含未知字段`);
  const expected = new Set(keys);
  if ((actual as string[]).some((key) => !expected.has(key))) throw new TypeError(`${label} 含未知字段`);
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new TypeError(`${label} 缺少字段`);
  return value;
}

function canonicalRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(strictJcs(value)) as Record<string, unknown>;
}

function canonicalSummaryLines(lines: HistoricalWageSummaryLineR2[]): HistoricalWageSummaryLineR2[] {
  const seen = new Map<string, string>();
  const entries = lines.map((line) => {
    const canonical = strictJcs(jsonCompatible(line));
    const prior = seen.get(line.creditorStableKey);
    if (prior !== undefined) {
      throw new TypeError(prior === canonical
        ? "historical wage lines 存在完全重复元素"
        : "historical wage lines 存在稳定键相同但内容不同的元素");
    }
    seen.set(line.creditorStableKey, canonical);
    return { line, canonical };
  });
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.canonical, "utf8"), Buffer.from(right.canonical, "utf8")));
  return entries.map((entry) => entry.line);
}

function jsonCompatible(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonCompatible(item)]));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function finalizeHistoricalWageBalanceTarget(
  line: HistoricalWageSummaryLineR2,
  reservedTargetId: string
) {
  if (line.target.kind !== "historical_wage_balance_reconciliation_version") return null;
  const result = computePol219HistoricalWageBalanceReconciliationFingerprint({
    schemaVersion: 1,
    reservedTargetId,
    reconciliationAuthorityVersionId: line.target.reconciliationAuthorityVersionId,
    reconciliationReference: line.target.reconciliationReference,
    sourceVersionFingerprint: line.target.sourceVersionFingerprint,
    employmentCompanyId: line.target.employmentCompanyId,
    employmentCompanyNameSnapshot: line.target.employmentCompanyNameSnapshot,
    employmentCompanyCreditCodeSnapshot: line.target.employmentCompanyCreditCodeSnapshot,
    projectId: line.target.projectId,
    projectCodeSnapshot: line.target.projectCodeSnapshot,
    projectNameSnapshot: line.target.projectNameSnapshot,
    wageMonth: line.target.wageMonth,
    catalogVersion: line.target.catalogVersion,
    positionCategoryCode: line.target.positionCategoryCode,
    positionCategoryLabelSnapshot: line.target.positionCategoryLabelSnapshot,
    categoryCode: line.creditorCategoryCode,
    categoryLabelSnapshot: line.creditorCategoryLabel,
    creditorIdentityKind: line.creditorIdentityKind,
    creditorPartyVersionId: line.creditorPartyVersionId,
    controlledScopeCode: line.controlledScopeCode,
    controlledScopeDescription: line.controlledScopeDescription,
    targetKind: line.target.kind,
    targetBusinessKey: line.targetBusinessKey,
    currencyCode: line.target.currencyCode,
    debtStatus: line.target.debtStatus,
    grossDebtCents: line.target.grossDebtCents.toString(),
    historicallySettledCents: line.target.historicallySettledCents.toString(),
    outstandingBalanceCents: line.target.outstandingBalanceCents.toString(),
    asOfDate: line.target.asOfDate,
    evidence: line.target.evidence,
    supportingPaymentExecutions: line.target.supportingPaymentExecutions
  });
  return {
    ...line.target,
    reservedTargetId: result.payload.reservedTargetId,
    reconciliationFingerprint: result.fingerprint,
    canonicalPayload: result.payload
  };
}
