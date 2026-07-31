import { ConflictException } from "@nestjs/common";
import { ProjectExpenseService } from "./project-expense.service";

interface WithdrawalInput {
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

const expenseUpdatedAt = new Date("2026-07-31T01:00:00.000Z");
const approvalUpdatedAt = new Date("2026-07-31T01:00:01.000Z");

function withdrawalInput(
  overrides: Partial<WithdrawalInput> = {}
): WithdrawalInput {
  return {
    expectedExpenseUpdatedAt: expenseUpdatedAt.toISOString(),
    expectedApprovalInstanceId: "approval-instance-1",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: approvalUpdatedAt.toISOString(),
    ...overrides
  };
}

function approvalInstance(
  overrides: Partial<{
    id: string;
    status: string;
    currentNodeIndex: number;
    applicantUserId: string;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: "approval-instance-1",
    status: "in_progress",
    currentNodeIndex: 1,
    frozenNodes: [
      {
        name: "项目经理",
        mode: "any",
        roleKeys: ["project_manager"]
      },
      {
        name: "财务总监",
        mode: "any",
        roleKeys: ["finance_director"]
      }
    ],
    applicantUserId: "applicant-1",
    updatedAt: approvalUpdatedAt,
    ...overrides
  };
}

function approvalDetailPrisma(
  instances: ReturnType<typeof approvalInstance>[],
  options: {
    applicantUserId?: string;
    hasUsedFinancingQuota?: boolean;
  } = {}
) {
  return {
    projectExpenseRequest: {
      findFirst: jest.fn().mockResolvedValue({
        id: "expense-1",
        projectId: "project-1",
        code: "ZC-2026-001",
        expenseType: "reimbursement",
        expenseSubtype: "reimbursement",
        paymentSubject: "建工智管",
        reason: "现场费用报销",
        requestedAmountCents: 50_000n,
        approvedAmountCents: null,
        paidAmountCents: 0n,
        applicantUserId: options.applicantUserId ?? "applicant-1",
        status: "approval_pending",
        updatedAt: expenseUpdatedAt
      })
    },
    approvalInstance: {
      findFirst: jest.fn().mockResolvedValue(instances[0] ?? null),
      findMany: jest.fn().mockResolvedValue(instances)
    },
    approvalActionLog: {
      findMany: jest.fn().mockResolvedValue([])
    },
    projectExpenseFinancingQuotaUsage: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.hasUsedFinancingQuota ? { id: "used-usage-1" } : null
        )
    },
    user: {
      findMany: jest.fn().mockResolvedValue([])
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue([])
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    position: {
      findMany: jest.fn().mockResolvedValue([])
    }
  };
}

function withdrawalServiceFixture(
  options: {
    applicantUserId?: string;
    paidAmountCents?: bigint;
    instances?: ReturnType<typeof approvalInstance>[];
    financingUsages?: Array<{
      amountCents: bigint;
      status: "occupied" | "used";
    }>;
  } = {}
) {
  const request = {
    id: "expense-1",
    projectId: "project-1",
    code: "ZC-2026-001",
    expenseType: "reimbursement",
    status: "approval_pending",
    requestedAmountCents: 50_000n,
    approvedAmountCents: null,
    paidAmountCents: options.paidAmountCents ?? 0n,
    applicantUserId: options.applicantUserId ?? "applicant-1",
    purchaseExecutedAt: null,
    receiptConfirmedAt: null,
    updatedAt: expenseUpdatedAt
  };
  const instances =
    options.instances ?? [approvalInstance()];
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([request])
      .mockResolvedValueOnce(instances),
    projectExpenseRequest: {
      update: jest.fn().mockResolvedValue({
        ...request,
        status: "withdrawn"
      })
    },
    approvalInstance: {
      update: jest.fn()
    },
    approvalActionLog: {
      create: jest.fn()
    },
    projectExpenseFinancingQuotaUsage: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.financingUsages ?? [])
    }
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
    )
  };
  const audit = { record: jest.fn() };
  const service = new ProjectExpenseService(
    prisma as never,
    audit as never
  );
  const withdraw = (input: WithdrawalInput, actorUserId = "applicant-1") =>
    (
      service as unknown as {
        withdrawApproval(
          projectId: string,
          expenseRequestId: string,
          actorUserId: string,
          input: WithdrawalInput
        ): Promise<unknown>;
      }
    ).withdrawApproval(
      "project-1",
      "expense-1",
      actorUserId,
      input
    );
  return { audit, prisma, service, tx, withdraw };
}

