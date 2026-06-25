import { PrismaService } from "../database/prisma.service";
import { ContractDocumentService } from "./contract-document.service";

describe("ContractDocumentService", () => {
  const audit = { record: jest.fn() };
  const files = { assertCanDownloadFileById: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
    files.assertCanDownloadFileById.mockReset().mockResolvedValue(undefined);
  });

  function makeTx(overrides: Record<string, unknown> = {}) {
    return {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          draftRevision: 7,
          amountCents: 1_000_000n,
          draftData: { deliveryLocation: "项目现场" },
          clauseSnapshot: [
            { key: "payment", content: { text: "结算后付款" } }
          ],
          readinessSnapshot: { blockingErrors: [], warnings: [] }
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          name: "钢材采购合同",
          temporaryCode: "DRAFT-001",
          code: null
        })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-1",
          status: "published",
          docxFileId: "layout-file-1"
        })
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "attachment-a", originalName: "附件A.pdf", mimeType: "application/pdf" },
          { id: "attachment-b", originalName: "附件B.png", mimeType: "image/png" }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            roleKey: "party_b",
            displayOrder: 1,
            snapshot: { name: "示例供应商" }
          }
        ])
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractBillRow: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({
          id: "document-1",
          ...create
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn()
      },
      auditLog: { create: jest.fn() },
      ...overrides
    };
  }

  function makeService(tx: ReturnType<typeof makeTx>) {
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    return new ContractDocumentService(prisma, audit as never, files as never);
  }

  it("queues a document for the current draft revision with a deterministic attachment order", async () => {
    const tx = makeTx();
    const service = makeService(tx);

    const result = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      attachmentFileIds: ["attachment-b", "attachment-a"]
    });

    expect(result).toMatchObject({
      id: "document-1",
      sourceRevision: 7,
      status: "queued"
    });
    expect(files.assertCanDownloadFileById).toHaveBeenNthCalledWith(
      1,
      "attachment-a",
      "owner-1"
    );
    expect(tx.contractGeneratedDocument.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: expect.any(String) },
      update: {},
      create: expect.objectContaining({
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        sourceRevision: 7,
        purpose: "draft",
        inputSnapshot: expect.objectContaining({
          templateFileId: "layout-file-1",
          outputBaseName: "DRAFT-001-draft-r7",
          attachmentFiles: [
            expect.objectContaining({ id: "attachment-a" }),
            expect.objectContaining({ id: "attachment-b" })
          ],
          renderInput: {
            values: expect.objectContaining({
              "contract.name": "钢材采购合同",
              "field.deliveryLocation": "项目现场",
              "party.party_b.name": "示例供应商",
              "document.watermark": "草稿"
            })
          }
        })
      })
    });
  });

  it("marks older successful documents stale when listing as a safety net", async () => {
    const tx = makeTx();
    const service = makeService(tx);

    await service.list("version-1", "owner-1");

    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 7 }
      },
      data: { status: "stale" }
    });
  });

  it("returns an existing queued, processing, or successful document for the same key", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "existing-document",
      status: "processing"
    });
    const service = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "existing-document" });
    expect(tx.contractGeneratedDocument.upsert).not.toHaveBeenCalled();
  });

  it("allows draft warnings but rejects internal review without a clean readiness snapshot", async () => {
    const tx = makeTx();
    const service = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "document-1" });

    tx.contractVersion.findUnique.mockResolvedValue({
      ...(await tx.contractVersion.findUnique()),
      readinessSnapshot: null
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("Internal review readiness snapshot is required");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...(await tx.contractVersion.findUnique()),
      readinessSnapshot: { blockingErrors: ["合同金额缺失"] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("Internal review readiness has blocking errors");
  });

  it("marks failure retryable and records retry audit", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique
      .mockResolvedValueOnce({
        id: "document-1",
        contractVersionId: "version-1",
        sourceRevision: 7,
        status: "failed"
      })
      .mockResolvedValueOnce({ id: "document-1", status: "queued" });
    const service = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).resolves.toMatchObject({
      status: "queued"
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "failed" },
      data: {
        status: "queued",
        errorMessage: null,
        startedAt: null,
        completedAt: null
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "contract.document.retry" })
    );
  });
});
