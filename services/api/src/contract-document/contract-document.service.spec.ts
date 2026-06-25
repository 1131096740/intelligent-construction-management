import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ContractDocumentService } from "./contract-document.service";

describe("ContractDocumentService", () => {
  const audit = { record: jest.fn() };
  const files = { assertCanDownloadFile: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
    files.assertCanDownloadFile.mockReset().mockImplementation(
      (_tx, id: string) =>
        Promise.resolve({
          id,
          originalName: id === "attachment-a" ? "附件A.pdf" : "附件B.png",
          mimeType: id === "attachment-a" ? "application/pdf" : "image/png"
        })
    );
  });

  function makeTx(overrides: Record<string, unknown> = {}) {
    return {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          amountCents: 1_000_000n,
          draftData: { deliveryLocation: "项目现场" },
          clauseSnapshot: [
            { key: "payment", content: { text: "结算后付款" } }
          ],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          name: "钢材采购合同",
          contractTypeKey: "materials",
          temporaryCode: "DRAFT-001",
          code: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-1",
          layoutTemplateId: "layout-template-1",
          status: "published",
          docxFileId: "layout-file-1",
          placeholderSchema: {
            required: ["field.deliveryLocation"],
            fields: [{ key: "deliveryDate", required: true }],
            bills: []
          },
          inspectionReport: { placeholders: ["field.deliveryLocation"] }
        })
      },
      contractLayoutTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-template-1",
          contractTypeKey: "materials"
        })
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
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "document-1",
          ...data
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
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      contractGeneratedDocument: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;
    return {
      service: new ContractDocumentService(prisma, audit as never, files as never),
      prisma
    };
  }

  it("queues a document for the current draft revision with a deterministic attachment order", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

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
    expect(files.assertCanDownloadFile).toHaveBeenNthCalledWith(
      1,
      tx,
      "attachment-a",
      "owner-1"
    );
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        sourceRevision: 7,
        purpose: "draft",
        inputSnapshot: expect.objectContaining({
          templateFileId: "layout-file-1",
          outputBaseName: "DRAFT-001-draft-r7",
          requiredKeys: expect.arrayContaining([
            "contract.name",
            "contract.temporaryCode",
            "document.watermark",
            "field.deliveryLocation",
            "field.deliveryDate"
          ]),
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
    const { service } = makeService(tx);

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
    const { service } = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "existing-document" });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("allows draft warnings but rejects internal review without a clean readiness snapshot", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const version = await tx.contractVersion.findUnique();

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "document-1" });

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: null
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("Internal review readiness snapshot is required");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { checkedRevision: 7, blocking: ["合同金额缺失"], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("Internal review readiness has blocking errors");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { checkedRevision: 6, blocking: [], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("Internal review readiness revision is stale");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { blockingErrors: [], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).resolves.toMatchObject({ id: "document-1" });
  });

  it("rejects non-editable versions and layouts for another contract type", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "in_approval"
    });

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("Contract version is not editable");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "approval_rejected"
    });
    tx.contractLayoutTemplate.findUnique.mockResolvedValue({
      id: "layout-template-1",
      contractTypeKey: "labor"
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("Layout template contract type does not match");
  });

  it("returns the active winner of an idempotency race without queue audit", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.create.mockRejectedValue({ code: "P2002" });
    const { service, prisma } = makeService(tx);
    (
      prisma.contractGeneratedDocument.findUnique as jest.Mock
    ).mockResolvedValue({
      id: "winner",
      status: "queued"
    });

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "winner" });
    expect(audit.record).not.toHaveBeenCalled();

    (
      prisma.contractGeneratedDocument.findUnique as jest.Mock
    ).mockResolvedValue({
      id: "failed-winner",
      status: "failed"
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("Failed document must be retried");
  });

  it("stores JSON-safe bill values without bigint or Decimal objects", async () => {
    const decimal = (value: string) => ({
      toString: () => value,
      toJSON: () => value
    });
    const tx = makeTx();
    tx.contractBill.findMany.mockResolvedValue([
      { id: "bill-1", billKey: "materials" }
    ]);
    tx.contractBillRow.findMany.mockResolvedValue([
      {
        contractBillId: "bill-1",
        itemCode: null,
        itemName: "钢筋",
        specification: null,
        unit: "吨",
        quantity: decimal("2.5"),
        unitPrice: decimal("3500"),
        taxRate: decimal("0.13"),
        taxInclusiveAmountCents: 875_000n,
        taxExclusiveAmountCents: 774_336n,
        taxAmountCents: 100_664n,
        isProvisional: true,
        settlementBasis: null,
        customData: { checked: false }
      }
    ]);
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const snapshot = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot;
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.renderInput.values["bill.materials"][0]).toMatchObject({
      quantity: "2.5",
      unitPrice: "3500",
      isProvisional: "true",
      checked: "false"
    });
  });

  it("marks failure retryable and records retry audit", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique
      .mockResolvedValueOnce({
        id: "document-1",
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        status: "failed",
        inputSnapshot: { attachmentFiles: [] }
      })
      .mockResolvedValueOnce({ id: "document-1", status: "queued" });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).resolves.toMatchObject({
      status: "queued"
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "failed", sourceRevision: 7 },
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

  it("revalidates retry gates and attachment authorization in the transaction", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "internal_review",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: {
        attachmentFiles: [
          {
            id: "attachment-a",
            originalName: "附件A.pdf",
            mimeType: "application/pdf"
          }
        ]
      }
    });
    const { service } = makeService(tx);

    await service.retry("document-1", "owner-1");

    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "attachment-a",
      "owner-1"
    );
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        draftRevision: 7,
        status: { in: ["draft", "approval_rejected"] }
      },
      data: { draftRevision: { increment: 0 } }
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-1",
        ownerUserId: "owner-1",
        voidedAt: null
      },
      data: { ownerUserId: "owner-1" }
    });
  });

  it("rejects retry when the layout or version gate is no longer valid", async () => {
    const tx = makeTx();
    const failed = {
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { attachmentFiles: [] }
    };
    tx.contractGeneratedDocument.findUnique.mockResolvedValue(failed);
    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      layoutTemplateId: "layout-template-1",
      status: "disabled"
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "Layout template version must be published"
    );

    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      layoutTemplateId: "layout-template-1",
      status: "published"
    });
    tx.contractVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "Contract document revision/status conflict"
    );
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "queued" })
      })
    );
  });

  it("does not retry when attachment authorization has been revoked", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: {
        attachmentFiles: [{ id: "attachment-a" }]
      }
    });
    files.assertCanDownloadFile.mockRejectedValueOnce(
      new ForbiddenException("File access denied")
    );
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "File access denied"
    );
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });
});
