import { describe, expect, it } from "vitest";

import { reduceNecessaryExpenseReserveProjection } from "./necessary-expense-reserve-projection";

const holder = {
  holderKind: "construction_enterprise" as const,
  holderId: "holder-1",
  isValid: true,
  usableProjectCashCents: "1000"
};

function impact(input: Partial<Parameters<typeof reduceNecessaryExpenseReserveProjection>[0]["impacts"][number]> = {}) {
  return {
    id: "impact-1",
    occurredAt: "2026-09-01",
    confirmedAt: "2026-09-03T02:00:00.000Z",
    impactKind: "necessary_expense_reserve_increase" as const,
    direction: "increase" as const,
    amountCents: "400",
    holderKind: "construction_enterprise" as const,
    holderId: "holder-1",
    sourceFingerprint: "a".repeat(64),
    ledgerFingerprint: "a".repeat(64),
    replacementWithinCapacity: true,
    ...input
  };
}

describe("necessary expense reserve typed-impact projection", () => {
  it("replays current and as-of balances by occurred date and exposes retroactive facts", () => {
    const impacts = [
      impact(),
      impact({
        id: "impact-2",
        occurredAt: "2026-09-05",
        confirmedAt: "2026-09-05T03:00:00.000Z",
        amountCents: "150"
      })
    ];

    expect(reduceNecessaryExpenseReserveProjection({
      asOf: "2026-09-01",
      holders: [holder],
      impacts
    })).toEqual({
      asOf: "2026-09-01",
      retroactiveFactCount: 1,
      project: { integrity: "complete", necessaryReserveCents: "400" },
      holders: [{
        holderKind: "construction_enterprise",
        holderId: "holder-1",
        integrity: "complete",
        necessaryReserveCents: "400",
        usableProjectCashCents: "1000"
      }]
    });

    expect(reduceNecessaryExpenseReserveProjection({
      asOf: "2026-09-06",
      holders: [holder],
      impacts
    }).project).toEqual({ integrity: "complete", necessaryReserveCents: "550" });
  });

  it.each([
    ["negative balance", [impact({ direction: "decrease", amountCents: "401" })], [holder]],
    ["restriction exceeds cash", [impact({ amountCents: "1001" })], [holder]],
    ["invalid holder", [impact()], [{ ...holder, isValid: false }]],
    ["source and ledger fingerprint differ", [impact({ ledgerFingerprint: "b".repeat(64) })], [holder]],
    ["replacement is over capacity", [impact({ replacementWithinCapacity: false })], [holder]]
  ])("returns integrity_conflict without leaking source details for %s", (_name, impacts, holders) => {
    const result = reduceNecessaryExpenseReserveProjection({
      asOf: "2026-09-06",
      holders,
      impacts
    });

    expect(result.project).toEqual({
      integrity: "integrity_conflict",
      necessaryReserveCents: null
    });
    expect(result.holders[0]).toEqual(expect.objectContaining({
      integrity: "integrity_conflict",
      necessaryReserveCents: null
    }));
    expect(JSON.stringify(result)).not.toMatch(/impact-1|fingerprint|evidence|reason/iu);
  });
});
