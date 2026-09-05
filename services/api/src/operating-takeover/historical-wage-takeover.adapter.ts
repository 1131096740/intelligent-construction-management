/**
 * #219 keeps the classification seam deliberately free of client DTOs.  The
 * caller has already redeemed a server-issued selectionRef and supplies this
 * adapter only with its frozen, server-derived snapshot.
 */
export const HISTORICAL_WAGE_POSITION_CATALOG_VERSION = "historical_wage_position_category_v1";

export const HISTORICAL_WAGE_POSITION_CATEGORY_LABELS = {
  project_leadership: "项目领导班子",
  engineering_technical: "工程技术人员",
  quality_safety: "质量安全人员",
  commercial_contract_cost: "商务合约与成本预算人员",
  material_equipment: "材料设备人员",
  finance_administration: "财务与综合行政人员",
  project_management_unspecified: "项目管理人员（未细分）"
} as const;

export const HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS = {
  employee_net_pay: "员工实发工资",
  withheld_individual_income_tax: "代扣代缴个人所得税",
  employee_social_insurance: "员工个人承担社会保险",
  employee_housing_fund: "员工个人承担住房公积金",
  employer_social_insurance: "单位承担社会保险",
  employer_housing_fund: "单位承担住房公积金",
  other_controlled_payee: "其他受控收款方"
} as const;

const WAGE_CREDITOR_CATEGORIES = new Set(Object.keys(HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS));

type HistoricalWageGrade = "A" | "B" | "C";
type HistoricalWageDebtStatus = "settled" | "partially_settled" | "outstanding";

type HistoricalWageEvidenceCoordinate = {
  sourceObjectSha256: string;
  worksheetName: string | null;
  rowNumber: string | null;
  columnNumber: string | null;
  normalizedRowSha256: string;
};

export type HistoricalWageLegacySource = {
  sourceType: "project_wage";
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
  projectId: string;
  legacyWageMonth?: string | null;
  employmentCompanyId?: string | null;
  costImpactId: string;
  payableImpactId: string;
  amountCents: bigint;
  /** Server-resolved lineage. Older original fixtures omit these fields. */
  entryKind?: "original" | "correction" | "reversal";
  direction?: "increase" | "decrease";
  adjustsFactId?: string | null;
};

type HistoricalWageCreditorCell = {
  creditorCategoryCode: string;
  amountCents: bigint;
  creditorSubjectType: "employee_user" | "business_party";
  creditorSubjectIdentityKey: string;
};

type HistoricalWageAuthorityPerson = {
  employeeId: string;
  employmentSnapshotId: string;
  displayNameSuggestion?: string;
  positionCategoryCode?: string;
  projectId: string;
  amountCents: bigint;
  evidenceSha256: string;
  creditorCells: HistoricalWageCreditorCell[];
};

type HistoricalWageApprovedAuthority = {
  sourceVersionId: string;
  sourceFingerprint: string;
  employmentCompanyId: string;
  wageMonth: string;
  statementVersionId: string;
  statementRevision: number;
  people: HistoricalWageAuthorityPerson[];
};

type ExistingVerifiedPaymentExecutionSet = {
  kind: "existing_verified_payment_execution_set";
  paymentExecutionIds: string[];
  paymentExecutionSetFingerprint: string;
  paymentExecutions: unknown[];
};

type HistoricalWageBalanceReconciliationVersion = {
  kind: "historical_wage_balance_reconciliation_version";
  reconciliationAuthorityVersionId: string;
  sourceVersionFingerprint: string;
  reconciliationFingerprint: null;
};

