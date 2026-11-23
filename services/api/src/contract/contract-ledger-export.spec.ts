import * as ExcelJS from "exceljs";
import { ContractReadService } from "./contract-read.service";

/**
 * #421a 合同台账导出：按当前筛选与显示列导出全部可见记录，
 * 金额/日期写成数值/日期单元格，未知金额不写 0，文本防公式注入。
 */
describe("contract ledger export", () => {
  const rows = [
    {
      id: "HT-001",
      contractId: "contract-1",
      projectId: "project-a",
      contractNo: "HT-001",
      name: "幕墙分包合同",
      project: "总部综合楼",
      signingParty: "四川建工智管建筑工程有限公司",
      counterparty: "=HYPERLINK(\"http://evil.example\")",
      typePricing: "专业分包合同 · 固定总价",
      amount: "¥986,500.0000",
      amountYuan: "986500.0000",
      version: "v2",
      paymentTermsVersion: "v2",
      currentNode: "可发起结算",
      pendingOwner: "合同部",
      stalledFor: "1 天",
      returnReason: "-",
      nextAction: "可发起结算",
      updatedAt: "2026/11/20 09:30:00",
      occurredAt: "2026-11-20T01:30:00.000Z",
      contractRelationshipLabel: "表内（我方签约）"
    },
    {
      id: "HT-002",
      contractId: "contract-2",
      projectId: "project-b",
      contractNo: "HT-002",
      name: "钢材采购框架合同",
      project: "数据中心",
      signingParty: "待确定",
      counterparty: "钢材供应商",
      typePricing: "材料采购合同 · 框架合同",
      amount: "不设合同总价",
      amountYuan: null,
      version: "v1",
      paymentTermsVersion: "-",
      currentNode: "已生效",
      pendingOwner: "合同部",
      stalledFor: "3 天",
      returnReason: "-",
      nextAction: "可发起结算",
      updatedAt: "2026/11/19 09:30:00",
      occurredAt: "2026-11-19T01:30:00.000Z",
      contractRelationshipLabel: "表外（施工企业签约）"
    },
    {
      id: "HT-003",
      contractId: "contract-3",
      projectId: "project-a",
      contractNo: "HT-003",
      name: "临时用工合同",
      project: "总部综合楼",
      signingParty: "待确定",
      counterparty: "劳务班组",
      typePricing: "劳务分包合同 · 单价合同",
      amount: "待确定",
      amountYuan: null,
      version: "v1",
      paymentTermsVersion: "-",
      currentNode: "已生效",
      pendingOwner: "合同部",
      stalledFor: "5 天",
      returnReason: "-",
      nextAction: "可发起结算",
      updatedAt: "2026/11/18 09:30:00",
      occurredAt: "2026-11-18T01:30:00.000Z",
      contractRelationshipLabel: "表内（我方签约）"
    }
  ];

  function serviceWith(rowsToReturn: readonly Record<string, unknown>[]) {
    const prisma = {};
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractReadService(prisma as never, undefined, audit as never);
    jest.spyOn(service, "listRecent").mockResolvedValue({
      rows: [...rowsToReturn],
      summary: {
        total: rowsToReturn.length,
        inApproval: 0,
        pendingSeal: 0,
        pendingArchive: 0,
        effective: rowsToReturn.length
      }
    });
    return { service, audit, prisma };
  }

  async function workbookOf(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return workbook.getWorksheet("合同台账")!;
  }

  it("exports all filtered visible rows, not only the current page", async () => {
    const { service, audit, prisma } = serviceWith(rows);
    const result = await service.exportLedger(["project-a", "project-b"], "finance-user", {
      projectId: "project-a",
      keyword: "幕墙"
    });
    const sheet = await workbookOf(result.buffer);
    expect(sheet.getRow(2).getCell(1).value).toBe("HT-001");
    expect(sheet.getRow(3).getCell(1).value).toBe("合计（不含待确定金额）");
    expect(service.listRecent).toHaveBeenCalledWith(undefined, ["project-a", "project-b"], {
      unbounded: true,
      actorUserId: "finance-user"
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "contract.ledger.export",
        metadata: expect.objectContaining({
          exportedRows: 1,
          scope: "all_filtered_visible_records",
          filters: expect.objectContaining({ projectId: "project-a", keyword: "幕墙" })
        })
      })
    );
  });

  it("writes amount and date cells with the requested display columns and required columns", async () => {
    const { service } = serviceWith(rows);
    const result = await service.exportLedger(["project-a", "project-b"], "finance-user", {
      projectId: "project-a",
      columns: "contractNo,amountYuan,updatedAt"
    });
    const sheet = await workbookOf(result.buffer);
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(expect.arrayContaining([
      "合同编号",
      "项目",
      "签约方（甲方）",
      "相对方（乙方）",
      "合同金额（元）",
      "更新时间"
    ]));
    expect(headers.includes("金额说明")).toBe(false);
    const headerIndex = (header: string) => headers.indexOf(header) + 1;
    const money = sheet.getRow(2).getCell(headerIndex("合同金额（元）"));
    expect(money.value).toBe(986500);
    expect(money.numFmt).toBe("#,##0.0000");
    const date = sheet.getRow(2).getCell(headerIndex("更新时间"));
    expect(date.value).toBeInstanceOf(Date);
    expect((date.value as Date).toISOString()).toBe("2026-11-20T01:30:00.000Z");
    // 公式前缀文本被转义，金额列仍为数值。
    const counterparty = sheet.getRow(2).getCell(headerIndex("相对方（乙方）"));
    expect(counterparty.value).toBe("'=HYPERLINK(\"http://evil.example\")");
  });

  it("does not turn unknown contract amounts into 0", async () => {
    const { service } = serviceWith(rows);
    const result = await service.exportLedger(["project-a", "project-b"], "finance-user", {
      projectId: "project-a"
    });
    const sheet = await workbookOf(result.buffer);
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const moneyIndex = headers.indexOf("合同金额（元）") + 1;
    // 第一条已知；第二条「待确定」保留业务文案；合计只累加已知金额。
    expect(sheet.getRow(3).getCell(moneyIndex).value).toBe("待确定");
    const totalLabel = headers.indexOf("合同编号") + 1;
    expect(sheet.getRow(4).getCell(totalLabel).value).toBe("合计（不含待确定金额）");
    expect(sheet.getRow(4).getCell(moneyIndex).value).toBe(986500);
  });

  it("returns the same rows for a filter as an explicit filtered list", async () => {
    const { service } = serviceWith(rows);
    const dateFiltered = await service.exportLedger(["project-a", "project-b"], "finance-user", {
      dateFrom: "2026-11-19",
      dateTo: "2026-11-19"
    });
    const sheet = await workbookOf(dateFiltered.buffer);
    expect(sheet.getRow(2).getCell(1).value).toBe("HT-002");
    expect(sheet.getRow(3).getCell(1).value).not.toBe("HT-001");
  });
});
