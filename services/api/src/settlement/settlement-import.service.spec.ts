import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { SettlementImportService } from "./settlement-import.service";

const sourceSnapshot = {
  contractVersionId: "version-1",
  contractId: "contract-1",
  projectId: "project-1",
  contractAmountCents: "100000",
  summary: {
    rowCount: 2,
    exceptionCount: 0,
    contractAmountCents: "100000",
    settledAmountCents: "0",
    remainingAmountCents: "100000"
  },
  rows: [
    {
      id: "row-1",
      billId: "bill-1",
      billKey: "main",
      billName: "主清单",
      rowKey: "1",
      sortOrder: 1,
      itemCode: "A-1",
      itemName: "自动计价行",
      specification: null,
      unit: "项",
      quantity: "10",
      unitPrice: "100",
      taxRatePercent: "0",
      amountRole: "included" as const,
      pricingMode: "tax_inclusive" as const,
      calculationMode: "normal_auto" as const,
      contractAmountCents: "100000",
      settledQuantity: "0",
      previousSettledQuantity: "0",
      remainingQuantity: "10",
      settledAmountCents: "0",
      remainingAmountCents: "100000",
      provisional: false,
      settlementBasis: null,
      exception: null
    },
    {
      id: "row-2",
      billId: "bill-1",
      billKey: "main",
      billName: "主清单",
      rowKey: "2",
      sortOrder: 2,
      itemCode: "A-2",
      itemName: "未选中行",
      specification: null,
      unit: "项",
      quantity: "1",
      unitPrice: "1",
      taxRatePercent: "0",
      amountRole: "included" as const,
      pricingMode: "tax_inclusive" as const,
      calculationMode: "normal_auto" as const,
      contractAmountCents: "100",
      settledQuantity: "0",
      previousSettledQuantity: "0",
      remainingQuantity: "1",
      settledAmountCents: "0",
      remainingAmountCents: "100",
      provisional: false,
      settlementBasis: null,
      exception: null
    }
  ]
};

