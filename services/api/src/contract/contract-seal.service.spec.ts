import "reflect-metadata";
import { PrismaService } from "../database/prisma.service";
import { ContractSealService } from "./contract-seal.service";

function harness() {
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "approved_pending_seal",
    contractGovernanceVersion: 1,
    draftRevision: 4,
    documentContentRevision: 2,
    documentContentFingerprint: "d".repeat(64),
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
    contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
    contractFormalFile: {
      findMany: jest.fn().mockResolvedValue([
        { id: "approval-original-1" },
        { id: "mutually-signed-final-1" }
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 })
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
    get contractFormalFile() { return tx.contractFormalFile; },
    get position() { return tx.position; },
    get user() { return tx.user; },
    get userPosition() { return tx.userPosition; },
    get projectMember() { return tx.projectMember; }
  };
  return { version, task, tx, prisma };
}

function materialChangeInput(overrides: Partial<{
  expectedRevision: number;
  expectedSealTaskId: string;
  expectedStatus: string;
  reason: string;
}> = {}) {
  return {
    expectedRevision: 4,
    expectedSealTaskId: "seal-1",
    expectedStatus: "approved_pending_seal",
    reason: "线下核对发现合同金额发生实质变化",
    ...overrides
  };
}

describe("ContractSealService", () => {
  it("保留 PrismaService 运行时依赖注入元数据", () => {
    const parameterTypes = Reflect.getMetadata("design:paramtypes", ContractSealService) as unknown[];

    expect(parameterTypes[0]).toBe(PrismaService);
  });

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

  it.each([
    ["approved_pending_seal", "pending_approval"],
    ["in_seal", "in_seal"],
    ["seal_approved_pending_archive", "completed"],
    ["pending_archive_confirm", "completed"]
  ])("%s 与 %s 精确配对时退回草稿并完整审计", async (versionStatus, taskStatus) => {
    const { tx, prisma, version, task } = harness();
    version.status = versionStatus;
    task.status = taskStatus;
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput({ expectedStatus: versionStatus })
    )).resolves.toEqual({
      status: "draft",
      draftRevision: 5,
      requiresReapproval: true
    });

    expect(tx.contractFormalFile.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1", status: "active" },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    expect(tx.contractFormalFile.updateMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1", status: "active" },
      data: expect.objectContaining({
        status: "invalidated",
        invalidationReason: "线下核对发现合同金额发生实质变化"
      })
    });
    expect(tx.contractSealTask.updateMany).toHaveBeenCalledWith({
      where: { id: "seal-1", status: taskStatus },
      data: expect.objectContaining({
        status: "cancelled",
        cancelledByUserId: "handler-1"
      })
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: versionStatus, draftRevision: 4 },
      data: {
        status: "draft",
        draftRevision: { increment: 1 },
        readinessSnapshot: expect.anything(),
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.signing.material_change",
      metadata: {
        reason: "线下核对发现合同金额发生实质变化",
        sealTaskId: "seal-1",
        fromStatus: versionStatus,
        toStatus: "draft",
        fromRevision: 4,
        toRevision: 5,
        invalidatedFormalFileIds: ["approval-original-1", "mutually-signed-final-1"],
        invalidatedFormalFileCount: 2
      }
    }));
  });

  it.each([
    ["revision", materialChangeInput({ expectedRevision: 3 })],
    ["task", materialChangeInput({ expectedSealTaskId: "seal-stale" })],
    ["status", materialChangeInput({ expectedStatus: "in_seal" })]
  ])("%s 坐标漂移时在第一笔业务写前失败关闭", async (_coordinate, input) => {
    const { tx, prisma } = harness();
    const audit = { record: jest.fn() };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange("version-1", "handler-1", input))
      .rejects.toThrow("合同签署状态已变化");
    expect(tx.contractFormalFile.updateMany).not.toHaveBeenCalled();
    expect(tx.contractSealTask.updateMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("版本与用章任务状态不配对时零写失败关闭", async () => {
    const { tx, prisma, task } = harness();
    task.status = "completed";
    const audit = { record: jest.fn() };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput()
    )).rejects.toThrow("签署任务状态与合同阶段不一致");
    expect(tx.contractFormalFile.updateMany).not.toHaveBeenCalled();
    expect(tx.contractSealTask.updateMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("启用中的全局合同主管可以代冻结经办人申报实质变化", async () => {
    const { prisma } = harness();
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "director-1",
      materialChangeInput()
    )).resolves.toMatchObject({ status: "draft", draftRevision: 5 });
  });

  it("非冻结经办人且非全局合同主管时在第一笔业务写前拒绝", async () => {
    const { tx, prisma } = harness();
    tx.position.findUnique.mockResolvedValue(null);
    const audit = { record: jest.fn() };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "outsider-1",
      materialChangeInput()
    )).rejects.toThrow("只有冻结经办人或合同部主管");
    expect(tx.contractFormalFile.updateMany).not.toHaveBeenCalled();
    expect(tx.contractSealTask.updateMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("审计服务缺失时在权限和坐标核对后零写失败关闭", async () => {
    const { tx, prisma } = harness();
    const service = new ContractSealService(prisma as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput()
    )).rejects.toThrow("签署变更审计服务暂不可用");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contractFormalFile.updateMany).not.toHaveBeenCalled();
  });

  it("CAS 更新失去单赢家时不写审计并让事务失败", async () => {
    const { tx, prisma } = harness();
    tx.contractSealTask.updateMany.mockResolvedValueOnce({ count: 0 });
    const audit = { record: jest.fn() };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput()
    )).rejects.toThrow("合同签署状态已变化");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("审计中段失败时事务向上抛错，不返回成功回执", async () => {
    const { prisma } = harness();
    const audit = { record: jest.fn().mockRejectedValue(new Error("audit insert failed")) };
    const service = new ContractSealService(prisma as never, audit as never);

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput()
    )).rejects.toThrow("audit insert failed");
  });

  it.each([
    ["Prisma P2034", { code: "P2034" }],
    ["PostgreSQL 40001", { code: "P2010", meta: { code: "40001" } }]
  ])("%s 序列化冲突映射为稳定的并发提示", async (_label, error) => {
    const { prisma } = harness();
    prisma.$transaction.mockRejectedValueOnce(error);
    const service = new ContractSealService(
      prisma as never,
      { record: jest.fn() } as never
    );

    await expect(service.invalidateForMaterialChange(
      "version-1",
      "handler-1",
      materialChangeInput()
    )).rejects.toThrow("合同签署状态已并发变化，请刷新后重新申报");
  });

  it("综合部主管同意用章后仅进入线下用章中", async () => {
    const { tx, prisma } = harness();
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractSealService(prisma as never, undefined, undefined, auth as never);

    await expect(service.approve("version-1", "director-1", { confirmationPassword: "Current@2026" })).resolves.toMatchObject({
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
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractSealService(first.prisma as never, undefined, undefined, auth as never);
    await service.approve("version-1", "director-1", { confirmationPassword: "Current@2026" });
    first.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "contract-1" }])
      .mockResolvedValueOnce([first.version])
      .mockResolvedValueOnce([first.task]);
    await expect(service.approve("version-1", "director-1", { confirmationPassword: "Current@2026" }))
      .rejects.toThrow("用章任务已被其他人处理");
  });

  it("合同经办人兼当前合同部主管上传最终归档时记录服务器归因", async () => {
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
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "final-1", ...data }))
      },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const formalFiles = {
      assertReadyForSubmission: jest.fn().mockResolvedValue({
        id: "approval-original-1",
        pageCount: 3
      }),
      inspectOwnedStoredFinalArchive: jest.fn().mockResolvedValue({
        sha256: "a".repeat(64),
        pageCount: 7,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 100,
      contentSha256: "a".repeat(64)
    }]);
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractSealService(prisma as never, audit as never, formalFiles as never);
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
      where: {
        id: "version-1",
        status: { in: ["seal_approved_pending_archive", "pending_archive_confirm"] }
      },
      data: { status: "pending_archive_confirm" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: "handler-1",
      action: "contract.formal_file.final_upload",
      businessType: "contract_version",
      businessId: "version-1",
      metadata: expect.objectContaining({
        archiveActionAttribution: {
          actingRoleKey: "contract_director",
          representedUserId: "handler-1",
          nodeKey: "contract.final_archive",
          nodeRoleKey: "contract_director",
          sealTaskId: "seal-1",
          handlerUserId: "handler-1",
          businessType: "contract_version",
          businessId: "version-1",
          projectId: "project-1"
        }
      })
    }));
  });

  it("在归档确认前替换最终件，仅保留新选定版本为 active", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "pending_archive_confirm";
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      contractFormalFile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "final-old-1", fileId: "file-old" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "final-new-1", ...data }))
      },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const formalFiles = {
      assertReadyForSubmission: jest.fn().mockResolvedValue({
        id: "approval-original-1",
        pageCount: 3
      }),
      inspectOwnedStoredFinalArchive: jest.fn().mockResolvedValue({
        sha256: "d".repeat(64),
        pageCount: 1,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "image/png",
          sizeBytes: 100,
          contentSha256: "d".repeat(64)
        }
      })
    };
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "file-final-new",
      uploadedByUserId: "handler-1",
      storageStatus: "active",
      mimeType: "image/png",
      sizeBytes: 100,
      contentSha256: "d".repeat(64)
    }]);
    const service = new ContractSealService(prisma as never, undefined, formalFiles as never);

    await expect(service.uploadFinal("version-1", "handler-1", {
      fileId: "file-final-new",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).resolves.toMatchObject({
      id: "final-new-1",
      supersedesId: "final-old-1",
      status: "active"
    });

    expect(tx.contractFormalFile.updateMany).toHaveBeenCalledWith({
      where: { id: "final-old-1", status: "active" },
      data: expect.objectContaining({ status: "superseded" })
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
    const formalFiles = { inspectLinkedStoredFinalArchive: jest.fn().mockResolvedValue({}) };
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never,
      auth as never
    );
    await expect(service.confirmArchive("version-1", "director-1", {
      formalFileId: "final-1",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("上传人与归档确认人不能是同一人");
  });

  it("合同经办人兼当前合同部主管时可确认自己的最终归档并明确审计", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "pending_archive_confirm";
    version.draftRevision = 5;
    task.status = "completed";
    task.handlerUserId = "director-1";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    const final = {
      id: "final-1",
      fileId: "file-final-1",
      contentSha256: "a".repeat(64),
      pageCount: 1,
      sourceRevision: 4,
      declarationSnapshot: {
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      },
      uploadedByUserId: "director-1"
    };
    const original = {
      id: "approval-original-1",
      fileId: "file-original-1",
      contentSha256: "b".repeat(64),
      pageCount: 3,
      sourceRevision: 4,
      declarationSnapshot: {
        counterpartySigned: true,
        counterpartyStamped: true,
        crossPageSealCompleted: true,
        documentOrderConfirmed: true,
        authorizationsBeforeSignaturePageConfirmed: true,
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    };
    Object.assign(tx, {
      contractFormalFile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(final)
          .mockResolvedValueOnce(final),
        update: jest.fn().mockImplementation(({ data }) => ({ ...final, ...data }))
      }
    });
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "file-final-1",
        storageStatus: "active",
        mimeType: "image/png",
        sizeBytes: 100,
        contentSha256: "a".repeat(64)
      },
      {
        id: "file-original-1",
        storageStatus: "active",
        mimeType: "application/pdf",
        sizeBytes: 300,
        contentSha256: "b".repeat(64)
      }
    ]);
    const inspected = (sha256: string, mimeType: string, sizeBytes: number, pageCount: number) => ({
      sha256,
      pageCount,
      fileSnapshot: { storageStatus: "active", mimeType, sizeBytes, contentSha256: sha256 }
    });
    const formalFiles = {
      assertReadyForSubmission: jest.fn().mockResolvedValue(original),
      inspectLinkedStoredFinalArchive: jest.fn().mockResolvedValue(
        inspected("a".repeat(64), "image/png", 100, 1)
      ),
      inspectLinkedStoredPdf: jest.fn().mockResolvedValue(
        inspected("b".repeat(64), "application/pdf", 300, 3)
      )
    };
    const auth = { confirmPassword: jest.fn() };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const activation = {
      activate: jest.fn().mockResolvedValue({
        effectiveVersion: { id: "version-1", status: "effective" },
        supersededVersionId: null
      })
    };
    const service = new ContractSealService(
      prisma as never,
      audit as never,
      formalFiles as never,
      auth as never,
      activation as never
    );
    (service as unknown as {
      assertStructuredPaymentStage: jest.Mock;
    }).assertStructuredPaymentStage = jest.fn().mockResolvedValue(undefined);

    await expect(service.confirmArchive("version-1", "director-1", {
      formalFileId: "final-1",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    } as never)).resolves.toMatchObject({ status: "effective" });

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect((tx.contractFormalFile as unknown as { update: jest.Mock }).update).toHaveBeenCalledWith({
      where: { id: "final-1" },
      data: expect.objectContaining({ confirmedByUserId: "director-1" })
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "contract.archive.confirm",
      businessId: "version-1",
      metadata: expect.objectContaining({
        selfReview: true,
        selfReviewRoleKey: "contract_director",
        archiveActionAttribution: {
          actingRoleKey: "contract_director",
          representedUserId: "director-1",
          nodeKey: "contract.final_archive",
          nodeRoleKey: "contract_director",
          sealTaskId: "seal-1",
          handlerUserId: "director-1",
          businessType: "contract_version",
          businessId: "version-1",
          projectId: "project-1"
        }
      })
    }));
  });

  it("拒绝非冻结经办人的合同部主管上传最终版", async () => {
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
      inspectOwnedStoredFinalArchive: jest.fn().mockResolvedValue({
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

    await expect(service.uploadFinal("version-1", "nonhandler-director-1", {
      fileId: "file-final-2",
      sourceRevision: 4,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("只有当前冻结经办人可以上传双方最终版合同");
    expect((tx.contractFormalFile as unknown as { create: jest.Mock }).create)
      .not.toHaveBeenCalled();
  });

  it("通用合同必须存在可计算的非预付款直接付款阶段", async () => {
    const stage = jest.fn().mockResolvedValue([{
      id: "stage-1",
      stageType: "progress",
      basis: "contract_amount",
      ratioBps: 10000,
      fixedAmountCents: null,
      triggerAnchor: "contract_effective",
      dueDays: 0
    }]);
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: { findMany: stage }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1")).resolves.toBeUndefined();
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentTermsVersionId: "terms-1" } })
    );
  });

  it("通用合同任一非预付款阶段金额事实含糊时拒绝最终归档", async () => {
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-valid",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0
          },
          {
            id: "stage-ambiguous",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 5000,
            fixedAmountCents: 50_000n,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }
        ])
      }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1"))
      .rejects.toThrow("通用合同缺少可执行的直接付款阶段");
  });

  it("非通用合同缺少有效结算款阶段时拒绝归档生效", async () => {
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1"))
      .rejects.toThrow("合同付款条款缺少有效结算款阶段");
  });

  it.each([
    "material_purchase",
    "equipment_rental",
    "labor_subcontract",
    "professional_subcontract"
  ])("%s 仍只认可计算的结算款阶段", async (contractTypeKey) => {
    const stage = jest.fn().mockResolvedValue([{
      id: "stage-settlement-1",
      stageType: "progress",
      basis: "current_settlement",
      ratioBps: 8000,
      fixedAmountCents: null,
      triggerAnchor: "settlement_effective",
      dueDays: 0
    }]);
    const tx = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey }) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
      paymentTermsStage: { findMany: stage }
    };
    const service = new ContractSealService({} as never);

    await expect((service as unknown as {
      assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
    }).assertStructuredPaymentStage(tx, "version-1")).resolves.toBeUndefined();
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentTermsVersionId: "terms-1" } })
    );
  });

  it.each([null, "", "material_contract", "unsupported"])(
    "合同类型 %p 为空或未知时归档门禁失败关闭",
    async (contractTypeKey) => {
      const tx = {
        contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" }) },
        contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey }) },
        paymentTermsVersion: { findFirst: jest.fn() },
        paymentTermsStage: { findMany: jest.fn() }
      };
      const service = new ContractSealService({} as never);

      await expect((service as unknown as {
        assertStructuredPaymentStage(tx: unknown, versionId: string): Promise<void>;
      }).assertStructuredPaymentStage(tx, "version-1"))
        .rejects.toThrow("合同类型不在支持范围内，不能确认归档生效");
      expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
      expect(tx.paymentTermsStage.findMany).not.toHaveBeenCalled();
    }
  );

  it("无上传权限时在读取 COS/最终归档文件前拒绝", async () => {
    const { tx, prisma, version, task } = harness();
    version.status = "seal_approved_pending_archive";
    task.status = "completed";
    tx.contractSealTask.findFirst.mockResolvedValue(task);
    Object.assign(tx, {
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) }
    });
    tx.position.findUnique.mockResolvedValue(null);
    const formalFiles = { inspectOwnedStoredFinalArchive: jest.fn() };
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
    })).rejects.toThrow("只有当前冻结经办人可以上传双方最终版合同");
    expect(formalFiles.inspectOwnedStoredFinalArchive).not.toHaveBeenCalled();
  });

  it("无归档确认权限时在读取 COS/最终归档文件前拒绝", async () => {
    const { tx, prisma } = harness();
    tx.position.findUnique.mockResolvedValue(null);
    const formalFiles = { inspectLinkedStoredFinalArchive: jest.fn() };
    const auth = { confirmPassword: jest.fn() };
    const service = new ContractSealService(
      prisma as never,
      undefined,
      formalFiles as never,
      auth as never
    );

    await expect(service.confirmArchive("version-1", "outsider-1", {
      formalFileId: "final-1",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("当前账号无权处理该合同用章任务");
    expect(formalFiles.inspectLinkedStoredFinalArchive).not.toHaveBeenCalled();
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
      declarationSnapshot: {
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      },
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
          .mockResolvedValueOnce(final)
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
      assertReadyForSubmission: jest.fn().mockResolvedValue(original),
      inspectLinkedStoredFinalArchive: jest.fn()
        .mockResolvedValueOnce(snapshot("a".repeat(64))),
      inspectLinkedStoredPdf: jest.fn().mockResolvedValue(snapshot("b".repeat(64)))
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
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    })).rejects.toThrow("合同正式文件在校验后发生变化");
  });
});
