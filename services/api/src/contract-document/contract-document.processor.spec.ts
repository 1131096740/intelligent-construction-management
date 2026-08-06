jest.mock("./contract-docx-renderer", () => ({
  renderContractDocx: jest.fn(() => Buffer.from("rendered-docx"))
}));
jest.mock("./libreoffice-converter", () => ({
  convertDocxToPdf: jest.fn(async () => Buffer.from("%PDF-converted"))
}));
jest.mock("./docx-attachment-appender", () => ({
  appendDocxImageAttachments: jest.fn(() => Buffer.from("docx-with-image-attachments"))
}));
jest.mock("./pdf-normalizer", () => ({
  normalizeContractPdf: jest.fn(async () => ({
    buffer: Buffer.from("%PDF-normalized"),
    pageCount: 2,
    pageSizes: ["A4_portrait", "A4_landscape"],
    warnings: []
  }))
}));
jest.mock("./contract-docx-extractor", () => ({
  extractContractDocx: jest.fn((buffer: Buffer) => ({
    blocks: [{ kind: "paragraph", path: "p:000001", text: buffer.toString() }],
    normalizedSha256: buffer.toString()
  }))
}));
jest.mock("./contract-document-comparison", () => ({
  compareContractDocumentSnapshots: jest.fn(() => ({
    algorithmVersion: "contract-docx-patience-v1",
    baseNormalizedSha256: "base-hash",
    revisionNormalizedSha256: "revision-hash",
    differences: [
      {
        differenceKey: "difference-key",
        sortOrder: 1,
        changeType: "replace",
        kind: "paragraph",
        locationPath: "p:000001",
        basePath: "p:000001",
        revisedPath: "p:000001",
        beforeText: "before",
        afterText: "after",
        candidate: null
      }
    ]
  }))
}));

import { PrismaService } from "../database/prisma.service";
import { extractContractDocx } from "./contract-docx-extractor";
import { renderContractDocx } from "./contract-docx-renderer";
import { appendDocxImageAttachments } from "./docx-attachment-appender";
import { ContractDocumentProcessor } from "./contract-document.processor";
import { convertDocxToPdf } from "./libreoffice-converter";
import { normalizeContractPdf } from "./pdf-normalizer";

const mockedRender = renderContractDocx as jest.MockedFunction<typeof renderContractDocx>;
const mockedAppendDocxAttachments = appendDocxImageAttachments as jest.MockedFunction<
  typeof appendDocxImageAttachments
>;
const mockedConvert = convertDocxToPdf as jest.MockedFunction<typeof convertDocxToPdf>;
const mockedNormalize = normalizeContractPdf as jest.MockedFunction<
  typeof normalizeContractPdf
>;
const mockedExtract = extractContractDocx as jest.MockedFunction<
  typeof extractContractDocx
>;

