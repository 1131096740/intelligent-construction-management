import type { RoleKey } from "./roles";

export const CLEARING_EVENT_KINDS = Object.freeze([
  "estimated",
  "withheld",
  "pending_reconciliation",
  "final_confirmed",
  "supplemental",
  "returned",
  "coverage_added",
  "continued_withheld",
  "technical_reversal"
] as const);

export type ClearingEventKind = (typeof CLEARING_EVENT_KINDS)[number];

export const CLEARING_WORKFLOW_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "confirmed",
  "returned",
  "cancelled"
] as const);

export type ClearingWorkflowStatus = (typeof CLEARING_WORKFLOW_STATUSES)[number];

export const CLEARING_CATEGORIES = Object.freeze([
  "management_fee",
  "final_tax",
  "deposit",
  "insurance_fee",
  "service_fee",
  "assigned_management_salary",
  "other_controlled_deduction"
] as const);

export type ClearingCategory = (typeof CLEARING_CATEGORIES)[number];

export const CLEARING_ACTIONS = Object.freeze([
  "read",
  "prepare",
  "submit",
  "attest",
  "confirm",
  "return",
  "reopen",
  "reconciliation.reverse"
] as const);

export type ClearingAction = (typeof CLEARING_ACTIONS)[number];

const CLEARING_ACTION_ROLES = Object.freeze({
  read: ["finance_staff", "finance_director"],
  prepare: ["finance_staff", "finance_director"],
  submit: ["finance_staff", "finance_director"],
  attest: ["finance_staff", "finance_director"],
  confirm: ["finance_director"],
  return: ["finance_director"],
  reopen: ["finance_director"],
  "reconciliation.reverse": ["finance_director"]
} as const satisfies Readonly<Record<ClearingAction, readonly RoleKey[]>>);

export function clearingActionRoles(action: ClearingAction): readonly RoleKey[] {
  return CLEARING_ACTION_ROLES[action];
}

export function isClearingEventKind(value: unknown): value is ClearingEventKind {
  return CLEARING_EVENT_KINDS.includes(value as ClearingEventKind);
}

export function isClearingWorkflowStatus(
  value: unknown
): value is ClearingWorkflowStatus {
  return CLEARING_WORKFLOW_STATUSES.includes(value as ClearingWorkflowStatus);
}

export function isClearingCategory(value: unknown): value is ClearingCategory {
  return CLEARING_CATEGORIES.includes(value as ClearingCategory);
}

export type ClearingReconciliationCompleteness =
  | "complete"
  | "coverage_incomplete"
  | "legacy_unmodeled"
  | "integrity_conflict";

export interface ClearingReconciliationRevisionProjection {
  id: string;
  itemId: string;
  decisionEventVersionId: string;
  adoptsLegacyPendingEventVersionId: string | null;
  revisionNo: number;
  kind: "open" | "replace";
  amountCents: bigint;
  replacesRevisionId: string | null;
  correctsDefinitionReversalId?: string | null;
  confirmedAt: string;
  effectiveCaseRevision: number;
}

export interface ClearingReconciliationCoverageProjection {
  id: string;
  reconciliationRevisionId: string;
  withheldEventVersionId: string;
  amountCents: bigint;
  confirmedAt: string;
  effectiveCaseRevision: number;
}

export interface ClearingReconciliationResolutionProjection {
  id: string;
  reconciliationRevisionId: string;
  itemId: string;
  entryKind: "resolution" | "technical_reversal";
  resultKind: "final_confirmed" | "real_return" | "continued_withheld";
  amountCents: bigint;
  reversesResolutionId: string | null;
  confirmedAt: string;
  effectiveCaseRevision: number;
}

export interface ClearingReconciliationResolutionLineProjection {
  id: string;
  resolutionId: string;
  sourceKind: "withheld_coverage" | "authority_cap" | "prior_economic_event";
  coverageId: string | null;
  amountCents: bigint;
  reversesResolutionLineId: string | null;
}

export interface ClearingReconciliationDefinitionReversalProjection {
  id: string;
  targetRevisionId: string;
  confirmedAt: string;
  effectiveCaseRevision: number;
}

export interface ClearingLegacyPendingProjection {
  eventVersionId: string;
  confirmedAt: string;
}

