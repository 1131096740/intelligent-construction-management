import { BadRequestException, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import type {
  BusinessEntryDraftPayload,
  BusinessEntryFieldDefinition,
  BusinessEntryOperation,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget,
  BusinessEntryValidationError
} from "@jiangkong/shared-domain";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import type { MemoryUploadedFile } from "../file/uploaded-file";

export const BUSINESS_ENTRY_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_UNBOUNDED_WORKSHEET_ROWS = 10_000;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ZIP_END_RECORD_BYTES = 65_557;

export interface BusinessEntryExcelPreviewInput {
  definitionVersion: number;
  target: BusinessEntrySubmissionTarget;
}

export type BusinessEntryExcelUpload = Pick<
  MemoryUploadedFile,
  "originalname" | "mimetype" | "size" | "buffer"
>;

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

function bulkLimit(fields: readonly BusinessEntryFieldDefinition[]) {
  if (fields.some((field) => !field.bulk.enabled)) {
    return { maximumRows: 1, singleOnly: true };
  }
  return {
    maximumRows: Math.min(...fields.map(
      (field) => field.bulk.maxRows ?? Number.POSITIVE_INFINITY
    )),
    singleOnly: false
  };
}

function assertBulkRowCount(
  fields: readonly BusinessEntryFieldDefinition[],
  rowCount: number
) {
  if (rowCount <= 1) return;
  const limit = bulkLimit(fields);
  if (limit.singleOnly) throw new BadRequestException("当前业务字段只能逐条录入");
  if (Number.isFinite(limit.maximumRows) && rowCount > limit.maximumRows) {
    throw new BadRequestException(`批量录入最多允许 ${limit.maximumRows} 条业务数据`);
  }
}

function worksheetColumnNumber(letters: string) {
  return [...letters.toUpperCase()].reduce(
    (result, letter) => result * 26 + letter.charCodeAt(0) - 64,
    0
  );
}

function isFormula(value: ExcelJS.CellValue): value is ExcelJS.CellFormulaValue {
  return Boolean(value && typeof value === "object" && "formula" in value);
}

function cellText(cell: ExcelJS.Cell): string {
  if (isFormula(cell.value)) throw new BadRequestException("Excel 中不能填写公式");
  if (cell.value instanceof Date) {
    const year = String(cell.value.getFullYear()).padStart(4, "0");
    const month = String(cell.value.getMonth() + 1).padStart(2, "0");
    const day = String(cell.value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
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
  if (field.type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
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

  private assertDefinitionProbeOnly(sceneKey: string) {
    if (sceneKey === "business_party") {
      throw new BadRequestException("合作单位定义探针仅可用于读取最新字段定义");
    }
  }

  async exportTemplate(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    target: BusinessEntrySubmissionTarget
  ): Promise<{ buffer: Buffer; fileName: string }> {
    this.assertDefinitionProbeOnly(sceneKey);
    const definition = await this.definitions.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      actorUserId,
      "import",
      target
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
    const definitionBulkLimit = bulkLimit(fields);
    const templateRows = Number.isFinite(definitionBulkLimit.maximumRows)
      ? definitionBulkLimit.maximumRows
      : 1000;

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
        for (let row = 3; row <= templateRows + 2; row += 1) {
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
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryExcelPreviewInput,
    file: BusinessEntryExcelUpload
  ): Promise<BusinessEntryExcelPreviewResult> {
    this.assertDefinitionProbeOnly(sceneKey);
    this.assertExcelUpload(file);
    const definition = await this.definitions.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      actorUserId,
      "import",
      input.target
    );
    const fields = importableFields(definition);
    const buffer = file.buffer;
    this.assertSafeXlsxArchive(buffer, fields);
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

    assertBulkRowCount(fields, parsedRows.length);

    const operation: BusinessEntryOperation = "import";
    const validationInputs = parsedRows.length > 0
      ? parsedRows.map((row) => ({
          definitionVersion: input.definitionVersion,
          target: input.target,
          values: row.values,
          operation
        }))
      : [{
          definitionVersion: input.definitionVersion,
          target: input.target,
          values: {},
          operation
        }];
    const results = await this.definitions.validateDraftBatch(
      sceneKey,
      projectId,
      actorUserId,
      validationInputs
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

  private assertExcelUpload(file: BusinessEntryExcelUpload) {
    if (
      !file.originalname.toLowerCase().endsWith(".xlsx") ||
      file.mimetype !== BUSINESS_ENTRY_XLSX_MIME
    ) {
      throw new BadRequestException("业务 Excel 只支持 XLSX 文件");
    }
    if (file.size !== file.buffer.length || file.buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException("业务 Excel 文件大小不正确或超过 10 MB");
    }
    if (
      file.buffer.length < 4 ||
      file.buffer[0] !== 0x50 ||
      file.buffer[1] !== 0x4b ||
      file.buffer[2] !== 0x03 ||
      file.buffer[3] !== 0x04
    ) {
      throw new BadRequestException("业务 Excel 文件签名不正确");
    }
  }

  private assertSafeXlsxArchive(
    buffer: Buffer,
    fields: readonly BusinessEntryFieldDefinition[]
  ) {
    const invalidArchive = () => new BadRequestException(
      "业务 Excel 压缩包结构异常或解压后内容过大"
    );
    try {
      const eocdOffset = this.findZipEndRecord(buffer);
      if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) throw invalidArchive();
      const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
      const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
      const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
      const entryCount = buffer.readUInt16LE(eocdOffset + 10);
      const centralDirectoryBytes = buffer.readUInt32LE(eocdOffset + 12);
      const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
      const commentBytes = buffer.readUInt16LE(eocdOffset + 20);
      if (
        diskNumber !== 0 ||
        centralDirectoryDisk !== 0 ||
        entriesOnDisk !== entryCount ||
        entryCount === 0 ||
        entryCount > MAX_ZIP_ENTRIES ||
        eocdOffset + 22 + commentBytes !== buffer.length ||
        centralDirectoryOffset + centralDirectoryBytes > eocdOffset
      ) {
        throw invalidArchive();
      }

      const limit = bulkLimit(fields);
      const maximumRows = Number.isFinite(limit.maximumRows)
        ? limit.maximumRows + 2
        : MAX_UNBOUNDED_WORKSHEET_ROWS + 2;
      const seenNames = new Set<string>();
      let cursor = centralDirectoryOffset;
      let totalUncompressedBytes = 0;
      let worksheetCount = 0;
      for (let index = 0; index < entryCount; index += 1) {
        if (
          cursor + 46 > eocdOffset ||
          buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER
        ) {
          throw invalidArchive();
        }
        const flags = buffer.readUInt16LE(cursor + 8);
        const compressionMethod = buffer.readUInt16LE(cursor + 10);
        const compressedBytes = buffer.readUInt32LE(cursor + 20);
        const declaredUncompressedBytes = buffer.readUInt32LE(cursor + 24);
        const nameBytes = buffer.readUInt16LE(cursor + 28);
        const extraBytes = buffer.readUInt16LE(cursor + 30);
        const entryCommentBytes = buffer.readUInt16LE(cursor + 32);
        const entryDisk = buffer.readUInt16LE(cursor + 34);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        const nextCursor = cursor + 46 + nameBytes + extraBytes + entryCommentBytes;
        if (
          nextCursor > centralDirectoryOffset + centralDirectoryBytes ||
          entryDisk !== 0 ||
          (flags & 0x0001) !== 0 ||
          ![0, 8].includes(compressionMethod) ||
          declaredUncompressedBytes > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES
        ) {
          throw invalidArchive();
        }
        const nameBuffer = buffer.subarray(cursor + 46, cursor + 46 + nameBytes);
        const name = nameBuffer.toString("utf8");
        if (!name || seenNames.has(name)) throw invalidArchive();
        seenNames.add(name);

        if (
          localHeaderOffset + 30 > centralDirectoryOffset ||
          buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER ||
          buffer.readUInt16LE(localHeaderOffset + 8) !== compressionMethod
        ) {
          throw invalidArchive();
        }
        const localNameBytes = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraBytes = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataOffset = localHeaderOffset + 30 + localNameBytes + localExtraBytes;
        const dataEnd = dataOffset + compressedBytes;
        if (
          dataEnd > centralDirectoryOffset ||
          !buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameBytes)
            .equals(nameBuffer)
        ) {
          throw invalidArchive();
        }
        const compressed = buffer.subarray(dataOffset, dataEnd);
        const uncompressed = compressionMethod === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1
            });
        if (uncompressed.length !== declaredUncompressedBytes) throw invalidArchive();
        totalUncompressedBytes += uncompressed.length;
        if (totalUncompressedBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
          throw invalidArchive();
        }

        if (/^xl\/worksheets\/sheet\d+\.xml$/iu.test(name)) {
          worksheetCount += 1;
          this.assertWorksheetBounds(uncompressed.toString("utf8"), maximumRows, fields.length);
        }
        cursor = nextCursor;
      }
      if (
        cursor !== centralDirectoryOffset + centralDirectoryBytes ||
        worksheetCount === 0
      ) {
        throw invalidArchive();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw invalidArchive();
    }
  }

  private findZipEndRecord(buffer: Buffer) {
    const firstCandidate = Math.max(0, buffer.length - MAX_ZIP_END_RECORD_BYTES);
    for (let offset = buffer.length - 22; offset >= firstCandidate; offset -= 1) {
      if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
    }
    return -1;
  }

  private assertWorksheetBounds(xml: string, maximumRows: number, maximumColumns: number) {
    const invalidWorksheet = () => new BadRequestException(
      "业务 Excel 工作表范围超过当前字段定义允许的上限"
    );
    if (/<mergeCell\b/iu.test(xml)) throw invalidWorksheet();
    const dimension = /<dimension\b[^>]*\bref=["']([^"']+)["']/iu.exec(xml)?.[1];
    const lastCell = dimension?.split(":").at(-1)?.replace(/\$/gu, "");
    const dimensionMatch = /^([A-Z]+)(\d+)$/iu.exec(lastCell ?? "");
    if (
      !dimensionMatch ||
      Number(dimensionMatch[2]) > maximumRows ||
      worksheetColumnNumber(dimensionMatch[1]!) > maximumColumns
    ) {
      throw invalidWorksheet();
    }

    let columnDefinitionCount = 0;
    for (const match of xml.matchAll(/<col\b([^>]*)\/?\s*>/giu)) {
      columnDefinitionCount += 1;
      const minimum = Number(/\bmin=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1]);
      const maximum = Number(/\bmax=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1]);
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        minimum < 1 ||
        minimum > maximum ||
        maximum > maximumColumns ||
        columnDefinitionCount > maximumColumns
      ) {
        throw invalidWorksheet();
      }
    }

    let rowCount = 0;
    for (const match of xml.matchAll(/<row\b([^>]*)>/giu)) {
      rowCount += 1;
      const rowNumber = /\br=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1];
      if (!rowNumber || rowCount > maximumRows || Number(rowNumber) > maximumRows) {
        throw invalidWorksheet();
      }
    }
    for (const match of xml.matchAll(/<c\b([^>]*)>/giu)) {
      const reference = /\br=["']\$?([A-Z]+)\$?(\d+)["']/iu.exec(match[1] ?? "");
      if (
        !reference ||
        Number(reference[2]) > maximumRows ||
        worksheetColumnNumber(reference[1]!) > maximumColumns
      ) {
        throw invalidWorksheet();
      }
    }
  }
}
