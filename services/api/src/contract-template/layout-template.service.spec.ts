import PizZip from "pizzip";
import { PrismaService } from "../database/prisma.service";
import { LayoutTemplateService } from "./layout-template.service";

describe("LayoutTemplateService", () => {
  const audit = { record: jest.fn() };
  const files = { getFileBuffer: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
    files.getFileBuffer.mockReset();
    process.env.DOC_ALLOWED_FONTS = "Noto Sans CJK SC,宋体,仿宋,黑体";
  });

  afterAll(() => {
    delete process.env.DOC_ALLOWED_FONTS;
  });

  function docx(documentXml: string, stylesXml = "") {
    const zip = new PizZip();
    zip.file("word/document.xml", documentXml);
    zip.file("word/styles.xml", stylesXml);
    return zip.generate({ type: "nodebuffer" });
  }

  function roleTx(role: "contract_staff" | "contract_director") {
    return {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: role }]) },
      auditLog: { create: jest.fn() }
    };
  }

  it("rejects a non-DOCX source extension", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", originalName: "layout.pdf" })
      },
      contractLayoutTemplate: { create: jest.fn() },
      contractLayoutTemplateVersion: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(
      service.createLayout("staff-1", {
        name: "采购合同",
        contractTypeKey: "procurement",
        docxFileId: "file-1",
        placeholderSchema: { bills: [] }
      })
    ).rejects.toThrow("Layout source must be a DOCX file");
  });

  it("extracts placeholders from word/document.xml", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      docxFileId: "file-1",
      placeholderSchema: { bills: [] }
    };
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        update: jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }))
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(
      "<w:document>{{contract.name}} {{contract.temporaryCode}} {{document.watermark}}</w:document>"
    );
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.inspectVersion("version-1", "staff-1");

    expect(result.placeholders).toEqual([
      "contract.name",
      "contract.temporaryCode",
      "document.watermark"
    ]);
    expect(result.blockingErrors).toEqual([]);
  });

  it("reports unknown placeholders", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      docxFileId: "file-1",
      placeholderSchema: { bills: [] }
    };
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        update: jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }))
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(
      "<w:document>{{contract.name}} {{contract.temporaryCode}} {{document.watermark}} {{unknown.value}}</w:document>"
    );
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.inspectVersion("version-1", "staff-1");

    expect(result.unknownPlaceholders).toEqual(["unknown.value"]);
    expect(result.blockingErrors).toContain("Unknown placeholders: unknown.value");
  });

  it("recognizes a Docxtemplater bill loop marker", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      docxFileId: "file-1",
      placeholderSchema: { bills: [{ key: "materials" }] }
    };
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        update: jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }))
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(
      "<w:document>{{contract.name}} {{contract.temporaryCode}} {{document.watermark}} {#bill.materials}{itemName}{/bill.materials}</w:document>"
    );
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.inspectVersion("version-1", "staff-1");

    expect(result.hasBillLoop).toBe(true);
    expect(result.blockingErrors).toEqual([]);
  });

  it("queues a layout preview with saved sample data", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", status: "draft" })
      },
      contractLayoutPreviewJob: {
        create: jest.fn().mockResolvedValue({ id: "job-1", status: "queued" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);
    const sampleData = { contract: { name: "示例合同" } };

    const result = await service.queuePreview("version-1", "staff-1", sampleData);

    expect(result).toMatchObject({ id: "job-1", status: "queued" });
    expect(tx.contractLayoutPreviewJob.create).toHaveBeenCalledWith({
      data: {
        layoutTemplateVersionId: "version-1",
        status: "queued",
        sampleData,
        createdByUserId: "staff-1"
      }
    });
  });

  it("publishes only when inspection has no blocking errors and the latest preview succeeded", async () => {
    const version = {
      id: "version-1",
      status: "submitted",
      inspectionReport: { blockingErrors: [] }
    };
    const tx = {
      ...roleTx("contract_director"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "published" })
      },
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-1",
          status: "succeeded",
          previewPdfFileId: "file-preview"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await service.publishVersion("version-1", "director-1", "首发");

    expect(tx.contractLayoutPreviewJob.findFirst).toHaveBeenCalledWith({
      where: { layoutTemplateVersionId: "version-1" },
      orderBy: { createdAt: "desc" }
    });
    expect(tx.contractLayoutTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        status: "published",
        previewPdfFileId: "file-preview",
        changeSummary: "首发"
      })
    });

    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      ...version,
      inspectionReport: { blockingErrors: ["Missing required placeholder"] }
    });
    await expect(
      service.publishVersion("version-1", "director-1", "blocked")
    ).rejects.toThrow("Layout inspection has blocking errors");
  });

  it("keeps a published layout immutable", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "published",
          docxFileId: "file-1"
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.inspectVersion("version-1", "staff-1")).rejects.toThrow(
      "Published layout versions are immutable"
    );
    expect(tx.contractLayoutTemplateVersion.update).not.toHaveBeenCalled();
  });
});
