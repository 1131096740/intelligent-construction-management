import { NotFoundException } from "@nestjs/common";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
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

  it("aggregates operating funds overview with actual project receipts", async () => {
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
            approvedAmountCents: null,
            paidAmountCents: 0
          },
          {
            id: "payment-2",
            status: "approved_pending_payment",
            requestedAmountCents: 5000000,
            approvedAmountCents: 4800000,
            paidAmountCents: 0
          },
          {
            id: "payment-3",
            status: "paid",
            requestedAmountCents: 2000000,
            approvedAmountCents: 2000000,
            paidAmountCents: 2000000
          },
          {
            id: "payment-4",
            status: "partially_paid",
            requestedAmountCents: 3000000,
            approvedAmountCents: 3000000,
            paidAmountCents: 1000000
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 1000000 },
          { amountCents: 2000000 },
          { amountCents: 1000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 900000 },
          { amountCents: 1900000 }
        ])
      },
      projectReceipt: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: BigInt(10000000) },
          { amountCents: BigInt(5000000) }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).resolves.toEqual({
      project: { id: "project-1", code: "JG-001", name: "总部综合楼" },
      cash: {
        actualReceiptsCents: 15000000,
        availableFundsCents: 1200000,
        actualPaidCents: 4000000,
        approvalPendingOccupancyCents: 3000000,
        approvedPendingPaymentCents: 6800000,
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
      counts: { contracts: 2, settlements: 3, payments: 4 },
      dataGaps: [
        "缺少总包代付台账，暂不能识别已由总包直接支付的支出。",
        "缺少对上结算/业主审定台账，暂不能计算经营收入和毛利。",
        "缺少项目垫资额度台账，当前可用资金未包含批准垫资额度。"
      ]
    });
    expect(prisma.projectReceipt.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      select: { amountCents: true }
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
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) },
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) }
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
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) },
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) }
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

  it("records actual project receipt with voucher and audit log", async () => {
    const receivedAt = "2026-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      projectReceipt: {
        create: jest.fn().mockResolvedValue({
          id: "receipt-1",
          projectId: "project-1",
          receivedAt: new Date(receivedAt),
          amountCents: BigInt(2500000),
          payerName: "总包单位",
          sourceType: "general_contractor_payment",
          description: "六月进度款",
          voucherFileId: "file-1",
          recordedByUserId: "finance-1",
          voidedAt: null,
          createdAt
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const receipt = await service.recordReceipt("project-1", "finance-1", {
      receivedAt,
      amountCents: 2500000,
      payerName: "总包单位",
      sourceType: "general_contractor_payment",
      description: "六月进度款",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    } satisfies RecordProjectReceiptDto);

    expect(receipt).toEqual({
      id: "receipt-1",
      projectId: "project-1",
      receivedAt,
      amountCents: 2500000,
      payerName: "总包单位",
      sourceType: "general_contractor_payment",
      sourceTypeLabel: "总包付款",
      description: "六月进度款",
      voucherFileId: "file-1",
      recordedByUserId: "finance-1",
      createdAt: createdAt.toISOString()
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(tx.projectReceipt.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        receivedAt: new Date(receivedAt),
        amountCents: BigInt(2500000),
        payerName: "总包单位",
        sourceType: "general_contractor_payment",
        description: "六月进度款",
        voucherFileId: "file-1",
        recordedByUserId: "finance-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "project.receipt.record",
        businessType: "project_receipt",
        businessId: "receipt-1"
      })
    });
  });

  it("rejects actual project receipt without voucher file", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ProjectService(prisma as never);

    await expect(
      service.recordReceipt("project-1", "finance-1", {
        receivedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 2500000,
        payerName: "总包单位",
        sourceType: "general_contractor_payment",
        voucherFileId: "",
        confirmationPassword: "current-password"
      } satisfies RecordProjectReceiptDto)
    ).rejects.toThrow("Receipt voucher file is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects receipt voucher uploaded by another user", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "other-user" })
      },
      projectReceipt: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordReceipt("project-1", "finance-1", {
        receivedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 2500000,
        payerName: "总包单位",
        sourceType: "general_contractor_payment",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } satisfies RecordProjectReceiptDto)
    ).rejects.toThrow("Receipt voucher file must be uploaded by the recorder");
    expect(tx.projectReceipt.create).not.toHaveBeenCalled();
  });
});
