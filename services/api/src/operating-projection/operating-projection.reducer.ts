import {
  EVIDENCE_LEVELS,
  NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE,
  OPERATING_FACT_KIND_LABELS,
  OPERATING_IMPACT_KINDS,
  OPERATING_IMPACT_KIND_LABELS,
  PROJECT_FUND_DISPUTE_SOURCE_TYPE,
  type EvidenceLevel,
  type OperatingFactKind,
  type OperatingImpactKind
} from "@jiangkong/shared-domain";

export interface ProjectionImpactInput {
  id: string;
  impactKind: string;
  amountCents: bigint;
  direction: string;
  subjectRole?: string | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  costCategoryCode?: string | null;
  fundPurpose?: string | null;
  description?: string | null;
  impactSnapshot?: unknown;
}

export interface ProjectionFactInput {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceBusinessCode: string;
  occurredAt: string;
  confirmedAt: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  factKind: string;
  operatingLevel: string;
  evidenceLevel: string;
  amountCents: bigint;
  direction: string;
  sourceSnapshot: unknown;
  entryKind: string;
  adjustsFactId?: string | null;
  subjectReferences?: Array<{ kind: string; id: string }>;
  impacts: ProjectionImpactInput[];
}

export interface ProjectionFilters {
  constructionEnterpriseId?: string;
  companyEntityId?: string;
  counterpartyId?: string;
  costCategoryCode?: string;
  sourceType?: string;
}

export interface ProjectionScopeInput {
  kind: "project" | "company" | "projects";
  projectIds: string[];
  projectId?: string;
  companyEntityId?: string;
  filters?: ProjectionFilters;
}

export interface ProjectionRiskInput {
  projectId: string;
  projectCode?: string;
  projectName?: string;
  relationshipCompleteness:
    | "complete"
    | "coverage_incomplete"
    | "legacy_unmodeled"
    | "integrity_conflict";
  openPendingGrossCents: bigint | null;
  openCoveredCents: bigint | null;
  openUncoveredCents: bigint | null;
  continuedWithheldRetainedCents: bigint | null;
  coveredWithheldSources: ReadonlyArray<{
    openCoveredCents: bigint;
    continuedRetainedCents: bigint;
  }>;
  items: ReadonlyArray<{
    openAmountCents: bigint;
    openCoveredCents: bigint;
    openUncoveredCents: bigint;
    status: "open" | "partially_resolved" | "resolved" | "definition_reversed_error";
  }>;
  breakdownConsistent?: boolean;
  riskItemCount?: number;
  riskItemGrossCents?: bigint;
  retainedSourceCount?: number;
  retainedSourceCents?: bigint;
}

export interface ProjectionHolderAliasInput {
  projectId: string;
  kind: "construction_enterprise" | "participating_company";
  id: string;
  canonicalId: string;
}

export interface ProjectionRestrictionSourceInput {
  sourceType: typeof NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE | typeof PROJECT_FUND_DISPUTE_SOURCE_TYPE;
  entryId: string;
  projectId: string;
  status: string;
  sourceVersion: number;
  entryKind: string;
  adjustsEntryId?: string | null;
  amountCents: bigint;
  evidenceLevel: string;
  fingerprint: string;
  confirmedAt: string | null;
  rootId: string;
  businessCode: string;
  economicIdentityKey: string;
  sourceIdentityKey: string;
  fundHolderKind: string;
  fundHolderId: string;
  replacements: Array<{
    operatingImpactEntryId: string;
    amountCents: bigint;
  }>;
}

export interface ReduceOperatingProjectionInput {
  scope: ProjectionScopeInput;
  readAt: string;
  cutoffAt: string;
  facts: ProjectionFactInput[];
  riskByProject: ProjectionRiskInput[];
  constructionEnterpriseSubjectIds?: string[];
  companyEntityVersionIds?: string[];
  holderAliases?: ProjectionHolderAliasInput[];
  restrictionSources?: ProjectionRestrictionSourceInput[];
  aggregateSeed?: ProjectionAggregateSeed;
  integrityFacts?: ProjectionFactInput[];
  restrictionCashContext?: {
    conflict: boolean;
    notices: string[];
    holderCashBalances: Array<[string, bigint]>;
  };
}

export interface ProjectionAggregateSeed {
  totals: Partial<Record<OperatingImpactKind, bigint>>;
  evidence: Record<EvidenceLevel, { factCount: number; amountCents: bigint }>;
  sourceGroups: Array<{
    sourceType: string;
    factCount: number;
    impactCount: number;
    signedImpactCents: bigint;
  }>;
  selectedHolderCashBalances: Array<[string, bigint]>;
  confirmedProjectInflowsCents: bigint;
  confirmedProjectOutflowsCents: bigint;
  sourceReferenceOutflows: Array<[string, bigint]>;
  retroactiveFactCount: number;
  moneyComplete: boolean;
  notices: string[];
}

export class ProjectionResourceBudgetExceededError extends Error {
  constructor() {
    super("operating projection resource budget exceeded");
    this.name = "ProjectionResourceBudgetExceededError";
  }
}

type ApiMoney = string | null;

export interface OperatingProjectionDetail {
  factId: string;
  impactId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  sourceType: string;
  sourceTypeLabel: string;
  sourceBusinessId: string;
  sourceBusinessCode: string;
  factKind: string;
  factKindLabel: string;
  evidenceLevel: string;
  occurredAt: string;
  confirmedAt: string;
  confirmedAfterAsOf: boolean;
  impactKind: string;
  impactKindLabel: string;
  direction: string;
  signedImpactCents: string | null;
  subjectRole: string | null;
  subjectKind: string | null;
  subjectId: string | null;
  costCategoryCode: string | null;
  fundPurpose: string | null;
  description: string | null;
  sourceReferenceIds: string[];
}

export interface OperatingProjectionReadModel {
  schema: "operating_projection/V1";
  scope: ProjectionScopeInput;
  asOf: {
    basis: "occurred_at";
    businessDate: string;
    cutoffAt: string;
    readAt: string;
    retroactiveFactCount: number;
  };
  integrity: {
    status: "complete" | "incomplete";
    moneyComplete: boolean;
    notices: string[];
  };
  commitments: { contractCommitmentCents: string };
  operating: {
    confirmedIncomeCents: string;
    confirmedCostCents: string;
    receivableCents: string;
    payableCents: string;
  };
  actualFunds: {
    constructionEnterpriseFundsCents: string;
    companyProjectFundsCents: string;
    netProjectCashPositionCents: string;
    nonNegativeUsableCashStartCents: string;
    confirmedProjectInflowsCents: string;
    confirmedProjectOutflowsCents: string;
    companyAdvanceForProjectCents: string;
    companyReturnableToProjectCents: string;
    interSubjectBalanceCents: string;
  };
  restrictions: {
    estimatedClearingExpenseCents: string;
    necessaryExpenseReserveCents: string;
    projectDisputedFundsCents: string;
    constructionEnterpriseFrozenFundsCents: string;
    openPendingReconciliationGrossCents: ApiMoney;
    openCoveredReconciliationCents: ApiMoney;
    openUncoveredReconciliationCents: ApiMoney;
    continuedWithheldRetainedCents: ApiMoney;
    relationshipCompleteness: ProjectionRiskInput["relationshipCompleteness"];
    temporaryProfitDistributionCents: string;
  };
  profitAndLoss: {
    currentOperatingProfitCents: string;
    estimatedClearingExpenseCents: string;
    currentEstimatedProfitCents: string;
    finalConfirmedProfitCents: ApiMoney;
    finalConfirmable: boolean;
  };
  distribution: {
    cashCeilingCents: ApiMoney;
    projectedProfitCeilingCents: string;
    currentDistributableProfitCents: ApiMoney;
  };
  evidence: Record<EvidenceLevel, { factCount: number; amountCents: string }> & {
    gapFactCount: number;
    gapAmountCents: string;
  };
  impactTotalsByKind: Partial<Record<OperatingImpactKind, string>>;
  details: OperatingProjectionDetail[];
  clearingRiskDetails: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    sourceBusinessCode: string;
    impactKindLabel: string;
    amountCents: string;
    openPendingGrossCents: string | null;
    openCoveredCents: string;
    openUncoveredCents: string | null;
    continuedWithheldRetainedCents: string;
    statusLabel: string;
  }>;
  sourceDrilldown: Array<{
    projectId: string;
    sourceType: string;
    sourceTypeLabel: string;
    sourceBusinessId: string;
    sourceBusinessCode: string;
    factCount: number;
    impactCount: number;
    signedImpactCents: string;
  }>;
  clearingRiskSourceDrilldown: Array<{
    projectId: string;
    sourceType:
      | "clearing_reconciliation_pending_risk"
      | "clearing_reconciliation_retained_risk";
    sourceTypeLabel: string;
    sourceBusinessCode: string;
    factCount: 0;
    impactCount: 0;
    riskItemCount: number;
    signedImpactCents: string;
  }>;
  sourceReferenceTotals: Array<{
    sourceReferenceId: string;
    confirmedProjectOutflowCents: string;
  }>;
}

export interface OperatingProjectionAggregateView {
  scope: { label: string; projectCount: number };
  asOf: {
    businessDate: string;
    readAt: string;
    retroactiveFactCount: number;
  };
  integrity: {
    statusLabel: string;
    moneyComplete: boolean;
    notices: string[];
  };
  commitments: OperatingProjectionReadModel["commitments"];
  operating: OperatingProjectionReadModel["operating"];
  actualFunds: OperatingProjectionReadModel["actualFunds"];
  restrictions: Omit<OperatingProjectionReadModel["restrictions"], "relationshipCompleteness"> & {
    relationshipCompletenessLabel: string;
  };
  profitAndLoss: OperatingProjectionReadModel["profitAndLoss"];
  distribution: OperatingProjectionReadModel["distribution"];
  evidence: OperatingProjectionReadModel["evidence"];
  sources: Array<{
    sourceTypeLabel: string;
    factCount: number;
    impactCount: number;
    riskItemCount?: number;
    signedImpactCents: string;
  }>;
}

