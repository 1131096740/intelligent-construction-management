import { Test } from "@nestjs/testing";
import { apiJsonReplacer } from "../api-json-replacer";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { CompanyEntityAccess } from "../company-entity/company-entity-access";
import { PrismaService } from "../database/prisma.service";
import { CompanyHistoryExpenseController } from "./company-history-expense.controller";
import { CompanyHistoryExpenseService } from "./company-history-expense.service";

it("按实际承担公司预检无项目费用，付款公司不改变归属，项目岗位无权办理", async () => {
  const prisma = {
    companyEntity: { findFirst: jest.fn().mockResolvedValue({ id: "bearing", name: "实际承担公司" }) },
    companyHistoryExpenseRow: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn()
  };
  const resolveActiveRoleScopes = jest.fn(async (actor: string) =>
    actor === "global" ? ["comprehensive_director"] : []);
  const module = await Test.createTestingModule({
    controllers: [CompanyHistoryExpenseController],
    providers: [
      CompanyHistoryExpenseService,
      { provide: PrismaService, useValue: prisma },
      { provide: CompanyRoleResolverService, useValue: { resolveActiveRoleScopes } },
      { provide: CompanyEntityAccess, useValue: { assertCanRead: jest.fn() } },
      { provide: AuditService, useValue: { record: jest.fn() } }
    ]
  }).compile();
  const app = module.createNestApplication();
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.use((request: { get(name: string): string }, _response: unknown, next: () => void) => {
    Object.assign(request, { user: { id: request.get("x-test-actor") } });
    next();
  });
  try {
    await app.listen(0, "127.0.0.1");
    const base = `${await app.getUrl()}/company-entities/bearing/history-expenses`;
    const precheck = (actor: string, costBearingCompanyName?: string) => fetch(`${base}/precheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-actor": actor },
      body: JSON.stringify({ rows: [{ values: {
        businessRef: "H-436-01", occurredAt: "2025-01-02", purpose: "历史办公用品",
        costCategoryCode: "project_daily_expense", amountYuan: "10.34",
        paymentStatus: "partially_paid", paidAmountYuan: "2.35", payerCompanyName: "付款公司",
        costBearingCompanyName, sourceDescription: "原始收据"
      } }] })
    });
    expect((await precheck("project-only")).status).toBe(403);
    const response = await precheck("global");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      projectId: null, companyEntityId: "bearing", zeroWrites: true, blockingRows: 0,
      rows: [{ amountCents: "1034", paidCents: "235", values: {
        costBearingCompanyName: "实际承担公司", payerCompanyName: "付款公司"
      } }]
    });
    expect(await (await precheck("global", "付款公司")).json()).toMatchObject({
      zeroWrites: true, blockingRows: 1,
      rows: [{ issues: [{ code: "company_scope_mismatch" }] }]
    });
    expect(resolveActiveRoleScopes).toHaveBeenCalledWith("global");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
