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

  it("returns the stable lineage error when a V2 row has no carry-forward snapshot", async () => {
    await expect(loadSettlementLineOccupancy({
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      settlementLine: { findMany: jest.fn() },
      contractBillRowCarryForward: { findMany: jest.fn().mockResolvedValue([]) }
    }, "version-2", [{ id: "row-v2", lineageId: "lineage-1" }])).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
  });
});