export interface ClearingReconciliationRiskInput {
  asOf: string;
  legacyPendingEvents: readonly ClearingLegacyPendingProjection[];
  revisions: readonly ClearingReconciliationRevisionProjection[];
  coverages: readonly ClearingReconciliationCoverageProjection[];
  resolutions: readonly ClearingReconciliationResolutionProjection[];
  resolutionLines: readonly ClearingReconciliationResolutionLineProjection[];
  definitionReversals: readonly ClearingReconciliationDefinitionReversalProjection[];
}

export interface ClearingReconciliationItemRiskProjection {
  itemId: string;
  currentRevisionId: string;
  openAmountCents: bigint;
  openCoveredCents: bigint;
  openUncoveredCents: bigint;
  status: "open" | "partially_resolved" | "resolved" | "definition_reversed_error";
}

export interface ClearingReconciliationRiskProjection {
  asOf: string;
  relationshipCompleteness: ClearingReconciliationCompleteness;
  openPendingGrossCents: bigint | null;
  openCoveredCents: bigint | null;
  openUncoveredCents: bigint | null;
  continuedWithheldRetainedCents: bigint | null;
  coveredWithheldSources: ReadonlyArray<{
    withheldEventVersionId: string;
    openCoveredCents: bigint;
    continuedRetainedCents: bigint;
  }>;
  items: readonly ClearingReconciliationItemRiskProjection[];
}