export interface OperatingProjectionDetailedView extends OperatingProjectionAggregateView {
  details: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    sourceTypeLabel: string;
    sourceBusinessCode: string;
    factKindLabel: string;
    evidenceLevel: string | null;
    occurredAt: string | null;
    confirmedAt: string | null;
    confirmedAfterAsOf: boolean;
    impactKindLabel: string;
    directionLabel: string;
    signedImpactCents: string | null;
    costCategoryCode: string | null;
    fundPurpose: string | null;
    reconciliationRisk?: {
      openCoveredCents: string;
      openUncoveredCents: string | null;
      openPendingGrossCents: string | null;
      continuedWithheldRetainedCents: string;
      statusLabel: string;
    };
  }>;
  sourceDrilldown: Array<{
    projectId: string;
    sourceTypeLabel: string;
    sourceBusinessCode: string;
    factCount: number;
    impactCount: number;
    riskItemCount?: number;
    signedImpactCents: string;
  }>;
}

export function toOperatingProjectionAggregate(
  projection: OperatingProjectionReadModel
): OperatingProjectionAggregateView {
  const sources = new Map<string, {
    sourceTypeLabel: string;
    factCount: number;
    impactCount: number;
    riskItemCount: number;
    signedImpactCents: bigint;
  }>();
  for (const row of [
    ...projection.sourceDrilldown,
    ...projection.clearingRiskSourceDrilldown
  ]) {
    const current = sources.get(row.sourceType) ?? {
      sourceTypeLabel: row.sourceTypeLabel,
      factCount: 0,
      impactCount: 0,
      riskItemCount: 0,
      signedImpactCents: 0n
    };
    current.factCount += row.factCount;
    current.impactCount += row.impactCount;
    current.riskItemCount += "riskItemCount" in row ? row.riskItemCount : 0;
    current.signedImpactCents += BigInt(row.signedImpactCents);
    sources.set(row.sourceType, current);
  }
  return {
    scope: {
      label: projection.scope.kind === "project"
        ? "单项目口径"
        : projection.scope.kind === "company"
          ? "公司归属口径"
          : "多项目汇总口径",
      projectCount: projection.scope.projectIds.length
    },
    asOf: {
      businessDate: projection.asOf.businessDate,
      readAt: projection.asOf.readAt,
      retroactiveFactCount: projection.asOf.retroactiveFactCount
    },
    integrity: {
      statusLabel: projection.integrity.moneyComplete ? "金额完整" : "金额不完整",
      moneyComplete: projection.integrity.moneyComplete,
      notices: projection.integrity.notices
    },
    commitments: projection.commitments,
    operating: projection.operating,
    actualFunds: projection.actualFunds,
    restrictions: {
      estimatedClearingExpenseCents:
        projection.restrictions.estimatedClearingExpenseCents,
      necessaryExpenseReserveCents:
        projection.restrictions.necessaryExpenseReserveCents,
      projectDisputedFundsCents:
        projection.restrictions.projectDisputedFundsCents,
      constructionEnterpriseFrozenFundsCents:
        projection.restrictions.constructionEnterpriseFrozenFundsCents,
      openPendingReconciliationGrossCents:
        projection.restrictions.openPendingReconciliationGrossCents,
      openCoveredReconciliationCents:
        projection.restrictions.openCoveredReconciliationCents,
      openUncoveredReconciliationCents:
        projection.restrictions.openUncoveredReconciliationCents,
      continuedWithheldRetainedCents:
        projection.restrictions.continuedWithheldRetainedCents,
      temporaryProfitDistributionCents:
        projection.restrictions.temporaryProfitDistributionCents,
      relationshipCompletenessLabel: relationshipCompletenessLabel(
        projection.restrictions.relationshipCompleteness
      )
    },
    profitAndLoss: projection.profitAndLoss,
    distribution: projection.distribution,
    evidence: projection.evidence,
    sources: Array.from(sources.values())
      .map((value) => ({
        sourceTypeLabel: value.sourceTypeLabel,
        factCount: value.factCount,
        impactCount: value.impactCount,
        ...(value.riskItemCount > 0
          ? { riskItemCount: value.riskItemCount }
          : {}),
        signedImpactCents: apiMoney(value.signedImpactCents)
      }))
      .sort((left, right) => left.sourceTypeLabel.localeCompare(right.sourceTypeLabel, "zh-CN"))
  };
}

export function toOperatingProjectionDetailedView(
  projection: OperatingProjectionReadModel
): OperatingProjectionDetailedView {
  return {
    ...toOperatingProjectionAggregate(projection),
    details: [
      ...projection.details.map((detail) => ({
        projectId: detail.projectId,
        projectCode: detail.projectCode,
        projectName: detail.projectName,
        sourceTypeLabel: detail.sourceTypeLabel,
        sourceBusinessCode: detail.sourceBusinessCode,
        factKindLabel: detail.factKindLabel,
        evidenceLevel: detail.evidenceLevel,
        occurredAt: detail.occurredAt,
        confirmedAt: detail.confirmedAt,
        confirmedAfterAsOf: detail.confirmedAfterAsOf,
        impactKindLabel: detail.impactKindLabel,
        directionLabel: directionLabel(detail.direction),
        signedImpactCents: detail.signedImpactCents,
        costCategoryCode: detail.costCategoryCode,
        fundPurpose: detail.fundPurpose
      })),
      ...projection.clearingRiskDetails.map((detail) => ({
        projectId: detail.projectId,
        projectCode: detail.projectCode,
        projectName: detail.projectName,
        sourceTypeLabel: "施工企业清分",
        sourceBusinessCode: detail.sourceBusinessCode,
        factKindLabel: "待核对关系",
        evidenceLevel: null,
        occurredAt: null,
        confirmedAt: null,
        confirmedAfterAsOf: false,
        impactKindLabel: detail.impactKindLabel,
        directionLabel: "限制",
        signedImpactCents: detail.amountCents,
        costCategoryCode: "construction_enterprise_deduction",
        fundPurpose: null,
        reconciliationRisk: {
          openPendingGrossCents: detail.openPendingGrossCents,
          openCoveredCents: detail.openCoveredCents,
          openUncoveredCents: detail.openUncoveredCents,
          continuedWithheldRetainedCents:
            detail.continuedWithheldRetainedCents,
          statusLabel: detail.statusLabel
        }
      }))
    ],
    sourceDrilldown: [
      ...projection.sourceDrilldown,
      ...projection.clearingRiskSourceDrilldown
    ].map((row) => ({
      projectId: row.projectId,
      sourceTypeLabel: row.sourceTypeLabel,
      sourceBusinessCode: row.sourceBusinessCode,
      factCount: row.factCount,
      impactCount: row.impactCount,
      ...( "riskItemCount" in row
        ? { riskItemCount: row.riskItemCount }
        : {}),
      signedImpactCents: row.signedImpactCents
    }))
  };
}

export function toOperatingProjectionPublicDetail(
  fact: ProjectionFactInput,
  impact: ProjectionImpactInput,
  cutoffAt: string
) {
  const kindKnown = IMPACT_KIND_SET.has(impact.impactKind);
  const directionKnown = IMPACT_DIRECTIONS.has(impact.direction);
  const signed = signedAmount(impact);
  const financialSigned = kindKnown && directionKnown && signed !== null &&
    impact.direction !== "notice" && fact.evidenceLevel !== "C"
      ? signed
      : null;
  const projectionSigned = kindKnown &&
    impact.impactKind === "contract_commitment_reference" &&
    impact.direction === "notice" && fact.evidenceLevel !== "C"
      ? impact.amountCents
      : financialSigned;
  return {
    projectCode: fact.projectCode,
    projectName: fact.projectName,
    sourceTypeLabel: sourceTypeLabel(fact.sourceType),
    sourceBusinessCode: fact.sourceBusinessCode,
    factKindLabel: factKindLabel(fact.factKind),
    evidenceLevel: fact.evidenceLevel,
    occurredAt: fact.occurredAt,
    confirmedAt: fact.confirmedAt,
    confirmedAfterAsOf: fact.confirmedAt > cutoffAt,
    impactKindLabel: impactKindLabel(impact.impactKind),
    directionLabel: directionLabel(impact.direction),
    signedImpactCents: projectionSigned === null ? null : apiMoney(projectionSigned),
    costCategoryCode: impact.costCategoryCode ?? null,
    fundPurpose: impact.fundPurpose ?? null
  };
}

export function projectionFactMatchesFilters(
  fact: ProjectionFactInput,
  impact: ProjectionImpactInput,
  filters: ProjectionFilters | undefined,
  constructionEnterpriseSubjectIds?: string[],
  companyEntityVersionIds?: string[]
): boolean {
  return matchesFilters(
    fact,
    impact,
    filters,
    constructionEnterpriseSubjectIds,
    companyEntityVersionIds
  );
}

const EVIDENCE_LEVEL_SET = new Set<string>(EVIDENCE_LEVELS);
const IMPACT_KIND_SET = new Set<string>(OPERATING_IMPACT_KINDS);
const IMPACT_DIRECTIONS = new Set(["increase", "decrease", "notice"]);
const NOTICE_IMPACT_KINDS = new Set<OperatingImpactKind>([
  "contract_commitment_reference",
  "invoice_reference",
  "evidence_gap_notice"
]);
const CASH_IMPACT_KINDS = new Set<OperatingImpactKind>([
  "construction_enterprise_funds_increase",
  "construction_enterprise_funds_decrease",
  "company_project_funds_increase",
  "company_project_funds_decrease"
]);
const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  owner_settlement: "业主结算",
  project_upstream_settlement: "对上结算",
  project_upstream_fund_fact: "对上资金事实",
  project_affiliate_contract_fact: "施工企业—我方合同事实",
  project_affiliate_settlement_fact: "施工企业—我方结算事实",
  project_affiliate_payment_fact: "施工企业—我方付款事实",
  project_proxy_payment: "项目代付",
  contract_version: "下游合同",
  settlement: "下游结算",
  payment_execution: "合同付款执行",
  expense_claim_approval: "费用报销审批",
  expense_claim_payment_execution: "费用报销付款执行",
  employee_project_loan_entry: "员工项目借款事实",
  spot_procurement_receipt_review: "零星采购收货复核",
  spot_procurement_payment_execution: "零星材料付款执行",
  spot_procurement_refund: "零星采购退款",
  spot_procurement_invoice_record: "零星采购发票记录",
  contract_takeover_historical_payment: "历史合同付款事实",
  project_expense_execution: "项目费用付款执行",
  expense_claim: "费用事实",
  expense_claim_execution: "费用付款执行",
  wage_statement_version: "工资承担事实",
  fund_movement: "项目资金调度",
  fund_execution: "资金执行",
  clearing_event_version: "施工企业清分",
  [NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE]: "必要费用准备",
  [PROJECT_FUND_DISPUTE_SOURCE_TYPE]: "一般争议资金",
  operating_takeover: "历史经营接管"
};

