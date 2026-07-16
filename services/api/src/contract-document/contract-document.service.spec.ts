import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ContractDocumentService, requiredPlaceholderKeys } from "./contract-document.service";

describe("ContractDocumentService", () => {
  const audit = { record: jest.fn() };
  const files = {
    assertCanDownloadFile: jest.fn(),
    linkFileReplacement: jest.fn()
  };
  const docxMime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  beforeEach(() => {
    audit.record.mockReset();
    files.linkFileReplacement.mockReset().mockResolvedValue(undefined);
    files.assertCanDownloadFile.mockReset().mockImplementation(
      (_tx, id: string) =>
        Promise.resolve({
          id,
          originalName: id.startsWith("revision-file")
            ? "线下修订稿.docx"
            : id === "attachment-a"
              ? "附件A.pdf"
              : "附件B.png",
          mimeType: id.startsWith("revision-file")
            ? docxMime
            : id === "attachment-a"
              ? "application/pdf"
              : "image/png"
        })
    );
  });

  it("does not require bill loop columns as top-level render values", () => {
    const keys = requiredPlaceholderKeys({
      fields: [{ key: "deliveryLocation", required: true }],
      bills: [
        {
          key: "materials",
          columns: [{ key: "itemName", required: true }]
        }
      ]
    });

    expect(keys).toContain("field.deliveryLocation");
    expect(keys).not.toContain("itemName");
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
          invoiceType: "vat_special",
          defaultTaxRatePercent: { toString: () => "13" },
          draftData: { projectName: "建设项目一期", deliveryLocation: "项目现场" },
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
          temporaryCode: "草稿-001",
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
            roleKey: "party_a",
            displayOrder: 0,
            snapshot: { name: "建工智管建设有限公司" }
          },
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
      contractOfflineRevision: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "offline-revision-1",
          createdAt: new Date("2026-06-30T10:00:00.000Z"),
          confirmedAt: new Date("2026-06-30T10:00:00.000Z"),
          ...data
        })),
        findMany: jest.fn().mockResolvedValue([
          { id: "revision-new", createdAt: new Date("2026-06-30T10:00:00.000Z") },
          { id: "revision-old", createdAt: new Date("2026-06-30T09:00:00.000Z") }
        ])
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
          outputBaseName: "草稿-001-草稿-修订7",
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
              "field.invoiceType": "增值税专用发票",
              "field.taxRatePercent": "13%",
              "field.projectName": "建设项目一期",
              "field.deliveryLocation": "项目现场",
              "party.owner.name": "建工智管建设有限公司",
              "party.party_b.name": "示例供应商",
              "party.counterparty.name": "示例供应商",
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
    ).rejects.toThrow("请先完成合同资料齐全性检查，再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { checkedRevision: 7, blocking: ["合同金额缺失"], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("合同资料仍有阻断项，请处理后再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { checkedRevision: 6, blocking: [], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("合同资料检查结果已过期，请重新检查后再生成内部送审稿");

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
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");

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
    ).rejects.toThrow("所选合同版式与当前合同类型不匹配，请重新选择");
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
    ).rejects.toThrow("上一次文档生成失败，请先重试失败记录");
  });

  it("stores JSON-safe bill values without bigint or Decimal objects", async () => {
    const decimal = (value: string) => ({
      toString: () => value,
      toFixed: (scale?: number) => Number(value).toFixed(scale ?? 0),
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
        taxRate: decimal("13"),
        taxInclusiveAmountCents: 875_000n,
        taxExclusiveAmountCents: 774_336n,
        taxAmountCents: 100_664n,
        isProvisional: true,
        settlementBasis: null,
        customData: { checked: false, unitPrice: "3500.0000", taxRatePercent: "13" }
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
      unitPrice: "3500.00",
      taxInclusiveUnitPrice: "3500.00",
      taxExclusiveUnitPrice: "3097.35",
      taxRatePercent: "13%",
      taxInclusiveAmount: "8,750.00",
      taxExclusiveAmount: "7,743.36",
      taxAmount: "1,006.64",
      isProvisional: "true",
      checked: "false"
    });
  });

  it("uses normative version tax facts instead of stale workbench mirror fields", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          amountCents: 1_000_000n,
          invoiceType: "vat_general",
          defaultTaxRatePercent: { toString: () => "9" },
          draftData: {
            fieldValues: {
              projectName: "前端录入项目",
              taxRatePercent: "13",
              invoiceType: "增值税专用发票"
            }
          },
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const snapshot = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot;
    expect(snapshot.renderInput.values).toMatchObject({
      "field.projectName": "前端录入项目",
      "field.taxRatePercent": "9%",
      "field.invoiceType": "增值税普通发票"
    });
  });

  it("renders historical unknown tax and bill facts as dashes without recalculating amounts", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          amountCents: 1_000_000n,
          invoiceType: null,
          defaultTaxRatePercent: null,
          draftData: {},
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractBill.findMany.mockResolvedValue([
      { id: "bill-1", billKey: "materials" }
    ]);
    tx.contractBillRow.findMany.mockResolvedValue([
      {
        contractBillId: "bill-1",
        itemCode: null,
        itemName: "历史未定价项目",
        specification: null,
        unit: "项",
        quantity: null,
        unitPrice: null,
        taxRate: null,
        taxInclusiveAmountCents: null,
        taxExclusiveAmountCents: null,
        taxAmountCents: null,
        isProvisional: false,
        settlementBasis: null,
        customData: {}
      }
    ]);
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const values = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot.renderInput.values;
    expect(values).toMatchObject({
      "field.invoiceType": "—",
      "field.taxRatePercent": "—"
    });
    expect(values["bill.materials"][0]).toMatchObject({
      quantity: "—",
      unitPrice: "—",
      taxInclusiveUnitPrice: "—",
      taxExclusiveUnitPrice: "—",
      taxRatePercent: "—",
      taxInclusiveAmount: "—",
      taxExclusiveAmount: "—",
      taxAmount: "—"
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
      "所选合同版式尚未发布，请重新选择已发布版式"
    );

    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      layoutTemplateId: "layout-template-1",
      status: "published"
    });
    tx.contractVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "合同文档状态已变化，请刷新后重试"
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

  it("lets the owner upload an offline revision for an editable draft version", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.uploadOfflineRevision("version-1", "owner-1", {
      fileId: "revision-file-1",
      label: "线下磋商稿",
      note: "按对方意见修订",
      confirmationStatementAccepted: true
    });

    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "revision-file-1",
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
    expect(tx.contractOfflineRevision.create).toHaveBeenCalledWith({
      data: {
        contractVersionId: "version-1",
        sourceGeneratedDocumentId: null,
        fileId: "revision-file-1",
        label: "线下磋商稿",
        note: "按对方意见修订",
        confirmedByUserId: "owner-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.document.offline_revision.confirm",
        businessType: "contract_offline_revision",
        businessId: "offline-revision-1",
        metadata: {
          contractVersionId: "version-1",
          fileId: "revision-file-1",
          sourceGeneratedDocumentId: null,
          newFileId: "revision-file-1",
          oldFileId: null,
          replacementKind: null
        }
      })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "offline-revision-1",
      fileId: "revision-file-1",
      label: "线下磋商稿"
    });
  });

  it("rejects offline revision upload from a non-owner through the owned version gate", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "other-user", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("只有合同经办人可以管理合同文档");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
  });

  it("does not create an offline revision when file authorization is revoked", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockRejectedValueOnce(
      new ForbiddenException("File access denied")
    );
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("File access denied");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("requires offline revision uploads to be DOCX documents", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockResolvedValueOnce({
      id: "revision-pdf",
      originalName: "线下修订稿.pdf",
      mimeType: "application/pdf"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-pdf",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("线下修订稿必须上传 DOCX 文档");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("accepts DOCX offline revisions by filename when MIME is odd", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockResolvedValueOnce({
      id: "revision-file-odd-mime",
      originalName: "线下修订稿.DOCX",
      mimeType: "application/octet-stream"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-odd-mime",
        confirmationStatementAccepted: true
      })
    ).resolves.toMatchObject({ fileId: "revision-file-odd-mime" });
  });

  it("rejects offline revision upload when status gates race", async () => {
    const tx = makeTx();
    tx.contractVersion.updateMany.mockResolvedValueOnce({ count: 0 });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("合同草稿状态已变化，请刷新后重试");
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("rejects offline revision upload for non-editable contract versions", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "in_approval"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
  });

  it("requires the source generated document to belong to the same contract version", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-other",
      contractVersionId: "version-other"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-other",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow(
      "所选来源文档不属于当前合同版本"
    );
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("links a successful generated DOCX before recording its offline revision", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 7,
      docxFileId: "generated-docx-1"
    });
    const { service } = makeService(tx);

    await service.uploadOfflineRevision("version-1", "owner-1", {
      fileId: "revision-file-1",
      sourceGeneratedDocumentId: "document-1",
      confirmationStatementAccepted: true
    });

    expect(files.linkFileReplacement).toHaveBeenCalledWith(tx, {
      newFileId: "revision-file-1",
      oldFileId: "generated-docx-1",
      actorUserId: "owner-1"
    });
    expect(files.linkFileReplacement.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractOfflineRevision.create.mock.invocationCallOrder[0]
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: {
          contractVersionId: "version-1",
          fileId: "revision-file-1",
          sourceGeneratedDocumentId: "document-1",
          newFileId: "revision-file-1",
          oldFileId: "generated-docx-1",
          replacementKind: "contract_offline_revision_from_generated_docx"
        }
      })
    );
  });

  it.each([
    { status: "queued", docxFileId: "generated-docx-1", reason: "not successful" },
    { status: "success", docxFileId: null, reason: "missing DOCX" }
  ])("rejects a generated source that is $reason", async ({ status, docxFileId }) => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status,
      sourceRevision: 7,
      docxFileId
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("所选来源文档尚未生成成功或缺少 DOCX 文件");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not create or audit an offline revision when replacement linking fails", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 7,
      docxFileId: "generated-docx-1"
    });
    files.linkFileReplacement.mockRejectedValueOnce(
      new ForbiddenException("当前账号无权接入该文件替换链")
    );
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("当前账号无权接入该文件替换链");
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a successful generated DOCX from an older draft revision", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-old-revision",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 6,
      docxFileId: "generated-docx-old"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-old-revision",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("所选来源文档已过期，请重新生成后再上传");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lists offline revisions newest first after the owned version gate", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(service.listOfflineRevisions("version-1", "owner-1")).resolves.toEqual([
      { id: "revision-new", createdAt: new Date("2026-06-30T10:00:00.000Z") },
      { id: "revision-old", createdAt: new Date("2026-06-30T09:00:00.000Z") }
    ]);
    expect(tx.contractOfflineRevision.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  });
});
