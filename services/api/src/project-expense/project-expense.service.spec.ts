import { ProjectExpenseService } from "./project-expense.service";

describe("ProjectExpenseService", () => {
  const audit = { record: jest.fn() };
  const auth = { confirmPassword: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
  });

  function roleTables(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
  }

  function cashPoolTables({
    receiptAmountCents = 100_000,
    paymentRequests = [],
    expenseRequests = [],
    financingQuotas = []
  }: {
    receiptAmountCents?: number;
    paymentRequests?: Array<{
      status: string;
      requestedAmountCents: number;
      approvedAmountCents?: number | null;
      paidAmountCents: number;
    }>;
    expenseRequests?: Array<{
      status: string;
      requestedAmountCents: number;
      approvedAmountCents?: number | null;
      paidAmountCents: number;
    }>;
    financingQuotas?: Array<{ id: string; amountCents: bigint | number }>;
  } = {}) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1", isActive: true }]),
      projectReceipt: {
        findMany: jest.fn().mockResolvedValue(
          receiptAmountCents > 0 ? [{ amountCents: BigInt(receiptAmountCents) }] : []
        )
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue(paymentRequests)
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue(expenseRequests)
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue(financingQuotas)
      },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn()
      }
    };
  }

  it("lists project expense requests with summary for operating overview", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T01:00:00.000Z");
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-1",
            code: "ZC-2026-001",
            expenseType: "sporadic_payment",
            expenseSubtype: "sporadic_material",
            paymentSubject: "建工智管",
            reason: "零星材料",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 10_000,
            paymentMethod: "bank_transfer",
            counterpartyName: "材料供应商",
            status: "partially_paid",
            createdAt,
            updatedAt
          },
          {
            id: "expense-2",
            code: "ZC-2026-002",
            expenseType: "loan_reserve",
            expenseSubtype: "project_reserve",
            paymentSubject: "建工智管",
            reason: "项目备用金",
            requestedAmountCents: 20_000,
            approvedAmountCents: null,
            paidAmountCents: 0,
            paymentMethod: "cash",
            counterpartyName: null,
            status: "approval_pending",
            createdAt,
            updatedAt
          }
        ])
      }
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1")).resolves.toEqual({
      rows: [
        expect.objectContaining({
          id: "expense-1",
          code: "ZC-2026-001",
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString()
        }),
        expect.objectContaining({
          id: "expense-2",
          code: "ZC-2026-002",
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString()
        })
      ],
      summary: {
        total: 2,
        approvalPending: 1,
        approvedPendingPayment: 1,
        paid: 0,
        paymentBlocked: 0,
        totalRequestedCents: 50_000,
        totalPaidCents: 10_000
      }
    });
    expect(prisma.projectExpenseRequest.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
      take: 100,
      select: expect.any(Object)
    });
  });

  it("throws NotFound when listing project expenses for an inactive project", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      projectExpenseRequest: {
        findMany: jest.fn()
      }
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1")).rejects.toThrow("项目不存在或已停用");
    expect(prisma.projectExpenseRequest.findMany).not.toHaveBeenCalled();
  });

  it("submits a sporadic payment request without settlement or payment terms", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000 });
    const tx = {
      ...cashPool,
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "LX-2026-001",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const request = await service.create("project-1", "handler-1", {
      code: "LX-2026-001",
      expenseType: "sporadic_payment",
      expenseSubtype: "sporadic_material",
      paymentSubject: "建工智管",
      reason: "零星材料",
      requestedAmountCents: 30_000,
      paymentMethod: "bank_transfer",
      counterpartyName: "材料供应商"
    });

    expect(request.status).toBe("approval_pending");
    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        code: "LX-2026-001",
        expenseType: "sporadic_payment",
        requestedAmountCents: 30_000,
        paidAmountCents: 0,
        status: "approval_pending",
        applicantUserId: "handler-1"
      })
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "project_expense.approve",
        businessType: "project_expense_request",
        businessId: "expense-1",
        status: "in_progress",
        applicantUserId: "handler-1"
      })
    });
  });

  it("blocks project expense submission when the project cash pool is insufficient", async () => {
    const cashPool = cashPoolTables({
      receiptAmountCents: 20_000,
      paymentRequests: [
        {
          status: "approved_pending_payment",
          requestedAmountCents: 20_000,
          approvedAmountCents: 20_000,
          paidAmountCents: 0
        }
      ]
    });
    const tx = {
      ...cashPool,
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn()
      },
      approvalInstance: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-002",
        expenseType: "loan_reserve",
        expenseSubtype: "project_reserve",
        paymentSubject: "建工智管",
        reason: "项目备用金",
        requestedAmountCents: 10_000,
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目现金资金池余额不足: 0");
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
  });

  it("rejects mismatched project expense type and subtype", async () => {
    const service = new ProjectExpenseService({} as never, audit as never, auth as never);

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-002",
        expenseType: "loan_reserve",
        expenseSubtype: "sporadic_material",
        paymentSubject: "建工智管",
        reason: "错误分类",
        requestedAmountCents: 10_000,
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目支出类型与明细类型不匹配");
  });

  it("rejects project expense amounts outside the database integer range", async () => {
    const service = new ProjectExpenseService({} as never, audit as never, auth as never);

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-002",
        expenseType: "loan_reserve",
        expenseSubtype: "project_reserve",
        paymentSubject: "建工智管",
        reason: "超大备用金",
        requestedAmountCents: 2_147_483_648,
        paymentMethod: "cash"
      })
    ).rejects.toThrow("申请金额必须大于零");
  });

  it("occupies project financing quota for the cash shortfall", async () => {
    const cashPool = cashPoolTables({
      receiptAmountCents: 20_000,
      financingQuotas: [{ id: "financing-quota-1", amountCents: BigInt(100_000) }]
    });
    const tx = {
      ...cashPool,
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "LX-2026-003",
          status: "approval_pending"
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.create("project-1", "handler-1", {
      code: "LX-2026-003",
      expenseType: "sporadic_payment",
      expenseSubtype: "sporadic_labor",
      paymentSubject: "建工智管",
      reason: "零星用工",
      requestedAmountCents: 50_000,
      paymentMethod: "wechat"
    });

    expect(tx.projectExpenseFinancingQuotaUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          quotaId: "financing-quota-1",
          projectExpenseRequestId: "expense-1",
          projectId: "project-1",
          amountCents: BigInt(30_000),
          status: "occupied"
        }
      ]
    });
  });

  it("approves the final OR node into approved pending payment", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "LX-2026-004",
            status: "approval_pending",
            requestedAmountCents: 50_000,
            approvedAmountCents: null,
            paidAmountCents: 0
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 3,
            frozenNodes: [
              { name: "部门经理或项目经理", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: ["project_manager"] },
              { name: "综合部", mode: "any", roleKeys: ["comprehensive_director"], approvedRoleKeys: ["comprehensive_director"] },
              { name: "财务部", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"] },
              { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
            ],
            applicantUserId: "handler-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000
        })
      },
      approvalInstance: {
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      projectExpenseFinancingQuotaUsage: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      ...roleTables("chairman")
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const approved = await service.reviewApproval("project-1", "expense-1", "chairman-1", {
      decision: "approve",
      approvedAmountCents: 45_000
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { status: "approved_pending_payment", approvedAmountCents: 45_000 }
    });
  });

  it("voids a pending project expense and closes the approval instance", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "LX-2026-005",
            status: "approval_pending",
            requestedAmountCents: 50_000,
            approvedAmountCents: null,
            paidAmountCents: 0
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: [],
            applicantUserId: "handler-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({ id: "expense-1", status: "voided" })
      },
      approvalInstance: {
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.voidRequest("project-1", "expense-1", "finance-director-1", "重复提交");

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "voided" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "void",
        actorUserId: "finance-director-1",
        comment: "重复提交"
      }
    });
  });

  it("records actual project expense execution with second confirmation", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "LX-2026-005",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 20_000
        }
      ]),
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn()
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "cashier-1" })
      },
      projectExpenseExecution: {
        create: jest.fn().mockResolvedValue({ id: "execution-1" })
      },
      projectExpenseRequest: {
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const execution = await service.recordExecution("project-1", "expense-1", "cashier-1", {
      amountCents: 30_000,
      paidAt: "2026-07-02T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-1");
    expect(auth.confirmPassword).toHaveBeenCalledWith("cashier-1", "current-password");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { paidAmountCents: 50_000, status: "paid" }
    });
  });

  it("rejects project expense execution when the voucher file was not uploaded by the recorder", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "LX-2026-006",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 0
        }
      ]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "other-user" })
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest.fn()
      },
      projectExpenseExecution: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-07-02T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("项目支出实付凭证必须由登记人本人上传");
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("rejects invalid project expense execution dates before confirming password", async () => {
    const service = new ProjectExpenseService({} as never, audit as never, auth as never);

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        amountCents: 10_000,
        paidAt: "not-a-date",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付日期无效");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("blocks later execution attempts after occupied financing quota becomes invalid", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "LX-2026-007",
            status: "approved_pending_payment",
            requestedAmountCents: 50_000,
            approvedAmountCents: 50_000,
            paidAmountCents: 0
          }
        ])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "cashier-1" })
      },
      projectExpenseFinancingQuotaUsage: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ quotaId: "quota-1", projectId: "project-1" }])
          .mockResolvedValueOnce([
            {
              id: "usage-1",
              quotaId: "quota-1",
              projectId: "project-1",
              amountCents: BigInt(30_000)
            }
          ]),
        update: jest.fn(),
        create: jest.fn()
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([
          { id: "quota-1", status: "approved", validUntil: new Date("2026-01-01T00:00:00.000Z") }
        ])
      },
      projectExpenseRequest: {
        update: jest.fn()
      },
      projectExpenseExecution: {
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-07-02T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("项目垫资额度已失效，请重新提交支出申请");
    expect(tx.projectExpenseFinancingQuotaUsage.update).toHaveBeenCalledWith({
      where: { id: "usage-1" },
      data: { status: "released" }
    });
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { status: "payment_blocked" }
    });
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("records finance outflow only up to paid project expense amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          status: "paid",
          code: "LX-2026-008",
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 50_000
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000 }]),
        create: jest.fn().mockResolvedValue({ id: "finance-record-1", amountCents: 30_000 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const record = await service.recordFinance("project-1", "expense-1", "finance-1", {
      amountCents: 30_000,
      occurredAt: "2026-07-02T00:00:00.000Z"
    });

    expect(record.id).toBe("finance-record-1");
    expect(tx.financeRecord.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        projectExpenseRequestId: "expense-1",
        direction: "outflow",
        amountCents: 30_000,
        occurredAt: new Date("2026-07-02T00:00:00.000Z"),
        createdByUserId: "finance-1"
      }
    });
  });
});
