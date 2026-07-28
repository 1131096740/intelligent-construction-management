import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectFundingAvailabilityService } from "./project-funding-availability.service";

function transactionMock(options: {
  receipts?: bigint[];
  refunds?: bigint[];
  allocations?: Array<{
    id: string;
    executionType: string;
    executionId: string;
    sourceType: string;
    sourceKey: string;
    sourceId: string | null;
    direction: string;
    amountCents: bigint;
    reversalOfAllocationId: string | null;
  }>;
  project?: { id: string; isActive: boolean };
  quotas?: Array<{ id: string; amountCents: bigint }>;
} = {}) {
  const allocations = (options.allocations ?? []).map((row) => ({
    projectId: "project-1",
    businessType: row.executionType === "payment_execution"
      ? "payment_request"
      : "other_payment",
    businessId: row.executionType === "payment_execution"
      ? "payment-1"
      : "other-payment-1",
    occurredAt: new Date("2026-07-27T00:00:00.000Z"),
    createdByUserId: "finance-1",
    reversalKey: "original",
    reason: null,
    ...row
  }));
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([options.project ?? { id: "project-1", isActive: true }])
      .mockResolvedValueOnce(options.quotas ?? []),
    projectReceipt: {
      findMany: jest.fn().mockResolvedValue(
        (options.receipts ?? []).map((amountCents) => ({ amountCents }))
      )
    },
    spotProcurement: {
      findMany: jest.fn().mockResolvedValue(
        options.refunds?.length ? [{ id: "procurement-1" }] : []
      )
    },
    spotProcurementRefund: {
      findMany: jest.fn().mockResolvedValue(
        (options.refunds ?? []).map((amountCents) => ({ amountCents }))
      )
    },
    projectFundingAllocation: {
      findMany: jest.fn().mockImplementation(({ where }: {
        where: { executionType?: string; executionId?: string; projectId?: string };
      }) => Promise.resolve(
        where.executionType
          ? allocations.filter((row) =>
              row.executionType === where.executionType &&
              row.executionId === where.executionId
            )
          : allocations
      )),
      createMany: jest.fn().mockResolvedValue({ count: 0 })
    }
  };
}

const execution = {
  projectId: "project-1",
  executionType: "payment_execution" as const,
  executionId: "execution-1",
  businessType: "payment_request",
  businessId: "payment-1",
  amountCents: 12_000n,
  occurredAt: new Date("2026-07-28T00:00:00.000Z"),
  actorUserId: "finance-1"
};

describe("ProjectFundingAvailabilityService", () => {
  const service = new ProjectFundingAvailabilityService();

  it("allocates self-owned cash first and fills only the shortfall from financing quotas", async () => {
    const tx = transactionMock({
      receipts: [10_000n],
      quotas: [{ id: "quota-1", amountCents: 5_000n }],
      allocations: [{
        id: "cash-used",
        executionType: "project_expense_execution",
        executionId: "old-execution",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 2_000n,
        reversalOfAllocationId: null
      }, {
        id: "quota-used",
        executionType: "spot_procurement_payment_execution",
        executionId: "old-spot-execution",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "debit",
        amountCents: 1_000n,
        reversalOfAllocationId: null
      }]
    });

    const result = await service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      execution
    );

    expect(result).toEqual({
      kind: "allocated",
      projectCashAmountCents: 8_000n,
      financingQuotaAmountCents: 4_000n,
      allocations: [
        { sourceType: "project_cash", sourceId: null, amountCents: 8_000n },
        { sourceType: "financing_quota", sourceId: "quota-1", amountCents: 4_000n }
      ]
    });
    expect(tx.projectFundingAllocation.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          executionId: "execution-1",
          sourceKey: "project_cash",
          amountCents: 8_000n
        }),
        expect.objectContaining({
          executionId: "execution-1",
          sourceKey: "financing_quota:quota-1",
          amountCents: 4_000n
        })
      ])
    });
  });

  it("fails without writing when total available project funding is insufficient", async () => {
    const tx = transactionMock({
      receipts: [1_000n],
      quotas: [{ id: "quota-1", amountCents: 2_000n }]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      execution
    )).rejects.toEqual(expect.objectContaining<Partial<BadRequestException>>({
      message: "项目可用资金不足，当前最多可实际支付 3000 分"
    }));
    expect(tx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("replays the same execution allocation without occupying funding twice", async () => {
    const tx = transactionMock({
      allocations: [{
        id: "existing",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 12_000n,
        reversalOfAllocationId: null
      }]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      execution
    )).resolves.toEqual({
      kind: "replayed",
      projectCashAmountCents: 12_000n,
      financingQuotaAmountCents: 0n,
      allocations: [
        { sourceType: "project_cash", sourceId: null, amountCents: 12_000n }
      ]
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("rejects an execution id replay whose amount no longer matches", async () => {
    const tx = transactionMock({
      allocations: [{
        id: "existing",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 11_999n,
        reversalOfAllocationId: null
      }]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      execution
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("appends reversal credits and never updates or deletes the original allocation", async () => {
    const tx = transactionMock({
      allocations: [{
        id: "original",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 12_000n,
        reversalOfAllocationId: null
      }]
    });

    await service.reverseExecution(
      tx as unknown as Prisma.TransactionClient,
      {
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        reversalKey: "refund-1",
        reason: "付款退款到账",
        actorUserId: "finance-1"
      }
    );

    expect(tx.projectFundingAllocation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        direction: "credit",
        reversalOfAllocationId: "original",
        reversalKey: "refund-1",
        amountCents: 12_000n
      })]
    });
    expect(tx.projectFundingAllocation).not.toHaveProperty("update");
    expect(tx.projectFundingAllocation).not.toHaveProperty("delete");
  });

  it("excludes owner direct payments from self-owned project cash", async () => {
    const tx = transactionMock({ receipts: [12_000n] });

    await service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      execution
    );

    expect(tx.projectReceipt.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        voidedAt: null,
        sourceType: { in: ["general_contractor_payment", "other"] }
      },
      select: { amountCents: true }
    });
  });
});
