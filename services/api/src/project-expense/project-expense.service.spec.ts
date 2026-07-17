import { BadRequestException } from "@nestjs/common";
import { ProjectExpenseService } from "./project-expense.service";

describe("ProjectExpenseService", () => {
  const audit = { record: jest.fn() };
  const auth = { confirmPassword: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
  });

  function pdfHexText(value: string) {
    const buffer = Buffer.from(value, "utf16le");
    for (let index = 0; index < buffer.length; index += 2) {
      const low = buffer[index];
      buffer[index] = buffer[index + 1];
      buffer[index + 1] = low;
    }
    return buffer.toString("hex").toUpperCase();
  }

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

  function approvalDetailFixture({
    actorRoleKeys = ["finance_director"],
    applicantUserId = "applicant-1",
    instanceApplicantUserId = applicantUserId,
    actorUserId = "reviewer-1",
    status = "approval_pending",
    currentNode = { name: "财务部", mode: "any", roleKeys: ["finance_director"] }
  }: {
    actorRoleKeys?: string[];
    applicantUserId?: string;
    instanceApplicantUserId?: string;
    actorUserId?: string;
    status?: string;
    currentNode?: { name: string; mode: "any"; roleKeys: string[] };
  } = {}) {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          code: "BX-2026-001",
          expenseType: "reimbursement",
          expenseSubtype: "reimbursement",
          paymentSubject: "建工智管",
          reason: "现场费用报销",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null,
          applicantUserId,
          status
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: [currentNode],
          applicantUserId: instanceApplicantUserId
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "approve",
            actorUserId: "previous-reviewer",
            comment: "同意",
            metadata: { nodeName: "上一节点", approvedRoleKey: "project_manager" },
            createdAt: new Date("2026-07-11T08:00:00.000Z")
          }
        ])
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "previous-reviewer", name: "王经理" }]) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue(actorRoleKeys.map((positionKey) => ({ positionKey })))
      },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);
    return { service, prisma, actorUserId };
  }

  it("直接持有当前项目支出节点岗位时返回可审批详情和共享时间线", async () => {
    const { service, prisma, actorUserId } = approvalDetailFixture();

    await expect(service.getApprovalDetail("project-1", "expense-1", actorUserId)).resolves.toEqual(
      expect.objectContaining({
        id: "expense-1",
        requestedAmountCents: "50000",
        statusLabel: "审批中",
        expenseTypeLabel: "报销",
        expenseSubtypeLabel: "报销",
        currentNodeName: "财务部",
        canSetApprovedAmount: true,
        reviewAction: expect.objectContaining({
          enabled: true,
          requiresSelfReviewConfirmation: false
        }),
        approvalTimeline: [expect.objectContaining({ actorName: "王经理", nodeName: "上一节点" })]
      })
    );
    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessType: "project_expense_request", businessId: "expense-1" })
      })
    );
  });

  it("非最终审批节点不允许填写批准金额", async () => {
    const { service, prisma, actorUserId } = approvalDetailFixture();
    prisma.approvalInstance.findFirst.mockResolvedValue({
      id: "approval-instance-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "财务部", mode: "any", roleKeys: ["finance_director"] },
        { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
      ],
      applicantUserId: "applicant-1"
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", actorUserId);

    expect(detail.canSetApprovedAmount).toBe(false);
  });

  it("普通申请人可读自己的详情但不能自审", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["comprehensive_director"],
      applicantUserId: "applicant-1",
      actorUserId: "applicant-1",
      currentNode: { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] }
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "applicant-1");

    expect(detail.reviewAction).toEqual(
      expect.objectContaining({
        enabled: false,
        disabledReason: "申请人不能审批自己发起的业务",
        requiresSelfReviewConfirmation: false
      })
    );
  });

  it("领导申请人在实际领导终审节点启用自审二次确认", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["chairman"],
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      currentNode: { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "leader-1");

    expect(detail.reviewAction).toEqual(
      expect.objectContaining({ enabled: true, requiresSelfReviewConfirmation: true })
    );
  });

  it("mixed 节点按冻结岗位顺序解析并禁止普通岗位自审", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["chairman", "budget_director"],
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      currentNode: { name: "预算/领导", mode: "any", roleKeys: ["budget_director", "chairman"] }
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "leader-1");

    expect(detail.reviewAction).toEqual(
      expect.objectContaining({
        enabled: false,
        disabledReason: "申请人不能审批自己发起的业务",
        requiresSelfReviewConfirmation: false
      })
    );
  });

  it("自审分类以冻结审批实例申请人为准而详情可见性仍以支出申请人为准", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["chairman"],
      applicantUserId: "original-expense-applicant",
      instanceApplicantUserId: "leader-1",
      actorUserId: "leader-1",
      currentNode: { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "leader-1");

    expect(detail.reviewAction).toEqual(
      expect.objectContaining({ enabled: true, requiresSelfReviewConfirmation: true })
    );
  });

  it("无项目支出审批岗位的非申请人不能读取详情", async () => {
    const { service } = approvalDetailFixture({ actorRoleKeys: ["employee"] });

    await expect(service.getApprovalDetail("project-1", "expense-1", "outsider-1")).rejects.toThrow(
      "无权查看该项目支出审批详情"
    );
  });

  it("申请人无审批岗位仍可读非审批中详情且动作安全禁用", async () => {
    const { service, prisma } = approvalDetailFixture({
      actorRoleKeys: [],
      applicantUserId: "applicant-1",
      actorUserId: "applicant-1",
      status: "rejected"
    });
    prisma.approvalInstance.findFirst.mockResolvedValue(null);

    const detail = await service.getApprovalDetail("project-1", "expense-1", "applicant-1");

    expect(detail.currentNodeName).toBeNull();
    expect(detail.reviewAction).toEqual(expect.objectContaining({ enabled: false }));
  });

  function cashPoolTables({
    receiptAmountCents = 100_000n,
    paymentRequests = [],
    expenseRequests = [],
    spotProcurementPayments = [],
    financingQuotas = []
  }: {
    receiptAmountCents?: bigint;
    paymentRequests?: Array<{
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents?: bigint | null;
      paidAmountCents: bigint;
    }>;
    expenseRequests?: Array<{
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents?: bigint | null;
      paidAmountCents: bigint;
    }>;
    spotProcurementPayments?: Array<{
      status: string;
      companyPaymentAmountCents: bigint;
      canceledCompanyPaymentAmountCents: bigint;
      paidAmountCents: bigint;
    }>;
    financingQuotas?: Array<{ id: string; amountCents: bigint }>;
  } = {}) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1", isActive: true }]),
      projectReceipt: {
        findMany: jest.fn().mockResolvedValue(
          receiptAmountCents > 0n ? [{ amountCents: receiptAmountCents }] : []
        )
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue(paymentRequests)
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue(expenseRequests)
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue(spotProcurementPayments)
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
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 10_000n,
            paymentMethod: "bank_transfer",
            counterpartyName: "材料供应商",
            attachmentFileId: "file-expense-1",
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
            requestedAmountCents: 20_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            paymentMethod: "cash",
            counterpartyName: null,
            attachmentFileId: null,
            status: "approval_pending",
            createdAt,
            updatedAt
          }
        ])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([{ businessId: "expense-1" }])
      },
      ...roleTables("project_manager")
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1", "manager-1")).resolves.toEqual({
      rows: [
        expect.objectContaining({
          id: "expense-1",
          code: "ZC-2026-001",
          hasAttachment: true,
          hasApprovalPdf: true,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString()
        }),
        expect.objectContaining({
          id: "expense-2",
          code: "ZC-2026-002",
          hasAttachment: false,
          hasApprovalPdf: false,
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
        totalRequestedCents: "50000",
        totalPaidCents: "10000"
      }
    });
    expect(prisma.projectExpenseRequest.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
      take: 100,
      select: expect.any(Object)
    });
    expect(prisma.pdfDocument.findMany).toHaveBeenCalledWith({
      where: {
        businessType: "project_expense_request",
        businessId: { in: ["expense-1", "expense-2"] },
        templateKey: "approval_form"
      },
      select: { businessId: true }
    });
  });

  it("returns project expense summary totals above the safe integer range without precision loss", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-large",
            code: "ZC-2026-LARGE",
            expenseType: "sporadic_payment",
            expenseSubtype: "sporadic_material",
            paymentSubject: "建工智管",
            reason: "大额兼容验证",
            requestedAmountCents: 9_007_199_254_740_993n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            paymentMethod: "bank_transfer",
            counterpartyName: null,
            attachmentFileId: null,
            status: "approval_pending",
            createdAt,
            updatedAt: createdAt
          }
        ])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...roleTables("project_manager")
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1", "manager-1")).resolves.toMatchObject({
      rows: [expect.objectContaining({ requestedAmountCents: "9007199254740993" })],
      summary: { totalRequestedCents: "9007199254740993", totalPaidCents: "0" }
    });
  });

  it("throws NotFound when listing project expenses for an inactive project", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      projectExpenseRequest: {
        findMany: jest.fn()
      },
      pdfDocument: {
        findMany: jest.fn()
      }
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1", "manager-1")).rejects.toThrow("项目不存在或已停用");
    expect(prisma.projectExpenseRequest.findMany).not.toHaveBeenCalled();
  });

  it("scopes project expense list for material staff to own rows and spot purchases", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      pdfDocument: {
        findMany: jest.fn()
      },
      ...roleTables("material_staff")
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.list("project-1", "material-staff-1");

    expect(prisma.projectExpenseRequest.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        OR: [{ applicantUserId: "material-staff-1" }, { expenseType: "spot_purchase" }]
      },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
      take: 100,
      select: expect.any(Object)
    });
  });

  it("creates an attachment download ticket by expense request id after password confirmation", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          attachmentFileId: "file-expense-1"
        })
      }
    };
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({
        fileId: "file-expense-1",
        downloadUrl: "/files/file-expense-1/download"
      })
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const ticket = await service.createAttachmentDownloadTicket(
      "project-1",
      "expense-1",
      "finance-1",
      "current-password",
      "报销附件复核"
    );

    expect(ticket.downloadUrl).toBe("/files/file-expense-1/download");
    expect(prisma.projectExpenseRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "expense-1", projectId: "project-1", voidedAt: null },
      select: { attachmentFileId: true }
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-expense-1", {
      actorUserId: "finance-1",
      downloadReason: "报销附件复核"
    });
  });

  it("rejects attachment download ticket creation without a download reason", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn()
      }
    };
    const files = { createDownloadTicket: jest.fn() };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.createAttachmentDownloadTicket(
        "project-1",
        "expense-1",
        "finance-1",
        "current-password",
        " "
      )
    ).rejects.toThrow("附件下载原因必填");
    expect(prisma.projectExpenseRequest.findFirst).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });

  it("creates an approval PDF download ticket after password confirmation", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "handler-1"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ fileId: "file-pdf-1" })
      },
      ...roleTables("finance_staff")
    };
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({
        fileId: "file-pdf-1",
        downloadUrl: "/files/file-pdf-1/download"
      })
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const ticket = await service.createApprovalPdfDownloadTicket(
      "project-1",
      "expense-1",
      "finance-1",
      "current-password",
      "审批单复核"
    );

    expect(ticket.downloadUrl).toBe("/files/file-pdf-1/download");
    expect(prisma.projectExpenseRequest.findFirst).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null, OR: [{ id: "expense-1" }, { code: "expense-1" }] },
      select: { id: true, projectId: true, applicantUserId: true }
    });
    expect(prisma.pdfDocument.findFirst).toHaveBeenCalledWith({
      where: {
        businessType: "project_expense_request",
        businessId: "expense-1",
        templateKey: "approval_form"
      },
      select: { fileId: true }
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-pdf-1", {
      actorUserId: "finance-1",
      downloadReason: "审批单复核"
    });
  });

  it("rejects approval PDF download ticket creation without a download reason", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn()
      },
      pdfDocument: {
        findFirst: jest.fn()
      },
      ...roleTables("finance_staff")
    };
    const files = { createDownloadTicket: jest.fn() };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.createApprovalPdfDownloadTicket(
        "project-1",
        "expense-1",
        "finance-1",
        "current-password",
        undefined
      )
    ).rejects.toThrow("审批单下载原因必填");
    expect(prisma.projectExpenseRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });

  it("uses a generic error when an actor cannot read the approval PDF", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "handler-1"
        })
      },
      pdfDocument: { findFirst: jest.fn() },
      ...roleTables("employee")
    };
    const files = { createDownloadTicket: jest.fn() };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.createApprovalPdfDownloadTicket(
        "project-1",
        "expense-1",
        "stranger-1",
        "current-password",
        "审批单复核"
      )
    ).rejects.toThrow("项目支出审批单不可下载");
    expect(prisma.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("submits a sporadic payment request without settlement or payment terms", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
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
          status: "approval_pending",
          requestedAmountCents: 30_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
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
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer",
      counterpartyName: "材料供应商"
    });

    expect(request.status).toBe("approval_pending");
    expect(request).toMatchObject({
      requestedAmountCents: "30000",
      approvedAmountCents: null,
      paidAmountCents: "0"
    });
    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        code: "LX-2026-001",
        expenseType: "sporadic_payment",
        requestedAmountCents: 30_000n,
        paidAmountCents: 0n,
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

  it.each(["-1", "0"])(
    "rejects project expense amount %s as HTTP 400 before opening a transaction",
    async (requestedAmountCents) => {
      const prisma = { $transaction: jest.fn() };
      const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

      const error = await service
        .create("project-1", "handler-1", {
          code: "LX-2026-NEG",
          expenseType: "sporadic_payment",
          expenseSubtype: "sporadic_material",
          paymentSubject: "建工智管",
          reason: "负数边界验证",
          requestedAmountCents,
          paymentMethod: "bank_transfer"
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toBe("申请金额必须大于零");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["travel", "差旅费"],
    ["entertainment", "业务招待费"]
  ] as const)("submits a comprehensive expense request for %s", async (expenseSubtype, reason) => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "ZH-2026-001",
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

    await service.create("project-1", "handler-1", {
      code: "ZH-2026-001",
      expenseType: "comprehensive_expense",
      expenseSubtype,
      paymentSubject: "建工智管",
      reason,
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer",
      counterpartyName: "经办人"
    });

    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expenseType: "comprehensive_expense",
        expenseSubtype,
        reason,
        requestedAmountCents: 30_000n,
        status: "approval_pending"
      })
    });
  });

  it("submits a reimbursement request with the confirmed four-step approval route", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "BX-2026-001",
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

    await service.create("project-1", "handler-1", {
      code: "BX-2026-001",
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "日常报销",
      reason: "办公用品发票报销",
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer",
      counterpartyName: "经办人"
    });

    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expenseType: "reimbursement",
        expenseSubtype: "reimbursement",
        reason: "办公用品发票报销",
        requestedAmountCents: 30_000n,
        status: "approval_pending"
      })
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: [
          { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
          { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
          { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ]
      })
    });
  });

  it("submits a spot purchase request with the confirmed material approval route", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      ...roleTables("material_staff"),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-purchase-1", uploadedByUserId: "material-1" })
      },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "CG-2026-001",
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

    await service.create("project-1", "material-1", {
      code: "CG-2026-001",
      expenseType: "spot_purchase",
      expenseSubtype: "spot_material_purchase",
      paymentSubject: "现场临时钢筋采购",
      reason: "抢修临时用料",
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer",
      counterpartyName: "临采供应商",
      attachmentFileId: "file-purchase-1"
    });

    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expenseType: "spot_purchase",
        expenseSubtype: "spot_material_purchase",
        paymentSubject: "现场临时钢筋采购",
        reason: "抢修临时用料",
        requestedAmountCents: 30_000n,
        counterpartyName: "临采供应商",
        attachmentFileId: "file-purchase-1",
        status: "approval_pending"
      })
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: [
          { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
          { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
          { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ]
      })
    });
  });

  it("rejects spot purchase creation by non-material staff", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      ...roleTables("employee"),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-purchase-1", uploadedByUserId: "employee-1" })
      },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn()
      },
      approvalInstance: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.create("project-1", "employee-1", {
        code: "CG-2026-002",
        expenseType: "spot_purchase",
        expenseSubtype: "spot_material_purchase",
        paymentSubject: "现场临采",
        reason: "抢修临时用料",
        requestedAmountCents: "30000",
        paymentMethod: "bank_transfer",
        counterpartyName: "临采供应商",
        attachmentFileId: "file-purchase-1"
      })
    ).rejects.toThrow("只有物资员可以发起零星采购申请");
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
  });

  it("blocks project expense submission when the project cash pool is insufficient", async () => {
    const cashPool = cashPoolTables({
      receiptAmountCents: 20_000n,
      paymentRequests: [
        {
          status: "approved_pending_payment",
          requestedAmountCents: 20_000n,
          approvedAmountCents: 20_000n,
          paidAmountCents: 0n
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
        requestedAmountCents: "10000",
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目现金资金池余额不足: 0");
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
  });

  it("blocks legacy project expenses when spot procurement company cash is already occupied", async () => {
    const cashPool = cashPoolTables({
      receiptAmountCents: 100_000n,
      spotProcurementPayments: [
        {
          status: "partially_paid",
          companyPaymentAmountCents: 90_000n,
          canceledCompanyPaymentAmountCents: 10_000n,
          paidAmountCents: 20_000n
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
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never
    );

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-SPOT",
        expenseType: "loan_reserve",
        expenseSubtype: "project_reserve",
        paymentSubject: "建工智管",
        reason: "项目备用金",
        requestedAmountCents: "21000",
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目现金资金池余额不足: 20000");
    expect(tx.spotProcurementPayment.findMany).toHaveBeenCalled();
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
  });

  it("fails closed when the spot-procurement cash delegate is unavailable", async () => {
    const tx = cashPoolTables({ receiptAmountCents: 100_000n });
    delete (tx as Partial<typeof tx>).spotProcurementPayment;
    const service = new ProjectExpenseService(
      {} as never,
      audit as never,
      auth as never
    );
    const reserve = (
      service as unknown as {
        reserveProjectCashPool: (
          client: typeof tx,
          projectId: string,
          requestedAmountCents: bigint
        ) => Promise<unknown>;
      }
    ).reserveProjectCashPool.bind(service);

    await expect(
      reserve(tx, "project-1", 1n)
    ).rejects.toBeInstanceOf(TypeError);
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
        requestedAmountCents: "10000",
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目支出类型与明细类型不匹配");
  });

  it("persists project expense amounts above the legacy database integer range as bigint", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 3_000_000_000n });
    const tx = {
      ...cashPool,
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-large",
          code: "LX-2026-LARGE",
          status: "approval_pending"
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.create("project-1", "handler-1", {
      code: "LX-2026-LARGE",
      expenseType: "loan_reserve",
      expenseSubtype: "project_reserve",
      paymentSubject: "建工智管",
      reason: "超大备用金",
      requestedAmountCents: "2147483648",
      paymentMethod: "cash"
    });

    expect(tx.projectExpenseRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestedAmountCents: 2_147_483_648n })
    });
  });

  it("occupies project financing quota for the cash shortfall", async () => {
    const cashPool = cashPoolTables({
      receiptAmountCents: 20_000n,
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
      requestedAmountCents: "50000",
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
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
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
          approvedAmountCents: 45_000n
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
      approvedAmountCents: "45000"
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { status: "approved_pending_payment", approvedAmountCents: 45_000n }
    });
  });

  it("拒绝普通岗位申请人审批自己发起的项目支出", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-2026-001",
            expenseType: "reimbursement",
            status: "approval_pending",
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            applicantUserId: "comprehensive-director-1",
            purchaseExecutedAt: null,
            receiptConfirmedAt: null
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: [
              {
                name: "综合部主管",
                mode: "any",
                roleKeys: ["comprehensive_director"]
              },
              { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
              { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
              {
                name: "董事长/总经理",
                mode: "any",
                roleKeys: ["chairman", "general_manager"]
              }
            ],
            applicantUserId: "comprehensive-director-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          status: "approval_pending"
        })
      },
      approvalInstance: { update: jest.fn() },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...roleTables("comprehensive_director")
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never);

    await expect(
      service.reviewApproval("project-1", "expense-1", "comprehensive-director-1", {
        decision: "approve"
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  function expenseLeaderSelfReviewFixture() {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-2026-001",
            expenseType: "reimbursement",
            status: "approval_pending",
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            applicantUserId: "leader-1",
            purchaseExecutedAt: null,
            receiptConfirmedAt: null
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: [
              { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
            ],
            applicantUserId: "leader-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n
        })
      },
      approvalInstance: { update: jest.fn() },
      approvalActionLog: { create: jest.fn() },
      projectExpenseFinancingQuotaUsage: { findMany: jest.fn().mockResolvedValue([]) },
      ...roleTables("chairman")
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);
    return { service, tx };
  }

  it.each([
    [
      { decision: "approve", confirmationPassword: "top-secret" },
      "董事长或总经理审批自己发起的业务时，请填写自审原因"
    ],
    [
      { decision: "approve", selfReviewReason: "业务紧急" },
      "董事长或总经理自审前，请输入当前密码完成二次确认"
    ]
  ] as const)("项目支出领导自审缺少确认事实时零写入", async (input, message) => {
    const { service, tx } = expenseLeaderSelfReviewFixture();

    await expect(
      service.reviewApproval("project-1", "expense-1", "leader-1", input)
    ).rejects.toThrow(message);
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("项目支出领导自审当前密码错误时零写入", async () => {
    auth.confirmPassword.mockRejectedValue(new Error("当前密码不正确，请重新输入"));
    const { service, tx } = expenseLeaderSelfReviewFixture();

    await expect(
      service.reviewApproval("project-1", "expense-1", "leader-1", {
        decision: "approve",
        selfReviewReason: "业务紧急",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("当前密码不正确，请重新输入");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("项目支出领导自审成功后只记录修剪后的原因和自审标记", async () => {
    const { service, tx } = expenseLeaderSelfReviewFixture();

    await service.reviewApproval("project-1", "expense-1", "leader-1", {
      decision: "approve",
      selfReviewReason: "  业务紧急且由本人发起  ",
      confirmationPassword: "top-secret"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("leader-1", "top-secret");
    const actionMetadata = tx.approvalActionLog.create.mock.calls[0]?.[0].data.metadata;
    const auditMetadata = audit.record.mock.calls[0]?.[1].metadata;
    expect(actionMetadata).toEqual({ selfReview: true, selfReviewReason: "业务紧急且由本人发起" });
    expect(auditMetadata).toEqual(expect.objectContaining({
      selfReview: true,
      selfReviewReason: "业务紧急且由本人发起"
    }));
    expect(JSON.stringify(actionMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(actionMetadata)).not.toContain("top-secret");
    expect(JSON.stringify(auditMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(auditMetadata)).not.toContain("top-secret");
  });

  it("generates and archives a reimbursement approval PDF after final approval", async () => {
    const reviewTx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-2026-002",
            status: "approval_pending",
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 3,
            frozenNodes: [
              { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], approvedRoleKeys: ["comprehensive_director"] },
              { name: "项目经理", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: ["project_manager"] },
              { name: "财务总监", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"] },
              { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
            ],
            applicantUserId: "handler-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000n
        })
      },
      approvalInstance: { update: jest.fn() },
      approvalActionLog: { create: jest.fn() },
      projectExpenseFinancingQuotaUsage: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      ...roleTables("chairman")
    };
    const archiveTx = {
      pdfDocument: {
        create: jest.fn().mockResolvedValue({ id: "pdf-1" })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-1" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(reviewTx))
        .mockImplementationOnce(async (callback) => callback(archiveTx)),
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          code: "BX-2026-002",
          expenseType: "reimbursement",
          expenseSubtype: "reimbursement",
          paymentSubject: "日常报销",
          reason: "办公用品发票报销",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 45_000n,
          paidAmountCents: 0n,
          paymentMethod: "bank_transfer",
          counterpartyName: "经办人",
          counterpartyAccountName: null,
          counterpartyBankName: null,
          counterpartyBankAccount: null,
          handlerUserId: "handler-1",
          applicantUserId: "handler-1",
          attachmentFileId: "file-attachment-1",
          status: "approved_pending_payment",
          voidedAt: null,
          voidedByUserId: null,
          voidReason: null,
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
          updatedAt: new Date("2026-07-02T01:00:00.000Z")
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-pdf-1" })
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await service.reviewApproval("project-1", "expense-1", "chairman-1", {
      decision: "approve",
      approvedAmountCents: "45000"
    });

    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "BX-2026-002-approval_form.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "chairman-1",
      buffer: expect.any(Buffer)
    });
    const approvalPdfText = files.uploadPrivateFile.mock.calls[0][0].buffer.toString("ascii");
    expect(approvalPdfText).toContain(pdfHexText("报销审批单"));
    expect(approvalPdfText).toContain(pdfHexText("支出类型：报销"));
    expect(approvalPdfText).toContain(pdfHexText("附件状态：已上传"));
    expect(approvalPdfText).not.toContain("Applicant User ID");
    expect(approvalPdfText).not.toContain("Requested Amount");
    expect(archiveTx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "project_expense_request",
        businessId: "expense-1",
        fileId: "file-pdf-1",
        templateKey: "approval_form"
      }
    });
    expect(archiveTx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "project_expense_request",
        businessId: "expense-1",
        fileId: "file-pdf-1",
        departmentScope: "finance"
      }
    });
  });

  it("keeps final approval successful when approval PDF generation fails", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-2026-003",
            status: "approval_pending",
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-instance-1",
            status: "in_progress",
            currentNodeIndex: 3,
            frozenNodes: [
              { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], approvedRoleKeys: ["comprehensive_director"] },
              { name: "项目经理", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: ["project_manager"] },
              { name: "财务总监", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"] },
              { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
            ],
            applicantUserId: "handler-1"
          }
        ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000n
        })
      },
      approvalInstance: { update: jest.fn() },
      approvalActionLog: { create: jest.fn() },
      projectExpenseFinancingQuotaUsage: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      ...roleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          code: "BX-2026-003",
          expenseType: "reimbursement",
          expenseSubtype: "reimbursement",
          paymentSubject: "日常报销",
          reason: "办公用品发票报销",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 45_000n,
          paidAmountCents: 0n,
          applicantUserId: "handler-1",
          status: "approved_pending_payment"
        })
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const files = {
      uploadPrivateFile: jest.fn().mockRejectedValue(new Error("storage unavailable"))
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const approved = await service.reviewApproval("project-1", "expense-1", "chairman-1", {
      decision: "approve",
      approvedAmountCents: "45000"
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(files.uploadPrivateFile).toHaveBeenCalled();
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
            requestedAmountCents: 50_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
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

  it("records spot purchase execution before payment", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "CG-2026-003",
          expenseType: "spot_purchase",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n,
          applicantUserId: "material-1",
          purchaseExecutedAt: null,
          receiptConfirmedAt: null
        }
      ]),
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({ id: "expense-1", purchaseExecutedAt: new Date() })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.recordPurchaseExecution("project-1", "expense-1", "material-1", {
      executedAt: "2026-07-02T00:00:00.000Z",
      note: "供应商已送货",
      confirmationPassword: "current-password"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("material-1", "current-password");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: {
        purchaseExecutedByUserId: "material-1",
        purchaseExecutedAt: new Date("2026-07-02T00:00:00.000Z"),
        purchaseExecutionNote: "供应商已送货"
      }
    });
  });

  it("blocks spot purchase payment before purchase execution", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "CG-2026-004",
          expenseType: "spot_purchase",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n,
          applicantUserId: "material-1",
          purchaseExecutedAt: null,
          receiptConfirmedAt: null
        }
      ]),
      fileObject: {
        findUnique: jest.fn()
      },
      projectExpenseExecution: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        amountCents: "10000",
        paidAt: "2026-07-02T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("零星采购执行后才能登记实付");
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("records actual project expense execution with second confirmation", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "LX-2026-005",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 20_000n
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
        create: jest.fn().mockResolvedValue({ id: "execution-1", amountCents: 30_000n })
      },
      projectExpenseRequest: {
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const execution = await service.recordExecution("project-1", "expense-1", "cashier-1", {
      amountCents: "30000",
      paidAt: "2026-07-02T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-1");
    expect(execution.amountCents).toBe("30000");
    expect(auth.confirmPassword).toHaveBeenCalledWith("cashier-1", "current-password");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { paidAmountCents: 50_000n, status: "paid" }
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
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n
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
        amountCents: "10000",
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
        amountCents: "10000",
        paidAt: "not-a-date",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付日期无效");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects project expense execution with a future paid date before confirming password", async () => {
    const service = new ProjectExpenseService({} as never, audit as never, auth as never);

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        amountCents: "10000",
        paidAt: "2999-07-02T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("项目支出实付日期不能晚于当前时间");
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
            requestedAmountCents: 50_000n,
            approvedAmountCents: 50_000n,
            paidAmountCents: 0n
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
        amountCents: "10000",
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
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000n }]),
        create: jest.fn().mockResolvedValue({ id: "finance-record-1", amountCents: 30_000n })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const record = await service.recordFinance("project-1", "expense-1", "finance-1", {
      amountCents: "30000",
      occurredAt: "2026-07-02T00:00:00.000Z",
      confirmationPassword: "current-password"
    });

    expect(record.id).toBe("finance-record-1");
    expect(record.amountCents).toBe("30000");
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(tx.financeRecord.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        projectExpenseRequestId: "expense-1",
        direction: "outflow",
        amountCents: 30_000n,
        occurredAt: new Date("2026-07-02T00:00:00.000Z"),
        createdByUserId: "finance-1"
      }
    });
  });

  it("compares large finance record totals as bigint before the legacy Int write", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          status: "paid",
          code: "LX-2026-LARGE",
          requestedAmountCents: 9_007_199_254_740_993n,
          approvedAmountCents: 9_007_199_254_740_993n,
          paidAmountCents: 9_007_199_254_740_993n
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 9_007_199_254_740_993n }]),
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.recordFinance("project-1", "expense-1", "finance-1", {
        amountCents: "1",
        occurredAt: "2026-07-02T00:00:00.000Z",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("财务记录金额超过未入账实付金额: 0");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("confirms spot purchase receipt by the applicant after finance record", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "CG-2026-005",
          expenseType: "spot_purchase",
          status: "paid",
          requestedAmountCents: 9_007_199_254_740_993n,
          approvedAmountCents: 9_007_199_254_740_993n,
          paidAmountCents: 9_007_199_254_740_993n,
          applicantUserId: "material-1",
          purchaseExecutedAt: new Date("2026-07-02T00:00:00.000Z"),
          receiptConfirmedAt: null
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 9_007_199_254_740_993n }])
      },
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({ id: "expense-1", receiptConfirmedAt: new Date() })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await service.confirmPurchaseReceipt("project-1", "expense-1", "material-1", {
      confirmationPassword: "current-password",
      note: "数量无误"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("material-1", "current-password");
    expect(tx.financeRecord.findMany).toHaveBeenCalledWith({
      where: { projectExpenseRequestId: "expense-1", direction: "outflow" },
      select: { amountCents: true }
    });
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: {
        receiptConfirmedByUserId: "material-1",
        receiptConfirmedAt: expect.any(Date),
        receiptConfirmationNote: "数量无误"
      }
    });
  });

  it("rejects spot purchase receipt confirmation by non-applicant", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "CG-2026-006",
          expenseType: "spot_purchase",
          status: "paid",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n,
          applicantUserId: "material-1",
          purchaseExecutedAt: new Date("2026-07-02T00:00:00.000Z"),
          receiptConfirmedAt: null
        }
      ]),
      financeRecord: {
        findMany: jest.fn()
      },
      projectExpenseRequest: {
        update: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    await expect(
      service.confirmPurchaseReceipt("project-1", "expense-1", "other-user", {
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("只有零星采购发起人可以确认收货");
    expect(tx.financeRecord.findMany).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
  });

  it("generates a finance archive PDF when finance records cover paid reimbursement", async () => {
    const financeTx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          status: "paid",
          code: "BX-2026-009",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000n }]),
        create: jest.fn().mockResolvedValue({ id: "finance-record-1", amountCents: 30_000n })
      },
      auditLog: { create: jest.fn() }
    };
    const archiveTx = {
      pdfDocument: {
        create: jest.fn().mockResolvedValue({ id: "pdf-1" })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-1" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(financeTx))
        .mockImplementationOnce(async (callback) => callback(archiveTx)),
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          code: "BX-2026-009",
          expenseType: "reimbursement",
          expenseSubtype: "reimbursement",
          paymentSubject: "日常报销",
          reason: "办公用品发票报销",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n,
          applicantUserId: "handler-1",
          status: "paid"
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000n }, { amountCents: 30_000n }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-pdf-1" })
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await service.recordFinance("project-1", "expense-1", "finance-1", {
      amountCents: "30000",
      occurredAt: "2026-07-02T00:00:00.000Z",
      confirmationPassword: "current-password"
    });

    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "BX-2026-009-project_expense_finance_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "finance-1",
      buffer: expect.any(Buffer)
    });
    const financePdfText = files.uploadPrivateFile.mock.calls[0][0].buffer.toString("ascii");
    expect(financePdfText).toContain(pdfHexText("报销财务归档单"));
    expect(financePdfText).toContain(pdfHexText("财务入账金额：500.00 元"));
    expect(financePdfText).not.toContain("Finance Recorded Amount");
    expect(financePdfText).not.toContain("Generated At");
    expect(archiveTx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "project_expense_request",
        businessId: "expense-1",
        fileId: "file-pdf-1",
        templateKey: "project_expense_finance_archive"
      }
    });
    expect(archiveTx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "project_expense_request",
        businessId: "expense-1",
        fileId: "file-pdf-1",
        departmentScope: "finance"
      }
    });
  });
});
