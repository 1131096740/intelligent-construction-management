import * as ExcelJS from "exceljs";
import {
  LEDGER_DATE_FORMAT,
  LEDGER_MONEY_FORMAT,
  buildLedgerWorkbook,
  escapeSpreadsheetText,
  ledgerNumericCellValue
} from "./ledger-excel";

describe("ledger-excel", () => {
  it("writes numeric and date cells instead of display strings", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "合同编号", key: "contractNo", width: 20 },
        { header: "合同金额（元）", key: "amountYuan", kind: "number", total: "sum" },
        { header: "更新时间", key: "updatedAt", kind: "date" }
      ],
      rows: [
        {
          contractNo: "HT-1",
          amountYuan: "100.5000",
          updatedAt: "2026-11-20T01:30:00.000Z"
        }
      ]
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("合同台账")!;
    const amount = sheet.getRow(2).getCell(2);
    expect(amount.value).toBe(100.5);
    expect(amount.numFmt).toBe(LEDGER_MONEY_FORMAT);
    const updatedAt = sheet.getRow(2).getCell(3);
    expect(updatedAt.value).toBeInstanceOf(Date);
    expect((updatedAt.value as Date).toISOString()).toBe("2026-11-20T01:30:00.000Z");
    expect(updatedAt.numFmt).toBe(LEDGER_DATE_FORMAT);
  });

  it("round-trips high precision amounts and totals through Excel", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "合同名称", key: "name" },
        { header: "合同金额（元）", key: "amountYuan", kind: "number", total: "sum" }
      ],
      rows: [
        { name: "大额合同", amountYuan: "1234567890123456.7890" },
        { name: "退款", amountYuan: "-0.0001" },
        { name: "暂定合同", amountYuan: "待确定" }
      ]
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("合同台账")!;
    expect(sheet.getCell("B2").value).toBe("1234567890123456.7890");
    expect(sheet.getCell("B2").numFmt).toBe("@");
    expect(sheet.getCell("B3").value).toBe(-0.0001);
    expect(sheet.getCell("B4").value).toBe("待确定");
    expect(sheet.getCell("B5").value).toBe("1234567890123456.7889");
  });

  it("keeps unknown amounts blank or as business text and never writes 0", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "合同名称", key: "name" },
        { header: "合同金额（元）", key: "amountYuan", kind: "number", total: "sum" }
      ],
      rows: [
        { name: "已确定金额", amountYuan: "100" },
        { name: "金额待确定", amountYuan: null },
        { name: "框架合同", amountYuan: "不设合同总价" },
        { name: "暂定合同", amountYuan: "待确定" }
      ],
      totals: { label: "合计", note: "不含待确定金额" }
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("合同台账")!;
    expect(sheet.getRow(3).getCell(2).value).toBeNull();
    expect(sheet.getRow(4).getCell(2).value).toBe("不设合同总价");
    expect(sheet.getRow(5).getCell(2).value).toBe("待确定");
    const totals = sheet.getRow(6);
    expect(totals.getCell(1).value).toBe("合计（不含待确定金额）");
    expect(totals.getCell(2).value).toBe(100);
  });

  it("does not write a zero total when every amount is unknown", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "合同名称", key: "name" },
        { header: "合同金额（元）", key: "amountYuan", kind: "number", total: "sum" }
      ],
      rows: [{ name: "框架合同", amountYuan: "不设合同总价" }]
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const totalsRow = workbook.getWorksheet("合同台账")!.getRow(3);
    expect(totalsRow.getCell(1).value).toBe("合计");
    expect(totalsRow.getCell(2).value).toBeNull();
  });

  it("escapes formula prefixes in text cells but not in numeric cells", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "相对方", key: "counterparty" },
        { header: "合同金额（元）", key: "amountYuan", kind: "number" }
      ],
      rows: [
        { counterparty: "=HYPERLINK(\"http://evil\")", amountYuan: "-100" },
        { counterparty: " +SUM(A1)", amountYuan: "1" },
        { counterparty: "@cmd", amountYuan: "2" },
        { counterparty: "正常相对方", amountYuan: "3" }
      ]
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("合同台账")!;
    expect(sheet.getRow(2).getCell(1).value).toBe("'=HYPERLINK(\"http://evil\")");
    expect(sheet.getRow(3).getCell(1).value).toBe("' +SUM(A1)");
    expect(sheet.getRow(4).getCell(1).value).toBe("'@cmd");
    expect(sheet.getRow(5).getCell(1).value).toBe("正常相对方");
    expect(sheet.getRow(2).getCell(2).value).toBe(-100);
  });

  it("sets a printable layout with repeated header and frozen first row", async () => {
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [{ header: "合同编号", key: "contractNo" }],
      rows: [{ contractNo: "HT-1" }],
      print: { landscape: true }
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("合同台账")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.pageSetup).toMatchObject({
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: "landscape"
    });
    expect(sheet.pageSetup.printTitlesRow).toBe("1:1");
  });

  it("parses numeric cells without turning unknown text into zero", () => {
    expect(ledgerNumericCellValue(null)).toBeNull();
    expect(ledgerNumericCellValue("")).toBeNull();
    expect(ledgerNumericCellValue("-")).toBeNull();
    expect(ledgerNumericCellValue("待确定")).toBeNull();
    expect(ledgerNumericCellValue("¥1,234.5000")).toBe(1234.5);
    expect(ledgerNumericCellValue("0")).toBe(0);
    expect(ledgerNumericCellValue(0)).toBe(0);
  });

  it("escapes leading control characters before a formula prefix", () => {
    expect(escapeSpreadsheetText("\t=1+1")).toBe("'\t=1+1");
    expect(escapeSpreadsheetText("\r=1+1")).toBe("'\r=1+1");
    expect(escapeSpreadsheetText("")).toBe("");
  });
});