export function reduceClearingReconciliationRisk(
  input: ClearingReconciliationRiskInput
): ClearingReconciliationRiskProjection {
  const asOfMillis = Date.parse(input.asOf);
  const conflict = (): ClearingReconciliationRiskProjection => ({
    asOf: input.asOf,
    relationshipCompleteness: "integrity_conflict",
    openPendingGrossCents: null,
    openCoveredCents: null,
    openUncoveredCents: null,
    continuedWithheldRetainedCents: null,
    coveredWithheldSources: [],
    items: []
  });
  if (!Number.isFinite(asOfMillis)) return conflict();
  const visible = <T extends { confirmedAt: string; effectiveCaseRevision?: number }>(row: T) => {
    const confirmedMillis = Date.parse(row.confirmedAt);
    return Number.isFinite(confirmedMillis) && confirmedMillis <= asOfMillis;
  };
  const compareEffective = <T extends { confirmedAt: string; effectiveCaseRevision: number; id: string }>(
    left: T,
    right: T
  ) => Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt)
    || left.effectiveCaseRevision - right.effectiveCaseRevision
    || left.id.localeCompare(right.id);

  const revisions = input.revisions.filter(visible).slice().sort(compareEffective);
  const reversals = input.definitionReversals.filter(visible).slice().sort(compareEffective);
  const revisionById = new Map(revisions.map((row) => [row.id, row]));
  const reversalById = new Map(reversals.map((row) => [row.id, row]));
  if (revisionById.size !== revisions.length || reversalById.size !== reversals.length) {
    return conflict();
  }
  const reversedRevisionIds = new Set<string>();
  const currentByItem = new Map<string, ClearingReconciliationRevisionProjection>();
  const seenByItem = new Map<string, ClearingReconciliationRevisionProjection[]>();
  const definitionReversedItems = new Set<string>();
  const definitionEvents = [
    ...revisions.map((row) => ({ eventType: "revision" as const, row })),
    ...reversals.map((row) => ({ eventType: "reversal" as const, row }))
  ].sort((left, right) => compareEffective(left.row, right.row));
  for (const event of definitionEvents) {
    if (event.eventType === "reversal") {
      const target = revisionById.get(event.row.targetRevisionId);
      if (
        !target ||
        reversedRevisionIds.has(target.id) ||
        currentByItem.get(target.itemId)?.id !== target.id
      ) {
        return conflict();
      }
      reversedRevisionIds.add(target.id);
      const restored = (seenByItem.get(target.itemId) ?? [])
        .filter((candidate) => !reversedRevisionIds.has(candidate.id))
        .sort((left, right) => right.revisionNo - left.revisionNo)[0];
      if (restored) {
        currentByItem.set(target.itemId, restored);
        definitionReversedItems.delete(target.itemId);
      } else {
        currentByItem.delete(target.itemId);
        definitionReversedItems.add(target.itemId);
      }
      continue;
    }

    const revision = event.row;
    const seen = seenByItem.get(revision.itemId) ?? [];
    if (
      revision.amountCents <= 0n ||
      !Number.isInteger(revision.revisionNo) ||
      revision.revisionNo !== seen.length + 1
    ) {
      return conflict();
    }
    if (revision.kind === "open") {
      if (revision.revisionNo !== 1 || revision.replacesRevisionId !== null) return conflict();
    } else {
      const replaced = revision.replacesRevisionId
        ? revisionById.get(revision.replacesRevisionId)
        : undefined;
      const current = currentByItem.get(revision.itemId);
      const correctedReversal = revision.correctsDefinitionReversalId
        ? reversalById.get(revision.correctsDefinitionReversalId)
        : undefined;
      const correctsReversedFirstDefinition =
        !current &&
        replaced?.revisionNo === 1 &&
        correctedReversal?.targetRevisionId === replaced.id;
      if (
        !replaced ||
        replaced.itemId !== revision.itemId ||
        (current?.id !== replaced.id && !correctsReversedFirstDefinition)
      ) {
        return conflict();
      }
    }
    seen.push(revision);
    seenByItem.set(revision.itemId, seen);
    currentByItem.set(revision.itemId, revision);
    definitionReversedItems.delete(revision.itemId);
  }

  const modeledPendingIds = new Set<string>();
  for (const revision of revisions) {
    modeledPendingIds.add(revision.decisionEventVersionId);
    if (revision.adoptsLegacyPendingEventVersionId) {
      modeledPendingIds.add(revision.adoptsLegacyPendingEventVersionId);
    }
  }
  if (input.legacyPendingEvents.filter(visible).some((row) => !modeledPendingIds.has(row.eventVersionId))) {
    return {
      ...conflict(),
      relationshipCompleteness: "legacy_unmodeled"
    };
  }

  const resolutions = input.resolutions.filter(visible).slice().sort(compareEffective);
  const resolutionById = new Map(resolutions.map((row) => [row.id, row]));
  const allResolutionIds = new Set(input.resolutions.map((row) => row.id));
  if (resolutionById.size !== resolutions.length) return conflict();
  const linesByResolution = new Map<string, ClearingReconciliationResolutionLineProjection[]>();
  for (const line of input.resolutionLines) {
    const resolution = resolutionById.get(line.resolutionId);
    if (!resolution) {
      if (!allResolutionIds.has(line.resolutionId)) return conflict();
      continue;
    }
    if (line.amountCents <= 0n) return conflict();
    const bucket = linesByResolution.get(line.resolutionId) ?? [];
    bucket.push(line);
    linesByResolution.set(line.resolutionId, bucket);
  }

  const reversedResolutionAmount = new Map<string, bigint>();
  const reversedLineAmount = new Map<string, bigint>();
  for (const resolution of resolutions) {
    const lines = linesByResolution.get(resolution.id) ?? [];
    if (lines.reduce((sum, line) => sum + line.amountCents, 0n) !== resolution.amountCents) {
      return conflict();
    }
    if (resolution.entryKind === "resolution") {
      if (resolution.reversesResolutionId !== null || lines.some((line) => line.reversesResolutionLineId !== null)) {
        return conflict();
      }
      continue;
    }
    const target = resolution.reversesResolutionId
      ? resolutionById.get(resolution.reversesResolutionId)
      : undefined;
    if (!target || target.entryKind !== "resolution" || target.itemId !== resolution.itemId
      || target.reconciliationRevisionId !== resolution.reconciliationRevisionId
      || target.resultKind !== resolution.resultKind) {
      return conflict();
    }
    const nextResolutionReversal = (reversedResolutionAmount.get(target.id) ?? 0n) + resolution.amountCents;
    if (nextResolutionReversal > target.amountCents) return conflict();
    reversedResolutionAmount.set(target.id, nextResolutionReversal);
    for (const line of lines) {
      const targetLine = line.reversesResolutionLineId
        ? input.resolutionLines.find((candidate) => candidate.id === line.reversesResolutionLineId)
        : undefined;
      if (!targetLine || targetLine.resolutionId !== target.id || targetLine.sourceKind !== line.sourceKind
        || targetLine.coverageId !== line.coverageId) {
        return conflict();
      }
      const nextLineReversal = (reversedLineAmount.get(targetLine.id) ?? 0n) + line.amountCents;
      if (nextLineReversal > targetLine.amountCents) return conflict();
      reversedLineAmount.set(targetLine.id, nextLineReversal);
    }
  }

  const coverageById = new Map(input.coverages.filter(visible).map((row) => [row.id, row]));
  if (coverageById.size !== input.coverages.filter(visible).length) return conflict();
  const openByCoverage = new Map<string, bigint>();
  const retainedByCoverage = new Map<string, bigint>();
  for (const coverage of coverageById.values()) {
    if (coverage.amountCents <= 0n || !revisionById.has(coverage.reconciliationRevisionId)) return conflict();
    openByCoverage.set(coverage.id, coverage.amountCents);
    retainedByCoverage.set(coverage.id, 0n);
  }
  for (const resolution of resolutions) {
    if (resolution.entryKind !== "resolution" || reversedRevisionIds.has(resolution.reconciliationRevisionId)) continue;
    for (const line of linesByResolution.get(resolution.id) ?? []) {
      if (line.sourceKind !== "withheld_coverage" || !line.coverageId) continue;
      if (!coverageById.has(line.coverageId)) return conflict();
      const net = line.amountCents - (reversedLineAmount.get(line.id) ?? 0n);
      if (net < 0n) return conflict();
      openByCoverage.set(line.coverageId, (openByCoverage.get(line.coverageId) ?? 0n) - net);
      if (resolution.resultKind === "continued_withheld") {
        retainedByCoverage.set(line.coverageId, (retainedByCoverage.get(line.coverageId) ?? 0n) + net);
      }
    }
  }
  if ([...openByCoverage.values()].some((amount) => amount < 0n)) return conflict();

  let openPendingGrossCents = 0n;
  let openCoveredCents = 0n;
  const items: ClearingReconciliationItemRiskProjection[] = [];
  for (const [itemId, revision] of currentByItem) {
    const resolved = resolutions
      .filter((row) => row.entryKind === "resolution" && row.reconciliationRevisionId === revision.id)
      .reduce((sum, row) => sum + row.amountCents - (reversedResolutionAmount.get(row.id) ?? 0n), 0n);
    const openAmountCents = revision.amountCents - resolved;
    if (openAmountCents < 0n) return conflict();
    const itemCoveredCents = [...coverageById.values()]
      .filter((coverage) => coverage.reconciliationRevisionId === revision.id)
      .reduce((sum, coverage) => sum + (openByCoverage.get(coverage.id) ?? 0n), 0n);
    if (itemCoveredCents > openAmountCents) return conflict();
    openPendingGrossCents += openAmountCents;
    openCoveredCents += itemCoveredCents;
    items.push({
      itemId,
      currentRevisionId: revision.id,
      openAmountCents,
      openCoveredCents: itemCoveredCents,
      openUncoveredCents: openAmountCents - itemCoveredCents,
      status: openAmountCents === 0n
        ? "resolved"
        : openAmountCents === revision.amountCents
          ? "open"
          : "partially_resolved"
    });
  }
  for (const itemId of definitionReversedItems) {
    if (!currentByItem.has(itemId)) {
      items.push({
        itemId,
        currentRevisionId: "",
        openAmountCents: 0n,
        openCoveredCents: 0n,
        openUncoveredCents: 0n,
        status: "definition_reversed_error"
      });
    }
  }

  const sourceTotals = new Map<string, { openCoveredCents: bigint; continuedRetainedCents: bigint }>();
  for (const coverage of coverageById.values()) {
    if (reversedRevisionIds.has(coverage.reconciliationRevisionId)) continue;
    const isCurrent = currentByItem.get(revisionById.get(coverage.reconciliationRevisionId)?.itemId ?? "")?.id
      === coverage.reconciliationRevisionId;
    const current = sourceTotals.get(coverage.withheldEventVersionId) ?? {
      openCoveredCents: 0n,
      continuedRetainedCents: 0n
    };
    if (isCurrent) current.openCoveredCents += openByCoverage.get(coverage.id) ?? 0n;
    current.continuedRetainedCents += retainedByCoverage.get(coverage.id) ?? 0n;
    sourceTotals.set(coverage.withheldEventVersionId, current);
  }
  const continuedWithheldRetainedCents = [...sourceTotals.values()]
    .reduce((sum, row) => sum + row.continuedRetainedCents, 0n);
  const openUncoveredCents = openPendingGrossCents - openCoveredCents;
  return {
    asOf: new Date(asOfMillis).toISOString(),
    relationshipCompleteness: openUncoveredCents === 0n ? "complete" : "coverage_incomplete",
    openPendingGrossCents,
    openCoveredCents,
    openUncoveredCents,
    continuedWithheldRetainedCents,
    coveredWithheldSources: [...sourceTotals]
      .map(([withheldEventVersionId, amounts]) => ({ withheldEventVersionId, ...amounts }))
      .sort((left, right) => left.withheldEventVersionId.localeCompare(right.withheldEventVersionId)),
    items: items.sort((left, right) => left.itemId.localeCompare(right.itemId))
  };
}
