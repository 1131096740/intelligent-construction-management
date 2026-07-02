import { NotFoundException } from "@nestjs/common";
import type { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import type { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
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

  it("aggregates operating funds overview with upstream settlements when available", async () => {
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
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: BigInt(2000000) },
          { amountCents: BigInt(500000) }
        ])
      },
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([
          { approvedAmountCents: BigInt(30000000) }
        ])
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([{ id: "financing-quota-1", amountCents: BigInt(2000000) }])
      },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseExecution: {
        findMany: jest.fn()
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).resolves.toEqual({
      project: { id: "project-1", code: "JG-001", name: "总部综合楼" },
      cash: {
        actualReceiptsCents: 15000000,
        availableFundsCents: 3200000,
        actualPaidCents: 4000000,
        approvalPendingOccupancyCents: 3000000,
        approvedPendingPaymentCents: 6800000,
        financeRecordedOutflowCents: 2800000
      },
      business: {
        effectiveContractAmountCents: 35000000,
        effectiveSettlementAmountCents: 20000000,
        payableSettlementAmountCents: 16000000,
        operatingIncomeCents: 30000000,
        operatingCostCents: 6500000,
        grossProfitCents: 23500000
      },
      counts: { contracts: 2, settlements: 3, payments: 4 },
      dataGaps: []
    });
    expect(prisma.projectReceipt.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(prisma.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(prisma.projectUpstreamSettlement.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      select: { approvedAmountCents: true }
    });
    expect(prisma.projectFinancingQuota.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", status: "approved", validUntil: { gte: expect.any(Date) } },
      select: { id: true, amountCents: true }
    });
  });

  it("deducts occupied and used financing quota usage from operating available funds", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "JG-001",
          name: "总部综合楼"
        })
      },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) },
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([{ id: "financing-quota-1", amountCents: BigInt(2000000) }])
      },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([{ quotaId: "financing-quota-1", amountCents: BigInt(500000) }])
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([{ quotaId: "financing-quota-1", amountCents: BigInt(300000) }])
      }
    };
    const service = new ProjectService(prisma as never);

    const overview = await service.getOperatingFundsOverview("project-1");

    expect(overview.cash.availableFundsCents).toBe(1200000);
    expect(prisma.projectFinancingQuotaUsage.findMany).toHaveBeenCalledWith({
      where: { quotaId: { in: ["financing-quota-1"] }, status: { in: ["occupied", "used"] } },
      select: { quotaId: true, amountCents: true }
    });
    expect(prisma.projectExpenseFinancingQuotaUsage.findMany).toHaveBeenCalledWith({
      where: { quotaId: { in: ["financing-quota-1"] }, status: { in: ["occupied", "used"] } },
      select: { quotaId: true, amountCents: true }
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
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseExecution: { findMany: jest.fn() }
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
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseExecution: { findMany: jest.fn() }
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

  it("records project proxy payment with voucher, settlement linkage, and audit log", async () => {
    const paidAt = "2026-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          status: "effective",
          paidAmountCents: 1000000,
          payableAmountCents: 5000000
        })
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "proxy-payment-1",
          projectId: "project-1",
          paidAt: new Date(paidAt),
          amountCents: BigInt(2000000),
          generalContractorName: "总包单位",
          paidTargetName: "材料供应商",
          paymentType: "material",
          description: "钢材款总包代付",
          voucherFileId: "file-1",
          recordedByUserId: "finance-1",
          contractId: "contract-1",
          settlementId: "settlement-1",
          voidedAt: null,
          createdAt
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
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

    const result = await service.recordProxyPayment("project-1", "finance-1", {
      paidAt,
      amountCents: 2000000,
      generalContractorName: "总包单位",
      paidTargetName: "材料供应商",
      paymentType: "material",
      description: "钢材款总包代付",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      contractId: "HT-2026-001",
      settlementId: "JS-2026-001"
    } satisfies RecordProjectProxyPaymentDto);

    expect(result).toEqual({
      id: "proxy-payment-1",
      projectId: "project-1",
      paidAt,
      amountCents: 2000000,
      generalContractorName: "总包单位",
      paidTargetName: "材料供应商",
      paymentType: "material",
      paymentTypeLabel: "材料",
      description: "钢材款总包代付",
      voucherFileId: "file-1",
      recordedByUserId: "finance-1",
      contractId: "contract-1",
      settlementId: "settlement-1",
      createdAt: createdAt.toISOString()
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(tx.projectProxyPayment.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        paidAt: new Date(paidAt),
        amountCents: BigInt(2000000),
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        description: "钢材款总包代付",
        voucherFileId: "file-1",
        recordedByUserId: "finance-1",
        contractId: "contract-1",
        settlementId: "settlement-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "project.proxy_payment.record",
        businessType: "project_proxy_payment",
        businessId: "proxy-payment-1"
      })
    });
  });

  it("records project upstream settlement with voucher and audit log", async () => {
    const settledAt = "2026-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "budget-1" })
      },
      projectUpstreamSettlement: {
        create: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          settledAt: new Date(settledAt),
          reportedAmountCents: BigInt(35000000),
          approvedAmountCents: BigInt(30000000),
          approvingPartyName: "总包单位",
          periodLabel: "2026-06",
          isFinal: false,
          description: "六月对上审定",
          voucherFileId: "file-1",
          recordedByUserId: "budget-1",
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

    const result = await service.recordUpstreamSettlement("project-1", "budget-1", {
      settledAt,
      reportedAmountCents: 35000000,
      approvedAmountCents: 30000000,
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: false,
      description: "六月对上审定",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    } satisfies RecordProjectUpstreamSettlementDto);

    expect(result).toEqual({
      id: "upstream-1",
      projectId: "project-1",
      settledAt,
      reportedAmountCents: 35000000,
      approvedAmountCents: 30000000,
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: false,
      description: "六月对上审定",
      voucherFileId: "file-1",
      recordedByUserId: "budget-1",
      createdAt: createdAt.toISOString()
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("budget-1", "current-password");
    expect(tx.projectUpstreamSettlement.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        settledAt: new Date(settledAt),
        reportedAmountCents: BigInt(35000000),
        approvedAmountCents: BigInt(30000000),
        approvingPartyName: "总包单位",
        periodLabel: "2026-06",
        isFinal: false,
        description: "六月对上审定",
        voucherFileId: "file-1",
        recordedByUserId: "budget-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "budget-1",
        action: "project.upstream_settlement.record",
        businessType: "project_upstream_settlement",
        businessId: "upstream-1"
      })
    });
  });

  it("records a project owner contract as pending confirmation with uploaded file and audit log", async () => {
    const signedAt = "2026-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "contract-staff-1" })
      },
      projectOwnerContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "owner-contract-1",
          projectId: "project-1",
          ownerName: "建设单位",
          contractName: "一期施工总承包合同",
          contractCode: "YZ-2026-001",
          signedAt: new Date(signedAt),
          amountCents: BigInt(200000000),
          taxRateBps: 900,
          pricingMethod: "fixed_total",
          paymentTermsSummary: "按进度支付",
          retentionSummary: "3%质保金",
          fileId: "file-1",
          recordedByUserId: "contract-staff-1",
          confirmedByUserId: null,
          confirmedAt: null,
          status: "pending_confirm",
          voidedAt: null,
          createdAt,
          updatedAt: createdAt
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await (service as never as {
      recordOwnerContract: (
        projectId: string,
        actorUserId: string,
        input: {
          ownerName: string;
          contractName: string;
          contractCode: string;
          signedAt: string;
          amountCents: number;
          taxRateBps?: number;
          pricingMethod: string;
          paymentTermsSummary?: string;
          retentionSummary?: string;
          fileId: string;
        }
      ) => Promise<unknown>;
    }).recordOwnerContract("project-1", "contract-staff-1", {
      ownerName: "建设单位",
      contractName: "一期施工总承包合同",
      contractCode: "YZ-2026-001",
      signedAt,
      amountCents: 200000000,
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按进度支付",
      retentionSummary: "3%质保金",
      fileId: "file-1"
    });

    expect(result).toMatchObject({
      id: "owner-contract-1",
      projectId: "project-1",
      signedAt,
      amountCents: 200000000,
      status: "pending_confirm",
      fileId: "file-1",
      recordedByUserId: "contract-staff-1",
      confirmedByUserId: null,
      confirmedAt: null
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledWith({
      where: { projectId: "project-1", contractCode: "YZ-2026-001", voidedAt: null },
      select: { id: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledWith({
      where: { fileId: "file-1", voidedAt: null },
      select: { id: true }
    });
    expect(tx.projectOwnerContract.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: new Date(signedAt),
        amountCents: BigInt(200000000),
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1",
        recordedByUserId: "contract-staff-1",
        status: "pending_confirm"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "contract-staff-1",
        action: "project.owner_contract.record",
        businessType: "project_owner_contract",
        businessId: "owner-contract-1"
      })
    });
  });

  it("rejects duplicate active project owner contract code before quota can be inflated", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn()
      },
      projectOwnerContract: {
        findFirst: jest.fn().mockResolvedValue({ id: "owner-contract-existing" }),
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    await expect(
      (service as never as {
        recordOwnerContract: (
          projectId: string,
          actorUserId: string,
          input: {
            ownerName: string;
            contractName: string;
            contractCode: string;
            signedAt: string;
            amountCents: number;
            taxRateBps: number;
            pricingMethod: string;
            paymentTermsSummary: string;
            retentionSummary: string;
            fileId: string;
          }
        ) => Promise<unknown>;
      }).recordOwnerContract("project-1", "contract-staff-1", {
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 200000000,
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("Project owner contract code already exists");
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectOwnerContract.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate active project owner contract file before file access becomes ambiguous", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn()
      },
      projectOwnerContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "owner-contract-existing" }),
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    await expect(
      (service as never as {
        recordOwnerContract: (
          projectId: string,
          actorUserId: string,
          input: {
            ownerName: string;
            contractName: string;
            contractCode: string;
            signedAt: string;
            amountCents: number;
            taxRateBps: number;
            pricingMethod: string;
            paymentTermsSummary: string;
            retentionSummary: string;
            fileId: string;
          }
        ) => Promise<unknown>;
      }).recordOwnerContract("project-1", "contract-staff-1", {
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-002",
        signedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 200000000,
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("Project owner contract file already exists");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(1, {
      where: { projectId: "project-1", contractCode: "YZ-2026-002", voidedAt: null },
      select: { id: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(2, {
      where: { fileId: "file-1", voidedAt: null },
      select: { id: true }
    });
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectOwnerContract.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects project owner contract recording without required commercial terms", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ProjectService(prisma as never);

    await expect(
      (service as never as {
        recordOwnerContract: (
          projectId: string,
          actorUserId: string,
          input: {
            ownerName: string;
            contractName: string;
            contractCode: string;
            signedAt: string;
            amountCents: number;
            pricingMethod: string;
            paymentTermsSummary: string;
            retentionSummary: string;
            fileId: string;
          }
        ) => Promise<unknown>;
      }).recordOwnerContract("project-1", "contract-staff-1", {
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 200000000,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("Project owner contract tax rate is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirms a pending project owner contract with password and audit log", async () => {
    const signedAt = "2026-07-02T00:00:00.000Z";
    const confirmedAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = {
      projectOwnerContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: "owner-contract-1",
          projectId: "project-1",
          ownerName: "建设单位",
          contractName: "一期施工总承包合同",
          contractCode: "YZ-2026-001",
          signedAt: new Date(signedAt),
          amountCents: BigInt(200000000),
          taxRateBps: 900,
          pricingMethod: "fixed_total",
          paymentTermsSummary: "按进度支付",
          retentionSummary: "3%质保金",
          fileId: "file-1",
          recordedByUserId: "contract-staff-1",
          confirmedByUserId: "contract-director-1",
          confirmedAt,
          status: "effective",
          voidedAt: null,
          createdAt: new Date("2026-07-02T01:00:00.000Z"),
          updatedAt: confirmedAt
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

    const result = await (service as never as {
      confirmOwnerContract: (
        projectId: string,
        ownerContractId: string,
        actorUserId: string,
        input: { confirmationPassword: string }
      ) => Promise<unknown>;
    }).confirmOwnerContract("project-1", "owner-contract-1", "contract-director-1", {
      confirmationPassword: "current-password"
    });

    expect(result).toMatchObject({
      id: "owner-contract-1",
      status: "effective",
      confirmedByUserId: "contract-director-1",
      confirmedAt: confirmedAt.toISOString()
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("contract-director-1", "current-password");
    expect(tx.projectOwnerContract.updateMany).toHaveBeenCalledWith({
      where: {
        id: "owner-contract-1",
        projectId: "project-1",
        status: "pending_confirm",
        voidedAt: null
      },
      data: {
        status: "effective",
        confirmedByUserId: "contract-director-1",
        confirmedAt: expect.any(Date)
      }
    });
    expect(tx.projectOwnerContract.findUnique).toHaveBeenCalledWith({
      where: { id: "owner-contract-1" }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "contract-director-1",
        action: "project.owner_contract.confirm",
        businessType: "project_owner_contract",
        businessId: "owner-contract-1"
      })
    });
  });

  it("requests a settlement exception quota with attachment and frozen approval route", async () => {
    const validUntil = "2099-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "project-manager-1" })
      },
      projectSettlementExceptionQuota: {
        create: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date(validUntil),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.requestSettlementExceptionQuota(
      "project-1",
      "project-manager-1",
      {
        contractId: "contract-1",
        amountCents: 3000000,
        reason: " 对上审定暂未覆盖本期必要结算 ",
        validUntil,
        attachmentFileId: "file-1"
      }
    );

    expect(result).toMatchObject({
      id: "quota-1",
      projectId: "project-1",
      contractId: "contract-1",
      amountCents: 3000000,
      status: "approval_pending",
      approvedByUserId: null
    });
    expect(tx.projectSettlementExceptionQuota.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        contractId: "contract-1",
        amountCents: BigInt(3000000),
        reason: "对上审定暂未覆盖本期必要结算",
        validUntil: new Date(validUntil),
        attachmentFileId: "file-1",
        requestedByUserId: "project-manager-1",
        status: "approval_pending"
      }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "settlement_exception_quota.approve",
        businessType: "project_settlement_exception_quota",
        businessId: "quota-1",
        status: "in_progress",
        currentNodeIndex: 0,
        applicantUserId: "project-manager-1",
        frozenNodes: [
          { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
          { name: "合同/预算负责人", mode: "any", roleKeys: ["contract_director", "budget_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ]
      })
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "project-manager-1",
        action: "project.settlement_exception_quota.request",
        businessType: "project_settlement_exception_quota",
        businessId: "quota-1"
      })
    });
  });

  it("advances settlement exception quota approval from the project manager node", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
            { name: "合同/预算负责人", mode: "any", roleKeys: ["contract_director", "budget_director"] },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewSettlementExceptionQuota(
      "project-1",
      "quota-1",
      "project-manager-1",
      { decision: "approve", confirmationPassword: "current-password" }
    );

    expect(result.status).toBe("approval_pending");
    expect(auth.confirmPassword).toHaveBeenCalledWith("project-manager-1", "current-password");
    expect(tx.projectSettlementExceptionQuota.update).toHaveBeenCalledWith({
      where: { id: "quota-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            name: "项目经理",
            mode: "any",
            roleKeys: ["project_manager"],
            approvedRoleKeys: ["project_manager"]
          },
          {
            name: "合同/预算负责人",
            mode: "any",
            roleKeys: ["contract_director", "budget_director"]
          },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ],
        status: "in_progress"
      }
    });
  });

  it("advances settlement exception quota approval from the contract or budget node", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          currentNodeIndex: 1,
          frozenNodes: [
            {
              name: "项目经理",
              mode: "any",
              roleKeys: ["project_manager"],
              approvedRoleKeys: ["project_manager"]
            },
            { name: "合同/预算负责人", mode: "any", roleKeys: ["contract_director", "budget_director"] },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_director" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewSettlementExceptionQuota(
      "project-1",
      "quota-1",
      "budget-director-1",
      { decision: "approve", confirmationPassword: "current-password" }
    );

    expect(result.status).toBe("approval_pending");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: {
        currentNodeIndex: 2,
        frozenNodes: [
          {
            name: "项目经理",
            mode: "any",
            roleKeys: ["project_manager"],
            approvedRoleKeys: ["project_manager"]
          },
          {
            name: "合同/预算负责人",
            mode: "any",
            roleKeys: ["contract_director", "budget_director"],
            approvedRoleKeys: ["budget_director"]
          },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ],
        status: "in_progress"
      }
    });
  });

  it("approves a settlement exception quota after final OR-sign", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const approvedAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = {
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "quota-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(3000000),
          reason: "对上审定暂未覆盖本期必要结算",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: "general-manager-1",
          approvedAt,
          status: "approved",
          createdAt,
          updatedAt: approvedAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          currentNodeIndex: 2,
          frozenNodes: [
            {
              name: "项目经理",
              mode: "any",
              roleKeys: ["project_manager"],
              approvedRoleKeys: ["project_manager"]
            },
            {
              name: "合同/预算负责人",
              mode: "any",
              roleKeys: ["contract_director", "budget_director"],
              approvedRoleKeys: ["budget_director"]
            },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "general_manager" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewSettlementExceptionQuota(
      "project-1",
      "quota-1",
      "general-manager-1",
      { decision: "approve", confirmationPassword: "current-password", comment: "同意" }
    );

    expect(result.status).toBe("approved");
    expect(tx.projectSettlementExceptionQuota.update).toHaveBeenCalledWith({
      where: { id: "quota-1" },
      data: {
        status: "approved",
        approvedByUserId: "general-manager-1",
        approvedAt: expect.any(Date)
      }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({
        currentNodeIndex: 3,
        status: "approved"
      })
    });
  });

  it("requests a project financing quota with attachment and frozen approval route", async () => {
    const validUntil = "2099-07-02T00:00:00.000Z";
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "project-manager-1" })
      },
      projectFinancingQuota: {
        create: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date(validUntil),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.requestProjectFinancingQuota("project-1", "project-manager-1", {
      amountCents: 5000000,
      reason: " 阶段性垫资保障项目付款 ",
      validUntil,
      attachmentFileId: "file-1"
    });

    expect(result).toMatchObject({
      id: "financing-quota-1",
      projectId: "project-1",
      amountCents: 5000000,
      status: "approval_pending",
      approvedByUserId: null
    });
    expect(tx.projectFinancingQuota.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        amountCents: BigInt(5000000),
        reason: "阶段性垫资保障项目付款",
        validUntil: new Date(validUntil),
        attachmentFileId: "file-1",
        requestedByUserId: "project-manager-1",
        status: "approval_pending"
      }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "project_financing_quota.approve",
        businessType: "project_financing_quota",
        businessId: "financing-quota-1",
        status: "in_progress",
        currentNodeIndex: 0,
        applicantUserId: "project-manager-1",
        frozenNodes: [
          { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
          { name: "财务", mode: "any", roleKeys: ["finance_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ]
      })
    });
  });

  it("advances project financing quota approval from the finance node", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          currentNodeIndex: 1,
          frozenNodes: [
            {
              name: "项目经理",
              mode: "any",
              roleKeys: ["project_manager"],
              approvedRoleKeys: ["project_manager"]
            },
            { name: "财务", mode: "any", roleKeys: ["finance_director"] },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewProjectFinancingQuota(
      "project-1",
      "financing-quota-1",
      "finance-director-1",
      { decision: "approve", confirmationPassword: "current-password" }
    );

    expect(result.status).toBe("approval_pending");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({
        currentNodeIndex: 2,
        status: "in_progress"
      })
    });
  });

  it("approves a project financing quota after final OR-sign", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const approvedAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = {
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "project-manager-1",
          approvedByUserId: "chairman-1",
          approvedAt,
          status: "approved",
          createdAt,
          updatedAt: approvedAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          currentNodeIndex: 2,
          frozenNodes: [
            {
              name: "项目经理",
              mode: "any",
              roleKeys: ["project_manager"],
              approvedRoleKeys: ["project_manager"]
            },
            {
              name: "财务",
              mode: "any",
              roleKeys: ["finance_director"],
              approvedRoleKeys: ["finance_director"]
            },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "chairman" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewProjectFinancingQuota(
      "project-1",
      "financing-quota-1",
      "chairman-1",
      { decision: "approve", confirmationPassword: "current-password", comment: "同意" }
    );

    expect(result.status).toBe("approved");
    expect(tx.projectFinancingQuota.update).toHaveBeenCalledWith({
      where: { id: "financing-quota-1" },
      data: {
        status: "approved",
        approvedByUserId: "chairman-1",
        approvedAt: expect.any(Date)
      }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({
        currentNodeIndex: 3,
        status: "approved"
      })
    });
  });

  it("rejects upstream settlement voucher uploaded by another user", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "other-user" })
      },
      projectUpstreamSettlement: {
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
      service.recordUpstreamSettlement("project-1", "budget-1", {
        settledAt: "2026-07-02T00:00:00.000Z",
        reportedAmountCents: 35000000,
        approvedAmountCents: 30000000,
        approvingPartyName: "总包单位",
        periodLabel: "2026-06",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } satisfies RecordProjectUpstreamSettlementDto)
    ).rejects.toThrow("Upstream settlement voucher file must be uploaded by the recorder");
    expect(tx.projectUpstreamSettlement.create).not.toHaveBeenCalled();
  });

  it("rejects owner contract file uploaded by another user", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "other-user" })
      },
      projectOwnerContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    await expect(
      (service as never as {
        recordOwnerContract: (
          projectId: string,
          actorUserId: string,
          input: {
            ownerName: string;
            contractName: string;
            contractCode: string;
            signedAt: string;
            amountCents: number;
            taxRateBps: number;
            pricingMethod: string;
            paymentTermsSummary: string;
            retentionSummary: string;
            fileId: string;
          }
        ) => Promise<unknown>;
      }).recordOwnerContract("project-1", "contract-staff-1", {
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-02T00:00:00.000Z",
        amountCents: 200000000,
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("Project owner contract file must be uploaded by the recorder");
    expect(tx.projectOwnerContract.create).not.toHaveBeenCalled();
  });

  it("rejects project owner contract confirmation when it is not pending", async () => {
    const tx = {
      projectOwnerContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn()
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
      (service as never as {
        confirmOwnerContract: (
          projectId: string,
          ownerContractId: string,
          actorUserId: string,
          input: { confirmationPassword: string }
        ) => Promise<unknown>;
      }).confirmOwnerContract("project-1", "owner-contract-1", "contract-director-1", {
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Project owner contract is not pending confirmation");
    expect(tx.projectOwnerContract.findUnique).not.toHaveBeenCalled();
  });

  it("does not audit project owner contract confirmation when the CAS update loses a race", async () => {
    const tx = {
      projectOwnerContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn()
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

    await expect(
      (service as never as {
        confirmOwnerContract: (
          projectId: string,
          ownerContractId: string,
          actorUserId: string,
          input: { confirmationPassword: string }
        ) => Promise<unknown>;
      }).confirmOwnerContract("project-1", "owner-contract-1", "contract-director-1", {
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Project owner contract is not pending confirmation");
    expect(tx.projectOwnerContract.findUnique).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment when linked settlement belongs to another project", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      projectProxyPayment: {
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
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: 2000000,
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        contractId: "contract-1",
        settlementId: "settlement-other"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("Linked settlement not found in project");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment that exceeds linked settlement remaining payable amount", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          status: "effective",
          paidAmountCents: 4000000,
          payableAmountCents: 5000000
        })
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(500000) }]),
        create: jest.fn()
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
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
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: 2000000,
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        settlementId: "settlement-1"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("Project proxy payment exceeds settlement remaining payable amount: 500000");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment that would overrun approved pending payment occupancy", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          status: "effective",
          paidAmountCents: 1000000,
          payableAmountCents: 5000000
        })
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(500000) }]),
        create: jest.fn()
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 3000000,
            approvedAmountCents: 3000000,
            paidAmountCents: 0
          }
        ])
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
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: 600000,
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        settlementId: "settlement-1"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("Project proxy payment exceeds settlement remaining payable amount: 500000");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
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
