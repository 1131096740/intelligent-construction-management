import { BadRequestException, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import type {
  BusinessEntryDraftPayload,
  BusinessEntryFieldDefinition,
  BusinessEntryOperation,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget,
  BusinessEntryValidationError
} from "@jiangkong/shared-domain";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";

export const BUSINESS_ENTRY_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface BusinessEntryExcelPreviewInput {
  definitionVersion: number;
  target: BusinessEntrySubmissionTarget;
}

export interface BusinessEntryExcelPreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: Array<{ fieldKey?: string; column: string; message: string }>;
  payload: BusinessEntryDraftPayload;
}

export interface BusinessEntryExcelPreviewResult {
  zeroWrites: true;
  rows: BusinessEntryExcelPreviewRow[];
}

function safeWorksheetName(value: string) {
  const normalized = value.replace(/[\\/?*:[\]]/gu, "").trim() || "业务草稿";
  return normalized.slice(0, 31);
}

function safeFileName(value: string) {
  return `${value.replace(/[\\/:*?"<>|]/gu, "-").trim() || "业务草稿"}模板.xlsx`;
}

function importableFields(definition: BusinessEntrySceneDefinition) {
  const fields = definition.fields.filter((field) => !field.readOnly);
  for (const field of fields) {
    if (
      field.excel.column === field.key ||
      !/[\u3400-\u9FFF]/u.test(field.excel.column)
    ) {
      throw new BadRequestException("业务字段定义未提供中文 Excel 列名");
    }
  }
  return fields;
}

function isFormula(value: ExcelJS.CellValue): value is ExcelJS.CellFormulaValue {
  return Boolean(value && typeof value === "object" && "formula" in value);
}

function cellText(cell: ExcelJS.Cell): string {
  if (isFormula(cell.value)) throw new BadRequestException("Excel 中不能填写公式");
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "object") return cell.text;
  return String(cell.value);
}

function normalizeImportedValue(field: BusinessEntryFieldDefinition, raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  if (field.type === "boolean") {
    if (value === "是") return true;
    if (value === "否") return false;
    return value;
  }
  if (field.type === "single_select") {
    const option = field.options?.find((candidate) => candidate.label === value);
    if (option) return option.value;
    if (field.options?.some((candidate) => candidate.value === value)) {
      throw new BadRequestException(`Excel 只能填写中文业务选项：${field.label}`);
    }
    return value;
  }
  if (field.type === "multi_select") {
    return value.split(/[、，,;；]/u).map((item) => {
      const normalized = item.trim();
      const option = field.options?.find((candidate) => candidate.label === normalized);
      if (option) return option.value;
      if (field.options?.some((candidate) => candidate.value === normalized)) {
        throw new BadRequestException(`Excel 只能填写中文业务选项：${field.label}`);
      }
      return normalized;
    }).filter(Boolean);
  }
  return value;
}

function exampleValues(fields: readonly BusinessEntryFieldDefinition[]) {
  return fields.map((field) => normalizeImportedValue(field, field.example));
}

