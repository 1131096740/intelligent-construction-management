import { ContractSealService } from "./contract-seal.service";

function harness() {
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "approved_pending_seal",
    contractGovernanceVersion: 1,
    draftRevision: 4,
    changeType: "original",
    baseVersionId: null
  };
  const task = {
    id: "seal-1",
    contractVersionId: version.id,
    handlerUserId: "handler-1",
    status: "pending_approval",
    approvedByUserId: null,
    approvedAt: null,
    completedByUserId: null,
    completedAt: null
  };
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: "contract-1" }])
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([task]),
    contractVersion: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(version)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }))
    },
    contractSealTask: {
      findUnique: jest.fn().mockResolvedValue(task),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: "seal-1", ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }) => ({ ...task, ...data }))
    },
    userPosition: {
      findFirst: jest.fn().mockResolvedValue({ id: "position-assignment-1" }),
      findMany: jest.fn().mockResolvedValue([{ userId: "handler-1" }])
    },
    position: { findUnique: jest.fn().mockResolvedValue({ id: "position-1" }) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: "director-1", isActive: true }),
      findMany: jest.fn().mockResolvedValue([{ id: "handler-1" }])
    },
    projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "member-1" }) },
    fileObject: { findUnique: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
  };
  const prisma = {
    $transaction: jest.fn((fn) => fn(tx)),
    get contractVersion() { return tx.contractVersion; },
    get contractSealTask() { return tx.contractSealTask; },
    get contract() { return (tx as typeof tx & { contract?: unknown }).contract; },
    get contractFormalFile() {
      return (tx as typeof tx & { contractFormalFile?: unknown }).contractFormalFile;
    },
    get position() { return tx.position; },
    get user() { return tx.user; },
    get userPosition() { return tx.userPosition; },
    get projectMember() { return tx.projectMember; }
  };
  return { version, task, tx, prisma };
}

