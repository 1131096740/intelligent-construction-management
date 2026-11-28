import { FinancialCorrectionEntryService } from "./financial-correction-entry.service";

function serviceWith(overrides: Record<string, unknown>) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "finance-director-position" }]) },
    position: { findMany: jest.fn().mockResolvedValue([{ id: "finance-director-position", key: "finance_director" }]) },
    actualPurchaseBatch: {
      findFirst: jest.fn().mockResolvedValue({
        id: "batch-1",
        kind: "spot_material",
        supplierName: "合成供应商",
        status: "cost_confirmed",
        totalAmountCents: 1_000_000n,
        effectiveTotalAmountCents: 800_000n,
        costVersion: 2
      })
    },
    spotProcurementPayment: {
      findMany: jest.fn().mockResolvedValue([
        { id: "payment-1", approvalAmountCents: 1_000_000n, paidAmountCents: 1_000_000n, status: "paid" }
      ])
    },
    expenseClaim: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides
  };
  return { prisma, service: new FinancialCorrectionEntryService(prisma as never) };
}

describe("统一更正入口：实际采购批次", () => {
  it("gives finance the batch correction/refund actions and reports suspension only when the confirmed amount cannot cover paid or remaining payment", async () => {
    const { service } = serviceWith({});
    const capability = await service.capability("actual_purchase_batch", "batch-1", "finance-1");
    expect(capability).toMatchObject({
      type: "actual_purchase_batch",
      id: "batch-1",
      status: "cost_confirmed",
      actualPurchaseBatch: {
        totalAmountCents: "1000000",
        effectiveTotalAmountCents: "800000",
        paidAmountCents: "1000000",
        outstandingCommittedAmountCents: "0",
        overpaidAmountCents: "200000",
        suspended: true
      }
    });
    expect(capability.actions.map(action => action.key)).toEqual([
      "correct_actual_purchase_batch",
      "record_actual_purchase_batch_refund"
    ]);
    expect(capability.guidance).toContain("暂停");
  });

  it("does not pause when corrected amount still covers paid and remaining payment", async () => {
    const { service } = serviceWith({
      actualPurchaseBatch: {
        findFirst: jest.fn().mockResolvedValue({
          id: "batch-1", kind: "spot_material", supplierName: "合成供应商", status: "cost_confirmed",
          totalAmountCents: 1_000_000n, effectiveTotalAmountCents: 1_200_000n, costVersion: 2
        })
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-1", approvalAmountCents: 300_000n, paidAmountCents: 300_000n, status: "paid" },
          { id: "payment-2", approvalAmountCents: 700_000n, paidAmountCents: 0n, status: "approved_pending_payment" }
        ])
      }
    });
    const capability = await service.capability("actual_purchase_batch", "batch-1", "finance-1");
    expect((capability as { actualPurchaseBatch?: unknown }).actualPurchaseBatch).toMatchObject({ suspended: false, overpaidAmountCents: "0" });
    expect(capability.guidance).toContain("照常");
  });

  it("requires a confirmed cost before offering correction actions", async () => {
    const { service } = serviceWith({
      actualPurchaseBatch: {
        findFirst: jest.fn().mockResolvedValue({
          id: "batch-1", kind: "general", supplierName: "合成供应商", status: "recorded",
          totalAmountCents: 1_000_000n, effectiveTotalAmountCents: 1_000_000n, costVersion: 0
        })
      }
    });
    const capability = await service.capability("actual_purchase_batch", "batch-1", "finance-1");
    expect(capability.actions).toEqual([]);
    expect(capability.guidance).toContain("尚未确认");
  });
});