function sameValues(left: readonly unknown[], right: readonly unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldForError(
  definition: BusinessEntrySceneDefinition,
  error: BusinessEntryValidationError
) {
  if (error.fieldKey) return definition.fields.find((field) => field.key === error.fieldKey);
  const rule = error.ruleKey
    ? definition.rules.find((candidate) => candidate.key === error.ruleKey)
    : undefined;
  const fieldKey = rule
    ? "fieldKey" in rule
      ? rule.fieldKey
      : rule.leftFieldKey
    : undefined;
  return fieldKey ? definition.fields.find((field) => field.key === fieldKey) : undefined;
}

@Injectable()
export class BusinessEntryExcelService {
  constructor(private readonly definitions: BusinessEntryDefinitionService) {}

  async exportTemplate(
    sceneKey: string,
    projectId: string,
    actorUserId: string
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const definition = await this.definitions.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      actorUserId,
      "import"
    );
    const fields = importableFields(definition);
    if (!fields.length) throw new BadRequestException("当前岗位没有可导入的业务字段");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "建工智管";
    const worksheet = workbook.addWorksheet(safeWorksheetName(definition.name), {
      state: "visible",
      views: [{ state: "frozen", ySplit: 2 }]
    });
    worksheet.addRow(fields.map((field) => field.excel.column));
    worksheet.addRow(fields.map((field) => field.example));
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(2).font = { italic: true, color: { argb: "FF666666" } };
    worksheet.getRow(2).height = 22;

    fields.forEach((field, index) => {
      const column = worksheet.getColumn(index + 1);
      column.width = Math.max(14, Math.min(32, field.excel.column.length * 2 + 4));
      if (field.type === "money") column.numFmt = `0.${"0".repeat(Math.max(0, field.precision))}`;
      if (field.type === "date") column.numFmt = "yyyy-mm-dd";
      worksheet.getCell(1, index + 1).note = [
        field.description,
        field.required ? "此项必填" : "此项选填",
        field.type === "money" ? "金额单位：元" : field.unit ? `业务单位：${field.unit}` : ""
      ].filter(Boolean).join("；");

      const labels = field.type === "boolean"
        ? ["是", "否"]
        : field.options?.map((option) => option.label) ?? [];
      const formula = `"${labels.join(",").replace(/"/gu, "''")}"`;
      if (labels.length && formula.length <= 255) {
        for (let row = 3; row <= (field.bulk.maxRows ?? 1000) + 2; row += 1) {
          worksheet.getCell(row, index + 1).dataValidation = {
            type: "list",
            allowBlank: !field.required,
            formulae: [formula],
            showErrorMessage: true,
            errorTitle: "请选择中文业务选项",
            error: `请从下拉列表选择${field.label}`
          };
        }
      }
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
    return { buffer, fileName: safeFileName(definition.name) };
  }

  async preview(
    sceneKey: string,
    projectId: string,
    actorUserId: string,
    input: BusinessEntryExcelPreviewInput,
    buffer: Buffer
  ): Promise<BusinessEntryExcelPreviewResult> {
    const definition = await this.definitions.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      actorUserId,
      "import"
    );
    const fields = importableFields(definition);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("无法读取 Excel，请使用系统下载的中文模板");
    }
    if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.state !== "visible") {
      throw new BadRequestException("Excel 只能包含一个可见业务工作表");
    }
    const worksheet = workbook.worksheets[0]!;
    if ((worksheet as unknown as { sheetProtection: unknown }).sheetProtection) {
      throw new BadRequestException("Excel 不能包含受保护单元格");
    }
    if (worksheet.columns.some((column) => column.hidden)) {
      throw new BadRequestException("Excel 不能包含隐藏列");
    }
    for (let row = 1; row <= worksheet.actualRowCount; row += 1) {
      if (worksheet.getRow(row).hidden) throw new BadRequestException("Excel 不能包含隐藏行");
    }

    const headers = Array.from(
      { length: worksheet.actualColumnCount },
      (_unused, index) => cellText(worksheet.getCell(1, index + 1)).trim()
    );
    const expectedHeaders = fields.map((field) => field.excel.column);
    if (!sameValues(headers, expectedHeaders)) {
      throw new BadRequestException("Excel 列与当前中文业务模板不一致，请重新下载模板");
    }

    const examples = exampleValues(fields);
    const parsedRows: Array<{ rowNumber: number; values: Record<string, unknown> }> = [];
    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
      const raw = fields.map((_field, index) => cellText(worksheet.getCell(rowNumber, index + 1)));
      if (raw.every((value) => !value.trim())) continue;
      const values = fields.map((field, index) => normalizeImportedValue(field, raw[index]!));
      if (rowNumber === 2 && sameValues(values, examples)) continue;
      parsedRows.push({
        rowNumber,
        values: Object.fromEntries(fields.map((field, index) => [field.key, values[index]]))
      });
    }

    const maximumRows = Math.min(...fields.map((field) =>
      field.bulk.enabled ? field.bulk.maxRows ?? Number.POSITIVE_INFINITY : 1
    ));
    if (Number.isFinite(maximumRows) && parsedRows.length > maximumRows) {
      throw new BadRequestException(`Excel 最多允许填写 ${maximumRows} 条业务数据`);
    }

    const operation: BusinessEntryOperation = "import";
    const results = await this.definitions.validateDraftBatch(
      sceneKey,
      projectId,
      actorUserId,
      parsedRows.map((row) => ({
        definitionVersion: input.definitionVersion,
        target: input.target,
        values: row.values,
        operation
      }))
    );
    return {
      zeroWrites: true,
      rows: parsedRows.map((row, index) => {
        const result = results[index]!;
        return {
          rowNumber: row.rowNumber,
          valid: result.valid,
          errors: result.errors.map((error) => {
            const field = fieldForError(definition, error);
            return {
              ...(field ? { fieldKey: field.key } : {}),
              column: field?.excel.column ?? "整行",
              message: error.message
            };
          }),
          payload: {
            sceneKey,
            definitionVersion: result.definitionVersion ?? input.definitionVersion,
            target: { ...input.target },
            values: result.values
          }
        };
      })
    };
  }
}
