import { Test } from "@nestjs/testing";
import * as ExcelJS from "exceljs";
import { apiJsonReplacer } from "../api-json-replacer";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { BUSINESS_ENTRY_XLSX_MIME } from "../file/bounded-xlsx";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { HistoryExpenseController } from "./history-expense.controller";
import { HistoryExpenseService } from "./history-expense.service";

it("在授权项目下载模板并预检真实 Excel，原始工作表行回传且不写库", async () => {
  const projectId = "history-expense-project";
  const repo = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: projectId, operatingLedgerEffectiveDate: null }) },
    operatingTakeoverRow: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn()
  };
  const roles = jest.fn((actor: string) => Promise.resolve(actor === "operator" ? ["comprehensive_director"] : []));
  const posting = { appendCompilerFactInTransaction: jest.fn() };
  const audit = { record: jest.fn() };
  const module = await Test.createTestingModule({
    controllers: [HistoryExpenseController],
    providers: [
      HistoryExpenseService,
      { provide: PrismaService, useValue: repo },
      { provide: ProjectVisibilityService, useValue: { effectiveRoleKeys: roles } },
      { provide: AuditService, useValue: audit },
      { provide: OperatingLedgerService, useValue: posting }
    ]
  }).compile();
  const app = module.createNestApplication();
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.use((
    request: { get(name: string): string | undefined },
    _response: unknown,
    next: () => void
  ) => {
    Object.assign(request, { user: { id: request.get("x-test-actor") } });
    next();
  });

  try {
    await app.listen(0, "127.0.0.1");
    const base = `${await app.getUrl()}/projects/${projectId}/history-expenses`;
    const headers = { "x-test-actor": "operator" };
    const denied = await fetch(`${base}/excel-template`, { headers: { "x-test-actor": "other" } });
    expect(denied.status).toBe(403);
    const template = await fetch(`${base}/excel-template`, { headers });
    expect(template.status).toBe(200);
    expect(template.headers.get("content-type")).toContain(BUSINESS_ENTRY_XLSX_MIME);
    expect(template.headers.get("content-disposition")).toContain("history-expense.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await template.arrayBuffer()) as unknown as ExcelJS.Buffer);
    workbook.worksheets[0]!.getRow(3).values = [
      "X-01", "2025-01-02", "历史购料", "材料成本", "10.34", "部分付款", "2.35", null, null, null, "原始收据"
    ];
    const file = await workbook.xlsx.writeBuffer() as ArrayBuffer;

    const precheck = async (actor: string) => {
      const form = new FormData();
      form.append("file", new Blob([file], { type: BUSINESS_ENTRY_XLSX_MIME }), "历史费用.xlsx");
      return fetch(`${base}/excel-precheck`, { method: "POST", headers: { "x-test-actor": actor }, body: form });
    };
    expect((await precheck("other")).status).toBe(403);
    const response = await precheck("operator");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      worksheetRows: [3],
      rows: [{ values: { businessRef: "X-01", amountYuan: "10.34" } }],
      precheck: { zeroWrites: true, blockingRows: 0, rows: [{ rowNo: 1, amountCents: "1034", paidCents: "235" }] }
    });
    expect(roles).toHaveBeenCalledWith("operator", projectId);
    expect(repo.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(posting.appendCompilerFactInTransaction).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
