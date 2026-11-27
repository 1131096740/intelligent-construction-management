import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { apiJsonReplacer } from "../api-json-replacer";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { CompanyEntityAccess } from "../company-entity/company-entity-access";
import { CompanyHistoryExpenseController } from "../history-expense/company-history-expense.controller";
import { CompanyHistoryExpenseService } from "../history-expense/company-history-expense.service";
import { PrismaService } from "./prisma.service";

interface Reply { status: number; body: Record<string, any> }
const integration = process.env.ISSUE436_COMPANY_HISTORY_RUN === "1" ? test : test.skip;

integration("公司历史费用真实入账、净额、两会话更正、相邻账簿零变动", async () => {
  const url = new URL(process.env.ISSUE436_COMPANY_HISTORY_DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" ||
      url.protocol !== "postgresql:" || !/^\/issue436_company_[0-9a-f]{12}$/u.test(url.pathname)) {
    throw new Error("公司历史费用验收只允许一次性本机 PostgreSQL 专库");
  }
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const module = await Test.createTestingModule({
    controllers: [CompanyHistoryExpenseController],
    providers: [CompanyHistoryExpenseService, CompanyRoleResolverService, CompanyEntityAccess, AuditService,
      { provide: PrismaService, useValue: prisma }]
  }).compile();
  const app = module.createNestApplication();
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.use((request: { get(name: string): string }, _response: unknown, next: () => void) => {
    Object.assign(request, { user: { id: request.get("x-test-actor") } });
    next();
  });
  try {
    const [database] = await prisma.$queryRaw<Array<{ name: string; version: number; immutable: boolean }>>`
      SELECT current_database() AS name, current_setting('server_version_num')::int AS version,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'CompanyHistoryExpenseFact_immutable' AND tgenabled = 'O') AS immutable
    `;
    expect(database).toEqual(expect.objectContaining({ name: url.pathname.slice(1), immutable: true }));
    expect(Math.floor(database!.version / 10000)).toBe(16);
    const tag = randomUUID();
    const project = await prisma.project.create({
      data: { name: "合成 #436 不关联项目", code: tag, operatingLedgerEffectiveDate: new Date("2026-11-01") }
    });
    const operator = await actor(prisma, "comprehensive_director", null);
    const reviewer = await actor(prisma, "finance_staff", null);
    const supervisor = await actor(prisma, "finance_director", null);
    const projectReviewer = await actor(prisma, "finance_staff", project.id);
    const admin = await actor(prisma, "super_admin", null);
    const bearing = await company(prisma, "合成实际承担公司", "91350100M000100Y43", operator);
    const payer = await company(prisma, "合成另一个付款公司", "91350100M000100YK9", operator);
    await app.listen(0, "127.0.0.1");
    const server = await app.getUrl();
    const call = async (owner: string, actorId: string, path: string, method = "GET", input?: unknown): Promise<Reply> => {
      const response = await fetch(`${server}/company-entities/${owner}/history-expenses${path}`, {
        method, headers: { "x-test-actor": actorId, "content-type": "application/json" },
        ...(input === undefined ? {} : { body: JSON.stringify(input) })
      });
      return { status: response.status, body: await response.json() as Reply["body"] };
    };
    const client = (actorId: string, path: string, method = "GET", payload?: unknown) =>
      call(bearing.id, actorId, path, method, payload);

    const rows = [
      row(1, "10.00", "paid", { payerCompanyName: payer.name }),
      row(2, "20.00", "partially_paid", { paidAmountYuan: "5.00", payerCompanyName: payer.name }),
      row(3, "30.00", "unpaid"), row(4, "40.00", "unknown"), row(5, "0.00", "unpaid"), row(6, "60.00", "unknown")
    ];
    const stateBefore = await unchangedScopes(prisma);
    const beforePreview = await prisma.companyHistoryExpenseBatch.count();
    const auditBeforePreview = await prisma.auditLog.count();
    expect((await client(projectReviewer, "/ledger")).status).toBe(403);
    expect((await client(admin, "/ledger")).status).toBe(403);
    expect((await client(reviewer, "/batches", "POST", { rows })).status).toBe(403);
    expect((await client(operator, "/precheck", "POST", { rows })).body).toMatchObject({
      projectId: null, companyEntityId: bearing.id, zeroWrites: true, blockingRows: 0
    });
    expect(await prisma.companyHistoryExpenseBatch.count()).toBe(beforePreview);
    expect(await prisma.auditLog.count()).toBe(auditBeforePreview);
    const mismatch = await client(operator, "/precheck", "POST", {
      rows: [row(7, "70.00", "paid", { costBearingCompanyName: payer.name })]
    });
    expect(mismatch.body).toMatchObject({ blockingRows: 1 });
    expect(mismatch.body.rows[0].issues).toContainEqual(expect.objectContaining({ code: "company_scope_mismatch" }));

    const creation = await Promise.all([
      client(operator, "/batches", "POST", { rows }),
      client(operator, "/batches", "POST", { rows })
    ]);
    expect(creation.map(result => result.status)).toEqual([201, 201]);
    expect(creation.map(result => result.body.idempotent).sort()).toEqual([false, true]);
    const draft = creation[0]!.body;
    expect(creation[1]!.body.id).toBe(draft.id);
    expect(draft).toMatchObject({ projectId: null, companyEntityId: bearing.id, totalRows: 6 });
    const batch = `/batches/${draft.id}`;
    expect((await call(payer.id, supervisor, batch)).status).toBe(404);
    expect((await call(payer.id, supervisor, `${batch}/activation`, "POST", { expectedRevision: draft.revision })).status).toBe(404);
    expect((await client(supervisor, `${batch}/activation`, "POST", { expectedRevision: draft.revision })).status).toBe(409);

    for (const item of draft.rows) {
      const outcome = item.rowNo < 5 ? "verified" : item.rowNo === 5 ? "not_occurred" : "pending";
      expect((await client(reviewer, `${batch}/rows/${item.id}`, "PATCH", {
        expectedRevision: item.revision, reviewOutcome: outcome,
        ...(outcome === "verified" ? {} : { note: outcome === "pending" ? "等待原始资料" : "原资料无此费用" })
      })).status).toBe(200);
    }
    const verified = (await client(supervisor, batch)).body;
    const confirmationInput = { expectedRevision: verified.revision, idempotencyKey: randomUUID(), note: "核对原始资料" };
    expect((await client(reviewer, `${batch}/confirmations`, "POST", confirmationInput)).status).toBe(403);
    const confirmed = await client(supervisor, `${batch}/confirmations`, "POST", confirmationInput);
    expect(confirmed.status).toBe(201);
    expect((await client(supervisor, `${batch}/confirmations`, "POST", confirmationInput)).body).toEqual(confirmed.body);
    const activation = await Promise.all([1, 2].map(() =>
      client(supervisor, `${batch}/activation`, "POST", { expectedRevision: confirmed.body.revision })));
    expect(activation.map(item => item.status).sort()).toEqual([201, 409]);
    const posted = activation.find(item => item.status === 201)!.body;
    expect(posted).toMatchObject({ status: "partially_activated", activatedRows: 4, pendingRows: 1 });
    expect(await client(reviewer, "/ledger")).toMatchObject({
      status: 200, body: { projectId: null, companyEntityId: bearing.id, costCents: "10000",
        paidCents: "1500", outstandingCents: "4500", unknownPaymentCostCents: "4000" }
    });
    expect((await call(payer.id, reviewer, "/ledger")).body.costCents).toBe("0");
    const original = posted.rows.find((item: { rowNo: number }) => item.rowNo === 2);
    const correction = `${batch}/rows/${original.id}/corrections`;
    const correctionInput = { expectedRevision: original.revision, reason: "原金额凭据补正",
      values: { paymentStatus: "partially_paid", amountYuan: "17.00", paidAmountYuan: "4.00" } };
    expect((await client(reviewer, correction, "POST", correctionInput)).status).toBe(403);
    const corrections = await Promise.all([1, 2].map(() =>
      client(supervisor, correction, "POST", correctionInput)));
    expect(corrections.map(item => item.status).sort()).toEqual([201, 409]);
    const afterCorrection = corrections.find(item => item.status === 201)!.body;
    expect(afterCorrection.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, amountCents: "2000", reviewStatus: "corrected", generatedFactId: original.generatedFactId }),
      expect.objectContaining({ rowNo: 7, amountCents: "1700", reviewStatus: "activated" })
    ]));
    expect(afterCorrection.summary.postedAmountCents).toBe("9700");
    expect((await client(reviewer, "/ledger")).body).toMatchObject({
      costCents: "9700", paidCents: "1400", outstandingCents: "4300", unknownPaymentCostCents: "4000"
    });
    const replacement = afterCorrection.rows.find((item: { rowNo: number }) => item.rowNo === 7);
    expect((await client(supervisor, `${batch}/rows/${replacement.id}/corrections`, "POST", {
      expectedRevision: replacement.revision, reason: "补充证明未付",
      values: { paymentStatus: "unpaid", amountYuan: "18.00", paidAmountYuan: null }
    })).status).toBe(201);
    expect((await client(reviewer, "/ledger")).body).toMatchObject({
      costCents: "9800", paidCents: "1000", outstandingCents: "4800", unknownPaymentCostCents: "4000"
    });

    expect(await prisma.companyHistoryExpenseFact.findMany({
      where: { companyEntityId: bearing.id, adjustsFactId: original.generatedFactId }, orderBy: { entryKind: "desc" }
    })).toMatchObject([
      { entryKind: "reversal", costCents: -2000n, paidCents: -500n, outstandingCents: -1500n },
      { entryKind: "replacement", costCents: 1700n, paidCents: 400n, outstandingCents: 1300n }
    ]);
    await expect(prisma.companyHistoryExpenseFact.update({
      where: { id: original.generatedFactId }, data: { actorUserId: admin }
    })).rejects.toThrow("append-only");
    expect(await prisma.auditLog.count({ where: { businessId: draft.id, action: "company_history_expense.correct" } })).toBe(2);
    expect(await unchangedScopes(prisma)).toEqual(stateBefore);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}, 60_000);

