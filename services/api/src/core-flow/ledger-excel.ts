import * as ExcelJS from "exceljs";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 业务台账导出的单元格类型。
 *
 * - `text`：业务文本，写入前做公式注入转义；
 * - `number`：金额/数量，可参与合计；超出 Excel 数值精度时按文本写入；
 * - `date`：日期，写入日期单元格（可排序/筛选）。
 *
 * 未知值（`null`/`undefined`/空串）永远保持空白或原有业务文案，
 * 不在这里被转换成 `0`；无法解析为数字的非空文案按文本写入，
 * 合计使用已知的原始数值，包括按文本写入的高精度金额。
 */
export type LedgerCellKind = "text" | "number" | "date";

export interface LedgerExcelColumn<Row> {
  header: string;
  key: keyof Row | string;
  width?: number;
  kind?: LedgerCellKind;
  /** ExcelJS numFmt，例如金额 `#,##0.0000`、日期 `yyyy-mm-dd`。 */
  numFmt?: string;
  align?: "left" | "center" | "right";
  /** 必要业务列：即使用户隐藏也始终导出（UI-14/A32）。 */
  required?: boolean;
  /** 参与合计行：仅累加能解析为数值的单元格。 */
  total?: "sum";
}

export interface LedgerExcelTotalsOptions {
  /** 合计行标签，默认「合计」。 */
  label?: string;
  /** 合计口径说明，例如「不含待确定金额」。 */
  note?: string;
}

export interface LedgerExcelPrintOptions {
  landscape?: boolean;
  paperSize?: number;
  fitToWidth?: number;
  fitToHeight?: number;
  repeatHeaderRow?: boolean;
}

export const LEDGER_MONEY_FORMAT = "#,##0.0000";
export const LEDGER_DATE_FORMAT = "yyyy-mm-dd";

// eslint-disable-next-line no-control-regex -- Detect leading tab and carriage return before spreadsheet formulas.
const FORMULA_PREFIX = /^[\u0009\u000D\u0020]*[=+\-@]/u;

/**
 * 业务文本防公式注入（OWASP：`=`、`+`、`-`、`@` 及前导 Tab/回车）。
 *
 * 命中时在文本前加单引号，Excel 按纯文本展示；不影响 `null`/空串，
 * 也不把业务文本改写成数字。
 */
export function escapeSpreadsheetText(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** 台账排序用的近似数值。工作簿写入与合计使用原始十进制值。 */
export function ledgerNumericCellValue(value: unknown): number | null {
  const text = ledgerDecimalText(value);
  return text === null ? null : Number(text);
}

function ledgerDecimalText(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "toFixed" in value && typeof value.toFixed === "function") {
    value = value.toString();
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  const text = String(value).trim().replace(/[¥￥,\s]/gu, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) return null;
  return Number.isFinite(Number(text)) ? text : null;
}

type LedgerDecimal = { units: bigint; scale: number };

function readLedgerDecimal(value: unknown): LedgerDecimal | null {
  const text = ledgerDecimalText(value);
  if (text === null) return null;
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa.split(".");
  const shift = Number(exponent);
  // 超出原数值范围的指数不属于台账金额/数量，也不展开成超长文本。
  if (shift < -324 || shift > 308) return null;
  const units = BigInt(`${integer}${fraction}`);
  const scale = fraction.length - shift;
  return scale >= 0 ? { units, scale } : { units: units * 10n ** BigInt(-scale), scale: 0 };
}

function writeLedgerDecimal(cell: ExcelJS.Cell, value: LedgerDecimal, numFmt: string) {
  const { units, scale } = value;
  const unsignedDigits = (units < 0n ? -units : units).toString();
  const digits = unsignedDigits.padStart(scale + 1, "0");
  const magnitude = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  const text = units < 0n ? `-${magnitude}` : magnitude;
  const significantDigits = unsignedDigits.replace(/0+$/u, "").length;
  const numeric = Number(text);
  // 仅写入可以由 Excel 数值单元格精确表示的值。已校验的十进制文本没有公式。
  if (significantDigits <= 15 && Number.isFinite(numeric) && (numeric !== 0 || units === 0n)) {
    cell.numFmt = numFmt;
    cell.value = numeric;
  } else {
    cell.numFmt = "@";
    cell.value = text;
  }
}

/** 把 ISO 字符串/Date 解析成日期单元格；无效返回 `null`。 */
export function ledgerDateCellValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 生成统一业务台账工作簿：中文表头、列宽、冻结首行、自动筛选、
 * 数值/日期单元格、合计行、打印布局与公式注入转义。
 */
export async function buildLedgerWorkbook<Row extends Record<string, unknown>>(input: {
  sheetName: string;
  columns: readonly LedgerExcelColumn<Row>[];
  rows: readonly Row[];
  totals?: LedgerExcelTotalsOptions | false;
  print?: LedgerExcelPrintOptions;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "建工智管";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(input.sheetName);
  sheet.columns = input.columns.map((column) => ({
    header: column.header,
    key: String(column.key),
    width: column.width ?? 18
  }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: input.columns.length }
  };

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FF1F2329" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF2F3F5" }
  };
  header.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of input.rows) {
    const worksheetRow = sheet.addRow(
      input.columns.map((column) => row[column.key as keyof Row] ?? null)
    );
    worksheetRow.height = 22;
    worksheetRow.alignment = { vertical: "middle", wrapText: true };
    input.columns.forEach((column, index) => {
      const cell = worksheetRow.getCell(index + 1);
      applyLedgerCell(cell, column, row[column.key as keyof Row]);
    });
  }

  if (input.totals !== false) {
    const sumColumns = input.columns.filter((column) => column.total === "sum");
    if (sumColumns.length > 0) {
      appendTotalsRow(sheet, input.columns, sumColumns, input.rows, input.totals ?? {});
    }
  }

  applyPrintLayout(sheet, input.print);

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFDCDCDC" } },
        left: { style: "thin", color: { argb: "FFDCDCDC" } },
        bottom: { style: "thin", color: { argb: "FFDCDCDC" } },
        right: { style: "thin", color: { argb: "FFDCDCDC" } }
      };
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function applyLedgerCell<Row>(
  cell: ExcelJS.Cell,
  column: LedgerExcelColumn<Row>,
  raw: unknown
) {
  const align = column.align ?? (column.kind === "number" ? "right" : undefined);
  if (align) cell.alignment = { vertical: "middle", horizontal: align };
  if (column.kind === "number") {
    cell.numFmt = column.numFmt ?? LEDGER_MONEY_FORMAT;
    const numeric = readLedgerDecimal(raw);
    if (numeric !== null) {
      writeLedgerDecimal(cell, numeric, cell.numFmt);
      return;
    }
    // 未知值保持原始业务文案（如「待确定」「不设合同总价」），绝不写 0。
    cell.value = isNonEmptyText(raw) ? escapeSpreadsheetText(raw) : null;
    return;
  }
  if (column.kind === "date") {
    cell.numFmt = column.numFmt ?? LEDGER_DATE_FORMAT;
    const date = ledgerDateCellValue(raw);
    cell.value = date;
    return;
  }
  cell.value = raw === null || raw === undefined ? null : escapeSpreadsheetText(String(raw));
}