describe("ContractSealService", () => {
  it("终审同一事务幂等冻结经办人并创建待同意用章任务", async () => {
    const { tx, prisma, version } = harness();
    tx.contractSealTask.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "seal-1",
      contractVersionId: version.id,
      handlerUserId: "applicant-1",
      status: "pending_approval"
    });
    const service = new ContractSealService(prisma as never);

    const first = await service.ensurePendingTask(
      tx as never, version as never, "instance-1", "applicant-1", "approver-1"
    );
    const second = await service.ensurePendingTask(
      tx as never, version as never, "instance-1", "applicant-1", "approver-1"
    );

    expect(first).toMatchObject({ handlerUserId: "applicant-1", status: "pending_approval" });
    expect(second).toMatchObject({ handlerUserId: "applicant-1", status: "pending_approval" });
    expect(tx.contractSealTask.create).toHaveBeenCalledTimes(1);
  });

  it("实质变化取消旧任务后，重审按新审批实例创建新任务并保留旧历史", async () => {
    const { tx, prisma, version } = harness();
    tx.contractSealTask.findUnique.mockResolvedValue(null);
    tx.contractSealTask.findFirst.mockResolvedValue(null);
    const service = new ContractSealService(prisma as never);

    await service.ensurePendingTask(
      tx as never, version as never, "instance-reapproval", "applicant-1", "approver-1"
    );

    expect(tx.contractSealTask.create).toHaveBeenCalledWith({
      data: {
        contractVersionId: "version-1",
        approvalInstanceId: "instance-reapproval",
        handlerUserId: "applicant-1",
        status: "pending_approval"
      }
    });
    expect(tx.contractSealTask.update).not.toHaveBeenCalled();
  });

  it("综合部主管同意用章后仅进入线下用章中", async () => {
    const { tx, prisma } = harness();
    const service = new ContractSealService(prisma as never);

    await expect(service.approve("version-1", "director-1")).resolves.toMatchObject({
      status: "in_seal"
    });
    expect(tx.contractSealTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending_approval" }),
      data: expect.objectContaining({ status: "in_seal", approvedByUserId: "director-1" })
    }));
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "version-1", status: "approved_pending_seal" },
      data: { status: "in_seal" }
    }));
  });

  it("只有冻结经办人能确认线下签署盖章完成", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "in_seal";
    task.status = "in_seal";
    const service = new ContractSealService(prisma as never);

    await expect(service.complete("version-1", "other-1", {
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true
    })).rejects.toThrow("只有合同冻结经办人");
    expect(tx.contractSealTask.updateMany).not.toHaveBeenCalled();
  });

  it("拒绝不完整的我方签署盖章声明", async () => {
    const { prisma, version, task } = harness();
    version.status = "in_seal";
    task.status = "in_seal";
    const service = new ContractSealService(prisma as never);

    await expect(service.complete("version-1", "handler-1", {
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: false,
      signingDateCompleted: true
    })).rejects.toThrow("请确认我方签署");
  });

  it("CAS 阻止重复同意同一用章任务", async () => {
    const first = harness();
    first.tx.contractSealTask.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const service = new ContractSealService(first.prisma as never);
    await service.approve("version-1", "director-1");
    first.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "contract-1" }])
      .mockResolvedValueOnce([first.version])
      .mockResolvedValueOnce([first.task]);
    await expect(service.approve("version-1", "director-1"))
      .rejects.toThrow("用章任务已被其他人处理");
  });

  it("冻结经办人上传双方最终 PDF 后进入待归档确认", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "seal_approved_pending_archive";
    Object.assign(version, { draftRevision: 4, changeType: "original", baseVersionId: null });
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    tx.contractVersion.updateMany.mockResolvedValue({ count: 1 });
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      contractFormalFile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: "approval-original-1", pageCount: 3 })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "final-1", ...data }))
      },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const formalFiles = {
      inspectOwnedStoredPdf: jest.fn().mockResolvedValue({
        sha256: "a".repeat(64),
        pageCount: 3,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "application/pdf",
          sizeBytes: 100,
          contentSha256: "a".repeat(64)
        }
      })
    };
    tx.fileObject.findUnique.mockResolvedValue({
      storageStatus: "active",
      uploadedByUserId: "handler-1",
      contentSha256: "a".repeat(64)
    });
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "file-final-1",
      uploadedByUserId: "handler-1",
      storageStatus: "active",
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentSha256: "a".repeat(64)
    }]);
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never
    );
    await expect(service.uploadFinal("version-1", "handler-1", {
      fileId: "file-final-1",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).resolves.toMatchObject({
      id: "final-1",
      purpose: "mutually_signed_final",
      status: "active"
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "seal_approved_pending_archive" },
      data: { status: "pending_archive_confirm" }
    });
  });

  it("双方最终版上传人与归档确认人必须分离", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "pending_archive_confirm";
    Object.assign(version, { draftRevision: 4, changeType: "original", baseVersionId: null });
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "final-1",
          fileId: "file-final-1",
          contentSha256: "a".repeat(64),
          pageCount: 3,
          sourceRevision: 4,
          uploadedByUserId: "director-1"
        })
      }
    });
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const formalFiles = { inspectLinkedStoredPdf: jest.fn().mockResolvedValue({}) };
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never,
      auth as never
    );
    await expect(service.confirmArchive("version-1", "director-1", {
      formalFileId: "final-1",
      confirmationPassword: "password",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("上传人与归档确认人不能是同一人");
  });

  it("唯一公司合同主管兼经办人时允许所属项目合同员替代上传", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "seal_approved_pending_archive";
    Object.assign(version, { draftRevision: 4, changeType: "original", baseVersionId: null });
    task.status = "completed";
    task.handlerUserId = "handler-1";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      contractFormalFile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: "approval-original-1", pageCount: 2 })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "final-2", ...data }))
      },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const formalFiles = {
      inspectOwnedStoredPdf: jest.fn().mockResolvedValue({
        sha256: "b".repeat(64),
        pageCount: 2,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "application/pdf",
          sizeBytes: 100,
          contentSha256: "b".repeat(64)
        }
      })
    };
    tx.fileObject.findUnique.mockResolvedValue({
      storageStatus: "active",
      uploadedByUserId: "project-contract-staff",
      contentSha256: "b".repeat(64)
    });
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "file-final-2",
      uploadedByUserId: "project-contract-staff",
      storageStatus: "active",
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentSha256: "b".repeat(64)
    }]);
    const service = new ContractSealService(prisma as never, undefined, formalFiles as never);

    await expect(service.uploadFinal("version-1", "project-contract-staff", {
      fileId: "file-final-2",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).resolves.toMatchObject({ id: "final-2", uploadedByUserId: "project-contract-staff" });
  });

  it("双方最终版页数与审批原件不一致时拒绝上传", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "seal_approved_pending_archive";
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: "approval-original-1", pageCount: 4 })
      }
    });
    const formalFiles = {
      inspectOwnedStoredPdf: jest.fn().mockResolvedValue({
        sha256: "c".repeat(64),
        pageCount: 3,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "application/pdf",
          sizeBytes: 100,
          contentSha256: "c".repeat(64)
        }
      })
    };
    tx.fileObject.findUnique.mockResolvedValue({
      storageStatus: "active",
      uploadedByUserId: "handler-1",
      contentSha256: "c".repeat(64)
    });
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "file-final-missing-page",
      uploadedByUserId: "handler-1",
      storageStatus: "active",
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentSha256: "c".repeat(64)
    }]);
    const service = new ContractSealService(prisma as never, undefined, formalFiles as never);

    await expect(service.uploadFinal("version-1", "handler-1", {
      fileId: "file-final-missing-page",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("双方最终版页数与审批原件不一致");
  });

  it("通用合同不强制要求结算款阶段，存在可执行付款条款即可", async () => {
    const stage = jest.fn().mockResolvedValue({ id: "stage-1" });
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: { findFirst: stage }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1")).resolves.toBeUndefined();
    expect(stage).toHaveBeenCalledWith({
      where: {
        paymentTermsVersionId: "terms-1",
        OR: [{ ratioBps: { gt: 0 } }, { fixedAmountCents: { gt: 0 } }]
      },
      select: { id: true }
    });
  });

  it("非通用合同缺少有效结算款阶段时拒绝归档生效", async () => {
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_contract" }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1"))
      .rejects.toThrow("合同付款条款缺少有效结算款阶段");
  });

  it("无上传权限时在读取 COS/PDF 前拒绝", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "seal_approved_pending_archive";
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) }
    });
    tx.position.findUnique.mockResolvedValue(null);
    const formalFiles = { inspectOwnedStoredPdf: jest.fn() };
    const service = new ContractSealService(prisma as never, undefined, formalFiles as never);

    await expect(service.uploadFinal("version-1", "outsider-1", {
      fileId: "file-1",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("不符合唯一合同主管的替代上传条件");
    expect(formalFiles.inspectOwnedStoredPdf).not.toHaveBeenCalled();
  });

  it("无归档确认权限时在读取 COS/PDF 和校验密码前拒绝", async () => {
    const { tx, prisma } = harness();
    tx.position.findUnique.mockResolvedValue(null);
    const formalFiles = { inspectLinkedStoredPdf: jest.fn() };
    const auth = { confirmPassword: jest.fn() };
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never,
      auth as never
    );

    await expect(service.confirmArchive("version-1", "outsider-1", {
      formalFileId: "final-1",
      confirmationPassword: "password",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("当前账号无权处理该合同用章任务");
    expect(formalFiles.inspectLinkedStoredPdf).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("COS 预检后最终件 FileObject 摘要漂移时拒绝归档", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "pending_archive_confirm";
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    const final = {
      id: "final-1",
      contractVersionId: "version-1",
      purpose: "mutually_signed_final",
      status: "active",
      fileId: "file-final-1",
      contentSha256: "a".repeat(64),
      pageCount: 3,
      sourceRevision: 4,
      uploadedByUserId: "handler-1"
    };
    const original = {
      id: "original-1",
      contractVersionId: "version-1",
      purpose: "approval_original",
      status: "active",
      fileId: "file-original-1",
      contentSha256: "b".repeat(64),
      pageCount: 3,
      sourceRevision: 4,
      uploadedByUserId: "handler-1"
    };
    Object.assign(tx, {
      contractFormalFile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(final)
          .mockResolvedValueOnce(original)
          .mockResolvedValueOnce(final)
          .mockResolvedValueOnce(original)
      }
    });
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "file-final-1",
        storageStatus: "active",
        mimeType: "application/pdf",
        sizeBytes: 100,
        contentSha256: "c".repeat(64)
      },
      {
        id: "file-original-1",
        storageStatus: "active",
        mimeType: "application/pdf",
        sizeBytes: 100,
        contentSha256: "b".repeat(64)
      }
    ]);
    const snapshot = (sha256: string) => ({
      sha256,
      pageCount: 3,
      fileSnapshot: {
        storageStatus: "active",
        mimeType: "application/pdf",
        sizeBytes: 100,
        contentSha256: sha256
      }
    });
    const formalFiles = {
      inspectLinkedStoredPdf: jest.fn()
        .mockResolvedValueOnce(snapshot("a".repeat(64)))
        .mockResolvedValueOnce(snapshot("b".repeat(64)))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never,
      auth as never
    );

    await expect(service.confirmArchive("version-1", "director-1", {
      formalFileId: "final-1",
      confirmationPassword: "password",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("合同正式文件在校验后发生变化");
  });
});
