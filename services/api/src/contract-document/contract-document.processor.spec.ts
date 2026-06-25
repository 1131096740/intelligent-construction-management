jest.mock("./contract-docx-renderer", () => ({
  renderContractDocx: jest.fn(() => Buffer.from("rendered-docx"))
}));
jest.mock("./libreoffice-converter", () => ({
  convertDocxToPdf: jest.fn(async () => Buffer.from("%PDF-converted"))
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
import { ContractDocumentProcessor } from "./contract-document.processor";
import { convertDocxToPdf } from "./libreoffice-converter";
import { normalizeContractPdf } from "./pdf-normalizer";

const mockedRender = renderContractDocx as jest.MockedFunction<typeof renderContractDocx>;
const mockedConvert = convertDocxToPdf as jest.MockedFunction<typeof convertDocxToPdf>;
const mockedNormalize = normalizeContractPdf as jest.MockedFunction<
  typeof normalizeContractPdf
>;

describe("ContractDocumentProcessor", () => {
  const audit = { record: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRender.mockReturnValue(Buffer.from("rendered-docx"));
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
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractGeneratedDocument: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
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

  it("claims one queued job atomically and marks it processing", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "DRAFT-001-draft-r3",
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
        .mockResolvedValueOnce({ id: "pdf-file" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
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
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      status: "queued",
      purpose: "negotiation",
      sourceRevision: 8,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "DRAFT-001-negotiation-r8",
        renderInput: { values: { "contract.name": "合同" } },
        attachmentFiles: [
          {
            id: "attachment-file",
            originalName: "清单.pdf",
            mimeType: "application/pdf"
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
        }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).toHaveBeenCalledWith(Buffer.from("template"), {
      values: { "contract.name": "合同" }
    });
    expect(mockedConvert).toHaveBeenCalledWith(Buffer.from("rendered-docx"));
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
        originalName: "DRAFT-001-negotiation-r8.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        uploadedByUserId: "owner-1"
      })
    );
    expect(files.uploadPrivateFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        originalName: "DRAFT-001-negotiation-r8.pdf",
        mimeType: "application/pdf",
        uploadedByUserId: "owner-1"
      })
    );
    expect(prisma.tx.contractGeneratedDocument.update).toHaveBeenCalledWith({
      where: { id: "document-1" },
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
      docxFileId: "layout-file"
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
          "contract.temporaryCode": "PREVIEW",
          "document.watermark": "预览"
        })
      })
    );
    expect(prisma.tx.contractLayoutPreviewJob.update).toHaveBeenCalledWith({
      where: { id: "preview-1" },
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
      status: "queued",
      purpose: "draft",
      sourceRevision: 2,
      inputSnapshot: {
        templateFileId: "layout-file",
        outputBaseName: "DRAFT-001-draft-r2",
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

  it("does not produce duplicate files when a completed job is polled again", async () => {
    const prisma = makePrisma();
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

    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });
});
