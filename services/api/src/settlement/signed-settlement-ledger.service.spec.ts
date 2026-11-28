import * as ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { SignedSettlementLedgerService } from "./signed-settlement-ledger.service";

/**
 * #421a 结算台账重建：只读已复核 `SignedContractSettlement`，跨项目按可见范围
 * 合并；行级可见性在列表与导出上完全一致，未知金额不写 0。
 */
describe("SignedSettlementLedgerService", () => {
  const settlements = [
    {
      id: "signed-a-1",
      projectId: "project-a",
      contractKind: "downstream",
      number: "JS-A-001",
      amountYuan: new Prisma.Decimal("100.0000"),
      confirmationNo: 1n,
      confirmedContractSource: {
        relationship: "inside",
        name: "幕墙分包合同",
        signingParty: "四川建工智管建筑工程有限公司",
        counterparty: "=HYPERLINK(\"http://evil.example\")"
      },
      reviewedAt: new Date("2026-11-20T01:30:00.000Z"),
      updatedAt: new Date("2026-11-20T01:30:00.000Z"),
      reviewedByUserId: "reviewer-1"
    },
    {
      id: "signed-b-1",
      projectId: "project-b",
      contractKind: "outside_fact",
      number: "JS-B-001",
      amountYuan: new Prisma.Decimal("25.5000"),
      confirmationNo: 1n,
      confirmedContractSource: {
        relationship: "outside",
        name: "表外机械租赁合同",
        signingParty: "施工企业",
        counterparty: "设备租赁公司"
      },
      reviewedAt: new Date("2026-11-19T01:30:00.000Z"),
      updatedAt: new Date("2026-11-19T01:30:00.000Z"),
      reviewedByUserId: "reviewer-1"
    }
  ];

  function build(rolesByProject: Record<string, string[]>) {
    const prisma = {
      signedContractSettlement: { findMany: jest.fn().mockResolvedValue(settlements) },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-a", name: "总部综合楼" },
          { id: "project-b", name: "数据中心" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "reviewer-1", name: "合同部主管" }])
      }
    };
    const visibility = {
      effectiveRoleKeysByProject: jest.fn().mockImplementation(
        (_actor: string, projectIds: string[]) =>
          new Map(projectIds.map((projectId) => [projectId, rolesByProject[projectId] ?? []]))
      )
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new SignedSettlementLedgerService(
      prisma as never,
      visibility as never,
      audit as never
    );
    return { service, prisma, visibility, audit };
  }

  async function workbookOf(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return workbook.getWorksheet("已签结算台账")!;
  }

  it("lists only confirmed signed settlements in projects the actor may read", async () => {
    const { service, prisma } = build({ "project-a": ["contract_staff"], "project-b": [] });
    const page = await service.list(["project-a", "project-b"], "staff-user");
    expect(prisma.signedContractSettlement.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-a", "project-b"] }, state: "confirmed" },
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }]
    });
    expect(page.rows.map((row) => row.settlementNo)).toEqual(["JS-A-001"]);
    expect(page.summary).toMatchObject({
      total: 1,
      knownAmountRows: 1,
      unknownAmountRows: 0,
      totalAmountYuan: "100.0000",
      projectCount: 1
    });
  });

  it("keeps the same row-level visibility for list and export", async () => {
    const { service } = build({ "project-a": ["finance_staff"], "project-b": ["employee"] });
    const page = await service.list(["project-a", "project-b"], "finance-user");
    const exported = await workbookOf(
      (await service.exportLedger(["project-a", "project-b"], "finance-user")).buffer
    );
    expect(page.rows.map((row) => row.settlementNo)).toEqual(["JS-A-001"]);
    expect(exported.getRow(2).getCell(1).value).toBe("JS-A-001");
    // 第二行是合计，不存在 project-b 的无权记录。
    expect(exported.getRow(3).getCell(1).value).toBe("合计（不含待确定金额）");
  });

  it("exports numeric amount and date cells, escapes formula text and totals known amounts", async () => {
    const { service } = build({
      "project-a": ["contract_director"],
      "project-b": ["contract_director"]
    });
    const result = await service.exportLedger(["project-a", "project-b"], "director");
    expect(result.fileName).toMatch(/^已签结算台账-\d{8}\.xlsx$/);
    const sheet = await workbookOf(result.buffer);
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const index = (header: string) => headers.indexOf(header) + 1;
    expect(headers).toEqual(expect.arrayContaining([
      "结算编号",
      "项目",
      "签约方（甲方）",
      "相对方（乙方）",
      "结算金额（元）",
      "复核日期"
    ]));
    const money = sheet.getRow(2).getCell(index("结算金额（元）"));
    expect(money.value).toBe(100);
    expect(money.numFmt).toBe("#,##0.0000");
    const date = sheet.getRow(2).getCell(index("复核日期"));
    expect(date.value).toBeInstanceOf(Date);
    const counterparty = sheet.getRow(2).getCell(index("相对方（乙方）"));
    expect(counterparty.value).toBe("'=HYPERLINK(\"http://evil.example\")");
    const totals = sheet.getRow(4);
    expect(totals.getCell(index("结算编号")).value).toBe("合计（不含待确定金额）");
    expect(totals.getCell(index("结算金额（元）")).value).toBe(125.5);
  });

  it("filters across projects by project, date, status and keyword for both list and export", async () => {
    const { service } = build({
      "project-a": ["contract_director"],
      "project-b": ["contract_director"]
    });
    const byProject = await service.list(["project-a", "project-b"], "director", {
      projectId: "project-b"
    });
    expect(byProject.rows.map((row) => row.settlementNo)).toEqual(["JS-B-001"]);
    const byDate = await service.list(["project-a", "project-b"], "director", {
      dateFrom: "2026-11-20",
      dateTo: "2026-11-20"
    });
    expect(byDate.rows.map((row) => row.settlementNo)).toEqual(["JS-A-001"]);
    const byKeyword = await service.list(["project-a", "project-b"], "director", {
      keyword: "机械"
    });
    expect(byKeyword.rows.map((row) => row.settlementNo)).toEqual(["JS-B-001"]);
    const byStatus = await service.list(["project-a", "project-b"], "director", {
      status: "表外合同"
    });
    expect(byStatus.rows.map((row) => row.settlementNo)).toEqual(["JS-B-001"]);

    const exported = await workbookOf(
      (await service.exportLedger(["project-a", "project-b"], "director", {
        projectId: "project-b",
        columns: "settlementNo,amountYuan"
      })).buffer
    );
    expect(exported.getRow(2).getCell(1).value).toBe("JS-B-001");
    // 必要列（项目、双方、金额）即使未请求也保留。
    const headers = (exported.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(expect.arrayContaining(["项目", "签约方（甲方）", "相对方（乙方）", "结算金额（元）"]));
  });

  it("does not turn unknown settlement amounts into zero", async () => {
    const unknownRow = {
      ...settlements[0]!,
      id: "signed-a-unknown",
      number: "JS-A-UNKNOWN",
      amountYuan: null,
      confirmationNo: 2n
    };
    const prisma = {
      signedContractSettlement: { findMany: jest.fn().mockResolvedValue([unknownRow]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-a", name: "总部综合楼" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "reviewer-1", name: "合同部主管" }]) }
    };
    const visibility = {
      effectiveRoleKeysByProject: jest
        .fn()
        .mockResolvedValue(new Map([["project-a", ["contract_director"]]]))
    };
    const service = new SignedSettlementLedgerService(
      prisma as never,
      visibility as never,
      { record: jest.fn() } as never
    );
    const page = await service.list(["project-a"], "director");
    expect(page.rows[0]?.amountYuan).toBeNull();
    expect(page.rows[0]?.amount).toBe("待确定");
    expect(page.summary.totalAmountYuan).toBeNull();
    const sheet = await workbookOf(
      (await service.exportLedger(["project-a"], "director")).buffer
    );
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const moneyIndex = headers.indexOf("结算金额（元）") + 1;
    expect(sheet.getRow(2).getCell(moneyIndex).value).toBe("待确定");
    expect(sheet.getRow(3).getCell(moneyIndex).value).toBeNull();
  });

  it("records an export audit with filters and selected columns", async () => {
    const { service, audit, prisma } = build({ "project-a": ["contract_director"] });
    await service.exportLedger(["project-a"], "director", {
      projectId: "project-a",
      keyword: "幕墙",
      columns: "settlementNo,amountYuan"
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        actorUserId: "director",
        action: "settlement.signed_ledger.export",
        businessType: "signed_settlement_ledger",
        metadata: expect.objectContaining({
          exportedRows: 1,
          scope: "all_filtered_confirmed_signed_settlements",
          filters: expect.objectContaining({ projectId: "project-a", keyword: "幕墙" }),
          exportedColumns: expect.arrayContaining(["settlementNo", "amountYuan"])
        })
      })
    );
  });

  it("fails closed when the export audit service is unavailable", async () => {
    const service = new SignedSettlementLedgerService(
      {
        signedContractSettlement: { findMany: jest.fn().mockResolvedValue([]) },
        project: { findMany: jest.fn() },
        user: { findMany: jest.fn() }
      } as never,
      { effectiveRoleKeysByProject: jest.fn() } as never,
      undefined
    );
    await expect(service.exportLedger(["project-a"], "director")).rejects.toThrow(
      "已签结算台账导出审计服务暂不可用"
    );
  });
});
