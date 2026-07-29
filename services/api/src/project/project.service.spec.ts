import { BadRequestException } from "@nestjs/common";
import type { RecordProjectProxyPaymentDto } from "./dto/record-project-proxy-payment.dto";
import type { RecordProjectReceiptDto } from "./dto/record-project-receipt.dto";
import type { RecordProjectUpstreamSettlementDto } from "./dto/record-project-upstream-settlement.dto";
import { projectMoneyToApi, ProjectService } from "./project.service";

function addApprovalSignatureQueries<T extends Record<string, unknown>>(
  tx: T
): T & { $queryRaw: jest.Mock } {
  return Object.assign(tx, {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: "signature-user", isActive: true }])
      .mockResolvedValueOnce([
        {
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: "a".repeat(64)
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "signature-file-1",
          contentSha256: "a".repeat(64),
          storageStatus: "active"
        }
      ])
  });
}

function addAffiliateSubjectTables<T extends Record<string, unknown>>(tx: T): T {
  const subjectTx = tx as T & {
    projectAffiliateAssignment?: { findMany?: jest.Mock };
    contractVersion?: { findFirst?: jest.Mock; findMany?: jest.Mock };
  };
  subjectTx.projectAffiliateAssignment ??= {};
  subjectTx.projectAffiliateAssignment.findMany ??= jest.fn().mockResolvedValue([
    {
      id: "assignment-legacy-test",
      businessPartyId: "party-legacy-test",
      businessPartyVersionId: "party-version-legacy-test",
      affiliateNameSnapshot: "测试挂靠企业",
      affiliateCreditCodeSnapshot: "91310000TEST",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z")
    }
  ]);
  subjectTx.contractVersion ??= {};
  subjectTx.contractVersion.findFirst ??= jest.fn().mockResolvedValue({
    id: "contract-version-legacy-test",
    signingSubjectType: "affiliate",
    affiliateAssignmentId: "assignment-legacy-test",
    affiliateBusinessPartyVersionId: "party-version-legacy-test",
    affiliateNameSnapshot: "测试挂靠企业"
  });
  subjectTx.contractVersion.findMany ??= jest.fn().mockResolvedValue([]);
  return tx;
}

describe("project money API boundary", () => {
  it("returns large bigint values as exact decimal strings", () => {
    expect(projectMoneyToApi(9_007_199_254_740_993n)).toBe("9007199254740993");
  });
});

