import { ConflictException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ContractDocumentService, requiredPlaceholderKeys } from "./contract-document.service";

describe("ContractDocumentService", () => {
  const documentContentFingerprint = "a".repeat(64);
  const documentContentCoordinates = {
    documentContentRevision: 3,
    documentContentFingerprint
  };
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
      $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1"
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", contractId: "contract-1" }];
        }
        if (sql.includes('AS "hasSignedFormalFile"')) {
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
        if (sql.includes('FROM "CompanyEntity"')) {
          return [{ id: "entity-1" }];
        }
        return [];
      }),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          layoutTemplateVersionId: "layout-1",
          amountCents: 1_000_000n,
          invoiceType: "vat_special",
          defaultTaxRatePercent: { toString: () => "13" },
          draftData: { projectName: "建设项目一期", deliveryLocation: "项目现场" },
          clauseSnapshot: [
            { key: "payment", content: { text: "结算后付款" } }
          ],
          readinessSnapshot: {
            checkedRevision: 7,
            checkedDocumentContentRevision: 3,
            checkedDocumentContentFingerprint: documentContentFingerprint,
            blocking: [],
            warnings: []
          }
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
      contractNumberTombstone: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
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
      contractDraftAttachment: {
        findMany: jest.fn().mockResolvedValue([
          { fileId: "attachment-a" }
        ])
      },
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
    const businessNumbers = {
      allocateDaily: jest.fn().mockResolvedValue("HT-20260806-007")
    };
    return {
      service: new ContractDocumentService(
        prisma,
        audit as never,
        files as never,
        businessNumbers as never
      ),
      prisma,
      businessNumbers
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
          documentContentRevision: 3,
          documentContentFingerprint,
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
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.document.queue",
        metadata: expect.objectContaining({
          sourceRevision: 7,
          documentContentRevision: 3,
          documentContentFingerprint
        })
      })
    );
    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "attachment-a",
      "owner-1"
    );
  });

  it("allocates and locks a formal contract code on first external-file generation", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    const result = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: ["attachment-a"]
    });

    expect(result).toMatchObject({ id: "document-1", status: "queued", purpose: "external" });
    expect(businessNumbers.allocateDaily).toHaveBeenCalledWith(tx, "HT");
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: { id: "contract-1", code: null, voidedAt: null },
      data: { code: "HT-20260806-007" }
    });
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "external",
        inputSnapshot: expect.objectContaining({
          outputBaseName: "HT-20260806-007-外发合同-修订7",
          renderInput: {
            values: expect.objectContaining({
              "contract.code": "HT-20260806-007",
              "document.watermark": ""
            })
          }
        })
      })
    });
  });

  it("refuses a tombstoned formal code before external-file generation writes it", async () => {
    const tx = makeTx({
      contractNumberTombstone: {
        findUnique: jest.fn().mockResolvedValue({ id: "tombstone-1" })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    const failure = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: []
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "CONTRACT_FORMAL_CODE_TOMBSTONED"
    });
    expect(businessNumbers.allocateDaily).toHaveBeenCalledWith(tx, "HT");
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("reuses the locked formal code on repeated external-file generation", async () => {
    const tx = makeTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          name: "钢材采购合同",
          contractTypeKey: "materials",
          temporaryCode: "草稿-001",
          code: "HT-20260806-007"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "external",
        inputSnapshot: expect.objectContaining({
          renderInput: {
            values: expect.objectContaining({
              "contract.code": "HT-20260806-007",
              "document.watermark": ""
            })
          }
        })
      })
    });
  });

  it("keeps the legacy draft watermark without allocating a formal code", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "draft",
        inputSnapshot: expect.objectContaining({
          renderInput: {
            values: expect.objectContaining({
              "document.watermark": "草稿"
            })
          }
        })
      })
    });
  });

  it("rejects external generation when the code allocation gate is contested, without creating a document", async () => {
    const tx = makeTx();
    tx.contract.updateMany.mockResolvedValue({ count: 0 });
    const { service, businessNumbers } = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "external",
        attachmentFileIds: []
      })
    ).rejects.toThrow("合同正式编号");

    expect(businessNumbers.allocateDaily).toHaveBeenCalledTimes(1);
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("keeps legacy generation purposes accepted during the extension period", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "internal_review",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purpose: "internal_review" })
    });
  });

  it("lists legacy and external generated documents for read compatibility", async () => {
    const baseTx = makeTx();
    const tx = makeTx({
      contractGeneratedDocument: {
        ...baseTx.contractGeneratedDocument,
        findMany: jest.fn().mockResolvedValue([
          { id: "old-draft", purpose: "draft", status: "success" },
          { id: "external", purpose: "external", status: "success" }
        ])
      }
    });
    const { service } = makeService(tx);

    const result = await service.list("version-1", "owner-1");

    expect(result.map((document) => document.purpose)).toEqual(["draft", "external"]);
  });

  it("reuses the locked code snapshot when retrying a failed external generation", async () => {
    const failedDocument = {
      id: "document-1",
      contractVersionId: "version-1",
      status: "failed",
      purpose: "external",
      sourceRevision: 7,
      layoutTemplateVersionId: "layout-1",
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file-1",
        outputBaseName: "HT-20260806-007-外发合同-修订7",
        renderInput: {
          values: {
            "contract.code": "HT-20260806-007",
            "document.watermark": ""
          }
        },
        requiredKeys: [],
        attachmentFiles: []
      }
    };
    const tx = makeTx({
      contractGeneratedDocument: {
        ...makeTx().contractGeneratedDocument,
        findUnique: jest.fn().mockResolvedValue(failedDocument),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    await service.retry("document-1", "owner-1");

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "document-1", status: "failed" }),
      data: expect.objectContaining({ status: "queued" })
    });
  });

  it("keeps and exposes a successful preview across metadata-only revisions", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findMany.mockResolvedValue([{
      id: "document-1",
      purpose: "draft",
      status: "success",
      sourceRevision: 6,
      inputSnapshot: documentContentCoordinates
    }]);
    const { service } = makeService(tx);

    await expect(service.list("version-1", "owner-1")).resolves.toEqual([
      expect.objectContaining({
        id: "document-1",
        status: "success",
        sourceRevision: 6,
        ...documentContentCoordinates
      })
    ]);

    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("keeps historical takeover document listing read-only when company facts drift", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await expect(service.list("version-1", "owner-1")).resolves.toEqual([]);

    expect(tx.companyEntity.findUnique).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("queues the saved current revision as an idempotent draft preview command", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).resolves.toEqual({
      generationId: "document-1",
      status: "queued",
      sourceRevision: 7,
      documentContentRevision: 3,
      documentContentFingerprint
    });
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        inputSnapshot: expect.objectContaining({
          documentContentRevision: 3,
          documentContentFingerprint,
          attachmentFiles: [expect.objectContaining({ id: "attachment-a" })]
        })
      })
    });
    expect(tx.contractDraftAttachment.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }],
      select: { fileId: true }
    });
  });

  it("rejects generic preview generation for a historical takeover version", async () => {
    const tx = makeTx();
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      changeType: "historical_takeover",
      draftRevision: 7
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toThrow("历史接管工作台");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("blocks relation-only takeover before queueing a generic preview", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockImplementation(
      async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            changeType: "original",
            hasHistoricalTakeoverRelation: true
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1" }];
        }
        if (sql.includes('AS "hasSignedFormalFile"')) {
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
        return [];
      }
    );
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toMatchObject({
      response: {
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects draft preview generation after downstream business makes the draft formal", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockImplementation(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes("FOR UPDATE OF cv")) {
        return [{
          id: "version-1",
          contractId: "contract-1"
        }];
      }
      if (sql.includes("FOR UPDATE OF c")) {
        return [{ id: "contract-1", contractId: "contract-1" }];
      }
      if (sql.includes('AS "hasSignedFormalFile"')) {
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: true,
          hasPaymentRequest: true
        }];
      }
      if (sql.includes('FROM "CompanyEntity"')) {
        return [{ id: "entity-1" }];
      }
      return [];
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toThrow("正式业务事实");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("rejects preview generation for a revision that is not the current saved draft", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 6
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "DRAFT_REVISION_CONFLICT",
        latestRevision: 7
      })
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("replays the same draft preview generation for version, revision, layout and purpose", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-existing",
      status: "success",
      sourceRevision: 7,
      inputSnapshot: {
        documentContentRevision: 3,
        documentContentFingerprint
      }
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).resolves.toEqual({
      generationId: "document-existing",
      status: "success",
      sourceRevision: 7,
      documentContentRevision: 3,
      documentContentFingerprint
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("reuses the same preview identity after a metadata-only aggregate revision", async () => {
    const firstTx = makeTx();
    const firstVersion = await firstTx.contractVersion.findUnique();
    const { service: firstService } = makeService(firstTx);
    await firstService.queueDraftPreview("version-1", "owner-1", {
      sourceRevision: 7
    });

    const secondTx = makeTx();
    secondTx.contractVersion.findUnique.mockResolvedValue({
      ...firstVersion,
      draftRevision: 8
    });
    const { service: secondService } = makeService(secondTx);
    await secondService.queueDraftPreview("version-1", "owner-1", {
      sourceRevision: 8
    });

    expect(firstTx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: secondTx.contractGeneratedDocument.create.mock.calls[0]?.[0].data
          .idempotencyKey
      })
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
      readinessSnapshot: {
        checkedRevision: 7,
        checkedDocumentContentRevision: 3,
        checkedDocumentContentFingerprint: documentContentFingerprint,
        blocking: ["合同金额缺失"],
        warnings: []
      }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("合同资料仍有阻断项，请处理后再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      draftRevision: 8,
      readinessSnapshot: {
        checkedRevision: 7,
        checkedDocumentContentRevision: 3,
        checkedDocumentContentFingerprint: documentContentFingerprint,
        blocking: [],
        warnings: []
      }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).resolves.toMatchObject({ id: "document-1" });

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      draftRevision: 8,
      readinessSnapshot: {
        checkedRevision: 8,
        checkedDocumentContentRevision: 2,
        checkedDocumentContentFingerprint: "b".repeat(64),
        blocking: [],
        warnings: []
      }
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
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "draft"
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
      taxExclusiveUnitPrice: "3097.344000",
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
          ...documentContentCoordinates,
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

  it("uses structured draft company facts before legacy party_a", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 3
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          amountCents: 1_000_000n,
          invoiceType: "vat_special",
          defaultTaxRatePercent: { toString: () => "13" },
          draftData: {
            companyEntitySelection: {
              id: "entity-1",
              versionId: "entity-version-3",
              versionNo: 3,
              name: "结构化我方主体",
              unifiedSocialCreditCode: "91350211M000100Y46",
              registeredAddress: "昆明市"
            }
          },
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] },
          companyEntityIdSnapshot: null,
          companyEntityVersionId: null,
          companyEntityNameSnapshot: null,
          companyEntityCreditCodeSnapshot: null,
          companyEntityRegisteredAddressSnapshot: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const values = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot.renderInput.values;
    expect(values["party.owner.name"]).toBe("结构化我方主体");
    expect(values["party.owner.name"]).not.toBe("建工智管建设有限公司");
  });

  it("blocks document queue and stales active documents when the selected company version drifts", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, prisma } = makeService(tx);
    let committed = false;
    jest.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result as never;
    });

    await expect(service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    })).rejects.toThrow("所选我方公司主体资料已更新或不再可用");

    expect(committed).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(
      tx.$queryRaw.mock.calls.some(
        ([query]: [{ strings?: readonly string[] }]) =>
          (query.strings?.join(" ") ?? "").includes('FROM "CompanyEntity"')
      )
    ).toBe(true);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("marks an existing successful document stale when list detects company drift", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.list("version-1", "owner-1");

    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
  });

  it("uses only the frozen company snapshot after submission and keeps legacy fallback historical", () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const renderer = service as unknown as {
      renderValues: (
        contract: { name: string; temporaryCode: string | null; code: string | null },
        version: Record<string, unknown>,
        parties: Array<{ roleKey: string; snapshot: Record<string, unknown> }>,
        bills: [],
        purpose: "draft"
      ) => Record<string, unknown>;
    };
    const contract = { name: "合同", temporaryCode: "草稿-1", code: null };
    const baseVersion = {
      status: "in_approval",
      amountCents: 1_000_000n,
      invoiceType: "vat_special",
      defaultTaxRatePercent: { toString: () => "13" },
      draftData: {
        companyEntitySelection: {
          id: "entity-current",
          versionId: "entity-version-current",
          versionNo: 9,
          name: "提交后漂移名称",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: "新地址"
        }
      },
      clauseSnapshot: [],
      companyEntityIdSnapshot: "entity-frozen",
      companyEntityVersionId: "entity-version-3",
      companyEntityNameSnapshot: "冻结名称",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: "冻结地址"
    };
    const parties = [{ roleKey: "party_a", snapshot: { name: "历史甲方" } }];

    const frozen = renderer.renderValues(contract, baseVersion, parties, [], "draft");
    expect(frozen["party.owner.name"]).toBe("冻结名称");

    const frozenDraft = renderer.renderValues(contract, {
      ...baseVersion,
      status: "draft",
      draftData: {}
    }, parties, [], "draft");
    expect(frozenDraft["party.owner.name"]).toBe("冻结名称");

    const historical = renderer.renderValues(contract, {
      ...baseVersion,
      draftData: {},
      companyEntityIdSnapshot: null,
      companyEntityVersionId: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      companyEntityRegisteredAddressSnapshot: null
    }, parties, [], "draft");
    expect(historical["party.owner.name"]).toBe("历史甲方");

    expect(() => renderer.renderValues(contract, {
      ...baseVersion,
      companyEntityIdSnapshot: null,
      companyEntityVersionId: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      companyEntityRegisteredAddressSnapshot: null
    }, parties, [], "draft")).toThrow("合同已提交但我方主体冻结快照缺失");
  });

  it("renders historical unknown tax and bill facts as dashes without recalculating amounts", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
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
        inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
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
      expect.objectContaining({
        action: "contract.document.retry",
        metadata: documentContentCoordinates
      })
    );
  });

  it("retries a failed document after a metadata-only aggregate revision", async () => {
    const tx = makeTx();
    const currentVersion = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...currentVersion,
      draftRevision: 8
    });
    tx.contractGeneratedDocument.findUnique
      .mockResolvedValueOnce({
        id: "document-1",
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        status: "failed",
        inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
      })
      .mockResolvedValueOnce({ id: "document-1", status: "queued" });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).resolves.toMatchObject({
      status: "queued"
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "failed", sourceRevision: 7 },
      data: expect.objectContaining({ status: "queued" })
    });
  });

  it("rejects retry when the frozen document content no longer matches", async () => {
    const tx = makeTx();
    const currentVersion = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...currentVersion,
      documentContentRevision: 4,
      documentContentFingerprint: "b".repeat(64)
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "该合同文档对应的文书内容已过期，请重新生成"
    );
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "queued" }) })
    );
  });

  it("rejects retry for a historical takeover without writes or audit", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {}
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { attachmentFiles: [] }
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "历史接管工作台"
    );

    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("commits stale documents and denies retry when the selected company version drifts", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { attachmentFiles: [] }
    });
    const { service, prisma } = makeService(tx);
    let committed = false;
    jest.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result as never;
    });

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "所选我方公司主体资料已更新或不再可用"
    );

    expect(committed).toBe(true);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "queued" }) })
    );
    expect(tx.contractLayoutTemplateVersion.findUnique).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalledWith(
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
        ...documentContentCoordinates,
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
        status: { in: ["draft"] }
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
      inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
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
        ...documentContentCoordinates,
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
        status: { in: ["draft"] }
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

  it("rejects offline revision upload for a historical takeover without writes or audit", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {}
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("历史接管工作台");

    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
