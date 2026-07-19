import * as ExcelJS from "exceljs";
import PizZip from "pizzip";
import { convertXlsxToPdf } from "../contract-document/libreoffice-converter";
import { SettlementTemplateService } from "./settlement-template.service";

jest.mock("../contract-document/libreoffice-converter", () => ({
  convertXlsxToPdf: jest.fn()
}));

const HEADERS = [
  "清单编码/行号",
  "清单项名称",
  "是否本期结算",
  "合同数量",
  "合同单价",
  "前期已结算数量",
  "本期数量",
  "累计结算数量",
  "剩余可结算数量",
  "本期结算金额(分)",
  "人工调整金额(分)",
  "调整原因",
  "证据说明",
  "异常说明",
  "备注"
];

async function templateWorkbook(options: {
  headers?: string[];
  sensitiveData?: boolean;
  formula?: boolean;
  merge?: boolean;
  printArea?: boolean;
  signatures?: boolean;
  hiddenSecrets?: boolean;
  formulaOtherSheet?: boolean;
  secretDynamicRules?: boolean;
} = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("本期结算明细");
  sheet.addRow(options.headers ?? HEADERS);
  sheet.addRow([
    options.formula
      ? { formula: "1+1", result: 2 }
      : options.sensitiveData
        ? "真实客户姓名-禁止进入预览"
        : ""
  ]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  if (options.signatures !== false) {
    sheet.getCell("A6").value = "经办人签字：";
    sheet.getCell("H6").value = "审核人签字：";
  }
  if (options.printArea !== false) sheet.pageSetup.printArea = "A1:O6";
  if (options.merge) sheet.mergeCells("A2:B2");
  if (options.hiddenSecrets) {
    workbook.creator = "SECRET-CREATOR";
    sheet.headerFooter.oddHeader = "SECRET-HEADER";
    workbook.addWorksheet("隐藏样例").getCell("A1").value = "SECRET-OTHER-SHEET";
  }
  if (options.formulaOtherSheet) {
    workbook.addWorksheet("其他工作表").getCell("A1").value = { formula: "1+1", result: 2 };
  }
  if (options.secretDynamicRules) {
    sheet.getCell("A2").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"SECRET-VALIDATION-FORMULA"'],
      showInputMessage: true,
      promptTitle: "SECRET-VALIDATION-TITLE",
      prompt: "SECRET-VALIDATION-PROMPT",
      showErrorMessage: true,
      errorTitle: "SECRET-VALIDATION-ERROR-TITLE",
      error: "SECRET-VALIDATION-ERROR"
    };
    sheet.addConditionalFormatting({
      ref: "A2:A4",
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: ['A2="SECRET-CONDITIONAL-FORMULA"'],
          style: { font: { color: { argb: "FFFF0000" } } }
        }
      ]
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function governanceTx(version: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
    position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
    settlementTemplateVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findFirst: jest.fn()
    },
    settlementTemplatePreviewJob: {
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findFirst: jest.fn()
    },
    contractBusinessTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: "template-1" }]),
    ...overrides
  };
}

