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

  it("parses each sheet by its own scene in a combined workbook", async () => {
    const service = new OperatingTakeoverExcelService();
    const template = await service.exportTemplate();
    const workbook = new ExcelJS.Workbook();
    // @ts-expect-error ExcelJS 4.4 uses the pre-generic Node Buffer type.
    await workbook.xlsx.load(template.buffer);

    const setValue = (worksheet: ExcelJS.Worksheet, label: string, value: string) => {
      let column = 0;
      worksheet.getRow(1).eachCell((cell, index) => {
        if (cell.text === label) column = index;
      });
      if (!column) throw new Error(`missing column ${label}`);
      worksheet.getRow(2).getCell(column).value = value;
    };

    const ownerPayment = workbook.getWorksheet("业主付款")!;
    setValue(ownerPayment, "业务整理编号", "业主付款-001");
    setValue(ownerPayment, "发生日期", "2026-08-01");
    setValue(ownerPayment, "金额", "100.05");
    setValue(ownerPayment, "相对方", "业主甲");
    setValue(ownerPayment, "实际付款方", "业主甲");
    setValue(ownerPayment, "证据等级", "A");
    setValue(ownerPayment, "资料来源", "银行回单");

    const expense = workbook.getWorksheet("无合同项目费用")!;
    setValue(expense, "业务整理编号", "费用-001");
    setValue(expense, "发生日期", "2026-08-02");
    setValue(expense, "金额", "200.00");
    setValue(expense, "相对方", "供应商甲");
    setValue(expense, "一级成本分类", "material");
    setValue(expense, "证据等级", "A");
    setValue(expense, "资料来源", "原始付款凭据");

    const parsedWorkbook = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await service.parse(parsedWorkbook, "owner_payment");

    expect(parsed.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sceneKey: "owner_payment", values: expect.objectContaining({ businessRef: "业主付款-001" }) }),
      expect.objectContaining({ sceneKey: "historical_expense", values: expect.objectContaining({ businessRef: "费用-001" }) })
    ]));
    expect(parsed.rows).toHaveLength(2);
  });
});
