import { ContractService } from "./contract.service";

interface WithdrawalInput {
  expectedContractUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

const CONTRACT_UPDATED_AT = new Date("2026-08-02T02:00:00.000Z");
const APPROVAL_UPDATED_AT = new Date("2026-08-02T02:00:01.000Z");
const WITHDRAWAL_COORDINATES: WithdrawalInput = {
  expectedContractUpdatedAt: CONTRACT_UPDATED_AT.toISOString(),
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 1,
  expectedApprovalUpdatedAt: APPROVAL_UPDATED_AT.toISOString()
};

function approvalInstance(
  overrides: Partial<{
    id: string;
    applicantUserId: string;
    currentNodeIndex: number;
    status: string;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: "approval-instance-1",
    applicantUserId: "applicant-1",
    currentNodeIndex: 1,
    status: "in_progress",
    frozenNodes: [],
    updatedAt: APPROVAL_UPDATED_AT,
    ...overrides
  };
}

function withdrawalFixture(
  options: {
    status?: string;
    contractUpdatedAt?: Date;
    versionExists?: boolean;
    expectedInstance?: ReturnType<typeof approvalInstance> | null;
    activeInstances?: readonly ReturnType<typeof approvalInstance>[];
  } = {}
) {
  const version = {
    id: "contract-version-1",
    contractId: "contract-1",
    status: options.status ?? "in_approval",
    taxFactStatus: "frozen",
    taxFactsFrozenAt: new Date("2026-08-02T01:30:00.000Z"),
    firstSubmittedAt: new Date("2026-08-01T08:00:00.000Z"),
    updatedAt: options.contractUpdatedAt ?? CONTRACT_UPDATED_AT
  };
  const expectedInstance = options.expectedInstance === undefined
    ? approvalInstance()
    : options.expectedInstance;
  const activeInstances = options.activeInstances ?? (
    expectedInstance ? [expectedInstance] : []
  );
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(
        options.versionExists === false ? null : version
      ),
      update: jest.fn().mockResolvedValue({
        ...version,
        status: "draft",
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      })
    },
    approvalInstance: {
      findFirst: jest.fn().mockImplementation((args: { where?: { id?: string } }) => {
        if (args.where?.id) return Promise.resolve(expectedInstance);
        return Promise.resolve(activeInstances[0] ?? null);
      }),
      findMany: jest.fn().mockResolvedValue(activeInstances),
      update: jest.fn()
    },
    approvalActionLog: { create: jest.fn() }
  };
  const audit = { record: jest.fn() };
  const prisma = {
    approvalInstance: {
      findFirst: jest.fn().mockImplementation((args: {
        where?: {
          id?: string;
          applicantUserId?: string;
          businessId?: string;
        };
      }) => {
        if (
          !expectedInstance ||
          args.where?.id !== expectedInstance.id ||
          args.where?.applicantUserId !== expectedInstance.applicantUserId ||
          args.where?.businessId !== version.id
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: expectedInstance.id });
      })
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  };
  const service = new ContractService(prisma as never, audit as never);
  const withdraw = (input: WithdrawalInput, actorUserId = "applicant-1") =>
    (service as unknown as {
      withdrawApproval(
        contractVersionId: string,
        actorUserId: string,
        input: WithdrawalInput
      ): Promise<unknown>;
    }).withdrawApproval("contract-version-1", actorUserId, input);

  return { audit, prisma, tx, version, withdraw };
}

function expectNoWithdrawalWrites(
  fixture: ReturnType<typeof withdrawalFixture>
) {
  expect(fixture.tx.contractVersion.update).not.toHaveBeenCalled();
  expect(fixture.tx.approvalInstance.update).not.toHaveBeenCalled();
  expect(fixture.tx.approvalActionLog.create).not.toHaveBeenCalled();
  expect(fixture.audit.record).not.toHaveBeenCalled();
}

