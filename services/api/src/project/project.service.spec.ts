import { NotFoundException } from "@nestjs/common";
import { ProjectService } from "./project.service";

describe("ProjectService", () => {
  it("lists all active project options for global funds overview positions", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-finance" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-finance", key: "finance_director" }])
      },
      projectMember: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1", code: "JG-001", name: "总部综合楼" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listActiveOptions("finance-user")).resolves.toEqual([
      { id: "project-1", code: "JG-001", name: "总部综合楼" }
    ]);
    expect(prisma.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "finance-user", projectId: null }
    });
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("lists only scoped active projects for project funds overview positions", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ projectId: "project-2", positionId: "position-manager" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-manager", key: "project_manager" }])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "employee" },
          { projectId: "project-3", positionKey: "finance_staff" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-2", code: "JG-002", name: "二标段" },
          { id: "project-3", code: "JG-003", name: "三标段" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listActiveOptions("scoped-user")).resolves.toEqual([
      { id: "project-2", code: "JG-002", name: "二标段" },
      { id: "project-3", code: "JG-003", name: "三标段" }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true, id: { in: ["project-2", "project-3"] } },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("returns no project options for employees without funds overview positions", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ projectId: "project-1", positionId: "position-employee" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-employee", key: "employee" }])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-2", positionKey: "employee" }])
      },
      project: {
        findMany: jest.fn()
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listActiveOptions("employee-user")).resolves.toEqual([]);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it("aggregates operating funds overview from existing tables only", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "JG-001",
          name: "总部综合楼"
        })
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1" },
          { id: "contract-2" }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { contractId: "contract-1", versionNo: 1, amountCents: BigInt(10000000) },
          { contractId: "contract-2", versionNo: 1, amountCents: BigInt(25000000) }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          { status: "effective", amountCents: 8000000, payableAmountCents: 6400000 },
          { status: "effective", amountCents: 12000000, payableAmountCents: 9600000 },
          { status: "approval_pending", amountCents: 5000000, payableAmountCents: 4000000 }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            status: "approval_pending",
            requestedAmountCents: 3000000,
            approvedAmountCents: null
          },
          {
            id: "payment-2",
            status: "approved_pending_payment",
            requestedAmountCents: 5000000,
            approvedAmountCents: 4800000
          },
          {
            id: "payment-3",
            status: "paid",
            requestedAmountCents: 2000000,
            approvedAmountCents: 2000000
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 1000000 },
          { amountCents: 2000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 900000 },
          { amountCents: 1900000 }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).resolves.toEqual({
      project: { id: "project-1", code: "JG-001", name: "总部综合楼" },
      cash: {
        actualReceiptsCents: null,
        availableFundsCents: null,
        actualPaidCents: 3000000,
        approvalPendingOccupancyCents: 3000000,
        approvedPendingPaymentCents: 4800000,
        financeRecordedOutflowCents: 2800000
      },
      business: {
        effectiveContractAmountCents: 35000000,
        effectiveSettlementAmountCents: 20000000,
        payableSettlementAmountCents: 16000000,
        operatingIncomeCents: null,
        operatingCostCents: null,
        grossProfitCents: null
      },
      counts: { contracts: 2, settlements: 3, payments: 3 },
      dataGaps: [
        "缺少项目实际收款台账，暂不能计算实际收款和可用资金。",
        "缺少总包代付台账，暂不能识别已由总包直接支付的支出。",
        "缺少对上结算/业主审定台账，暂不能计算经营收入和毛利。",
        "缺少项目垫资额度与资金预占台账，暂不能计算真实可用资金。"
      ]
    });
  });

  it("sums only the latest effective contract version per contract", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "JG-001",
          name: "总部综合楼"
        })
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-1" }, { id: "contract-2" }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { contractId: "contract-1", versionNo: 1, amountCents: BigInt(10000000) },
          { contractId: "contract-1", versionNo: 2, amountCents: BigInt(12000000) },
          { contractId: "contract-2", versionNo: 1, amountCents: BigInt(25000000) }
        ])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn() },
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ProjectService(prisma as never);

    const overview = await service.getOperatingFundsOverview("project-1");

    expect(overview.business.effectiveContractAmountCents).toBe(37000000);
  });

  it("rejects effective contract totals that overflow safe integer range", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "JG-001",
          name: "总部综合楼"
        })
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-1" }, { id: "contract-2" }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { contractId: "contract-1", versionNo: 1, amountCents: BigInt(Number.MAX_SAFE_INTEGER) },
          { contractId: "contract-2", versionNo: 1, amountCents: BigInt(1) }
        ])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn() },
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).rejects.toThrow(
      "Amount exceeds safe integer range"
    );
  });

  it("throws NotFound for missing or inactive project", async () => {
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
