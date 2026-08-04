import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

interface WithdrawalInput {
  expectedSettlementUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

const SETTLEMENT_UPDATED_AT = new Date("2026-08-02T04:00:00.000Z");
const APPROVAL_UPDATED_AT = new Date("2026-08-02T04:00:01.000Z");
const WITHDRAWAL_COORDINATES: WithdrawalInput = {
  expectedSettlementUpdatedAt: SETTLEMENT_UPDATED_AT.toISOString(),
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
    settlementUpdatedAt?: Date;
    settlementExists?: boolean;
    releasedQuotaCount?: number;
    expectedInstance?: ReturnType<typeof approvalInstance> | null;
    activeInstances?: readonly ReturnType<typeof approvalInstance>[];
  } = {}
) {
  const settlement = {
    id: "settlement-1",
    projectId: "project-1",
    status: options.status ?? "approval_pending",
    updatedAt: options.settlementUpdatedAt ?? SETTLEMENT_UPDATED_AT
  };
  const expectedInstance = options.expectedInstance === undefined
    ? approvalInstance()
    : options.expectedInstance;
  const activeInstances = options.activeInstances ?? (
    expectedInstance ? [expectedInstance] : []
  );
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    settlement: {
      findUnique: jest.fn().mockResolvedValue(
        options.settlementExists === false ? null : settlement
      ),
      update: jest.fn().mockResolvedValue({
        ...settlement,
        status: "withdrawn"
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
    approvalActionLog: { create: jest.fn() },
    projectSettlementExceptionQuotaUsage: {
      updateMany: jest.fn().mockResolvedValue({ count: options.releasedQuotaCount ?? 1 })
    }
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  let committedTransactions = 0;
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
          args.where?.businessId !== settlement.id
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: expectedInstance.id });
      })
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      const result = await callback(tx);
      committedTransactions += 1;
      return result;
    })
  };
  const service = new SettlementService(prisma as never, audit as never);
  const withdraw = (input: WithdrawalInput, actorUserId = "applicant-1") =>
    (service as unknown as {
      withdrawApproval(
        settlementId: string,
        actorUserId: string,
        input: WithdrawalInput
      ): Promise<unknown>;
    }).withdrawApproval("settlement-1", actorUserId, input);

  return {
    audit,
    committedTransactions: () => committedTransactions,
    prisma,
    settlement,
    tx,
    withdraw
  };
}

function expectNoWithdrawalWrites(fixture: ReturnType<typeof withdrawalFixture>) {
  expect(fixture.tx.settlement.update).not.toHaveBeenCalled();
  expect(fixture.tx.approvalInstance.update).not.toHaveBeenCalled();
  expect(fixture.tx.approvalActionLog.create).not.toHaveBeenCalled();
  expect(fixture.tx.projectSettlementExceptionQuotaUsage.updateMany).not.toHaveBeenCalled();
  expect(fixture.audit.record).not.toHaveBeenCalled();
}

