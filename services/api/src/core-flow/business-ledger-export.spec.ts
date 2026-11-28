import * as ExcelJS from "exceljs";
import { exportBusinessLedger } from "./business-ledger-export";
import type { LedgerExcelColumn } from "./ledger-excel";

describe("business ledger export", () => {
  const columns: LedgerExcelColumn<Record<string, unknown>>[] = [
    { header: "编号", key: "code", required: true },
    { header: "项目", key: "project", required: true },
    { header: "相对方", key: "counterparty" },
    {
      header: "金额（元）",
      key: "amount",
      kind: "number",
      numFmt: "#,##0.0000",
      total: "sum"
    },
    { header: "发生日期", key: "occurredOn", kind: "date" }
  ];

  it("exports only the resolved columns, keeps required columns and records an audit entry", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const result = await exportBusinessLedger({
      prisma: {} as never,
      audit: audit as never,
      actorUserId: "user-1",
      action: "payment.ledger.export",
      businessType: "payment_ledger",
      scope: "all_filtered_visible_payment_records",
      sheetName: "付款台账",
      fileNamePrefix: "付款台账",
      columns,
      rows: [
        {
          code: "FK-001",
          project: "总部综合楼",
          counterparty: "=HYPERLINK(\"http://evil.example\")",
          amount: 1234.5,
          occurredOn: "2026-11-20T01:00:00.000Z",
          hiddenTechnicalField: "must-not-export"
        }
      ],
      // 用户隐藏了项目列，但必要列必须补回；也未请求技术字段。
      columnKeys: ["code", "counterparty", "amount"],
      filters: {
        dateFrom: "2026-11-20",
        sortDirection: "desc"
      },
      visibleProjectCount: 2
    });

    expect(result.fileName).toMatch(/^付款台账-\d{8}\.xlsx$/u);
    expect(audit.record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        actorUserId: "user-1",
        action: "payment.ledger.export",
        businessType: "payment_ledger",
        metadata: expect.objectContaining({
          exportedRows: 1,
          visibleProjectCount: 2,
          scope: "all_filtered_visible_payment_records",
          filters: expect.objectContaining({ dateFrom: "2026-11-20" }),
          exportedColumns: ["code", "project", "counterparty", "amount"]
        })
      })
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(["编号", "项目", "相对方", "金额（元）"]);
    expect(headers).not.toContain("hiddenTechnicalField");
    expect(sheet.getRow(2).getCell(3).value).toBe(
      "'=HYPERLINK(\"http://evil.example\")"
    );
    expect(sheet.getRow(2).getCell(4).value).toBe(1234.5);
    expect(sheet.getRow(3).getCell(4).value).toBe(1234.5);
  });

  it("refuses to export without an audit service instead of silently dropping the trail", async () => {
    await expect(
      exportBusinessLedger({
        prisma: {} as never,
        audit: undefined,
        actorUserId: "user-1",
        action: "payment.ledger.export",
        businessType: "payment_ledger",
        scope: "all_filtered_visible_payment_records",
        sheetName: "付款台账",
        fileNamePrefix: "付款台账",
        columns,
        rows: [],
        filters: { sortDirection: "desc" },
        visibleProjectCount: 0
      })
    ).rejects.toThrow("付款台账导出审计服务暂不可用");
  });
});
