import * as ExcelJS from "exceljs";
import { BUSINESS_ENTRY_XLSX_MIME } from "../business-entry-definition/business-entry-excel.service";
import { normalizeHistoryExpenseRow } from "./history-expense.domain";
import { exportHistoryExpenseTemplate, parseHistoryExpenseExcel } from "./history-expense-excel";

async function template() {
  const workbook = new ExcelJS.Workbook();
  const { buffer } = await exportHistoryExpenseTemplate();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

async function upload(workbook: ExcelJS.Workbook) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  return { originalname: "历史费用.xlsx", mimetype: BUSINESS_ENTRY_XLSX_MIME, size: buffer.length, buffer };
}

describe("历史费用 Excel", () => {
  it("按模板读取原始行号、中文选项、实际日期并保留空值和零", async () => {
    const workbook = await template();
    const sheet = workbook.worksheets[0]!;
    sheet.getCell("A2").value = "H-0001";
    sheet.getCell("B2").value = new Date("2026-01-02T00:00:00Z");
    sheet.getCell("C2").value = "发生费用";
    sheet.getCell("D2").value = "材料成本";
    sheet.getCell("E2").value = "9.99";
    sheet.getCell("G2").value = null;
    sheet.getCell("A4").value = "H-0002";
    sheet.getCell("B4").value = "2026-01-02";
    sheet.getCell("C4").value = "确实未发生";
    sheet.getCell("D4").value = "材料成本";
    sheet.getCell("E4").value = 0;
    sheet.getCell("F4").value = "未付款";

    const result = await parseHistoryExpenseExcel(await upload(workbook));
    expect(result.worksheetRows).toEqual([2, 4]);
    expect(result.rows[0]?.values).toMatchObject({
      businessRef: "H-0001", occurredAt: "2026-01-02", costCategoryCode: "material",
      amountYuan: "9.99", paymentStatus: "unknown", paidAmountYuan: null
    });
    expect(result.rows[1]?.values).toMatchObject({ amountYuan: "0", paymentStatus: "unpaid" });
    expect(normalizeHistoryExpenseRow(result.rows[0]!.values).paidCents).toBeNull();
  });

  it("拒绝模板之外的列与带缓存结果的公式", async () => {
    const workbook = await template();
    const sheet = workbook.worksheets[0]!;
    sheet.getCell("A1").value = "未知列";
    await expect(parseHistoryExpenseExcel(await upload(workbook))).rejects.toThrow("模板");
    sheet.getCell("A1").value = (await template()).worksheets[0]!.getCell("A1").value;
    sheet.getCell("E2").value = { formula: "1+2", result: 3 };
    await expect(parseHistoryExpenseExcel(await upload(workbook))).rejects.toThrow("公式");
  });
});
