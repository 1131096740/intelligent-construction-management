import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const describePg = process.env.RUN_GENERAL_PROCUREMENT_PG16 === "1" ? describe : describe.skip;

describePg("综合采购公开 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let projectId: string;
  let companyEntityId: string;
  let employee: { id: string; token: string };
  let director: { id: string; token: string };
  let manager: { id: string; token: string };
  let finance: { id: string; token: string };
  let financeDirector: { id: string; token: string };
  let chairman: { id: string; token: string };
  const sessions = new Map<string, unknown>();
  const password = "Local-Procurement-Only-01";

  async function request(path: string, method = "GET", body?: unknown, token = employee?.token) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  async function actor(role: string, scope: string | null = null) {
    const db = app.get(PrismaService);
    const phone = `local-procurement-${randomUUID()}`;
    const user = await db.user.create({ data: { name: `合成${role}`, phone, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "合成岗位" } });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: scope } });
    const login = await request("/auth/login", "POST", { phone, password }, "");
    expect(login.status).toBe(201);
    sessions.set(user.id, login.body);
    return { id: user.id, token: login.body.tokens.accessToken as string };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/general_procurement") throw new Error("仅允许本机一次性采购测试数据库");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const db = app.get(PrismaService);
    projectId = (await db.project.create({ data: { code: `GP-${randomUUID()}`, name: "合成采购项目" } })).id;
    companyEntityId = (await db.companyEntity.create({ data: { name: "合成费用承担公司", dataStatus: "complete" } })).id;
    employee = await actor("employee", projectId);
    director = await actor("comprehensive_director");
    manager = await actor("project_manager", projectId);
    chairman = await actor("chairman");
    finance = await actor("finance_staff");
    financeDirector = await actor("finance_director");
    const suffix = randomUUID();
    const affiliate = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: `gp-${suffix}`, unifiedSocialCreditCode: `GP${suffix.replaceAll("-", "").slice(0, 16)}`, createdByUserId: director.id } });
    const version = await db.businessPartyVersion.create({ data: { businessPartyId: affiliate.id, versionNo: 1, snapshot: { name: affiliate.name, unifiedSocialCreditCode: affiliate.unifiedSocialCreditCode }, createdByUserId: director.id } });
    await db.projectAffiliateAssignment.create({ data: { projectId, businessPartyId: affiliate.id, businessPartyVersionId: version.id, affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "本机合成测试主数据", assignedByUserId: director.id } });
    for (const reviewer of [director, manager, chairman, financeDirector]) {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成签名.png");
      expect((await fetch(`${base}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${reviewer.token}` }, body: form })).status).toBe(201);
    }

  });
  afterAll(async () => { if (app) await app.close(); });

  it("普通员工可以建立综合采购草稿并从公开详情读回元金额对应的分值", async () => {
    const created = await request("/general-procurements", "POST", {
      requestKey: randomUUID(), projectId, companyEntityId, category: "office_supplies", reason: "购买办公纸张与笔", requestedAmountCents: "12345"
    });
    expect(created.status).toBe(201);
    expect(await request(`/general-procurements/${created.body.id}`)).toMatchObject({ status: 200, body: {
      status: "draft", reason: "购买办公纸张与笔", requestedAmountCents: "12345", categoryLabel: "办公用品", revision: 1
    } });
  });
  it("采购台账支持翻页和全量检索，不能绕过人员可见范围", async () => {
    const db = app.get(PrismaService);
    const marker = randomUUID();
    const seeded = Array.from({ length: 201 }, (_, index) => ({ id: randomUUID(), code: `PAGE-${marker}-${index}`, requestKey: randomUUID(), creationFingerprint: marker,
      projectId, companyEntityId, companyNameSnapshot: "合成费用承担公司", applicantUserId: employee.id, applicantNameSnapshot: "分页合成人员",
      category: "office_supplies", reason: index === 0 ? `最旧待查-${marker}` : `分页-${marker}`, requestedAmountCents: 100n,
      updatedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)) }));
    await db.generalProcurement.createMany({ data: seeded });
    const page = await request(`/general-procurements?search=${marker}&page=5&pageSize=50`, "GET", undefined, director.token);
    expect(page).toMatchObject({ status: 200, body: { total: 201, page: 5, pageSize: 50, items: [expect.objectContaining({ id: seeded[0].id })] } });
    expect((await request(`/general-procurements?search=${encodeURIComponent(`最旧待查-${marker}`)}&status=drafts`, "GET", undefined, director.token)).body.items).toEqual([expect.objectContaining({ id: seeded[0].id })]);
    const stranger = await actor("employee");
    expect((await request(`/general-procurements?search=${marker}`, "GET", undefined, stranger.token)).body).toMatchObject({ total: 0, items: [] });
    expect((await request("/general-procurements?page=-1")).status).toBe(400);
  });

  it("固定综合部、项目经理、董事长顺序，禁止越级或总经理替代，完成后仍待归档", async () => {
    const generalManager = await actor("general_manager");
    const created = await request("/general-procurements", "POST", {
      requestKey: randomUUID(), projectId, companyEntityId, category: "meals", reason: "项目现场工作餐", requestedAmountCents: "10000"
    });
    expect(created.status).toBe(201);
    const path = `/general-procurements/${created.body.id}`;
    expect(await request(`${path}/submission`, "POST", { revision: 1 })).toMatchObject({ status: 201, body: { status: "approval_pending", revision: 2 } });
    expect((await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, chairman.token)).status).toBe(403);
    expect(await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, director.token)).toMatchObject({ status: 201, body: { revision: 3 } });
    expect((await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, director.token)).status).toBe(409);
    expect(await request(`${path}/review`, "POST", { revision: 3, decision: "approve" }, manager.token)).toMatchObject({ status: 201, body: { revision: 4 } });
    expect((await request(`${path}/review`, "POST", { revision: 4, decision: "approve" }, generalManager.token)).status).toBe(403);
    expect(await request(`${path}/review`, "POST", { revision: 4, decision: "approve" }, chairman.token)).toMatchObject({ status: 201, body: { revision: 5, status: "approved_pending_archive" } });
    const detail = await request(path);
    expect(detail.body.approvals[0].nodes.map((node: { name: string }) => node.name)).toEqual(["综合部主管", "项目经理", "董事长"]);
    expect(detail.body.canArchive).toBe(false);
  });

  it("退回保留原申请快照，修改重提从综合部重新开始，重复审批只成功一次", async () => {
    const input = { requestKey: randomUUID(), projectId, companyEntityId, category: "logistics", reason: "后勤用品待核实", requestedAmountCents: "8000" };
    const created = await request("/general-procurements", "POST", input);
    const path = `/general-procurements/${created.body.id}`;
    expect((await request(`${path}/submission`, "POST", { revision: 1 })).status).toBe(201);
    expect((await request(`${path}/review`, "POST", { revision: 2, decision: "return", comment: "请补充明细" }, director.token)).status).toBe(201);
    const updated = await request(`${path}/draft`, "POST", { revision: 3, projectId, companyEntityId, category: "logistics", reason: "后勤用品清洁剂十瓶", requestedAmountCents: "7000" });
    expect(updated).toMatchObject({ status: 201, body: { revision: 4 } });
    expect((await request(`${path}/submission`, "POST", { revision: 4 })).status).toBe(201);
    const detail = await request(path);
    expect(detail.body.submissions.map((item: { requestedAmountCents: string }) => item.requestedAmountCents)).toEqual(["8000", "7000"]);
    expect(detail.body.currentNodeName).toBe("综合部主管");
    const outcomes = await Promise.all([1, 2].map(() => request(`${path}/review`, "POST", { revision: 5, decision: "approve" }, director.token)));
    expect(outcomes.map((item) => item.status).sort()).toEqual([201, 409]);
    expect((await request(`${path}/withdrawal`, "POST", { revision: 6, reason: "需求需重新核实" })).status).toBe(201);
    expect((await request(path)).body.status).toBe("returned");
  });

  async function approvedApplication(amount = "20000") {
    const created = await request("/general-procurements", "POST", { requestKey: randomUUID(), projectId, companyEntityId, category: "construction_tools", reason: "项目手工具", requestedAmountCents: amount });
    expect(created.status).toBe(201);
    const path = `/general-procurements/${created.body.id}`;
    expect((await request(`${path}/submission`, "POST", { revision: 1 })).status).toBe(201);
    for (const [index, reviewer] of [director, manager, chairman].entries()) {
      expect((await request(`${path}/review`, "POST", { revision: 2 + index, decision: "approve" }, reviewer.token)).status).toBe(201);
    }
    return { id: created.body.id as string, path };
  }

  async function uploadArchive(path: string, token = director.token) {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成采购归档依据.png");
    const response = await fetch(`${base}${path}/archive-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: response.status, body: await response.json() };
  }

  it("只有综合部可在三步批准后归档，附件私有且归档后内容不可覆盖", async () => {
    const { path } = await approvedApplication();
    const denied = await uploadArchive(path, employee.token);
    expect(denied).toMatchObject({ status: 403, body: { statusCode: 403 } });
    const uploaded = await uploadArchive(path);
    expect(uploaded.status).toBe(201);
    const archive = { revision: 5, fileId: uploaded.body.id, note: "已核对采购内容与依据" };
    expect((await request(`${path}/archive`, "POST", archive, chairman.token)).status).toBe(403);
    expect(await request(`${path}/archive`, "POST", archive, director.token)).toMatchObject({ status: 201, body: { status: "archived", revision: 6 } });
    const detail = await request(path);
    expect(detail.body.archive).toMatchObject({ fileName: "合成采购归档依据.png", note: archive.note });
    expect(detail.body.canEdit).toBe(false);
    expect((await request(`${path}/draft`, "POST", { revision: 6, projectId, companyEntityId, category: "other", reason: "尝试篡改", requestedAmountCents: "1" })).status).toBe(409);
    const stranger = await actor("employee");
    expect(await app.get(PrismaService).$queryRawUnsafe(`SELECT "tableName", "columnName" FROM jg_file_business_binding_columns() WHERE "tableName" = 'GeneralProcurement'`))
      .toEqual([{ tableName: "GeneralProcurement", columnName: "archiveFileId" }]);
    const generalManager = await actor("general_manager");
    const generalManagerDetail = await request(path, "GET", undefined, generalManager.token);
    expect(generalManagerDetail).toMatchObject({ status: 200, body: { canReview: false, canArchive: false, canRequestPayment: false } });
    expect((await request("/general-procurements?status=archived", "GET", undefined, generalManager.token)).body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: detail.body.id })]));
    const downloadPath = `/files/${uploaded.body.id}/download-ticket`;
    const download = { confirmationPassword: password, downloadReason: "核对采购依据" };
    expect((await request(downloadPath, "POST", download, stranger.token)).status).toBe(403);
    expect((await request(downloadPath, "POST", download, employee.token)).status).toBe(201);
    expect((await request(downloadPath, "POST", download, generalManager.token)).status).toBe(201);
  });

  it("归档后仅综合部能请款，重试不重复，分批与并发不能超出批准金额", async () => {
    const { id, path } = await approvedApplication();
    const payment = { claimType: "incidental_expense", incidentalExpenseCategory: "procurement_construction_tools", generalProcurementId: id,
      generalProcurementRequestKey: randomUUID(), companyEntityId, projectId, reason: "综合采购第一笔付款", requestedAmountCents: "10000", paymentMethod: "bank_transfer", payeeName: "合成工具供应商" };
    expect((await request("/expense-claims", "POST", payment, director.token)).status).toBe(409);
    const uploaded = await uploadArchive(path);
    expect((await request(`${path}/archive`, "POST", { revision: 5, fileId: uploaded.body.id, note: "合成归档" }, director.token)).status).toBe(201);
    expect((await request("/expense-claims", "POST", payment, employee.token)).status).toBe(403);
    const first = await request("/expense-claims", "POST", payment, director.token);
    expect(first).toMatchObject({ status: 201, body: { status: "draft", requestedAmountCents: "10000" } });
    const repeat = await request("/expense-claims", "POST", payment, director.token);
    expect(repeat.body.id).toBe(first.body.id);
    expect((await request("/expense-claims", "POST", { ...payment, requestedAmountCents: "9000" }, director.token)).status).toBe(409);
    const parallel = await Promise.all([1, 2].map(() => request("/expense-claims", "POST", { ...payment, generalProcurementRequestKey: randomUUID(), requestedAmountCents: "9000" }, director.token)));
    expect(parallel.map((item) => item.status).sort()).toEqual([201, 409]);
    expect((await request("/expense-claims", "POST", { ...payment, generalProcurementRequestKey: randomUUID(), requestedAmountCents: "2000" }, director.token)).status).toBe(409);
    const detail = await request(path, "GET", undefined, director.token);
    expect(detail.body.paymentSummary).toEqual({ reservedAmountCents: "19000", availableAmountCents: "1000" });
    expect(detail.body.payments).toHaveLength(2);
    const claim = await request(`/expense-claims/${first.body.id}`, "GET", undefined, director.token);
    expect(claim.body.generalProcurement).toMatchObject({ id, code: detail.body.code });
  });

  it("采购工作台与审批中心显示当前员工应办事项，付款延续原审批链", async () => {
    const options = await request("/general-procurements/create-options");
    expect(options).toMatchObject({ status: 200, body: { canCreate: true, projects: expect.arrayContaining([expect.objectContaining({ id: projectId })]) } });
    const beforeSummary = await request("/me/workbench-summary", "GET", undefined, director.token);
    const beforeCount = beforeSummary.body.cards.find((card: { id: string }) => card.id === "approval_todo").count;
    const created = await request("/general-procurements", "POST", { requestKey: randomUUID(), projectId, companyEntityId, category: "utilities", reason: "项目网络服务", requestedAmountCents: "30000" });
    const id = created.body.id;
    const path = `/general-procurements/${id}`;
    expect((await request(`${path}/submission`, "POST", { revision: 1 })).status).toBe(201);
    const todo = await request("/me/work-items", "GET", undefined, director.token);
    expect(todo.status).toBe(200);
    const summary = await request("/me/workbench-summary", "GET", undefined, director.token);
    expect(summary.body.cards.find((card: { id: string }) => card.id === "approval_todo").count).toBe(beforeCount + 1);
    expect(todo.body.approvalCenter.pendingApproval).toEqual(expect.arrayContaining([expect.objectContaining({ businessId: id, targetPath: `/综合采购申请/${id}` })]));
    const stranger = await actor("employee");
    expect((await request("/general-procurements", "GET", undefined, stranger.token)).body.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    expect((await request("/general-procurements", "GET", undefined, director.token)).body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    for (const [index, reviewer] of [director, manager, chairman].entries()) expect((await request(`${path}/review`, "POST", { revision: 2 + index, decision: "approve" }, reviewer.token)).status).toBe(201);
    const uploaded = await uploadArchive(path);
    expect((await request(`${path}/archive`, "POST", { revision: 5, fileId: uploaded.body.id, note: "合成归档" }, director.token)).status).toBe(201);
    await actor("finance_director");
    const payment = await request("/expense-claims", "POST", { claimType: "incidental_expense", incidentalExpenseCategory: "procurement_utilities", generalProcurementId: id,
      generalProcurementRequestKey: randomUUID(), companyEntityId, projectId, reason: "采购网络费付款", requestedAmountCents: "10000", paymentMethod: "银行转账", payeeName: "合成网络公司" }, director.token);
    expect(payment.status).toBe(201);
    expect((await request(`/expense-claims/${payment.body.id}/submission`, "POST", {}, director.token)).status).toBe(201);
    const paymentSummary = await request("/me/workbench-summary", "GET", undefined, director.token);
    expect(paymentSummary.body.cards.find((card: { id: string }) => card.id === "approval_todo").count).toBe(beforeCount + 1);
    const paymentTodo = await request("/me/work-items", "GET", undefined, director.token);
    expect(paymentTodo.body.approvalCenter.pendingApproval).toEqual(expect.arrayContaining([expect.objectContaining({ businessId: payment.body.id, targetPath: `/费用与报销/${payment.body.id}` })]));
    expect((await request(`/expense-claims/${payment.body.id}`, "GET", undefined, director.token)).body.approval).toMatchObject({ currentNodeName: "综合部主管", canReview: true, requiresSelfReviewConfirmation: true });
  });

  (process.env.RUN_GENERAL_PROCUREMENT_BROWSER === "1" ? it : it.skip)("电脑和手机通过真实页面完成申请、三步审批、归档和创建付款草稿", async () => {
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, GP_API_URL: base, GP_PASSWORD: password,
        GP_SESSIONS: JSON.stringify({ employee: sessions.get(employee.id), director: sessions.get(director.id), manager: sessions.get(manager.id), chairman: sessions.get(chairman.id) }) };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.general-procurement.config.ts"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("综合采购真实浏览器验证失败")));
    });
  }, 240_000);

  it("付款草稿可由综合部撤销并释放额度，其他岗位不能撤销", async () => {
    const { id, path } = await approvedApplication("6000");
    const uploaded = await uploadArchive(path);
    expect((await request(`${path}/archive`, "POST", { revision: 5, fileId: uploaded.body.id, note: "合成归档" }, director.token)).status).toBe(201);
    const payment = { claimType: "incidental_expense", incidentalExpenseCategory: "procurement_construction_tools", generalProcurementId: id, generalProcurementRequestKey: randomUUID(), companyEntityId, projectId, reason: "合成请款", requestedAmountCents: "6000", payeeName: "合成收款人" };
    const claim = await request("/expense-claims", "POST", payment, director.token);
    expect(claim.status).toBe(201);
    const cancelPath = `${path}/payments/${claim.body.id}/cancellation`;
    expect((await request(cancelPath, "POST", { reason: "收款方录错" }, chairman.token)).status).toBe(403);
    expect((await request(cancelPath, "POST", { reason: "收款方录错" }, director.token)).status).toBe(201);
    expect((await request(path, "GET", undefined, director.token)).body.paymentSummary.availableAmountCents).toBe("6000");
    expect((await request(`/expense-claims/${claim.body.id}/submission`, "POST", {}, director.token)).status).toBe(400);
  });

  it("关联付款走原四步审批，财务分次实付及重复凭证不会重复实付", async () => {
    const { id, path } = await approvedApplication("50000");
    const uploaded = await uploadArchive(path);
    expect((await request(`${path}/archive`, "POST", { revision: 5, fileId: uploaded.body.id, note: "合成归档" }, director.token)).status).toBe(201);
    const claim = await request("/expense-claims", "POST", { claimType: "incidental_expense", incidentalExpenseCategory: "procurement_construction_tools", generalProcurementId: id, generalProcurementRequestKey: randomUUID(), companyEntityId, projectId, reason: "合成分次实付", requestedAmountCents: "20000", payeeName: "合成工具供应商" }, director.token);
    expect(claim.status).toBe(201);
    const claimPath = `/expense-claims/${claim.body.id}`;
    const generalManager = await actor("general_manager");
    expect(await request(claimPath, "GET", undefined, generalManager.token)).toMatchObject({ status: 200, body: { status: "draft" } });
    expect((await request(claimPath, "GET", undefined, employee.token)).status).toBe(404);
    expect((await request(`${claimPath}/submission`, "POST", {}, director.token)).status).toBe(201);
    expect((await request(`${claimPath}/approval`, "POST", { decision: "approve" }, director.token)).status).toBe(400);
    expect(await request(claimPath, "GET", undefined, generalManager.token)).toMatchObject({ status: 200, body: { approval: { canReview: false } } });
    expect((await request(`${claimPath}/approval`, "POST", { decision: "approve" }, generalManager.token)).status).toBe(403);
    for (const reviewer of [director, manager, financeDirector, chairman]) {
      const result = await request(`${claimPath}/approval`, "POST", { decision: "approve", ...(reviewer.id === director.id ? { selfReviewReason: "综合部按已批准采购办理付款", confirmationPassword: password } : {}) }, reviewer.token);
      expect(result).toMatchObject({ status: 201 });
    }
    expect((await request(claimPath, "GET", undefined, finance.token)).body).toMatchObject({ status: "approved_pending_payment", companyPayableAmountCents: "20000" });
    const uploadVoucher = async (token: string) => {
      const form = new FormData(); form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成银行付款凭证.png");
      const response = await fetch(`${base}${claimPath}/payment-voucher-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
      return { status: response.status, body: await response.json() };
    };
    expect((await uploadVoucher(employee.token)).status).toBe(403);
    const voucher = await uploadVoucher(finance.token);
    expect(voucher.status).toBe(201);
    const input = { amountCents: "15000", paidAt: "2026-10-15", paymentMethod: "合成银行转账", voucherFileId: voucher.body.id, confirmationPassword: password };
    expect((await request(`${claimPath}/payments`, "POST", input, finance.token)).status).toBe(400);
    const db = app.get(PrismaService);
    const receiptFile = await db.fileObject.create({ data: { bucket: "local-private", objectKey: `fixture/${randomUUID()}.pdf`, originalName: "合成到账凭据.pdf", mimeType: "application/pdf", sizeBytes: 128, uploadedByUserId: finance.id, contentSha256: "a".repeat(64), storageStatus: "active" } });
    await db.projectReceipt.create({ data: { projectId, receivedAt: new Date("2026-10-15"), amountCents: 100000n, payerName: "合成业主", sourceType: "general_contractor_payment", voucherFileId: receiptFile.id, recordedByUserId: finance.id } });
    const paid = await request(`${claimPath}/payments`, "POST", input, finance.token);
    expect(paid).toMatchObject({ status: 201, body: { status: "partially_paid", paidAmountCents: "15000" } });
    expect((await request(`${claimPath}/payments`, "POST", input, finance.token)).body).toMatchObject({ status: "partially_paid", paidAmountCents: "15000" });
    const detail = await request(claimPath, "GET", undefined, finance.token);
    expect(detail.body.paymentExecutions).toHaveLength(1);
    expect(detail.body.fundedAmountCents).toBe("15000");
    expect(await request(claimPath, "GET", undefined, generalManager.token)).toMatchObject({ status: 200, body: { status: "partially_paid", fundedAmountCents: "15000" } });
    const original = await request(path, "GET", undefined, director.token);
    expect(original.body.payments[0]).toMatchObject({ status: "partially_paid", fundedAmountCents: "15000" });
  });

  it("技术管理员没有业务审批权，岗位变更预览不能让冻结审批链无人可办", async () => {
    const admin = await actor("super_admin");
    const input = { requestKey: randomUUID(), projectId, companyEntityId, category: "office_supplies", reason: "合成岗位变更校验", requestedAmountCents: "1000" };
    expect((await request("/general-procurements", "POST", input, admin.token)).status).toBe(403);
    expect((await request("/me/work-items", "GET", undefined, admin.token)).status).toBe(200);
    const created = await request("/general-procurements", "POST", input);
    expect((await request(`/general-procurements/${created.body.id}/submission`, "POST", { revision: 1 })).status).toBe(201);
    const newDirector = await actor("comprehensive_director");
    expect((await request(`/general-procurements/${created.body.id}/review`, "POST", { revision: 2, decision: "approve" }, newDirector.token)).status).toBe(403);
    const preview = await request("/organization/role-changes/preview", "POST", { operation: "remove", userId: director.id, scope: "global", roleKey: "comprehensive_director" }, chairman.token);
    expect(preview).toMatchObject({ status: 201, body: { canApply: false } });
    expect(preview.body.summary.blockingInstances).toBeGreaterThan(0);
  });

});