describe("ProjectExpenseService withdrawal authority", () => {
  it("publishes withdraw with four authoritative coordinates only for one exact in-progress instance", async () => {
    const prisma = approvalDetailPrisma([approvalInstance()]);
    const service = new ProjectExpenseService(prisma as never);

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "applicant-1"
    );

    expect(prisma.approvalInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessType: "project_expense_request",
          businessId: "expense-1",
          flowType: "project_expense.approve",
          status: "in_progress"
        }
      })
    );
    expect(
      detail.availableActions.filter((action) => action.key === "withdraw")
    ).toEqual([
      expect.objectContaining({ key: "withdraw", enabled: true })
    ]);
    expect(detail).toHaveProperty("withdrawalContext", {
      expectedExpenseUpdatedAt: expenseUpdatedAt.toISOString(),
      expectedApprovalInstanceId: "approval-instance-1",
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt: approvalUpdatedAt.toISOString()
    });
  });

  it.each([
    ["missing", []],
    [
      "duplicate",
      [
        approvalInstance(),
        approvalInstance({
          id: "approval-instance-2",
          updatedAt: new Date("2026-07-31T01:00:02.000Z")
        })
      ]
    ]
  ])(
    "fails closed when the in-progress approval instance is %s",
    async (_name, instances) => {
      const prisma = approvalDetailPrisma(instances);
      const service = new ProjectExpenseService(prisma as never);

      const detail = await service.getApprovalDetail(
        "project-1",
        "expense-1",
        "applicant-1"
      );

      expect(
        detail.availableActions.filter((action) => action.key === "withdraw")
      ).toEqual([]);
      expect(detail).toHaveProperty("withdrawalContext", null);
    }
  );

  it("does not publish withdraw when request and approval applicants disagree", async () => {
    const prisma = approvalDetailPrisma([
      approvalInstance({ applicantUserId: "other-applicant" })
    ]);
    const service = new ProjectExpenseService(prisma as never);

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "applicant-1"
    );

    expect(
      detail.availableActions.filter((action) => action.key === "withdraw")
    ).toEqual([]);
    expect(detail).toHaveProperty("withdrawalContext", null);
  });

  it("does not publish withdraw when financing quota has already been used", async () => {
    const prisma = approvalDetailPrisma(
      [approvalInstance()],
      { hasUsedFinancingQuota: true }
    );
    const service = new ProjectExpenseService(prisma as never);

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "applicant-1"
    );

    expect(
      detail.availableActions.filter((action) => action.key === "withdraw")
    ).toEqual([]);
    expect(detail).toHaveProperty("withdrawalContext", null);
    expect(detail.blockedReasons).toContain(
      "已有实付资金占用的项目支出不能撤回"
    );
  });

  it("does not query financing usage before detail authorization succeeds", async () => {
    const prisma = approvalDetailPrisma(
      [approvalInstance()],
      { applicantUserId: "other-applicant" }
    );
    const service = new ProjectExpenseService(prisma as never);

    await expect(
      service.getApprovalDetail(
        "project-1",
        "expense-1",
        "unauthorized-user"
      )
    ).rejects.toThrow("无权查看该项目支出审批详情");
    expect(
      prisma.projectExpenseFinancingQuotaUsage.findFirst
    ).not.toHaveBeenCalled();
  });

  it("checks applicant ownership before exposing withdrawal CAS facts", async () => {
    const { tx, withdraw } = withdrawalServiceFixture({
      applicantUserId: "other-applicant"
    });

    await expect(
      withdraw(
        withdrawalInput({
          expectedApprovalInstanceId: "forged-instance",
          expectedNodeIndex: 99
        })
      )
    ).rejects.toThrow("只有项目支出申请人可以撤回");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects duplicate in-progress approval instances without any partial write", async () => {
    const { audit, tx, withdraw } = withdrawalServiceFixture({
      instances: [
        approvalInstance(),
        approvalInstance({
          id: "approval-instance-2",
          updatedAt: new Date("2026-07-31T01:00:02.000Z")
        })
      ]
    });

    await expect(withdraw(withdrawalInput())).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "expense timestamp",
      withdrawalInput({
        expectedExpenseUpdatedAt: "2026-07-31T00:59:59.000Z"
      })
    ],
    [
      "approval id",
      withdrawalInput({
        expectedApprovalInstanceId: "approval-instance-old"
      })
    ],
    [
      "approval node",
      withdrawalInput({ expectedNodeIndex: 0 })
    ],
    [
      "approval timestamp",
      withdrawalInput({
        expectedApprovalUpdatedAt: "2026-07-31T00:59:59.000Z"
      })
    ]
  ])(
    "rejects stale %s coordinates without any partial write",
    async (_name, input) => {
      const { audit, tx, withdraw } =
        withdrawalServiceFixture();

      await expect(withdraw(input)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      "paid amount",
      { paidAmountCents: 1n },
      "已有实付的项目支出不能撤回"
    ],
    [
      "used financing quota",
      {
        financingUsages: [
          { amountCents: 1n, status: "used" as const }
        ]
      },
      "已有实付资金占用的项目支出不能撤回"
    ]
  ])(
    "fails closed for an approval-pending request with %s",
    async (_name, options, message) => {
      const { audit, tx, withdraw } =
        withdrawalServiceFixture(options);

      await expect(withdraw(withdrawalInput())).rejects.toThrow(
        message
      );
      expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("withdraws the exact request and instance while retaining action, funding, and audit facts", async () => {
    const { audit, tx, withdraw } =
      withdrawalServiceFixture();

    await expect(withdraw(withdrawalInput())).resolves.toEqual(
      expect.objectContaining({ status: "withdrawn" })
    );

    expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
      where: { id: "expense-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "applicant-1",
        action: "project_expense.approval.withdraw",
        businessType: "project_expense_request",
        businessId: "expense-1",
        metadata: expect.objectContaining({
          projectId: "project-1",
          expectedExpenseUpdatedAt: expenseUpdatedAt.toISOString(),
          expectedApprovalInstanceId: "approval-instance-1",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: approvalUpdatedAt.toISOString()
        })
      })
    );
    const requestLockQuery = tx.$queryRaw.mock.calls[0]?.[0] as
      | { strings?: readonly string[] }
      | undefined;
    const requestLockSql =
      requestLockQuery?.strings?.join(" ") ?? "";
    const requestLockWhereSql = requestLockSql.split("WHERE")[1] ?? "";
    expect(requestLockWhereSql).toContain('"id" =');
    expect(requestLockWhereSql).not.toContain('"code" =');
  });
});