function appendTotalsRow<Row>(
  sheet: ExcelJS.Worksheet,
  columns: readonly LedgerExcelColumn<Row>[],
  sumColumns: readonly LedgerExcelColumn<Row>[],
  rows: readonly Row[],
  options: LedgerExcelTotalsOptions
) {
  const totalsRow = sheet.addRow(columns.map(() => null));
  totalsRow.height = 24;
  totalsRow.font = { bold: true };
  totalsRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFF7E6" }
  };
  const label = options.note ? `${options.label ?? "合计"}（${options.note}）` : (options.label ?? "合计");
  totalsRow.getCell(1).value = escapeSpreadsheetText(label);
  totalsRow.getCell(1).font = { bold: true };
  for (const column of sumColumns) {
    const index = columnIndex(columns, column);
    let sum: LedgerDecimal | null = null;
    for (const row of rows) {
      const value = readLedgerDecimal(row[column.key as keyof Row]);
      if (value === null) continue;
      if (sum === null) {
        sum = value;
        continue;
      }
      const scale = Math.max(sum.scale, value.scale);
      sum = {
        units: sum.units * 10n ** BigInt(scale - sum.scale) + value.units * 10n ** BigInt(scale - value.scale),
        scale
      };
    }
    // 没有任何已知数值时保持空白，不把「未知」写成 0。
    if (sum === null) continue;
    const cell = totalsRow.getCell(index);
    writeLedgerDecimal(cell, sum, column.numFmt ?? LEDGER_MONEY_FORMAT);
    cell.alignment = { vertical: "middle", horizontal: "right" };
    cell.font = { bold: true };
  }
}

function columnIndex<Row>(
  columns: readonly LedgerExcelColumn<Row>[],
  column: LedgerExcelColumn<Row>
) {
  const index = columns.indexOf(column);
  if (index < 0) throw new Error("台账列不存在");
  return index + 1;
}

function applyPrintLayout(
  sheet: ExcelJS.Worksheet,
  options: LedgerExcelPrintOptions | undefined
) {
  if (options === undefined) return;
  sheet.pageSetup = {
    paperSize: options.paperSize ?? 9,
    orientation: options.landscape === false ? "portrait" : "landscape",
    fitToPage: true,
    fitToWidth: options.fitToWidth ?? 1,
    fitToHeight: options.fitToHeight ?? 0,
    horizontalCentered: true,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.6,
      bottom: 0.6,
      header: 0.2,
      footer: 0.2
    }
  };
  if (options.repeatHeaderRow !== false) sheet.pageSetup.printTitlesRow = "1:1";
}

export function shanghaiDateStamp(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(now)
    .replace(/-/g, "");
}
