jest.mock("../contract-ledger/contract-relationship-summary",()=>({addContractRelationshipSummaries:jest.fn(async(_tx,items)=>items)}));
jest.mock("../contract-ledger/contract-handling-workitems",()=>({contractHandlingWorkItems:jest.fn().mockResolvedValue([])}));
import * as principalReturnProjection from "./principal-return-work-items";
import { createHash } from "node:crypto";
import { MeService, type WorkItem } from "./me.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("MeService", () => {
  it("合同履约确认轮次进入合同待办：职责人直接可办，被委托人凭全局委托可办，办结后消失", async () => {
    const instance = {
      id: "wc-flow", businessType: "contract_work_completion", businessId: "completion-1",
      status: "in_progress", currentNodeIndex: 0, applicantUserId: "creator", createdAt: new Date(), updatedAt: new Date(),
      frozenNodes: [{ name: "合同部主管", mode: "any", roleKeys: ["contract_director"], approvedRoleKeys: [],
        protocolVersion: 1, executionMode: "parallel", candidateUserIdsByRole: { contract_director: ["director"] } }]
    };
    const prisma = {
      approvalInstance: { findMany: jest.fn().mockResolvedValue([instance]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      contractWorkCompletion: { findMany: jest.fn().mockResolvedValue([{ id: "completion-1", contractVersionId: "version-1",
        work: "主体结构完成", amountYuan: { toString: () => "125.5000" } }]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([{ id: "version-1", contractId: "contract-1" }]) },
      contract: { findMany: jest.fn().mockResolvedValue([{ id: "contract-1", projectId: "project-1", code: "HT-100" }]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "director", isActive: true }, { id: "delegate", isActive: true },
        { id: "outsider", isActive: true }, { id: "creator", isActive: true }]) },
      approvalDelegation: { groupBy: jest.fn(async ({ where }: { where: { toUserId: string } }) =>
        where.toUserId === "delegate" ? [{ fromUserId: "director" }] : []) },
      userPosition: { findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        where.userId === "director" ? [{ positionId: "p-director" }] : []) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "p-director", key: "contract_director" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      approvalWorkItems(scopes: Array<{ projectId: string; roleKeys: string[] }>, userId: string,
        mode: "pending" | "started" | "delegated", evaluatedAt: Date, scope?: "contract"): Promise<WorkItem[]>;
    };
    const now = new Date();
    const directorScopes = [{ projectId: "project-1", roleKeys: ["contract_director"] }];
    const delegateScopes = [{ projectId: "project-1", roleKeys: [] as string[] }];

    const direct = await service.approvalWorkItems(directorScopes, "director", "pending", now, "contract");
    expect(direct).toEqual([expect.objectContaining({
      businessType: "contract_work_completion", businessId: "completion-1", businessCode: "HT-100",
      title: "履约确认：主体结构完成", projectName: "一号项目", amountText: "¥125.50",
      targetPath: "/合同管理/HT-100", currentNode: "合同部主管"
    })]);
    expect(await service.approvalWorkItems(delegateScopes, "outsider", "pending", now, "contract")).toEqual([]);
    const delegated = await service.approvalWorkItems(delegateScopes, "delegate", "pending", now, "contract");
    expect(delegated).toEqual([expect.objectContaining({ businessType: "contract_work_completion", businessId: "completion-1" })]);

    instance.frozenNodes = [{ ...instance.frozenNodes[0], approvedRoleKeys: ["contract_director"] }] as unknown as typeof instance.frozenNodes;
    expect(await service.approvalWorkItems(directorScopes, "director", "pending", now, "contract")).toEqual([]);
    expect(await service.approvalWorkItems(delegateScopes, "delegate", "pending", now, "contract")).toEqual([]);
  });

  it("keeps legacy upload work separate from governed archive confirmation", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      settlementArchiveWorkItems(
        projectIds: string[],
        statuses: string[],
        names: ReadonlyMap<string, string>,
        currentNode: string,
        nextAction: string,
        tone: string,
        governanceMode: "governed" | "legacy"
      ): Promise<unknown[]>;
    };

    await service.settlementArchiveWorkItems(
      ["project-1"],
      ["approved_pending_archive"],
      new Map(),
      "上传结算签认件",
      "上传后等待确认",
      "primary",
      "legacy"
    );
    await service.settlementArchiveWorkItems(
      ["project-1"],
      ["pending_archive_confirm"],
      new Map(),
      "确认最终结算文件",
      "确认后生效",
      "warning",
      "governed"
    );

    expect(prisma.settlement.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          projectId: { in: ["project-1"] },
          status: { in: ["approved_pending_archive"] },
          governanceVersion: null
        }
      })
    );
    expect(prisma.settlement.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          projectId: { in: ["project-1"] },
          status: { in: ["pending_archive_confirm"] },
          governanceVersion: 1
        }
      })
    );
  });

  it("creates one retry work item only for visible governed generation failures", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            code: "JS-001",
            periodLabel: "2026-07",
            amountCents: 10000n,
            updatedAt: new Date("2026-07-17T01:00:00.000Z")
          },
          {
            id: "settlement-2",
            projectId: "project-1",
            contractId: "contract-2",
            code: "JS-002",
            periodLabel: "2026-07",
            amountCents: 20000n,
            updatedAt: new Date("2026-07-17T02:00:00.000Z")
          },
          {
            id: "settlement-3",
            projectId: "project-1",
            contractId: "contract-3",
            code: "JS-003",
            periodLabel: "2026-07",
            amountCents: 30000n,
            updatedAt: new Date("2026-07-17T03:00:00.000Z")
          },
          {
            id: "settlement-4",
            projectId: "project-1",
            contractId: "contract-4",
            code: "JS-004",
            periodLabel: "2026-07",
            amountCents: 40000n,
            updatedAt: new Date("2026-07-17T04:00:00.000Z")
          }
        ])
      },
      settlementSignedDocumentGenerationClaim: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            status: "pending",
            claimedAt: new Date(),
            uploadedFileId: null,
            safeFailureCode: null
          },
          {
            settlementId: "settlement-2",
            status: "failed",
            claimedAt: new Date(),
            uploadedFileId: null,
            safeFailureCode: "render_failed"
          },
          {
            settlementId: "settlement-3",
            status: "uploaded",
            claimedAt: new Date(),
            uploadedFileId: "file-3",
            safeFailureCode: null
          },
          {
            settlementId: "settlement-4",
            status: "pending",
            claimedAt: new Date(Date.now() - 6 * 60 * 1000),
            uploadedFileId: null,
            safeFailureCode: null
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-2", name: "已失败结算的合同" },
          { id: "contract-3", name: "已上传未激活的合同" },
          { id: "contract-4", name: "租约超时的合同" }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      failedSettlementGenerationWorkItems(
        projectIds: string[],
        names: ReadonlyMap<string, string>
      ): Promise<Array<{ id: string; currentNode: string; nextAction: string }>>;
    };

    const items = await service.failedSettlementGenerationWorkItems(
      ["project-1"],
      new Map([["project-1", "项目一"]])
    );

    expect(prisma.settlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: { in: ["project-1"] },
          governanceVersion: 1,
          status: "pending_generation"
        }
      })
    );
    expect(prisma.settlementSignedDocumentGenerationClaim.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: {
          in: ["settlement-1", "settlement-2", "settlement-3", "settlement-4"]
        }
      },
      select: {
        settlementId: true,
        status: true,
        claimedAt: true,
        uploadedFileId: true,
        safeFailureCode: true
      }
    });
    expect(items).toEqual([
      expect.objectContaining({
        id: "settlement-generation-retry:settlement-2",
        currentNode: "最终结算文件生成失败",
        nextAction: "重试生成结算签名合成件"
      }),
      expect.objectContaining({
        id: "settlement-generation-retry:settlement-3",
        currentNode: "最终结算文件生成失败",
        nextAction: "重试生成结算签名合成件"
      }),
      expect.objectContaining({
        id: "settlement-generation-retry:settlement-4",
        currentNode: "最终结算文件生成失败",
        nextAction: "重试生成结算签名合成件"
      })
    ]);
  });

  it("keeps the historical final-file upload task and omits independent seal completion", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      contractSealTask: { findMany: jest.fn().mockResolvedValue([
        { contractVersionId: "version-1" },
        { contractVersionId: "version-2" }
      ]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([
        {
          id: "version-1",
          contractId: "contract-1",
          status: "in_seal",
          amountCents: 100n,
          updatedAt: new Date()
        },
        {
          id: "version-2",
          contractId: "contract-2",
          status: "seal_approved_pending_archive",
          amountCents: 200n,
          updatedAt: new Date()
        }
      ]) },
      contract: { findMany: jest.fn().mockResolvedValue([
        { id: "contract-1", projectId: "project-1", code: "HT-1", temporaryCode: null, name: "合同一" },
        { id: "contract-2", projectId: "project-1", code: "HT-2", temporaryCode: null, name: "合同二" }
      ]) }
    };
    const service = new MeService(prisma as never, {} as never);
    const items = await (service as unknown as {
      contractSealFinalUploadWorkItems(
        userId: string,
        names: ReadonlyMap<string, string>
      ): Promise<Array<{ currentNode: string; nextAction: string }>>;
    }).contractSealFinalUploadWorkItems("handler-1", new Map([["project-1", "项目一"]]));

    expect(items.map((item) => item.currentNode)).toEqual(["上传双方最终版"]);
    expect(items.map((item) => item.nextAction)).toEqual([
      "上传双方最终签署 PDF"
    ]);
  });
  it("uploads a PNG signature and records it on the user", async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-9" }) };
    const service = new MeService(prisma as never, files as never);

    const result = await service.setSignature("user-1", {
      originalName: "sig.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    });

    expect(result.signatureFileId).toBe("file-9");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { signatureFileId: "file-9" }
    });
  });

  it("creates an immutable canvas signature version and keeps the preview fallback current", async () => {
    const tx = {
      fileObject: { findUnique: jest.fn().mockResolvedValue({ contentSha256: "", storageStatus: "active" }) },
      handwrittenSignatureVersion: { create: jest.fn().mockResolvedValue({ id: "canvas-version-1" }) },
      user: { update: jest.fn().mockResolvedValue({}) }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "canvas-file-1" }) };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new MeService(prisma as never, files as never, audit as never);
    const input = { originalName: "ignored.png", mimeType: "image/png", sizeBytes: PNG.length, buffer: PNG };
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    tx.fileObject.findUnique.mockResolvedValue({ contentSha256: sha256, storageStatus: "active" });

    await expect(service.setCanvasSignature("user-1", input)).resolves.toEqual({
      signatureFileId: "canvas-file-1", signatureVersionId: "canvas-version-1"
    });
    expect(tx.handwrittenSignatureVersion.create).toHaveBeenCalledWith({
      data: { userId: "user-1", fileId: "canvas-file-1", contentSha256: sha256, source: "canvas" }
    });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { signatureFileId: "canvas-file-1" } });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-1",
      action: "me.signature.canvas.update",
      businessType: "handwritten_signature_version",
      businessId: "canvas-version-1",
      metadata: {
        fileId: "canvas-file-1",
        source: "direct"
      }
    });
  });

  it("locks an open handoff and records its completion with the signature version", async () => {
    const token = "opaque-token";
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "handoff-1",
        ownerUserId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        invalidatedAt: null,
        completedAt: null
      }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ contentSha256: sha256, storageStatus: "active" })
      },
      handwrittenSignatureVersion: {
        create: jest.fn().mockResolvedValue({ id: "canvas-version-1" })
      },
      handwrittenSignatureHandoff: { update: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "canvas-file-1" }) };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new MeService(prisma as never, files as never, audit as never);
    const input = {
      originalName: "ignored.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    };

    await expect(service.setCanvasSignature("user-1", input, { handoffToken: token })).resolves.toEqual({
      signatureFileId: "canvas-file-1",
      signatureVersionId: "canvas-version-1"
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.handwrittenSignatureHandoff.update).toHaveBeenCalledWith({
      where: { id: "handoff-1" },
      data: { completedAt: expect.any(Date), signatureVersionId: "canvas-version-1" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "user-1",
      action: "me.signature.canvas.update",
      businessType: "handwritten_signature_version",
      businessId: "canvas-version-1",
      metadata: {
        fileId: "canvas-file-1",
        source: "handoff",
        handoffId: "handoff-1"
      }
    }));
  });

  it("does not report canvas signature success when the domain audit fails", async () => {
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ contentSha256: sha256, storageStatus: "active" })
      },
      handwrittenSignatureVersion: {
        create: jest.fn().mockResolvedValue({ id: "canvas-version-1" })
      },
      user: { update: jest.fn().mockResolvedValue({}) }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "canvas-file-1" }) };
    const audit = { record: jest.fn().mockRejectedValue(new Error("audit unavailable")) };
    const service = new MeService(prisma as never, files as never, audit as never);

    await expect(service.setCanvasSignature("user-1", {
      originalName: "ignored.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    })).rejects.toThrow("audit unavailable");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("publishes only authenticated self-service canvas signature capabilities", () => {
    const service = new MeService({} as never, {} as never);

    expect(service.getCanvasSignatureCapabilities("user-1")).toEqual({
      availableActions: [
        "upload_canvas_signature",
        "create_canvas_signature_handoff"
      ]
    });
  });

  it("does not treat a legacy upload as a canvas signature version", async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "legacy-file-1" }) };
    const service = new MeService(prisma as never, files as never);

    await service.setSignature("user-1", { originalName: "legacy.png", mimeType: "image/png", sizeBytes: PNG.length, buffer: PNG });
    expect(files.uploadPrivateFile).toHaveBeenCalled();
    expect((prisma as Record<string, unknown>).handwrittenSignatureVersion).toBeUndefined();
  });

  it("creates a five-minute opaque desktop handoff and invalidates the previous open handoff", async () => {
    const tx = {
      handwrittenSignatureHandoff: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({})
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new MeService(prisma as never, {} as never);
    const before = Date.now();

    const result = await service.createCanvasSignatureHandoff("user-1");

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    expect(Date.parse(result.expiresAt)).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1_000);
    expect(tx.handwrittenSignatureHandoff.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: "user-1", completedAt: null, invalidatedAt: null })
    }));
    expect(tx.handwrittenSignatureHandoff.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerUserId: "user-1", tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    }));
  });

  it("only exposes a completed handoff status to the same account", async () => {
    const token = "opaque-token";
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      handwrittenSignatureHandoff: {
        findUnique: jest.fn().mockResolvedValue({
          ownerUserId: "user-1",
          expiresAt: new Date(Date.now() + 60_000),
          invalidatedAt: null,
          completedAt: new Date("2026-07-23T08:00:00.000Z"),
          signatureVersionId: "version-1"
        })
      }
    };
    const service = new MeService(prisma as never, {} as never);

    await expect(service.getCanvasSignatureHandoff("user-1", token)).resolves.toMatchObject({
      completedAt: "2026-07-23T08:00:00.000Z",
      signatureVersionId: "version-1",
      availableActions: []
    });
    await expect(service.getCanvasSignatureHandoff("other-user", token)).rejects.toThrow("同一账号");
  });

  it("publishes handoff completion only while the same-account token is open", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      handwrittenSignatureHandoff: {
        findUnique: jest.fn().mockResolvedValue({
          ownerUserId: "user-1",
          expiresAt: new Date(Date.now() + 60_000),
          invalidatedAt: null,
          completedAt: null,
          signatureVersionId: null
        })
      }
    };
    const service = new MeService(prisma as never, {} as never);

    await expect(service.getCanvasSignatureHandoff("user-1", "opaque-token")).resolves.toMatchObject({
      availableActions: ["complete_canvas_signature_handoff"]
    });
  });

  it("rejects a non-image disguised as an image mime type in business Chinese", async () => {
    const prisma = { user: { update: jest.fn() } };
    const files = { uploadPrivateFile: jest.fn() };
    const service = new MeService(prisma as never, files as never);

    await expect(
      service.setSignature("user-1", {
        originalName: "evil.png",
        mimeType: "image/png",
        sizeBytes: 4,
        buffer: Buffer.from("notpng")
      })
    ).rejects.toThrow("个人签名图片只能上传 PNG 或 JPEG 格式");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("uses a business download reason for signature preview tickets", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1", signatureFileId: "sig-1" }) },
      handwrittenSignatureVersion: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const files = { createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/ticket" }) };
    const service = new MeService(prisma as never, files as never);

    await service.getSignatureTicket("user-1");

    expect(files.createDownloadTicket).toHaveBeenCalledWith("sig-1", {
      actorUserId: "user-1",
      downloadReason: "个人签名预览"
    });
  });

  it("builds workbench cards only from projects where the user has matching roles", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "contract_staff" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      contractTakeover: {
        count: jest.fn().mockImplementation(({ where }: {
          where: {
            projectId: unknown;
            OR?: unknown;
            historicalBalanceConfirmedAt?: unknown;
          };
        }) => {
          expect(where.projectId).toEqual({ in: ["project-1"] });
          if (where.OR) return 1;
          if (where.historicalBalanceConfirmedAt === null) return 1;
          return 2;
        })
      },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.visibleProjectCount).toBe(1);
    expect(summary.cards.map((card) => [card.id, card.count])).toEqual([
      ["contract_takeover_todo", 2],
      ["historical_balance_missing", 1],
      ["payment_blocked", 1]
    ]);
    expect(prisma.contractTakeover.count).toHaveBeenCalledTimes(3);
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });

  it("counts only current approval nodes in visible projects", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { count: jest.fn().mockResolvedValue(0) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "settlement",
            businessId: "settlement-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["finance_director"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-2",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-1", projectId: "project-1" },
          { id: "payment-2", projectId: "project-2" }
        ]),
        count: jest.fn()
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    const approvalCard = summary.cards.find((card) => card.id === "approval_todo");
    expect(approvalCard).toMatchObject({
      count: 1,
      description: "合同 0 · 结算 1 · 付款 0 · 支出 0",
      targetPath: "/结算管理"
    });
  });

  it("separates pristine takeover drafts from pending and blocked work items", async () => {
    const draft = {
      id: "takeover-draft",
      projectId: "project-1",
      contractId: "contract-draft",
      contractVersionId: "version-draft",
      updatedAt: new Date("2026-07-20T01:00:00.000Z")
    };
    const supplement = {
      id: "takeover-supplement",
      projectId: "project-1",
      contractId: "contract-supplement",
      contractVersionId: "version-supplement",
      updatedAt: new Date("2026-07-20T02:00:00.000Z")
    };
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "contract_staff" }
        ])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
          const statuses = (where.takeoverStatus as { in?: string[] })?.in ?? [];
          if (where.OR) return [];
          if (statuses.includes("draft")) return [draft];
          if (statuses.includes("needs_supplement")) return [supplement];
          return [];
        }),
        count: jest.fn()
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          where.id
            ? [
                { id: "version-draft", amountCents: 10_000n },
                { id: "version-supplement", amountCents: 20_000n }
              ]
            : []
        )
      },
      contract: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          where.id
            ? [
                {
                  id: "contract-draft",
                  code: null,
                  temporaryCode: "LS-001",
                  name: "历史合同草稿",
                  counterparty: "乙方一"
                },
                {
                  id: "contract-supplement",
                  code: null,
                  temporaryCode: "LS-002",
                  name: "待补充历史合同",
                  counterparty: "乙方二"
                }
              ]
            : []
        )
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-1");

    expect(result.queues.drafts).toEqual([
      expect.objectContaining({
        id: "takeover:takeover-draft",
        businessCode: "LS-001",
        currentNode: "草稿填写",
        nextAction: "继续补录后提交复核"
      })
    ]);
    expect(result.queues.pending).toEqual([
      expect.objectContaining({
        id: "takeover:takeover-supplement",
        businessCode: "LS-002"
      })
    ]);
    expect(result.queues.blocked).toEqual([]);
    expect(result.approvalCenter.pendingApproval).toEqual([]);
    expect(result.queues.pending[0]).toMatchObject({ actionGroup: "supplement" });
    expect(result.groups).toEqual([
      expect.objectContaining({ key: "supplement", title: "待补资料", count: 1 })
    ]);
    const blockedCall = prisma.contractTakeover.findMany.mock.calls.find(
      ([input]) => Boolean(input.where.OR)
    );
    expect(blockedCall?.[0].where.takeoverStatus.in).not.toContain("draft");
  });

  it("aggregates every owned draft domain and reports an exact truncated total", async () => {
    const updatedAt = new Date("2026-07-20T08:00:00.000Z");
    const settlementDrafts = Array.from({ length: 35 }, (_value, index) => ({
      id: `settlement-draft-${index}`,
      projectId: "project-1",
      code: `JS-DRAFT-${index}`,
      periodLabel: "2026-07",
      updatedAt: index === 0
        ? new Date("2026-01-01T00:00:00.000Z")
        : new Date(updatedAt.getTime() + index)
    }));
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      contract: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(
          where.ownerUserId
            ? [{ id: "contract-1", projectId: "project-1", code: null, temporaryCode: "HT-DRAFT-1", name: "合同草稿" }]
            : [{ id: "takeover-contract", code: null, temporaryCode: "LS-DRAFT-1", name: "接管草稿" }]
        ))
      },
      contractVersion: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(
          where.contractId
            ? [{ id: "contract-version-1", contractId: "contract-1", amountCents: 100n, updatedAt }]
            : [{ id: "takeover-version", amountCents: 200n }]
        )),
        count: jest.fn().mockResolvedValue(1)
      },
      settlementDraft: {
        findMany: jest.fn().mockResolvedValue(settlementDrafts),
        count: jest.fn().mockResolvedValue(35)
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([{
          id: "takeover-1",
          projectId: "project-1",
          contractId: "takeover-contract",
          contractVersionId: "takeover-version",
          updatedAt
        }]),
        count: jest.fn().mockResolvedValue(1)
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "spot-1", projectId: "project-1", code: "LXCG-DRAFT-1", updatedAt
        }]),
        count: jest.fn().mockResolvedValue(1)
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([{
          id: "spot-payment-1", projectId: "project-1", code: "LXFK-DRAFT-1",
          approvalAmountCents: 300n, updatedAt
        }]),
        count: jest.fn().mockResolvedValue(1)
      },
      contractBusinessTemplate: {
        findMany: jest.fn().mockResolvedValue([{ id: "template-1", code: "TPL-1", name: "材料合同模板" }])
      },
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([{
          id: "template-version-1", templateId: "template-1", versionNo: 1, updatedAt
        }]),
        count: jest.fn().mockResolvedValue(1)
      },
      contractLayoutTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      contractLayoutTemplateVersion: { findMany: jest.fn(), count: jest.fn() },
      standardClause: { findMany: jest.fn().mockResolvedValue([]) },
      standardClauseVersion: { findMany: jest.fn(), count: jest.fn() },
      settlementTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      settlementTemplateVersion: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      myDraftWorkItems(
        userId: string,
        contractProjectIds: string[],
        visibleProjectIds: string[],
        projectNames: ReadonlyMap<string, string>
      ): Promise<{ items: Array<{ id: string; businessType?: string; agingStatus?: string }>; total: number }>;
    };

    // Keep recent versus stale fixtures stable as the real calendar advances.
    const now = jest.spyOn(Date, "now").mockReturnValue(
      new Date("2026-07-21T08:00:00.000Z").getTime()
    );
    const result = await service.myDraftWorkItems(
      "user-1",
      ["project-1"],
      ["project-1"],
      new Map([["project-1", "测试项目"]])
    ).finally(() => now.mockRestore());

    expect(result.total).toBe(40);
    expect(result.items).toHaveLength(31);
    expect(result.items.filter((item) => item.agingStatus === "current")).toHaveLength(30);
    expect(result.items.filter((item) => item.agingStatus === "stale")).toHaveLength(1);
    expect(result.items).toContainEqual(expect.objectContaining({
      id: "settlement-draft:settlement-draft-0",
      agingStatus: "stale"
    }));
    expect(result.items.some((item) => item.id.startsWith("settlement-draft:"))).toBe(true);
    expect(prisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: { not: "historical_takeover" } })
    }));
    expect(prisma.settlementDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, projectId: true, periodLabel: true, code: true, updatedAt: true }
    }));
    expect(prisma.settlementDraft.count).toHaveBeenCalled();
    expect(prisma.contractBusinessTemplateVersion.count).toHaveBeenCalled();
  });

  it("keeps historical settlement progress in started items but removes it from live approval duties", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn() },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string } }) => {
          if (where.applicantUserId && where.applicantUserId !== "applicant-1") return [];
          return [
            {
              id: "approval-1",
              businessType: "settlement",
              flowType: "settlement.approve",
              businessId: "settlement-1",
              status: "in_progress",
              currentNodeIndex: 0,
              frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
              applicantUserId: "applicant-1",
              createdAt: new Date("2026-07-07T08:00:00.000Z"),
              updatedAt: new Date("2026-07-07T08:00:00.000Z")
            }
          ];
        })
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            code: "JS-001",
            periodLabel: "2026-07",
            amountCents: 100000n
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-001",
            temporaryCode: null,
            name: "测试合同",
            counterparty: "测试供应商"
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-1");

    expect(result.queues.pending).toEqual([]);
    expect(result.approvalCenter.pendingApproval).toEqual([]);

    const applicantHistory = await service.getWorkItems("applicant-1");
    expect(applicantHistory.queues.started).toEqual([
      expect.objectContaining({ id: "approval:approval-1", businessId: "settlement-1",
        targetPath: "/结算管理/JS-001", nextAction: "查看审批进度", canHandle: false })
    ]);
  });

  it.each([
    ["loan_reserve", "project_reserve"],
    ["loan_reserve", "owner_loan"],
    ["loan_reserve", "employee_loan"],
    ["reimbursement", "reimbursement"]
  ])("projects actionable approval duties for %s/%s", async (expenseType, expenseSubtype) => {
    const expenseInstance = {
      id: "approval-expense-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
      applicantUserId: "applicant-1",
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
      updatedAt: new Date("2026-07-11T08:00:00.000Z")
    };
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "project_manager" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string; id?: unknown } }) => {
          if (where.applicantUserId || where.id) return [];
          return [expenseInstance];
        })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-001",
            expenseType,
            expenseSubtype,
            paymentSubject: "现场报销",
            requestedAmountCents: 50_000n
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("manager-1");

    if (expenseSubtype === "employee_loan") {
      expect(result.queues.pending).toEqual([]);
      expect(result.approvalCenter.pendingApproval).toEqual([]);
      return;
    }
    expect(result.queues.pending[0]).toMatchObject({
      businessId: "expense-1",
      targetPath: "/项目支出/project-1/expense-1"
    });
  });

  it("does not create project expense todos from assignment or standing delegation", async () => {
    const expenseInstance = {
      id: "approval-expense-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [
        {
          name: "项目经理审批",
          roleKeys: ["project_manager"],
          assignments: [{ fromRoleKey: "project_manager", toUserId: "employee-1" }]
        }
      ],
      applicantUserId: "applicant-1",
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
      updatedAt: new Date("2026-07-11T08:00:00.000Z")
    };
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "employee" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "manager-1" }])
      },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string; id?: unknown } }) => {
          if (where.applicantUserId || where.id) return [];
          return [expenseInstance];
        })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-001",
            expenseType: "reimbursement",
            paymentSubject: "现场报销",
            requestedAmountCents: 50_000n
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("employee-1");

    expect(result.approvalCenter.pendingApproval).toEqual([]);
    expect(result.approvalCenter).not.toHaveProperty("delegatedToMe");
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("returns pending approval work items accepted through standing delegation", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string; projectId?: unknown } }) => {
          if (where.userId === "delegator-1" && where.projectId === "project-1") {
            return [{ projectId: "project-1", positionId: "position-pm" }];
          }
          return [];
        })
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
          if (where.id.in.includes("position-pm")) {
            return [{ id: "position-pm", key: "project_manager" }];
          }
          return [];
        })
      },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegator-1", isActive: true },
          { id: "delegatee-1", isActive: true }
        ])
      },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string } }) => {
          if (where.applicantUserId) {
            return [
              {
                id: "approval-started",
                businessType: "settlement",
                businessId: "settlement-1",
                status: "in_progress",
                currentNodeIndex: 0,
                frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
                applicantUserId: "delegatee-1",
                createdAt: new Date("2026-07-07T08:00:00.000Z"),
                updatedAt: new Date("2026-07-07T08:00:00.000Z")
              }
            ];
          }
          return [
            {
              id: "approval-1",
              businessType: "settlement",
              businessId: "settlement-1",
              status: "in_progress",
              currentNodeIndex: 0,
              frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
              applicantUserId: "applicant-1",
              createdAt: new Date("2026-07-07T08:00:00.000Z"),
              updatedAt: new Date("2026-07-07T08:00:00.000Z")
            }
          ];
        })
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            code: "JS-001",
            periodLabel: "2026-07",
            amountCents: 100000n
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-001",
            temporaryCode: null,
            name: "测试合同",
            counterparty: "测试供应商"
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const reminderLookup = prisma.approvalActionLog.findMany.mockImplementation(({ where }) => where.action === "remind"
      ? [
        { id: "reminder-for-other", createdAt: new Date(), approvalInstanceId: "approval-1", metadata: { kind: "sms_request", recipientIds: ["other"], dutyIndexes: [0] } },
        { id: "reminder-for-me", createdAt: new Date(), approvalInstanceId: "approval-1", metadata: { kind: "sms_request", recipientIds: ["delegatee-1"], dutyIndexes: [0] } }
      ]
      : []
    );
    const notices = await service.getWorkItemNotices("delegatee-1", 0);
    const result = await service.getWorkItems("delegatee-1");

    expect(notices.queues.pending).toContainEqual(
      expect.objectContaining({
        id: "approval:approval-1",
        reminderId: "reminder-for-me",
        type: "approval",
        projectName: "测试项目",
        businessCode: "JS-001",
        currentNode: "项目经理审批"
      })
    );
    expect(reminderLookup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      approvalInstanceId: { in: ["approval-1"] }, action: "remind"
    }) }));
    expect(result.approvalCenter.pendingApproval[0].id).toBe("approval:approval-1");
    expect(result.approvalCenter).not.toHaveProperty("delegatedToMe");
    expect(result.approvalCenter.startedByMe[0].id).toBe("approval:approval-started");
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledTimes(2);
    // 同一次审批中心读取共用一个评估时间，委托有效期不因多次查询漂移。
    expect(prisma.approvalDelegation.findMany.mock.calls.some(call =>
      call[0].where.startsAt.lte.getTime() === new Date(result.generatedAt).getTime())).toBe(true);

    prisma.user.findMany.mockResolvedValue([
      { id: "delegator-1", isActive: false },
      { id: "delegatee-1", isActive: true }
    ]);
    const inactiveDelegatorResult = await service.getWorkItems("delegatee-1");
    expect(inactiveDelegatorResult.approvalCenter.pendingApproval).toEqual([]);
    expect(inactiveDelegatorResult.approvalCenter).not.toHaveProperty("delegatedToMe");
  });

  it("does not count project expense through standing delegation", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "project_expense_request",
            businessId: "expense-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: "expense-1", projectId: "project-1" }])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ expense: number; total: number }>;
    };

    const counts = await service.countApprovalTodos(
      [{ projectId: "project-1", roleKeys: [] }],
      "delegatee-1"
    );

    expect(counts).toMatchObject({ expense: 0, total: 0 });
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("counts standing delegation only while both users are active", async () => {
    const userFindMany = jest.fn().mockResolvedValue([
      { id: "delegator-1", isActive: true },
      { id: "delegatee-1", isActive: true }
    ]);
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "settlement",
            businessId: "settlement-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: { findMany: userFindMany },
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { projectId: unknown } }) =>
          where.projectId === "project-1"
            ? [{ projectId: "project-1", positionId: "position-pm" }]
            : []
        )
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-pm", key: "project_manager" }])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ settlement: number; total: number }>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["budget_director"] }];

    await expect(service.countApprovalTodos(scopes, "delegatee-1")).resolves.toMatchObject({
      settlement: 1,
      total: 1
    });

    userFindMany.mockResolvedValue([
      { id: "delegator-1", isActive: false },
      { id: "delegatee-1", isActive: true }
    ]);
    await expect(service.countApprovalTodos(scopes, "delegatee-1")).resolves.toMatchObject({
      settlement: 0,
      total: 0
    });
  });

  it("待办中心对受治理节点要求冻结候选仍在当前岗位", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([{
          businessType: "settlement",
          businessId: "settlement-1",
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
            candidateUserIds: ["finance-director-1"]
          }]
        }])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ settlement: number; total: number }>;
    };

    await expect(service.countApprovalTodos(
      [{ projectId: "project-1", roleKeys: [] }],
      "finance-director-1"
    )).resolves.toMatchObject({ settlement: 0, total: 0 });

    await expect(service.countApprovalTodos(
      [{ projectId: "project-1", roleKeys: ["finance_director"] }],
      "finance-director-2"
    )).resolves.toMatchObject({ settlement: 0, total: 0 });
  });

  it.each([
    ["节点指派", "assigned-1", true],
    ["常驻委托", "delegatee-1", false]
  ] as const)("待办中心按受治理冻结事实接受%s", async (_label, actorUserId, usesAssignment) => {
    const node = {
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
      candidateUserIds: ["finance-director-1"],
      ...(usesAssignment
        ? {
            assignments: [{
              kind: "transfer",
              fromUserId: "finance-director-1",
              fromRoleKey: "finance_director",
              toUserId: "assigned-1"
            }]
          }
        : {})
    };
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([{
          businessType: "payment_request",
          businessId: "payment-1",
          currentNodeIndex: 0,
          frozenNodes: [node]
        }])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: "payment-1", projectId: "project-1" }])
      },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue(
          usesAssignment ? [] : [{ fromUserId: "finance-director-1" }]
        )
      },
      user: {
        findMany: jest.fn().mockResolvedValue(
          usesAssignment
            ? []
            : [
                { id: "finance-director-1", isActive: true },
                { id: "delegatee-1", isActive: true }
              ]
        )
      },
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            where.userId === "finance-director-1"
              ? [{ positionId: "finance-director-position" }]
              : []
          )
        )
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-director-position", key: "finance_director" }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ payment: number; total: number }>;
    };

    await expect(service.countApprovalTodos(
      [{ projectId: "project-1", roleKeys: [] }],
      actorUserId
    )).resolves.toMatchObject({ payment: 1, total: 1 });
  });

  it("shows remaining approved amount for partially paid execution work items", async () => {
    const payment = {
      id: "payment-1", status: "partially_paid", paymentSubjectType: "our_company",
      sourceType: "contract_due", contractId: "contract-1", contractVersionId: "version-1",
      projectId: "project-1", code: "FK-001", requestedAmountCents: 8000000n,
      approvedAmountCents: 5000000n, paidAmountCents: 2000000n,
      updatedAt: new Date("2026-07-07T08:00:00.000Z")
    };
    const approvedRound:Record<string,unknown>={id:"round-1",businessType:"payment_request",businessId:"payment-1",flowType:"payment.approve",status:"approved",createdAt:new Date("2026-07-07T07:00:00Z"),updatedAt:new Date("2026-07-07T07:00:00Z")};
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-finance", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{positionId:"company-finance",projectId:null}]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn().mockResolvedValue([{id:"company-finance",key:"finance_staff"}]) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([payment]),
        findUnique: jest.fn().mockResolvedValue(payment),
        count: jest.fn()
      },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany:jest.fn(async({where={},orderBy,take}:{where?:Record<string,unknown>;orderBy?:Record<string,string>;take?:number}={})=>{
          const selected=Object.entries(where).every(([field,value])=>{
            if(value && typeof value==="object" && "in" in value && Array.isArray(value.in))return value.in.includes(approvedRound[field]);
            if(value instanceof Date)return approvedRound[field] instanceof Date && (approvedRound[field] as Date).getTime()===value.getTime();
            return approvedRound[field]===value;
          })?[approvedRound]:[];
          if(orderBy){
            const [field,direction]=Object.entries(orderBy)[0];
            if(!["createdAt","updatedAt"].includes(field)||!["asc","desc"].includes(direction))throw new Error("Unsupported Me fixture round ordering");
            selected.sort((a,b)=>{
              const left=a[field],right=b[field];
              if(!(left instanceof Date)||!(right instanceof Date))throw new Error("Me fixture round timestamps must be real dates");
              return (left.getTime()-right.getTime())*(direction==="desc"?-1:1);
            });
          }
          return take===undefined?selected:selected.slice(0,take);
        }),
        findFirst:jest.fn().mockResolvedValue(approvedRound)
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({id:"version-1",contractId:"contract-1",status:"active",signingSubjectType:"our_company",companyEntityIdSnapshot:"company-1",companyEntityNameSnapshot:"测试公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-1"})
      },
      paymentExecution: {findMany:jest.fn().mockResolvedValue([])},
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never);

    const principalItems: WorkItem[] = [
      {
        id: "principal-return-review:round:0", type: "approval", title: "本金归还", projectName: "测试项目",
        businessType: "registered_principal_return", businessCode: "垫资本金归还", businessId: "review", amountText: "¥2.1001",
        currentNode: "财务审批", stayedText: "", nextAction: "处理当前审批", targetPath: "/垫资本金归还/review", tone: "warning",
      },
      {
        id: "principal-return-pay:part", type: "payment_execution", title: "本金归还", projectName: "公司日常",
        businessType: "registered_principal_return", businessCode: "垫资本金归还", businessId: "part", amountText: "待归还 ¥1.0001",
        currentNode: "登记实际归还", stayedText: "", nextAction: "登记实付", targetPath: "/垫资本金归还/part", tone: "warning",
      },
    ];
    const projection = jest.spyOn(principalReturnProjection, "principalReturnWorkItems").mockImplementation(
      async (_prisma, actorId, mode) => actorId === "user-finance" && mode === "pending" ? principalItems : [],
    );
    try {
      const result = await service.getWorkItems("user-finance");
      const onlyPrincipal = (item: WorkItem) => item.businessType === "registered_principal_return";
      expect(result.queues.pending.filter(onlyPrincipal)).toEqual(principalItems);
      expect(result.approvalCenter.pendingApproval.filter(onlyPrincipal)).toEqual([principalItems[0]]);
      expect((await service.getFundsPendingWorkItems("user-finance")).filter(onlyPrincipal)).toEqual(principalItems);
      expect((await service.getContractPendingWorkItems("user-finance")).filter(onlyPrincipal)).toEqual([]);
      expect(result.queues.pending).toContainEqual(
        expect.objectContaining({
          id: "payment-execution:payment-1",
          type: "payment_execution",
          businessCode: "FK-001",
          amountText: "¥30,000.00"
        })
      );
    } finally {
      projection.mockRestore();
    }
  });

  it("shows approved spot-payment execution work items to project finance", async () => {
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([{projectId:"project-1",userId:"finance",roleKey:"finance_staff",userIsActive:true}]),
      spotProcurement:{findUnique:jest.fn().mockResolvedValue({currentVersionId:"version",status:"approved_in_progress",projectId:"project-1"})},
      spotProcurementVersion:{findUnique:jest.fn().mockResolvedValue({id:"version",procurementId:"procurement",status:"approved"})},
      spotProcurementDiscrepancy:{findFirst:jest.fn().mockResolvedValue(null)},
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-1",
            projectId: "project-1",
            code: "LXCG-001-V1-P001",
            procurementId:"procurement",procurementVersionId:"version",status:"approved_pending_payment",
            companyPaymentAmountCents:410000n,canceledCompanyPaymentAmountCents:0n,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-21T08:00:00.000Z")
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never,undefined,undefined,{isEnabled:()=>true} as never) as unknown as {
      spotPaymentExecutionWorkItems(
        userId:string,
        projectIds: string[],
        projectNames: ReadonlyMap<string, string>
      ): Promise<WorkItem[]>;
    };

    await expect(service.spotPaymentExecutionWorkItems(
      "finance",["project-1"],
      new Map([["project-1", "测试项目"]])
    )).resolves.toEqual([
      expect.objectContaining({
        id: "spot-payment-execution:spot-payment-1",
        title: "登记零星材料实付与凭证",
        amountText: "¥4,100.00",
        targetPath: "/零星材料付款/spot-payment-1?tab=current"
      })
    ]);
    prisma.spotProcurementDiscrepancy.findFirst.mockResolvedValue({id:"pending-discrepancy"});
    await expect(service.spotPaymentExecutionWorkItems("finance",["project-1"],new Map())).resolves.toEqual([]);
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.spotPaymentExecutionWorkItems("removed",["project-1"],new Map())).resolves.toEqual([]);
    expect(prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["approved_pending_payment", "partially_paid"] }
        })
      })
    );
  });

  it("routes missing historical payment vouchers to finance without granting takeover resubmission", async () => {
    const missingPaymentVoucher = {
      id: "takeover-payment-voucher-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      historicalApprovalPendingPaymentCents: 0n,
      historicalApprovedPendingPaymentCents: 0n,
      historicalPaidCents: 30_000n,
      historicalProxyPaidCents: 0n,
      historicalAdvancePaidCents: 0n,
      historicalRetentionWithheldCents: 0n,
      otherConfirmedOccupancyCents: 0n,
      updatedAt: new Date("2026-07-21T08:00:00.000Z")
    };
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "finance_staff" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { takeoverStatus?: { in?: string[] } } }) => {
          const statuses = where.takeoverStatus?.in ?? [];
          return statuses.length === 1 && statuses[0] === "needs_supplement"
            ? [missingPaymentVoucher]
            : [];
        }),
        count: jest.fn()
      },
      archiveRecord: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "version-1", amountCents: 100_000n }])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", code: "HT-001", temporaryCode: null, name: "历史材料合同", counterparty: "供应商" }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("finance-user");

    expect(result.queues.pending).toContainEqual(expect.objectContaining({
      id: "takeover-payment-evidence:takeover-payment-voucher-1",
      type: "contract_takeover",
      currentNode: "补充历史付款凭证",
      nextAction: "上传后请通知合同岗核对并重新提交复核"
    }));
    expect(prisma.archiveRecord.findMany).toHaveBeenCalledWith({
      where: {
        businessType: "contract_takeover",
        businessId: { in: ["takeover-payment-voucher-1"] },
        departmentScope: "historical_payment_voucher"
      },
      select: { businessId: true }
    });
  });

  it("returns no workbench cards when the user has no relevant business permission", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "employee" }])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn() },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.cards).toEqual([]);
    expect(prisma.contractTakeover.count).not.toHaveBeenCalled();
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });

  it("returns spot procurement and payment approvals with their frozen business ids and no delegated todo", async () => {
    const createdAt = new Date("2026-07-17T01:00:00.000Z");
    const instances = [
      {
        id: "approval-spot-version",
        businessType: "spot_procurement_version",
        businessId: "spot-version-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "项目经理审批",
            roleKeys: ["project_manager"],
            assignments: [{ fromRoleKey: "project_manager", toUserId: "manager-1" }]
          }
        ],
        applicantUserId: "applicant-manager",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "approval-spot-payment",
        businessType: "spot_procurement_payment",
        businessId: "spot-payment-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "项目经理审批",
            roleKeys: ["project_manager"],
            assignments: [{ fromRoleKey: "project_manager", toUserId: "manager-1" }]
          }
        ],
        applicantUserId: "applicant-manager",
        createdAt,
        updatedAt: createdAt
      }
    ];
    const prisma = {
      $queryRaw:jest.fn().mockResolvedValue([]),
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
          where.id ? instances : instances
        )
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-spot-payment",
            approvalInstanceId: "approval-spot-payment",
            action: "approve",
            createdAt
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-version-1",
            procurementId: "spot-procurement-1",
            totalAmountCents: 123_400n,
            supplierNameSnapshot: "甲材料店"
          }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-procurement-1",
            projectId: "project-1",
            code: "LXCG-001",
            supplierNameSnapshot: "甲材料店"
          }
        ])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-1",
            projectId: "project-1",
            procurementId: "spot-procurement-1",
            code: "LXFK-001",
            settlementAmountCents: 120_000n,
            payeeNameSnapshot: "甲材料店"
          }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }])
      },
      approvalDelegation: { findMany: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      approvalWorkItems(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string,
        mode: "pending" | "started" | "delegated",
        evaluatedAt: Date
      ): Promise<Array<Record<string, unknown>>>;
      handledApprovalWorkItems(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<Array<Record<string, unknown>>>;
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<Record<string, number>>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["project_manager"] }];

    const pending = await service.approvalWorkItems(scopes, "manager-1", "pending", createdAt);
    const started = await service.approvalWorkItems(
      scopes,
      "applicant-manager",
      "started",
      createdAt
    );
    const delegated = await service.approvalWorkItems(scopes, "manager-1", "delegated", createdAt);
    const handled = await service.handledApprovalWorkItems(scopes, "manager-1");
    const counts = await service.countApprovalTodos(scopes, "manager-1");
    const applicantPending = await service.approvalWorkItems(
      scopes,
      "applicant-manager",
      "pending",
      createdAt
    );
    const applicantCounts = await service.countApprovalTodos(scopes, "applicant-manager");
    instances[1].applicantUserId = "chairman-1";
    instances[1].frozenNodes = [
      {
        name: "董事长/总经理审批",
        roleKeys: ["chairman", "general_manager"],
        assignments: []
      }
    ];
    const leaderScopes = [{ projectId: "project-1", roleKeys: ["chairman"] }];
    const leaderSelfReviewPending = await service.approvalWorkItems(
      leaderScopes,
      "chairman-1",
      "pending",
      createdAt
    );

    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          businessType: "spot_procurement_version",
          businessId: "spot-version-1",
          businessCode: "LXCG-001",
          title: "零星采购审批：LXCG-001",
          amountText: "¥1,234.00",
          targetPath: "/零星采购/spot-procurement-1"
        }),
        expect.objectContaining({
          businessType: "spot_procurement_payment",
          businessId: "spot-payment-1",
          businessCode: "LXFK-001",
          title: "零星材料付款审批：甲材料店",
          amountText: "¥1,200.00",
          targetPath: "/零星材料付款/spot-payment-1"
        })
      ])
    );
    expect(started).toHaveLength(2);
    expect(delegated).toEqual([]);
    expect(handled).toEqual([
      expect.objectContaining({
        businessType: "spot_procurement_payment",
        businessId: "spot-payment-1",
        projectId: "project-1",
        targetPath: "/零星材料付款/spot-payment-1"
      })
    ]);
    expect(counts).toMatchObject({ spotProcurement: 1, spotPayment: 1, total: 2 });
    expect(applicantPending).toHaveLength(2);
    expect(applicantCounts).toMatchObject({
      spotProcurement: 1,
      spotPayment: 1,
      total: 2
    });
    expect(leaderSelfReviewPending).toEqual([
      expect.objectContaining({
        businessType: "spot_procurement_payment",
        businessId: "spot-payment-1"
      })
    ]);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            expect.objectContaining({ status: "in_progress" }),
            expect.objectContaining({ status: "approval_pending" })
          ]
        }
      })
    );
  });

  it("summarizes a spot-only approval queue and links to the Chinese workbench", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "material_director" }
        ])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "spot_procurement_version",
            businessId: "spot-version-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["material_director"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-version-1", procurementId: "spot-procurement-1" }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-procurement-1", projectId: "project-1" }
        ])
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkbenchSummary("material-director-1");

    expect(result.cards).toEqual([
      expect.objectContaining({
        id: "approval_todo",
        count: 1,
        description: "合同 0 · 结算 0 · 付款 0 · 支出 0 · 零星采购 1 · 零星付款 0",
        targetPath: "/零星采购工作台"
      })
    ]);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("shows the project manager parallel duty before the materials supervisor has acted", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw:jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "spot_procurement_version",
            businessId: "spot-version-1",
            currentNodeIndex: 0,
            frozenNodes: [
              { mode: "any", roleKeys: ["material_director"], protocolVersion: 1, executionMode: "parallel" },
              { mode: "any", roleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel" }
            ]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-version-1", procurementId: "spot-procurement-1" }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-procurement-1", projectId: "project-1" }
        ])
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkbenchSummary("manager-1");

    expect(result.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "approval_todo",
        count: 1,
        description: "合同 0 · 结算 0 · 付款 0 · 支出 0 · 零星采购 1 · 零星付款 0",
        targetPath: "/零星采购工作台"
      })
    ]));
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("shows only the currently delegated parallel duty and closes it after either person acts", async () => {
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw: jest.fn(async (query: {strings: readonly string[]; values: readonly unknown[]}) => query.strings.join("").includes('FROM "ApprovalDelegation"') ? (query.values.includes("flow-1:1") ? [{id:"mandate",fromUserId:"original",toUserId:"delegate"}] : []) : query.strings.join("").includes("WITH members") ? [{projectId:"project-1",userId:"original",roleKey:"project_manager",userIsActive:true}] : []),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "employee" }
        ])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "flow-1", status: "approval_pending", applicantUserId: "applicant",
            businessType: "spot_procurement_version",
            businessId: "spot-version-1",
            currentNodeIndex: 0,
            frozenNodes: [
              { mode: "any", roleKeys: ["material_director"], protocolVersion: 1, executionMode: "parallel" },
              { mode: "any", roleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel" }
            ]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-version-1", procurementId: "spot-procurement-1" }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          { id: "spot-procurement-1", projectId: "project-1" }
        ])
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({id:"mandate"}) },
      contractTakeover: { count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkbenchSummary("delegate");

    expect(result.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "approval_todo",
        count: 1,
        description: "合同 0 · 结算 0 · 付款 0 · 支出 0 · 零星采购 1 · 零星付款 0",
        targetPath: "/零星采购工作台"
      })
    ]));
    prisma.approvalInstance.findMany.mockResolvedValue([]);
    const after = await service.getWorkbenchSummary("delegate");
    expect(after.cards.find(card=>card.id==="approval_todo")?.count).toBe(0);
  });

  it("独立催办复用当前业务待办，无对应项时只出现于近期提示且保持正常分页计数", async () => {
    const time = new Date();
    const base = { projectName: "合成项目", businessCode: "JS-1", title: "结算归档", currentNodeName: "确认归档", remindedAt: time };
    const service = new MeService({} as never, {} as never, undefined, {
      recentPendingReminders: jest.fn().mockResolvedValue([
        { ...base, id: "independent:settlement_archive:settlement-1", businessId: "settlement-1", kind: "settlement_archive", reminderId: "matched" },
        { ...base, id: "independent:no_invoice:source-1", businessId: "source-1", kind: "no_invoice", reminderId: "recent-only",
          remindedAt: new Date(time.getTime() + 1) }
      ])
    } as never);
    jest.spyOn(service as never, "loadProjectRoleScopes" as never).mockResolvedValue([] as never);
    jest.spyOn(service as never, "collectCurrentPending" as never).mockResolvedValue([{
      id: "settlement-archive:settlement-1", businessId: "settlement-1", businessType: "settlement",
      targetPath: "/结算管理/JS-1", type: "archive"
    }] as never);
    const result = await service.getWorkItemNotices("reviewer", 0);
    expect(result.queueMeta.pending.total).toBe(1);
    expect(result.queues.pending).toEqual([expect.objectContaining({ reminderId: "matched", targetPath: "/结算管理/JS-1" })]);
    expect(result.recentNotices).toEqual([
      expect.objectContaining({ reminderId: "recent-only", targetPath: "/审批中心?review=independent%3Ano_invoice%3Asource-1" }),
      expect.objectContaining({ reminderId: "matched", targetPath: "/结算管理/JS-1" })
    ]);
  });

  it("费用资金待办只展示可办项目的非零余额，办结或撤岗后消失", async () => {
    const approvedAt = new Date();
    const row = { id: "loan/1", code: "JK-01", claimType: "loan", status: "partially_disbursed", projectId: "project-1",
      approvedAt, updatedAt: approvedAt, requestedAmountCents: 1000n, companyPayableAmountCents: 0n, fundedAmountCents: 100n };
    const findMany = jest.fn().mockResolvedValue([
      row,
      { ...row, id: "expense-1", code: "BX-01", claimType: "reimbursement", status: "approved_pending_payment", companyPayableAmountCents: 300n },
      { ...row, id: "wrong-project", projectId: "project-2" },
      { ...row, id: "zero", fundedAmountCents: 1000n },
      { ...row, id: "final", status: "disbursed" }
    ]);
    const service = new MeService({ expenseClaim: { findMany } } as never, {} as never) as unknown as {
      expenseFundingWorkItems(scopes: Array<{ projectId: string; roleKeys: string[] }>, names: Map<string, string>): Promise<WorkItem[]>
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["finance_staff"] }];
    const names = new Map([["project-1", "合成项目"]]);
    await expect(service.expenseFundingWorkItems(scopes, names)).resolves.toEqual([
      expect.objectContaining({ id: "expense-funding:payment:expense-1", targetPath: "/费用与报销/expense-1",
        type: "payment_execution", currentNode: "登记实际付款", amountText: "¥2.00" })
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { voidedAt: null, OR: [
      { projectId: { in: ["project-1"] }, claimType: { in: ["reimbursement", "incidental_expense"] }, status: { in: ["approved_pending_payment", "partially_paid"] } }
    ] } }));
    await expect(service.expenseFundingWorkItems([{ projectId: "project-1", roleKeys: ["finance_director"] }], names)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    findMany.mockResolvedValueOnce([{ ...row, status: "disbursed" }]);
    await expect(service.expenseFundingWorkItems(scopes, names)).resolves.toEqual([]);
  });

  it("reuses canonical pending work-item sources for the untruncated funds queue", async () => {
    const service = new MeService({$queryRaw:jest.fn().mockResolvedValue([])} as never, {} as never) as unknown as {
      getFundsPendingWorkItems(userId: string): Promise<WorkItem[]>;
      loadProjectRoleScopes(): Promise<Array<{ projectId: string; roleKeys: string[] }>>;
      projectNames(projectIds: string[]): Promise<Map<string, string>>;
      projectIdsFor(scopes: unknown[], actions: string[]): string[];
      paymentExecutionWorkItems(projectIds: string[], names: Map<string, string>, limit?: number): Promise<WorkItem[]>;
      spotPaymentExecutionWorkItems(projectIds: string[], names: Map<string, string>, limit?: number): Promise<WorkItem[]>;
      approvalWorkItems(scopes: unknown[], userId: string, mode: string, evaluatedAt: Date): Promise<WorkItem[]>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["finance_staff"] }];
    const loadProjectRoleScopes = jest.spyOn(service, "loadProjectRoleScopes").mockResolvedValue(scopes);
    const projectNames = jest.spyOn(service, "projectNames").mockResolvedValue(new Map([["project-1", "科技园"]]));
    const projectIdsFor = jest.spyOn(service, "projectIdsFor").mockReturnValue(["project-1"]);
    const paymentExecutionWorkItems = jest.spyOn(service, "paymentExecutionWorkItems").mockResolvedValue([
      { businessType: "payment_request", businessId: "payment-1" }
    ] as WorkItem[]);
    const spotPaymentExecutionWorkItems = jest.spyOn(service, "spotPaymentExecutionWorkItems").mockResolvedValue([
      { businessType: "spot_payment", businessId: "spot-1" }
    ] as WorkItem[]);
    jest.spyOn(service, "approvalWorkItems").mockResolvedValue([
      { businessType: "spot_procurement_payment", businessId: "spot-approval-1" },
      { businessType: "contract", businessId: "contract-1" }
    ] as WorkItem[]);

    await expect(service.getFundsPendingWorkItems("finance-1")).resolves.toEqual([
      { businessType: "payment_request", businessId: "payment-1" },
      { businessType: "spot_payment", businessId: "spot-1" },
      { businessType: "spot_procurement_payment", businessId: "spot-approval-1" }
    ]);
    expect(loadProjectRoleScopes).toHaveBeenCalledWith("finance-1");
    expect(projectNames).toHaveBeenCalledWith(["project-1"]);
    expect(projectIdsFor).toHaveBeenCalled();
    expect(paymentExecutionWorkItems).toHaveBeenCalledWith(
      "finance-1",
      expect.any(Map),
      undefined
    );
    expect(spotPaymentExecutionWorkItems).toHaveBeenCalledWith(
      "finance-1",["project-1"],
      expect.any(Map),
      undefined
    );
  });

  it("reads funds pending ids only from the supplied transaction and shared budget", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          where.projectId === null
            ? [{ positionId: "position-finance", projectId: null }]
            : [])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-finance", key: "finance_staff" }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          where.status?.in
            ? [{ id: "payment-1" }]
            : [])
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: { findMany: jest.fn() },
      user: { findMany: jest.fn() }
    };
    let used = 0;
    const budget = {
      remaining: () => 100 - used,
      consume: (rowCount: number) => {
        if (rowCount > 100 - used) throw new Error("budget exceeded");
        used += rowCount;
      }
    };
    const service = new MeService({} as never, {} as never);

    await expect(service.getFundsPendingBusinessIdsInTransaction(
      tx as never,
      "finance-1",
      ["project-1"],
      new Date("2026-09-12T00:00:00.000Z"),
      budget
    )).resolves.toEqual({
      contractPaymentIds: ["payment-1"],
      spotPaymentIds: []
    });
    expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: { in: ["project-1"] },
        status: { in: ["approved_pending_payment", "partially_paid"] }
      }),
      take: expect.any(Number)
    }));
    expect(tx.approvalDelegation.findMany).not.toHaveBeenCalled();
    expect(used).toBeGreaterThan(0);
  });

  it("derives the untruncated contract queue only from canonical contract pending sources", async () => {
    const service = new MeService({ contract: { findMany: jest.fn().mockResolvedValue([]) }, contractVersion: { findMany: jest.fn().mockResolvedValue([]) } } as never, {} as never) as unknown as {
      getContractPendingWorkItems(userId: string): Promise<WorkItem[]>;
      loadProjectRoleScopes(): Promise<Array<{ projectId: string; roleKeys: string[] }>>;
      projectNames(projectIds: string[]): Promise<Map<string, string>>;
      projectIdsFor(scopes: unknown[], actions: string[]): string[];
      contractArchiveWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      contractSealFinalUploadWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      contractFinalUploadSubstituteWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      approvalWorkItems(scopes: unknown[], userId: string, mode: string, evaluatedAt: Date): Promise<WorkItem[]>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["contract_staff"] }];
    jest.spyOn(service, "loadProjectRoleScopes").mockResolvedValue(scopes);
    jest.spyOn(service, "projectNames").mockResolvedValue(new Map([["project-1", "科技园"]]));
    jest.spyOn(service, "projectIdsFor").mockReturnValue(["project-1"]);
    const archive = jest.spyOn(service, "contractArchiveWorkItems").mockResolvedValue([
      { businessType: "contract_version", businessId: "archive-1" }
    ] as WorkItem[]);
    const handler = jest.spyOn(service, "contractSealFinalUploadWorkItems").mockResolvedValue([
      { businessType: "contract_version", businessId: "seal-1" }
    ] as WorkItem[]);
    jest.spyOn(service, "contractFinalUploadSubstituteWorkItems").mockResolvedValue([
      { businessType: "contract_version", businessId: "substitute-1" }
    ] as WorkItem[]);
    jest.spyOn(service, "approvalWorkItems").mockResolvedValue([
      { businessType: "contract_version", businessId: "approval-1" },
      { businessType: "settlement", businessId: "settlement-1" }
    ] as WorkItem[]);

    await expect(service.getContractPendingWorkItems("contract-1")).resolves.toEqual(expect.arrayContaining([
      { businessType: "contract_version", businessId: "archive-1" },
      { businessType: "contract_version", businessId: "seal-1" },
      { businessType: "contract_version", businessId: "substitute-1" },
      { businessType: "contract_version", businessId: "approval-1" }
    ]));
    expect(archive.mock.calls.map((args) => args[1])).toEqual([
      ["seal_approved_pending_archive"], ["pending_archive_confirm"]
    ]);
    expect(archive.mock.calls.every((args) => args[7] === undefined)).toBe(true);
    expect(handler).toHaveBeenCalledWith("contract-1", expect.any(Map), undefined);
  });

  it("does not read non-contract approvals or fund registrations for the contract queue", async () => {
    const findApprovals = jest.fn().mockResolvedValue([]);
    const findFundRegistrations = jest.fn().mockRejectedValue(new Error("fund registrations are outside the contract role"));
    const prisma = {
      approvalInstance: { findMany: findApprovals },
      fundAccountBalanceRegistration: { findMany: findFundRegistrations },
      $transaction: async (read: (tx: unknown) => Promise<unknown>) => read(prisma)
    };
    const service = new MeService(prisma as never, {} as never);
    const sources = service as unknown as {
      loadProjectRoleScopes(): Promise<unknown[]>;
      projectNames(): Promise<Map<string, string>>;
      contractV2LifecycleWorkItems(): Promise<{ pending: WorkItem[] }>;
      contractArchiveWorkItems(): Promise<WorkItem[]>;
      contractSealFinalUploadWorkItems(): Promise<WorkItem[]>;
      contractFinalUploadSubstituteWorkItems(): Promise<WorkItem[]>;
    };
    jest.spyOn(sources, "loadProjectRoleScopes").mockResolvedValue([]);
    jest.spyOn(sources, "projectNames").mockResolvedValue(new Map());
    jest.spyOn(sources, "contractV2LifecycleWorkItems").mockResolvedValue({ pending: [] });
    jest.spyOn(sources, "contractArchiveWorkItems").mockResolvedValue([]);
    jest.spyOn(sources, "contractSealFinalUploadWorkItems").mockResolvedValue([]);
    jest.spyOn(sources, "contractFinalUploadSubstituteWorkItems").mockResolvedValue([]);

    await expect(service.getContractPendingWorkItems("handler")).resolves.toEqual([]);
    expect(findApprovals).toHaveBeenCalledWith(expect.objectContaining({
      // 合同履约确认属于合同域待办，仍不得读取结算、付款或资金登记来源。
      where: expect.objectContaining({ businessType: { in: ["contract_version", "contract_work_completion"] } })
    }));
    expect(findFundRegistrations).not.toHaveBeenCalled();
  });

  it("derives the untruncated settlement queue only from canonical settlement pending sources", async () => {
    const service = new MeService({} as never, {} as never) as unknown as {
      getSettlementPendingWorkItems(userId: string): Promise<WorkItem[]>;
      loadProjectRoleScopes(): Promise<Array<{ projectId: string; roleKeys: string[] }>>;
      projectNames(projectIds: string[]): Promise<Map<string, string>>;
      projectIdsFor(scopes: unknown[], actions: string[]): string[];
      settlementArchiveWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      failedSettlementGenerationWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      approvalWorkItems(scopes: unknown[], userId: string, mode: string, evaluatedAt: Date): Promise<WorkItem[]>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["contract_staff"] }];
    jest.spyOn(service, "loadProjectRoleScopes").mockResolvedValue(scopes);
    jest.spyOn(service, "projectNames").mockResolvedValue(new Map([["project-1", "科技园"]]));
    jest.spyOn(service, "projectIdsFor").mockReturnValue(["project-1"]);
    const archive = jest.spyOn(service, "settlementArchiveWorkItems").mockResolvedValue([
      { businessType: "settlement", businessId: "archive-1" }
    ] as WorkItem[]);
    const failed = jest.spyOn(service, "failedSettlementGenerationWorkItems").mockResolvedValue([
      { businessType: "settlement", businessId: "failed-1" }
    ] as WorkItem[]);
    jest.spyOn(service, "approvalWorkItems").mockResolvedValue([
      { businessType: "settlement", businessId: "approval-1" },
      { businessType: "contract_version", businessId: "contract-1" }
    ] as WorkItem[]);

    await expect(service.getSettlementPendingWorkItems("settlement-1")).resolves.toEqual(expect.arrayContaining([
      { businessType: "settlement", businessId: "archive-1" },
      { businessType: "settlement", businessId: "failed-1" },
      { businessType: "settlement", businessId: "approval-1" }
    ]));
    expect(archive).toHaveBeenCalledTimes(3);
    expect(archive.mock.calls.every((args) => args[7] === true)).toBe(true);
    expect(failed).toHaveBeenCalledWith(["project-1"], expect.any(Map), true);
  });

  it("公司日常报销为兼岗本人保留每组待办，停用岗位及非当前轮不再出现", async () => {
    const updatedAt = new Date("2026-11-24T03:00:00Z");
    const instance = {
      id: "expense-round", businessType: "expense_claim", businessId: "claim-1", flowType: "expense_claim.approve",
      status: "in_progress", currentNodeIndex: 0, applicantUserId: "applicant-1", createdAt: updatedAt, updatedAt,
      frozenNodes: [
        { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], protocolVersion: 1, executionMode: "parallel",
          approvedRoleKeys: [] as string[], roleScopesByRole: { comprehensive_director: "global" }, candidateUserIdsByRole: { comprehensive_director: ["actor-1"] } },
        { name: "财务主管", mode: "any", roleKeys: ["finance_director"], protocolVersion: 1, executionMode: "parallel",
          candidatePolicy: "current_role_scope", roleScopesByRole: { finance_director: "global" }, candidateUserIdsByRole: { finance_director: [] } },
        { name: "负责人", mode: "any", roleKeys: ["general_manager"], protocolVersion: 1, executionMode: "parallel",
          roleScopesByRole: { general_manager: "global" }, candidateUserIdsByRole: { general_manager: ["other-1"] } }
      ]
    };
    const claim = {
      id: "claim-1", projectId: null, code: "BX-001", reason: "差旅费",
      claimType: "reimbursement", generalProcurementId: null, actualPurchaseBatchId: null, status: "approval_pending",
      approvalInstanceId: instance.id, requestedAmountCents: 100n
    };
    const globalRoles = [{ positionId: "position-1" }, { positionId: "position-2" }];
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw: jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn(({ where }) => where.projectId === null ? globalRoles : []) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn(async ({ where }) => where.id.in.map((id: string) => ({
        id, key: id === "position-1" ? "comprehensive_director" : "finance_director"
      }))) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn(({ where }) => where.applicantUserId ? [] : [instance]) },
      expenseClaim: { findMany: jest.fn().mockResolvedValue([claim]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "actor-1", isActive: true }), findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never);
    const pending = async () => (await service.getWorkItems("actor-1")).approvalCenter.pendingApproval;

    await expect(pending()).resolves.toEqual([expect.objectContaining({
      id: "approval:expense-round", projectName: "公司日常", currentNode: "综合部主管、财务主管",
      businessType: "expense_claim", targetPath: "/费用与报销/claim-1", canHandle: true, actionGroup: "approval",
      parallelCompletion: { completed: 0, total: 3 }
    })]);
    await expect(service.getWorkbenchSummary("actor-1")).resolves.toMatchObject({
      cards: expect.arrayContaining([expect.objectContaining({ id: "approval_todo", count: 1, targetPath: "/审批中心" })])
    });
    instance.frozenNodes[0].approvedRoleKeys = ["comprehensive_director"];
    await expect(pending()).resolves.toEqual([expect.objectContaining({ currentNode: "财务主管", parallelCompletion: { completed: 1, total: 3 } })]);
    instance.frozenNodes[0].approvedRoleKeys = [];
    globalRoles.pop();
    await expect(pending()).resolves.toEqual([expect.objectContaining({ currentNode: "综合部主管" })]);
    claim.approvalInstanceId = "different-round";
    await expect(pending()).resolves.toEqual([]);
  });

  it("审批中心委托并入待审批、逾期作为筛选，摘要显示发起人、状态和并联完成数", async () => {
    const updatedAt = new Date(Date.now() - 72 * 3_600_000);
    const instance = {
      id: "approval-1",
      businessType: "settlement",
      businessId: "settlement-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "合同部主管", mode: "any", roleKeys: ["contract_director"], protocolVersion: 1,
          executionMode: "parallel", approvedRoleKeys: ["contract_director"] },
        { name: "项目经理", mode: "any", roleKeys: ["project_manager"], protocolVersion: 1,
          executionMode: "parallel", approvedRoleKeys: [] }
      ],
      applicantUserId: "applicant-1",
      createdAt: updatedAt,
      updatedAt
    };
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
      $queryRaw: jest.fn().mockResolvedValue([]),
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string } }) => {
          if (where.applicantUserId) return [];
          return [instance];
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          { id: "settlement-1", projectId: "project-1", contractId: "contract-1", code: "JS-001",
            periodLabel: "2026-07", amountCents: 100000n }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", projectId: "project-1", code: "HT-001", temporaryCode: null,
            name: "测试合同", counterparty: "测试供应商" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "applicant-1", name: "申请人甲" }])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-1");

    expect(Object.keys(result.approvalCenter).sort()).toEqual(["handledByMe", "pendingApproval", "startedByMe"]);
    expect(result.approvalCenter).not.toHaveProperty("delegatedToMe");
    expect(result.approvalCenter).not.toHaveProperty("overdueReminder");
    expect(result.approvalCenter.pendingApproval[0]).toMatchObject({
      id: "approval:approval-1",
      overdue: true,
      canHandle: true,
      applicantName: "申请人甲",
      businessStatus: "in_progress",
      parallelCompletion: { completed: 1, total: 2 }
    });
  });
});

