import { createHash } from "node:crypto";
import { MeService, type WorkItem } from "./me.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("MeService", () => {
  it("keeps legacy upload work separate from governed archive confirmation", async () => {
    const prisma = {
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

  it("creates distinct handler work items for offline sealing and final-file upload", async () => {
    const prisma = {
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
      contractSealHandlerWorkItems(
        userId: string,
        names: ReadonlyMap<string, string>
      ): Promise<Array<{ currentNode: string; nextAction: string }>>;
    }).contractSealHandlerWorkItems("handler-1", new Map([["project-1", "项目一"]]));

    expect(items.map((item) => item.currentNode)).toEqual(["线下签署盖章", "上传双方最终版"]);
    expect(items.map((item) => item.nextAction)).toEqual([
      "确认我方签署盖章完成",
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
    const service = new MeService(prisma as never, files as never);
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
      completedAt: "2026-07-23T08:00:00.000Z", signatureVersionId: "version-1"
    });
    await expect(service.getCanvasSignatureHandoff("other-user", token)).rejects.toThrow("同一账号");
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

    const result = await service.myDraftWorkItems(
      "user-1",
      ["project-1"],
      ["project-1"],
      new Map([["project-1", "测试项目"]])
    );

    expect(result.total).toBe(40);
    expect(result.items).toHaveLength(31);
    expect(result.items).toContainEqual(expect.objectContaining({
      id: "settlement-draft:settlement-draft-0",
      agingStatus: "stale"
    }));
    expect(result.items.some((item) => item.id.startsWith("settlement-draft:"))).toBe(true);
    expect(prisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: { not: "historical_takeover" } })
    }));
    expect(prisma.settlementDraft.count).toHaveBeenCalled();
    expect(prisma.contractBusinessTemplateVersion.count).toHaveBeenCalled();
  });

  it("returns visible approval work items with business jump targets", async () => {
    const prisma = {
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
          if (where.applicantUserId) return [];
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

    const result = await service.getWorkItems("user-1");

    expect(result.queues.pending).toHaveLength(1);
    expect(result.queues.pending[0]).toMatchObject({
      id: "approval:approval-1",
      type: "approval",
      projectName: "测试项目",
      projectId: "project-1",
      businessCode: "JS-001",
      businessType: "settlement",
      businessId: "settlement-1",
      title: "结算审批：测试合同",
      amountText: "¥1,000.00",
      currentNode: "项目经理审批",
      targetPath: "/结算管理/JS-001"
    });
    expect(result.approvalCenter.pendingApproval[0].id).toBe("approval:approval-1");
  });

  it("routes project expense approval work items to the independent detail", async () => {
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
            expenseType: "reimbursement",
            paymentSubject: "现场报销",
            requestedAmountCents: 50_000n
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("manager-1");

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
    expect(result.approvalCenter.delegatedToMe).toEqual([]);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("returns pending approval work items accepted through standing delegation", async () => {
    const prisma = {
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

    const result = await service.getWorkItems("delegatee-1");

    expect(result.queues.pending).toContainEqual(
      expect.objectContaining({
        id: "approval:approval-1",
        type: "approval",
        projectName: "测试项目",
        businessCode: "JS-001",
        currentNode: "项目经理审批"
      })
    );
    expect(result.approvalCenter.pendingApproval[0].id).toBe("approval:approval-1");
    expect(result.approvalCenter.delegatedToMe[0].id).toBe("approval:approval-1");
    expect(result.approvalCenter.startedByMe[0].id).toBe("approval:approval-started");
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledTimes(2);
    const firstEvaluatedAt = prisma.approvalDelegation.findMany.mock.calls[0]?.[0].where.startsAt.lte;
    const secondEvaluatedAt = prisma.approvalDelegation.findMany.mock.calls[1]?.[0].where.startsAt.lte;
    expect(firstEvaluatedAt).toBe(secondEvaluatedAt);
    expect(result.generatedAt).toBe(firstEvaluatedAt.toISOString());

    prisma.user.findMany.mockResolvedValue([
      { id: "delegator-1", isActive: false },
      { id: "delegatee-1", isActive: true }
    ]);
    const inactiveDelegatorResult = await service.getWorkItems("delegatee-1");
    expect(inactiveDelegatorResult.approvalCenter.pendingApproval).toEqual([]);
    expect(inactiveDelegatorResult.approvalCenter.delegatedToMe).toEqual([]);
  });

  it("does not count project expense through standing delegation", async () => {
    const prisma = {
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

  it("待办中心对受治理节点只认冻结候选且不因调岗失去待办", async () => {
    const prisma = {
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
    )).resolves.toMatchObject({ settlement: 1, total: 1 });

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
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
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
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "finance_staff" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn() },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            projectId: "project-1",
            code: "FK-001",
            requestedAmountCents: 8000000n,
            approvedAmountCents: 5000000n,
            paidAmountCents: 2000000n,
            updatedAt: new Date("2026-07-07T08:00:00.000Z")
          }
        ]),
        count: jest.fn()
      },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-finance");

    expect(result.queues.pending).toContainEqual(
      expect.objectContaining({
        id: "payment-execution:payment-1",
        type: "payment_execution",
        businessCode: "FK-001",
        amountText: "¥30,000.00"
      })
    );
  });

  it("shows approved spot-payment execution work items to project finance", async () => {
    const prisma = {
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-1",
            projectId: "project-1",
            code: "LXCG-001-V1-P001",
            approvalAmountCents: 410000n,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-21T08:00:00.000Z")
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      spotPaymentExecutionWorkItems(
        projectIds: string[],
        projectNames: ReadonlyMap<string, string>
      ): Promise<WorkItem[]>;
    };

    await expect(service.spotPaymentExecutionWorkItems(
      ["project-1"],
      new Map([["project-1", "测试项目"]])
    )).resolves.toEqual([
      expect.objectContaining({
        id: "spot-payment-execution:spot-payment-1",
        title: "登记零星材料实付与凭证",
        amountText: "¥4,100.00",
        targetPath: "/零星材料付款/spot-payment-1?tab=current"
      })
    ]);
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
    expect(applicantPending).toEqual([]);
    expect(applicantCounts).toMatchObject({
      spotProcurement: 0,
      spotPayment: 0,
      total: 0
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

  it("reuses canonical pending work-item sources for the untruncated funds queue", async () => {
    const service = new MeService({} as never, {} as never) as unknown as {
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
      ["project-1"],
      expect.any(Map),
      undefined
    );
    expect(spotPaymentExecutionWorkItems).toHaveBeenCalledWith(
      ["project-1"],
      expect.any(Map),
      undefined
    );
  });

  it("derives the untruncated contract queue only from canonical contract pending sources", async () => {
    const service = new MeService({} as never, {} as never) as unknown as {
      getContractPendingWorkItems(userId: string): Promise<WorkItem[]>;
      loadProjectRoleScopes(): Promise<Array<{ projectId: string; roleKeys: string[] }>>;
      projectNames(projectIds: string[]): Promise<Map<string, string>>;
      projectIdsFor(scopes: unknown[], actions: string[]): string[];
      contractArchiveWorkItems(...args: unknown[]): Promise<WorkItem[]>;
      contractSealHandlerWorkItems(...args: unknown[]): Promise<WorkItem[]>;
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
    const handler = jest.spyOn(service, "contractSealHandlerWorkItems").mockResolvedValue([
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
    expect(archive).toHaveBeenCalledTimes(4);
    expect(archive.mock.calls.every((args) => args[8] === undefined)).toBe(true);
    expect(handler).toHaveBeenCalledWith("contract-1", expect.any(Map), undefined);
  });
});
