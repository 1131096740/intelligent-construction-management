import * as ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { createGeneralRequestHarness } from "./general-procurement-request.test-support";

it("综合采购导出保留必需列与原筛选，跨页导出可见行并转义公式文本", async () => {
  const previous = { ...process.env };
  process.env.JWT_ACCESS_SECRET = randomUUID();
  process.env.JWT_REFRESH_SECRET = randomUUID();
  let harness: Awaited<ReturnType<typeof createGeneralRequestHarness>> | undefined;

  try {
    const app = await createGeneralRequestHarness();
    harness = app;
    const createDraft = async (reason: string, actor = app.userId) => {
      const result = await app.request("/general-procurements", {
        requestKey: randomUUID(),
        requestProtocolVersion: 2,
        scope: actor === app.userId ? "project" : "company_daily",
        projectId: actor === app.userId ? app.projectId : null,
        category: "office_supplies",
        reason,
        lines: [{ id: randomUUID(), name: "合成采购明细" }]
      }, actor);
      expect(result).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    };
    await createDraft("=1+2 同批台账");
    await createDraft("同批台账正常采购");
    await createDraft("其他批次");
    await createDraft("同批台账无权查看", app.outsiderId);

    const filter = "keyword=同批台账&status=drafts&pageSize=1";
    const first = await app.request(`/general-procurements?${filter}&page=1`);
    const second = await app.request(`/general-procurements?${filter}&page=2`);
    for (const page of [first, second]) {
      expect(page).toMatchObject({ status: 200, body: { total: 2, items: [expect.any(Object)] } });
    }
    const listCodes = [first.body.items[0].code, second.body.items[0].code];
    expect(new Set(listCodes).size).toBe(2);

    const response = await fetch(`${app.base}/general-procurements/ledger-export?${filter}&page=1&columns=reason`, {
      headers: { authorization: `Bearer ${app.tokenFor()}` },
      signal: AbortSignal.timeout(5000)
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("综合采购台账");
    if (!sheet) throw new Error("缺少综合采购台账工作表");
    const header = sheet.getRow(1);
    expect([1, 2, 3, 4].map((column) => header.getCell(column).value))
      .toEqual(["采购编号", "项目", "采购单位", "采购内容与用途"]);
    const rows = [sheet.getRow(2), sheet.getRow(3)];
    expect(rows.map((row) => row.getCell(1).value)).toEqual(listCodes);
    expect(rows.map((row) => row.getCell(2).value)).toEqual(["合成办公项目", "合成办公项目"]);
    expect(rows.map((row) => row.getCell(4).value)).toEqual(
      expect.arrayContaining(["'=1+2 同批台账", "同批台账正常采购"])
    );
    expect(sheet.rowCount).toBe(3);
    expect(app.tables.auditLog.filter((entry) => entry.action === "general_procurement.ledger.export"))
      .toEqual([expect.objectContaining({
        actorUserId: app.userId,
        metadata: expect.objectContaining({ exportedRows: 2, filters: expect.objectContaining({ status: "drafts", keyword: "同批台账" }) })
      })]);
  } finally {
    try {
      await harness?.app.close();
    } finally {
      process.env = previous;
    }
  }
});
