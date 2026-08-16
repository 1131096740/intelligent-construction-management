import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import { BusinessEntryExcelService } from "./business-entry-excel.service";

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

function definitions() {
  return {
    getSceneDefinitionForOperation: jest.fn().mockResolvedValue(definition),
    validateDraftBatch: jest.fn().mockImplementation(async (
      _sceneKey: string,
      _projectId: string,
      _actorUserId: string,
      inputs: Array<Omit<BusinessEntryDraftPayload, "sceneKey"> & { operation: "import" }>
    ): Promise<BusinessEntryValidationResult[]> => inputs.map((input) => ({
      valid: true,
      sceneKey: definition.key,
      definitionVersion: definition.version,
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

describe("BusinessEntryExcelService", () => {
  it("generates one visible Chinese-only worksheet without a hidden technical layer", async () => {
    const service = new BusinessEntryExcelService(definitions() as never);
    const result = await service.exportTemplate("expense_line", "project-1", "user-1");
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
      buffer
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
      buffer
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