type HistoricalWageSummaryLine = {
  creditorCategoryCode: string;
  creditorCategoryLabel: string;
  creditorIdentityKind: "aggregate_creditor_scope";
  creditorPartyVersionId: string | null;
  controlledScopeCode: string | null;
  controlledScopeDescription: string | null;
  controlledScopeEvidenceCoordinate: HistoricalWageEvidenceCoordinate | null;
  grossDebtCents: bigint;
  historicallySettledCents: bigint;
  outstandingBalanceCents: bigint;
  debtStatus: HistoricalWageDebtStatus;
  targetBusinessKey: string;
  creditorStableKey: string;
  target: ExistingVerifiedPaymentExecutionSet | HistoricalWageBalanceReconciliationVersion;
};

type HistoricalWageSummaryAuthority = {
  sourceVersionFingerprint: string;
  employmentCompanyId: string;
  projectId: string;
  wageMonth: string;
  catalogVersion: string;
  positionCategoryCode: string;
  positionCategoryLabel: string;
  evidenceCoordinate: HistoricalWageEvidenceCoordinate;
  lines: HistoricalWageSummaryLine[];
};

export type ResolvedHistoricalWageSelection = {
  selectionRefFingerprint: string;
  grade: HistoricalWageGrade;
  authority?: HistoricalWageApprovedAuthority;
  summary?: HistoricalWageSummaryAuthority;
  legacy: HistoricalWageLegacySource;
};

type CanonicalAReadModel = {
  employeeId: string;
  employmentSnapshotId: string;
  projectId: string;
  amountCents: bigint;
  evidenceSha256: string;
  creditorCells: Array<{
    creditorCategoryCode: string;
    amountCents: bigint;
    creditorSubjectType: "employee_user" | "business_party";
    creditorSubjectIdentityKey: string;
  }>;
};

type CanonicalBReadModel = {
  creditorCategoryCode: string;
  creditorCategoryLabel: string;
  grossDebtCents: bigint;
  historicallySettledCents: bigint;
  outstandingBalanceCents: bigint;
  debtStatus: HistoricalWageDebtStatus;
  reconciliationTarget: HistoricalWageSummaryLine["target"];
};

export type HistoricalWageTakeoverMapping = {
  grade: HistoricalWageGrade;
  decision: "FORMAL" | "GAP";
  sourceDiscriminator: "wage_statement_version" | "historical_wage_summary" | null;
  targetKind: "wage_takeover_projection_envelope" | "historical_wage_summary_payable_ref" | "unresolved_wage_payable_gap";
  canonicalStatementVersionId: string | null;
  canonicalSourceVersionId: string | null;
  projectIds: string[];
  people: CanonicalAReadModel[];
  summaryLines: CanonicalBReadModel[];
  usageScope: "historical_reconciliation_only" | null;
  newPaymentAllowed: boolean;
  settlementAllocationAllowed: boolean;
  legacy: HistoricalWageLegacySource;
};

export class HistoricalWageTakeoverAdapter {
  map(selection: ResolvedHistoricalWageSelection): HistoricalWageTakeoverMapping {
    if (!validHash(selection.selectionRefFingerprint) || !validLegacy(selection.legacy)) {
      return gap(selection.legacy);
    }
    if (selection.grade === "A" && selection.authority && validA(selection.authority, selection.legacy)) {
      const people = selection.authority.people.map((person) => ({
        employeeId: person.employeeId,
        employmentSnapshotId: person.employmentSnapshotId,
        projectId: person.projectId,
        amountCents: person.amountCents,
        evidenceSha256: person.evidenceSha256,
        creditorCells: person.creditorCells.map((cell) => ({
          creditorCategoryCode: cell.creditorCategoryCode,
          amountCents: cell.amountCents,
          creditorSubjectType: cell.creditorSubjectType,
          creditorSubjectIdentityKey: cell.creditorSubjectIdentityKey
        }))
      }));
      return {
        grade: "A",
        decision: "FORMAL",
        sourceDiscriminator: "wage_statement_version",
        targetKind: "wage_takeover_projection_envelope",
        canonicalStatementVersionId: selection.authority.statementVersionId,
        canonicalSourceVersionId: selection.authority.sourceVersionId,
        projectIds: sortedUnique(people.map((person) => person.projectId)),
        people,
        summaryLines: [],
        usageScope: null,
        newPaymentAllowed: true,
        settlementAllocationAllowed: false,
        legacy: selection.legacy
      };
    }
    if (selection.grade === "B" && selection.summary && validB(selection.summary, selection.legacy)) {
      return {
        grade: "B",
        decision: "FORMAL",
        sourceDiscriminator: "historical_wage_summary",
        targetKind: "historical_wage_summary_payable_ref",
        canonicalStatementVersionId: null,
        canonicalSourceVersionId: null,
        projectIds: [selection.summary.projectId],
        people: [],
        summaryLines: selection.summary.lines.map((line) => ({
          creditorCategoryCode: line.creditorCategoryCode,
          creditorCategoryLabel: line.creditorCategoryLabel,
          grossDebtCents: line.grossDebtCents,
          historicallySettledCents: line.historicallySettledCents,
          outstandingBalanceCents: line.outstandingBalanceCents,
          debtStatus: line.debtStatus,
          reconciliationTarget: line.target
        })),
        usageScope: "historical_reconciliation_only",
        newPaymentAllowed: false,
        settlementAllocationAllowed: false,
        legacy: selection.legacy
      };
    }
    return gap(selection.legacy);
  }
}

