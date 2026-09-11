export type ProjectFundDisputeProjectionIntegrity = "complete" | "integrity_conflict";

export type ProjectFundDisputeProjectionHolderKind =
  | "construction_enterprise"
  | "participating_company";

export interface ProjectFundDisputeProjectionHolderInput {
  holderKind: ProjectFundDisputeProjectionHolderKind;
  holderId: string;
  isValid: boolean;
  usableProjectCashCents: string;
}

export interface ProjectFundDisputeProjectionImpactInput {
  id: string;
  occurredAt: string;
  confirmedAt: string;
  impactKind:
    | "project_disputed_funds_increase"
    | "project_disputed_funds_decrease";
  direction: "increase" | "decrease";
  amountCents: string;
  holderKind: ProjectFundDisputeProjectionHolderKind;
  holderId: string;
  sourceFingerprint: string;
  ledgerFingerprint: string;
  replacementWithinCapacity: boolean;
}

export interface ProjectFundDisputeProjectionInput {
  asOf: string;
  holders: ProjectFundDisputeProjectionHolderInput[];
  impacts: ProjectFundDisputeProjectionImpactInput[];
}

export interface ProjectFundDisputeProjectionResult {
  asOf: string;
  retroactiveFactCount: number;
  project: {
    integrity: ProjectFundDisputeProjectionIntegrity;
    disputedFundsCents: string | null;
  };
  holders: Array<{
    holderKind: ProjectFundDisputeProjectionHolderKind;
    holderId: string;
    integrity: ProjectFundDisputeProjectionIntegrity;
    disputedFundsCents: string | null;
    usableProjectCashCents: string | null;
  }>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/u;

function holderKey(holderKind: ProjectFundDisputeProjectionHolderKind, holderId: string) {
  return `${holderKind}:${holderId}`;
}

function isValidDateOnly(value: string) {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isRetroactive(confirmedAt: string, asOf: string) {
  const confirmed = new Date(confirmedAt);
  if (Number.isNaN(confirmed.valueOf())) return null;
  return confirmed.valueOf() > new Date(`${asOf}T15:59:59.999Z`).valueOf();
}

function conflictResult(
  asOf: string,
  retroactiveFactCount: number,
  holders: ProjectFundDisputeProjectionHolderInput[]
): ProjectFundDisputeProjectionResult {
  return {
    asOf,
    retroactiveFactCount,
    project: { integrity: "integrity_conflict", disputedFundsCents: null },
    holders: holders.map((holder) => ({
      holderKind: holder.holderKind,
      holderId: holder.holderId,
      integrity: "integrity_conflict",
      disputedFundsCents: null,
      usableProjectCashCents: NON_NEGATIVE_INTEGER.test(holder.usableProjectCashCents)
        ? holder.usableProjectCashCents
        : null
    }))
  };
}

export function reduceProjectFundDisputeProjection(
  input: ProjectFundDisputeProjectionInput
): ProjectFundDisputeProjectionResult {
  const holders = [...input.holders].sort((left, right) =>
    holderKey(left.holderKind, left.holderId).localeCompare(holderKey(right.holderKind, right.holderId))
  );
  if (!isValidDateOnly(input.asOf)) return conflictResult(input.asOf, 0, holders);

  const holderBalances = new Map<string, bigint>();
  const holderSnapshots = new Map<string, ProjectFundDisputeProjectionHolderInput>();
  let invalid = false;
  for (const holder of holders) {
    const key = holderKey(holder.holderKind, holder.holderId);
    if (
      holderSnapshots.has(key)
      || !holder.holderId.trim()
      || !holder.isValid
      || !NON_NEGATIVE_INTEGER.test(holder.usableProjectCashCents)
    ) {
      invalid = true;
    }
    holderSnapshots.set(key, holder);
    holderBalances.set(key, 0n);
  }

  let retroactiveFactCount = 0;
  const impactIds = new Set<string>();
  for (const impact of input.impacts) {
    if (!isValidDateOnly(impact.occurredAt)) {
      invalid = true;
      continue;
    }
    if (impact.occurredAt > input.asOf) continue;
    const retroactive = isRetroactive(impact.confirmedAt, input.asOf);
    if (retroactive === null) invalid = true;
    else if (retroactive) retroactiveFactCount += 1;

    const key = holderKey(impact.holderKind, impact.holderId);
    const fingerprintsMatch =
      SHA256.test(impact.sourceFingerprint)
      && SHA256.test(impact.ledgerFingerprint)
      && impact.sourceFingerprint === impact.ledgerFingerprint;
    const sign =
      impact.impactKind === "project_disputed_funds_increase"
        ? impact.direction === "increase" ? 1n : -1n
        : impact.impactKind === "project_disputed_funds_decrease" && impact.direction === "decrease"
          ? -1n
          : null;
    if (
      !impact.id.trim()
      || impactIds.has(impact.id)
      || !holderSnapshots.has(key)
      || !POSITIVE_INTEGER.test(impact.amountCents)
      || !fingerprintsMatch
      || !impact.replacementWithinCapacity
      || sign === null
    ) {
      invalid = true;
      continue;
    }
    impactIds.add(impact.id);
    holderBalances.set(key, (holderBalances.get(key) ?? 0n) + sign * BigInt(impact.amountCents));
  }

  let projectTotal = 0n;
  for (const [key, balance] of holderBalances) {
    const holder = holderSnapshots.get(key);
    if (!holder || balance < 0n || balance > BigInt(holder.usableProjectCashCents)) invalid = true;
    projectTotal += balance;
  }
  if (projectTotal < 0n || invalid) {
    return conflictResult(input.asOf, retroactiveFactCount, holders);
  }

  return {
    asOf: input.asOf,
    retroactiveFactCount,
    project: { integrity: "complete", disputedFundsCents: projectTotal.toString() },
    holders: holders.map((holder) => {
      const key = holderKey(holder.holderKind, holder.holderId);
      return {
        holderKind: holder.holderKind,
        holderId: holder.holderId,
        integrity: "complete" as const,
        disputedFundsCents: (holderBalances.get(key) ?? 0n).toString(),
        usableProjectCashCents: holder.usableProjectCashCents
      };
    })
  };
}
