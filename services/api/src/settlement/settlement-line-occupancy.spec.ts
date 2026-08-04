import { Prisma } from "@prisma/client";
import {
  loadSettlementLineOccupancy,
  SETTLEMENT_LINE_OCCUPANCY_STATUSES
} from "./settlement-line-occupancy";

describe("settlement line occupancy statuses", () => {
  it("uses the shared legacy-compatible occupancy set", () => {
    expect(SETTLEMENT_LINE_OCCUPANCY_STATUSES).toEqual([
      "in_approval",
      "approval_pending",
      "pending_generation",
      "approved_pending_archive",
      "archive_pending",
      "pending_archive_confirm",
      "effective",
      "partially_paid",
      "paid"
    ]);
  });
});

describe("loadSettlementLineOccupancy", () => {
  it("adds the activation carry-forward to current-version effective settlement occupancy", async () => {
    const occupancy = await loadSettlementLineOccupancy({
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-v2" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          contractBillRowId: "row-v2",
          quantity: new Prisma.Decimal("10"),
          amountCents: 1000n
        }])
      },
      contractBillRowCarryForward: {
        findMany: jest.fn().mockResolvedValue([{
          contractBillRowId: "row-v2",
          lineageId: "lineage-1",
          priorSettledQuantity: new Prisma.Decimal("30"),
          priorSettledAmountCents: 3000n,
          sourceSnapshotHash: "a".repeat(64),
          updatedAt: new Date("2026-07-27T00:00:00.000Z")
        }])
      }
    }, "version-2", [{ id: "row-v2", lineageId: "lineage-1" }]);

    expect(occupancy.get("row-v2")).toMatchObject({
      quantity: new Prisma.Decimal("40"),
      amountCents: 4000n,
      quantityComplete: true,
      count: 2,
      sourceSnapshotToken: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
  });

  it("separates reversible occupancy from cumulative irreversible history", async () => {
    const occupancy = await loadSettlementLineOccupancy({
      settlement: {
        findMany: jest.fn().mockImplementation(({ where }: {
          where: { status: { in: readonly string[] } };
        }) => Promise.resolve(
          where.status.in.includes("in_approval")
            ? [{ id: "settlement-in-approval" }]
            : [{ id: "settlement-effective" }]
        ))
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          id: "line-effective",
          settlementId: "settlement-effective",
          contractBillRowId: "row-v2",
          quantity: new Prisma.Decimal("10"),
          amountCents: 1000n
        }, {
          id: "line-in-approval",
          settlementId: "settlement-in-approval",
          contractBillRowId: "row-v2",
          quantity: new Prisma.Decimal("10"),
          amountCents: 1000n
        }])
      },
      contractBillRowCarryForward: {
        findMany: jest.fn().mockResolvedValue([{
          contractBillRowId: "row-v2",
          lineageId: "lineage-1",
          priorSettledQuantity: new Prisma.Decimal("30"),
          priorSettledAmountCents: 3000n,
          sourceSnapshotHash: "a".repeat(64),
          updatedAt: new Date("2026-07-27T00:00:00.000Z")
        }])
      }
    }, "version-2", [{ id: "row-v2", lineageId: "lineage-1" }], {
      mode: "irreversible_history"
    });

    expect(occupancy.get("row-v2")).toMatchObject({
      quantity: new Prisma.Decimal("40"),
      amountCents: 4000n,
      quantityComplete: true,
      count: 2,
      hasReversibleOccupancy: true,
      sourceSnapshotToken: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
  });

  it("returns the stable lineage error when a V2 row has no carry-forward snapshot", async () => {
    await expect(loadSettlementLineOccupancy({
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      settlementLine: { findMany: jest.fn() },
      contractBillRowCarryForward: { findMany: jest.fn().mockResolvedValue([]) }
    }, "version-2", [{ id: "row-v2", lineageId: "lineage-1" }])).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
  });

  it("changes a legacy row snapshot token when equal totals come from a different immutable line", async () => {
    const load = (lineId: string) => loadSettlementLineOccupancy({
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-legacy" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          id: lineId,
          settlementId: "settlement-legacy",
          contractBillRowId: "legacy-row",
          quantity: new Prisma.Decimal("10"),
          amountCents: 1000n
        }])
      }
    }, "version-legacy", [{ id: "legacy-row", lineageId: null }]);

    const first = await load("line-a");
    const second = await load("line-b");

    expect(first.get("legacy-row")?.quantity.toString()).toBe("10");
    expect(second.get("legacy-row")?.amountCents).toBe(1000n);
    expect(first.get("legacy-row")?.sourceSnapshotToken)
      .not.toBe(second.get("legacy-row")?.sourceSnapshotToken);
  });
});
