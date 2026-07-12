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

  function docx(
    documentXml: string,
    stylesXml = "",
    extraXml: Record<string, string> = {}
  ) {
    const zip = new PizZip();
    zip.file(
      "word/document.xml",
      documentXml.includes("<w:t")
        ? documentXml
        : `<w:document><w:body><w:p><w:r><w:t>${documentXml.replace(
            /^<w:document>|<\/w:document>$/g,
            ""
          )}</w:t></w:r></w:p></w:body></w:document>`
    );
    zip.file("word/styles.xml", stylesXml);
    for (const [path, xml] of Object.entries(extraXml)) {
      zip.file(path, xml);
    }
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
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          originalName: "layout.pdf",
          uploadedByUserId: "staff-1"
        })
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
    ).rejects.toThrow("版式源文件必须是 DOCX 文件");
  });

  it("rejects a DOCX uploaded by another user", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          originalName: "layout.docx",
          uploadedByUserId: "other-user"
        })
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
    ).rejects.toThrow("只能使用本人上传的版式源文件");
    expect(tx.contractLayoutTemplate.create).not.toHaveBeenCalled();
  });

  it("audits create against the layout version", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          originalName: "layout.docx",
          uploadedByUserId: "staff-1"
        })
      },
      contractLayoutTemplate: {
        create: jest.fn().mockResolvedValue({ id: "template-1" })
      },
      contractLayoutTemplateVersion: {
        create: jest.fn().mockResolvedValue({ id: "version-1", status: "draft" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await service.createLayout("staff-1", {
      name: "采购合同",
      contractTypeKey: "procurement",
      docxFileId: "file-1",
      placeholderSchema: { bills: [] }
    });

    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        businessType: "contract_layout_template_version",
        businessId: "version-1"
      })
    );
  });

  it("extracts placeholders from word/document.xml", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "file-1",
      placeholderSchema: { bills: [] }
    };
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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
    expect(result.sourceRevision).toBe(2);
    expect(tx.contractLayoutTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "draft", draftRevision: 2 },
      data: expect.objectContaining({ inspectionRevision: 2 })
    });
  });

  it("accepts Chinese business placeholders and bill loops", async () => {
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(
      "<w:document>{合同名称} {草稿编号} {文档水印} {#材料清单}{名称}{规格}{单位}{数量}{/材料清单}</w:document>"
    );
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.inspectVersion("version-1", "staff-1");

    expect(result.placeholders).toEqual([
      "contract.name",
      "contract.temporaryCode",
      "document.watermark"
    ]);
    expect(result.hasBillLoop).toBe(true);
    expect(result.unknownPlaceholders).toEqual([]);
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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

  it("extracts split placeholders and bill loops from visible Word text", async () => {
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(
      [
        "<w:document><w:body><w:p>",
        "<w:r><w:t>{{contract.</w:t></w:r><w:r><w:t>name}}</w:t></w:r>",
        "<w:r><w:t>{{contract.temporary</w:t></w:r><w:r><w:t>Code}}</w:t></w:r>",
        "<w:r><w:t>{#bill.</w:t></w:r><w:r><w:t>materials}</w:t></w:r>",
        "<w:r><w:t>{/bill.materials}</w:t></w:r>",
        "<w:r><w:t>甲方 &amp; 乙方</w:t></w:r>",
        "</w:p></w:body></w:document>"
      ].join(""),
      "",
      {
        "word/header1.xml":
          "<w:hdr><w:p><w:r><w:t>{{document.water</w:t></w:r><w:r><w:t>mark}}</w:t></w:r></w:p></w:hdr>"
      }
    );
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.inspectVersion("version-1", "staff-1");

    expect(result.placeholders).toEqual([
      "contract.name",
      "contract.temporaryCode",
      "document.watermark"
    ]);
    expect(result.hasBillLoop).toBe(true);
    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.blockingErrors).toEqual([]);
  });

  it("rejects DOCX target XML that exceeds the inspection limit", async () => {
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
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const buffer = docx(`<w:document><w:body><w:p><w:r><w:t>${"x".repeat(2_100_000)}</w:t></w:r></w:p></w:body></w:document>`);
    files.getFileBuffer.mockResolvedValue({ file: { id: "file-1" }, buffer });
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.inspectVersion("version-1", "staff-1")).rejects.toThrow(
      "DOCX 版式内容过大，无法完成检查"
    );
    expect(tx.contractLayoutTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("queues a layout preview with saved sample data", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "draft",
          draftRevision: 3
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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
        sourceRevision: 3,
        createdByUserId: "staff-1"
      }
    });
  });

  it("rejects preview queueing after submission", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", status: "submitted" }),
        updateMany: jest.fn()
      },
      contractLayoutPreviewJob: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.queuePreview("version-1", "staff-1", {})).rejects.toThrow(
      "只有草稿状态的合同版式可以生成预览"
    );
    expect(tx.contractLayoutPreviewJob.create).not.toHaveBeenCalled();
  });

  it("allows global contract_staff to read the latest preview", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-1",
          status: "queued",
          sampleData: { contract: { name: "示例合同" } }
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.getLatestPreview("version-1", "staff-1")).resolves.toMatchObject({
      id: "job-1"
    });
    expect(tx.contractLayoutPreviewJob.findFirst).toHaveBeenCalledWith({
      where: { layoutTemplateVersionId: "version-1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("rejects preview reads without global contract_staff", async () => {
    const tx = {
      ...roleTx("contract_director"),
      contractLayoutPreviewJob: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.getLatestPreview("version-1", "director-1")).rejects.toThrow(
      "只有合同经办人可以执行该版式操作"
    );
    expect(tx.contractLayoutPreviewJob.findFirst).not.toHaveBeenCalled();
  });

  it("rejects submission when inspection belongs to an older draft revision", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "draft",
          draftRevision: 4,
          inspectionRevision: 3,
          inspectionReport: { blockingErrors: [] }
        }),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.submitVersion("version-1", "staff-1")).rejects.toThrow(
      "版式检查仍有阻断项，请处理后再提交或发布"
    );
    expect(tx.contractLayoutTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("publishes only when inspection has no blocking errors and the latest preview succeeded", async () => {
    const version = {
      id: "version-1",
      status: "submitted",
      draftRevision: 3,
      inspectionRevision: 3,
      inspectionReport: { blockingErrors: [] }
    };
    const tx = {
      ...roleTx("contract_director"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-1",
          status: "succeeded",
          sourceRevision: 3,
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
      where: { layoutTemplateVersionId: "version-1", sourceRevision: 3 },
      orderBy: { createdAt: "desc" }
    });
    expect(tx.contractLayoutTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "submitted", draftRevision: 3 },
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
    ).rejects.toThrow("版式检查仍有阻断项，请处理后再提交或发布");
  });

  it("rejects publication when the expected status changed concurrently", async () => {
    const tx = {
      ...roleTx("contract_director"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "submitted",
          inspectionReport: { blockingErrors: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue({
          status: "succeeded",
          previewPdfFileId: "file-preview"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.publishVersion("version-1", "director-1", "首发")).rejects.toThrow(
      "合同版式状态已变化，请刷新后重试"
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lists published version details with each layout", async () => {
    const prisma = {
      contractLayoutTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-2",
            layoutTemplateId: "template-1",
            versionNo: 2,
            previewPdfFileId: "preview-2",
            publishedAt: new Date("2026-06-25T00:00:00.000Z")
          }
        ])
      },
      contractLayoutTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "template-1",
            name: "采购合同",
            contractTypeKey: "procurement",
            createdAt: new Date("2026-06-24T00:00:00.000Z")
          }
        ])
      }
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    const result = await service.listPublishedLayouts("procurement");

    expect(result).toEqual([
      expect.objectContaining({
        id: "template-1",
        name: "采购合同",
        layoutTemplateVersionId: "version-2",
        versionNo: 2,
        previewPdfFileId: "preview-2",
        publishedAt: new Date("2026-06-25T00:00:00.000Z")
      })
    ]);
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
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.inspectVersion("version-1", "staff-1")).rejects.toThrow(
      "只有草稿状态的合同版式可以检查"
    );
    expect(tx.contractLayoutTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("returns layout versions newest-first with each current-revision preview", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplate: {
        findUnique: jest.fn().mockResolvedValue({ id: "template-1", name: "采购合同" })
      },
      contractLayoutTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "version-2", versionNo: 2, draftRevision: 3 },
          { id: "version-1", versionNo: 1, draftRevision: 1 }
        ])
      },
      contractLayoutPreviewJob: {
        findMany: jest.fn().mockResolvedValue([
          { id: "job-2", layoutTemplateVersionId: "version-2", sourceRevision: 3 }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(service.getLayoutTemplate("template-1", "staff-1")).resolves.toEqual({
      template: { id: "template-1", name: "采购合同" },
      versions: [
        expect.objectContaining({ id: "version-2", latestPreview: expect.objectContaining({ id: "job-2" }) }),
        expect.objectContaining({ id: "version-1", latestPreview: null })
      ]
    });
    expect(tx.contractLayoutTemplateVersion.findMany).toHaveBeenCalledWith({
      where: { layoutTemplateId: "template-1" },
      orderBy: { versionNo: "desc" }
    });
  });

  it("updates only the expected draft revision and invalidates old inspection and preview", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 4,
      docxFileId: "file-old",
      placeholderSchema: { bills: [] }
    };
    const tx = {
      ...roleTx("contract_staff"),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-new",
          originalName: "layout-v2.docx",
          uploadedByUserId: "staff-1"
        })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractLayoutPreviewJob: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(
      service.updateDraftVersion("version-1", "staff-1", {
        expectedRevision: 4,
        docxFileId: "file-new"
      })
    ).resolves.toMatchObject({ draftRevision: 5, docxFileId: "file-new" });
    expect(tx.contractLayoutTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "draft", draftRevision: 4 },
      data: expect.objectContaining({
        draftRevision: { increment: 1 },
        docxFileId: "file-new",
        inspectionReport: expect.anything(),
        inspectionRevision: null,
        previewPdfFileId: null
      })
    });
    expect(tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: {
        layoutTemplateVersionId: "version-1",
        sourceRevision: 4,
        status: { in: ["queued", "processing", "succeeded"] }
      },
      data: { status: "stale" }
    });
  });

  it("rejects a stale draft save without invalidating current results", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "draft",
          draftRevision: 5,
          docxFileId: "file-1",
          placeholderSchema: { bills: [] }
        }),
        updateMany: jest.fn()
      },
      contractLayoutPreviewJob: { updateMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new LayoutTemplateService(prisma, audit as never, files as never);

    await expect(
      service.updateDraftVersion("version-1", "staff-1", {
        expectedRevision: 4,
        placeholderSchema: { bills: [{ key: "materials" }] }
      })
    ).rejects.toThrow("版式草稿已被更新，请刷新后重试");
    expect(tx.contractLayoutPreviewJob.updateMany).not.toHaveBeenCalled();
  });
});