describe("Settlement approval withdrawal", () => {
  it.each([
    ["存在", true],
    ["不存在", false]
  ] as const)("对非申请人统一隐藏%s目标的存在性且零写", async (_label, settlementExists) => {
    const fixture = withdrawalFixture({ settlementExists });

    await expect(
      fixture.withdraw(WITHDRAWAL_COORDINATES, "other-user")
    ).rejects.toMatchObject({
      status: 403,
      response: {
        statusCode: 403,
        message: "只有结算审批申请人可以撤回审批"
      }
    });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.$queryRaw).not.toHaveBeenCalled();
    expect(fixture.tx.settlement.findUnique).not.toHaveBeenCalled();
    expect(fixture.committedTransactions()).toBe(0);
    expectNoWithdrawalWrites(fixture);
  });

  it("保留已绑定申请人对真实缺失结算单的 404 语义", async () => {
    const fixture = withdrawalFixture({ settlementExists: false });

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).rejects.toMatchObject({
      status: 404
    });
    expect(fixture.prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: {
        id: "approval-instance-1",
        applicantUserId: "applicant-1",
        businessType: "settlement",
        businessId: "settlement-1",
        flowType: "settlement.approve"
      },
      select: { id: true }
    });
    expect(fixture.committedTransactions()).toBe(0);
    expectNoWithdrawalWrites(fixture);
  });

  it.each([
    ["settlement", { expectedSettlementUpdatedAt: "2026-08-02T03:59:59.000Z" }],
    ["node", { expectedNodeIndex: 0 }],
    ["approval", { expectedApprovalUpdatedAt: "2026-08-02T03:59:59.000Z" }]
  ])("rejects stale %s coordinates with a stable conflict and zero writes", async (_label, drift) => {
    const fixture = withdrawalFixture();

    await expect(fixture.withdraw({
      ...WITHDRAWAL_COORDINATES,
      ...drift
    })).rejects.toMatchObject({
      status: 409,
      response: {
        code: "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT",
        message: "结算审批状态或撤回坐标已变化，请刷新页面后重试"
      }
    });
    expect(fixture.committedTransactions()).toBe(0);
    expectNoWithdrawalWrites(fixture);
  });

  it("rejects an applicant's stale approval instance coordinate with zero writes", async () => {
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
      response: { code: "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT" }
    });
    expect(fixture.committedTransactions()).toBe(0);
    expectNoWithdrawalWrites(fixture);
  });

  it.each([
    ["terminal settlement", { status: "approved_pending_archive", activeInstances: [] }],
    ["stale settlement", {
      settlementUpdatedAt: new Date("2026-08-02T04:00:02.000Z")
    }],
    ["duplicate active approvals", {
      activeInstances: [approvalInstance(), approvalInstance({ id: "approval-instance-2" })]
    }]
  ] as const)("fails closed for %s with a stable conflict", async (_label, options) => {
    const fixture = withdrawalFixture(options);

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).rejects.toMatchObject({
      status: 409,
      response: { code: "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT" }
    });
    expect(fixture.committedTransactions()).toBe(0);
    expectNoWithdrawalWrites(fixture);
  });

  it("withdraws the exact locked settlement and approval in one audited transaction", async () => {
    const fixture = withdrawalFixture();

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).resolves.toMatchObject({
      status: "withdrawn"
    });

    expect(
      fixture.prisma.approvalInstance.findFirst.mock.invocationCallOrder[0]
    ).toBeLessThan(fixture.prisma.$transaction.mock.invocationCallOrder[0]!);
    expect(fixture.tx.$queryRaw).toHaveBeenCalledTimes(2);
    const lockSql = fixture.tx.$queryRaw.mock.calls.map(
      ([query]) => (query as { strings: readonly string[] }).strings.join("")
    );
    expect(lockSql[0]).toContain('FROM "Settlement"');
    expect(lockSql[1]).toContain('FROM "ApprovalInstance"');
    expect(lockSql[1]).toContain('ORDER BY "id"');
    expect(fixture.tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "withdrawn" }
    });
    expect(fixture.tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(fixture.tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(fixture.tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", status: "occupied" },
      data: { status: "released" }
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.tx, {
      actorUserId: "applicant-1",
      action: "settlement.exception_quota.release.withdraw",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: { releasedUsageCount: 1 }
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.tx, {
        actorUserId: "applicant-1",
        action: "settlement.approval.withdraw",
        businessType: "settlement",
        businessId: "settlement-1",
        metadata: {
          fromStatus: "approval_pending",
          toStatus: "withdrawn",
          applicantUserId: "applicant-1",
          ...WITHDRAWAL_COORDINATES
        }
      });
    expect(Object.keys(fixture.tx).sort()).toEqual([
      "$queryRaw",
      "approvalActionLog",
      "approvalInstance",
      "projectSettlementExceptionQuotaUsage",
      "settlement"
    ]);
    expect(fixture.committedTransactions()).toBe(1);
  });

  it("does not emit a quota-release Audit when no occupied quota remains", async () => {
    const fixture = withdrawalFixture({ releasedQuotaCount: 0 });

    await fixture.withdraw(WITHDRAWAL_COORDINATES);

    expect(fixture.audit.record).not.toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({ action: "settlement.exception_quota.release.withdraw" })
    );
    expect(fixture.audit.record).toHaveBeenCalledTimes(1);
    expect(fixture.committedTransactions()).toBe(1);
  });

  it("propagates an Audit failure from inside the unit transaction callback", async () => {
    const fixture = withdrawalFixture();
    fixture.audit.record.mockImplementation(async (_tx, event: { action: string }) => {
      if (event.action === "settlement.approval.withdraw") {
        throw new Error("AUDIT_WRITE_FAILED");
      }
    });

    await expect(fixture.withdraw(WITHDRAWAL_COORDINATES)).rejects.toThrow(
      "AUDIT_WRITE_FAILED"
    );

    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.tx.settlement.update).toHaveBeenCalledTimes(1);
    expect(fixture.tx.approvalInstance.update).toHaveBeenCalledTimes(1);
    expect(fixture.tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.committedTransactions()).toBe(0);
  });
});

