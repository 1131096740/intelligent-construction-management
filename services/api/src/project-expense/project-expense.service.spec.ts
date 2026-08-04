import { BadRequestException } from "@nestjs/common";
import { ProjectExpenseService } from "./project-expense.service";

describe("ProjectExpenseService", () => {
  const reviewExpenseUpdatedAt = new Date("2026-07-31T01:00:00.000Z");
  const reviewApprovalUpdatedAt = new Date("2026-07-31T01:00:01.000Z");
  const reviewCoordinates = (expectedNodeIndex: number) => ({
    expectedExpenseUpdatedAt: reviewExpenseUpdatedAt.toISOString(),
    expectedApprovalInstanceId: "approval-instance-1",
    expectedNodeIndex,
    expectedApprovalUpdatedAt: reviewApprovalUpdatedAt.toISOString()
  });
  const audit = { record: jest.fn() };
  const auth = { confirmPassword: jest.fn() };
  const projectFunding = {
    lockFundingContext: jest.fn(),
    allocateExecution: jest.fn()
  };
  const files = {
    assertFileHasNoBusinessBinding: jest.fn(),
    uploadPrivateFile: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
    projectFunding.lockFundingContext.mockReset();
    projectFunding.lockFundingContext.mockResolvedValue(undefined);
    projectFunding.allocateExecution.mockReset();
    projectFunding.allocateExecution.mockResolvedValue({
      kind: "allocated",
      projectCashAmountCents: 30_000n,
      financingQuotaAmountCents: 0n,
      allocations: [
        {
          sourceType: "project_cash",
          sourceId: null,
          amountCents: 30_000n
        }
      ]
    });
    files.assertFileHasNoBusinessBinding.mockReset();
    files.assertFileHasNoBusinessBinding.mockResolvedValue({
      id: "file-1",
      uploadedByUserId: "cashier-1",
      storageStatus: "active"
    });
    files.uploadPrivateFile.mockReset();
  });

  it("keeps project expenses as submit-on-create records without a draft abandonment API", () => {
    const service = new ProjectExpenseService({} as never, audit as never, auth as never);

    expect((service as unknown as Record<string, unknown>).abandonDraft).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).deleteDraft).toBeUndefined();
  });

  it("derives download capability from the same read boundary as each download mutation", async () => {
    const expense = {
      id: "expense-1",
      projectId: "project-1",
      expenseType: "spot_purchase",
      status: "approved_pending_payment",
      applicantUserId: "applicant-1",
      attachmentFileId: "file-expense-1",
      purchaseExecutedAt: null,
      receiptConfirmedAt: null,
      paidAmountCents: 0n,
      voidedAt: null
    };
    const materialPrisma = {
      projectExpenseRequest: { findFirst: jest.fn().mockResolvedValue(expense) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue({ id: "pdf-1" }) },
      ...roleTables("material_staff")
    };
    const financePrisma = {
      projectExpenseRequest: { findFirst: jest.fn().mockResolvedValue(expense) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue({ id: "pdf-1" }) },
      ...roleTables("finance_staff")
    };

    const materialCapability = await new ProjectExpenseService(
      materialPrisma as never,
      audit as never,
      auth as never
    ).getActionCapability("project-1", "expense-1", "material-1");
    const financeCapability = await new ProjectExpenseService(
      financePrisma as never,
      audit as never,
      auth as never
    ).getActionCapability("project-1", "expense-1", "finance-1");

    expect(materialCapability.availableActions).toContain("download_attachment");
    expect(materialCapability.availableActions).not.toContain("download_approval_pdf");
    expect(financeCapability.availableActions).toContain("download_attachment");
    expect(financeCapability.availableActions).toContain("download_approval_pdf");
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

  function governedApprovalCandidateTables({
    projectCandidates = [
      { userId: "project-manager-1", roleKey: "project_manager" }
    ],
    positionedCandidates = [
      { userId: "comprehensive-1", roleKey: "comprehensive_director" },
      { userId: "finance-1", roleKey: "finance_director" },
      { userId: "chairman-1", roleKey: "chairman" },
      { userId: "general-manager-1", roleKey: "general_manager" }
    ]
  }: {
    projectCandidates?: Array<{ userId: string; roleKey: string }>;
    positionedCandidates?: Array<{ userId: string; roleKey: string }>;
  } = {}) {
    return {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce(projectCandidates)
        .mockResolvedValueOnce(positionedCandidates)
    };
  }

  function approvalDetailFixture({
    actorRoleKeys = ["finance_director"],
    applicantUserId = "applicant-1",
    instanceApplicantUserId = applicantUserId,
    actorUserId = "reviewer-1",
    actorActive = true,
    status = "approval_pending",
    paidAmountCents = 0n,
    approvedAmountCents = status === "approval_pending" ? null : 50_000n,
    financeRecordedAmounts = [],
    expenseType = "reimbursement",
    purchaseExecutedAt = null,
    receiptConfirmedAt = null,
    receiptConfirmedByUserId = null,
    receiptConfirmationIdempotencyKey = null,
    receiptConfirmationNote = null,
    currentNode = { name: "财务部", mode: "any", roleKeys: ["finance_director"] }
  }: {
    actorRoleKeys?: readonly string[];
    applicantUserId?: string;
    instanceApplicantUserId?: string;
    actorUserId?: string;
    actorActive?: boolean;
    status?: string;
    paidAmountCents?: bigint;
    approvedAmountCents?: bigint | null;
    financeRecordedAmounts?: readonly bigint[];
    expenseType?: string;
    purchaseExecutedAt?: Date | null;
    receiptConfirmedAt?: Date | null;
    receiptConfirmedByUserId?: string | null;
    receiptConfirmationIdempotencyKey?: string | null;
    receiptConfirmationNote?: string | null;
    currentNode?: { name: string; mode: "any"; roleKeys: string[] };
  } = {}) {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          code: "BX-2026-001",
          expenseType,
          expenseSubtype: "reimbursement",
          paymentSubject: "建工智管",
          reason: "现场费用报销",
          requestedAmountCents: 50_000n,
          approvedAmountCents,
          paidAmountCents,
          purchaseExecutedAt,
          receiptConfirmedAt,
          receiptConfirmedByUserId,
          receiptConfirmationIdempotencyKey,
          receiptConfirmationNote,
          applicantUserId,
          status,
          updatedAt: new Date("2026-07-20T08:00:00.000Z")
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1"
        }),
        findMany: jest.fn().mockResolvedValue([{
          id: "approval-instance-1",
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: [currentNode],
          applicantUserId: instanceApplicantUserId,
          updatedAt: new Date("2026-07-20T08:00:01.000Z")
        }])
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
      projectExpenseFinancingQuotaUsage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue(
          financeRecordedAmounts.map((amountCents) => ({ amountCents }))
        )
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: actorUserId, isActive: actorActive }),
        findMany: jest.fn().mockResolvedValue([{ id: "previous-reviewer", name: "王经理" }])
      },
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
    expect(prisma.approvalInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessType: "project_expense_request", businessId: "expense-1" })
      })
    );
  });

  it("非最终审批节点不允许填写批准金额", async () => {
    const { service, prisma, actorUserId } = approvalDetailFixture();
    prisma.approvalInstance.findMany.mockResolvedValue([{
      id: "approval-instance-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "财务部", mode: "any", roleKeys: ["finance_director"] },
        { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
      ],
      applicantUserId: "applicant-1",
      updatedAt: new Date("2026-07-20T08:00:01.000Z")
    }]);

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
    expect(detail.availableActions).toEqual([
      expect.objectContaining({
        key: "review_approval",
        enabled: false,
        requiresSelfReviewConfirmation: false
      }),
      expect.objectContaining({
        key: "withdraw",
        enabled: true,
        requiresComment: undefined
      })
    ]);
    expect(detail.blockedReasons).toEqual([]);
    expect(detail.lifecycleUpdatedAt).toBe("2026-07-20T08:00:00.000Z");
  });

  it("非申请人不能从详情撤回审批中的项目支出", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["comprehensive_director"],
      applicantUserId: "applicant-1",
      actorUserId: "comprehensive-1"
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "comprehensive-1");

    expect(detail.availableActions).toEqual([
      expect.objectContaining({ key: "review_approval", enabled: false })
    ]);
    expect(detail.blockedReasons).toEqual([
      "只有申请人可以撤回，或由具备作废权限的岗位结束审批中的项目支出申请"
    ]);
  });

  it("审批中申请人同时具备作废权限时服务端保留独立审批、撤回和作废动作", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["project_manager"],
      applicantUserId: "manager-1",
      instanceApplicantUserId: "manager-1",
      actorUserId: "manager-1",
      currentNode: { name: "财务部", mode: "any", roleKeys: ["finance_director"] }
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "manager-1");

    expect(detail.availableActions).toEqual([
      expect.objectContaining({ key: "review_approval", enabled: false }),
      expect.objectContaining({ key: "withdraw", enabled: true, requiresComment: undefined }),
      expect.objectContaining({ key: "void", enabled: true, requiresComment: true })
    ]);
    expect(detail.blockedReasons).toEqual([]);
  });

  it("仅具备既有作废权限且已批待付无实付时从详情返回作废动作", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["project_manager"],
      applicantUserId: "applicant-1",
      actorUserId: "manager-1",
      status: "approved_pending_payment"
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "manager-1");

    expect(detail.availableActions).toEqual([
      expect.objectContaining({ key: "void", enabled: true, requiresComment: true })
    ]);
    expect(detail.blockedReasons).toEqual([]);
  });

  it("已确认收货且尚未付款时详情不再发布普通作废", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["project_manager"],
      applicantUserId: "applicant-1",
      actorUserId: "manager-1",
      expenseType: "spot_purchase",
      status: "approved_pending_payment",
      paidAmountCents: 0n,
      purchaseExecutedAt: new Date("2026-07-20T07:00:00.000Z"),
      receiptConfirmedAt: new Date("2026-07-20T08:30:00.000Z"),
      receiptConfirmedByUserId: "applicant-1",
      receiptConfirmationIdempotencyKey:
        "7b5e5a60-4f7c-46b7-8f57-6ebd71573af4",
      receiptConfirmationNote: "数量无误"
    });

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "manager-1"
    );

    expect(
      detail.availableActions.some((action) => action.key === "void")
    ).toBe(false);
    expect(detail.blockedReasons).toEqual([
      "已确认收货，不能普通作废"
    ]);
  });

  it.each([
    ["partially_paid", 1n],
    ["paid", 50_000n]
  ] as const)("项目支出 %s 有实付时详情不返回删除或普通作废", async (status, paidAmountCents) => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["project_manager"],
      applicantUserId: "applicant-1",
      actorUserId: "manager-1",
      status,
      paidAmountCents
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "manager-1");

    expect(detail.availableActions).toEqual([]);
    expect(detail.blockedReasons).toEqual(["已有实付记录，不能删除或普通作废"]);
  });

  it.each(["withdrawn", "rejected", "voided"])("项目支出结束态 %s 详情只读", async (status) => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["project_manager"],
      applicantUserId: "applicant-1",
      actorUserId: "manager-1",
      status
    });

    const detail = await service.getApprovalDetail("project-1", "expense-1", "manager-1");

    expect(detail.ledgerView).toBe("ended");
    expect(detail.availableActions).toEqual([]);
    expect(detail.blockedReasons).toEqual(["项目支出申请已结束，只能查看历史记录"]);
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

  it("当前项目财务人员只在可实付状态发布唯一 record_execution 和父记录 CAS", async () => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["finance_staff"],
      actorUserId: "cashier-1",
      status: "partially_paid",
      approvedAmountCents: 50_000n,
      paidAmountCents: 20_000n
    });

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "cashier-1"
    );

    expect(detail.paidAmountCents).toBe("20000");
    expect(detail.remainingAmountCents).toBe("30000");
    expect(detail.executionContext).toEqual({
      expectedExpenseUpdatedAt: "2026-07-20T08:00:00.000Z"
    });
    expect(
      detail.availableActions.filter((action) => action.key === "record_execution")
    ).toEqual([
      expect.objectContaining({
        key: "record_execution",
        enabled: true,
        requiredAction: "project_expense.execution"
      })
    ]);
  });

  it("全局 finance_staff 但无当前项目财务岗位时不发布实付 capability", async () => {
    const { service, prisma } = approvalDetailFixture({
      actorRoleKeys: [],
      applicantUserId: "cashier-1",
      actorUserId: "cashier-1",
      status: "approved_pending_payment",
      approvedAmountCents: 50_000n,
      paidAmountCents: 0n
    });
    prisma.userPosition.findMany.mockImplementation(
      ({ where }: { where: { projectId: string | null } }) =>
        Promise.resolve(
          where.projectId === null
            ? [{ positionId: "position-finance", projectId: null }]
            : []
        )
    );
    prisma.position.findMany.mockResolvedValue([
      { id: "position-finance", key: "finance_staff" }
    ]);

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "cashier-1"
    );

    expect(detail.executionContext).toBeNull();
    expect(
      detail.availableActions.some((action) => action.key === "record_execution")
    ).toBe(false);
  });

  it.each([
    ["ended status", { status: "paid", paidAmountCents: 50_000n }],
    [
      "zero remaining",
      {
        status: "partially_paid",
        approvedAmountCents: 50_000n,
        paidAmountCents: 50_000n
      }
    ],
    [
      "missing approved amount",
      {
        status: "approved_pending_payment",
        approvedAmountCents: null,
        paidAmountCents: 0n
      }
    ],
    [
      "unexecuted spot purchase",
      {
        status: "approved_pending_payment",
        expenseType: "spot_purchase",
        purchaseExecutedAt: null
      }
    ]
  ] as const)("fails closed for project expense execution capability: %s", async (_label, overrides) => {
    const { service } = approvalDetailFixture({
      actorRoleKeys: ["finance_staff"],
      actorUserId: "cashier-1",
      ...overrides
    });

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "cashier-1"
    );

    expect(detail.executionContext).toBeNull();
    expect(
      detail.availableActions.some(
        (action) => action.key === "record_execution" && action.enabled
      )
    ).toBe(false);
  });

  it.each(["finance_staff", "finance_director"] as const)(
    "当前项目在职 %s 只在存在未入账实付时发布唯一 record_finance 和父记录 CAS",
    async (roleKey) => {
      const { service } = approvalDetailFixture({
        actorRoleKeys: [roleKey],
        actorUserId: "finance-1",
        status: "paid",
        approvedAmountCents: 50_000n,
        paidAmountCents: 50_000n,
        financeRecordedAmounts: [20_000n]
      });

      const detail = await service.getApprovalDetail(
        "project-1",
        "expense-1",
        "finance-1"
      );

      expect(detail.financeRecordedAmountCents).toBe("20000");
      expect(detail.financeRemainingAmountCents).toBe("30000");
      expect(detail.financeContext).toEqual({
        expectedExpenseUpdatedAt: "2026-07-20T08:00:00.000Z"
      });
      expect(
        detail.availableActions.filter(
          (action) => action.key === "record_finance"
        )
      ).toEqual([
        expect.objectContaining({
          key: "record_finance",
          enabled: true,
          requiredAction: "project_expense.finance_record",
          requiresPassword: true
        })
      ]);
    }
  );

  it.each([
    [
      "fully recorded",
      {
        actorRoleKeys: ["finance_staff"],
        actorUserId: "finance-1",
        status: "paid",
        paidAmountCents: 50_000n,
        financeRecordedAmounts: [50_000n]
      }
    ],
    [
      "no paid fact",
      {
        actorRoleKeys: ["finance_director"],
        actorUserId: "finance-1",
        status: "approved_pending_payment",
        paidAmountCents: 0n,
        financeRecordedAmounts: []
      }
    ],
    [
      "inactive actor",
      {
        actorRoleKeys: ["finance_staff"],
        applicantUserId: "finance-1",
        actorUserId: "finance-1",
        actorActive: false,
        status: "paid",
        paidAmountCents: 50_000n,
        financeRecordedAmounts: []
      }
    ]
  ] as const)(
    "fails closed for project expense finance capability: %s",
    async (_label, overrides) => {
      const { service } = approvalDetailFixture({
        approvedAmountCents: 50_000n,
        ...overrides
      });

      const detail = await service.getApprovalDetail(
        "project-1",
        "expense-1",
        overrides.actorUserId
      );

      expect(detail.financeContext).toBeNull();
      expect(
        detail.availableActions.some(
          (action) => action.key === "record_finance" && action.enabled
        )
      ).toBe(false);
    }
  );

  it("全局财务岗位但无当前项目财务岗位时不发布财务入账 capability", async () => {
    const { service, prisma } = approvalDetailFixture({
      actorRoleKeys: [],
      applicantUserId: "finance-1",
      actorUserId: "finance-1",
      status: "paid",
      approvedAmountCents: 50_000n,
      paidAmountCents: 50_000n
    });
    prisma.userPosition.findMany.mockImplementation(
      ({ where }: { where: { projectId: string | null } }) =>
        Promise.resolve(
          where.projectId === null
            ? [{ positionId: "global-finance-position" }]
            : []
        )
    );
    prisma.position.findMany.mockResolvedValue([
      { key: "finance_director" }
    ]);

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "finance-1"
    );

    expect(detail.financeContext).toBeNull();
    expect(
      detail.availableActions.some(
        (action) => action.key === "record_finance" && action.enabled
      )
    ).toBe(false);
  });

  it.each([
    "approved_pending_payment",
    "partially_paid",
    "paid",
    "payment_blocked"
  ] as const)(
    "历史零星采购申请人在 %s 发布唯一 confirm_receipt 和父记录 CAS",
    async (status) => {
      const { service } = approvalDetailFixture({
        actorRoleKeys: ["material_staff"],
        applicantUserId: "material-1",
        actorUserId: "material-1",
        status,
        approvedAmountCents: 50_000n,
        paidAmountCents: status === "approved_pending_payment" ? 0n : 20_000n,
        expenseType: "spot_purchase",
        purchaseExecutedAt: new Date("2026-07-20T07:00:00.000Z")
      });

      const detail = await service.getApprovalDetail(
        "project-1",
        "expense-1",
        "material-1"
      );

      expect(detail.receiptConfirmedAt).toBeNull();
      expect(detail.receiptConfirmationIdempotencyKey).toBeNull();
      expect(detail.receiptContext).toEqual({
        expectedExpenseUpdatedAt: "2026-07-20T08:00:00.000Z"
      });
      expect(
        detail.availableActions.filter(
          (action) => action.key === "confirm_receipt"
        )
      ).toEqual([
        expect.objectContaining({
          key: "confirm_receipt",
          enabled: true,
          requiredAction: "project_expense.receipt_confirm",
          requiresPassword: true
        })
      ]);
    }
  );

  it.each([
    [
      "non applicant",
      {
        applicantUserId: "other-1",
        actorRoleKeys: ["project_manager"]
      }
    ],
    ["inactive actor", { actorActive: false }],
    ["wrong current-project role", { actorRoleKeys: ["finance_staff"] }],
    ["unexecuted purchase", { purchaseExecutedAt: null }],
    ["wrong type", { expenseType: "reimbursement" }],
    ["terminal status", { status: "voided" }],
    [
      "already confirmed",
      {
        receiptConfirmedAt: new Date("2026-07-20T08:30:00.000Z"),
        receiptConfirmedByUserId: "material-1",
        receiptConfirmationIdempotencyKey:
          "7b5e5a60-4f7c-46b7-8f57-6ebd71573af4",
        receiptConfirmationNote: "数量无误"
      }
    ]
  ] as const)(
    "历史零星采购收货 capability 失败关闭: %s",
    async (_label, overrides) => {
      const { service } = approvalDetailFixture({
        actorRoleKeys: ["material_staff"],
        applicantUserId: "material-1",
        actorUserId: "material-1",
        status: "approved_pending_payment",
        approvedAmountCents: 50_000n,
        paidAmountCents: 0n,
        expenseType: "spot_purchase",
        purchaseExecutedAt: new Date("2026-07-20T07:00:00.000Z"),
        ...overrides
      });

      const detail = await service.getApprovalDetail(
        "project-1",
        "expense-1",
        "material-1"
      );

      expect(detail.receiptContext).toBeNull();
      expect(
        detail.availableActions.some(
          (action) => action.key === "confirm_receipt"
        )
      ).toBe(false);
    }
  );

  it("申请人无审批岗位仍可读非审批中详情且动作安全禁用", async () => {
    const { service, prisma } = approvalDetailFixture({
      actorRoleKeys: [],
      applicantUserId: "applicant-1",
      actorUserId: "applicant-1",
      status: "rejected"
    });
    prisma.approvalInstance.findMany.mockResolvedValue([]);

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
            applicantUserId: "manager-1",
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

    const legacyResult = await service.list("project-1", "manager-1");
    expect(legacyResult).toEqual({
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
    expect(legacyResult.rows[0]).not.toHaveProperty("receiptBatches");
    expect(legacyResult.rows[0]).not.toHaveProperty("invoiceCoverage");
    expect(legacyResult.rows[0]).not.toHaveProperty("supplierBalance");
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

    const paged = await service.list("project-1", "manager-1", {
      view: "formal_ledger",
      page: 1,
      pageSize: 1
    });
    expect(paged).toMatchObject({
      hasPersistentDraft: false,
      localUnsavedAction: "discard_local",
      pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
      viewCounts: {
        formal_ledger: 2,
        my_drafts: 0,
        returned_for_revision: 0,
        ended: 0
      },
      statistics: {
        formalTotal: 2,
        pendingApproval: 1,
        pendingPayment: 1,
        paid: 0,
        formalRequestedAmountCents: "50000",
        formalPaidAmountCents: "10000"
      }
    });
    expect(paged.rows).toHaveLength(1);
    const fullPaged = await service.list("project-1", "manager-1", {
      view: "formal_ledger",
      page: 1,
      pageSize: 10
    });
    expect(fullPaged.rows[1]).toMatchObject({
      id: "expense-2",
      availableActions: ["withdraw", "void"]
    });
  });

  it("classifies only withdrawn, rejected and voided expenses as ended without draft deletion actions", async () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    const row = (id: string, status: string, paidAmountCents = 0n) => ({
      id,
      code: `ZC-${id}`,
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: id,
      reason: id,
      requestedAmountCents: 10_000n,
      approvedAmountCents: status === "approval_pending" ? null : 10_000n,
      paidAmountCents,
      paymentMethod: "bank_transfer",
      counterpartyName: null,
      attachmentFileId: null,
      purchaseExecutedAt: null,
      receiptConfirmedAt: null,
      applicantUserId: "applicant-1",
      status,
      createdAt: now,
      updatedAt: now
    });
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          row("withdrawn", "withdrawn"),
          row("rejected", "rejected"),
          row("voided", "voided"),
          row("paid", "paid", 10_000n)
        ])
      },
      pdfDocument: { findMany: jest.fn().mockResolvedValue([]) },
      ...roleTables("project_manager")
    };
    const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);

    const ended = await service.list("project-1", "applicant-1", { view: "ended" });

    expect(ended.viewCounts).toEqual({
      formal_ledger: 1,
      my_drafts: 0,
      returned_for_revision: 0,
      ended: 3
    });
    expect(ended.rows.map((item) => item.id)).toEqual(["withdrawn", "rejected", "voided"]);
    expect(ended.rows.every((item) => item.availableActions.length === 0)).toBe(true);
    expect(ended.statistics).toMatchObject({
      formalTotal: 1,
      pendingApproval: 0,
      pendingPayment: 0,
      paid: 1,
      formalRequestedAmountCents: "10000",
      formalPaidAmountCents: "10000"
    });

    const formal = await service.list("project-1", "applicant-1", { view: "formal_ledger" });
    expect(formal.rows[0]).toMatchObject({
      id: "paid",
      hasPersistentDraft: false,
      availableActions: [],
      blockedReasons: ["已有实付记录，不能删除或普通作废"]
    });
  });

  it("does not publish ordinary void for a receipt-confirmed ledger row", async () => {
    const now = new Date("2026-07-31T03:00:00.000Z");
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-received",
            code: "CG-2026-RECEIVED",
            expenseType: "spot_purchase",
            expenseSubtype: "spot_material_purchase",
            paymentSubject: "历史零星材料",
            reason: "已收货待付款",
            requestedAmountCents: 10_000n,
            approvedAmountCents: 10_000n,
            paidAmountCents: 0n,
            paymentMethod: "bank_transfer",
            counterpartyName: null,
            attachmentFileId: null,
            purchaseExecutedAt: new Date(
              "2026-07-31T02:00:00.000Z"
            ),
            receiptConfirmedAt: new Date(
              "2026-07-31T02:30:00.000Z"
            ),
            applicantUserId: "applicant-1",
            status: "approved_pending_payment",
            createdAt: now,
            updatedAt: now
          }
        ])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...roleTables("project_manager")
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never
    );

    const result = await service.list(
      "project-1",
      "applicant-1",
      { view: "formal_ledger" }
    );

    expect(result.rows[0]).toMatchObject({
      id: "expense-received",
      isReceiptConfirmed: true,
      availableActions: [],
      blockedReasons: ["已确认收货，不能普通作废"]
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
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "handler-1",
          expenseType: "reimbursement",
          attachmentFileId: "file-expense-1"
        })
      },
      ...roleTables("finance_staff")
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
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        expenseType: true,
        attachmentFileId: true
      }
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-expense-1", {
      actorUserId: "finance-1",
      downloadReason: "报销附件复核"
    });
  });

  it("rejects attachment download when the actor cannot read the project expense", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "handler-1",
          expenseType: "reimbursement",
          attachmentFileId: "file-expense-1"
        })
      },
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
      service.createAttachmentDownloadTicket(
        "project-1",
        "expense-1",
        "stranger-1",
        "current-password",
        "附件复核"
      )
    ).rejects.toThrow("项目支出附件不可下载");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
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

  it("fails closed when a caller tries to create a sporadic payment in the legacy expense table", async () => {
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

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-001",
        expenseType: "sporadic_payment",
        expenseSubtype: "sporadic_material",
        paymentSubject: "建工智管",
        reason: "零星材料",
        requestedAmountCents: "30000",
        paymentMethod: "bank_transfer",
        counterpartyName: "材料供应商"
      })
    ).rejects.toThrow("旧零星支出入口已停止新建，请使用零星费用支付流程");
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
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
      ...governedApprovalCandidateTables(),
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
      ...governedApprovalCandidateTables(),
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
          {
            name: "综合部主管",
            mode: "any",
            roleKeys: ["comprehensive_director"],
            candidateUserIds: ["comprehensive-1"],
            candidateUserIdsByRole: { comprehensive_director: ["comprehensive-1"] }
          },
          {
            name: "项目经理",
            mode: "any",
            roleKeys: ["project_manager"],
            candidateUserIds: ["project-manager-1"],
            candidateUserIdsByRole: { project_manager: ["project-manager-1"] }
          },
          {
            name: "财务总监",
            mode: "any",
            roleKeys: ["finance_director"],
            candidateUserIds: ["finance-1"],
            candidateUserIdsByRole: { finance_director: ["finance-1"] }
          },
          {
            name: "董事长/总经理",
            mode: "any",
            roleKeys: ["chairman", "general_manager"],
            candidateUserIds: ["chairman-1", "general-manager-1"],
            candidateUserIdsByRole: {
              chairman: ["chairman-1"],
              general_manager: ["general-manager-1"]
            }
          }
        ]
      })
    });
  });

  it("fails create when an ordinary applicant is the only candidate for a required node", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      ...governedApprovalCandidateTables({
        positionedCandidates: [
          { userId: "handler-1", roleKey: "comprehensive_director" },
          { userId: "finance-1", roleKey: "finance_director" },
          { userId: "chairman-1", roleKey: "chairman" }
        ]
      }),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn()
      },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ProjectExpenseService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never,
      auth as never
    );

    await expect(service.create("project-1", "handler-1", {
      code: "BX-2026-SELF-ONLY",
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "日常报销",
      reason: "申请人不能成为普通节点唯一审批人",
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer"
    })).rejects.toThrow("综合部主管缺少当前有效且可审批的人员");

    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("fails create when one user ambiguously matches both roles of the same approval node", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      ...governedApprovalCandidateTables({
        positionedCandidates: [
          { userId: "comprehensive-1", roleKey: "comprehensive_director" },
          { userId: "finance-1", roleKey: "finance_director" },
          { userId: "ambiguous-leader-1", roleKey: "chairman" },
          { userId: "ambiguous-leader-1", roleKey: "general_manager" }
        ]
      }),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn()
      },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ProjectExpenseService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never,
      auth as never
    );

    await expect(service.create("project-1", "handler-1", {
      code: "BX-2026-AMBIGUOUS-LEADER",
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "日常报销",
      reason: "同一人员不能以两个角色形成歧义审批身份",
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer"
    })).rejects.toThrow("董事长/总经理缺少当前有效且可审批的人员");

    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("keeps a chairman applicant as a governed final-node candidate", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 100_000n });
    const tx = {
      ...cashPool,
      ...governedApprovalCandidateTables({
        positionedCandidates: [
          { userId: "comprehensive-1", roleKey: "comprehensive_director" },
          { userId: "finance-1", roleKey: "finance_director" },
          { userId: "chairman-applicant-1", roleKey: "chairman" }
        ]
      }),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectExpenseRequest: {
        ...cashPool.projectExpenseRequest,
        create: jest.fn().mockResolvedValue({
          id: "expense-chairman-self",
          code: "BX-2026-CHAIRMAN-SELF",
          status: "approval_pending"
        })
      },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ProjectExpenseService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never,
      auth as never
    );

    await service.create("project-1", "chairman-applicant-1", {
      code: "BX-2026-CHAIRMAN-SELF",
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "日常报销",
      reason: "董事长申请人领导自审路由",
      requestedAmountCents: "30000",
      paymentMethod: "bank_transfer"
    });

    const frozenNodes = tx.approvalInstance.create.mock.calls[0]?.[0].data.frozenNodes;
    expect(frozenNodes.at(-1)).toEqual(expect.objectContaining({
      candidateUserIds: ["chairman-applicant-1"],
      candidateUserIdsByRole: {
        chairman: ["chairman-applicant-1"],
        general_manager: []
      }
    }));
  });

  it("fails closed when a caller tries to create spot procurement in the legacy expense table", async () => {
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

    await expect(
      service.create("project-1", "material-1", {
        code: "CG-2026-001",
        expenseType: "spot_purchase",
        expenseSubtype: "spot_material_purchase",
        paymentSubject: "现场临时钢筋采购",
        reason: "抢修临时用料",
        requestedAmountCents: "30000",
        paymentMethod: "bank_transfer",
        counterpartyName: "临采供应商",
        attachmentFileId: "file-purchase-1"
      })
    ).rejects.toThrow("旧零星采购入口已停止新建，请使用零星材料申请流程");
    expect(tx.projectExpenseRequest.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("does not reopen the retired spot purchase writer for non-material staff", async () => {
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
    ).rejects.toThrow("旧零星采购入口已停止新建，请使用零星材料申请流程");
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
        requestedAmountCents: "10000",
        paymentMethod: "cash"
      })
    ).rejects.toThrow("项目支出类型与明细类型不匹配");
  });

  it("persists project expense amounts above the legacy database integer range as bigint", async () => {
    const cashPool = cashPoolTables({ receiptAmountCents: 3_000_000_000n });
    const tx = {
      ...cashPool,
      ...governedApprovalCandidateTables(),
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

  it("does not occupy project financing quota when the retired sporadic writer is rejected", async () => {
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

    await expect(
      service.create("project-1", "handler-1", {
        code: "LX-2026-003",
        expenseType: "sporadic_payment",
        expenseSubtype: "sporadic_labor",
        paymentSubject: "建工智管",
        reason: "零星用工",
        requestedAmountCents: "50000",
        paymentMethod: "wechat"
      })
    ).rejects.toThrow("旧零星支出入口已停止新建，请使用零星费用支付流程");

    expect(tx.projectExpenseFinancingQuotaUsage.createMany).not.toHaveBeenCalled();
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
            paidAmountCents: 0n,
            applicantUserId: "handler-1",
            updatedAt: reviewExpenseUpdatedAt
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
            applicantUserId: "handler-1",
            updatedAt: reviewApprovalUpdatedAt
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
      ...reviewCoordinates(3),
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
            receiptConfirmedAt: null,
            updatedAt: reviewExpenseUpdatedAt
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
            applicantUserId: "comprehensive-director-1",
            updatedAt: reviewApprovalUpdatedAt
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
        decision: "approve",
        ...reviewCoordinates(0)
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
            receiptConfirmedAt: null,
            updatedAt: reviewExpenseUpdatedAt
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
            applicantUserId: "leader-1",
            updatedAt: reviewApprovalUpdatedAt
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
      service.reviewApproval("project-1", "expense-1", "leader-1", {
        ...input,
        ...reviewCoordinates(0)
      })
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
        ...reviewCoordinates(0),
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
      ...reviewCoordinates(0),
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
            paidAmountCents: 0n,
            applicantUserId: "handler-1",
            updatedAt: reviewExpenseUpdatedAt
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
            applicantUserId: "handler-1",
            updatedAt: reviewApprovalUpdatedAt
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
      ...reviewCoordinates(3),
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
            paidAmountCents: 0n,
            applicantUserId: "handler-1",
            updatedAt: reviewExpenseUpdatedAt
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
            applicantUserId: "handler-1",
            updatedAt: reviewApprovalUpdatedAt
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
      ...reviewCoordinates(3),
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

  it("rejects ordinary void after a receipt fact before changing lifecycle state", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          code: "CG-2026-005",
          expenseType: "spot_purchase",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n,
          applicantUserId: "material-1",
          purchaseExecutedAt: new Date("2026-07-20T07:00:00.000Z"),
          receiptConfirmedByUserId: "material-1",
          receiptConfirmedAt: new Date("2026-07-20T08:30:00.000Z"),
          receiptConfirmationIdempotencyKey:
            "7b5e5a60-4f7c-46b7-8f57-6ebd71573af4",
          receiptConfirmationNote: "数量无误",
          updatedAt: new Date("2026-07-20T08:30:00.000Z")
        }
      ]),
      projectExpenseRequest: { update: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) =>
          callback(tx)
      )
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never
    );

    await expect(
      service.voidRequest(
        "project-1",
        "expense-1",
        "project-manager-1",
        "重复提交"
      )
    ).rejects.toThrow("已确认收货的项目支出不能普通作废");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
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

  const expenseExecutionCoordinates = {
    expectedExpenseUpdatedAt: "2026-07-31T02:00:00.000Z",
    idempotencyKey: "a1111111-1111-4111-8111-111111111111"
  };

  function projectExpenseExecutionRow(
    overrides: Partial<{
      id: string;
      projectId: string;
      code: string;
      expenseType: string;
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
      applicantUserId: string;
      purchaseExecutedAt: Date | null;
      receiptConfirmedAt: Date | null;
      updatedAt: Date;
    }> = {}
  ) {
    return {
      id: "expense-1",
      projectId: "project-1",
      code: "LX-2026-005",
      expenseType: "sporadic_payment",
      status: "approved_pending_payment",
      requestedAmountCents: 50_000n,
      approvedAmountCents: 50_000n,
      paidAmountCents: 20_000n,
      applicantUserId: "handler-1",
      purchaseExecutedAt: null,
      receiptConfirmedAt: null,
      updatedAt: new Date(expenseExecutionCoordinates.expectedExpenseUpdatedAt),
      ...overrides
    };
  }

  function hardenedProjectExpenseExecutionFixture(
    requestOverrides: Parameters<typeof projectExpenseExecutionRow>[0] = {},
    existingExecution: Record<string, unknown> | null = null
  ) {
    const request = projectExpenseExecutionRow(requestOverrides);
    const createdExecution = {
      id: "execution-1",
      idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
      projectExpenseRequestId: request.id,
      projectId: request.projectId,
      amountCents: 30_000n,
      paidAt: new Date("2026-07-31T02:00:01.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([request]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "cashier-1", isActive: true })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseExecution: {
        findUnique: jest.fn().mockResolvedValue(existingExecution),
        create: jest.fn().mockResolvedValue(createdExecution)
      },
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          ...request,
          paidAmountCents: 50_000n,
          status: "paid"
        })
      }
    };
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: request.id,
          projectId: request.projectId
        })
      },
      projectExpenseExecution: {
        findUnique: jest.fn().mockResolvedValue(existingExecution)
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );
    return { service, prisma, request, tx };
  }

  function hardenedProjectExpenseExecutionInput() {
    return {
      ...expenseExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-07-31T02:00:01.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    };
  }

  it("records one project expense execution with exact CAS, fixed lock order and atomic funding audit", async () => {
    const { service, prisma, request, tx } =
      hardenedProjectExpenseExecutionFixture();

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        ...hardenedProjectExpenseExecutionInput(),
        idempotencyKey: expenseExecutionCoordinates.idempotencyKey.toUpperCase()
      })
    ).resolves.toEqual(expect.objectContaining({
      id: "execution-1",
      idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
      amountCents: "30000"
    }));

    expect(prisma.projectExpenseRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "expense-1", projectId: "project-1" },
      select: { id: true, projectId: true }
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
    expect(projectFunding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(projectFunding.lockFundingContext.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]
    );
    expect(tx.projectExpenseExecution.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: expenseExecutionCoordinates.idempotencyKey }
    });
    expect(files.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(tx, "file-1");
    expect(tx.projectExpenseExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
        projectExpenseRequestId: request.id,
        projectId: request.projectId
      })
    });
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(tx, {
      projectId: "project-1",
      executionType: "project_expense_execution",
      executionId: "execution-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      amountCents: 30_000n,
      occurredAt: new Date("2026-07-31T02:00:01.000Z"),
      actorUserId: "cashier-1"
    });
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { paidAmountCents: 50_000n, status: "paid" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "cashier-1",
      action: "project_expense.execution.record",
      businessType: "project_expense_request",
      businessId: "expense-1",
      metadata: expect.objectContaining({
        executionId: "execution-1",
        idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
        paidAt: "2026-07-31T02:00:01.000Z",
        fromStatus: "approved_pending_payment",
        toStatus: "paid",
        funding: expect.objectContaining({
          projectCashAmountCents: "30000",
          financingQuotaAmountCents: "0"
        })
      })
    }));
  });

  it("rejects stale project expense CAS before file, funding allocation or business writes", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture({
      updatedAt: new Date("2026-07-31T02:00:09.000Z")
    });

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出申请已变化，请刷新后重试");

    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("fails closed when an executable project expense has no approved amount", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture({
      approvedAmountCents: null,
      paidAmountCents: 0n
    });

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出缺少批准金额，不能登记实付");

    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive actor", false, ["finance_staff"], "当前项目支出付款登记账号不存在或已停用"],
    ["non-project finance actor", true, [], "只有当前项目财务人员可以登记项目支出实付"]
  ])("fails closed for %s", async (_label, isActive, roles, expectedMessage) => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();
    tx.user.findUnique.mockResolvedValue({ id: "cashier-1", isActive });
    tx.projectMember.findMany.mockResolvedValue(
      roles.map((positionKey) => ({ positionKey }))
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow(expectedMessage);

    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("仅有全局 finance_staff 但无当前项目岗位时实付全链零写入", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();
    tx.projectMember.findMany.mockResolvedValue([]);
    tx.userPosition.findMany.mockImplementation(
      ({ where }: { where: { projectId: string | null } }) =>
        Promise.resolve(
          where.projectId === null
            ? [{ positionId: "global-finance-position" }]
            : []
        )
    );
    tx.position.findMany.mockResolvedValue([
      { key: "finance_staff" }
    ]);

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("只有当前项目财务人员可以登记项目支出实付");

    expect(tx.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "cashier-1", projectId: "project-1" },
      select: { positionId: true }
    });
    expect(tx.position.findMany).not.toHaveBeenCalled();
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("项目支出实付密码错误时在任何预查询或事务前拒绝", async () => {
    const tx = {
      projectExpenseExecution: { create: jest.fn() },
      projectExpenseRequest: { update: jest.fn() }
    };
    const prisma = {
      projectExpenseRequest: { findFirst: jest.fn() },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx)
      )
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );
    auth.confirmPassword.mockRejectedValueOnce(
      new Error("当前密码不正确，请重新输入")
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        { ...hardenedProjectExpenseExecutionInput(), confirmationPassword: "wrong-password" }
      )
    ).rejects.toThrow("当前密码不正确，请重新输入");

    expect(prisma.projectExpenseRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(projectFunding.lockFundingContext).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("单次实付超过剩余批准金额时全链零写入", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        { ...hardenedProjectExpenseExecutionInput(), amountCents: "30001" }
      )
    ).rejects.toThrow("实付金额超过剩余批准金额: 30000");

    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replays the exact idempotent project expense fact before stale CAS without duplicate writes", async () => {
    const existingExecution = {
      id: "execution-existing-1",
      idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
      projectExpenseRequestId: "expense-1",
      projectId: "project-1",
      amountCents: 30_000n,
      paidAt: new Date("2026-07-31T02:00:01.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const { service, tx } = hardenedProjectExpenseExecutionFixture(
      {
        status: "paid",
        paidAmountCents: 50_000n,
        updatedAt: new Date("2026-07-31T02:00:09.000Z")
      },
      existingExecution
    );
    projectFunding.allocateExecution.mockResolvedValueOnce({
      kind: "replayed",
      projectCashAmountCents: 30_000n,
      financingQuotaAmountCents: 0n,
      allocations: [{ sourceType: "project_cash", sourceId: null, amountCents: 30_000n }]
    });

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).resolves.toEqual({ ...existingExecution, amountCents: "30000" });

    expect(projectFunding.allocateExecution).toHaveBeenCalledTimes(1);
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key with different project expense facts", async () => {
    const existingExecution = {
      id: "execution-existing-1",
      idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
      projectExpenseRequestId: "expense-1",
      projectId: "project-1",
      amountCents: 29_999n,
      paidAt: new Date("2026-07-31T02:00:01.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const { service, tx } = hardenedProjectExpenseExecutionFixture({}, existingExecution);

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("该项目支出实付幂等键已绑定不同的持久事实");
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("rejects a voucher uploaded by another actor after taking the shared unbound-file lock", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();
    files.assertFileHasNoBusinessBinding.mockResolvedValueOnce({
      id: "file-1",
      uploadedByUserId: "other-user",
      storageStatus: "active"
    });

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出实付凭证必须由当前登记人上传");
    expect(files.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(tx, "file-1");
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it.each([
    ["file binding", undefined, projectFunding],
    ["project funding", files, undefined]
  ])("fails closed when the %s dependency is unavailable", async (_label, fileService, funding) => {
    const prisma = {
      projectExpenseRequest: { findFirst: jest.fn() },
      $transaction: jest.fn()
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      fileService as never,
      funding as never
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出实付登记依赖服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["P2002", { code: "P2002" }],
    ["P2034", { code: "P2034" }],
    ["P2010/sqlstate 40001", { code: "P2010", meta: { code: "40001" } }]
  ])(
    "returns only the exact project expense execution winner after %s",
    async (_label, transactionError) => {
      const winner = {
        id: "execution-winner-1",
        idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
        projectExpenseRequestId: "expense-1",
        projectId: "project-1",
        amountCents: 30_000n,
        paidAt: new Date("2026-07-31T02:00:01.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      };
      const prisma = {
        projectExpenseRequest: {
          findFirst: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
        },
        $transaction: jest.fn().mockRejectedValue(transactionError),
        projectExpenseExecution: { findUnique: jest.fn().mockResolvedValue(winner) }
      };
      const service = new ProjectExpenseService(
        prisma as never,
        audit as never,
        auth as never,
        files as never,
        projectFunding as never
      );

      await expect(
        service.recordExecution(
          "project-1",
          "expense-1",
          "cashier-1",
          hardenedProjectExpenseExecutionInput()
        )
      ).resolves.toEqual({ ...winner, amountCents: "30000" });
    }
  );

  it("rejects a non-exact project expense execution winner after a uniqueness race", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      $transaction: jest.fn().mockRejectedValue({ code: "P2002" }),
      projectExpenseExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: "execution-winner-1",
          idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
          projectExpenseRequestId: "expense-1",
          projectId: "project-1",
          amountCents: 30_001n,
          paidAt: new Date("2026-07-31T02:00:01.000Z"),
          executedByUserId: "cashier-1",
          voucherFileId: "file-1"
        })
      }
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出实付唯一事实已变化，请刷新后重试");
  });

  it("maps raw PostgreSQL serialization failure P2010/40001 to a stable conflict", async () => {
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      $transaction: jest.fn().mockRejectedValue({
        code: "P2010",
        meta: { code: "40001", message: "could not serialize access due to concurrent update" }
      }),
      projectExpenseExecution: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目支出实付并发冲突，请刷新后重试");
  });

  it("blocks spot purchase payment before purchase execution", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture({
      expenseType: "spot_purchase",
      paidAmountCents: 0n,
      purchaseExecutedAt: null
    });

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        ...hardenedProjectExpenseExecutionInput(),
        amountCents: "10000"
      })
    ).rejects.toThrow("零星采购执行后才能登记实付");
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("records actual project expense execution with second confirmation", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();

    const execution = await service.recordExecution(
      "project-1",
      "expense-1",
      "cashier-1",
      hardenedProjectExpenseExecutionInput()
    );

    expect(execution.id).toBe("execution-1");
    expect(execution.amountCents).toBe("30000");
    expect(auth.confirmPassword).toHaveBeenCalledWith("cashier-1", "current-password");
    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { paidAmountCents: 50_000n, status: "paid" }
    });
  });

  it("allocates shared project funding in the voucher-backed project expense execution transaction", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture();

    await service.recordExecution(
      "project-1",
      "expense-1",
      "cashier-1",
      hardenedProjectExpenseExecutionInput()
    );

    expect(projectFunding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(tx, {
      projectId: "project-1",
      executionType: "project_expense_execution",
      executionId: "execution-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      amountCents: 30_000n,
      occurredAt: new Date("2026-07-31T02:00:01.000Z"),
      actorUserId: "cashier-1"
    });
    expect(projectFunding.allocateExecution.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectExpenseRequest.update.mock.invocationCallOrder[0]
    );
    expect(projectFunding.allocateExecution.mock.invocationCallOrder[0]).toBeLessThan(
      audit.record.mock.invocationCallOrder[0]
    );
  });

  it("keeps project expense status and audit unchanged when shared funding is insufficient", async () => {
    projectFunding.allocateExecution.mockRejectedValue(
      new BadRequestException("项目可用资金不足，当前最多可实际支付 20000 分")
    );
    const { service, tx } = hardenedProjectExpenseExecutionFixture();

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 20000 分");

    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replays the same project expense voucher without duplicate execution or status writes", async () => {
    const existingExecution = {
      id: "execution-1",
      idempotencyKey: expenseExecutionCoordinates.idempotencyKey,
      projectExpenseRequestId: "expense-1",
      projectId: "project-1",
      amountCents: 30_000n,
      paidAt: new Date("2026-07-31T02:00:01.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const { service, tx } = hardenedProjectExpenseExecutionFixture(
      {
        status: "paid",
        paidAmountCents: 50_000n,
        updatedAt: new Date("2026-07-31T02:00:09.000Z")
      },
      existingExecution
    );

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        hardenedProjectExpenseExecutionInput()
      )
    ).resolves.toEqual({
      ...existingExecution,
      amountCents: "30000"
    });

    expect(projectFunding.allocateExecution).toHaveBeenCalledTimes(1);
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects project expense execution when the voucher file was not uploaded by the recorder", async () => {
    const { service, tx } = hardenedProjectExpenseExecutionFixture({
      paidAmountCents: 0n
    });
    files.assertFileHasNoBusinessBinding.mockResolvedValueOnce({
      id: "file-1",
      uploadedByUserId: "other-user",
      storageStatus: "active"
    });

    await expect(
      service.recordExecution(
        "project-1",
        "expense-1",
        "cashier-1",
        { ...hardenedProjectExpenseExecutionInput(), amountCents: "10000" }
      )
    ).rejects.toThrow("项目支出实付凭证必须由当前登记人上传");
    expect(tx.projectExpenseExecution.create).not.toHaveBeenCalled();
  });

  it("rejects invalid project expense execution dates before confirming password", async () => {
    const service = new ProjectExpenseService(
      {} as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        ...hardenedProjectExpenseExecutionInput(),
        amountCents: "10000",
        paidAt: "not-a-date",
      })
    ).rejects.toThrow("实付日期无效");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects project expense execution with a future paid date before confirming password", async () => {
    const service = new ProjectExpenseService(
      {} as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );

    await expect(
      service.recordExecution("project-1", "expense-1", "cashier-1", {
        ...hardenedProjectExpenseExecutionInput(),
        amountCents: "10000",
        paidAt: "2999-07-02T00:00:00.000Z",
      })
    ).rejects.toThrow("项目支出实付日期不能晚于当前时间");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  const expenseFinanceCoordinates = {
    expectedExpenseUpdatedAt: "2026-07-31T03:00:00.000Z",
    idempotencyKey: "6e8fab4b-9e90-4fba-a59d-320cd24cc427"
  };

  function projectExpenseFinanceRow(
    overrides: Partial<{
      status: string;
      paidAmountCents: bigint;
      updatedAt: Date;
    }> = {}
  ) {
    return {
      id: "expense-1",
      projectId: "project-1",
      code: "LX-2026-FIN-001",
      expenseType: "sporadic_payment",
      status: "paid",
      requestedAmountCents: 50_000n,
      approvedAmountCents: 50_000n,
      paidAmountCents: 50_000n,
      applicantUserId: "handler-1",
      purchaseExecutedAt: null,
      receiptConfirmedAt: null,
      updatedAt: new Date(
        expenseFinanceCoordinates.expectedExpenseUpdatedAt
      ),
      ...overrides
    };
  }

  function hardenedProjectExpenseFinanceFixture({
    requestOverrides = {},
    recordedAmounts = [20_000n],
    existingRecord = null
  }: {
    requestOverrides?: Parameters<typeof projectExpenseFinanceRow>[0];
    recordedAmounts?: bigint[];
    existingRecord?: Record<string, unknown> | null;
  } = {}) {
    const request = projectExpenseFinanceRow(requestOverrides);
    const createdRecord = {
      id: "finance-record-1",
      idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
      projectId: request.projectId,
      projectExpenseRequestId: request.id,
      paymentRequestId: null,
      settlementId: null,
      direction: "outflow",
      amountCents: 10_000n,
      occurredAt: new Date("2026-07-31T03:00:01.000Z"),
      createdByUserId: "finance-1"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([request]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "finance-1",
          isActive: true
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { positionKey: "finance_staff" }
        ])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      financeRecord: {
        findUnique: jest.fn().mockResolvedValue(existingRecord),
        findMany: jest.fn().mockResolvedValue(
          recordedAmounts.map((amountCents) => ({ amountCents }))
        ),
        create: jest.fn().mockResolvedValue(createdRecord)
      },
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          ...request,
          updatedAt: new Date("2026-07-31T03:00:02.000Z")
        })
      }
    };
    const prisma = {
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: request.id,
          projectId: request.projectId
        })
      },
      financeRecord: {
        findUnique: jest.fn().mockResolvedValue(existingRecord),
        findMany: jest.fn()
      },
      pdfDocument: {
        findFirst: jest.fn()
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx)
      )
    };
    const service = new ProjectExpenseService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      projectFunding as never
    );
    return { service, prisma, request, tx, createdRecord };
  }

  function hardenedProjectExpenseFinanceInput() {
    return {
      ...expenseFinanceCoordinates,
      amountCents: "10000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "current-password"
    };
  }

  it.each(["finance_staff", "finance_director"] as const)(
    "records one project expense finance fact for current project %s with CAS, idempotency and audit",
    async (roleKey) => {
      const { service, prisma, request, tx } =
        hardenedProjectExpenseFinanceFixture();
      tx.projectMember.findMany.mockResolvedValue([
        { positionKey: roleKey }
      ]);

      await expect(
        service.recordFinance(
          "project-1",
          "expense-1",
          "finance-1",
          {
            ...hardenedProjectExpenseFinanceInput(),
            idempotencyKey:
              expenseFinanceCoordinates.idempotencyKey.toUpperCase()
          }
        )
      ).resolves.toEqual(
        expect.objectContaining({
          id: "finance-record-1",
          idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
          amountCents: "10000"
        })
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "Serializable" }
      );
      expect(tx.financeRecord.findUnique).toHaveBeenCalledWith({
        where: {
          idempotencyKey: expenseFinanceCoordinates.idempotencyKey
        }
      });
      expect(tx.financeRecord.create).toHaveBeenCalledWith({
        data: {
          idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
          projectId: request.projectId,
          projectExpenseRequestId: request.id,
          direction: "outflow",
          amountCents: 10_000n,
          occurredAt: new Date("2026-07-31T03:00:01.000Z"),
          createdByUserId: "finance-1"
        }
      });
      expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
        where: { id: request.id },
        data: { updatedAt: expect.any(Date) }
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorUserId: "finance-1",
          action: "project_expense.finance.record",
          businessType: "project_expense_request",
          businessId: request.id,
          metadata: expect.objectContaining({
            projectId: request.projectId,
            financeRecordId: "finance-record-1",
            idempotencyKey:
              expenseFinanceCoordinates.idempotencyKey,
            amountCents: "10000",
            occurredAt: "2026-07-31T03:00:01.000Z",
            financeRecordedAmountCentsBefore: "20000",
            financeRecordedAmountCentsAfter: "30000"
          })
        })
      );
    }
  );

  it("replays the exact project expense finance fact before stale CAS without duplicate writes", async () => {
    const existingRecord = {
      id: "finance-record-1",
      idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
      projectId: "project-1",
      projectExpenseRequestId: "expense-1",
      paymentRequestId: null,
      settlementId: null,
      direction: "outflow",
      amountCents: 10_000n,
      occurredAt: new Date("2026-07-31T03:00:01.000Z"),
      createdByUserId: "finance-1"
    };
    const { service, tx } = hardenedProjectExpenseFinanceFixture({
      requestOverrides: {
        updatedAt: new Date("2026-07-31T03:00:09.000Z")
      },
      existingRecord
    });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        hardenedProjectExpenseFinanceInput()
      )
    ).resolves.toEqual(
      expect.objectContaining({
        id: "finance-record-1",
        idempotencyKey: expenseFinanceCoordinates.idempotencyKey
      })
    );

    expect(tx.financeRecord.findMany).toHaveBeenCalledTimes(1);
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects stale project expense finance CAS before totals or writes", async () => {
    const { service, tx } = hardenedProjectExpenseFinanceFixture({
      requestOverrides: {
        updatedAt: new Date("2026-07-31T03:00:09.000Z")
      }
    });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        hardenedProjectExpenseFinanceInput()
      )
    ).rejects.toThrow(
      "项目支出申请已变化，请刷新后重试"
    );

    expect(tx.financeRecord.findMany).not.toHaveBeenCalled();
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "inactive actor",
      false,
      ["finance_staff"],
      "当前项目支出财务入账账号不存在或已停用"
    ],
    [
      "non-project finance actor",
      true,
      [],
      "只有当前项目财务人员或财务主管可以登记项目支出财务入账"
    ]
  ] as const)(
    "fails closed for project expense finance %s",
    async (_label, isActive, roles, message) => {
      const { service, tx } =
        hardenedProjectExpenseFinanceFixture();
      tx.user.findUnique.mockResolvedValue({
        id: "finance-1",
        isActive
      });
      tx.projectMember.findMany.mockResolvedValue(
        roles.map((positionKey) => ({ positionKey }))
      );

      await expect(
        service.recordFinance(
          "project-1",
          "expense-1",
          "finance-1",
          hardenedProjectExpenseFinanceInput()
        )
      ).rejects.toThrow(message);

      expect(tx.financeRecord.findMany).not.toHaveBeenCalled();
      expect(tx.financeRecord.create).not.toHaveBeenCalled();
      expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("rejects a reused project expense finance idempotency key bound to different facts", async () => {
    const existingRecord = {
      id: "finance-record-1",
      idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
      projectId: "project-1",
      projectExpenseRequestId: "expense-1",
      paymentRequestId: null,
      settlementId: null,
      direction: "outflow",
      amountCents: 999n,
      occurredAt: new Date("2026-07-31T03:00:01.000Z"),
      createdByUserId: "finance-1"
    };
    const { service, tx } = hardenedProjectExpenseFinanceFixture({
      existingRecord
    });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        hardenedProjectExpenseFinanceInput()
      )
    ).rejects.toThrow(
      "该项目支出财务入账幂等键已绑定不同的持久事实"
    );

    expect(tx.financeRecord.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["P2002", { code: "P2002" }],
    ["P2034", { code: "P2034" }],
    [
      "P2010/sqlstate 40001",
      { code: "P2010", meta: { code: "40001" } }
    ]
  ])(
    "returns only the exact project expense finance winner after %s",
    async (_label, transactionError) => {
      const winner = {
        id: "finance-record-winner-1",
        idempotencyKey:
          expenseFinanceCoordinates.idempotencyKey,
        projectId: "project-1",
        projectExpenseRequestId: "expense-1",
        paymentRequestId: null,
        settlementId: null,
        direction: "outflow",
        amountCents: 10_000n,
        occurredAt: new Date(
          "2026-07-31T03:00:01.000Z"
        ),
        createdByUserId: "finance-1"
      };
      const prisma = {
        projectExpenseRequest: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: "expense-1",
              projectId: "project-1"
            })
            .mockResolvedValueOnce({
              paidAmountCents: 50_000n
            })
        },
        financeRecord: {
          findUnique: jest.fn().mockResolvedValue(winner),
          findMany: jest
            .fn()
            .mockResolvedValue([{ amountCents: 10_000n }])
        },
        $transaction: jest
          .fn()
          .mockRejectedValue(transactionError)
      };
      const service = new ProjectExpenseService(
        prisma as never,
        audit as never,
        auth as never,
        files as never,
        projectFunding as never
      );

      await expect(
        service.recordFinance(
          "project-1",
          "expense-1",
          "finance-1",
          hardenedProjectExpenseFinanceInput()
        )
      ).resolves.toEqual({
        ...winner,
        amountCents: "10000"
      });
    }
  );

  it.each([
    [
      "a non-exact uniqueness winner",
      { code: "P2002" },
      {
        id: "finance-record-winner-1",
        idempotencyKey:
          expenseFinanceCoordinates.idempotencyKey,
        projectId: "project-1",
        projectExpenseRequestId: "expense-1",
        paymentRequestId: null,
        settlementId: null,
        direction: "outflow",
        amountCents: 10_001n,
        occurredAt: new Date(
          "2026-07-31T03:00:01.000Z"
        ),
        createdByUserId: "finance-1"
      },
      "项目支出财务入账唯一事实已变化，请刷新后重试"
    ],
    [
      "a serialization conflict without an exact winner",
      {
        code: "P2010",
        meta: {
          code: "40001",
          message:
            "could not serialize access due to concurrent update"
        }
      },
      null,
      "项目支出财务入账并发冲突，请刷新后重试"
    ]
  ])(
    "rejects %s",
    async (
      _label,
      transactionError,
      winner,
      expectedMessage
    ) => {
      const prisma = {
        projectExpenseRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "expense-1",
            projectId: "project-1"
          })
        },
        financeRecord: {
          findUnique: jest.fn().mockResolvedValue(winner)
        },
        $transaction: jest
          .fn()
          .mockRejectedValue(transactionError)
      };
      const service = new ProjectExpenseService(
        prisma as never,
        audit as never,
        auth as never,
        files as never,
        projectFunding as never
      );

      await expect(
        service.recordFinance(
          "project-1",
          "expense-1",
          "finance-1",
          hardenedProjectExpenseFinanceInput()
        )
      ).rejects.toThrow(expectedMessage);
    }
  );

  it("keeps a completed finance fact retryable when PDF archive generation fails", async () => {
    const { service, prisma, tx } =
      hardenedProjectExpenseFinanceFixture({
        recordedAmounts: [20_000n]
      });
    tx.financeRecord.create.mockResolvedValue({
      id: "finance-record-1",
      idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
      projectId: "project-1",
      projectExpenseRequestId: "expense-1",
      paymentRequestId: null,
      settlementId: null,
      direction: "outflow",
      amountCents: 30_000n,
      occurredAt: new Date("2026-07-31T03:00:01.000Z"),
      createdByUserId: "finance-1"
    });
    prisma.projectExpenseRequest.findFirst
      .mockResolvedValueOnce({
        id: "expense-1",
        projectId: "project-1"
      })
      .mockResolvedValueOnce({
        ...projectExpenseFinanceRow(),
        expenseSubtype: "reimbursement",
        paymentSubject: "建工智管"
      });
    prisma.financeRecord.findMany.mockResolvedValue([
        { amountCents: 20_000n },
        { amountCents: 30_000n }
      ]);
    prisma.pdfDocument.findFirst.mockResolvedValue(null);
    files.uploadPrivateFile.mockRejectedValueOnce(
      new Error("storage unavailable")
    );

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        {
          ...hardenedProjectExpenseFinanceInput(),
          amountCents: "30000"
        }
      )
    ).rejects.toThrow(
      "财务入账已保存，但财务归档生成未完成；请使用同一操作直接重试"
    );

    expect(tx.financeRecord.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("does not freeze a final finance archive while a project expense is only partially paid", async () => {
    const { service } =
      hardenedProjectExpenseFinanceFixture({
        requestOverrides: {
          status: "partially_paid",
          paidAmountCents: 30_000n
        },
        recordedAmounts: [20_000n]
      });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        hardenedProjectExpenseFinanceInput()
      )
    ).resolves.toEqual(
      expect.objectContaining({
        id: "finance-record-1",
        amountCents: "10000"
      })
    );

    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects finance outflow above the unrecorded paid amount", async () => {
    const { service, tx } =
      hardenedProjectExpenseFinanceFixture({
        recordedAmounts: [40_000n]
      });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        {
          ...hardenedProjectExpenseFinanceInput(),
          amountCents: "20000"
        }
      )
    ).rejects.toThrow(
      "财务记录金额超过未入账实付金额: 10000"
    );

    expect(tx.financeRecord.create).not.toHaveBeenCalled();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("compares large finance record totals as bigint", async () => {
    const largeAmount = 9_007_199_254_740_993n;
    const { service, tx } =
      hardenedProjectExpenseFinanceFixture({
        requestOverrides: {
          paidAmountCents: largeAmount
        },
        recordedAmounts: [largeAmount]
      });

    await expect(
      service.recordFinance(
        "project-1",
        "expense-1",
        "finance-1",
        {
          ...hardenedProjectExpenseFinanceInput(),
          amountCents: "1"
        }
      )
    ).rejects.toThrow(
      "财务记录金额超过未入账实付金额: 0"
    );

    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("generates a finance archive PDF when finance records cover paid reimbursement", async () => {
    const financeTx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "expense-1",
          projectId: "project-1",
          status: "paid",
          code: "BX-2026-009",
          expenseType: "reimbursement",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n,
          applicantUserId: "handler-1",
          purchaseExecutedAt: null,
          receiptConfirmedAt: null,
          updatedAt: new Date(
            expenseFinanceCoordinates.expectedExpenseUpdatedAt
          )
        }
      ]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "finance-1",
          isActive: true
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { positionKey: "finance_staff" }
        ])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      financeRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000n }]),
        create: jest.fn().mockResolvedValue({
          id: "finance-record-1",
          idempotencyKey: expenseFinanceCoordinates.idempotencyKey,
          projectId: "project-1",
          projectExpenseRequestId: "expense-1",
          paymentRequestId: null,
          settlementId: null,
          direction: "outflow",
          amountCents: 30_000n,
          occurredAt: new Date("2026-07-02T00:00:00.000Z"),
          createdByUserId: "finance-1"
        })
      },
      projectExpenseRequest: {
        update: jest.fn().mockResolvedValue({
          id: "expense-1",
          updatedAt: new Date()
        })
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
      ...expenseFinanceCoordinates,
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