describe("SettlementTemplateService", () => {
  beforeEach(() => {
    jest.mocked(convertXlsxToPdf).mockReset();
  });

  it("returns a disabled discard action to a super admin instead of granting it", async () => {
    const version = {
      id: "version-1",
      settlementTemplateId: "template-1",
      status: "draft",
      draftRevision: 1,
      xlsxFileId: "source-1",
      previewXlsxFileId: null,
      previewPdfFileId: null,
      submittedByUserId: null,
      publishedAt: null,
      stoppedAt: null
    };
    const tx = governanceTx(version, {
      position: { findMany: jest.fn().mockResolvedValue([{ key: "super_admin" }]) },
      settlementTemplate: {
        findMany: jest.fn().mockResolvedValue([{ id: "template-1", name: "结算模板" }])
      },
      settlementTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([version])
      },
      settlementDraft: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementImport: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      {} as never,
      {} as never
    );

    const result = await service.listGovernance("admin-1");
    expect(result[0]?.versions[0]?.availableActions).toContainEqual(
      expect.objectContaining({
        key: "discard_version",
        enabled: false,
        disabledReason: expect.stringContaining("只有合同主管")
      })
    );
  });

  it("inspects fixed columns, order, formulas, merged data cells, print area and signatures", async () => {
    const buffer = await templateWorkbook({
      headers: [HEADERS[1], HEADERS[0], ...HEADERS.slice(2)],
      formulaOtherSheet: true,
      merge: true,
      printArea: false,
      signatures: false
    });
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 2,
      xlsxFileId: "file-1",
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    };
    const tx = governanceTx(version);
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "模板.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            storageStatus: "active",
            sizeBytes: buffer.length
          },
          buffer
        })
      } as never
    );

    const report = await service.inspect("version-1", "director-1");

    expect(report.blockingErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("列顺序不正确"),
        "未设置打印区域",
        "缺少经办人签字区",
        "缺少审核人签字区",
        "模板中不允许使用公式",
        "表头和明细数据区不允许合并单元格"
      ])
    );
    expect(tx.settlementTemplateVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "version-1", status: "draft", draftRevision: 2 },
        data: expect.objectContaining({ inspectionRevision: 2 })
      })
    );
  });

  it("rejects an XLSX zip entry that expands beyond the inspection limit", async () => {
    const zip = new PizZip();
    zip.file("xl/worksheets/sheet1.xml", "A".repeat(20 * 1024 * 1024 + 1));
    const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 1,
      xlsxFileId: "file-1",
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    };
    const tx = governanceTx(version);
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "模板.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            storageStatus: "active",
            sizeBytes: buffer.length
          },
          buffer
        })
      } as never
    );

    await expect(service.inspect("version-1", "director-1")).rejects.toThrow(
      "结算模板压缩包结构异常或解压后内容过大"
    );
    expect(tx.settlementTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("blocks source data validations and conditional formatting during inspection", async () => {
    const buffer = await templateWorkbook({ secretDynamicRules: true });
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 1,
      xlsxFileId: "file-1",
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    };
    const tx = governanceTx(version);
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "模板.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            storageStatus: "active",
            sizeBytes: buffer.length
          },
          buffer
        })
      } as never
    );

    await expect(service.inspect("version-1", "director-1")).resolves.toMatchObject({
      blockingErrors: expect.arrayContaining([
        "模板中不允许保留源数据验证规则",
        "模板中不允许保留源条件格式"
      ])
    });
  });

  it("increments the draft revision with CAS and invalidates prior inspection and previews", async () => {
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 4,
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    };
    const tx = governanceTx(version);
    tx.contractBusinessTemplate.findMany.mockResolvedValue([
      { contractTypeKey: "material_purchase" }
    ]);
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {} as never
    );

    await expect(
      service.updateDraft("version-1", "director-1", {
        expectedRevision: 4,
        compatibleContractTypeKeys: ["material_purchase"]
      })
    ).resolves.toEqual({ id: "version-1", draftRevision: 5 });
    expect(tx.settlementTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "draft", draftRevision: 4 },
      data: expect.objectContaining({
        draftRevision: { increment: 1 },
        compatibleContractTypeKeys: ["material_purchase"],
        inspectionReport: expect.anything(),
        inspectionRevision: null,
        previewXlsxFileId: null,
        previewPdfFileId: null
      })
    });
    expect(tx.settlementTemplatePreviewJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "stale" } })
    );
  });

  it("never overwrites a published version", async () => {
    const tx = governanceTx({ id: "version-1", status: "published", draftRevision: 1 });
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {} as never
    );

    await expect(
      service.updateDraft("version-1", "director-1", {
        expectedRevision: 1,
        anomalyRules: { rejectNegativeOrdinaryRows: true }
      })
    ).rejects.toThrow("已提交或已发布的结算模板不可覆盖，请复制为新草稿后修改");
    expect(tx.settlementTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when a rule object contains an unknown key", async () => {
    const tx = governanceTx({
      id: "version-1",
      status: "draft",
      draftRevision: 1,
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    });
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {} as never
    );

    await expect(
      service.updateDraft("version-1", "director-1", {
        expectedRevision: 1,
        anomalyRules: { bypassFormulaInspection: true }
      })
    ).rejects.toThrow("结算模板异常规则包含未知配置：bypassFormulaInspection");
    expect(tx.settlementTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("clears source sample data and generates private XLSX/PDF from fixed masked rows", async () => {
    const buffer = await templateWorkbook({
      sensitiveData: true,
      hiddenSecrets: true,
      secretDynamicRules: true
    });
    const version = {
      id: "version-1",
      settlementTemplateId: "template-1",
      status: "draft",
      draftRevision: 3,
      xlsxFileId: "file-1",
      columnSchema: {},
      inspectionRevision: 3,
      inspectionReport: { blockingErrors: [] }
    };
    const job = { id: "job-1", status: "processing" };
    const tx = governanceTx(version);
    tx.settlementTemplatePreviewJob.create.mockResolvedValue(job);
    tx.settlementTemplatePreviewJob.update.mockResolvedValue({
      id: "job-1",
      status: "succeeded",
      previewXlsxFileId: "xlsx-1",
      previewPdfFileId: "pdf-1"
    });
    jest.mocked(convertXlsxToPdf).mockResolvedValue(Buffer.from("%PDF"));
    const uploads: Array<{ originalName: string; buffer: Buffer }> = [];
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {
          originalName: "模板.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          storageStatus: "active",
          sizeBytes: buffer.length
        },
        buffer
      }),
      uploadPrivateFile: jest.fn(async (input) => {
        uploads.push(input);
        return { id: input.mimeType === "application/pdf" ? "pdf-1" : "xlsx-1" };
      })
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
      settlementTemplatePreviewJob: { updateMany: jest.fn() }
    };
    const service = new SettlementTemplateService(
      prisma as never,
      { record: jest.fn() } as never,
      files as never
    );

    const result = await service.generatePreview("version-1", "director-1");
    expect(result).toMatchObject({
      status: "succeeded",
      hasPreviewXlsx: true,
      hasPreviewPdf: true
    });
    expect(JSON.stringify(result)).not.toContain("xlsx-1");
    expect(JSON.stringify(result)).not.toContain("pdf-1");
    const xlsxUpload = uploads.find((upload) => upload.originalName.endsWith(".xlsx"));
    expect(xlsxUpload).toBeDefined();
    const preview = new ExcelJS.Workbook();
    await preview.xlsx.load(xlsxUpload!.buffer as unknown as ExcelJS.Buffer);
    const sheet = preview.getWorksheet("本期结算明细")!;
    expect(sheet.getCell("A2").text).toBe("TEST-001");
    expect(sheet.getCell("A4").text).toBe("");
    expect(JSON.stringify(sheet.model)).not.toContain("真实客户姓名");
    const previewZip = new PizZip(xlsxUpload!.buffer);
    const previewXml = Object.values(previewZip.files)
      .filter((entry) => !entry.dir && /\.(xml|rels)$/i.test(entry.name))
      .map((entry) => entry.asText())
      .join("\n");
    expect(previewXml).not.toContain("SECRET-");
    const pdfInput = jest.mocked(convertXlsxToPdf).mock.calls[0]?.[0];
    expect(pdfInput).toEqual(xlsxUpload!.buffer);
    const pdfInputZip = new PizZip(pdfInput!);
    const pdfInputXml = Object.values(pdfInputZip.files)
      .filter((entry) => !entry.dir && /\.(xml|rels)$/i.test(entry.name))
      .map((entry) => entry.asText())
      .join("\n");
    expect(pdfInputXml).not.toContain("SECRET-");
    expect(convertXlsxToPdf).toHaveBeenCalled();
  });

  it("moves a preview job to stale when the final revision CAS loses", async () => {
    const buffer = await templateWorkbook();
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 3,
      xlsxFileId: "file-1",
      columnSchema: {},
      inspectionRevision: 3,
      inspectionReport: { blockingErrors: [] }
    };
    const tx = governanceTx(version);
    tx.settlementTemplatePreviewJob.create.mockResolvedValue({ id: "job-1" });
    tx.settlementTemplateVersion.updateMany.mockResolvedValue({ count: 0 });
    jest.mocked(convertXlsxToPdf).mockResolvedValue(Buffer.from("%PDF"));
    const terminalUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const service = new SettlementTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx)),
        settlementTemplatePreviewJob: { updateMany: terminalUpdate }
      } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "模板.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            storageStatus: "active",
            sizeBytes: buffer.length
          },
          buffer
        }),
        uploadPrivateFile: jest
          .fn()
          .mockResolvedValueOnce({ id: "xlsx-1" })
          .mockResolvedValueOnce({ id: "pdf-1" })
      } as never
    );

    await expect(service.generatePreview("version-1", "director-1")).rejects.toThrow(
      "结算模板已变化，本次预览已失效，请重新生成"
    );
    expect(terminalUpdate).toHaveBeenCalledWith({
      where: { id: "job-1", status: "processing" },
      data: {
        status: "stale",
        errorMessage: "结算模板已变化，本次预览已失效，请重新生成",
        completedAt: expect.any(Date)
      }
    });
  });

  it("moves a preview job to failed when spreadsheet PDF conversion fails", async () => {
    const buffer = await templateWorkbook();
    const version = {
      id: "version-1",
      status: "draft",
      draftRevision: 3,
      xlsxFileId: "file-1",
      columnSchema: {},
      inspectionRevision: 3,
      inspectionReport: { blockingErrors: [] }
    };
    const tx = governanceTx(version);
    tx.settlementTemplatePreviewJob.create.mockResolvedValue({ id: "job-1" });
    jest.mocked(convertXlsxToPdf).mockRejectedValue(new Error("converter unavailable"));
    const terminalUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const service = new SettlementTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx)),
        settlementTemplatePreviewJob: { updateMany: terminalUpdate }
      } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "模板.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            storageStatus: "active",
            sizeBytes: buffer.length
          },
          buffer
        }),
        uploadPrivateFile: jest.fn()
      } as never
    );

    await expect(service.generatePreview("version-1", "director-1")).rejects.toThrow(
      "结算模板预览生成失败，请检查模板或转换服务后重试"
    );
    expect(terminalUpdate).toHaveBeenCalledWith({
      where: { id: "job-1", status: "processing" },
      data: {
        status: "failed",
        errorMessage: "结算模板预览生成失败，请检查模板或转换服务后重试",
        completedAt: expect.any(Date)
      }
    });
  });

  it("creates a version-scoped preview ticket only after global governance and reference checks", async () => {
    const version = {
      id: "version-1",
      status: "published",
      draftRevision: 3,
      previewXlsxFileId: "xlsx-1",
      previewPdfFileId: "pdf-1"
    };
    const tx = governanceTx(version);
    tx.settlementTemplatePreviewJob.findFirst.mockResolvedValue({ id: "job-1" });
    const createDownloadTicket = jest.fn().mockResolvedValue({
      expiresAt: "2026-07-12T10:05:00.000Z",
      downloadUrl: "/files/xlsx-1/download?token=short"
    });
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      { createDownloadTicket } as never
    );

    await expect(
      service.createPreviewDownloadTicket(
        "version-1",
        "xlsx",
        "director-1",
        "核对脱敏预览"
      )
    ).resolves.toMatchObject({ downloadUrl: expect.stringContaining("token=short") });
    expect(tx.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "director-1", projectId: null }
    });
    expect(tx.settlementTemplatePreviewJob.findFirst).toHaveBeenCalledWith({
      where: {
        settlementTemplateVersionId: "version-1",
        sourceRevision: 3,
        status: "succeeded",
        previewXlsxFileId: "xlsx-1"
      }
    });
    expect(createDownloadTicket).toHaveBeenCalledWith("xlsx-1", {
      actorUserId: "director-1",
      downloadReason: "核对脱敏预览"
    });
  });

  it("recommends one template automatically and never exposes internal compatibility codes", async () => {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          { amountRole: "included", pricingMode: "tax_inclusive" }
        ])
      },
      settlementTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-1",
            settlementTemplateId: "template-1",
            versionNo: 1,
            compatibleContractTypeKeys: ["material_purchase"],
            compatibleAmountRoles: ["included"],
            compatiblePricingModes: ["tax_inclusive"]
          }
        ])
      },
      settlementTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { id: "template-1", name: "材料结算模板", code: "SET-MATERIAL" }
        ])
      }
    };
    const service = new SettlementTemplateService(
      prisma as never,
      {} as never,
      {} as never
    );

    const result = await service.recommend("project-1", "contract-version-1");

    expect(result.selectionMode).toBe("automatic");
    expect(result.selected?.templateVersionId).toBe("version-1");
    expect(result.selected?.reasons).toEqual([
      "合同类型条件已匹配当前合同类型",
      "清单金额角色均已匹配（合同计价金额）",
      "清单计价模式均已匹配（含税计价）"
    ]);
    expect(JSON.stringify(result.selected?.reasons)).not.toContain("material_purchase");
    expect(JSON.stringify(result.selected?.reasons)).not.toContain("tax_inclusive");
  });

  it("rejects a published template whose declared compatibility does not match the contract", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "template-version-1" }]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1", status: "effective" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          { amountRole: "included", pricingMode: "tax_inclusive" }
        ])
      },
      settlementTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-1",
          status: "published",
          compatibleContractTypeKeys: ["material_purchase"],
          compatibleAmountRoles: ["included"],
          compatiblePricingModes: ["tax_exclusive"]
        })
      }
    };
    const service = new SettlementTemplateService(prisma as never, {} as never, {} as never);

    await expect(
      service.assertPublishedCompatible(
        "template-version-1",
        "contract-version-1",
        "project-1"
      )
    ).rejects.toThrow("所选结算模板未发布、已停用或与当前合同不兼容");
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("fails closed for an ineffective contract and for zero compatible published templates", async () => {
    const prisma = {
      contractVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: "v1", contractId: "c1", status: "draft" })
          .mockResolvedValueOnce({ id: "v1", contractId: "c1", status: "effective" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      settlementTemplateVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlementTemplate: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new SettlementTemplateService(prisma as never, {} as never, {} as never);

    await expect(service.recommend("project-1", "v1")).rejects.toThrow(
      "合同版本尚未归档生效，不能推荐或绑定结算模板"
    );
    await expect(service.recommend("project-1", "v1")).rejects.toThrow(
      "未找到与当前合同类型、清单金额角色和计价模式兼容的已发布结算模板"
    );
  });

  it("returns choices and no implicit selection when multiple templates match", async () => {
    const versions = ["1", "2"].map((suffix) => ({
      id: `version-${suffix}`,
      settlementTemplateId: `template-${suffix}`,
      versionNo: 1,
      compatibleContractTypeKeys: [],
      compatibleAmountRoles: [],
      compatiblePricingModes: []
    }));
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "v1", contractId: "c1", status: "effective" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "p1", contractTypeKey: null })
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      settlementTemplateVersion: { findMany: jest.fn().mockResolvedValue(versions) },
      settlementTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { id: "template-1", name: "模板甲", code: "A" },
          { id: "template-2", name: "模板乙", code: "B" }
        ])
      }
    };
    const service = new SettlementTemplateService(prisma as never, {} as never, {} as never);

    await expect(service.recommend("p1", "v1")).resolves.toMatchObject({
      selectionMode: "choice_required",
      selected: null,
      choices: [{ templateCode: "A" }, { templateCode: "B" }]
    });
  });

  it("does not let super_admin discard a settlement template draft", async () => {
    const tx = governanceTx({ id: "version-1", status: "draft" }, {
      position: { findMany: jest.fn().mockResolvedValue([{ key: "super_admin" }]) }
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new SettlementTemplateService(prisma as never, {} as never, {} as never);

    await expect(service.discard("version-1", "admin-1", "清理", 1)).rejects.toThrow(
      "只有合同主管可以废弃结算模板草稿版本"
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("discards an unreferenced settlement template draft and invalidates previews", async () => {
    const tx = governanceTx({
      id: "version-1",
      settlementTemplateId: "template-1",
      status: "draft",
      draftRevision: 3,
      submittedByUserId: null,
      publishedAt: null,
      stoppedAt: null,
      discardedAt: null
    }, {
      settlementDraft: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementImport: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const audit = { record: jest.fn() };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new SettlementTemplateService(prisma as never, audit as never, {} as never);

    await expect(service.discard("version-1", "director-1", "误传模板", 3)).resolves.toMatchObject({
      id: "version-1",
      status: "discarded"
    });
    expect(tx.settlementTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        status: "draft",
        draftRevision: 3,
        discardedAt: null
      },
      data: expect.objectContaining({
        status: "discarded",
        previewXlsxFileId: null,
        previewPdfFileId: null
      })
    });
    expect(tx.settlementTemplatePreviewJob.updateMany).toHaveBeenCalledWith({
      where: {
        settlementTemplateVersionId: "version-1",
        status: { in: ["queued", "processing", "succeeded"] }
      },
      data: expect.objectContaining({
        status: "stale",
        previewXlsxFileId: null,
        previewPdfFileId: null
      })
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("rejects stale settlement template discard before references and preview invalidation", async () => {
    const settlementDraft = { findFirst: jest.fn() };
    const settlement = { findFirst: jest.fn() };
    const settlementImport = { findFirst: jest.fn() };
    const tx = governanceTx({
      id: "version-1",
      settlementTemplateId: "template-1",
      status: "draft",
      draftRevision: 4,
      submittedByUserId: null,
      publishedAt: null,
      stoppedAt: null,
      discardedAt: null
    }, {
      settlementDraft,
      settlement,
      settlementImport
    });
    const service = new SettlementTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {} as never
    );

    await expect(service.discard("version-1", "director-1", "误传模板", 3))
      .rejects.toMatchObject({ status: 409 });
    expect(settlementDraft.findFirst).not.toHaveBeenCalled();
    expect(tx.settlementTemplateVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.settlementTemplatePreviewJob.updateMany).not.toHaveBeenCalled();
  });
});
