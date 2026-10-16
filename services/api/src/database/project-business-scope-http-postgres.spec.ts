import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";
import { ContractApprovalRouteService } from "../contract/contract-approval-route.service";
import { SettlementService } from "../settlement/settlement.service";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const describePg = process.env.RUN_PROJECT_BUSINESS_SCOPE_PG16 === "1" ? describe : describe.skip;
type Actor = { id: string; token: string };

describePg("多项目业务范围公开 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let first: string;
  let second: string;
  let inactive: string;
  let company: string;
  let companyContract: Actor;
  let projectContract: Actor;
  let materialDirector: Actor;
  let firstManager: Actor;
  let secondManager: Actor;
  let director: Actor;
  let chairman: Actor;
  let employee: Actor;
  let financeDirector: Actor;
  const sessions = new Map<string, unknown>();
  const password = "Local-Project-Scope-Only-01";

  function expectStatus(result: { status: number; body: unknown }, status: number) {
    if (result.status !== status) throw new Error(`合成 HTTP 验收期待 ${status}，实际 ${result.status}: ${JSON.stringify(result.body)}`);
  }

  async function request(route: string, actor: Actor, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${base}${route}`, { method,
      headers: { "content-type": "application/json", authorization: `Bearer ${actor.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  async function person(role: string, projects: Array<string | null>) {
    const db = app.get(PrismaService);
    const user = await db.user.create({ data: { name: `合成${role}`, phone: `scope-${randomUUID()}`,
      passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, create: { key: role, name: "合成岗位" }, update: {} });
    await db.userPosition.createMany({ data: projects.map((projectId) => ({ userId: user.id, positionId: position.id, projectId })) });
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) });
    expect(response.status).toBe(201);
    const session = await response.json();
    sessions.set(user.id, session);
    return { id: user.id, token: session.tokens.accessToken as string };
  }

  async function upload(route: string, actor: Actor) {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成依据.png");
    form.append("idempotencyKey", randomUUID());
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { authorization: `Bearer ${actor.token}` }, body: form });
    const body = await response.json();
    expect({ status: response.status, body }).toMatchObject({ status: 201 });
    return body as { id: string };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/project_business_scope") throw new Error("仅允许本机一次性项目范围测试数据库");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const db = app.get(PrismaService);
    const project = async (name: string, isActive = true) => (await db.project.create({ data: { code: randomUUID(), name, isActive } })).id;
    first = await project("合成甲项目");
    second = await project("合成乙项目");
    inactive = await project("合成已停用项目", false);
    company = (await db.companyEntity.create({ data: { name: "合成我方公司", dataStatus: "complete" } })).id;
    companyContract = await person("contract_staff", [null]);
    projectContract = await person("contract_staff", [first]);
    materialDirector = await person("material_director", [null]);
    firstManager = await person("project_manager", [first]);
    secondManager = await person("project_manager", [second]);
    director = await person("comprehensive_director", [null]);
    chairman = await person("chairman", [null]);
    employee = await person("employee", [first]);
    financeDirector = await person("finance_director", [null]);
    await person("contract_director", [null]);
    const suffix = randomUUID();
    const affiliate = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: `scope-${suffix}`, unifiedSocialCreditCode: `SC${suffix.replaceAll("-", "").slice(0, 16)}`, createdByUserId: director.id } });
    const affiliateVersion = await db.businessPartyVersion.create({ data: { businessPartyId: affiliate.id, versionNo: 1, snapshot: { name: affiliate.name, unifiedSocialCreditCode: affiliate.unifiedSocialCreditCode }, createdByUserId: director.id } });
    for (const projectId of [first, second]) {
      await db.projectAffiliateAssignment.create({ data: { projectId, businessPartyId: affiliate.id, businessPartyVersionId: affiliateVersion.id, affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "本机合成项目建账", assignedByUserId: director.id } });
    }
    for (const reviewer of [firstManager, secondManager, director, chairman, companyContract, materialDirector, financeDirector]) {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成签名.png");
      expect((await fetch(`${base}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${reviewer.token}` }, body: form })).status).toBe(201);
    }
  });
  afterAll(async () => { await app?.close(); });

  const ids = (body: Array<{ id: string }>) => body.map((row) => row.id).sort();

  it("公司级合同经办可选所有启用项目，项目经办只可选所属项目", async () => {
    const global = await request("/projects", companyContract);
    expect(global.status).toBe(200);
    expect(ids(global.body)).toEqual([first, second].sort());
    expect(ids((await request("/projects", projectContract)).body)).toEqual([first]);
    const options = await request("/general-procurements/create-options", companyContract);
    expect(ids(options.body.projects)).toEqual([first, second].sort());
    expect((await request(`/projects/${second}/operating-funds-overview`, companyContract)).status).toBe(403);
  });

  it("零星采购对所有启用项目开放，但仍要求对应项目的材料岗位", async () => {
    const global = await request("/spot-procurements/create-project-options", materialDirector);
    expect(global.status).toBe(200);
    expect(ids(global.body)).toEqual([first, second].sort());
    const local = await person("material_staff", [first]);
    expect(ids((await request("/spot-procurements/create-project-options", local)).body)).toEqual([first]);
    expect((await request(`/spot-procurements/capabilities?projectId=${second}`, local)).status).toBe(403);
    expect(ids((await request("/spot-procurements/create-project-options", employee)).body)).toEqual([]);
  });

  it("公司岗位可在所有项目申请本人费用，项目员工仍不能选择其他项目或代他人申请", async () => {
    const options = await request("/expense-claims/create-options", materialDirector);
    expect(options.status).toBe(200);
    expect(options.body.selfProjectIds).toEqual(expect.arrayContaining([first, second]));
    const input = { claimType: "loan", companyEntityId: company, projectId: second,
      reason: "合成乙项目备用金", requestedAmountCents: "12300", loanExpectedClearanceOn: "2026-12-31" };
    expect((await request("/expense-claims", materialDirector, { ...input, applicantUserId: materialDirector.id })).status).toBe(201);
    expect((await request("/expense-claims", employee, { ...input, applicantUserId: employee.id })).status).toBe(403);
    expect((await request("/expense-claims", materialDirector, { ...input, applicantUserId: employee.id })).status).toBe(403);
    const admin = await person("super_admin", [null]);
    expect((await request("/expense-claims", admin, { ...input, applicantUserId: admin.id })).status).toBe(403);
  });

  it("公司合同员可创建合同，合同提交按单据项目选择经理，并兼容仅登记项目岗位的人员", async () => {
    const db = app.get(PrismaService);
    const template = await db.contractBusinessTemplate.create({ data: { code: randomUUID(), name: "合成通用合同模板", businessCode: randomUUID(), contractTypeKey: "generic_contract", status: "published", createdByUserId: director.id } });
    const version = await db.contractBusinessTemplateVersion.create({ data: { templateId: template.id, versionNo: 1, status: "published", fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [], submittedByUserId: director.id, publishedByUserId: director.id, publishedAt: new Date(), changeSummary: "合成验证" } });
    const input = { projectId: second, contractTypeKey: "generic_contract", businessTemplateVersionId: version.id, signingSubjectType: "our_company" };
    expect((await request("/contracts", projectContract, input)).status).toBe(403);
    const created = await request("/contracts", companyContract, input);
    expect(created.status).toBe(201);
    expect((await request(`/contract-drafts/${created.body.version.id}/workbench`, companyContract)).status).toBe(200);
    const otherCompanyContract = await person("contract_staff", [null]);
    expect((await request(`/contract-drafts/${created.body.version.id}/workbench`, otherCompanyContract)).status).toBe(403);
    const routes = app.get(ContractApprovalRouteService);
    for (const method of ["freezeNewContractRoute", "freezeContractChangeRoute"] as const) {
      const nodes = await db.$transaction((tx) => routes[method](tx, { id: created.body.contract.id, projectId: second, contractTypeKey: "generic_contract" }, companyContract.id));
      expect(nodes.find((node) => node.roleKeys.includes("project_manager"))?.candidateUserIds).toEqual([secondManager.id]);
      expect(nodes.flatMap((node) => node.candidateUserIds)).not.toContain(firstManager.id);
    }
  });

  it("结算现场复核和经理都来自合同项目，项目岗位与花名册不混为专业授权", async () => {
    const db = app.get(PrismaService);
    const ownMaterial = await person("material_staff", [second]);
    await person("material_staff", [first]);
    const contract = await db.contract.create({ data: { code: randomUUID(), name: "合成乙项目材料合同", counterparty: "合成供应商", projectId: second, contractTypeKey: "material_purchase", ownerUserId: companyContract.id } });
    const version = await db.contractVersion.create({ data: { contractId: contract.id, versionNo: 1, changeType: "original", status: "effective", amountCents: 10000n, draftData: {}, templateSnapshot: {}, clauseSnapshot: [] } });
    const options = await request(`/settlement-workbench/contract-versions/${version.id}/participant-options`, companyContract);
    expect(options).toMatchObject({ status: 200, body: { options: [expect.objectContaining({ userId: ownMaterial.id })] } });
    const service = app.get(SettlementService);
    const nodes = await db.$transaction((tx) => service.freezeGovernedSettlementFacts(tx, contract, false, companyContract.id, {
      draftId: randomUUID(), governanceVersion: 1, fieldReviewerUserId: ownMaterial.id, fieldReviewerRoleKey: "material_staff",
      finalConfirmations: { finalScopeCompleted: null, finalPriorSettlementsIncluded: null, finalNoOutstandingSettlements: null, finalWithinContractCap: null, finalNoFurtherOrdinarySettlements: null }
    }));
    expect(nodes.frozenNodes.find((node) => node.roleKeys.includes("project_manager"))?.candidateUserIds).toEqual([secondManager.id]);
    expect((await request(`/settlement-workbench/contract-versions/${version.id}/participant-options`, employee)).status).toBe(403);
  });

  it("零采在乙项目新建和提交，甲经理不能审批，付款继承乙项目", async () => {
    const applicant = await person("material_staff", [second]);
    const definitions = await request(`/spot-procurements/projects/${second}/application-definitions`, applicant);
    expect(definitions.status).toBe(200);
    const file = await upload(`/spot-procurements/projects/${second}/draft-file-uploads`, applicant);
    const input = { projectId: second, applicationDepartment: "合成项目物资部", applicationName: "合成申请人", requestedArrivalAt: "2026-12-31", reason: "合成项目材料",
      entryDefinitionVersions: { application: definitions.body.application.version, line: definitions.body.line.version },
      lines: [{ materialName: "合成水泥", unit: "袋", quantity: "10" }], attachments: [{ fileId: file.id, category: "merchant_quote" }] };
    expect((await request("/spot-procurements", applicant, { ...input, projectId: first })).status).toBe(403);
    const created = await request("/spot-procurements", applicant, input);
    expect(created).toMatchObject({ status: 201 });
    const route = `/spot-procurements/${created.body.procurementId}`;
    expect((await request(`${route}/submission`, applicant, {})).status).toBe(201);
    const materialView = await request(route, materialDirector);
    expect((await request(`${route}/approval`, materialDirector, { decision: "approve", ...materialView.body.reviewApprovalContext })).status).toBe(201);
    const managerView = await request(route, secondManager);
    expect((await request(`${route}/approval`, firstManager, { decision: "approve", ...managerView.body.reviewApprovalContext })).status).toBe(403);
    expect((await request(`${route}/approval`, secondManager, { decision: "approve", ...managerView.body.reviewApprovalContext })).status).toBe(201);
    const approved = await request(route, applicant);
    expect(approved.body.procurement.project.id).toBe(second);
    const paymentRoute = `/spot-procurement-payments/${approved.body.payments[0].id}`;
    const paymentDraft = await request(paymentRoute, applicant);
    expect(paymentDraft.body.payment.project.id).toBe(second);
    expect((await request(paymentRoute, firstManager)).status).toBe(403);
    expect(await request(`${paymentRoute}/draft`, applicant, {
      paymentType: "company_direct", merchantName: "合成商户", payeeName: "合成商户",
      paymentLines: [{ procurementLineId: paymentDraft.body.procurementMaterials[0].id, paymentQuantity: "10", unitPrice: "10", expectedInvoiceCondition: "no_invoice" }],
      channels: [{ channelType: "bank_transfer", accountName: "合成商户", accountNumber: "622200001234", bankName: "合成银行", isPrimary: true }],
      paymentMethods: ["bank_transfer"], attachments: [], settlementAmountCents: "10000", supplierBalanceAmountCents: "0",
      paymentPath: "supplier_direct", paymentMethod: "bank_transfer", payeeAccountName: "合成商户", payeeBankName: "合成银行", payeeBankAccount: "622200001234", expectedPaymentAt: "2026-12-31"
    }, "PATCH")).toMatchObject({ status: 200 });
    expect(await request(`${paymentRoute}/submission`, applicant, {})).toMatchObject({ status: 201 });
    const projectFinance = await person("finance_staff", [second]);
    expect(await request(`${paymentRoute}/payer`, projectFinance, { companyEntityId: company, paymentMethods: ["bank_transfer"] }, "PATCH")).toMatchObject({ status: 200 });
    expect(await request(`${paymentRoute}/approval`, director, { decision: "approve" })).toMatchObject({ status: 201 });
    expect((await request(`${paymentRoute}/approval`, firstManager, { decision: "approve" })).status).toBe(403);
    for (const reviewer of [secondManager, financeDirector, chairman]) {
      expectStatus(await request(`${paymentRoute}/approval`, reviewer, { decision: "approve" }), 201);
    }
    expect((await request(paymentRoute, projectFinance)).body.payment.project.id).toBe(second);
  });

  it("跨项目任职合并项目范围，新项目自动进入公司范围，停用项目不能发起业务", async () => {
    const multi = await person("employee", [first, second]);
    expect(ids((await request("/projects", multi)).body)).toEqual([first, second].sort());
    const created = await app.get(PrismaService).project.create({ data: { code: randomUUID(), name: "合成后建项目" } });
    expect(ids((await request("/projects", companyContract)).body)).toContain(created.id);
    expect(ids((await request("/spot-procurements/create-project-options", materialDirector)).body)).toContain(created.id);
    expect(ids((await request("/projects", multi)).body)).not.toContain(created.id);
    const rosterOnly = await person("employee", []);
    await app.get(PrismaService).projectRosterMember.create({ data: { projectId: second, userId: rosterOnly.id } });
    expect(ids((await request("/projects", rosterOnly)).body)).toEqual([second]);
    expect(ids((await request("/general-procurements/create-options", rosterOnly)).body.projects)).toEqual([second]);
    expect((await request(`/spot-procurements/capabilities?projectId=${second}`, rosterOnly)).body.canCreate).not.toBe(true);
    const noManager = await request("/general-procurements", director, { requestKey: randomUUID(), projectId: created.id, companyEntityId: company,
      category: "office_supplies", reason: "合成无经理项目申请", requestedAmountCents: "10000" });
    expectStatus(noManager, 201);
    const submission = await request(`/general-procurements/${noManager.body.id}/submission`, director, { revision: 1 });
    expect(submission).toMatchObject({ status: 400, body: { message: expect.stringContaining("项目经理") } });
    for (const [actor, projectId] of [[employee, second], [director, inactive]] as const) {
      expect((await request("/general-procurements", actor, { requestKey: randomUUID(), projectId, companyEntityId: company,
        category: "office_supplies", reason: "合成越界申请", requestedAmountCents: "10000" })).status).toBe(403);
    }
  });

  it("综合采购在乙项目提交后只有乙项目经理能审批，甲项目经理不能看到待办或代批", async () => {
    const created = await request("/general-procurements", materialDirector, { requestKey: randomUUID(), projectId: second,
      companyEntityId: company, category: "office_supplies", reason: "合成乙项目采购", requestedAmountCents: "10000" });
    expect(created.status).toBe(201);
    const route = `/general-procurements/${created.body.id}`;
    expect((await request(`${route}/submission`, materialDirector, { revision: 1 })).status).toBe(201);
    expect((await request(`${route}/review`, director, { revision: 2, decision: "approve" })).status).toBe(201);
    const denied = await request(`${route}/review`, firstManager, { revision: 3, decision: "approve" });
    expect(denied.status).toBe(403);
    const todo = await request("/me/work-items", firstManager);
    expect(todo.body.approvalCenter.pendingApproval).not.toEqual(expect.arrayContaining([expect.objectContaining({ businessId: created.body.id })]));
    expect((await request(`${route}/review`, secondManager, { revision: 3, decision: "approve" })).status).toBe(201);
    expect((await request(`${route}/review`, chairman, { revision: 4, decision: "approve" })).status).toBe(201);
    expect((await request(route, director)).body).toMatchObject({ projectId: second, status: "approved_pending_archive" });
    const file = await upload(`${route}/archive-file-uploads`, director);
    expect((await request(`${route}/archive`, director, { revision: 5, fileId: file.id, note: "合成归档依据" })).status).toBe(201);
    const payment = { claimType: "incidental_expense", incidentalExpenseCategory: "procurement_office_supplies", generalProcurementId: created.body.id,
      generalProcurementRequestKey: randomUUID(), companyEntityId: company, projectId: second, reason: "合成乙项目采购请款", requestedAmountCents: "10000", payeeName: "合成供应商" };
    expect((await request("/expense-claims", director, { ...payment, projectId: first })).status).toBe(400);
    const claim = await request("/expense-claims", director, payment);
    expect(claim.status).toBe(201);
    const claimRoute = `/expense-claims/${claim.body.id}`;
    expect((await request(`${claimRoute}/submission`, director, {})).status).toBe(201);
    expect((await request(`${claimRoute}/approval`, director, { decision: "approve", selfReviewReason: "按已归档采购办理", confirmationPassword: password })).status).toBe(201);
    expect((await request(`${claimRoute}/approval`, firstManager, { decision: "approve" })).status).toBe(403);
    for (const reviewer of [secondManager, financeDirector, chairman]) expectStatus(await request(`${claimRoute}/approval`, reviewer, { decision: "approve" }), 201);
    expect((await request(claimRoute, director)).body).toMatchObject({ projectId: second, status: "approved_pending_payment", companyPayableAmountCents: "10000" });
  });

  (process.env.RUN_PROJECT_BUSINESS_SCOPE_BROWSER === "1" ? it : it.skip)("电脑和手机真实页面的项目下拉与岗位权限一致", async () => {
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, PROJECT_SCOPE_API: base,
        PROJECT_SCOPE_SESSIONS: JSON.stringify({ chairman: sessions.get(chairman.id), employee: sessions.get(employee.id), materialDirector: sessions.get(materialDirector.id) }) };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.project-business-scope.config.ts"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("多项目真实浏览器验收失败")));
    });
  }, 240_000);
});