function readFixture(
  activeInstanceCount = 1,
  status = "approval_pending"
) {
  const settlement = {
    id: "settlement-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "contract-version-1",
    paymentTermsVersionId: "terms-1",
    code: "JS-2026-001",
    periodLabel: "2026-07",
    status,
    sourceType: "system",
    amountCents: 500_000n,
    payableAmountCents: 500_000n,
    governanceVersion: null,
    updatedAt: SETTLEMENT_UPDATED_AT
  };
  const instance = approvalInstance();
  const instances = Array.from({ length: activeInstanceCount }, (_, index) => ({
    ...instance,
    id: index === 0 ? instance.id : `approval-instance-${index + 1}`
  }));
  const prisma = {
    settlement: { findFirst: jest.fn().mockResolvedValue(settlement) },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-1",
        code: "HT-2026-001",
        name: "测试合同"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        versionNo: 1,
        taxFactRevision: null
      })
    },
    paymentTermsVersion: {
      findUnique: jest.fn().mockResolvedValue({ id: "terms-1", versionNo: 1 })
    },
    paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    },
    settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
    settlementLine: { findMany: jest.fn().mockResolvedValue([]) },
    approvalInstance: {
      findFirst: jest.fn().mockResolvedValue(instance),
      findMany: jest.fn().mockResolvedValue(instances)
    },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const projectVisibility = {
    effectiveRoleKeys: jest.fn().mockResolvedValue([])
  };
  return {
    service: new SettlementReadService(prisma as never, projectVisibility as never)
  };
}

describe("Settlement approval withdrawal read coordinates", () => {
  it("publishes four-coordinate context and one enabled action only to the applicant", async () => {
    const { service } = readFixture();

    const detail = await service.getDetail(
      "JS-2026-001",
      ["project-1"],
      "applicant-1"
    );

    expect(detail).toHaveProperty("withdrawApprovalContext", WITHDRAWAL_COORDINATES);
    expect(detail.lifecycleUpdatedAt).toBe(SETTLEMENT_UPDATED_AT.toISOString());
    expect(detail.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    )).toHaveLength(1);
  });

  it.each([
    ["non-applicant", 1, "approval_pending", "reviewer-1"],
    ["missing active instance", 0, "approval_pending", "applicant-1"],
    ["duplicate active instances", 2, "approval_pending", "applicant-1"],
    ["terminal settlement", 1, "approved_pending_archive", "applicant-1"]
  ] as const)("does not publish withdrawal authority for %s", async (
    _label,
    count,
    status,
    actorUserId
  ) => {
    const { service } = readFixture(count, status);

    const detail = await service.getDetail(
      "JS-2026-001",
      ["project-1"],
      actorUserId
    );

    expect(detail).toHaveProperty("withdrawApprovalContext", null);
    expect(detail.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    )).toEqual([]);
  });
});
