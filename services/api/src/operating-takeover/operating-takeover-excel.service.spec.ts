import * as ExcelJS from "exceljs";
import { OperatingTakeoverExcelService } from "./operating-takeover-excel.service";

describe("OperatingTakeoverExcelService", () => {
  it("exports Chinese-only scene sheets without attachment filename columns and parses a row", async () => {
    const service = new OperatingTakeoverExcelService();
    const template = await service.exportTemplate("historical_expense");
    const workbook = new ExcelJS.Workbook();
    // @ts-expect-error ExcelJS 4.4 uses the pre-generic Node Buffer type.
    await workbook.xlsx.load(template.buffer);
    const worksheet = workbook.worksheets[0];
    const headers = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.text), column));
    expect([...headers.keys()]).not.toContain("附件文件名");
    worksheet.getRow(2).getCell(headers.get("业务整理编号")!).value = "历史-001";
    worksheet.getRow(2).getCell(headers.get("发生日期")!).value = "2026-08-01";
    worksheet.getRow(2).getCell(headers.get("金额")!).value = "100.05";
    worksheet.getRow(2).getCell(headers.get("相对方")!).value = "供应商甲";
    worksheet.getRow(2).getCell(headers.get("一级成本分类")!).value = "material";
    worksheet.getRow(2).getCell(headers.get("证据等级")!).value = "A";
    worksheet.getRow(2).getCell(headers.get("资料来源")!).value = "原始付款凭据";

    const parsedWorkbook = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await service.parse(parsedWorkbook, "historical_expense");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      sceneKey: "historical_expense",
      values: { businessRef: "历史-001", amountYuan: "100.05", evidenceLevel: "A" }
    });
  });
});