describe("MeService takeover handover continuation", () => {
  function fixture(settlementCount: number, paymentCount: number) {
    const handover = {
      schemaVersion: 1,
      revision: 1,
      assignments: {
        contract: "contract-1",
        finance: "finance-1",
        supervisor: "supervisor-1"
      }
    };
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "takeover-1",
            projectId: "project-1",
            contractId: "contract-row-1",
            contractVersionId: "version-1",
            confirmedAt: new Date("2026-11-01T00:00:00Z")
          }
        ])
      },
      contractTakeoverConfirmationEvent: {
        findMany: jest.fn().mockResolvedValue([
          { takeoverId: "takeover-1", responseSnapshot: handover }
        ])
      },
      settlement: {
        groupBy: jest.fn().mockResolvedValue(
          settlementCount
            ? [{ contractVersionId: "version-1", _count: { _all: settlementCount } }]
            : []
        )
      },
      paymentRequest: {
        groupBy: jest.fn().mockResolvedValue(
          paymentCount
            ? [{ contractVersionId: "version-1", _count: { _all: paymentCount } }]
            : []
        )
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-row-1", code: "HT-416", temporaryCode: null, name: "历史合同" }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      contractTakeoverHandoverWorkItems(
        userId: string,
        scopes: Array<{ projectId: string }>,
        projectNameById: Map<string, string>
      ): Promise<WorkItem[]>;
    };
    return { service, prisma };
  }

  it("gives the registered contract handler the new-settlement todo only after takeover", async () => {
    const { service } = fixture(0, 0);
    const items = await service.contractTakeoverHandoverWorkItems(
      "contract-1",
      [{ projectId: "project-1" }],
      new Map([["project-1", "一号项目"]])
    );
    expect(items).toEqual([
      expect.objectContaining({
        id: "takeover-continuation:takeover-1:contract",
        currentNode: "继续办理新结算",
        targetPath: "/结算工作台/新建?project=project-1&contract=contract-row-1"
      })
    ]);
    await expect(
      service.contractTakeoverHandoverWorkItems(
        "finance-1",
        [{ projectId: "project-1" }],
        new Map()
      )
    ).resolves.toEqual([]);
    await expect(
      service.contractTakeoverHandoverWorkItems(
        "outsider",
        [{ projectId: "project-1" }],
        new Map()
      )
    ).resolves.toEqual([]);
  });

  it("moves the follow-up todo to the registered finance handler after a settlement exists", async () => {
    const { service } = fixture(1, 0);
    await expect(
      service.contractTakeoverHandoverWorkItems(
        "contract-1",
        [{ projectId: "project-1" }],
        new Map()
      )
    ).resolves.toEqual([]);
    const items = await service.contractTakeoverHandoverWorkItems(
      "finance-1",
      [{ projectId: "project-1" }],
      new Map()
    );
    expect(items).toEqual([
      expect.objectContaining({
        id: "takeover-continuation:takeover-1:finance",
        currentNode: "登记后续付款"
      })
    ]);
  });

  it("closes the finance todo once a payment exists", async () => {
    const { service } = fixture(1, 1);
    await expect(
      service.contractTakeoverHandoverWorkItems(
        "finance-1",
        [{ projectId: "project-1" }],
        new Map()
      )
    ).resolves.toEqual([]);
  });
});
