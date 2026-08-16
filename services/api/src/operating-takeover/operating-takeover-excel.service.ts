import { BadRequestException, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import {
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  type OperatingTakeoverSceneKey
} from "@jiangkong/shared-domain";

export const OPERATING_TAKEOVER_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Injectable()
export class OperatingTakeoverExcelService {
  async exportTemplate(sceneKey?: string) {
    const definitions = sceneKey
      ? OPERATING_TAKEOVER_SCENE_DEFINITIONS.filter((definition) => definition.key === sceneKey)
      : OPERATING_TAKEOVER_SCENE_DEFINITIONS;
    if (!definitions.length) throw new BadRequestException("历史接管场景不存在");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "建工智管";
    for (const definition of definitions) {
      const worksheet = workbook.addWorksheet(definition.name.slice(0, 31));
      const fields = [...definition.fields].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
      worksheet.addRow(fields.map((field) => field.label));
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B87" } };
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
      worksheet.columns = fields.map((field) => ({ header: field.label, key: field.key, width: Math.max(14, Math.min(30, field.label.length * 2 + 8)) }));
      worksheet.addRow(fields.map(() => ""));
    }
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: sceneKey ? `历史经营接管-${sceneKey}-导入模板.xlsx` : "历史经营接管-组合导入模板.xlsx"
    };
  }

  async parse(buffer: Buffer, sceneKey?: string) {
    if (!buffer?.length) throw new BadRequestException("Excel 文件为空");
    if (buffer.length > 10 * 1024 * 1024) throw new BadRequestException("Excel 文件超过 10MB");
    const workbook = new ExcelJS.Workbook();
    try {
      // ExcelJS 4.4 declares the pre-generic Node Buffer type.
      // @ts-expect-error The runtime accepts the current Node Buffer implementation.
      await workbook.xlsx.load(buffer);
    } catch {
      throw new BadRequestException("Excel 文件无法读取，请使用系统模板");
    }
    const rows: Array<{ sceneKey: OperatingTakeoverSceneKey; values: Record<string, unknown> }> = [];
    for (const worksheet of workbook.worksheets) {
      const definition = this.definitionForWorksheet(worksheet.name, sceneKey);
      if (!definition) continue;
      const headers = this.headers(worksheet, definition);
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const values: Record<string, unknown> = {};
        let hasValue = false;
        for (const [column, key] of headers.entries()) {
          const value = this.cellValue(row.getCell(column).value);
          if (value !== undefined && value !== "") hasValue = true;
          values[key] = value;
        }
        if (hasValue) rows.push({ sceneKey: definition.key, values });
      }
    }
    if (!rows.length) throw new BadRequestException("Excel 中没有可导入的业务行");
    return { rows };
  }

  private definitionForWorksheet(name: string, sceneKey?: string) {
    if (sceneKey) return OPERATING_TAKEOVER_SCENE_DEFINITIONS.find((definition) => definition.key === sceneKey);
    return OPERATING_TAKEOVER_SCENE_DEFINITIONS.find((definition) => definition.name === name);
  }

  private headers(worksheet: ExcelJS.Worksheet, definition: (typeof OPERATING_TAKEOVER_SCENE_DEFINITIONS)[number]) {
    const headerRow = worksheet.getRow(1);
    const map = new Map<number, string>();
    const fieldByLabel = new Map(definition.fields.map((field) => [field.label, field.key]));
    for (let column = 1; column <= headerRow.cellCount; column += 1) {
      const label = String(headerRow.getCell(column).text ?? "").trim();
      const key = fieldByLabel.get(label);
      if (key) map.set(column, key);
    }
    return map;
  }

  private cellValue(value: ExcelJS.CellValue): unknown {
    if (value === null || value === undefined) return undefined;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      if ("result" in value) return this.cellValue(value.result as ExcelJS.CellValue);
      return String(value);
    }
    return value;
  }
}
