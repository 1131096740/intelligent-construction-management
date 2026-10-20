import { verifyApprovedPdf } from "./approval-pdf-acceptance.test-support";
import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
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
    const user = await db.user.create({ data: { name: ({ employee: "测试经办员", comprehensive_director: "测试综合主管", project_manager: "测试项目经理", finance_director: "测试财务主管", finance_staff: "测试财务员", chairman: "测试董事长", general_manager: "测试总经理" } as Record<string, string>)[role] ?? "测试员工", phone, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "合成岗位" } });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: scope } });
    const login = await request("/auth/login", "POST", { phone, password }, "");
    expect(login.status).toBe(201);
    sessions.set(user.id, login.body);
    return { id: user.id, token: login.body.tokens.accessToken as string };
  }

  async function sign(token: string, replacement = false) {
    const form = new FormData();
    form.append("file", new Blob([replacement ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") : Buffer.from("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", "base64")], { type: "image/png" }), "合成签名.png");
    expect((await fetch(`${base}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form })).status).toBe(201);
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
    for (const reviewer of [director, manager, chairman, financeDirector]) await sign(reviewer.token);


  });
  afterAll(async () => { if (app) await app.close(); });

  it("同人兼三节点及领导双岗须逐次签字，或签只记录一个实际岗位", async () => {
    const db = app.get(PrismaService);
    const applicant = await actor("employee", projectId);
    for (const role of ["comprehensive_director", "project_manager", "chairman", "general_manager"]) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "测试兼岗" } });
      await db.userPosition.create({ data: { userId: applicant.id, positionId: position.id, projectId: role === "project_manager" ? projectId : null } });
    }
    try {
      await sign(applicant.token);
      const created = await request("/general-procurements", "POST", { requestKey: randomUUID(), projectId, companyEntityId, category: "office_supplies", reason: "兼岗逐节点签批验证", requestedAmountCents: "10000" }, applicant.token);
      expect(created.status).toBe(201);
      const path = `/general-procurements/${created.body.id}`;
      expect((await request(`${path}/submission`, "POST", { revision: 1 }, applicant.token)).status).toBe(201);
      expect((await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, applicant.token)).status).toBe(400);
      for (const revision of [2, 3, 4]) {
        expect(await request(`${path}/review`, "POST", { revision, decision: "approve", selfReviewReason: "本人兼任当前审批岗位，已逐项核验", confirmationPassword: password }, applicant.token))
          .toMatchObject({ status: 201, body: { revision: revision + 1 } });
      }
      const instance = await db.approvalInstance.findFirstOrThrow({ where: { businessType: "general_procurement", businessId: created.body.id } });
      const actions = await db.approvalActionLog.findMany({ where: { approvalInstanceId: instance.id }, orderBy: { createdAt: "asc" } });
      expect(actions.map(action => action.action)).toEqual(["approve", "approve", "approve"]);
      expect(actions.map(action => action.approvedRoleKey)).toEqual(["comprehensive_director", "project_manager", "chairman"]);
      expect(actions.every(action => action.actorUserId === applicant.id && action.signatureVersionIdSnapshot)).toBe(true);
      await verifyApprovedPdf({ db, baseUrl: base, token: applicant.token, password,
        businessType: "general_procurement", businessId: created.body.id,
        roles: ["comprehensive_director", "project_manager", "chairman"], label: "综合采购-同人三节点" });
      const response = await fetch(`${base}/approval-forms/general_procurement/${created.body.id}/download`, { method: "POST", headers: { authorization: `Bearer ${applicant.token}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: password, downloadReason: "兼岗签批本地验收" }) });
      expect(response.status).toBe(201);
      expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBeGreaterThan(0);
    } finally {
      await db.userPosition.deleteMany({ where: { userId: applicant.id } });
    }
  });

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

  it("固定综合部、项目经理顺序，末节点允许总经理或签并形成真实签名PDF", async () => {
    const generalManager = await actor("general_manager");
    await sign(generalManager.token);
    const created = await request("/general-procurements", "POST", {
      requestKey: randomUUID(), projectId, companyEntityId, category: "meals", reason: "项目现场工作餐", requestedAmountCents: "10000"
    });
    expect(created.status).toBe(201);
    const path = `/general-procurements/${created.body.id}`;
    expect(await request(`${path}/submission`, "POST", { revision: 1 })).toMatchObject({ status: 201, body: { status: "approval_pending", revision: 2 } });
    expect(await request(`/approval-forms/general_procurement/${created.body.id}/capability`)).toMatchObject({ status: 200, body: { available: false } });
    expect((await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, chairman.token)).status).toBe(403);
    expect(await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, director.token)).toMatchObject({ status: 201, body: { revision: 3 } });
    expect((await request(`${path}/review`, "POST", { revision: 2, decision: "approve" }, director.token)).status).toBe(409);
    expect(await request(`${path}/review`, "POST", { revision: 3, decision: "approve" }, manager.token)).toMatchObject({ status: 201, body: { revision: 4 } });
    expect(await request(`${path}/review`, "POST", { revision: 4, decision: "approve" }, generalManager.token)).toMatchObject({ status: 201, body: { revision: 5, status: "approved_pending_archive" } });
    expect((await request(`${path}/review`, "POST", { revision: 4, decision: "approve" }, chairman.token)).status).toBe(409);
    expect(await request(`/approval-forms/general_procurement/${created.body.id}/capability`)).toMatchObject({ status: 200, body: { available: true } });
    const detail = await request(path);
    expect(detail.body.approvals[0].nodes.map((node: { name: string }) => node.name)).toEqual(["综合部主管", "项目经理", "董事长/总经理"]);
    expect(detail.body.canArchive).toBe(false);
    const db = app.get(PrismaService);
    const instance = await db.approvalInstance.findFirstOrThrow({ where: { businessType: "general_procurement", businessId: created.body.id } });
    const logs = await db.approvalActionLog.findMany({ where: { approvalInstanceId: instance.id, action: "approve" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(logs.map(log => log.actorUserId)).toEqual([director.id, manager.id, generalManager.id]);
    expect(logs.map(log => log.approvedRoleKey)).toEqual(["comprehensive_director", "project_manager", "general_manager"]);
    for (const log of logs) {
      const version = await db.handwrittenSignatureVersion.findUniqueOrThrow({ where: { id: log.signatureVersionIdSnapshot! } });
      expect(version.userId).toBe(log.actorUserId);
      expect(version.fileId).toBe(log.signatureFileIdSnapshot);
      expect(version.contentSha256).toBe(log.signatureSha256Snapshot);
    }
    await verifyApprovedPdf({ db, baseUrl: base, token: employee.token, password,
      businessType: "general_procurement", businessId: created.body.id,
      roles: ["comprehensive_director", "project_manager", "general_manager"], label: "综合采购-总经理或签" });
    // Renaming and replacing the profile signature must not alter the approved document's evidence.
    const oldMetadata = logs[2].metadata;
    await db.user.update({ where: { id: generalManager.id }, data: { name: "审批后改名" } });
    await sign(generalManager.token, true);
    const replacementSignature = await db.handwrittenSignatureVersion.findFirstOrThrow({ where: { userId: generalManager.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(replacementSignature.id).not.toBe(logs[2].signatureVersionIdSnapshot);
    expect(replacementSignature.contentSha256).not.toBe(logs[2].signatureSha256Snapshot);
    const response = await fetch(`${base}/approval-forms/general_procurement/${created.body.id}/download`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${employee.token}` },
      body: JSON.stringify({ confirmationPassword: password, downloadReason: "本机验收留存" })
    });
    expect(response.status).toBe(201);
    const pdf = Buffer.from(await response.arrayBuffer());
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    expect((await db.approvalActionLog.findUniqueOrThrow({ where: { id: logs[2].id } })).metadata).toEqual(oldMetadata);

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
    await sign(generalManager.token);
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
    await sign(generalManager.token);
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
    await verifyApprovedPdf({ db: app.get(PrismaService), baseUrl: base, token: director.token, password,
      businessType: "expense_claim", businessId: claim.body.id,
      roles: ["comprehensive_director", "project_manager", "finance_director", "chairman"], label: "综合采购付款" });
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
    expect((await request("/general-procurements", "POST", { ...input, requestKey: randomUUID() }, admin.token)).status).toBe(201);
    expect((await request("/me/work-items", "GET", undefined, admin.token)).status).toBe(200);
    const created = await request("/general-procurements", "POST", input);
    expect((await request(`/general-procurements/${created.body.id}/submission`, "POST", { revision: 1 })).status).toBe(201);
    expect((await request(`/general-procurements/${created.body.id}/review`, "POST", { revision: 2, decision: "approve" }, admin.token)).status).toBe(403);
    const newDirector = await actor("comprehensive_director");
    expect((await request(`/general-procurements/${created.body.id}/review`, "POST", { revision: 2, decision: "approve" }, newDirector.token)).status).toBe(403);
    const preview = await request("/organization/role-changes/preview", "POST", { operation: "remove", userId: director.id, scope: "global", roleKey: "comprehensive_director" }, chairman.token);
    expect(preview).toMatchObject({ status: 201, body: { canApply: false } });
    expect(preview.body.summary.blockingInstances).toBeGreaterThan(0);
  });

});