async function importWorkbook(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("本期结算明细");
  sheet.addRow([
    "清单编码/行号",
    "清单项名称",
    "是否本期结算",
    "本期数量",
    "本期金额（元）",
    "调整原因",
    "备注"
  ]);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("SettlementImportService", () => {
  it("creates no preview record when the contract type is not settleable", async () => {
    const tx = { settlementImport: { create: jest.fn() } };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = { getFileBuffer: jest.fn() };
    const workbench = {
      sourceLines: jest.fn().mockRejectedValue(
        new Error("通用合同直接按冻结付款条款申请付款，不办理结算")
      )
    };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      files as never,
      workbench as never,
      { previewLines: jest.fn() } as never
    );

    await expect(service.previewImport("version-generic", "user-1", { fileId: "file-1" }))
      .rejects.toThrow("通用合同直接按冻结付款条款申请付款");
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.settlementImport.create).not.toHaveBeenCalled();
  });

  it("previews only explicitly selected rows and writes no settlement facts", async () => {
    const buffer = await importWorkbook([
      ["A-1", "自动计价行", "是", "2", "", "", "本期完成"],
      ["A-2", "未选中行", "否", "999", "999", "", "应忽略"]
    ]);
    const tx = {
      settlementImport: {
        create: jest.fn().mockResolvedValue({ id: "import-1" })
      },
      settlement: { create: jest.fn() },
      settlementLine: { createMany: jest.fn() }
    };
    const prisma = {
      settlementTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ status: "published" })
      },
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {
          id: "file-1",
          originalName: "本期结算.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: buffer.length,
          uploadedByUserId: "user-1",
          contentSha256: "sha-1",
          storageStatus: "active"
        },
        buffer
      })
    };
    const workbench = { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) };
    const settlements = {
      previewLines: jest.fn().mockResolvedValue({
        contractVersionId: "version-1",
        amountCents: "20000",
        lines: [{ contractBillRowId: "row-1", amountCents: "20000" }]
      })
    };
    const service = new SettlementImportService(
      prisma as never,
      audit as never,
      files as never,
      workbench as never,
      settlements as never,
      { assertPublishedCompatible: jest.fn() } as never
    );

    await expect(
      service.previewImport("version-1", "user-1", {
        fileId: "file-1",
        settlementTemplateVersionId: "template-version-1"
      })
    ).resolves.toMatchObject({ importId: "import-1", selectedCount: 1, errors: [] });
    expect(settlements.previewLines).toHaveBeenCalledWith("version-1", {
      settlementLines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "row-1",
          quantity: "2",
          remark: "本期完成"
        }
      ]
    });
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.settlementImport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        settlementTemplateVersionId: "template-version-1"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "settlement.import.preview" })
    );
  });

  it("maps settlement preview exceptions before persisting or exporting the error", async () => {
    const buffer = await importWorkbook([
      ["A-1", "自动计价行", "是", "2", "", "", "本期完成"]
    ]);
    const tx = {
      settlementImport: {
        create: jest.fn().mockResolvedValue({ id: "import-error" })
      }
    };
    const audit = { record: jest.fn() };
    const service = new SettlementImportService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "本期结算.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: buffer.length,
            uploadedByUserId: "user-1",
            storageStatus: "active"
          },
          buffer
        })
      } as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      {
        previewLines: jest.fn().mockRejectedValue(
          new BadRequestException({ message: ["PrismaClientKnownRequestError: internal"] })
        )
      } as never
    );

    const result = await service.previewImport("version-1", "user-1", { fileId: "file-1" });

    expect(result.errors).toEqual([
      { row: 2, column: "业务校验", message: "结算明细校验失败" }
    ]);
    const storedPreview = tx.settlementImport.create.mock.calls[0]?.[0]?.data.preview;
    expect(JSON.stringify(storedPreview)).not.toContain("PrismaClientKnownRequestError");
  });

  it("keeps 98 correct Excel rows in preview when two selected rows are invalid", async () => {
    const rows = Array.from({ length: 100 }, (_value, index) => {
      const sequence = index + 1;
      return {
        ...sourceSnapshot.rows[0],
        id: `row-${sequence}`,
        rowKey: String(sequence),
        sortOrder: sequence,
        itemCode: `A-${sequence}`,
        itemName: `清单项 ${sequence}`
      };
    });
    const largeSource = {
      ...sourceSnapshot,
      summary: { ...sourceSnapshot.summary, rowCount: rows.length },
      rows
    };
    const buffer = await importWorkbook(rows.map((row, index) => [
      row.itemCode,
      row.itemName,
      "是",
      index < 98 ? "1" : "",
      "",
      "",
      ""
    ]));
    const tx = { settlementImport: { create: jest.fn().mockResolvedValue({ id: "import-98-2" }) } };
    const settlements = { previewLines: jest.fn() };
    const service = new SettlementImportService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "98正确2错误.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: buffer.length,
            uploadedByUserId: "user-1",
            storageStatus: "active"
          },
          buffer
        })
      } as never,
      { sourceLines: jest.fn().mockResolvedValue(largeSource) } as never,
      settlements as never
    );

    await expect(service.previewImport("version-1", "user-1", { fileId: "file-98-2" }))
      .resolves.toMatchObject({
        importId: "import-98-2",
        selectedCount: 98,
        settlementLines: expect.arrayContaining([
          expect.objectContaining({ contractBillRowId: "row-1", quantity: "1" }),
          expect.objectContaining({ contractBillRowId: "row-98", quantity: "1" })
        ]),
        errors: [
          expect.objectContaining({ row: 100, column: "本期数量" }),
          expect.objectContaining({ row: 101, column: "本期数量" })
        ]
      });
    expect(settlements.previewLines).not.toHaveBeenCalled();
  });

  it("writes no import preview when the selected template is incompatible", async () => {
    const buffer = await importWorkbook([
      ["A-1", "自动计价行", "是", "1", "", "", ""]
    ]);
    const tx = {
      settlementImport: { create: jest.fn() },
      settlement: { create: jest.fn() },
      settlementLine: { createMany: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {
          originalName: "本期结算.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: buffer.length,
          uploadedByUserId: "user-1",
          storageStatus: "active"
        },
        buffer
      })
    };
    const templates = {
      assertPublishedCompatible: jest
        .fn()
        .mockRejectedValue(new Error("所选结算模板未发布、已停用或与当前合同不兼容"))
    };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      files as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      {
        previewLines: jest.fn().mockResolvedValue({
          amountCents: "10000",
          lines: [{ contractBillRowId: "row-1", amountCents: "10000" }]
        })
      } as never,
      templates as never
    );

    await expect(
      service.previewImport("version-1", "user-1", {
        fileId: "file-1",
        settlementTemplateVersionId: "incompatible-template-version"
      })
    ).rejects.toThrow("所选结算模板未发布、已停用或与当前合同不兼容");
    expect(tx.settlementImport.create).not.toHaveBeenCalled();
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
  });

  it("rejects a tampered visible source key without an internal fallback", async () => {
    const buffer = await importWorkbook([
      ["A-999", "自动计价行", "是", "1", "", "", ""]
    ]);
    const tx = {
      settlementImport: { create: jest.fn().mockResolvedValue({ id: "import-1" }) }
    };
    const service = new SettlementImportService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            originalName: "本期结算.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: buffer.length,
            uploadedByUserId: "user-1",
            storageStatus: "active"
          },
          buffer
        })
      } as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      { previewLines: jest.fn() } as never
    );

    await expect(
      service.previewImport("version-1", "user-1", { fileId: "file-1" })
    ).resolves.toMatchObject({
      errors: [
        expect.objectContaining({
          row: 2,
          column: "清单编码/行号",
          message: "清单项不属于当前有效合同版本"
        })
      ]
    });
  });

  it("rejects formulas instead of trusting cached Excel results", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("本期结算明细");
    sheet.addRow([
      "清单编码/行号",
      "清单项名称",
      "是否本期结算",
      "本期数量",
      "本期金额（元）",
      "调整原因",
      "备注"
    ]);
    sheet.addRow(["A-1", "自动计价行", "是", { formula: "1+1", result: 2 }, "", "", ""]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const prisma = { $transaction: jest.fn() };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            id: "file-1",
            originalName: "本期结算.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: buffer.length,
            uploadedByUserId: "user-1",
            contentSha256: "sha-1",
            storageStatus: "active"
          },
          buffer
        })
      } as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      { previewLines: jest.fn() } as never
    );

    await expect(
      service.previewImport("version-1", "user-1", { fileId: "file-1" })
    ).rejects.toThrow("Excel 不允许使用公式，请将公式结果粘贴为数值后重新导入");
  });

  it("rejects an XLSX archive whose compressed content expands beyond the safe entry limit", async () => {
    const zip = new PizZip();
    zip.file("[Content_Types].xml", "A".repeat(20 * 1024 * 1024 + 1));
    const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    const service = new SettlementImportService(
      { $transaction: jest.fn() } as never,
      { record: jest.fn() } as never,
      {
        getFileBuffer: jest.fn().mockResolvedValue({
          file: {
            id: "file-1",
            originalName: "本期结算.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: buffer.length,
            uploadedByUserId: "user-1",
            storageStatus: "active"
          },
          buffer
        })
      } as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      { previewLines: jest.fn() } as never
    );

    await expect(
      service.previewImport("version-1", "user-1", { fileId: "file-1" })
    ).rejects.toThrow("Excel 压缩包结构异常或解压后内容过大，无法导入");
  });

  it("returns the same frozen result when an applied import is applied again", async () => {
    const result = { amountCents: "20000", settlementLines: [{ contractBillRowId: "row-1" }] };
    const record = {
      id: "import-1",
      projectId: "project-1",
      contractVersionId: "version-1",
      status: "applied",
      result
    };
    const prisma = {
      settlementImport: { findUnique: jest.fn().mockResolvedValue(record) },
      $transaction: jest.fn()
    };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
      { sourceLines: jest.fn() } as never,
      {} as never
    );

    await expect(service.applyImport("project-1", "import-1", "user-2")).resolves.toEqual({
      importId: "import-1",
      status: "applied",
      result
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects apply when the contract source revision changed after preview", async () => {
    const record = {
      id: "import-1",
      projectId: "project-1",
      contractVersionId: "version-1",
      sourceRevision: "stale-revision",
      status: "preview",
      preview: {
        selectedCount: 1,
        errors: [],
        settlementLines: [
          { sourceType: "contract_bill_row", contractBillRowId: "row-1", quantity: "1" }
        ],
        canonical: { amountCents: "10000", lines: [] }
      }
    };
    const prisma = {
      settlementImport: { findUnique: jest.fn().mockResolvedValue(record) },
      $transaction: jest.fn()
    };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      {} as never
    );

    await expect(service.applyImport("project-1", "import-1", "user-2")).rejects.toThrow(
      "合同清单或前期结算占用已变化，请重新预检后再应用"
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("exports a Chinese template without exposing raw row ids in visible columns", async () => {
    const tx = {};
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      {} as never
    );

    const result = await service.exportTemplate("version-1", "user-1");
    expect(result.fileName).toBe("本期结算导入模板.xlsx");
    expect(result.fileName).not.toContain("version-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("本期结算明细")!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "清单编码/行号",
      "清单项名称",
      "是否本期结算",
      "本期数量",
      "本期金额（元）",
      "调整原因",
      "备注"
    ]);
    const visibleValues = sheet.getRow(2).values;
    expect(Array.isArray(visibleValues) ? visibleValues.slice(1, 8) : []).not.toContain("row-1");
    expect(sheet.getRow(2).getCell(1).text).toBe("A-1");
    expect(sheet.columnCount).toBe(7);
    expect(JSON.stringify(workbook.model)).not.toContain("__系统清单项标识");
  });

  it("keeps duplicate visible contract keys uniquely selectable without exposing ids", async () => {
    const sourceRows = [
      sourceSnapshot.rows[0],
      { ...sourceSnapshot.rows[0], id: "row-2", itemName: "自动计价行二" },
      { ...sourceSnapshot.rows[0], id: "row-3", itemCode: "A-1（第2项）", itemName: "自动计价行三" }
    ];
    const prisma = { $transaction: jest.fn(async (callback) => callback({})) };
    const service = new SettlementImportService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
      { sourceLines: jest.fn().mockResolvedValue({ ...sourceSnapshot, rows: sourceRows }) } as never,
      {} as never
    );

    const result = await service.exportTemplate("version-1", "user-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("本期结算明细")!;

    expect(sheet.getCell("A2").text).toBe("A-1");
    expect(sheet.getCell("A3").text).toBe("A-1（第2项）");
    expect(sheet.getCell("A3").text).not.toContain("row-2");
    expect(sheet.getCell("A4").text).toBe("A-1（第2项）（第2项）");
  });

  it("applies a clean preview once and freezes the canonical payload without settlements", async () => {
    const sourceRevision = createHash("sha256")
      .update(JSON.stringify(sourceSnapshot))
      .digest("hex");
    const preview = {
      selectedCount: 1,
      errors: [],
      settlementLines: [
        { sourceType: "contract_bill_row", contractBillRowId: "row-1", quantity: "2" }
      ],
      canonical: { amountCents: "20000", lines: [{ contractBillRowId: "row-1" }] }
    };
    const record = {
      id: "import-1",
      projectId: "project-1",
      contractVersionId: "version-1",
      sourceRevision,
      status: "preview",
      preview,
      result: null
    };
    const tx = {
      settlementImport: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn()
      },
      settlement: { create: jest.fn() },
      settlementLine: { createMany: jest.fn() }
    };
    const prisma = {
      settlementImport: { findUnique: jest.fn().mockResolvedValue(record) },
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new SettlementImportService(
      prisma as never,
      audit as never,
      {} as never,
      { sourceLines: jest.fn().mockResolvedValue(sourceSnapshot) } as never,
      {} as never
    );

    await expect(service.applyImport("project-1", "import-1", "user-2")).resolves.toMatchObject({
      importId: "import-1",
      status: "applied",
      result: {
        contractVersionId: "version-1",
        sourceRevision,
        settlementLines: preview.settlementLines,
        canonical: preview.canonical
      }
    });
    expect(tx.settlementImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "import-1", projectId: "project-1", status: "preview" } })
    );
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "settlement.import.apply" })
    );
  });

  it("exports canonical results and all preview errors as separate worksheets", async () => {
    const record = {
      id: "import-1",
      projectId: "project-1",
      contractVersionId: "version-1",
      status: "preview",
      result: null,
      preview: {
        selectedCount: 1,
        settlementLines: [],
        displayRows: [{ contractBillRowId: "row-1", sourceKey: "A-1", name: "自动计价行" }],
        canonical: {
          lines: [
            {
              contractBillRowId: "row-1",
              name: "自动计价行",
              calculationMode: "normal_auto",
              quantity: "2",
              unitPrice: "100",
              amountCents: "20000",
              reason: null,
              remark: "完成"
            }
          ]
        },
        errors: [
          { row: 3, column: "本期数量", message: "数量错误" },
          { row: 4, column: "调整原因", message: "原因缺失" }
        ]
      }
    };
    const tx = {};
    const prisma = {
      settlementImport: { findUnique: jest.fn().mockResolvedValue(record) },
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new SettlementImportService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await service.exportResult("project-1", "import-1", "user-1");
    expect(result.fileName).toBe("结算导入结果.xlsx");
    expect(result.fileName).not.toContain("import-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet("本期结算结果")?.getRow(2).getCell(1).text).toBe("A-1");
    expect(workbook.getWorksheet("本期结算结果")?.getRow(2).getCell(3).text).toBe("自动计价");
    expect(workbook.getWorksheet("本期结算结果")?.getRow(2).getCell(6).text).toBe("200.00");
    expect(JSON.stringify(workbook.model)).not.toContain("后台金额(分)");
    expect(workbook.getWorksheet("导入错误")?.actualRowCount).toBe(3);
    const errors = await service.exportErrors("project-1", "import-1", "user-1");
    expect(errors.fileName).toBe("结算导入错误.xlsx");
    expect(errors.fileName).not.toContain("import-1");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "settlement.import.result.download" })
    );
  });
});
