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

import { PrismaService } from "../database/prisma.service";
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
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "layout-1", status: "draft" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", draftRevision: 3 })
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { draftRevision: 3, status: "draft" }
      ]),
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
      linkFileReplacement: jest.fn().mockResolvedValue(undefined)
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
      linkFileReplacement: jest.fn().mockResolvedValue(undefined)
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
      linkFileReplacement: jest.fn()
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
      []
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

  it.each(["success", "stale"])(
    "links DOCX then PDF to the nearest %s predecessor after the success CAS",
    async (predecessorStatus) => {
      const prisma = makePrisma();
      prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
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

  it("records failure and skips PDF linking when DOCX replacement linking fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
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
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
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
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
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
      where: { id: "preview-1", status: "processing" },
      data: {
        status: "succeeded",
        previewPdfFileId: "preview-pdf",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("marks failure with a bounded error and records possible orphan uploads", async () => {
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
        .mockRejectedValueOnce(new Error("x".repeat(3_000)))
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    const failure = prisma.tx.contractGeneratedDocument.updateMany.mock.calls[0][0];
    expect(failure.where).toEqual({ id: "document-1", status: "processing" });
    expect(failure.data.status).toBe("failed");
    expect(failure.data.errorMessage).toHaveLength(2_000);
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
      linkFileReplacement: jest.fn()
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
      linkFileReplacement: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.$queryRaw).toHaveBeenCalledTimes(1);
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
      linkFileReplacement: jest.fn()
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
      uploadPrivateFile: jest.fn()
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
      sampleData: { values: { "bill.materials": "not-an-array" } },
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
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
      where: { id: "preview-1", status: "processing" },
      data: {
        status: "failed",
        errorMessage: "Preview bill value must be an array: bill.materials",
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