describe("ProjectService", () => {
  it.each(["1e3", "0"])(
    "rejects receipt amount %s as HTTP 400 before opening a transaction",
    async (amountCents) => {
      const prisma = { $transaction: jest.fn() };
      const service = new ProjectService(prisma as never);

      const error = await service
        .recordReceipt("project-1", "finance-1", {
          receivedAt: "2026-07-02T00:00:00.000Z",
          amountCents,
          payerName: "总包单位",
          sourceType: "general_contractor_payment",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toBe("到账金额必须大于零");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      method: "createProject",
      input: { code: "", name: "项目" },
      message: "请填写项目编号"
    },
    {
      method: "createProject",
      input: { code: "XM-001", name: "" },
      message: "请填写项目名称"
    }
  ])("项目基础信息无效时返回中文错误", async ({ method, input, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);

    await expect(
      (service[method as "createProject"] as never as (
        actorUserId: string,
        value: unknown
      ) => Promise<unknown>)("user-1", input)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { field: "receivedAt", value: "bad-date", message: "到账日期不正确，请重新选择" },
    { field: "payerName", value: "", message: "请填写付款方名称" },
    { field: "sourceType", value: "bad-source", message: "到账来源类型不正确，请重新选择" },
    { field: "voucherFileId", value: "", message: "请上传到账凭证" },
    { field: "confirmationPassword", value: "", message: "请输入当前登录密码" }
  ])("到账 $field 无效时返回中文错误", async ({ field, value, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);
    const input = {
      receivedAt: "2026-07-02T00:00:00.000Z",
      amountCents: "100",
      payerName: "总包单位",
      sourceType: "general_contractor_payment",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      [field]: value
    };

    await expect(
      service.recordReceipt("project-1", "finance-1", input as never)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { field: "reportedAmountCents", value: "0", message: "对上结算报送金额必须大于零" },
    { field: "approvedAmountCents", value: "0", message: "对上结算审定金额必须大于零" },
    { field: "settledAt", value: "bad-date", message: "对上结算日期不正确，请重新选择" },
    { field: "approvingPartyName", value: "", message: "请填写对上结算审定方名称" },
    { field: "periodLabel", value: "", message: "请填写对上结算期间" },
    { field: "voucherFileId", value: "", message: "请上传对上结算凭证" },
    { field: "confirmationPassword", value: "", message: "请输入当前登录密码" }
  ])("对上结算 $field 无效时返回中文错误", async ({ field, value, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);
    const input = {
      settledAt: "2026-07-02T00:00:00.000Z",
      reportedAmountCents: "100",
      approvedAmountCents: "100",
      approvingPartyName: "建设单位",
      periodLabel: "2026-06",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      [field]: value
    };

    await expect(
      service.recordUpstreamSettlement("project-1", "budget-1", input as never)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { field: "ownerName", value: "", message: "请填写业主名称" },
    { field: "contractName", value: "", message: "请填写业主主合同名称" },
    { field: "contractCode", value: "", message: "请填写业主主合同编号" },
    { field: "signedAt", value: "bad-date", message: "业主主合同签订日期不正确，请重新选择" },
    { field: "amountCents", value: "0", message: "业主主合同金额必须大于零" },
    { field: "taxRateBps", value: undefined, message: "业主主合同税率必须是 0 到 10000 之间的整数" },
    { field: "pricingMethod", value: "", message: "请填写业主主合同计价方式" },
    { field: "paymentTermsSummary", value: "", message: "请填写业主主合同付款条款摘要" },
    { field: "retentionSummary", value: "", message: "请填写业主主合同质保金摘要" },
    { field: "fileId", value: "", message: "请上传业主主合同文件" }
  ])("业主主合同 $field 无效时返回中文错误", async ({ field, value, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);
    const input = {
      ownerName: "建设单位",
      contractName: "施工总承包合同",
      contractCode: "YZ-001",
      signedAt: "2026-07-02T00:00:00.000Z",
      amountCents: "100",
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按进度支付",
      retentionSummary: "3% 质保金",
      fileId: "file-1",
      [field]: value
    };

    await expect(
      service.recordOwnerContract("project-1", "staff-1", input as never)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { field: "contractId", value: "", message: "请选择结算例外额度关联合同" },
    { field: "amountCents", value: "0", message: "结算例外额度必须大于零" },
    { field: "reason", value: "", message: "请填写结算例外额度申请原因" },
    { field: "validUntil", value: "bad-date", message: "结算例外额度有效期不正确，请重新选择" },
    { field: "attachmentFileId", value: "", message: "请上传结算例外额度附件" }
  ])("结算例外额度 $field 无效时返回中文错误", async ({ field, value, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);
    const input = {
      contractId: "contract-1",
      amountCents: "100",
      reason: "临时额度",
      validUntil: "2099-07-02T00:00:00.000Z",
      attachmentFileId: "file-1",
      [field]: value
    };

    await expect(
      service.requestSettlementExceptionQuota("project-1", "manager-1", input as never)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { input: { decision: "invalid", confirmationPassword: "password" }, message: "结算例外额度审批动作无效" },
    { input: { decision: "approve", confirmationPassword: "" }, message: "请输入当前登录密码" }
  ])("结算例外额度审批参数无效时返回中文错误", async ({ input, message }) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);

    await expect(
      service.reviewSettlementExceptionQuota("project-1", "quota-1", "manager-1", input as never)
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a project and records an audit log", async () => {
    const tx = {
      project: {
        create: jest.fn().mockResolvedValue({ id: "project-1", code: "KM-2023-001", name: "昆明项目" })
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(addAffiliateSubjectTables(tx)))
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new ProjectService(prisma as never, audit as never);

    await expect(
      service.createProject("chairman-1", { code: " KM-2023-001 ", name: " 昆明项目 " })
    ).resolves.toEqual({ id: "project-1", code: "KM-2023-001", name: "昆明项目" });
    expect(tx.project.create).toHaveBeenCalledWith({
      data: { code: "KM-2023-001", name: "昆明项目" },
      select: { id: true, code: true, name: true }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "chairman-1",
        action: "project.create",
        businessType: "project",
        businessId: "project-1"
      })
    );
  });

  it("updates a project name and records an audit log", async () => {
    const tx = {
      project: {
        update: jest.fn().mockResolvedValue({ id: "project-1", code: "KM-2023-001", name: "昆明项目" })
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(addAffiliateSubjectTables(tx)))
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new ProjectService(prisma as never, audit as never);

    await expect(service.updateProject("project-1", "chairman-1", { name: " 昆明项目 " })).resolves.toEqual({
      id: "project-1",
      code: "KM-2023-001",
      name: "昆明项目"
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { name: "昆明项目" },
      select: { id: true, code: true, name: true }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "chairman-1",
        action: "project.update",
        businessType: "project",
        businessId: "project-1"
      })
    );
  });

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

  it("lists all active project options for global contract takeover positions", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-contract-director", key: "contract_director" }
        ])
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

    await expect(service.listActiveOptions("contract-director")).resolves.toEqual([
      { id: "project-1", code: "JG-001", name: "总部综合楼" }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("lists all active project options for global settlement creation budget positions", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-budget" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-budget", key: "budget_staff" }])
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

    await expect(service.listActiveOptions("budget-staff")).resolves.toEqual([
      { id: "project-1", code: "JG-001", name: "总部综合楼" }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("lists scoped project options for project contract takeover members", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "contract_staff" },
          { projectId: "project-2", positionKey: "employee" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1", code: "JG-001", name: "总部综合楼" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listActiveOptions("contract-staff")).resolves.toEqual([
      { id: "project-1", code: "JG-001", name: "总部综合楼" }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true, id: { in: ["project-1"] } },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("lists only active projects where the actor can create contracts", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { projectId: "project-1", positionId: "position-contract-staff" },
            { projectId: "project-2", positionId: "position-project-manager" }
          ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-contract-staff", key: "contract_staff" },
          { id: "position-project-manager", key: "project_manager" }
        ])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-3", positionKey: "contract_director" },
          { projectId: "project-4", positionKey: "employee" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1", code: "JG-001", name: "一标段" },
          { id: "project-2", code: "JG-002", name: "二标段" },
          { id: "project-3", code: "JG-003", name: "三标段" },
          { id: "project-4", code: "JG-004", name: "四标段" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listContractCreateOptions("contract-user")).resolves.toEqual([
      { id: "project-1", code: "JG-001", name: "一标段" },
      { id: "project-3", code: "JG-003", name: "三标段" }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
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

  it("lists every project roster for company leaders", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn(({ where }) => {
          if (where.userId === "leader" && where.projectId === null) {
            return Promise.resolve([{ positionId: "position-chairman" }]);
          }
          return Promise.resolve([]);
        })
      },
      projectRosterMember: {
        findMany: jest.fn(({ where }) => {
          if (where.userId === "leader") return Promise.resolve([]);
          return Promise.resolve([
            { projectId: "project-1", userId: "user-1" },
            { projectId: "project-2", userId: "user-2" }
          ]);
        })
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-chairman", key: "chairman" }])
      },
      projectMember: {
        findMany: jest.fn(({ where }) => {
          if (where.userId === "leader") return Promise.resolve([]);
          return Promise.resolve([
            { projectId: "project-1", userId: "user-1", positionKey: "project_manager" },
            { projectId: "project-2", userId: "user-2", positionKey: "employee" }
          ]);
        })
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1", code: "JG-001", name: "总部综合楼" },
          { id: "project-2", code: "JG-002", name: "二标段" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-1", name: "孙工", phone: "13300000001" },
          { id: "user-2", name: "杨工", phone: "13300000002" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listRoster("leader")).resolves.toEqual([
      {
        projectId: "project-1",
        projectCode: "JG-001",
        projectName: "总部综合楼",
        userId: "user-1",
        name: "孙工",
        phone: "13300000001",
        positionKeys: ["project_manager"],
        positionNames: ["项目经理"],
        globalPositionNames: [],
        projectPositionNames: ["项目经理"]
      },
      {
        projectId: "project-2",
        projectCode: "JG-002",
        projectName: "二标段",
        userId: "user-2",
        name: "杨工",
        phone: "13300000002",
        positionKeys: ["employee"],
        positionNames: ["员工"],
        globalPositionNames: [],
        projectPositionNames: ["员工"]
      }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  });

  it("lists only own project roster for ordinary project members", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }) => {
          if (where.userId === "employee") {
            return Promise.resolve([{ projectId: "project-2", userId: "employee", positionKey: "employee" }]);
          }
          return Promise.resolve([
            { projectId: "project-2", userId: "employee", positionKey: "employee" },
            { projectId: "project-2", userId: "user-3", positionKey: "engineering_foreman" }
          ]);
        })
      },
      projectRosterMember: {
        findMany: jest.fn(({ where }) => {
          if (where.userId === "employee") {
            return Promise.resolve([{ projectId: "project-2", userId: "employee" }]);
          }
          return Promise.resolve([
            { projectId: "project-2", userId: "employee" },
            { projectId: "project-2", userId: "user-3" }
          ]);
        })
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-2", code: "JG-002", name: "二标段" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "employee", name: "杨工", phone: "13300000002" },
          { id: "user-3", name: "蒋工", phone: "13300000003" }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.listRoster("employee")).resolves.toEqual([
      {
        projectId: "project-2",
        projectCode: "JG-002",
        projectName: "二标段",
        userId: "user-3",
        name: "蒋工",
        phone: "13300000003",
        positionKeys: ["engineering_foreman"],
        positionNames: ["工长"],
        globalPositionNames: [],
        projectPositionNames: ["工长"]
      },
      {
        projectId: "project-2",
        projectCode: "JG-002",
        projectName: "二标段",
        userId: "employee",
        name: "杨工",
        phone: "13300000002",
        positionKeys: ["employee"],
        positionNames: ["员工"],
        globalPositionNames: [],
        projectPositionNames: ["员工"]
      }
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { isActive: true, id: { in: ["project-2"] } },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
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
          { status: "effective", amountCents: 8000000n, payableAmountCents: 6400000n },
          { status: "effective", amountCents: 12000000n, payableAmountCents: 9600000n },
          { status: "approval_pending", amountCents: 5000000n, payableAmountCents: 4000000n }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            status: "approval_pending",
            requestedAmountCents: 3000000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
          },
          {
            id: "payment-2",
            status: "approved_pending_payment",
            requestedAmountCents: 5000000n,
            approvedAmountCents: 4800000n,
            paidAmountCents: 0n
          },
          {
            id: "payment-3",
            status: "paid",
            requestedAmountCents: 2000000n,
            approvedAmountCents: 2000000n,
            paidAmountCents: 2000000n
          },
          {
            id: "payment-4",
            status: "partially_paid",
            requestedAmountCents: 3000000n,
            approvedAmountCents: 3000000n,
            paidAmountCents: 1000000n
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 1000000n },
          { amountCents: 2000000n },
          { amountCents: 1000000n }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 900000n },
          { amountCents: 1900000n }
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
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-1",
            status: "approval_pending",
            companyPaymentAmountCents: 1_000_000n,
            canceledCompanyPaymentAmountCents: 0n,
            paidAmountCents: 0n
          },
          {
            id: "spot-payment-2",
            status: "partially_paid",
            companyPaymentAmountCents: 3_000_000n,
            canceledCompanyPaymentAmountCents: 1_000_000n,
            paidAmountCents: 500_000n
          },
          {
            id: "spot-payment-3",
            status: "paid",
            companyPaymentAmountCents: 1_000_000n,
            canceledCompanyPaymentAmountCents: 0n,
            paidAmountCents: 1_000_000n
          }
        ])
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 500_000n },
          { amountCents: 1_000_000n }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).resolves.toEqual({
      project: { id: "project-1", code: "JG-001", name: "总部综合楼" },
      cash: {
        actualReceiptsCents: "15000000",
        supplierRefundsCents: "0",
        availableFundsCents: "-800000",
        actualPaidCents: "5500000",
        approvalPendingOccupancyCents: "4000000",
        approvedPendingPaymentCents: "8300000",
        financeRecordedOutflowCents: "2800000"
      },
      business: {
        effectiveContractAmountCents: "35000000",
        effectiveSettlementAmountCents: "20000000",
        payableSettlementAmountCents: "16000000",
        operatingIncomeCents: "30000000",
        operatingCostCents: "8000000",
        grossProfitCents: "22000000"
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
      where: {
        projectId: "project-1",
        status: "approved",
        OR: [{ validUntil: null }, { validUntil: { gte: expect.any(Date) } }]
      },
      select: { id: true, amountCents: true }
    });
    expect(prisma.spotProcurementPaymentExecution.findMany).toHaveBeenCalledWith({
      where: {
        paymentId: {
          in: ["spot-payment-1", "spot-payment-2", "spot-payment-3"]
        },
        voidedAt: null
      },
      select: { amountCents: true }
    });
  });

  it("deducts financing usage and restores available cash from supplier refunds without relabeling receipts", async () => {
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
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          { id: "procurement-1" }
        ])
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 100_000n }
        ])
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
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

    expect(overview.cash).toEqual(
      expect.objectContaining({
        actualReceiptsCents: "0",
        supplierRefundsCents: "100000",
        availableFundsCents: "1300000"
      })
    );
    expect(prisma.projectFinancingQuotaUsage.findMany).toHaveBeenCalledWith({
      where: { quotaId: { in: ["financing-quota-1"] }, status: { in: ["occupied", "used"] } },
      select: { quotaId: true, amountCents: true }
    });
    expect(prisma.projectExpenseFinancingQuotaUsage.findMany).toHaveBeenCalledWith({
      where: { quotaId: { in: ["financing-quota-1"] }, status: { in: ["occupied", "used"] } },
      select: { quotaId: true, amountCents: true }
    });
  });

  it("fails closed when the spot-procurement overview delegate is unavailable", async () => {
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
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(
      service.getOperatingFundsOverview("project-1")
    ).rejects.toBeInstanceOf(TypeError);
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
      spotProcurement: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementRefund: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseExecution: { findMany: jest.fn() }
    };
    const service = new ProjectService(prisma as never);

    const overview = await service.getOperatingFundsOverview("project-1");

    expect(overview.business.effectiveContractAmountCents).toBe("37000000");
  });

  it("returns effective contract totals above the safe integer range without precision loss", async () => {
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
      spotProcurement: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementRefund: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseExecution: { findMany: jest.fn() }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("project-1")).resolves.toMatchObject({
      business: { effectiveContractAmountCents: "9007199254740992" }
    });
  });

  it("throws NotFound for missing or inactive project", async () => {
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getOperatingFundsOverview("missing")).rejects.toThrow(
      "项目不存在或已停用，请刷新后重试"
    );
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
          affiliateAssignmentId: "assignment-legacy-test",
          affiliateBusinessPartyVersionId: "party-version-legacy-test",
          affiliateNameSnapshot: "测试挂靠企业",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const receipt = await service.recordReceipt("project-1", "finance-1", {
      receivedAt,
      amountCents: "2500000",
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
      amountCents: "2500000",
      payerName: "总包单位",
      sourceType: "general_contractor_payment",
      sourceTypeLabel: "总包付款",
      description: "六月进度款",
      voucherFileId: "file-1",
      affiliateAssignmentId: "assignment-legacy-test",
      affiliateBusinessPartyVersionId: "party-version-legacy-test",
      affiliateNameSnapshot: "测试挂靠企业",
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
        affiliateAssignmentId: "assignment-legacy-test",
        affiliateBusinessPartyVersionId: "party-version-legacy-test",
        affiliateNameSnapshot: "测试挂靠企业",
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
    const findProxyPayments = jest.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
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
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective"
          })
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective",
            paidAmountCents: 1000000n,
            payableAmountCents: 5000000n
          }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 10000000n,
            paidAmountCents: 1000000n,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            dueDays: 0
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: findProxyPayments,
        create: jest.fn().mockResolvedValue({
          id: "proxy-payment-1",
          projectId: "project-1",
          paidAt: new Date(paidAt),
          amountCents: BigInt(2000000),
          generalContractorName: "总包单位",
          paidTargetName: "材料供应商",
          paymentType: "material",
          paymentSubjectType: "affiliate",
          affiliateAssignmentId: "assignment-legacy-test",
          affiliateBusinessPartyVersionId: "party-version-legacy-test",
          affiliateNameSnapshot: "测试挂靠企业",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.recordProxyPayment("project-1", "finance-1", {
      paidAt,
      amountCents: "2000000",
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
      amountCents: "2000000",
      generalContractorName: "总包单位",
      paidTargetName: "材料供应商",
      paymentType: "material",
      paymentTypeLabel: "材料",
      paymentSubjectType: "affiliate",
      affiliateAssignmentId: "assignment-legacy-test",
      affiliateBusinessPartyVersionId: "party-version-legacy-test",
      affiliateNameSnapshot: "测试挂靠企业",
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
        paymentSubjectType: "affiliate",
        affiliateAssignmentId: "assignment-legacy-test",
        affiliateBusinessPartyVersionId: "party-version-legacy-test",
        affiliateNameSnapshot: "测试挂靠企业",
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
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.settlement.findMany.mock.invocationCallOrder[0]
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findProxyPayments.mock.invocationCallOrder[0]
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.settlement.findFirst.mock.invocationCallOrder[1]
    );
  });

  it("rejects invalid project proxy payment date with a Chinese business reason", async () => {
    const service = new ProjectService({} as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "bad-date",
        amountCents: "100",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } as unknown as RecordProjectProxyPaymentDto)
    ).rejects.toThrow("总包代付日期不正确，请重新选择");
  });

  it("rejects invalid project proxy payment type with a Chinese business reason", async () => {
    const service = new ProjectService({} as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: "100",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "bad-type",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } as unknown as RecordProjectProxyPaymentDto)
    ).rejects.toThrow("总包代付类型不正确，请重新选择");
  });

  it("rejects project proxy payment when confirmed historical balances consume contract capacity", async () => {
    const paidAt = "2026-07-02T00:00:00.000Z";
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "locked" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" }),
        findUnique: jest.fn().mockResolvedValue({ source: "historical_takeover" })
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(100_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(0),
          historicalPaidCents: BigInt(80_000),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt,
        amountCents: "1",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        contractId: "HT-HIS-001"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("本次总包代付超过合同当前可代付金额，当前最多可代付 0.00 元");

    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
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
          affiliateAssignmentId: "assignment-legacy-test",
          affiliateBusinessPartyVersionId: "party-version-legacy-test",
          affiliateNameSnapshot: "测试挂靠企业",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.recordUpstreamSettlement("project-1", "budget-1", {
      settledAt,
      reportedAmountCents: "35000000",
      approvedAmountCents: "30000000",
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
      reportedAmountCents: "35000000",
      approvedAmountCents: "30000000",
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: false,
      description: "六月对上审定",
      voucherFileId: "file-1",
      affiliateAssignmentId: "assignment-legacy-test",
      affiliateBusinessPartyVersionId: "party-version-legacy-test",
      affiliateNameSnapshot: "测试挂靠企业",
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
        affiliateAssignmentId: "assignment-legacy-test",
        affiliateBusinessPartyVersionId: "party-version-legacy-test",
        affiliateNameSnapshot: "测试挂靠企业",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
          amountCents: string;
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
      amountCents: "200000000",
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
      amountCents: "200000000",
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
        affiliateAssignmentId: "assignment-legacy-test",
        affiliateBusinessPartyVersionId: "party-version-legacy-test",
        affiliateNameSnapshot: "测试挂靠企业",
        affiliateCreditCodeSnapshot: "91310000TEST",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
            amountCents: string;
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
        amountCents: "200000000",
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("业主主合同编号已存在");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
            amountCents: string;
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
        amountCents: "200000000",
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("该业主主合同文件已登记");
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
            amountCents: string;
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
        amountCents: "200000000",
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("业主主合同税率必须是 0 到 10000 之间的整数");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.requestSettlementExceptionQuota(
      "project-1",
      "project-manager-1",
      {
        contractId: "contract-1",
        amountCents: "3000000",
        reason: " 对上审定暂未覆盖本期必要结算 ",
        validUntil,
        attachmentFileId: "file-1"
      }
    );

    expect(result).toMatchObject({
      id: "quota-1",
      projectId: "project-1",
      contractId: "contract-1",
      amountCents: "3000000",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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

  it("allows finance staff to request a project financing quota without an expiry date", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-staff-1" })
      },
      projectFinancingQuota: {
        create: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: null,
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.requestProjectFinancingQuota("project-1", "finance-staff-1", {
      amountCents: "5000000",
      reason: " 阶段性垫资保障项目付款 ",
      attachmentFileId: "file-1"
    });

    expect(result).toMatchObject({
      id: "financing-quota-1",
      projectId: "project-1",
      amountCents: "5000000",
      status: "approval_pending",
      approvedByUserId: null,
      validUntil: null
    });
    expect(tx.projectFinancingQuota.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        amountCents: BigInt(5000000),
        reason: "阶段性垫资保障项目付款",
        validUntil: null,
        attachmentFileId: "file-1",
        requestedByUserId: "finance-staff-1",
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
        applicantUserId: "finance-staff-1",
        frozenNodes: [
          { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ]
      })
    });
  });

  it("allows an initiating finance director to independently approve the supervisor node", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = addApprovalSignatureQueries({
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "finance-director-1",
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
          requestedByUserId: "finance-director-1",
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
          applicantUserId: "finance-director-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
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
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.reviewProjectFinancingQuota(
      "project-1",
      "financing-quota-1",
      "finance-director-1",
      {
        decision: "approve",
        confirmationPassword: "current-password",
        selfReviewReason: "项目资金安排由本人发起并独立复核"
      }
    );

    expect(result.status).toBe("approval_pending");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({
        currentNodeIndex: 1,
        status: "in_progress"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approvedRoleKey: "finance_director",
        signatureFileIdSnapshot: "signature-file-1",
        signatureSha256Snapshot: "a".repeat(64),
        signatureVersionIdSnapshot: "signature-version-1",
        metadata: {
          selfReview: true,
          selfReviewReason: "项目资金安排由本人发起并独立复核"
        }
      })
    });
  });

  it("freezes the reviewer signature when a financing quota is rejected", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const tx = addApprovalSignatureQueries({
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: 5_000_000n,
          reason: "阶段性垫资保障项目付款",
          validUntil: null,
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "approval_pending",
          createdAt,
          updatedAt: createdAt
        }),
        update: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: 5_000_000n,
          reason: "阶段性垫资保障项目付款",
          validUntil: null,
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
          approvedByUserId: null,
          approvedAt: null,
          status: "rejected",
          createdAt,
          updatedAt: createdAt
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          applicantUserId: "finance-staff-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await service.reviewProjectFinancingQuota(
      "project-1",
      "financing-quota-1",
      "finance-director-1",
      {
        decision: "reject",
        confirmationPassword: "current-password",
        comment: "资金安排依据不足"
      }
    );

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "reject",
        approvedRoleKey: "finance_director",
        signatureFileIdSnapshot: "signature-file-1",
        signatureSha256Snapshot: "a".repeat(64),
        signatureVersionIdSnapshot: "signature-version-1"
      })
    });
  });

  it("approves a project financing quota after final OR-sign", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const approvedAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = addApprovalSignatureQueries({
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(5000000),
          reason: "阶段性垫资保障项目付款",
          validUntil: new Date("2099-07-02T00:00:00.000Z"),
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
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
          applicantUserId: "finance-staff-1",
          currentNodeIndex: 1,
          frozenNodes: [
            {
              name: "财务主管",
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
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
        currentNodeIndex: 2,
        status: "approved"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approvedRoleKey: "chairman",
        signatureFileIdSnapshot: "signature-file-1",
        signatureSha256Snapshot: "a".repeat(64),
        signatureVersionIdSnapshot: "signature-version-1"
      })
    });
  });

  it("terminates an approved financing quota without deleting historical allocations", async () => {
    const createdAt = new Date("2026-07-02T01:00:00.000Z");
    const approvedAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = addApprovalSignatureQueries({
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: 5_000_000n,
          reason: "阶段性垫资保障项目付款",
          validUntil: null,
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
          approvedByUserId: "chairman-1",
          approvedAt,
          status: "approved",
          terminatedAt: null,
          terminatedByUserId: null,
          terminationReason: null,
          terminationSignatureFileId: null,
          terminationSignatureSha256: null,
          terminationSignatureVersionId: null,
          createdAt,
          updatedAt: approvedAt
        }),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: "financing-quota-1",
          projectId: "project-1",
          amountCents: 5_000_000n,
          reason: "阶段性垫资保障项目付款",
          validUntil: null,
          attachmentFileId: "file-1",
          requestedByUserId: "finance-staff-1",
          approvedByUserId: "chairman-1",
          approvedAt,
          createdAt,
          updatedAt: data.terminatedAt,
          ...data
        }))
      },
      projectFundingAllocation: {
        deleteMany: jest.fn()
      },
      auditLog: { create: jest.fn() }
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const funding = { lockFundingContext: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      prisma as never,
      undefined,
      auth as never,
      funding as never
    );

    const result = await service.terminateProjectFinancingQuota(
      "project-1",
      "financing-quota-1",
      "finance-director-1",
      {
        reason: " 项目已具备自有资金，不再允许新占用 ",
        confirmationPassword: "current-password"
      }
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      "current-password"
    );
    expect(funding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(tx.projectFinancingQuota.update).toHaveBeenCalledWith({
      where: { id: "financing-quota-1" },
      data: {
        status: "terminated",
        terminatedAt: expect.any(Date),
        terminatedByUserId: "finance-director-1",
        terminationReason: "项目已具备自有资金，不再允许新占用",
        terminationSignatureFileId: "signature-file-1",
        terminationSignatureSha256: "a".repeat(64),
        terminationSignatureVersionId: "signature-version-1"
      }
    });
    expect(result).toMatchObject({
      status: "terminated",
      validUntil: null,
      terminatedByUserId: "finance-director-1",
      terminationReason: "项目已具备自有资金，不再允许新占用",
      terminationSignatureFileId: "signature-file-1"
    });
    expect(tx.projectFundingAllocation.deleteMany).not.toHaveBeenCalled();
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordUpstreamSettlement("project-1", "budget-1", {
        settledAt: "2026-07-02T00:00:00.000Z",
        reportedAmountCents: "35000000",
        approvedAmountCents: "30000000",
        approvingPartyName: "总包单位",
        periodLabel: "2026-06",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } satisfies RecordProjectUpstreamSettlementDto)
    ).rejects.toThrow("只能使用本人上传的对上结算凭证");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
            amountCents: string;
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
        amountCents: "200000000",
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).rejects.toThrow("只能使用本人上传的业主主合同文件");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
    ).rejects.toThrow("当前业主主合同状态不可确认");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
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
    ).rejects.toThrow("当前业主主合同状态不可确认");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: "2000000",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        contractId: "contract-1",
        settlementId: "settlement-other"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("关联合同结算不属于当前项目，请重新选择");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment that exceeds linked settlement remaining payable amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      settlement: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective"
          })
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective",
            paidAmountCents: 4000000n,
            payableAmountCents: 5000000n
          }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 10000000n,
            paidAmountCents: 4000000n,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            dueDays: 0
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: "2000000",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        settlementId: "settlement-1"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("本次总包代付超过结算剩余可付金额，当前最多可代付 5,000.00 元");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment that would overrun approved pending payment occupancy", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      settlement: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective"
          })
          .mockResolvedValueOnce({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            status: "effective",
            paidAmountCents: 1000000n,
            payableAmountCents: 5000000n
          }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 10000000n,
            paidAmountCents: 1000000n,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            dueDays: 0
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(500000) }]),
        create: jest.fn()
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 3000000n,
            approvedAmountCents: 3000000n,
            paidAmountCents: 0n
          }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-02T00:00:00.000Z",
        amountCents: "600000",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        settlementId: "settlement-1"
      } satisfies RecordProjectProxyPaymentDto)
    ).rejects.toThrow("本次总包代付超过结算剩余可付金额，当前最多可代付 5,000.00 元");
    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });

  it("rejects project proxy payment above contract due payment capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const findProxyPayments = jest.fn((args: { where?: { settlementId?: string; OR?: unknown } }) => {
        if (args.where?.OR) {
          return Promise.resolve([
            {
              amountCents: BigInt(3000000)
            }
          ]);
        }

        return Promise.resolve([]);
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
        project: {
          findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
        },
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      settlement: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: "settlement-1",
              projectId: "project-1",
              contractId: "contract-1",
              status: "effective"
            })
            .mockResolvedValueOnce({
              id: "settlement-1",
              projectId: "project-1",
              contractId: "contract-1",
              status: "effective",
              paidAmountCents: 0n,
              payableAmountCents: 2000000n
            }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              status: "effective",
              amountCents: 5000000n,
              paidAmountCents: 0n,
              paymentTermsVersionId: "terms-version-1"
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              dueDays: 0
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        projectProxyPayment: {
          findMany: findProxyPayments,
          create: jest.fn().mockResolvedValue({
            id: "proxy-payment-1",
            projectId: "project-1",
            paidAt: new Date("2026-07-02T00:00:00.000Z"),
            amountCents: BigInt(1200000),
            generalContractorName: "总包单位",
            paidTargetName: "材料供应商",
            paymentType: "material",
            voucherFileId: "file-1",
            recordedByUserId: "finance-1",
            contractId: "contract-1",
            settlementId: "settlement-1",
            voidedAt: null,
            createdAt: new Date("2026-07-02T01:00:00.000Z")
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
        $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
      };
      const auth = {
        confirmPassword: jest.fn().mockResolvedValue(undefined)
      };
      const service = new ProjectService(prisma as never, undefined, auth as never);

      await expect(
        service.recordProxyPayment("project-1", "finance-1", {
          paidAt: "2026-07-02T00:00:00.000Z",
          amountCents: "1200000",
          generalContractorName: "总包单位",
          paidTargetName: "材料供应商",
          paymentType: "material",
          voucherFileId: "file-1",
          confirmationPassword: "current-password",
          settlementId: "settlement-1"
        } satisfies RecordProjectProxyPaymentDto)
      ).rejects.toThrow("本次总包代付超过合同当前可代付金额，当前最多可代付 10,000.00 元");
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.settlement.findMany.mock.invocationCallOrder[0]
      );
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        findProxyPayments.mock.invocationCallOrder[0]
      );
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: { in: ["settlement", "contract_due"] }
          })
        })
      );
      expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("deducts paid contract advances from project proxy payment contract capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
        project: {
          findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
        },
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
        },
        settlement: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: "settlement-1",
              projectId: "project-1",
              contractId: "contract-1",
              status: "effective"
            })
            .mockResolvedValueOnce({
              id: "settlement-1",
              projectId: "project-1",
              contractId: "contract-1",
              status: "effective",
              paidAmountCents: 0n,
              payableAmountCents: 100000n
            }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              status: "effective",
              amountCents: 100000n,
              paidAmountCents: 0n,
              contractVersionId: "contract-version-1",
              isFinal: false,
              paymentTermsVersionId: "terms-version-1"
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "progress",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              advanceDeductionMode: null,
              advanceDeductionRatioBps: null,
              advanceDeductionStartRatioBps: null
            },
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 0,
              advanceDeductionMode: "per_settlement_ratio",
              advanceDeductionRatioBps: 2000,
              advanceDeductionStartRatioBps: null
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        contractVersion: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "contract-version-1",
              amountCents: 1000000n
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn()
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { sourceType?: string } }) => {
            if (args.where?.sourceType === "contract_advance") {
              return Promise.resolve([
                {
                  paymentTermsVersionId: "terms-version-1",
                  status: "paid",
                  requestedAmountCents: 20000n,
                  approvedAmountCents: 20000n,
                  paidAmountCents: 20000n
                }
              ]);
            }

            return Promise.resolve([]);
          })
        },
        auditLog: {
          create: jest.fn()
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
      };
      const auth = {
        confirmPassword: jest.fn().mockResolvedValue(undefined)
      };
      const service = new ProjectService(prisma as never, undefined, auth as never);

      await expect(
        service.recordProxyPayment("project-1", "finance-1", {
          paidAt: "2026-07-02T00:00:00.000Z",
          amountCents: "61000",
          generalContractorName: "总包单位",
          paidTargetName: "材料供应商",
          paymentType: "material",
          voucherFileId: "file-1",
          confirmationPassword: "current-password",
          settlementId: "settlement-1"
        } satisfies RecordProjectProxyPaymentDto)
      ).rejects.toThrow("本次总包代付超过合同当前可代付金额，当前最多可代付 600.00 元");
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: "contract_advance",
            paymentTermsVersionId: { in: ["terms-version-1"] },
            paidAmountCents: { gt: 0 }
          })
        })
      );
      expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects actual project receipt without voucher file", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ProjectService(prisma as never);

    await expect(
      service.recordReceipt("project-1", "finance-1", {
        receivedAt: "2026-07-02T00:00:00.000Z",
        amountCents: "2500000",
        payerName: "总包单位",
        sourceType: "general_contractor_payment",
        voucherFileId: "",
        confirmationPassword: "current-password"
      } satisfies RecordProjectReceiptDto)
    ).rejects.toThrow("请上传到账凭证");
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
      $transaction: jest.fn(async (callback) => callback(addAffiliateSubjectTables(tx)))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordReceipt("project-1", "finance-1", {
        receivedAt: "2026-07-02T00:00:00.000Z",
        amountCents: "2500000",
        payerName: "总包单位",
        sourceType: "general_contractor_payment",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      } satisfies RecordProjectReceiptDto)
    ).rejects.toThrow("只能使用本人上传的到账凭证");
    expect(tx.projectReceipt.create).not.toHaveBeenCalled();
  });
});