function gap(legacy: HistoricalWageLegacySource): HistoricalWageTakeoverMapping {
  return {
    grade: "C",
    decision: "GAP",
    sourceDiscriminator: null,
    targetKind: "unresolved_wage_payable_gap",
    canonicalStatementVersionId: null,
    canonicalSourceVersionId: null,
    projectIds: text(legacy.projectId) ? [legacy.projectId] : [],
    people: [],
    summaryLines: [],
    usageScope: null,
    newPaymentAllowed: false,
    settlementAllocationAllowed: false,
    legacy
  };
}

function validA(authority: HistoricalWageApprovedAuthority, legacy: HistoricalWageLegacySource): boolean {
  if (!text(authority.sourceVersionId) || !validHash(authority.sourceFingerprint) || !text(authority.employmentCompanyId)) return false;
  if (!wageMonth(authority.wageMonth) || !text(authority.statementVersionId) || authority.statementRevision < 1 || !Number.isInteger(authority.statementRevision)) return false;
  if (!authority.people.length) return false;
  const projectTotal = new Map<string, bigint>();
  for (const person of authority.people) {
    if (!text(person.employeeId) || !text(person.employmentSnapshotId) || !text(person.projectId) || person.amountCents < 0n || !validHash(person.evidenceSha256)) return false;
    if (!person.creditorCells.length) return false;
    let creditorTotal = 0n;
    for (const cell of person.creditorCells) {
      if (!WAGE_CREDITOR_CATEGORIES.has(cell.creditorCategoryCode) || cell.amountCents < 0n || !text(cell.creditorSubjectIdentityKey)) return false;
      creditorTotal += cell.amountCents;
    }
    if (creditorTotal !== person.amountCents) return false;
    projectTotal.set(person.projectId, (projectTotal.get(person.projectId) ?? 0n) + person.amountCents);
  }
  const legacyAmount = projectTotal.get(legacy.projectId);
  return legacyDirection(legacy) === "increase" ? legacyAmount === legacy.amountCents : legacyAmount !== undefined && legacyAmount >= 0n;
}