describe("Contract approval withdrawal", () => {
  it.each([
    ["存在", true],
    ["不存在", false]
  ] as const)("对非申请人统一隐藏%s目标的存在性且零写", async (_label, versionExists) => {
    const fixture = withdrawalFixture({ versionExists });

    await expect(
      fixture.withdraw(WITHDRAWAL_COORDINATES, "other-user")
    ).rejects.toMatchObject({
      status: 403,
      response: {
        statusCode: 403,
        message: "只有合同审批申请人可以撤回审批"
      }
    });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.$queryRaw).not.toHaveBeenCalled();
    expect(fixture.tx.contractVersion.findUnique).not.toHaveBeenCalled();
    expectNoWithdrawalWrites(fixture);
  });

  it("保留已绑定申请人对真实缺失合同版本的 404 语义", async () => {
    const fixture = withdrawalFixture({ versionExists: false });

    await expect(
      fixture.withdraw(WITHDRAWAL_COORDINATES)
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: {
        id: "approval-instance-1",
        applicantUserId: "applicant-1",
        businessType: "contract_version",
        businessId: "contract-version-1",
        flowType: "contract.approve"
      },
      select: { id: true }
    });
    expectNoWithdrawalWrites(fixture);
  });

  it.each([
    ["contract", { expectedContractUpdatedAt: "2026-08-02T01:59:59.000Z" }],
    ["node", { expectedNodeIndex: 0 }],
    ["approval", { expectedApprovalUpdatedAt: "2026-08-02T01:59:59.000Z" }]
  ])("rejects stale %s coordinates with a stable conflict and zero writes", async (_label, drift) => {
    const fixture = withdrawalFixture();

    await expect(fixture.withdraw({
      ...WITHDRAWAL_COORDINATES,
      ...drift
    })).rejects.toMatchObject({
      status: 409,
      response: {
        code: "CONTRACT_APPROVAL_WITHDRAWAL_CONFLICT",
        message: "合同审批状态或撤回坐标已变化，请刷新页面后重试"
      }
    });
    expectNoWithdrawalWrites(fixture);
  });

  it("rejects an applicant's stale approval instance coordinate with a stable conflict and zero writes", async () => {
    const staleInstance = approvalInstance({ id: "approval-instance-stale" });
    const fixture = withdrawalFixture({
      expectedInstance: staleInstance,
      activeInstances: [approvalInstance()]
    });

    await expect(fixture.withdraw({
      ...WITHDRAWAL_COORDINATES,
      expectedApprovalInstanceId: staleInstance.id
    })).rejects.toMatchObject({
      status: 409,
      response: {
        code: "CONTRACT_APPROVAL_WITHDRAWAL_CONFLICT",
        message: "合同审批状态或撤回坐标已变化，请刷新页面后重试"
      }
    });
    expectNoWithdrawalWrites(fixture);
  });

  it("fails closed when active approval instances are duplicated", async () => {
    const fixture = withdrawalFixture({
      activeInstances: [
        approvalInstance(),
        approvalInstance({ id: "approval-instance-2" })
      ]
    });

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).rejects.toMatchObject({
      status: 409,
      response: { code: "CONTRACT_APPROVAL_WITHDRAWAL_CONFLICT" }
    });
    expectNoWithdrawalWrites(fixture);
  });

  it.each([
    ["terminal contract", { status: "approved_pending_seal", activeInstances: [] }],
    ["stale contract", {
      contractUpdatedAt: new Date("2026-08-02T02:00:02.000Z")
    }],
    ["duplicate active approvals", {
      activeInstances: [approvalInstance(), approvalInstance({ id: "approval-instance-2" })]
    }]
  ] as const)("checks applicant authority before exposing %s", async (_label, options) => {
    const fixture = withdrawalFixture(options);

    await expect(
      fixture.withdraw(WITHDRAWAL_COORDINATES, "other-user")
    ).rejects.toMatchObject({
      status: 403,
      response: {
        statusCode: 403,
        message: "只有合同审批申请人可以撤回审批"
      }
    });
    expectNoWithdrawalWrites(fixture);
  });

  it("withdraws the exact locked version and approval in one audited transaction", async () => {
    const fixture = withdrawalFixture();

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).resolves.toMatchObject({
      status: "draft",
      taxFactStatus: "draft",
      taxFactsFrozenAt: null,
      firstSubmittedAt: fixture.version.firstSubmittedAt
    });

    expect(
      fixture.prisma.approvalInstance.findFirst.mock.invocationCallOrder[0]
    ).toBeLessThan(fixture.prisma.$transaction.mock.invocationCallOrder[0]!);
    expect(fixture.tx.$queryRaw).toHaveBeenCalledTimes(2);
    const lockSql = fixture.tx.$queryRaw.mock.calls.map(
      ([query]) => (query as { strings: readonly string[] }).strings.join("")
    );
    expect(lockSql[0]).toContain('FROM "ContractVersion"');
    expect(lockSql[1]).toContain('FROM "ApprovalInstance"');
    expect(fixture.tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: {
        status: "draft",
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      }
    });
    expect(fixture.tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(fixture.tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        actorUserId: "applicant-1",
        action: "contract.approval.withdraw",
        businessType: "contract_version",
        businessId: "contract-version-1",
        metadata: expect.objectContaining(WITHDRAWAL_COORDINATES)
      })
    );
  });

  it("does not snapshot a signature or perform downstream writes", async () => {
    const fixture = withdrawalFixture();

    await fixture.withdraw(WITHDRAWAL_COORDINATES);

    expect(Object.keys(fixture.tx).sort()).toEqual([
      "$queryRaw",
      "approvalActionLog",
      "approvalInstance",
      "contractVersion"
    ]);
  });
});