describe("ContractDocumentProcessor", () => {
  const audit = { record: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRender.mockReturnValue(Buffer.from("rendered-docx"));
    mockedAppendDocxAttachments.mockReturnValue(
      Buffer.from("docx-with-image-attachments")
    );
    mockedConvert.mockResolvedValue(Buffer.from("%PDF-converted"));
    mockedNormalize.mockResolvedValue({
      buffer: Buffer.from("%PDF-normalized"),
      pageCount: 2,
      pageSizes: ["A4_portrait", "A4_landscape"],
      warnings: []
    });
    mockedExtract.mockImplementation((buffer) => ({
      blocks: [{ kind: "paragraph", path: "p:000001", text: buffer.toString() }],
      normalizedSha256: buffer.toString()
    }));
  });

  function makePrisma() {
    const tx = {
      contractLayoutPreviewJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      contractOfflineRevision: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentComparison: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentDifference: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractNegotiationRound: {
        findUnique: jest.fn().mockResolvedValue({ id: "round-1", status: "open" })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "layout-1", status: "draft", draftRevision: 2 })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", draftRevision: 3 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      $queryRaw: jest.fn().mockImplementation(
        async (query: { strings?: string[] }) => {
          const sql = query.strings?.join(" ") ?? "";
          if (sql.includes("FOR UPDATE OF cv")) {
            return [{
              id: "version-1",
              contractId: "contract-1",
              draftRevision: 3,
              status: "draft",
              changeType: "original",
              draftData: {}
            }];
          }
          if (sql.includes("FOR UPDATE OF c")) {
            return [{
              id: "contract-1",
              ownerUserId: "owner-1",
              voidedAt: null
            }];
          }
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
      ),
      auditLog: { create: jest.fn() }
    };
    return {
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractGeneratedDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractOfflineRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentComparison: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractVersion: { findUnique: jest.fn() },
      contractNegotiationRound: { findUnique: jest.fn() },
      contractLayoutTemplateVersion: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      ),
      tx
    };
  }

  function queuedDocument(overrides: Record<string, unknown> = {}) {
    return {
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date(),
      ...overrides
    };
  }

  function generatedDocumentFiles() {
    return {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
  }

  it("claims one queued job atomically and marks it processing", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "queued" },
      data: {
        status: "processing",
        startedAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("converts an offline revision to PDF and persists its deterministic differences", async () => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      previewPdfFileId: "previous-preview-pdf",
      label: "第一轮修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(null);
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      clauseSnapshot: []
    });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    prisma.tx.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open"
    });
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 7,
            status: "draft",
            changeType: "original"
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    (prisma as unknown as { contractGeneratedDocument: { findUnique: jest.Mock } })
      .contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
        id: "document-source",
        contractVersionId: "version-1",
        sourceRevision: 7,
        docxFileId: "source-docx"
      });
    const files = {
      getFileBuffer: jest.fn()
        .mockResolvedValueOnce({ buffer: Buffer.from("revision") })
        .mockResolvedValueOnce({ buffer: Buffer.from("source") }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "revision-preview-pdf" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractDocumentDifference.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        comparisonId: "comparison-1",
        differenceKey: "difference-key",
        disposition: "pending"
      })]
    });
    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: expect.objectContaining({
        status: "succeeded",
        previewPdfFileId: "revision-preview-pdf"
      })
    });
    expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
      where: { id: "comparison-1", status: "processing" },
      data: expect.objectContaining({
        status: "succeeded",
        algorithmVersion: "contract-docx-patience-v1"
      })
    });
    expect(files.linkFileReplacement).toHaveBeenCalledWith(prisma.tx, {
      newFileId: "revision-preview-pdf",
      oldFileId: "previous-preview-pdf",
      actorUserId: "owner-1"
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.offline_revision.process_success" })
    );
  });

  it("fails both the PDF job and comparison closed when an offline DOCX is malformed", async () => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      label: "坏修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractVersion.findUnique.mockResolvedValue({ id: "version-1", clauseSnapshot: [] });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    (prisma as unknown as { contractGeneratedDocument: { findUnique: jest.Mock } })
      .contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
        id: "document-source",
        contractVersionId: "version-1",
        sourceRevision: 7,
        docxFileId: "source-docx"
      });
    mockedExtract.mockImplementationOnce(() => {
      throw new Error("/tmp/private/bad.docx");
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from("bad") }),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "线下修订稿解析、比较或 PDF 生成失败，请检查 DOCX 后重试"
      })
    });
    expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
      where: { id: "comparison-1", status: "processing" },
      data: expect.objectContaining({ status: "failed" })
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.offline_revision.process_failure",
        metadata: expect.not.objectContaining({ errorMessage: expect.stringContaining("/tmp") })
      })
    );
  });

  it("renders DOCX, converts PDF, normalizes attachments, uploads both files, and marks success", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockResolvedValue([
      { draftRevision: 8, status: "draft" }
    ]);
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "negotiation",
      sourceRevision: 8,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-对外磋商稿-修订8",
        renderInput: { values: { "contract.name": "合同" } },
        attachmentFiles: [
          {
            id: "attachment-file",
            originalName: "清单.pdf",
            mimeType: "application/pdf"
          },
          {
            id: "image-file",
            originalName: "营业执照.png",
            mimeType: "image/png"
          }
        ]
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest
        .fn()
        .mockResolvedValueOnce({
          file: { id: "layout-file" },
          buffer: Buffer.from("template")
        })
        .mockResolvedValueOnce({
          file: { id: "attachment-file" },
          buffer: Buffer.from("%PDF-attachment")
        })
        .mockResolvedValueOnce({
          file: { id: "image-file" },
          buffer: Buffer.from("png-attachment")
        }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).toHaveBeenCalledWith(
      Buffer.from("template"),
      { values: { "contract.name": "合同" } },
      [],
      { allowBlankWatermark: false }
    );
    expect(mockedAppendDocxAttachments).toHaveBeenCalledWith(Buffer.from("rendered-docx"), [
      {
        name: "清单.pdf",
        buffer: Buffer.from("%PDF-attachment"),
        type: "pdf"
      },
      {
        name: "营业执照.png",
        buffer: Buffer.from("png-attachment"),
        type: "png"
      }
    ]);
    expect(mockedConvert).toHaveBeenCalledWith(Buffer.from("docx-with-image-attachments"));
    expect(mockedNormalize).toHaveBeenCalledWith(Buffer.from("%PDF-converted"), [
      {
        name: "清单.pdf",
        buffer: Buffer.from("%PDF-attachment"),
        type: "pdf"
      }
    ]);
    expect(files.uploadPrivateFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        originalName: "草稿-001-对外磋商稿-修订8.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        uploadedByUserId: "owner-1",
        buffer: Buffer.from("docx-with-image-attachments"),
        sizeBytes: Buffer.from("docx-with-image-attachments").length
      })
    );
    expect(files.uploadPrivateFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        originalName: "草稿-001-对外磋商稿-修订8.pdf",
        mimeType: "application/pdf",
        uploadedByUserId: "owner-1"
      })
    );
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 8
      },
      data: expect.objectContaining({
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file",
        completedAt: expect.any(Date),
        engineVersion: "contract-document-v1",
        inputSnapshot: expect.objectContaining({
          inspection: {
            pageCount: 2,
            pageSizes: ["A4_portrait", "A4_landscape"],
            warnings: []
          }
        })
      })
    });
    expect(prisma.tx.contractGeneratedDocument.findFirst).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        purpose: "negotiation",
        sourceRevision: { lt: 8 },
        status: { in: ["success", "stale"] },
        docxFileId: { not: null },
        pdfFileId: { not: null }
      },
      orderBy: [
        { sourceRevision: "desc" },
        { createdAt: "desc" },
        { id: "desc" }
      ],
      select: {
        id: true,
        sourceRevision: true,
        status: true,
        docxFileId: true,
        pdfFileId: true
      }
    });
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.success",
        metadata: {
          docxFileId: "docx-file",
          pdfFileId: "pdf-file",
          pageCount: 2,
          predecessorDocumentId: null,
          docxOldFileId: null,
          docxNewFileId: "docx-file",
          pdfOldFileId: null,
          pdfNewFileId: "pdf-file",
          replacementKind: null
        }
      })
    );
  });

  it("renders an external document without a watermark and binds the generated files", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({
        purpose: "external",
        inputSnapshot: {
          templateFileId: "layout-file",
          outputBaseName: "HT-20260806-007-外发合同-修订3",
          renderInput: {
            values: {
              "contract.name": "钢材采购合同",
              "contract.code": "HT-20260806-007"
            }
          },
          requiredKeys: [],
          attachmentFiles: []
        }
      })
    );
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).toHaveBeenCalledWith(
      Buffer.from("template"),
      {
        values: {
          "contract.name": "钢材采购合同",
          "contract.code": "HT-20260806-007"
        }
      },
      [],
      { allowBlankWatermark: true }
    );
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document-1", status: "processing", sourceRevision: 3 },
      data: expect.objectContaining({
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file"
      })
    });
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalled();
  });

  it("marks a failed external generation without binding any file", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({
        purpose: "external",
        inputSnapshot: {
          templateFileId: "layout-file",
          outputBaseName: "HT-20260806-007-外发合同-修订3",
          renderInput: { values: {} },
          requiredKeys: [],
          attachmentFiles: []
        }
      })
    );
    mockedRender.mockImplementation(() => {
      throw new Error("合同 DOCX 模板渲染失败，请检查模板内容");
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest.fn(),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document-1", status: "processing", sourceRevision: 3 },
      data: {
        status: "failed",
        errorMessage: "合同 DOCX 模板渲染失败，请检查模板内容",
        completedAt: expect.any(Date)
      }
    });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith(
      [],
      "owner-1"
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        businessId: "document-1",
        metadata: expect.objectContaining({ orphanFileIds: [] })
      })
    );
  });

  it.each(["success", "stale"])(
    "links DOCX then PDF to the nearest %s predecessor after the success CAS",
    async (predecessorStatus) => {
      const prisma = makePrisma();
      prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
        queuedDocument({ purpose: "negotiation" })
      );
      prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
        id: "document-predecessor",
        sourceRevision: 2,
        status: predecessorStatus,
        docxFileId: "docx-file-old",
        pdfFileId: "pdf-file-old"
      });
      const files = generatedDocumentFiles();
      const processor = new ContractDocumentProcessor(
        prisma as unknown as PrismaService,
        files as never,
        audit as never
      );

      await processor.processNext();

      expect(files.linkFileReplacement).toHaveBeenNthCalledWith(1, prisma.tx, {
        newFileId: "docx-file",
        oldFileId: "docx-file-old",
        actorUserId: "owner-1"
      });
      expect(files.linkFileReplacement).toHaveBeenNthCalledWith(2, prisma.tx, {
        newFileId: "pdf-file",
        oldFileId: "pdf-file-old",
        actorUserId: "owner-1"
      });
      expect(
        prisma.tx.contractGeneratedDocument.updateMany.mock.invocationCallOrder[0]
      ).toBeLessThan(
        prisma.tx.contractGeneratedDocument.findFirst.mock.invocationCallOrder[0]
      );
      expect(
        prisma.tx.contractGeneratedDocument.findFirst.mock.invocationCallOrder[0]
      ).toBeLessThan(files.linkFileReplacement.mock.invocationCallOrder[0]);
      expect(files.linkFileReplacement.mock.invocationCallOrder[0]).toBeLessThan(
        files.linkFileReplacement.mock.invocationCallOrder[1]
      );
      expect(files.linkFileReplacement.mock.invocationCallOrder[1]).toBeLessThan(
        audit.record.mock.invocationCallOrder[0]
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma.tx,
        expect.objectContaining({
          action: "contract.document.success",
          metadata: {
            docxFileId: "docx-file",
            pdfFileId: "pdf-file",
            pageCount: 2,
            predecessorDocumentId: "document-predecessor",
            docxOldFileId: "docx-file-old",
            docxNewFileId: "docx-file",
            pdfOldFileId: "pdf-file-old",
            pdfNewFileId: "pdf-file",
            replacementKind: "contract_generated_document_revision"
          }
        })
      );
    }
  );

  it("publishes a complete draft preview atomically before superseding and discarding the previous preview", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "draft", sourceRevision: 3 })
    );
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 3,
        status: "draft",
        changeType: null,
        draftData: {},
        latestDraftPreviewDocumentId: "document-previous"
      }
    ]);
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-previous",
      sourceRevision: 2,
      status: "success",
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        draftRevision: 3,
        latestDraftPreviewDocumentId: "document-previous"
      },
      data: { latestDraftPreviewDocumentId: "document-1" }
    });
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-previous",
        status: "success",
        docxFileId: "docx-file-old",
        pdfFileId: "pdf-file-old"
      },
      data: {
        status: "superseded",
        docxFileId: null,
        pdfFileId: null
      }
    });
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith(
      ["docx-file-old", "pdf-file-old"],
      "owner-1"
    );
  });

  it("discards a newly uploaded DOCX and keeps the previous preview when PDF conversion fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "draft", sourceRevision: 3 })
    );
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 3,
        status: "draft",
        changeType: null,
        draftData: {},
        latestDraftPreviewDocumentId: "document-previous"
      }
    ]);
    mockedConvert.mockRejectedValueOnce(new Error("PDF conversion failed"));
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest.fn().mockResolvedValueOnce({ id: "docx-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(1);
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith(
      ["docx-file"],
      "owner-1"
    );
    expect(prisma.tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(prisma.tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "document-previous" })
      })
    );
  });

  it("records failure and skips PDF linking when DOCX replacement linking fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-predecessor",
      sourceRevision: 2,
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    files.linkFileReplacement.mockRejectedValueOnce(new Error("DOCX link failed"));
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("records both uploaded files as orphans when PDF replacement linking fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-predecessor",
      sourceRevision: 2,
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    files.linkFileReplacement
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("PDF link failed"));
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("rolls back terminal success and records failure when success audit fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    const files = generatedDocumentFiles();
    audit.record
      .mockRejectedValueOnce(new Error("success audit failed"))
      .mockResolvedValueOnce(undefined);
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it.each([
    { id: "", docxFileId: "docx-file-old", pdfFileId: "pdf-file-old" },
    { id: "document-predecessor", docxFileId: " ", pdfFileId: "pdf-file-old" },
    { id: "document-predecessor", docxFileId: "docx-file-old", pdfFileId: null }
  ])("fails safely when the predecessor file ids are malformed", async (predecessor) => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      sourceRevision: 2,
      ...predecessor
    });
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("renders a queued layout preview before a queued contract document and attaches its PDF", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: { contract: { name: "预览合同" } },
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      status: "queued"
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "preview-pdf" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(mockedRender).toHaveBeenCalledWith(
      Buffer.from("template"),
      expect.objectContaining({
        values: expect.objectContaining({
          "contract.name": "预览合同",
          "contract.temporaryCode": "预览",
          "document.watermark": "预览"
        })
      }),
      expect.arrayContaining([
        "contract.name",
        "contract.temporaryCode",
        "document.watermark"
      ])
    );
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: {
        status: "succeeded",
        previewPdfFileId: "preview-pdf",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("marks a preview stale when its source revision no longer matches the draft", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: {},
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 3,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    const files = { getFileBuffer: jest.fn(), uploadPrivateFile: jest.fn() };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not attach an uploaded preview when the draft changes during rendering", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: {},
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    prisma.tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 3
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from("template") }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "orphan-preview-pdf" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown Chinese error", () => new Error("合同第三方存储失败：/tmp/secret.docx")],
    [
      "throwing string conversion",
      () => ({
        toString() {
          throw new Error("TOP-SECRET toString");
        }
      })
    ],
    [
      "throwing Error.message getter",
      () => {
        const cause = new Error();
        Object.defineProperty(cause, "message", {
          get() {
            throw new Error("TOP-SECRET message getter");
          }
        });
        return cause;
      }
    ]
  ])("marks failure safely for %s and records possible orphan uploads", async (_case, cause) => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 2,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订2",
        renderInput: { values: {} },
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "orphan-docx" })
        .mockRejectedValueOnce(cause()),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    const failure = prisma.tx.contractGeneratedDocument.updateMany.mock.calls[0][0];
    expect(failure.where).toEqual({
      id: "document-1",
      status: "processing",
      sourceRevision: 2
    });
    expect(failure.data.status).toBe("failed");
    expect(failure.data.errorMessage).toBe("合同文档生成失败，请检查模板和附件后重试");
    expect(failure.data.errorMessage).not.toContain("orphan-docx");
    expect(failure.data.errorMessage).not.toContain("/tmp/secret.docx");
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({ orphanFileIds: ["orphan-docx"] })
      })
    );
  });

  it("requeues expired processing leases before claiming work", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: "processing",
        startedAt: { lt: expect.any(Date) }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
  });

  it("marks a document stale when the draft revision changes before terminal success", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockResolvedValue([
      { draftRevision: 4, status: "draft" }
    ]);
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 3
      },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(prisma.tx.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it.each([
    ["formal business evidence", false, true],
    ["an exact historical takeover relation", true, false]
  ])("marks a generated document stale when the locked draft has %s", async (
    _case,
    hasHistoricalTakeoverRelation,
    hasSignedFormalFile
  ) => {
    const prisma = makePrisma();
    const terminalQueries: string[] = [];
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        terminalQueries.push(sql);
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 3,
            status: "draft",
            changeType: "original",
            hasHistoricalTakeoverRelation,
            draftData: {}
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{
            id: "contract-1",
            ownerUserId: "owner-1",
            voidedAt: null
          }];
        }
        return [{
          hasSignedFormalFile,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument()
    );
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(terminalQueries[0]).toContain("FOR UPDATE OF c");
    expect(terminalQueries[1]).toContain("FOR UPDATE OF cv");
    expect(terminalQueries[2]).toContain('"ContractFormalFile"');
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 3
      },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(prisma.tx.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("stales an offline comparison for a relation-only historical takeover", async () => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      previewPdfFileId: null,
      label: "第一轮修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      clauseSnapshot: [],
      templateSnapshot: {}
    });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    prisma.tx.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open"
    });
    (prisma as unknown as {
      contractGeneratedDocument: { findUnique: jest.Mock };
    }).contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
      id: "document-source",
      contractVersionId: "version-1",
      sourceRevision: 7,
      docxFileId: "source-docx"
    });
    const terminalQueries: string[] = [];
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        terminalQueries.push(sql);
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 7,
            status: "draft",
            changeType: "original",
            hasHistoricalTakeoverRelation: true,
            draftData: {},
            clauseSnapshot: [],
            templateSnapshot: {}
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    const files = {
      getFileBuffer: jest.fn()
        .mockResolvedValueOnce({ buffer: Buffer.from("revision") })
        .mockResolvedValueOnce({ buffer: Buffer.from("source") }),
      uploadPrivateFile: jest.fn().mockResolvedValue({
        id: "revision-preview-pdf"
      }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(terminalQueries[0]).toContain("FOR UPDATE OF c");
    expect(terminalQueries[1]).toContain("FOR UPDATE OF cv");
    expect(prisma.tx.contractDocumentDifference.deleteMany).not.toHaveBeenCalled();
    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
      where: { id: "comparison-1", status: "processing" },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.offline_revision.process_stale"
      })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("marks a document stale when the selected company version drifts before terminal success", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 3,
            status: "draft",
            changeType: "original",
            draftData: {
              companyEntitySelection: { id: "company-1", versionNo: 1 }
            }
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        if (sql.includes('"CompanyEntity"')) {
          return [{ id: "company-1" }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.tx.companyEntity.findUnique.mockResolvedValue({
      id: "company-1",
      isActive: true,
      dataStatus: "complete",
      currentVersionNo: 2
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 3
      },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("does not audit terminal success or failure when its CAS loses", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockResolvedValue([
      { draftRevision: 3, status: "draft" }
    ]);
    prisma.tx.contractGeneratedDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.tx.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("does not audit a failure when its processing CAS loses", async () => {
    const prisma = makePrisma();
    prisma.tx.contractGeneratedDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockRejectedValue(new Error("render failed")),
      uploadPrivateFile: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects preview bill placeholders whose sample values are not arrays", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: { values: { "bill.materials": "not-an-array" } },
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: { bills: [{ key: "materials" }] },
      inspectionReport: { placeholders: ["bill.materials"] }
    });
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).not.toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: {
        status: "failed",
        errorMessage: "合同版式预览清单数据格式不正确",
        completedAt: expect.any(Date)
      }
    });
  });

  it("does not produce duplicate files when a completed job is polled again", async () => {
    const prisma = makePrisma();
    const documents = [
      {
        id: "document-1",
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file",
        completedAt: new Date()
      }
    ];
    prisma.contractGeneratedDocument.findFirst.mockImplementation(
      ({ where }: { where: { status: string } }) =>
        Promise.resolve(
          documents.find((document) => document.status === where.status) ?? null
        )
    );
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await expect(processor.processNext()).resolves.toBe(false);
    await expect(processor.processNext()).resolves.toBe(false);

    expect(prisma.contractGeneratedDocument.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.contractGeneratedDocument.findFirst).toHaveBeenCalledWith({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    expect(mockedRender).not.toHaveBeenCalled();
    expect(mockedConvert).not.toHaveBeenCalled();
    expect(mockedNormalize).not.toHaveBeenCalled();
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });
});
