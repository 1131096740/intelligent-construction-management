import * as ExcelJS from "exceljs";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 业务台账导出的单元格类型。
 *
 * - `text`：业务文本，写入前做公式注入转义；
 * - `number`：金额/数量，写入数值单元格（可参与合计）；
 * - `date`：日期，写入日期单元格（可排序/筛选）。
 *
 * 未知值（`null`/`undefined`/空串）永远保持空白或原有业务文案，
 * 不在这里被转换成 `0`；无法解析为数字的非空文案按文本写入，
 * 合计只累加真正的数值单元格。
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

/** 把金额/数量解析成数值单元格；未知返回 `null`，绝不返回 `0`。 */
export function ledgerNumericCellValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const asNumber = Number(value.toString());
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  if (typeof value === "object") {
    const decimalLike = value as { toFixed?: unknown; toString?: unknown };
    if (typeof decimalLike.toFixed === "function") {
      const text = String((decimalLike as { toString(): string }).toString());
      return ledgerNumericCellValue(text);
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[¥￥,\s]/gu, "");
  if (normalized.length === 0) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
      appendTotalsRow(sheet, input.columns, sumColumns, input.totals ?? {});
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
    const numeric = ledgerNumericCellValue(raw);
    if (numeric !== null) {
      cell.value = numeric;
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
  options: LedgerExcelTotalsOptions
) {
  const sums = new Map<string, { total: number; known: number }>();
  for (const column of sumColumns) {
    let total = 0;
    let known = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const numeric = ledgerNumericCellValue(row.getCell(columnIndex(columns, column)).value);
      if (numeric !== null) {
        total += numeric;
        known += 1;
      }
    });
    sums.set(String(column.key), { total, known });
  }

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
    const sum = sums.get(String(column.key));
    // 没有任何已知数值时保持空白，不把「未知」写成 0。
    if (!sum || sum.known === 0) continue;
    const cell = totalsRow.getCell(index);
    cell.value = sum.total;
    cell.numFmt = column.numFmt ?? LEDGER_MONEY_FORMAT;
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