function row(number: number, amountYuan: string, paymentStatus: string, extra: Record<string, unknown> = {}) {
  return { values: {
    businessRef: `历史费用-${number}`, occurredAt: `2026-09-${String(number).padStart(2, "0")}`,
    purpose: "合成历史公司日常费用", costCategoryCode: "project_daily_expense",
    amountYuan, paymentStatus, sourceDescription: "合成历史凭据", ...extra
  } };
}

async function actor(prisma: PrismaClient, key: string, projectId: string | null) {
  const user = await prisma.user.create({ data: { name: `合成 #436 ${key}`, phone: `he-${randomUUID()}` } });
  const role = await prisma.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
  await prisma.userPosition.create({ data: { userId: user.id, positionId: role.id, projectId } });
  return user.id;
}

async function company(prisma: PrismaClient, name: string, code: string, actorUserId: string) {
  return prisma.$transaction(async tx => {
    const entity = await tx.companyEntity.create({
      data: { name, unifiedSocialCreditCode: code, dataStatus: "complete", currentVersionNo: 1 }
    });
    await tx.companyEntityVersion.create({ data: {
      companyEntityId: entity.id, versionNo: 1, name, unifiedSocialCreditCode: code,
      isActive: true, action: "create", actorUserId
    } });
    return entity;
  });
}

async function unchangedScopes(prisma: PrismaClient) {
  return Promise.all([
    prisma.operatingFact.count(), prisma.operatingImpactEntry.count(), prisma.operatingTakeoverBatch.count(),
    prisma.fundAccountBalanceRegistration.count(), prisma.registeredOperationalPayment.count(),
    prisma.registeredFundTransfer.count(), prisma.fundMovement.count(), prisma.expenseClaim.count(),
    prisma.expenseClaimPaymentExecution.count(), prisma.contract.count()
  ]);
}
