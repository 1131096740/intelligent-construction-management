import { BadRequestException } from "@nestjs/common";
import { PRIMARY_COST_CATEGORY_LABELS } from "@jiangkong/shared-domain";
import * as ExcelJS from "exceljs";
import { assertExcelUpload, assertSafeXlsxArchive, type BoundedXlsxUpload } from "../file/bounded-xlsx";
import {
  HISTORY_EXPENSE_MAX_ROWS,
  HISTORY_EXPENSE_PAYMENT_STATUS_LABELS,
} from "./history-expense.domain";

const sheetName = "历史费用";
const columns = [
  ["businessRef", "业务编号"],
  ["occurredAt", "发生日期"],
  ["purpose", "用途"],
  ["costCategoryCode", "类别"],
  ["amountYuan", "金额（元）"],
  ["paymentStatus", "付款情况"],
  ["paidAmountYuan", "已付金额（元）"],
  ["payerCompanyName", "付款公司"],
  ["payeeName", "收款方"],
  ["costBearingCompanyName", "承担公司"],
  ["sourceDescription", "已有依据"],
  ["paymentDate", "付款日期"]
] as const;

const companyCategoryLabels = {
  ...PRIMARY_COST_CATEGORY_LABELS,
  project_daily_expense: "公司日常费用",
  other_project_cost: "其他公司费用"
} as const;
const categoryByLabel = new Map(Object.entries(PRIMARY_COST_CATEGORY_LABELS).map(([key, label]) => [label as string, key]));
categoryByLabel.set(companyCategoryLabels.project_daily_expense, "project_daily_expense");
categoryByLabel.set(companyCategoryLabels.other_project_cost, "other_project_cost");
const paymentByLabel = new Map(Object.entries(HISTORY_EXPENSE_PAYMENT_STATUS_LABELS).map(([key, label]) => [label as string, key]));

export async function exportHistoryExpenseTemplate(scope: "project" | "company" = "project") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "建工智管";
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([key, header]) => ({ key, header, width: key === "purpose" ? 28 : 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const key of ["businessRef", "amountYuan", "paidAmountYuan"]) {
    sheet.getColumn(key).numFmt = "@";
  }
  sheet.getColumn("occurredAt").numFmt = "yyyy-mm-dd";
  sheet.getColumn("paymentDate").numFmt = "yyyy-mm-dd";
  for (const [column, labels] of [
    [4, Object.values(scope === "company" ? companyCategoryLabels : PRIMARY_COST_CATEGORY_LABELS)],
    [6, Object.values(HISTORY_EXPENSE_PAYMENT_STATUS_LABELS)]
  ] as const) {
    const validation: ExcelJS.DataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${labels.join(",")}"`]
    };
    for (let row = 2; row <= HISTORY_EXPENSE_MAX_ROWS + 1; row += 1) {
      sheet.getCell(row, column).dataValidation = validation;
    }
  }
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer), fileName: "历史费用导入模板.xlsx" };
}

function readCell(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Formula) {
    throw new BadRequestException(`Excel 的 ${cell.address} 不能填写公式`);
  }
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Math.abs(value) < 1e13) return String(value);
  throw new BadRequestException(`Excel 的 ${cell.address} 请使用文本填写，避免原始值丢失`);
}

export async function parseHistoryExpenseExcel(file: BoundedXlsxUpload) {
  assertExcelUpload(file);
  assertSafeXlsxArchive(file.buffer, HISTORY_EXPENSE_MAX_ROWS + 1, columns.length);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new BadRequestException("无法读取 Excel，请使用历史费用导入模板");
  }
  const sheet = workbook.getWorksheet(sheetName);
  if (workbook.worksheets.length !== 1 || sheet?.state !== "visible") {
    throw new BadRequestException("请使用只含「历史费用」工作表的原模板");
  }
  if (sheet.columns.some((column) => column.hidden)) throw new BadRequestException("Excel 不能包含隐藏列");
  if (columns.some(([, label], index) => readCell(sheet.getCell(1, index + 1)) !== label)) {
    throw new BadRequestException("Excel 表头与历史费用导入模板不一致");
  }
  const rows: Array<{ values: Record<string, string | null> }> = [];
  const worksheetRows: number[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.hidden) throw new BadRequestException("Excel 不能包含隐藏行");
    const cells = columns.map((_, index) => readCell(row.getCell(index + 1)));
    if (cells.every((value) => !value)) continue;
    const values: Record<string, string | null> = Object.fromEntries(
      columns.map(([key], index) => [key, cells[index] || null])
    );
    const category = values.costCategoryCode ?? "";
    const payment = values.paymentStatus ?? "";
    values.costCategoryCode = categoryByLabel.get(category) ?? category;
    values.paymentStatus = paymentByLabel.get(payment) ?? (payment || "unknown");
    rows.push({ values });
    worksheetRows.push(rowNumber);
  }
  if (!rows.length) throw new BadRequestException("Excel 中没有可导入的历史费用行");
  return { rows, worksheetRows };
}
