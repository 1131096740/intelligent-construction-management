import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";

describe("费用统一录入真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let projectId: string;
  let companyEntityId: string;
  let applicantUserId: string;
  let factWitnessUserId: string;
  let strangerToken: string;

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") {
      throw new Error("费用入口测试只允许本机专用 PostgreSQL 数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    const prisma = app.get(PrismaService);
    const password = randomUUID();
    const suffix = randomUUID();
    const actor = await prisma.user.create({ data: { name: "入口申请人", phone: `pol115-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    applicantUserId = actor.id;
    const project = await prisma.project.create({ data: { code: `POL115-${suffix}`, name: "入口合成项目" } });
    projectId = project.id;
    companyEntityId = (await prisma.companyEntity.create({ data: { name: "入口合成公司", dataStatus: "complete" } })).id;
    for (const key of ["employee", "comprehensive_director", "project_manager", "finance_director", "chairman"]) {
      const position = await prisma.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
      const userId = key === "employee" ? actor.id : (await prisma.user.create({ data: { name: `审批岗位${key}`, mustChangePassword: false } })).id;
      if (key === "comprehensive_director") factWitnessUserId = userId;
      await prisma.userPosition.create({ data: { userId, positionId: position.id, projectId: key === "employee" || key === "project_manager" ? projectId : null } });
    }
    const login = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password }) });
    expect(login.status).toBe(201);
    token = ((await login.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
    const stranger = await prisma.user.create({ data: { name: "无关申请人", phone: `stranger-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const strangerLogin = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: stranger.phone, password }) });
    strangerToken = ((await strangerLogin.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
  }, 60_000);

  afterAll(async () => { if (app) await app.close(); });

  async function request(path: string, body?: unknown, accessToken = token) {
    const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as { id: string; status: string; entryDefinition: BusinessEntrySceneDefinition; entrySnapshots: Array<{ definitionSnapshot: BusinessEntrySceneDefinition; valuesSnapshot: Record<string, unknown> }> } };
  }

  (enabled ? it : it.skip)("项目借款明确提交后按原授权回读当时字段与金额，重复提交不增加快照", async () => {
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "现场备用金", requestedAmountCents: "12500", loanExpectedClearanceOn: "2026-12-01" });
    if (created.status !== 201) throw new Error(JSON.stringify(created));
    expect(created).toMatchObject({ status: 201 });
    const path = `/expense-claims/${created.body.id}`;
    const submitted = await request(`${path}/submission`, {});
    expect(submitted.status).toBe(201);
    const detail = await request(path);
    expect(detail.status).toBe(200);
    expect(detail.body.entrySnapshots).toHaveLength(1);
    expect(detail.body.entrySnapshots[0]).toMatchObject({
      sceneKey: "expense_claim.application", businessAction: "expense_claim.submit", definitionVersion: 1,
      valuesSnapshot: { claimType: "loan", reason: "现场备用金", requestedAmountCents: "12500", loanExpectedClearanceOn: "2026-12-01" }
    });
    expect(detail.body.entrySnapshots[0].definitionSnapshot.fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "requestedAmountYuan", label: "申请金额", unit: "元", precision: 2 })]));
    expect(detail.body.entrySnapshots[0]!.valuesSnapshot.requestedAmountYuan).toBe("125.00");
    expect((await request(`${path}/submission`, {})).status).toBe(400);
    expect((await request(path)).body.entrySnapshots).toEqual(detail.body.entrySnapshots);
  }, 60_000);

  (enabled ? it : it.skip)("填写选项提供与提交快照相同的统一字段定义，非项目报销不借用个人资料授权", async () => {
    const options = await request("/expense-claims/create-options");
    expect(options.status).toBe(200);
    expect(options.body.entryDefinition).toMatchObject({ key: "expense_claim.application", version: 1 });
    const created = await request("/expense-claims", { claimType: "reimbursement", companyEntityId, applicantUserId, factWitnessUserId, reason: "办公室交通", requestedAmountCents: "3500", lines: [{ expenseCategory: "交通费", occurredOn: "2026-09-16", purpose: "办理公司事务", receiptCount: 0, amountCents: "3500", evidenceType: "none", noEvidenceReason: "公共交通无纸质凭证" }] });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(path)).body.entrySnapshots).toEqual([]);
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    const detail = await request(path);
    expect(detail.body.entrySnapshots).toHaveLength(1);
    expect(detail.body.entrySnapshots[0]!.definitionSnapshot).toEqual(options.body.entryDefinition);
    expect(detail.body.entrySnapshots[0]!.valuesSnapshot).toMatchObject({ projectId: null, claimType: "reimbursement", companyPayableAmountCents: "3500", lines: [{ expenseCategory: "交通费", amountCents: "3500", noEvidenceReason: "公共交通无纸质凭证" }] });
    expect((await request(path, undefined, strangerToken)).status).toBe(404);
    const illegalLoan = await request("/expense-claims", { claimType: "loan", companyEntityId, applicantUserId, factWitnessUserId, reason: "无项目借款", requestedAmountCents: "100" });
    expect(illegalLoan.status).toBe(400);
  }, 60_000);

  (enabled ? it : it.skip)("缺少项目审批岗位时提交失败，原草稿与空快照可继续回读", async () => {
    const db = app.get(PrismaService);
    const project = await db.project.create({ data: { code: `NO-PM-${randomUUID()}`, name: "尚未配置审批岗位的项目" } });
    await db.projectMember.create({ data: { projectId: project.id, userId: applicantUserId, positionKey: "employee" } });
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId: project.id, applicantUserId, reason: "审批配置失败回读", requestedAmountCents: "1200" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(400);
    const detail = await request(path);
    expect(detail.body.status).toBe("draft");
    expect(detail.body.entrySnapshots).toEqual([]);
  }, 60_000);

  (enabled ? it : it.skip)("零星费用竞争提交只生成一份审批快照并保持原付款金额", async () => {
    const created = await request("/expense-claims", { claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service", companyEntityId, projectId, applicantUserId, payeeName: "合成临时服务收款人", reason: "临时服务费", requestedAmountCents: "50000" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    const results = await Promise.all([request(`${path}/submission`, {}), request(`${path}/submission`, {})]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 400]);
    const detail = await request(path);
    expect(detail.body.entrySnapshots).toHaveLength(1);
    expect(detail.body.entrySnapshots[0]!.valuesSnapshot).toMatchObject({ claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service", companyPayableAmountCents: "50000", loanOffsetAmountCents: "0" });
  }, 60_000);

  (enabled ? it.each : it.skip.each)([["1", "0.01"], ["12345", "123.45"], ["9223372036854775807", "92233720368547758.07"]])("金额%s分的字段快照按元精确回显%s，不经浮点数", async (cents, yuan) => {
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "精确金额回显", requestedAmountCents: cents });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    const snapshot = (await request(path)).body.entrySnapshots[0]!;
    expect(snapshot.valuesSnapshot).toMatchObject({ requestedAmountCents: cents, requestedAmountYuan: yuan });
  }, 60_000);

  (enabled ? it.each : it.skip.each)(["", "1.1", "9223372036854775808"])("非法或超大分金额%s仍由原HTTP校验拒绝", async (requestedAmountCents) => {
    expect((await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "无效金额", requestedAmountCents })).status).toBe(400);
  });
});
