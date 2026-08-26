import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import PizZip from "pizzip";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import {
  BUSINESS_ENTRY_XLSX_MIME,
  BusinessEntryExcelService
} from "./business-entry-excel.service";

const originalTimezone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Shanghai";
});
afterAll(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

const roles = ["finance_staff"] as const;
const fieldBase = {
  description: "业务字段",
  example: "示例",
  scope: "line" as const,
  unit: "",
  precision: 0,
  required: true,
  permissions: { view: roles, edit: roles, import: roles, export: roles },
  bulk: { enabled: true, maxRows: 100, strategy: "append" as const },
  display: {
    formHint: "请填写",
    gridColumn: "业务字段",
    mobilePriority: 1,
    readonlyText: "按提交快照展示"
  }
};

const definition: BusinessEntrySceneDefinition = {
  key: "expense_line",
  entityType: "operating_takeover_row",
  name: "费用明细",
  description: "费用明细录入",
  version: 3,
  fields: [
    {
      ...fieldBase,
      key: "businessNo",
      label: "业务整理编号",
      type: "text",
      example: "整理-001",
      excel: { column: "业务整理编号", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "amountYuan",
      label: "金额",
      type: "money",
      unit: "元",
      precision: 2,
      example: "100.50",
      excel: { column: "金额（元）", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "status",
      label: "办理状态",
      type: "single_select",
      example: "待办理",
      options: [
        { value: "pending", label: "待办理" },
        { value: "completed", label: "已完成" }
      ],
      excel: { column: "办理状态", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "verified",
      label: "已经核实",
      type: "boolean",
      example: "是",
      excel: { column: "已经核实", paste: "multi", errorLocation: "cell" }
    }
  ],
  rules: []
};

function definitions(sceneDefinition: BusinessEntrySceneDefinition = definition) {
  return {
    getSceneDefinitionForOperation: jest.fn().mockResolvedValue(sceneDefinition),
    validateDraftBatch: jest.fn().mockImplementation(async (
      _sceneKey: string,
      _projectId: string,
      _actorUserId: string,
      inputs: Array<Omit<BusinessEntryDraftPayload, "sceneKey"> & { operation: "import" }>
    ): Promise<BusinessEntryValidationResult[]> => inputs.map((input) => ({
      valid: true,
      sceneKey: sceneDefinition.key,
      definitionVersion: sceneDefinition.version,
      values: input.values,
      errors: []
    })))
  };
}

async function workbookBuffer(rows: unknown[][], configure?: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("费用明细");
  rows.forEach((row) => worksheet.addRow(row));
  configure?.(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

function upload(buffer: Buffer, overrides: Partial<{
  originalname: string;
  mimetype: string;
  size: number;
}> = {}) {
  return {
    originalname: "费用明细.xlsx",
    mimetype: BUSINESS_ENTRY_XLSX_MIME,
    size: buffer.length,
    buffer,
    ...overrides
  };
}

describe("BusinessEntryExcelService", () => {
  it("rejects business-party definition probes from every Excel surface", async () => {
    const gateway = definitions();
    const service = new BusinessEntryExcelService(gateway as never);
    const target = { entityType: "business_party", createTarget: "definition-probe" };

    await expect(service.exportTemplate("business_party", undefined, "user-1", target))
      .rejects.toThrow("合作单位定义探针仅可用于读取最新字段定义");
    await expect(service.preview(
      "business_party",
      undefined,
      "user-1",
      { definitionVersion: 1, target },
      upload(Buffer.from("not-used"))
    )).rejects.toThrow("合作单位定义探针仅可用于读取最新字段定义");
    expect(gateway.getSceneDefinitionForOperation).not.toHaveBeenCalled();
  });

  it("generates one visible Chinese-only worksheet without a hidden technical layer", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const result = await service.exportTemplate(
      "expense_line",
      "project-1",
      "user-1",
      { entityType: "operating_takeover_row", entityId: "project-1" }
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets).toHaveLength(1);
    const worksheet = workbook.worksheets[0]!;
    expect(worksheet.state).toBe("visible");
    expect((worksheet as unknown as { sheetProtection: unknown }).sheetProtection).toBeFalsy();
    expect(worksheet.getRow(1).values).toEqual([
      undefined,
      "业务整理编号",
      "金额（元）",
      "办理状态",
      "已经核实"
    ]);
    expect(worksheet.columns.every((column) => !column.hidden)).toBe(true);
    expect(JSON.stringify(worksheet.getRow(1).values)).not.toMatch(
      /businessNo|amountYuan|status|verified|definitionVersion|sceneKey/
    );
    expect(worksheet.getColumn(2).numFmt).toBe("0.00");
    expect(worksheet.getCell("C3").dataValidation.formulae?.[0]).toContain("待办理");
  });

  it("uses the strictest definition bulk limit when generating template validations", async () => {
    const singleOnlyDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: definition.fields.slice(2).map((field, index) => ({
        ...field,
        bulk: {
          ...field.bulk,
          enabled: index !== 0,
          maxRows: index === 0 ? 50 : 2
        }
      }))
    };
    const service = new BusinessEntryExcelService(definitions(singleOnlyDefinition) as never);
    const result = await service.exportTemplate(
      "expense_line",
      "project-1",
      "user-1",
      { entityType: "operating_takeover_row", entityId: "project-1" }
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0]!;

    expect(worksheet.getCell("A3").dataValidation.type).toBe("list");
    expect(worksheet.getCell("B3").dataValidation.type).toBe("list");
    expect(worksheet.getCell("A4").dataValidation).toBeUndefined();
    expect(worksheet.getCell("B4").dataValidation).toBeUndefined();
    await expect(service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: singleOnlyDefinition.version,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(result.buffer)
    )).resolves.toEqual({ zeroWrites: true, rows: [] });
  });

  it("parses Chinese values into the unified DraftPayload and ignores the example row", async () => {
    const gateway = definitions();
    const service = new BusinessEntryExcelService(gateway as never);
    const buffer = await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"],
      ["整理-001", "100.50", "待办理", "是"],
      ["整理-002", 88.2, "已完成", "否"]
    ]);

    const result = await service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(buffer)
    );

    expect(result.zeroWrites).toBe(true);
    expect(result.rows).toEqual([
      {
        rowNumber: 3,
        valid: true,
        errors: [],
        payload: {
          sceneKey: "expense_line",
          definitionVersion: 3,
          target: { entityType: "operating_takeover_row", entityId: "project-1" },
          values: {
            businessNo: "整理-002",
            amountYuan: "88.2",
            status: "completed",
            verified: false
          }
        }
      }
    ]);
    expect(gateway.validateDraftBatch).toHaveBeenCalledWith(
      "expense_line",
      "project-1",
      "user-1",
      [expect.objectContaining({ operation: "import" })]
    );
  });

  it("keeps real Excel dates on the local calendar day and parses finite number fields", async () => {
    const dateAndNumberDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [
        {
          ...fieldBase,
          key: "occurredOn",
          label: "发生日期",
          type: "date",
          example: "2026-08-01",
          excel: { column: "发生日期", paste: "multi", errorLocation: "cell" }
        },
        {
          ...fieldBase,
          key: "quantity",
          label: "数量",
          type: "number",
          precision: 2,
          example: "1",
          excel: { column: "数量", paste: "multi", errorLocation: "cell" }
        }
      ]
    };
    const service = new BusinessEntryExcelService(definitions(dateAndNumberDefinition) as never);
    const buffer = await workbookBuffer([
      ["发生日期", "数量"],
      [new Date(2026, 7, 16), "12.5"],
      ["2026-08-17", "不是数字"]
    ]);

    const result = await service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(buffer)
    );

    expect(result.rows.map((row) => row.payload.values)).toEqual([
      { occurredOn: "2026-08-16", quantity: 12.5 },
      { occurredOn: "2026-08-17", quantity: "不是数字" }
    ]);
  });

  it("rejects non-XLSX metadata and invalid ZIP signatures before workbook parsing", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const input = {
      definitionVersion: 3,
      target: { entityType: "operating_takeover_row", entityId: "project-1" }
    };
    const buffer = await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"]
    ]);
    const preview = (file: ReturnType<typeof upload>) => service.preview(
      "expense_line",
      "project-1",
      "user-1",
      input,
      file
    );

    await expect(preview(upload(buffer, { originalname: "费用明细.xls" })))
      .rejects.toThrow("业务 Excel 只支持 XLSX 文件");
    await expect(preview(upload(buffer, { mimetype: "application/octet-stream" })))
      .rejects.toThrow("业务 Excel 只支持 XLSX 文件");
    await expect(preview(upload(Buffer.from("不是压缩包"))))
      .rejects.toThrow("业务 Excel 文件签名不正确");
  });

  it("rejects malicious XLSX archives before ExcelJS expands them", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const input = {
      definitionVersion: 3,
      target: { entityType: "operating_takeover_row", entityId: "project-1" }
    };
    const preview = (buffer: Buffer) => service.preview(
      "expense_line",
      "project-1",
      "user-1",
      input,
      upload(buffer)
    );

    const tooManyEntries = new PizZip();
    for (let index = 0; index < 501; index += 1) {
      tooManyEntries.file(`payload-${index}.xml`, "x");
    }
    await expect(preview(tooManyEntries.generate({ type: "nodebuffer" })))
      .rejects.toThrow("业务 Excel 压缩包结构异常或解压后内容过大");

    const oversizedExpandedArchive = new PizZip();
    const eighteenMegabytes = "x".repeat(18 * 1024 * 1024);
    for (let index = 0; index < 3; index += 1) {
      oversizedExpandedArchive.file(`payload-${index}.xml`, eighteenMegabytes);
    }
    await expect(preview(oversizedExpandedArchive.generate({
      type: "nodebuffer",
      compression: "DEFLATE"
    }))).rejects.toThrow("业务 Excel 压缩包结构异常或解压后内容过大");

    const forgedExpandedArchive = new PizZip();
    forgedExpandedArchive.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet><dimension ref="A1:D2"/>${" ".repeat(21 * 1024 * 1024)}</worksheet>`
    );
    const forgedBuffer = forgedExpandedArchive.generate({
      type: "nodebuffer",
      compression: "DEFLATE"
    });
    const centralHeaderOffset = forgedBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralHeaderOffset).toBeGreaterThanOrEqual(0);
    forgedBuffer.writeUInt32LE(1024, centralHeaderOffset + 24);
    await expect(preview(forgedBuffer))
      .rejects.toThrow("业务 Excel 压缩包结构异常或解压后内容过大");

    const tooManyDirectories = new PizZip();
    for (let index = 0; index < 501; index += 1) {
      tooManyDirectories.folder(`directory-${index}`);
    }
    tooManyDirectories.file(
      "xl/worksheets/sheet1.xml",
      "<worksheet><dimension ref=\"A1:D2\"/></worksheet>"
    );
    await expect(preview(tooManyDirectories.generate({ type: "nodebuffer" })))
      .rejects.toThrow("业务 Excel 压缩包结构异常或解压后内容过大");
  });

  it("rejects worksheet dimensions beyond the strictest definition row limit", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const buffer = await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"]
    ], (workbook) => {
      workbook.worksheets[0]!.getCell("A5000").value = "越界数据";
    });

    await expect(service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(buffer)
    )).rejects.toThrow("业务 Excel 工作表范围超过当前字段定义允许的上限");

    const sparseWorksheet = new PizZip();
    sparseWorksheet.file(
      "xl/worksheets/sheet1.xml",
      "<worksheet><dimension ref=\"A1:D2\"/><sheetData>" +
        "<row r=\"5000\"><c r=\"A5000\"><v>1</v></c></row>" +
        "</sheetData></worksheet>"
    );
    await expect(service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(sparseWorksheet.generate({ type: "nodebuffer" }))
    )).rejects.toThrow("业务 Excel 工作表范围超过当前字段定义允许的上限");

    const oversizedMerge = new PizZip();
    oversizedMerge.file(
      "xl/worksheets/sheet1.xml",
      "<worksheet><dimension ref=\"A1:D2\"/><sheetData/>" +
        "<mergeCells count=\"1\"><mergeCell ref=\"A1:A5000\"/></mergeCells>" +
        "</worksheet>"
    );
    await expect(service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(oversizedMerge.generate({ type: "nodebuffer" }))
    )).rejects.toThrow("业务 Excel 工作表范围超过当前字段定义允许的上限");

    const oversizedColumnModel = new PizZip();
    oversizedColumnModel.file(
      "xl/worksheets/sheet1.xml",
      "<worksheet><dimension ref=\"A1:D2\"/>" +
        "<cols><col min=\"1\" max=\"5000\" width=\"12\"/></cols>" +
        "<sheetData/></worksheet>"
    );
    await expect(service.preview(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      upload(oversizedColumnModel.generate({ type: "nodebuffer" }))
    )).rejects.toThrow("业务 Excel 工作表范围超过当前字段定义允许的上限");
  });

  it("uses bulk.enabled and the strictest maxRows for Excel just like grid and paste", async () => {
    const input = {
      definitionVersion: 3,
      target: { entityType: "operating_takeover_row", entityId: "project-1" }
    };
    const limitedDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: definition.fields.map((field, index) => ({
        ...field,
        bulk: { ...field.bulk, maxRows: index === 0 ? 3 : 2 }
      }))
    };
    const limitedService = new BusinessEntryExcelService(definitions(limitedDefinition) as never);
    const threeRows = await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"],
      ["整理-002", "2", "待办理", "是"],
      ["整理-003", "3", "待办理", "是"],
      ["整理-004", "4", "待办理", "是"]
    ]);
    await expect(limitedService.preview(
      "expense_line", "project-1", "user-1", input, upload(threeRows)
    )).rejects.toThrow("批量录入最多允许 2 条业务数据");

    const singleOnlyDefinition: BusinessEntrySceneDefinition = {
      ...limitedDefinition,
      fields: limitedDefinition.fields.map((field, index) => index === 0
        ? { ...field, bulk: { ...field.bulk, enabled: false } }
        : field)
    };
    const singleOnlyService = new BusinessEntryExcelService(
      definitions(singleOnlyDefinition) as never
    );
    const twoRows = await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"],
      ["整理-002", "2", "待办理", "是"],
      ["整理-003", "3", "待办理", "是"]
    ]);
    await expect(singleOnlyService.preview(
      "expense_line", "project-1", "user-1", input, upload(twoRows)
    )).rejects.toThrow("当前业务字段只能逐条录入");
  });

  it("fails closed for hidden sheets, hidden columns, formulas, and technical headers", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const input = {
      definitionVersion: 3,
      target: { entityType: "operating_takeover_row", entityId: "project-1" }
    };
    const preview = (buffer: Buffer) => service.preview(
      "expense_line",
      "project-1",
      "user-1",
      input,
      upload(buffer)
    );

    await expect(preview(await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实", "sceneKey"]
    ]))).rejects.toThrow(BadRequestException);

    await expect(preview(await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"],
      ["整理-002", { formula: "1+1", result: 2 }, "待办理", "是"]
    ]))).rejects.toThrow("Excel 中不能填写公式");

    await expect(preview(await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"],
      ["整理-002", "10.00", "pending", "是"]
    ]))).rejects.toThrow("Excel 只能填写中文业务选项");

    await expect(preview(await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"]
    ], (workbook) => {
      workbook.addWorksheet("内部编号").state = "hidden";
    }))).rejects.toThrow("Excel 只能包含一个可见业务工作表");

    await expect(preview(await workbookBuffer([
      ["业务整理编号", "金额（元）", "办理状态", "已经核实"]
    ], (workbook) => {
      workbook.worksheets[0]!.getColumn(4).hidden = true;
    }))).rejects.toThrow("Excel 不能包含隐藏列");
  });
});
