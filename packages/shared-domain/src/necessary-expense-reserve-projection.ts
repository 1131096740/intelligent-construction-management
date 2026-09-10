export type NecessaryExpenseReserveProjectionIntegrity = "complete" | "integrity_conflict";

export type NecessaryExpenseReserveProjectionHolderKind =
  | "construction_enterprise"
  | "participating_company";

export interface NecessaryExpenseReserveProjectionHolderInput {
  holderKind: NecessaryExpenseReserveProjectionHolderKind;
  holderId: string;
  isValid: boolean;
  usableProjectCashCents: string;
}

export interface NecessaryExpenseReserveProjectionImpactInput {
  id: string;
  occurredAt: string;
  confirmedAt: string;
  impactKind:
    | "necessary_expense_reserve_increase"
    | "necessary_expense_reserve_decrease";
  direction: "increase" | "decrease";
  amountCents: string;
  holderKind: NecessaryExpenseReserveProjectionHolderKind;
  holderId: string;
  sourceFingerprint: string;
  ledgerFingerprint: string;
  replacementWithinCapacity: boolean;
}

export interface NecessaryExpenseReserveProjectionInput {
  asOf: string;
  holders: NecessaryExpenseReserveProjectionHolderInput[];
  impacts: NecessaryExpenseReserveProjectionImpactInput[];
}

export interface NecessaryExpenseReserveProjectionResult {
  asOf: string;
  retroactiveFactCount: number;
  project: {
    integrity: NecessaryExpenseReserveProjectionIntegrity;
    necessaryReserveCents: string | null;
  };
  holders: Array<{
    holderKind: NecessaryExpenseReserveProjectionHolderKind;
    holderId: string;
    integrity: NecessaryExpenseReserveProjectionIntegrity;
    necessaryReserveCents: string | null;
    usableProjectCashCents: string | null;
  }>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/u;

function holderKey(holderKind: NecessaryExpenseReserveProjectionHolderKind, holderId: string) {
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
  holders: NecessaryExpenseReserveProjectionHolderInput[]
): NecessaryExpenseReserveProjectionResult {
  return {
    asOf,
    retroactiveFactCount,
    project: { integrity: "integrity_conflict", necessaryReserveCents: null },
    holders: holders.map((holder) => ({
      holderKind: holder.holderKind,
      holderId: holder.holderId,
      integrity: "integrity_conflict",
      necessaryReserveCents: null,
      usableProjectCashCents: NON_NEGATIVE_INTEGER.test(holder.usableProjectCashCents)
        ? holder.usableProjectCashCents
        : null
    }))
  };
}

export function reduceNecessaryExpenseReserveProjection(
  input: NecessaryExpenseReserveProjectionInput
): NecessaryExpenseReserveProjectionResult {
  const holders = [...input.holders].sort((left, right) =>
    holderKey(left.holderKind, left.holderId).localeCompare(holderKey(right.holderKind, right.holderId))
  );
  if (!isValidDateOnly(input.asOf)) return conflictResult(input.asOf, 0, holders);

  const holderBalances = new Map<string, bigint>();
  const holderSnapshots = new Map<string, NecessaryExpenseReserveProjectionHolderInput>();
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
      impact.impactKind === "necessary_expense_reserve_increase"
        ? impact.direction === "increase" ? 1n : -1n
        : impact.impactKind === "necessary_expense_reserve_decrease" && impact.direction === "decrease"
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
    project: { integrity: "complete", necessaryReserveCents: projectTotal.toString() },
    holders: holders.map((holder) => {
      const key = holderKey(holder.holderKind, holder.holderId);
      return {
        holderKind: holder.holderKind,
        holderId: holder.holderId,
        integrity: "complete" as const,
        necessaryReserveCents: (holderBalances.get(key) ?? 0n).toString(),
        usableProjectCashCents: holder.usableProjectCashCents
      };
    })
  };
}