function validB(summary: HistoricalWageSummaryAuthority, legacy: HistoricalWageLegacySource): boolean {
  if (!validHash(summary.sourceVersionFingerprint) || !text(summary.employmentCompanyId)) return false;
  if (summary.projectId !== legacy.projectId || !wageMonth(summary.wageMonth) || !validEvidenceCoordinate(summary.evidenceCoordinate)) return false;
  if (summary.catalogVersion !== HISTORICAL_WAGE_POSITION_CATALOG_VERSION) return false;
  if (!(summary.positionCategoryCode in HISTORICAL_WAGE_POSITION_CATEGORY_LABELS)) return false;
  if (HISTORICAL_WAGE_POSITION_CATEGORY_LABELS[summary.positionCategoryCode as keyof typeof HISTORICAL_WAGE_POSITION_CATEGORY_LABELS] !== summary.positionCategoryLabel) return false;
  if (!summary.lines.length) return false;
  let total = 0n;
  for (const line of summary.lines) {
    if (
      !WAGE_CREDITOR_CATEGORIES.has(line.creditorCategoryCode) ||
      HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS[line.creditorCategoryCode as keyof typeof HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS] !== line.creditorCategoryLabel ||
      line.creditorIdentityKind !== "aggregate_creditor_scope" ||
      !text(line.targetBusinessKey) ||
      !text(line.creditorStableKey) ||
      line.grossDebtCents < 0n
    ) return false;
    if (line.creditorCategoryCode === "other_controlled_payee" && (!line.controlledScopeDescription || !line.controlledScopeEvidenceCoordinate)) return false;
    if (line.grossDebtCents !== line.historicallySettledCents + line.outstandingBalanceCents) return false;
    if (!validDebtStatus(line)) return false;
    if (line.target.kind === "existing_verified_payment_execution_set") {
      if (!line.target.paymentExecutionIds.length || !validHash(line.target.paymentExecutionSetFingerprint)) return false;
      if (line.debtStatus !== "settled" || line.outstandingBalanceCents !== 0n || line.historicallySettledCents !== line.grossDebtCents) return false;
    } else if (
      !text(line.target.reconciliationAuthorityVersionId) ||
      line.target.sourceVersionFingerprint !== summary.sourceVersionFingerprint ||
      line.target.reconciliationFingerprint !== null
    ) {
      return false;
    }
    total += line.grossDebtCents;
  }
  return legacyDirection(legacy) === "increase" ? total === legacy.amountCents : total >= 0n;
}

function validEvidenceCoordinate(value: HistoricalWageEvidenceCoordinate | null): boolean {
  return Boolean(
    value &&
    validHash(value.sourceObjectSha256) &&
    validHash(value.normalizedRowSha256) &&
    (value.worksheetName === null || typeof value.worksheetName === "string") &&
    (value.rowNumber === null || /^(0|[1-9][0-9]*)$/u.test(value.rowNumber)) &&
    (value.columnNumber === null || /^(0|[1-9][0-9]*)$/u.test(value.columnNumber))
  );
}

function validDebtStatus(line: HistoricalWageSummaryLine): boolean {
  if (line.historicallySettledCents < 0n || line.outstandingBalanceCents < 0n) return false;
  if (line.debtStatus === "settled") return line.outstandingBalanceCents === 0n && line.historicallySettledCents === line.grossDebtCents;
  if (line.debtStatus === "outstanding") return line.historicallySettledCents === 0n && line.outstandingBalanceCents === line.grossDebtCents;
  return line.historicallySettledCents > 0n && line.outstandingBalanceCents > 0n;
}

function validLegacy(legacy: HistoricalWageLegacySource): boolean {
  const entryKind = legacy.entryKind ?? "original";
  const direction = legacyDirection(legacy);
  const lineageValid = entryKind === "original"
    ? direction === "increase" && !legacy.adjustsFactId
    : (entryKind === "correction" || entryKind === "reversal") && text(legacy.adjustsFactId ?? "");
  return legacy.sourceType === "project_wage" && text(legacy.sourceBusinessId) && Number.isInteger(legacy.sourceVersion) && legacy.sourceVersion > 0 && validHash(legacy.sourceFingerprint) && text(legacy.projectId) && text(legacy.costImpactId) && text(legacy.payableImpactId) && legacy.amountCents > 0n && lineageValid;
}

function legacyDirection(legacy: HistoricalWageLegacySource): "increase" | "decrease" {
  return legacy.direction ?? "increase";
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/iu.test(value);
}

function wageMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(value);
}

function text(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
