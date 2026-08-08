import { ContractAuthorizationService } from "./contract-authorization.service";

function createHarness() {
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "draft",
    draftRevision: 2,
    contractGovernanceVersion: 1,
    readinessSnapshot: { ready: true }
  };
  const formalFacts = {
    hasSignedFormalFile: false,
    hasActiveSealTask: false,
    hasArchiveFile: false,
    hasSettlement: false,
    hasPaymentRequest: false
  };
  const tx = {
    $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes("FOR UPDATE OF cv")) return [version];
      if (sql.includes("FOR UPDATE OF c")) {
        return [{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }];
      }
      if (sql.includes('AS "hasSignedFormalFile"')) return [formalFacts];
      return [];
    }),
    contractVersionAuthorizationLink: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: "link-1", ...create })),
      findMany: jest.fn().mockResolvedValue([])
    },
    contractAuthorization: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: "auth-1", ...data })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractVersion: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractFormalFile: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
  };
  const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
  return { version, formalFacts, tx, prisma };
}

describe("ContractAuthorizationService", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true]
  ])("accepts the explicit authorization combination first_party=%s counterparty=%s", async (
    firstPartyRequired,
    counterpartyRequired
  ) => {
    const { version, tx, prisma } = createHarness();
    tx.contractVersionAuthorizationLink.findMany.mockResolvedValue([
      {
        side: "first_party",
        required: firstPartyRequired,
        authorizationId: firstPartyRequired ? "auth-first" : null
      },
      {
        side: "counterparty",
        required: counterpartyRequired,
        authorizationId: counterpartyRequired ? "auth-counterparty" : null
      }
    ]);
    tx.contractAuthorization.findUnique.mockImplementation(({ where }) => ({
      id: where.id,
      side: where.id === "auth-first" ? "first_party" : "counterparty",
      status: "active",
      fileId: `file-${where.id}`,
      contentSha256: "a".repeat(64),
      pageCount: 1
    }));
    const formalFiles = { inspectLinkedPdf: jest.fn().mockResolvedValue({ pageCount: 1 }) };
    const service = new ContractAuthorizationService(
      prisma as never,
      formalFiles as never
    );

    await expect(service.assertReady(tx as never, version as never)).resolves.toHaveLength(2);
    expect(formalFiles.inspectLinkedPdf).toHaveBeenCalledTimes(
      Number(firstPartyRequired) + Number(counterpartyRequired)
    );
  });

  it("明确保存双方不需要授权，重复请求不递增修订", async () => {
    const { version, tx, prisma } = createHarness();
    const service = new ContractAuthorizationService(prisma as never);
    await service.setSide("version-1", "owner-1", {
      side: "first_party",
      expectedRevision: 2,
      required: false
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ draftRevision: { increment: 1 }, readinessSnapshot: expect.anything() })
    }));
    // 授权选择变化使同一版本上已确认的乙方签章事实（含桥接预览）一并失效（#13）。
    expect(tx.contractFormalFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contractVersionId: "version-1",
        purpose: { in: ["approval_original", "counterparty_signed", "counterparty_signed_preview"] },
        status: "active"
      }),
      data: expect.objectContaining({
        status: "superseded",
        invalidationReason: "授权选择已变化，请重新上传完整审批文件"
      })
    }));

    version.draftRevision = 3;
    tx.contractVersionAuthorizationLink.findUnique.mockResolvedValue({
      id: "link-1", contractVersionId: "version-1", side: "first_party", required: false,
      authorizationId: null, reusedFromContractVersionId: null
    });
    await service.setSide("version-1", "owner-1", {
      side: "first_party", expectedRevision: 2, required: false
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
  });

  it("draft 状态已有双方签署事实时禁止继续修改授权", async () => {
    const { formalFacts, tx, prisma } = createHarness();
    formalFacts.hasSignedFormalFile = true;
    const service = new ContractAuthorizationService(prisma as never);

    await expect(
      service.setSide("version-1", "owner-1", {
        side: "first_party",
        expectedRevision: 2,
        required: false
      })
    ).rejects.toThrow("正式业务事实");
    expect(tx.contractVersionAuthorizationLink.upsert).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("link 缺失不能当成不需要授权", async () => {
    const { version, tx, prisma } = createHarness();
    const service = new ContractAuthorizationService(prisma as never);
    await expect(service.assertReady(tx as never, version as never))
      .rejects.toThrow("尚未明确我方是否需要授权委托书");
  });

  it("required 必须关联有效授权且两侧成对齐全", async () => {
    const { version, tx, prisma } = createHarness();
    tx.contractVersionAuthorizationLink.findMany.mockResolvedValue([
      { side: "first_party", required: true, authorizationId: null },
      { side: "counterparty", required: false, authorizationId: null }
    ]);
    const service = new ContractAuthorizationService(prisma as never);
    await expect(service.assertReady(tx as never, version as never))
      .rejects.toThrow("我方授权委托书尚未关联");
  });

  it("readiness endpoint does not report an inactive authorization as ready", async () => {
    const { version, tx, prisma } = createHarness();
    tx.contractVersion.findUnique.mockResolvedValue(version);
    tx.contractVersionAuthorizationLink.findMany.mockResolvedValue([
      { side: "first_party", required: true, authorizationId: "auth-inactive" },
      { side: "counterparty", required: false, authorizationId: null }
    ]);
    tx.contractAuthorization.findUnique.mockResolvedValue({
      id: "auth-inactive", side: "first_party", status: "invalidated"
    });
    const service = new ContractAuthorizationService(prisma as never);

    await expect(service.ready(version.id)).resolves.toMatchObject({
      companyRequired: true,
      counterpartyRequired: false,
      ready: false,
      blockingMessage: "我方授权委托书当前不可用，请重新关联"
    });
  });

  it.each([
    ["contract-other", "effective", "first_party", "张三", "签署、履行、变更及补充协议", "该授权委托书不满足本合同复用条件"],
    ["contract-1", "draft", "first_party", "张三", "签署、履行、变更及补充协议", "该授权委托书不满足本合同复用条件"],
    ["contract-1", "effective", "counterparty", "张三", "签署、履行、变更及补充协议", "该授权委托书不满足本合同复用条件"],
    ["contract-1", "effective", "first_party", "李四", "签署、履行、变更及补充协议", "该授权委托书不满足本合同复用条件"],
    ["contract-1", "effective", "first_party", "张三", "仅签署合同", "该授权委托书不满足本合同复用条件"]
  ])("rejects invalid authorization reuse boundaries %#", async (
    sourceContractId,
    sourceStatus,
    authorizationSide,
    authorizationAgent,
    scopeSummary,
    message
  ) => {
    const { tx, prisma } = createHarness();
    tx.contractVersionAuthorizationLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        contractVersionId: "source-1",
        side: "first_party",
        required: true,
        authorizationId: "auth-1"
      });
    tx.contractAuthorization.findUnique.mockResolvedValue({
      id: "auth-1",
      originContractVersionId: "source-1",
      side: authorizationSide,
      agentName: authorizationAgent,
      scopeSummary,
      status: "active",
      fileId: "file-auth",
      contentSha256: "a".repeat(64),
      pageCount: 1
    });
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "source-1",
      contractId: sourceContractId,
      status: sourceStatus
    });
    const service = new ContractAuthorizationService(
      prisma as never,
      { inspectLinkedPdf: jest.fn() } as never
    );

    await expect(service.setSide("version-1", "owner-1", {
      side: "first_party",
      expectedRevision: 2,
      required: true,
      reuse: {
        authorizationId: "auth-1",
        sourceContractVersionId: "source-1",
        agentName: "张三"
      }
    })).rejects.toThrow(message);
    expect(tx.contractVersionAuthorizationLink.upsert).not.toHaveBeenCalled();
  });

  it("reuses an active authorization only from an effective version of the same contract", async () => {
    const { tx, prisma } = createHarness();
    tx.contractVersionAuthorizationLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        contractVersionId: "source-1",
        side: "first_party",
        required: true,
        authorizationId: "auth-1"
      });
    tx.contractAuthorization.findUnique.mockResolvedValue({
      id: "auth-1",
      originContractVersionId: "source-1",
      side: "first_party",
      agentName: "张三",
      scopeSummary: "授权签署、履行、变更及补充协议",
      status: "active",
      fileId: "file-auth",
      contentSha256: "a".repeat(64),
      pageCount: 1
    });
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "source-1", contractId: "contract-1", status: "effective"
    });
    const inspectLinkedPdf = jest.fn().mockResolvedValue({ pageCount: 1 });
    const service = new ContractAuthorizationService(
      prisma as never,
      { inspectLinkedPdf } as never
    );

    await expect(service.setSide("version-1", "owner-1", {
      side: "first_party",
      expectedRevision: 2,
      required: true,
      reuse: {
        authorizationId: "auth-1",
        sourceContractVersionId: "source-1",
        agentName: "张三"
      }
    })).resolves.toMatchObject({ changed: true, revision: 3 });
    expect(inspectLinkedPdf).toHaveBeenCalled();
    expect(tx.contractVersionAuthorizationLink.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        side: "first_party",
        authorizationId: "auth-1",
        reusedFromContractVersionId: "source-1"
      })
    }));
  });

  it("supersedes the prior active authorization before creating a replacement", async () => {
    const { tx, prisma } = createHarness();
    tx.contractAuthorization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "auth-old", status: "active" });
    tx.contractFormalFile.findFirst.mockResolvedValue(null);
    const service = new ContractAuthorizationService(
      prisma as never,
      {
        inspectOwnedPdf: jest.fn().mockResolvedValue({ sha256: "b".repeat(64), pageCount: 2 })
      } as never
    );

    await service.setSide("version-1", "owner-1", {
      side: "first_party",
      expectedRevision: 2,
      required: true,
      upload: {
        fileId: "file-new",
        grantorName: "我方公司",
        agentName: "张三",
        scopeSummary: "签署合同"
      }
    });

    expect(tx.contractAuthorization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "auth-old", status: "active" },
      data: expect.objectContaining({ status: "superseded" })
    }));
    expect(tx.contractAuthorization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        side: "first_party",
        supersedesId: "auth-old",
        status: "active"
      })
    });
  });

  it("rejects treating a file already bound to another contract as a new upload", async () => {
    const { tx, prisma } = createHarness();
    tx.contractAuthorization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "auth-other",
        originContractVersionId: "other-version",
        status: "invalidated"
      });
    const service = new ContractAuthorizationService(
      prisma as never,
      {
        inspectOwnedPdf: jest.fn().mockResolvedValue({ sha256: "b".repeat(64), pageCount: 1 })
      } as never
    );

    await expect(service.setSide("version-1", "owner-1", {
      side: "first_party",
      expectedRevision: 2,
      required: true,
      upload: {
        fileId: "file-bound",
        grantorName: "我方公司",
        agentName: "张三",
        scopeSummary: "签署合同"
      }
    })).rejects.toThrow("该文件已关联其他合同签署事实");
    expect(tx.contractAuthorization.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "P2034" }, "合同授权资料正在更新，请刷新后重试"],
    [{ code: "P2010", meta: { code: "40001" } }, "合同授权资料正在更新，请刷新后重试"],
    [{ code: "P2002" }, "合同授权资料已被更新，请刷新后确认当前选择"]
  ])("maps concurrent write conflicts to stable errors %#", async (conflict, message) => {
    const prisma = { $transaction: jest.fn().mockRejectedValue(conflict) };
    const service = new ContractAuthorizationService(prisma as never);
    await expect(service.setSide("version-1", "owner-1", {
      side: "first_party", expectedRevision: 2, required: false
    })).rejects.toThrow(message);
  });
});