function directionLabel(direction: string): string {
  if (direction === "increase") return "增加";
  if (direction === "decrease") return "减少";
  if (direction === "notice") return "仅提示";
  return "未知方向";
}

function apiMoney(value: bigint): string {
  return value.toString();
}

function chinaBusinessDate(value: string): string {
  return new Date(Date.parse(value) + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function signedAmount(impact: ProjectionImpactInput): bigint | null {
  if (impact.amountCents < 0n) return null;
  if (impact.direction === "increase") return impact.amountCents;
  if (impact.direction === "decrease") return -impact.amountCents;
  if (impact.direction === "notice") return 0n;
  return null;
}

type RestrictionSourceConfig = {
  schema: string;
  rootKey: "reserveId" | "disputeId";
  increaseKind: "necessary_expense_reserve_increase" | "project_disputed_funds_increase";
  decreaseKind: "necessary_expense_reserve_decrease" | "project_disputed_funds_decrease";
  replacementPairs: ReadonlySet<string>;
};

const RESTRICTION_SOURCE_CONFIG = new Map<string, RestrictionSourceConfig>([
  [NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE, {
    schema: "project_necessary_expense_reserve_entry/V1",
    rootKey: "reserveId",
    increaseKind: "necessary_expense_reserve_increase",
    decreaseKind: "necessary_expense_reserve_decrease",
    replacementPairs: new Set([
      "confirmed_cost:increase",
      "payable_increase:increase",
      "estimated_clearing_expense:increase",
      "construction_enterprise_funds_freeze:increase",
      "project_disputed_funds_increase:increase"
    ])
  }],
  [PROJECT_FUND_DISPUTE_SOURCE_TYPE, {
    schema: "project_fund_dispute_entry/V1",
    rootKey: "disputeId",
    increaseKind: "project_disputed_funds_increase",
    decreaseKind: "project_disputed_funds_decrease",
    replacementPairs: new Set([
      "confirmed_cost:increase",
      "payable_increase:increase",
      "estimated_clearing_expense:increase",
      "necessary_expense_reserve_increase:increase",
      "construction_enterprise_funds_freeze:increase",
      "construction_enterprise_funds_decrease:decrease",
      "inter_subject_balance_increase:increase",
      "inter_subject_balance_decrease:decrease"
    ])
  }]
]);

type RestrictionIntegrity = {
  conflict: boolean;
  notices: string[];
  holderCashBalances: Map<string, bigint>;
  holderByImpactId: Map<string, string>;
};

function validateRestrictionIntegrity(
  input: ReduceOperatingProjectionInput
): RestrictionIntegrity {
  const facts = input.integrityFacts ?? input.facts;
  const notices = new Set<string>(input.restrictionCashContext?.notices ?? []);
  let conflict = input.restrictionCashContext?.conflict ?? false;
  const holderAliasByKey = canonicalHolderAliasMap(input.holderAliases ?? []);
  const validateActiveHolder = input.holderAliases !== undefined;
  const factBySource = new Map(
    facts.map((fact) => [sourceCoordinate(fact.sourceType, fact.sourceBusinessId), fact])
  );
  const restrictionSourceByCoordinate = input.restrictionSources === undefined
    ? null
    : new Map(input.restrictionSources.map((source) => [
        sourceCoordinate(source.sourceType, source.entryId),
        source
      ]));
  const impactById = new Map<string, { fact: ProjectionFactInput; impact: ProjectionImpactInput }>();
  for (const fact of facts) {
    for (const impact of fact.impacts) impactById.set(impact.id, { fact, impact });
  }
  const selectedImpactsByFactId = new Map<string, ProjectionImpactInput[]>();
  const integrityFilters: ProjectionFilters = {
    ...(input.scope.filters?.constructionEnterpriseId
      ? { constructionEnterpriseId: input.scope.filters.constructionEnterpriseId }
      : {}),
    ...(input.scope.filters?.companyEntityId
      ? { companyEntityId: input.scope.filters.companyEntityId }
      : {}),
    ...(input.scope.filters?.counterpartyId
      ? { counterpartyId: input.scope.filters.counterpartyId }
      : {})
  };
  for (const fact of facts) {
    const selected = selectFactImpacts({
      ...input,
      scope: { ...input.scope, filters: integrityFilters }
    }, fact);
    if (selected.factSelected) {
      selectedImpactsByFactId.set(fact.id, selected.matchingImpacts);
    }
  }
  const holderCashBalances = new Map<string, bigint>(
    input.restrictionCashContext?.holderCashBalances ?? []
  );
  const holderByImpactId = new Map<string, string>();
  const restrictionByHolder = new Map<string, bigint>();
  const restrictionByProject = new Map<string, bigint>();
  const adjustedByOriginal = new Map<string, bigint>();
  const replacementByTarget = new Map<string, bigint>();

  const mark = (notice: string) => {
    conflict = true;
    notices.add(notice);
  };
  const canonicalHolder = (fact: ProjectionFactInput, impact: ProjectionImpactInput,
    expectedKind: "construction_enterprise" | "participating_company") =>
    resolveCanonicalHolder(fact, impact, expectedKind, holderAliasByKey, validateActiveHolder);

  if (!input.restrictionCashContext) for (const fact of facts) {
    for (const impact of fact.impacts) {
      if (fact.evidenceLevel === "C") continue;
      const signed = signedAmount(impact);
      if (signed === null) continue;
      const expectedKind = impact.impactKind === "construction_enterprise_funds_increase" ||
        impact.impactKind === "construction_enterprise_funds_decrease"
        ? "construction_enterprise" as const
        : impact.impactKind === "company_project_funds_increase" ||
            impact.impactKind === "company_project_funds_decrease"
          ? "participating_company" as const
          : null;
      if (!expectedKind) continue;
      const holder = canonicalHolder(fact, impact, expectedKind);
      if (!holder) {
        mark("实际项目资金缺少可核验的持有主体，资金完整性冲突。");
        continue;
      }
      holderByImpactId.set(impact.id, holder);
      holderCashBalances.set(holder, (holderCashBalances.get(holder) ?? 0n) + signed);
    }
  }

  for (const fact of facts) {
    const selectedImpacts = selectedImpactsByFactId.get(fact.id);
    if (!selectedImpacts) continue;
    const config = RESTRICTION_SOURCE_CONFIG.get(fact.sourceType);
    if (!config) continue;
    const source = jsonRecord(fact.sourceSnapshot);
    const impacts = selectedImpacts.filter((impact) =>
      impact.impactKind === config.increaseKind || impact.impactKind === config.decreaseKind
    );
    const impact = impacts.length === 1 ? impacts[0]! : null;
    const entryKind = jsonText(source.entryKind);
    const sourceAmount = jsonMoney(source.amountCents);
    const holder = jsonRecord(source.fundHolder);
    const holderKind = jsonText(holder.kind);
    const holderId = jsonText(holder.id);
    const sourceFingerprint = jsonText(source.fingerprint);
    const sourceEntryId = jsonText(source.entryId);
    const rootId = jsonText(source[config.rootKey]);
    const sourceVersion = jsonText(source.sourceVersion);
    const expectedDirection = entryKind === "establish" || entryKind === "increase"
      ? "increase"
      : entryKind === "release" || entryKind === "technical_reversal"
        ? "decrease"
        : null;
    const expectedKind = entryKind === "release" ? config.decreaseKind : config.increaseKind;
    const snapshot = jsonRecord(impact?.impactSnapshot);
    const expectedImpactEntryId = entryKind === "technical_reversal"
      ? jsonText(source.adjustsEntryId)
      : sourceEntryId;
    const expectedImpactFingerprint = entryKind === "technical_reversal"
      ? jsonText(source.adjustsEntryFingerprint)
      : sourceFingerprint;
    const holderType = holderKind === "construction_enterprise" || holderKind === "participating_company"
      ? holderKind
      : null;
    const canonical = impact && holderType
      ? canonicalHolder(fact, impact, holderType)
      : null;
    const authoritativeSource = restrictionSourceByCoordinate?.get(
      sourceCoordinate(fact.sourceType, fact.sourceBusinessId)
    );
    const sourceReplacements = replacementSnapshot(source.replacementImpacts);
    const authoritativeContractValid = restrictionSourceByCoordinate === null || Boolean(
      authoritativeSource &&
      authoritativeSource.projectId === fact.projectId &&
      authoritativeSource.status === "confirmed" &&
      authoritativeSource.confirmedAt !== null &&
      authoritativeSource.confirmedAt === fact.confirmedAt &&
      jsonText(source.confirmedAt) === authoritativeSource.confirmedAt &&
      authoritativeSource.sourceVersion === fact.sourceVersion &&
      authoritativeSource.entryKind === entryKind &&
      (authoritativeSource.adjustsEntryId ?? null) === (jsonText(source.adjustsEntryId) ?? null) &&
      authoritativeSource.amountCents === fact.amountCents &&
      authoritativeSource.evidenceLevel === fact.evidenceLevel &&
      authoritativeSource.fingerprint === sourceFingerprint &&
      authoritativeSource.rootId === rootId &&
      authoritativeSource.businessCode === fact.sourceBusinessCode &&
      authoritativeSource.economicIdentityKey === source.economicIdentityKey &&
      authoritativeSource.sourceIdentityKey === source.sourceIdentityKey &&
      authoritativeSource.fundHolderKind === holderKind &&
      authoritativeSource.fundHolderId === holderId &&
      sourceReplacements !== null &&
      sameReplacementSet(authoritativeSource.replacements, sourceReplacements)
    );
    const ledgerContractValid = Boolean(
      impact &&
      rootId &&
      sourceEntryId === fact.sourceBusinessId &&
      source.schema === config.schema &&
      source.businessCode === fact.sourceBusinessCode &&
      sourceVersion === String(fact.sourceVersion) &&
      sourceAmount !== null &&
      sourceAmount === fact.amountCents &&
      sourceAmount === impact.amountCents &&
      source.evidenceLevel === fact.evidenceLevel &&
      sourceFingerprint &&
      expectedDirection &&
      impact.direction === expectedDirection &&
      impact.impactKind === expectedKind &&
      impact.subjectRole === "fund_holder" &&
      impact.subjectKind === holderKind &&
      impact.subjectId === holderId &&
      snapshot.entryId === expectedImpactEntryId &&
      snapshot.fingerprint === expectedImpactFingerprint &&
      snapshot.economicIdentityKey === source.economicIdentityKey &&
      snapshot.sourceIdentityKey === source.sourceIdentityKey &&
      fact.entryKind === (entryKind === "technical_reversal" ? "reversal" : "original") &&
      authoritativeContractValid
    );
    if (!ledgerContractValid) {
      mark("必要费用准备或一般争议资金的来源快照与经营账记录不一致，限制金额完整性冲突。");
      continue;
    }
    if (!canonical) {
      mark("资金限制的持有主体在基准日无有效档案，限制金额完整性冲突。");
      continue;
    }
    const signed = signedAmount(impact!);
    if (signed === null) {
      mark("资金限制方向无法核验，限制金额完整性冲突。");
      continue;
    }
    const holderRestrictionKey = `${fact.sourceType}\u0000${canonical}`;
    restrictionByHolder.set(
      holderRestrictionKey,
      (restrictionByHolder.get(holderRestrictionKey) ?? 0n) + signed
    );
    const projectRestrictionKey = `${fact.sourceType}\u0000${fact.projectId}`;
    restrictionByProject.set(
      projectRestrictionKey,
      (restrictionByProject.get(projectRestrictionKey) ?? 0n) + signed
    );

    const adjustsEntryId = jsonText(source.adjustsEntryId);
    if (entryKind === "release" || entryKind === "technical_reversal") {
      const original = adjustsEntryId
        ? factBySource.get(sourceCoordinate(fact.sourceType, adjustsEntryId))
        : null;
      const originalSource = jsonRecord(original?.sourceSnapshot);
      const originalFingerprint = jsonText(originalSource.fingerprint);
      if (
        !original ||
        original.projectId !== fact.projectId ||
        jsonText(originalSource[config.rootKey]) !== rootId ||
        !["establish", "increase"].includes(jsonText(originalSource.entryKind) ?? "") ||
        (entryKind === "technical_reversal" && (
          original.amountCents !== fact.amountCents ||
          fact.adjustsFactId !== original.id ||
          jsonText(source.adjustsEntryFingerprint) !== originalFingerprint
        ))
      ) {
        mark("资金限制的释放或技术冲销未与原确认分录闭合，限制金额完整性冲突。");
      } else {
        const adjustedKey = `${fact.sourceType}\u0000${adjustsEntryId}`;
        adjustedByOriginal.set(
          adjustedKey,
          (adjustedByOriginal.get(adjustedKey) ?? 0n) + fact.amountCents
        );
        if ((adjustedByOriginal.get(adjustedKey) ?? 0n) > original.amountCents) {
          mark("资金限制的累计释放或冲销超过原确认金额，限制金额完整性冲突。");
        }
      }
    }

    const replacements = replacementSnapshot(source.replacementImpacts);
    if (replacements === null || (replacements.length > 0 && entryKind !== "release")) {
      mark("资金限制的替代关系格式或生命周期不正确，限制金额完整性冲突。");
      continue;
    }
    const replacementTotal = replacements.reduce((sum, replacement) => sum + replacement.amountCents, 0n);
    if (replacementTotal > fact.amountCents) {
      mark("资金限制的替代金额超过释放金额，限制金额完整性冲突。");
    }
    for (const replacement of replacements) {
      const target = impactById.get(replacement.operatingImpactEntryId);
      if (
        !target ||
        target.fact.projectId !== fact.projectId ||
        target.fact.sourceType === fact.sourceType ||
        !config.replacementPairs.has(`${target.impact.impactKind}:${target.impact.direction}`) ||
        replacement.amountCents > target.impact.amountCents
      ) {
        mark("资金限制引用的替代正式影响不合格，限制金额完整性冲突。");
        continue;
      }
      replacementByTarget.set(
        replacement.operatingImpactEntryId,
        (replacementByTarget.get(replacement.operatingImpactEntryId) ?? 0n) + replacement.amountCents
      );
      if ((replacementByTarget.get(replacement.operatingImpactEntryId) ?? 0n) > target.impact.amountCents) {
        mark("同一正式影响被重复或超额用于解除资金限制，限制金额完整性冲突。");
      }
    }
  }

  if ([...restrictionByHolder.values(), ...restrictionByProject.values()].some((value) => value < 0n)) {
    mark("资金限制在持有主体或项目口径出现负余额，限制金额完整性冲突。");
  }
  const activeRestrictionByCanonicalHolder = new Map<string, bigint>();
  for (const [key, amount] of restrictionByHolder) {
    const canonicalHolderKey = key.slice(key.indexOf("\u0000") + 1);
    activeRestrictionByCanonicalHolder.set(
      canonicalHolderKey,
      (activeRestrictionByCanonicalHolder.get(canonicalHolderKey) ?? 0n) + amount
    );
  }
  for (const [holderKey, amount] of activeRestrictionByCanonicalHolder) {
    if (amount > nonNegative(holderCashBalances.get(holderKey) ?? 0n)) {
      mark("基准日有效资金限制超过同一持有主体可证明的项目现金，限制金额完整性冲突。");
    }
  }
  return { conflict, notices: [...notices], holderCashBalances, holderByImpactId };
}

function holderAliasKey(projectId: string, kind: string, id: string): string {
  return `${projectId}\u0000${kind}\u0000${id}`;
}

function resolveCanonicalHolder(
  fact: ProjectionFactInput,
  impact: ProjectionImpactInput,
  expectedKind: "construction_enterprise" | "participating_company",
  aliases: ReadonlyMap<string, string>,
  validateHolder: boolean
): string | null {
  const resolve = (id: string) => {
    const raw = holderAliasKey(fact.projectId, expectedKind, id);
    return aliases.get(raw) ?? (validateHolder ? null : raw);
  };
  if (impact.subjectKind || impact.subjectId) {
    return impact.subjectKind === expectedKind && impact.subjectId ? resolve(impact.subjectId) : null;
  }
  const candidates = new Set<string>();
  for (const subject of fact.subjectReferences ?? []) {
    if (subject.kind !== expectedKind || !subject.id) continue;
    const holder = resolve(subject.id);
    if (holder) candidates.add(holder);
  }
  if (expectedKind === "construction_enterprise" && fact.affiliateBusinessPartyVersionId) {
    const holder = resolve(fact.affiliateBusinessPartyVersionId);
    if (holder) candidates.add(holder);
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}

function canonicalHolderAliasMap(
  aliases: ProjectionHolderAliasInput[],
  maxAliases = Infinity
): Map<string, string> {
  const canonical = new Map<string, string>();
  const ordered = [...aliases].sort((left, right) => {
    const leftKey = holderAliasKey(left.projectId, left.kind, left.id);
    const rightKey = holderAliasKey(right.projectId, right.kind, right.id);
    return leftKey.localeCompare(rightKey) || left.canonicalId.localeCompare(right.canonicalId);
  });
  for (const alias of ordered) {
    const aliasKey = holderAliasKey(alias.projectId, alias.kind, alias.id);
    const canonicalKey = holderAliasKey(alias.projectId, alias.kind, alias.canonicalId);
    const existing = canonical.get(aliasKey);
    if (existing && existing !== canonicalKey) {
      throw new ProjectionResourceBudgetExceededError();
    }
    canonical.set(aliasKey, canonicalKey);
  }
  if (canonical.size > maxAliases) {
    throw new ProjectionResourceBudgetExceededError();
  }
  return canonical;
}

function sourceCoordinate(sourceType: string, sourceBusinessId: string): string {
  return `${sourceType}\u0000${sourceBusinessId}`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function jsonMoney(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value);
}

function replacementSnapshot(value: unknown): Array<{
  operatingImpactEntryId: string;
  amountCents: bigint;
}> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed = value.map((item) => {
    const record = jsonRecord(item);
    const operatingImpactEntryId = jsonText(record.operatingImpactEntryId);
    const amountCents = jsonMoney(record.amountCents);
    return operatingImpactEntryId && amountCents !== null && amountCents > 0n
      ? { operatingImpactEntryId, amountCents }
      : null;
  });
  return parsed.every((item): item is NonNullable<typeof item> => item !== null)
    ? parsed
    : null;
}

function sameReplacementSet(
  left: Array<{ operatingImpactEntryId: string; amountCents: bigint }>,
  right: Array<{ operatingImpactEntryId: string; amountCents: bigint }>
): boolean {
  const coordinate = (value: { operatingImpactEntryId: string; amountCents: bigint }) =>
    `${value.operatingImpactEntryId}\u0000${value.amountCents.toString()}`;
  const leftCoordinates = left.map(coordinate).sort();
  const rightCoordinates = right.map(coordinate).sort();
  return leftCoordinates.length === rightCoordinates.length &&
    leftCoordinates.every((value, index) => value === rightCoordinates[index]);
}

function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? "其他正式来源";
}

function factKindLabel(factKind: string): string {
  return OPERATING_FACT_KIND_LABELS[factKind as OperatingFactKind] ?? "其他经营事实";
}

function impactKindLabel(impactKind: string): string {
  return OPERATING_IMPACT_KIND_LABELS[impactKind as OperatingImpactKind] ?? "未知经营影响";
}

function sourceReferenceIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const record = snapshot as Record<string, unknown>;
  const keys = [
    "paymentRequestId",
    "paymentId",
    "expenseClaimId",
    "sourceExpenseClaimId",
    "projectExpenseRequestId",
    "fundMovementId",
    "reserveId",
    "disputeId"
  ];
  return Array.from(new Set(keys
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function factMatchesSubject(
  fact: ProjectionFactInput,
  impact: ProjectionImpactInput,
  kind: string,
  id: string
): boolean {
  if (impact.subjectKind || impact.subjectId) {
    if (impact.subjectKind === kind && impact.subjectId === id) return true;
    if (!["counterparty", "downstream_counterparty", "owner"].includes(kind)) {
      return false;
    }
  }
  if (kind === "construction_enterprise" && fact.affiliateBusinessPartyVersionId === id) {
    return true;
  }
  return fact.subjectReferences?.some((subject) => subject.kind === kind && subject.id === id) ?? false;
}

function matchesFilters(
  fact: ProjectionFactInput,
  impact: ProjectionImpactInput,
  filters: ProjectionFilters | undefined,
  constructionEnterpriseSubjectIds: string[] | undefined,
  companyEntityVersionIds: string[] | undefined
): boolean {
  if (!filters) return true;
  if (filters.sourceType && fact.sourceType !== filters.sourceType) return false;
  if (filters.costCategoryCode && impact.costCategoryCode !== filters.costCategoryCode) return false;
  if (filters.constructionEnterpriseId && ![
    filters.constructionEnterpriseId,
    ...(constructionEnterpriseSubjectIds ?? [])
  ].some((enterpriseSubjectId) =>
    factMatchesSubject(fact, impact, "construction_enterprise", enterpriseSubjectId)
  )) {
    return false;
  }
  if (filters.companyEntityId && ![
    filters.companyEntityId,
    ...(companyEntityVersionIds ?? [])
  ].some((companySubjectId) =>
    factMatchesSubject(fact, impact, "participating_company", companySubjectId)
  )) {
    return false;
  }
  if (filters.counterpartyId &&
      !factMatchesSubject(fact, impact, "downstream_counterparty", filters.counterpartyId) &&
      !factMatchesSubject(fact, impact, "owner", filters.counterpartyId) &&
      !factMatchesSubject(fact, impact, "counterparty", filters.counterpartyId)) {
    return false;
  }
  return true;
}

function selectFactImpacts(
  input: ReduceOperatingProjectionInput,
  fact: ProjectionFactInput
): { factSelected: boolean; matchingImpacts: ProjectionImpactInput[] } {
  const matchingImpacts = fact.impacts.filter((impact) =>
    matchesFilters(
      fact,
      impact,
      input.scope.filters,
      input.constructionEnterpriseSubjectIds,
      input.companyEntityVersionIds
    )
  );
  const hasImpactFilter = Boolean(
    input.scope.filters?.costCategoryCode ||
    input.scope.filters?.constructionEnterpriseId ||
    input.scope.filters?.companyEntityId ||
    input.scope.filters?.counterpartyId
  );
  return {
    matchingImpacts,
    factSelected: matchingImpacts.length > 0 || (
      !hasImpactFilter &&
      (!input.scope.filters?.sourceType || input.scope.filters.sourceType === fact.sourceType)
    )
  };
}

function riskCompleteness(risks: ProjectionRiskInput[]): ProjectionRiskInput["relationshipCompleteness"] {
  if (risks.some((risk) => risk.relationshipCompleteness === "integrity_conflict")) {
    return "integrity_conflict";
  }
  if (risks.some((risk) => risk.relationshipCompleteness === "legacy_unmodeled")) {
    return "legacy_unmodeled";
  }
  if (risks.some((risk) => risk.relationshipCompleteness === "coverage_incomplete")) {
    return "coverage_incomplete";
  }
  return "complete";
}

function relationshipCompletenessLabel(
  value: ProjectionRiskInput["relationshipCompleteness"]
): string {
  if (value === "complete") return "对账关系完整";
  if (value === "coverage_incomplete") return "仍有未覆盖待核对关系";
  if (value === "legacy_unmodeled") return "存在旧制未建模关系";
  return "对账或限制关系完整性冲突";
}

function clearingRiskStatusLabel(
  value: ProjectionRiskInput["items"][number]["status"]
): string {
  if (value === "open") return "待核对";
  if (value === "partially_resolved") return "部分已核定";
  if (value === "resolved") return "已核定";
  return "定义反向待纠正";
}

type StreamingFactState = {
  fact: ProjectionFactInput;
  selected: boolean;
  integritySelected: boolean;
  matchingImpactCount: number;
  matchingSignedImpactCents: bigint;
  cashNetCents: bigint;
  restrictionImpacts: ProjectionImpactInput[];
};

/**
 * Bounded aggregate reducer used by the authenticated API reader. A database
 * fact page is registered, its impact pages are folded immediately, and the
 * page is then released. Only aggregate values and the minimum restriction
 * coordinates needed for fail-closed validation survive between pages.
 */
export class OperatingProjectionStreamAccumulator {
  private readonly totals = new Map<OperatingImpactKind, bigint>();
  private readonly evidence = {
    A: { factCount: 0, amountCents: 0n },
    B: { factCount: 0, amountCents: 0n },
    C: { factCount: 0, amountCents: 0n }
  } satisfies Record<EvidenceLevel, { factCount: number; amountCents: bigint }>;
  private readonly sourceGroups = new Map<string, {
    factCount: number;
    impactCount: number;
    signedImpactCents: bigint;
  }>();
  private readonly selectedHolderCashBalances = new Map<string, bigint>();
  private readonly holderCashBalances = new Map<string, bigint>();
  private readonly sourceReferenceOutflows = new Map<string, bigint>();
  private readonly integrityFacts: ProjectionFactInput[] = [];
  private readonly stateByFactId = new Map<string, StreamingFactState>();
  private readonly notices = new Set<string>();
  private readonly holderAliasByKey: Map<string, string>;
  private moneyComplete = true;
  private restrictionConflict = false;
  private confirmedProjectInflowsCents = 0n;
  private confirmedProjectOutflowsCents = 0n;
  private retroactiveFactCount = 0;
  private integrityFactCount = 0;
  private integrityImpactCount = 0;

  constructor(private readonly context: {
    scope: ProjectionScopeInput;
    cutoffAt: string;
    collectSourceReferenceTotals?: boolean;
    maxIntegrityFacts?: number;
    maxIntegrityImpacts?: number;
    maxHolderAliases?: number;
    maxHolderCoordinates?: number;
    maxSourceReferenceTotals?: number;
    constructionEnterpriseSubjectIds?: string[];
    companyEntityVersionIds?: string[];
    holderAliases?: ProjectionHolderAliasInput[];
  }) {
    this.holderAliasByKey = canonicalHolderAliasMap(
      context.holderAliases ?? [],
      context.maxHolderAliases
    );
  }

  startFacts(facts: ProjectionFactInput[]): void {
    for (const fact of facts) {
      if (this.stateByFactId.has(fact.id)) throw new Error("经营投影事实页重复");
      const noImpactFilter = !(
        this.context.scope.filters?.costCategoryCode ||
        this.context.scope.filters?.constructionEnterpriseId ||
        this.context.scope.filters?.companyEntityId ||
        this.context.scope.filters?.counterpartyId
      );
      const sourceSelected = !this.context.scope.filters?.sourceType ||
        this.context.scope.filters.sourceType === fact.sourceType;
      const integrityFilters = subjectOnlyFilters(this.context.scope.filters);
      const integritySelected = Object.keys(integrityFilters).length === 0 ||
        projectionFactMatchesFilters(
          fact,
          {
            id: "",
            impactKind: "evidence_gap_notice",
            amountCents: 0n,
            direction: "notice"
          },
          integrityFilters,
          this.context.constructionEnterpriseSubjectIds,
          this.context.companyEntityVersionIds
        );
      this.stateByFactId.set(fact.id, {
        fact: { ...fact, impacts: [] },
        selected: noImpactFilter && sourceSelected,
        integritySelected,
        matchingImpactCount: 0,
        matchingSignedImpactCents: 0n,
        cashNetCents: 0n,
        restrictionImpacts: []
      });
    }
  }

  addImpacts(impacts: Array<ProjectionImpactInput & { factId: string }>): void {
    for (const impact of impacts) {
      const state = this.stateByFactId.get(impact.factId);
      if (!state) throw new Error("经营投影影响缺少当前事实页坐标");
      const fact = state.fact;
      const integritySelected = matchesFilters(
        fact,
        impact,
        subjectOnlyFilters(this.context.scope.filters),
        this.context.constructionEnterpriseSubjectIds,
        this.context.companyEntityVersionIds
      );
      if (integritySelected) state.integritySelected = true;
      // A displayed restriction must be checked against the complete same-project,
      // same-as-of holder ledger. Display filters must never remove its cash support.
      this.foldCashContext(fact, impact);

      if (RESTRICTION_SOURCE_CONFIG.has(fact.sourceType) && integritySelected) {
        this.integrityImpactCount += 1;
        if (this.integrityImpactCount > (this.context.maxIntegrityImpacts ?? Infinity)) {
          throw new ProjectionResourceBudgetExceededError();
        }
        state.restrictionImpacts.push(impact);
      }
      if (!matchesFilters(
        fact,
        impact,
        this.context.scope.filters,
        this.context.constructionEnterpriseSubjectIds,
        this.context.companyEntityVersionIds
      )) continue;

      state.selected = true;
      state.matchingImpactCount += 1;
      const kindKnown = IMPACT_KIND_SET.has(impact.impactKind);
      const directionKnown = IMPACT_DIRECTIONS.has(impact.direction);
      const signed = signedAmount(impact);
      if (!kindKnown || !directionKnown || signed === null) {
        this.markMoneyIncomplete("存在未知经营影响类型、方向或金额，金额投影已关闭。");
      }
      if (impact.direction === "notice" &&
          !NOTICE_IMPACT_KINDS.has(impact.impactKind as OperatingImpactKind)) {
        this.markMoneyIncomplete("金额影响被错误标记为仅提示，金额投影已关闭。");
      }
      const financialSigned = kindKnown && directionKnown && signed !== null &&
        impact.direction !== "notice" && fact.evidenceLevel !== "C"
          ? signed
          : null;
      const projectionSigned = kindKnown &&
        impact.impactKind === "contract_commitment_reference" &&
        impact.direction === "notice" && fact.evidenceLevel !== "C"
          ? impact.amountCents
          : financialSigned;
      if (projectionSigned === null) continue;
      const kind = impact.impactKind as OperatingImpactKind;
      this.totals.set(kind, (this.totals.get(kind) ?? 0n) + projectionSigned);
      state.matchingSignedImpactCents += projectionSigned;
      if (CASH_IMPACT_KINDS.has(kind)) {
        state.cashNetCents += projectionSigned;
        const holder = this.canonicalHolder(fact, impact, cashHolderKind(kind));
        if (holder) {
          this.addBoundedCoordinate(
            this.selectedHolderCashBalances,
            holder,
            projectionSigned,
            this.context.maxHolderCoordinates
          );
        }
      }
    }
  }

  finishFacts(): void {
    for (const state of this.stateByFactId.values()) {
      const fact = state.fact;
      if (state.selected) {
        if (!EVIDENCE_LEVEL_SET.has(fact.evidenceLevel)) {
          this.markMoneyIncomplete("经营事实使用未知证据等级，金额投影已关闭。");
        } else {
          const level = fact.evidenceLevel as EvidenceLevel;
          this.evidence[level].factCount += 1;
          this.evidence[level].amountCents += fact.amountCents;
        }
        if (fact.confirmedAt > this.context.cutoffAt) this.retroactiveFactCount += 1;
        if (state.matchingImpactCount > 0) {
          const group = this.sourceGroups.get(fact.sourceType) ?? {
            factCount: 0,
            impactCount: 0,
            signedImpactCents: 0n
          };
          group.factCount += 1;
          group.impactCount += state.matchingImpactCount;
          group.signedImpactCents += state.matchingSignedImpactCents;
          this.sourceGroups.set(fact.sourceType, group);
        }
        this.confirmedProjectInflowsCents += nonNegative(state.cashNetCents);
        this.confirmedProjectOutflowsCents += nonNegative(-state.cashNetCents);
        if (this.context.collectSourceReferenceTotals) {
          for (const sourceReferenceId of sourceReferenceIds(fact.sourceSnapshot)) {
            this.addBoundedCoordinate(
              this.sourceReferenceOutflows,
              sourceReferenceId,
              nonNegative(-state.cashNetCents),
              this.context.maxSourceReferenceTotals
            );
          }
        }
      }
      if (RESTRICTION_SOURCE_CONFIG.has(fact.sourceType) && state.integritySelected) {
        this.integrityFactCount += 1;
        if (this.integrityFactCount > (this.context.maxIntegrityFacts ?? Infinity)) {
          throw new ProjectionResourceBudgetExceededError();
        }
        this.integrityFacts.push(compactRestrictionIntegrityFact(
          fact,
          state.restrictionImpacts
        ));
      }
    }
    this.stateByFactId.clear();
  }

  result() {
    if (this.stateByFactId.size) throw new Error("经营投影事实页尚未归并完成");
    return {
      aggregateSeed: {
        totals: Object.fromEntries(this.totals),
        evidence: this.evidence,
        sourceGroups: Array.from(this.sourceGroups, ([sourceType, group]) => ({
          sourceType,
          ...group
        })),
        selectedHolderCashBalances: Array.from(this.selectedHolderCashBalances.entries()),
        confirmedProjectInflowsCents: this.confirmedProjectInflowsCents,
        confirmedProjectOutflowsCents: this.confirmedProjectOutflowsCents,
        sourceReferenceOutflows: Array.from(this.sourceReferenceOutflows.entries()),
        retroactiveFactCount: this.retroactiveFactCount,
        moneyComplete: this.moneyComplete,
        notices: [...this.notices]
      } satisfies ProjectionAggregateSeed,
      integrityFacts: this.integrityFacts,
      restrictionCashContext: {
        conflict: this.restrictionConflict,
        notices: [...this.notices].filter((notice) => notice.includes("资金完整性冲突")),
        holderCashBalances: Array.from(this.holderCashBalances.entries())
      }
    };
  }

  private foldCashContext(fact: ProjectionFactInput, impact: ProjectionImpactInput): void {
    if (fact.evidenceLevel === "C") return;
    const signed = signedAmount(impact);
    if (signed === null) return;
    const kind = IMPACT_KIND_SET.has(impact.impactKind)
      ? impact.impactKind as OperatingImpactKind
      : null;
    if (!kind || !CASH_IMPACT_KINDS.has(kind)) return;
    const holder = this.canonicalHolder(fact, impact, cashHolderKind(kind));
    if (!holder) {
      this.restrictionConflict = true;
      this.notices.add("实际项目资金缺少可核验的持有主体，资金完整性冲突。");
      return;
    }
    this.addBoundedCoordinate(
      this.holderCashBalances,
      holder,
      signed,
      this.context.maxHolderCoordinates
    );
  }

  private addBoundedCoordinate(
    target: Map<string, bigint>,
    key: string,
    amount: bigint,
    maxCoordinates: number | undefined
  ): void {
    if (!target.has(key) && target.size >= (maxCoordinates ?? Infinity)) {
      throw new ProjectionResourceBudgetExceededError();
    }
    target.set(key, (target.get(key) ?? 0n) + amount);
  }

  private canonicalHolder(
    fact: ProjectionFactInput, impact: ProjectionImpactInput,
    expectedKind: "construction_enterprise" | "participating_company"
  ): string | null {
    return resolveCanonicalHolder(fact, impact, expectedKind, this.holderAliasByKey,
      Boolean(this.context.holderAliases));
  }

  private markMoneyIncomplete(notice: string): void {
    this.moneyComplete = false;
    this.notices.add(notice);
  }
}

function compactRestrictionIntegrityFact(
  fact: ProjectionFactInput,
  impacts: ProjectionImpactInput[]
): ProjectionFactInput {
  const source = jsonRecord(fact.sourceSnapshot);
  const holder = jsonRecord(source.fundHolder);
  const compactSource = Object.fromEntries(Object.entries({
    schema: source.schema,
    entryId: source.entryId,
    reserveId: source.reserveId,
    disputeId: source.disputeId,
    sourceVersion: source.sourceVersion,
    businessCode: source.businessCode,
    entryKind: source.entryKind,
    adjustsEntryId: source.adjustsEntryId,
    adjustsEntryFingerprint: source.adjustsEntryFingerprint,
    amountCents: source.amountCents,
    evidenceLevel: source.evidenceLevel,
    fingerprint: source.fingerprint,
    confirmedAt: source.confirmedAt,
    economicIdentityKey: source.economicIdentityKey,
    sourceIdentityKey: source.sourceIdentityKey,
    replacementImpacts: source.replacementImpacts,
    fundHolder: Object.fromEntries(Object.entries({
      kind: holder.kind,
      id: holder.id
    }).filter(([, value]) => value !== undefined))
  }).filter(([, value]) => value !== undefined));
  return {
    id: fact.id,
    projectId: fact.projectId,
    projectCode: "",
    projectName: "",
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    sourceVersion: fact.sourceVersion,
    sourceBusinessCode: fact.sourceBusinessCode,
    occurredAt: fact.occurredAt,
    confirmedAt: fact.confirmedAt,
    affiliateBusinessPartyVersionId: fact.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: "",
    factKind: fact.factKind,
    operatingLevel: fact.operatingLevel,
    evidenceLevel: fact.evidenceLevel,
    amountCents: fact.amountCents,
    direction: fact.direction,
    sourceSnapshot: compactSource,
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId,
    subjectReferences: fact.subjectReferences,
    impacts: impacts.map((impact) => ({
      id: impact.id,
      impactKind: impact.impactKind,
      amountCents: impact.amountCents,
      direction: impact.direction,
      subjectRole: impact.subjectRole,
      subjectKind: impact.subjectKind,
      subjectId: impact.subjectId,
      impactSnapshot: Object.fromEntries(Object.entries({
        entryId: jsonRecord(impact.impactSnapshot).entryId,
        fingerprint: jsonRecord(impact.impactSnapshot).fingerprint,
        economicIdentityKey: jsonRecord(impact.impactSnapshot).economicIdentityKey,
        sourceIdentityKey: jsonRecord(impact.impactSnapshot).sourceIdentityKey
      }).filter(([, value]) => value !== undefined))
    }))
  };
}

function cashHolderKind(
  kind: OperatingImpactKind
): "construction_enterprise" | "participating_company" {
  return kind === "construction_enterprise_funds_increase" ||
    kind === "construction_enterprise_funds_decrease"
    ? "construction_enterprise"
    : "participating_company";
}

function subjectOnlyFilters(filters: ProjectionFilters | undefined): ProjectionFilters {
  return {
    ...(filters?.constructionEnterpriseId
      ? { constructionEnterpriseId: filters.constructionEnterpriseId }
      : {}),
    ...(filters?.companyEntityId ? { companyEntityId: filters.companyEntityId } : {}),
    ...(filters?.counterpartyId ? { counterpartyId: filters.counterpartyId } : {})
  };
}

export function reduceOperatingProjection(
  input: ReduceOperatingProjectionInput
): OperatingProjectionReadModel {
  const restrictionIntegrity = validateRestrictionIntegrity(input);
  const notices: string[] = [
    ...(input.aggregateSeed?.notices ?? []),
    ...restrictionIntegrity.notices
  ];
  let moneyComplete = (input.aggregateSeed?.moneyComplete ?? true) &&
    !restrictionIntegrity.conflict;
  const totals = new Map<OperatingImpactKind, bigint>(
    Object.entries(input.aggregateSeed?.totals ?? {}) as Array<[OperatingImpactKind, bigint]>
  );
  const evidence = input.aggregateSeed?.evidence ?? {
    A: { factCount: 0, amountCents: 0n },
    B: { factCount: 0, amountCents: 0n },
    C: { factCount: 0, amountCents: 0n }
  } satisfies Record<EvidenceLevel, { factCount: number; amountCents: bigint }>;
  const details: OperatingProjectionDetail[] = [];
  const sourceGroups = new Map<string, {
    projectId: string;
    sourceType: string;
    sourceBusinessId: string;
    sourceBusinessCode: string;
    factCount: number;
    impactCount: number;
    signedImpactCents: bigint;
  }>();
  for (const group of input.aggregateSeed?.sourceGroups ?? []) {
    sourceGroups.set(`stream\u0000${group.sourceType}`, {
      projectId: input.scope.projectIds[0] ?? "",
      sourceType: group.sourceType,
      sourceBusinessId: "",
      sourceBusinessCode: "",
      factCount: group.factCount,
      impactCount: group.impactCount,
      signedImpactCents: group.signedImpactCents
    });
  }
  const cashNetByFact = new Map<string, bigint>();
  const selectedHolderCashBalances = new Map<string, bigint>(
    input.aggregateSeed?.selectedHolderCashBalances ?? []
  );
  const sourceReferencesByFact = new Map<string, string[]>();
  let retroactiveFactCount = input.aggregateSeed?.retroactiveFactCount ?? 0;

  for (const fact of input.aggregateSeed ? [] : input.facts) {
    const { factSelected, matchingImpacts } = selectFactImpacts(input, fact);
    if (!factSelected) continue;
    const evidenceKnown = EVIDENCE_LEVEL_SET.has(fact.evidenceLevel);
    if (!evidenceKnown) {
      moneyComplete = false;
      notices.push("经营事实使用未知证据等级，金额投影已关闭。");
    }

    if (evidenceKnown) {
      const level = fact.evidenceLevel as EvidenceLevel;
      evidence[level].factCount += 1;
      evidence[level].amountCents += fact.amountCents;
    }
    const confirmedAfterAsOf = fact.confirmedAt > input.cutoffAt;
    sourceReferencesByFact.set(fact.id, sourceReferenceIds(fact.sourceSnapshot));
    if (confirmedAfterAsOf) retroactiveFactCount += 1;

    let sourceGroup: {
      projectId: string;
      sourceType: string;
      sourceBusinessId: string;
      sourceBusinessCode: string;
      factCount: number;
      impactCount: number;
      signedImpactCents: bigint;
    } | null = null;
    if (matchingImpacts.length > 0) {
      const groupKey = `${fact.projectId}\u0000${fact.sourceType}\u0000${fact.sourceBusinessId}`;
      sourceGroup = sourceGroups.get(groupKey) ?? {
        projectId: fact.projectId,
        sourceType: fact.sourceType,
        sourceBusinessId: fact.sourceBusinessId,
        sourceBusinessCode: fact.sourceBusinessCode,
        factCount: 0,
        impactCount: 0,
        signedImpactCents: 0n
      };
      sourceGroup.factCount += 1;
      sourceGroups.set(groupKey, sourceGroup);
    }
    for (const impact of matchingImpacts) {
      const kindKnown = IMPACT_KIND_SET.has(impact.impactKind);
      const directionKnown = IMPACT_DIRECTIONS.has(impact.direction);
      const signed = signedAmount(impact);
      if (!kindKnown || !directionKnown || signed === null) {
        moneyComplete = false;
        notices.push("存在未知经营影响类型、方向或金额，金额投影已关闭。");
      }
      if (impact.direction === "notice" &&
          !NOTICE_IMPACT_KINDS.has(impact.impactKind as OperatingImpactKind)) {
        moneyComplete = false;
        notices.push("金额影响被错误标记为仅提示，金额投影已关闭。");
      }
      const financialSigned = kindKnown && directionKnown && signed !== null &&
        impact.direction !== "notice" && fact.evidenceLevel !== "C"
          ? signed
          : null;
      const projectionSigned = kindKnown &&
        impact.impactKind === "contract_commitment_reference" &&
        impact.direction === "notice" &&
        fact.evidenceLevel !== "C"
          ? impact.amountCents
          : financialSigned;
      if (projectionSigned !== null) {
        const kind = impact.impactKind as OperatingImpactKind;
        totals.set(kind, (totals.get(kind) ?? 0n) + projectionSigned);
        if (CASH_IMPACT_KINDS.has(kind)) {
          cashNetByFact.set(fact.id, (cashNetByFact.get(fact.id) ?? 0n) + projectionSigned);
          const holder = restrictionIntegrity.holderByImpactId.get(impact.id);
          if (holder) {
            selectedHolderCashBalances.set(
              holder,
              (selectedHolderCashBalances.get(holder) ?? 0n) + projectionSigned
            );
          }
        }
      }
      sourceGroup!.impactCount += 1;
      sourceGroup!.signedImpactCents += projectionSigned ?? 0n;
      details.push({
        factId: fact.id,
        impactId: impact.id,
        projectId: fact.projectId,
        projectCode: fact.projectCode,
        projectName: fact.projectName,
        sourceType: fact.sourceType,
        sourceTypeLabel: sourceTypeLabel(fact.sourceType),
        sourceBusinessId: fact.sourceBusinessId,
        sourceBusinessCode: fact.sourceBusinessCode,
        factKind: fact.factKind,
        factKindLabel: factKindLabel(fact.factKind),
        evidenceLevel: fact.evidenceLevel,
        occurredAt: fact.occurredAt,
        confirmedAt: fact.confirmedAt,
        confirmedAfterAsOf,
        impactKind: impact.impactKind,
        impactKindLabel: impactKindLabel(impact.impactKind),
        direction: impact.direction,
        signedImpactCents: projectionSigned === null ? null : apiMoney(projectionSigned),
        subjectRole: impact.subjectRole ?? null,
        subjectKind: impact.subjectKind ?? null,
        subjectId: impact.subjectId ?? null,
        costCategoryCode: impact.costCategoryCode ?? null,
        fundPurpose: impact.fundPurpose ?? null,
        description: impact.description ?? null,
        sourceReferenceIds: sourceReferencesByFact.get(fact.id) ?? []
      });
    }
  }

  const total = (kind: OperatingImpactKind) => totals.get(kind) ?? 0n;
  const sumKinds = (...kinds: OperatingImpactKind[]) =>
    kinds.reduce((sum, kind) => sum + total(kind), 0n);
  const contractCommitment = total("contract_commitment_reference");
  const confirmedIncome = total("confirmed_income");
  const confirmedCost = total("confirmed_cost");
  const receivable = sumKinds("receivable_increase", "receivable_decrease");
  const payable = sumKinds("payable_increase", "payable_decrease");
  const constructionEnterpriseFunds = sumKinds(
    "construction_enterprise_funds_increase",
    "construction_enterprise_funds_decrease"
  );
  const companyProjectFunds = sumKinds(
    "company_project_funds_increase",
    "company_project_funds_decrease"
  );
  const companyAdvance = sumKinds(
    "company_advance_for_project_increase",
    "company_advance_for_project_decrease"
  );
  const companyReturnable = sumKinds(
    "company_returnable_to_project_increase",
    "company_returnable_to_project_decrease"
  );
  const interSubject = sumKinds(
    "inter_subject_balance_increase",
    "inter_subject_balance_decrease"
  );
  const estimatedClearing = total("estimated_clearing_expense");
  const necessaryReserve = sumKinds(
    "necessary_expense_reserve_increase",
    "necessary_expense_reserve_decrease"
  );
  const disputedFunds = sumKinds(
    "project_disputed_funds_increase",
    "project_disputed_funds_decrease"
  );
  const frozenFunds = sumKinds(
    "construction_enterprise_funds_freeze",
    "construction_enterprise_funds_release"
  );
  const temporaryDistribution = total("temporary_profit_distribution");
  const riskBreakdownConsistent = input.riskByProject.every((risk) => {
    if (risk.breakdownConsistent !== undefined) return risk.breakdownConsistent;
    if (
      risk.openPendingGrossCents === null ||
      risk.openCoveredCents === null ||
      risk.openUncoveredCents === null ||
      risk.continuedWithheldRetainedCents === null
    ) {
      return risk.items.length === 0 && risk.coveredWithheldSources.length === 0;
    }
    const itemTotals = risk.items.reduce((totals, item) => ({
      gross: totals.gross + item.openAmountCents,
      covered: totals.covered + item.openCoveredCents,
      uncovered: totals.uncovered + item.openUncoveredCents,
      itemConsistent: totals.itemConsistent &&
        item.openAmountCents === item.openCoveredCents + item.openUncoveredCents
    }), { gross: 0n, covered: 0n, uncovered: 0n, itemConsistent: true });
    const retained = risk.coveredWithheldSources.reduce(
      (sum, source) => sum + source.continuedRetainedCents,
      0n
    );
    const covered = risk.coveredWithheldSources.reduce(
      (sum, source) => sum + source.openCoveredCents,
      0n
    );
    return itemTotals.itemConsistent &&
      itemTotals.gross === risk.openPendingGrossCents &&
      itemTotals.covered === risk.openCoveredCents &&
      itemTotals.uncovered === risk.openUncoveredCents &&
      covered === risk.openCoveredCents &&
      retained === risk.continuedWithheldRetainedCents;
  });
  if (!riskBreakdownConsistent) {
    moneyComplete = false;
    notices.push("待核对风险汇总与逐项明细不一致，风险敏感金额不得展示。");
  }
  const relationshipCompleteness = restrictionIntegrity.conflict || !riskBreakdownConsistent
    ? "integrity_conflict"
    : riskCompleteness(input.riskByProject);
  const riskMoneyKnown = riskBreakdownConsistent && input.riskByProject.every((risk) =>
    risk.relationshipCompleteness !== "legacy_unmodeled" &&
    risk.relationshipCompleteness !== "integrity_conflict" &&
    risk.openPendingGrossCents !== null &&
    risk.openCoveredCents !== null &&
    risk.openUncoveredCents !== null &&
    risk.continuedWithheldRetainedCents !== null
  );
  if (!riskMoneyKnown) {
    moneyComplete = false;
    notices.push("待核对关系存在旧制未建模或完整性冲突，风险敏感金额不得按零展示。");
  }
  const sumRisk = (field: keyof Pick<ProjectionRiskInput,
    "openPendingGrossCents" | "openCoveredCents" | "openUncoveredCents" | "continuedWithheldRetainedCents">) =>
    riskMoneyKnown
      ? input.riskByProject.reduce((sum, risk) => sum + (risk[field] ?? 0n), 0n)
      : null;
  const openGross = sumRisk("openPendingGrossCents");
  const openCovered = sumRisk("openCoveredCents");
  const openUncovered = sumRisk("openUncoveredCents");
  const continuedRetained = sumRisk("continuedWithheldRetainedCents");
  const currentOperatingProfit = confirmedIncome - confirmedCost;
  const currentEstimatedProfit = currentOperatingProfit - estimatedClearing;
  const nonNegativeUsableCashStart = Array.from(
    selectedHolderCashBalances.values()
  ).reduce((sum, balance) => sum + nonNegative(balance), 0n);
  const confirmedProjectInflows = input.aggregateSeed?.confirmedProjectInflowsCents ??
    Array.from(cashNetByFact.values())
      .reduce((sum, value) => sum + nonNegative(value), 0n);
  const confirmedProjectOutflows = input.aggregateSeed?.confirmedProjectOutflowsCents ??
    Array.from(cashNetByFact.values())
      .reduce((sum, value) => sum + nonNegative(-value), 0n);
  const sourceReferenceOutflows = new Map<string, bigint>(
    input.aggregateSeed?.sourceReferenceOutflows ?? []
  );
  for (const [factId, netCash] of cashNetByFact) {
    for (const sourceReferenceId of sourceReferencesByFact.get(factId) ?? []) {
      sourceReferenceOutflows.set(
        sourceReferenceId,
        (sourceReferenceOutflows.get(sourceReferenceId) ?? 0n) + nonNegative(-netCash)
      );
    }
  }
  const projectedProfitCeiling = currentEstimatedProfit - temporaryDistribution;
  const cashCeiling = moneyComplete && openUncovered !== null
    ? nonNegative(
        nonNegativeUsableCashStart -
        nonNegative(payable) -
        nonNegative(estimatedClearing) -
        nonNegative(necessaryReserve) -
        nonNegative(disputedFunds) -
        nonNegative(frozenFunds) -
        nonNegative(openUncovered) -
        nonNegative(companyAdvance) -
        nonNegative(temporaryDistribution)
      )
    : null;
  const distributable = cashCeiling === null
    ? null
    : nonNegative(cashCeiling < projectedProfitCeiling ? cashCeiling : projectedProfitCeiling);
  const projectDistributionAvailable = input.scope.kind === "project";
  if (!projectDistributionAvailable) {
    notices.push("跨项目或公司视角只展示归属金额；项目可分配利润必须回到单项目投影读取。");
  }
  const impactTotalsByKind = Object.fromEntries(
    Array.from(totals.entries()).map(([kind, value]) => [kind, apiMoney(value)])
  ) as Partial<Record<OperatingImpactKind, string>>;
  const clearingRiskDetails = riskMoneyKnown ? input.riskByProject.flatMap((risk) => [
    ...risk.items.map((item) => ({
      projectId: risk.projectId,
      projectCode: risk.projectCode ?? "未知项目",
      projectName: risk.projectName ?? "未知项目",
      sourceBusinessCode: "待核对清分风险",
      impactKindLabel: "待核对未结金额",
      amountCents: apiMoney(item.openAmountCents),
      openPendingGrossCents: apiMoney(item.openAmountCents),
      openCoveredCents: apiMoney(item.openCoveredCents),
      openUncoveredCents: apiMoney(item.openUncoveredCents),
      continuedWithheldRetainedCents: "0",
      statusLabel: clearingRiskStatusLabel(item.status)
    })),
    ...risk.coveredWithheldSources
      .filter((source) => source.continuedRetainedCents > 0n)
      .map((source) => ({
        projectId: risk.projectId,
        projectCode: risk.projectCode ?? "未知项目",
        projectName: risk.projectName ?? "未知项目",
        sourceBusinessCode: "继续暂扣风险",
        impactKindLabel: "继续暂扣保留金额",
        amountCents: apiMoney(source.continuedRetainedCents),
        openPendingGrossCents: null,
        openCoveredCents: apiMoney(source.openCoveredCents),
        openUncoveredCents: null,
        continuedWithheldRetainedCents: apiMoney(source.continuedRetainedCents),
        statusLabel: "继续暂扣"
      }))
  ]) : [];
  const clearingRiskSourceDrilldown = riskMoneyKnown ? input.riskByProject.flatMap((risk) => [
    ...((risk.riskItemCount ?? risk.items.length) > 0 ? [{
      projectId: risk.projectId,
      sourceType: "clearing_reconciliation_pending_risk" as const,
      sourceTypeLabel: "施工企业清分",
      sourceBusinessCode: "待核对清分风险",
      factCount: 0 as const,
      impactCount: 0 as const,
      riskItemCount: risk.riskItemCount ?? risk.items.length,
      signedImpactCents: apiMoney(risk.riskItemGrossCents ??
        risk.items.reduce((sum, item) => sum + item.openAmountCents, 0n))
    }] : []),
    ...((risk.retainedSourceCount ?? risk.coveredWithheldSources.filter(
      (source) => source.continuedRetainedCents > 0n
    ).length) > 0
      ? [{
          projectId: risk.projectId,
          sourceType: "clearing_reconciliation_retained_risk" as const,
          sourceTypeLabel: "施工企业清分",
          sourceBusinessCode: "继续暂扣风险",
          factCount: 0 as const,
          impactCount: 0 as const,
          riskItemCount: risk.retainedSourceCount ?? risk.coveredWithheldSources.filter(
            (source) => source.continuedRetainedCents > 0n
          ).length,
          signedImpactCents: apiMoney(risk.retainedSourceCents ??
            risk.coveredWithheldSources.reduce(
              (sum, source) => sum + source.continuedRetainedCents,
              0n
            ))
        }]
      : [])
  ]) : [];

  return {
    schema: "operating_projection/V1",
    scope: input.scope,
    asOf: {
      basis: "occurred_at",
      businessDate: chinaBusinessDate(input.cutoffAt),
      cutoffAt: input.cutoffAt,
      readAt: input.readAt,
      retroactiveFactCount
    },
    integrity: {
      status: moneyComplete ? "complete" : "incomplete",
      moneyComplete,
      notices: Array.from(new Set(notices))
    },
    commitments: { contractCommitmentCents: apiMoney(contractCommitment) },
    operating: {
      confirmedIncomeCents: apiMoney(confirmedIncome),
      confirmedCostCents: apiMoney(confirmedCost),
      receivableCents: apiMoney(receivable),
      payableCents: apiMoney(payable)
    },
    actualFunds: {
      constructionEnterpriseFundsCents: apiMoney(constructionEnterpriseFunds),
      companyProjectFundsCents: apiMoney(companyProjectFunds),
      netProjectCashPositionCents: apiMoney(constructionEnterpriseFunds + companyProjectFunds),
      nonNegativeUsableCashStartCents: apiMoney(nonNegativeUsableCashStart),
      confirmedProjectInflowsCents: apiMoney(confirmedProjectInflows),
      confirmedProjectOutflowsCents: apiMoney(confirmedProjectOutflows),
      companyAdvanceForProjectCents: apiMoney(companyAdvance),
      companyReturnableToProjectCents: apiMoney(companyReturnable),
      interSubjectBalanceCents: apiMoney(interSubject)
    },
    restrictions: {
      estimatedClearingExpenseCents: apiMoney(estimatedClearing),
      necessaryExpenseReserveCents: apiMoney(necessaryReserve),
      projectDisputedFundsCents: apiMoney(disputedFunds),
      constructionEnterpriseFrozenFundsCents: apiMoney(frozenFunds),
      openPendingReconciliationGrossCents: openGross === null ? null : apiMoney(openGross),
      openCoveredReconciliationCents: openCovered === null ? null : apiMoney(openCovered),
      openUncoveredReconciliationCents: openUncovered === null ? null : apiMoney(openUncovered),
      continuedWithheldRetainedCents: continuedRetained === null ? null : apiMoney(continuedRetained),
      relationshipCompleteness,
      temporaryProfitDistributionCents: apiMoney(temporaryDistribution)
    },
    profitAndLoss: {
      currentOperatingProfitCents: apiMoney(currentOperatingProfit),
      estimatedClearingExpenseCents: apiMoney(estimatedClearing),
      currentEstimatedProfitCents: apiMoney(currentEstimatedProfit),
      finalConfirmedProfitCents: null,
      finalConfirmable: false
    },
    distribution: {
      cashCeilingCents: projectDistributionAvailable && cashCeiling !== null
        ? apiMoney(cashCeiling)
        : null,
      projectedProfitCeilingCents: apiMoney(projectedProfitCeiling),
      currentDistributableProfitCents:
        projectDistributionAvailable && distributable !== null
          ? apiMoney(distributable)
          : null
    },
    evidence: {
      A: { factCount: evidence.A.factCount, amountCents: apiMoney(evidence.A.amountCents) },
      B: { factCount: evidence.B.factCount, amountCents: apiMoney(evidence.B.amountCents) },
      C: { factCount: evidence.C.factCount, amountCents: apiMoney(evidence.C.amountCents) },
      gapFactCount: evidence.C.factCount,
      gapAmountCents: apiMoney(evidence.C.amountCents)
    },
    impactTotalsByKind,
    clearingRiskDetails,
    details: details.sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      left.impactId.localeCompare(right.impactId)
    ),
    sourceDrilldown: Array.from(sourceGroups.values())
      .map((group) => ({
        projectId: group.projectId,
        sourceType: group.sourceType,
        sourceTypeLabel: sourceTypeLabel(group.sourceType),
        sourceBusinessId: group.sourceBusinessId,
        sourceBusinessCode: group.sourceBusinessCode,
        factCount: group.factCount,
        impactCount: group.impactCount,
        signedImpactCents: apiMoney(group.signedImpactCents)
      }))
      .sort((left, right) =>
        left.projectId.localeCompare(right.projectId) ||
        left.sourceType.localeCompare(right.sourceType) ||
        left.sourceBusinessCode.localeCompare(right.sourceBusinessCode)
      ),
    clearingRiskSourceDrilldown,
    sourceReferenceTotals: Array.from(sourceReferenceOutflows.entries())
      .map(([sourceReferenceId, amount]) => ({
        sourceReferenceId,
        confirmedProjectOutflowCents: apiMoney(amount)
      }))
      .sort((left, right) =>
        left.sourceReferenceId.localeCompare(right.sourceReferenceId)
      )
  };
}
