import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectFundingAvailabilityService } from "./project-funding-availability.service";

function transactionMock(options: {
  receipts?: bigint[];
  upstreamFundFacts?: Array<{
    amountCents: bigint;
    effectDirection: "increase" | "decrease";
  }>;
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
  allQuotas?: Array<{
    id: string;
    amountCents: bigint;
    status: "approval_pending" | "approved" | "rejected" | "terminated";
  }>;
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
    reversalKey: row.direction === "credit" ? "existing-reversal" : "original",
    reason: null,
    ...row
  }));
  const persistedQuotas = options.allQuotas ?? (options.quotas ?? []).map((quota) => ({
    ...quota,
    status: "approved" as const
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
    projectUpstreamFundFact: {
      findMany: jest.fn().mockResolvedValue(options.upstreamFundFacts ?? [])
    },
    projectFinancingQuota: {
      findMany: jest.fn().mockResolvedValue(
        persistedQuotas.map((quota) => ({
          ...quota,
          requestedByUserId: "finance-1",
          approvedByUserId:
            quota.status === "approved" || quota.status === "terminated"
              ? "chairman-1"
              : null,
          approvedAt:
            quota.status === "approved" || quota.status === "terminated"
              ? new Date("2026-07-27T00:00:00.000Z")
              : null
        }))
      )
    },
    approvalInstance: {
      findMany: jest.fn().mockResolvedValue(persistedQuotas.map((quota) => ({
        id: `approval-${quota.id}`,
        businessId: quota.id,
        applicantUserId: "finance-1",
        status: "approved",
        currentNodeIndex: 2,
        frozenNodes: [
          {
            name: "财务主管",
            mode: "any",
            roleKeys: ["finance_director"],
            approvedRoleKeys: ["finance_director"]
          },
          {
            name: "董事长/总经理",
            mode: "any",
            roleKeys: ["chairman", "general_manager"],
            approvedRoleKeys: ["chairman"]
          }
        ],
        createdAt: new Date("2026-07-27T00:00:00.000Z"),
        updatedAt: new Date("2026-07-27T00:00:00.000Z")
      })))
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
        {
          id: expect.any(String),
          sourceType: "project_cash",
          sourceId: null,
          amountCents: 8_000n
        },
        {
          id: expect.any(String),
          sourceType: "financing_quota",
          sourceId: "quota-1",
          amountCents: 4_000n
        }
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

  it("counts only confirmed affiliate remittances as self-owned project cash", async () => {
    const tx = transactionMock({
      receipts: [4_000n],
      upstreamFundFacts: [
        { amountCents: 8_000n, effectDirection: "increase" },
        { amountCents: 1_000n, effectDirection: "decrease" }
      ]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 11_000n }
    )).resolves.toMatchObject({
      projectCashAmountCents: 11_000n,
      financingQuotaAmountCents: 0n
    });
    expect(tx.projectUpstreamFundFact.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        factType: "affiliate_remittance_to_company",
        status: "confirmed"
      },
      select: { amountCents: true, effectDirection: true }
    });
  });

  it("fails closed when upstream cash facts or immutable allocation history are inconsistent", async () => {
    const negativeCashTx = transactionMock({
      upstreamFundFacts: [
        { amountCents: 1n, effectDirection: "increase" },
        { amountCents: 2n, effectDirection: "decrease" }
      ]
    });
    await expect(service.allocateExecution(
      negativeCashTx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 1n }
    )).rejects.toThrow("项目自有资金到账净额不能为负，请先核对资金事实");
    expect(negativeCashTx.projectFundingAllocation.createMany).not.toHaveBeenCalled();

    const cashOverdrawnTx = transactionMock({
      receipts: [5_000n],
      quotas: [{ id: "quota-1", amountCents: 20_000n }],
      allocations: [{
        id: "cash-overdrawn",
        executionType: "project_expense_execution",
        executionId: "old-execution",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 10_000n,
        reversalOfAllocationId: null
      }]
    });
    await expect(service.allocateExecution(
      cashOverdrawnTx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 1n }
    )).rejects.toThrow("项目自有资金占用超过当前确认资金来源");
    expect(cashOverdrawnTx.projectFundingAllocation.createMany).not.toHaveBeenCalled();

    const quotaOverdrawnTx = transactionMock({
      quotas: [{ id: "quota-1", amountCents: 5_000n }],
      allocations: [{
        id: "quota-overdrawn",
        executionType: "project_expense_execution",
        executionId: "old-execution",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "debit",
        amountCents: 10_000n,
        reversalOfAllocationId: null
      }]
    });
    await expect(service.allocateExecution(
      quotaOverdrawnTx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 1n }
    )).rejects.toThrow("项目垫资额度占用超过批准金额");
    expect(quotaOverdrawnTx.projectFundingAllocation.createMany).not.toHaveBeenCalled();

    expect(() => service.summarizeAllocations([
      {
        id: "orphan-credit",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        businessType: "payment_request",
        businessId: "payment-1",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "credit",
        amountCents: 1n,
        occurredAt: execution.occurredAt,
        createdByUserId: "finance-1",
        reversalOfAllocationId: "missing-debit",
        reversalKey: "refund-1",
        reason: "错误冲销"
      }
    ])).toThrow("项目资金分配账本冲销金额超过原始占用");

    expect(() => service.summarizeAllocations([
      {
        id: "cash-debit",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        businessType: "payment_request",
        businessId: "payment-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 2n,
        occurredAt: execution.occurredAt,
        createdByUserId: "finance-1",
        reversalOfAllocationId: null,
        reversalKey: "original",
        reason: null
      },
      {
        id: "quota-debit",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        businessType: "payment_request",
        businessId: "payment-1",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "debit",
        amountCents: 2n,
        occurredAt: execution.occurredAt,
        createdByUserId: "finance-1",
        reversalOfAllocationId: null,
        reversalKey: "original",
        reason: null
      },
      {
        id: "cross-source-credit",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        businessType: "payment_request",
        businessId: "payment-1",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "credit",
        amountCents: 1n,
        occurredAt: execution.occurredAt,
        createdByUserId: "finance-1",
        reversalOfAllocationId: "cash-debit",
        reversalKey: "refund-2",
        reason: "错误跨来源冲销"
      }
    ])).toThrow("项目资金分配账本冲销记录与原始占用不一致");
  });

  it("blocks new funding when a terminated historical quota is already overdrawn", async () => {
    const tx = transactionMock({
      quotas: [{ id: "quota-new", amountCents: 20_000n }],
      allQuotas: [
        { id: "quota-old", amountCents: 5_000n, status: "terminated" },
        { id: "quota-new", amountCents: 20_000n, status: "approved" }
      ],
      allocations: [{
        id: "quota-old-overdrawn",
        executionType: "project_expense_execution",
        executionId: "old-execution",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-old",
        sourceId: "quota-old",
        direction: "debit",
        amountCents: 5_001n,
        reversalOfAllocationId: null
      }]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 1n }
    )).rejects.toThrow("项目垫资额度占用超过批准金额");
    expect(tx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("blocks an approved quota whose approval lifecycle instance is missing", async () => {
    const tx = transactionMock({
      quotas: [{ id: "quota-without-approval", amountCents: 20_000n }]
    });
    tx.approvalInstance.findMany.mockResolvedValue([]);

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 1n }
    )).rejects.toThrow("项目垫资额度缺少生命周期审批实例");
    expect(tx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("rejects allocations backed by a quota that was never approved", () => {
    expect(() => service.assertFundingLedgerCoverage({
      receipts: [],
      affiliateRemittances: [],
      quotas: [{
        id: "quota-pending",
        amountCents: 5_000n,
        status: "approval_pending"
      }],
      allocations: [{
        id: "pending-quota-debit",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        businessType: "payment_request",
        businessId: "payment-1",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-pending",
        sourceId: "quota-pending",
        direction: "debit",
        amountCents: 1n,
        occurredAt: execution.occurredAt,
        createdByUserId: "finance-1",
        reversalOfAllocationId: null,
        reversalKey: "original",
        reason: null
      }]
    })).toThrow("项目垫资额度资金账本引用了未批准额度");
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
        {
          id: "existing",
          sourceType: "project_cash",
          sourceId: null,
          amountCents: 12_000n
        }
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

  it("partially reverses financing before cash and never credits more than the original execution", async () => {
    const tx = transactionMock({
      allocations: [{
        id: "cash-original",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 8_000n,
        reversalOfAllocationId: null
      }, {
        id: "quota-original",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-1",
        sourceId: "quota-1",
        direction: "debit",
        amountCents: 4_000n,
        reversalOfAllocationId: null
      }]
    });

    await service.reverseExecution(
      tx as unknown as Prisma.TransactionClient,
      {
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        amountCents: 1_000n,
        occurredAt: new Date("2026-07-28T08:00:00.000Z"),
        reversalKey: "refund-1",
        reason: "供应商退款到账",
        actorUserId: "finance-1"
      }
    );

    expect(tx.projectFundingAllocation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        sourceType: "financing_quota",
        reversalOfAllocationId: "quota-original",
        amountCents: 1_000n,
        occurredAt: new Date("2026-07-28T08:00:00.000Z")
      })]
    });

    const overCreditTx = transactionMock({
      allocations: [{
        id: "cash-original",
        executionType: "payment_execution",
        executionId: "execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 8_000n,
        reversalOfAllocationId: null
      }]
    });
    await expect(service.reverseExecution(
      overCreditTx as unknown as Prisma.TransactionClient,
      {
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-1",
        amountCents: 8_001n,
        reversalKey: "refund-too-large",
        reason: "错误退款金额",
        actorUserId: "finance-1"
      }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(overCreditTx.projectFundingAllocation.createMany).not.toHaveBeenCalled();
  });

  it("restores refunded funding only through reversal credits, not a second cash receipt", async () => {
    const tx = transactionMock({
      receipts: [10_000n],
      refunds: [1_000n],
      allocations: [{
        id: "cash-used",
        executionType: "spot_procurement_payment_execution",
        executionId: "spot-execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "debit",
        amountCents: 8_000n,
        reversalOfAllocationId: null
      }, {
        id: "cash-refund",
        executionType: "spot_procurement_payment_execution",
        executionId: "spot-execution-1",
        sourceType: "project_cash",
        sourceKey: "project_cash",
        sourceId: null,
        direction: "credit",
        amountCents: 1_000n,
        reversalOfAllocationId: "cash-used"
      }]
    });

    await expect(service.allocateExecution(
      tx as unknown as Prisma.TransactionClient,
      { ...execution, amountCents: 4_000n }
    )).rejects.toEqual(expect.objectContaining<Partial<BadRequestException>>({
      message: "项目可用资金不足，当前最多可实际支付 3000 分"
    }));
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
