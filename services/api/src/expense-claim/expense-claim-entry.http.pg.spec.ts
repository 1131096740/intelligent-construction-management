import "reflect-metadata";
import { verifyApprovedPdf } from "../database/approval-pdf-acceptance.test-support";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { ROLE_KEYS, GLOBAL_USER_POSITION_ROLE_KEYS, type RoleKey, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";
type BrowserAuthSession = {
  user: { id: string; name: string; phone: string | null; mustChangePassword: boolean; roleKeys: string[]; globalRoleKeys: string[] };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
};

describe("费用统一录入真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let projectId: string;
  let companyEntityId: string;
  let applicantUserId: string;
  let factWitnessUserId: string;
  let strangerToken: string;
  let financeToken: string;
  let financeDirectorToken: string;
  let accountPassword: string;
  const approvalTokens: string[] = [];
  let browserSession: BrowserAuthSession;
  let financeSession: BrowserAuthSession;
  let proxySession: BrowserAuthSession;
  let financeDirectorSession: BrowserAuthSession;
  const browserRepaymentProjectIds: Record<"desktop" | "mobile", string> = { desktop: "", mobile: "" };
  const browserRepaymentClaimIds: Record<"desktop" | "mobile", string> = { desktop: "", mobile: "" };

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
    accountPassword = password;
    const suffix = randomUUID();
    const actor = await prisma.user.create({ data: { name: "入口申请人", phone: `pol115-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    applicantUserId = actor.id;
    const project = await prisma.project.create({ data: { code: `POL115-${suffix}`, name: "入口合成项目" } });
    projectId = project.id;
    const constructionEnterprise = await prisma.businessParty.create({ data: { name: "入口合成施工企业", normalizedName: `pol115-construction-${suffix}`, unifiedSocialCreditCode: `POL115${suffix.replaceAll("-", "").slice(0, 12)}`, createdByUserId: actor.id } });
    const constructionEnterpriseVersion = await prisma.businessPartyVersion.create({ data: { businessPartyId: constructionEnterprise.id, versionNo: 1, snapshot: { name: constructionEnterprise.name, unifiedSocialCreditCode: constructionEnterprise.unifiedSocialCreditCode }, createdByUserId: actor.id } });
    await prisma.projectAffiliateAssignment.create({ data: { projectId, businessPartyId: constructionEnterprise.id, businessPartyVersionId: constructionEnterpriseVersion.id, affiliateNameSnapshot: constructionEnterprise.name, affiliateCreditCodeSnapshot: constructionEnterprise.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "合成项目主数据", assignedByUserId: actor.id } });
    companyEntityId = (await prisma.companyEntity.create({ data: { name: "入口合成公司", dataStatus: "complete" } })).id;
    let employeePositionId = "";
    let projectManagerPositionId = "";
    let projectManagerUserId = "";
    for (const key of ["employee", "comprehensive_director", "project_manager", "finance_director", "chairman", "finance_staff"]) {
      const position = await prisma.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
      const positionUser = key === "employee" ? actor : await prisma.user.create({ data: { name: `审批岗位${key}`, phone: `pol115-${key}-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
      const userId = positionUser.id;
      if (key === "employee") employeePositionId = position.id;
      if (key === "project_manager") {
        projectManagerPositionId = position.id;
        projectManagerUserId = userId;
      }
      if (key === "comprehensive_director") factWitnessUserId = userId;
      await prisma.userPosition.create({ data: { userId, positionId: position.id, projectId: key === "employee" || key === "project_manager" ? projectId : null } });
      if (key !== "employee") {
        const positionLogin = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: positionUser.phone, password }) });
        expect(positionLogin.status).toBe(201);
        const positionSession = await positionLogin.json() as BrowserAuthSession;
        const positionToken = positionSession.tokens.accessToken;
        if (key === "comprehensive_director") proxySession = positionSession;
        if (key === "finance_staff") {
          financeToken = positionToken;
          financeSession = positionSession;
        }
        else {
          if (key === "finance_director") {
            financeDirectorToken = positionToken;
            financeDirectorSession = positionSession;
          }
          approvalTokens.push(positionToken);
          const signatureBody = new FormData();
          signatureBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), `合成签名-${key}.png`);
          const signature = await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${positionToken}` }, body: signatureBody });
          expect(signature.status).toBe(201);
        }
      }
    }
    for (const viewport of ["desktop", "mobile"] as const) {
      const repaymentProject = await prisma.project.create({ data: { code: `POL115-${viewport}-${suffix}`, name: `还款${viewport}隔离项目` } });
      browserRepaymentProjectIds[viewport] = repaymentProject.id;
      await prisma.projectAffiliateAssignment.create({ data: { projectId: repaymentProject.id, businessPartyId: constructionEnterprise.id, businessPartyVersionId: constructionEnterpriseVersion.id, affiliateNameSnapshot: constructionEnterprise.name, affiliateCreditCodeSnapshot: constructionEnterprise.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: `还款${viewport}测试主数据`, assignedByUserId: actor.id } });
      await prisma.userPosition.createMany({ data: [
        { userId: actor.id, positionId: employeePositionId, projectId: repaymentProject.id },
        { userId: projectManagerUserId, positionId: projectManagerPositionId, projectId: repaymentProject.id }
      ] });
    }
    const login = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password }) });
    expect(login.status).toBe(201);
    const loginSession = (await login.json()) as BrowserAuthSession;
    browserSession = loginSession;
    token = loginSession.tokens.accessToken;
    const stranger = await prisma.user.create({ data: { name: "无关申请人", phone: `stranger-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const strangerLogin = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: stranger.phone, password }) });
    strangerToken = ((await strangerLogin.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
  }, 60_000);

  afterAll(async () => { if (app) await app.close(); });

  async function request(path: string, body?: unknown, accessToken = token) {
    const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as { id: string; status: string; entryDefinition: BusinessEntrySceneDefinition; entrySnapshots: Array<{ definitionSnapshot: BusinessEntrySceneDefinition; valuesSnapshot: Record<string, unknown> }> } };
  }

  async function selfAccount(role?: RoleKey) {
    const prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { name: `本人申请${role ?? "未配置岗位"}`, phone: `self-${suffix}`, passwordHash: await hash(accountPassword, 4), mustChangePassword: false } });
    if (role) {
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: GLOBAL_USER_POSITION_ROLE_KEYS.includes(role) ? null : projectId } });
    }
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password: accountPassword }) });
    expect(response.status).toBe(201);
    return await response.json() as BrowserAuthSession;
  }

  function selfInput(userId: string, claimType: "reimbursement" | "loan" | "incidental_expense" = "loan") {
    return {
      claimType, companyEntityId, projectId, applicantUserId: userId, reason: "合成本人费用申请", requestedAmountCents: "1",
      ...(claimType === "loan" ? { loanExpectedClearanceOn: "2026-12-01" } : {}),
      ...(claimType === "incidental_expense" ? { incidentalExpenseCategory: "temporary_service", payeeName: "合成服务提供方" } : {}),
      ...(claimType === "reimbursement" ? { lines: [{ expenseCategory: "办公费", occurredOn: "2026-10-16", purpose: "合成文具", receiptCount: 0, amountCents: "1", evidenceType: "none", noEvidenceReason: "隔离测试" }] } : {})
    };
  }

  (enabled ? it.each(["loan", "reimbursement", "incidental_expense"] as const) : it.skip.each(["loan", "reimbursement", "incidental_expense"] as const))("删除未提交草稿：%s 实体和明细彻底删除，审计保留", async claimType => {
    const prisma = app.get(PrismaService);
    const created = await request("/expense-claims", selfInput(applicantUserId, claimType));
    expect(created.status).toBe(201);
    const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: created.body.id } });
    const result = await request(`/expense-claims/${row.id}/draft-deletion`, { expectedUpdatedAt: row.updatedAt.toISOString() });
    expect(result).toMatchObject({ status: 201, body: { id: row.id } });
    expect(await prisma.expenseClaim.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await prisma.expenseClaimLine.count({ where: { expenseClaimId: row.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: row.id, action: "expense_claim.draft.delete" } });
    expect(audit).toMatchObject({ actorUserId: applicantUserId, businessType: "expense_claim" });
    expect(audit.metadata).toMatchObject({ code: row.code, claimType, projectId, companyEntityId, requestedAmountCents: "1", previousStatus: "draft", applicantUserId, handledByUserId: applicantUserId });
    expect(await prisma.auditLog.count({ where: { businessId: row.id, action: claimType === "incidental_expense" ? "incidental_expense.draft.create" : "expense_claim.draft.create" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: row.id, action: "expense_claim.draft.delete" } })).toBe(1);
    expect((await request(`/expense-claims/${row.id}`)).status).toBe(404);
  });

  (enabled ? it : it.skip)("删除未提交草稿：拒绝他人、过期版本和已经提交的费用", async () => {
    const prisma = app.get(PrismaService);
    const created = await request("/expense-claims", selfInput(applicantUserId));
    const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: created.body.id } });
    const body = { expectedUpdatedAt: row.updatedAt.toISOString() };
    expect((await request(`/expense-claims/${row.id}/draft-deletion`, body, financeToken)).status).toBe(403);
    expect((await request(`/expense-claims/${row.id}/draft-deletion`, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z" })).status).toBe(409);
    expect((await request(`/expense-claims/${row.id}/submission`, {})).status).toBe(201);
    expect((await request(`/expense-claims/${row.id}/draft-deletion`, body)).status).toBe(409);
    expect(await prisma.expenseClaim.count({ where: { id: row.id } })).toBe(1);
  });

  (enabled ? it : it.skip)("删除未提交草稿：综合采购删除和旧请求防复活", async () => {
    const prisma = app.get(PrismaService);
    const body = { projectId, companyEntityId, category: "office_supplies", reason: "删除草稿测试", requestedAmountCents: "100", requestKey: randomUUID() };
    const created = await request("/general-procurements", body);
    expect(created.status).toBe(201);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 1 }, financeToken)).status).toBe(403);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 2 })).status).toBe(409);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 1 })).status).toBe(201);
    expect(await prisma.generalProcurement.findUnique({ where: { id: created.body.id } })).toBeNull();
    expect((await request("/general-procurements", body)).status).toBe(409);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: created.body.id, action: "general_procurement.draft.delete" } });
    expect(audit).toMatchObject({ actorUserId: applicantUserId, businessType: "general_procurement" });
    expect(audit.metadata).toMatchObject({ requestKey: body.requestKey, revision: 1, projectId, companyEntityId, applicantUserId, previousStatus: "draft", category: body.category, requestedAmountCents: "100" });
    expect(await prisma.auditLog.count({ where: { businessId: created.body.id, action: "general_procurement.create" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: created.body.id, action: "general_procurement.draft.delete" } })).toBe(1);
  });

  (enabled ? it : it.skip)("删除未提交草稿：综合采购审批后即使退回也不能硬删除", async () => {
    const created = await request("/general-procurements", { projectId, companyEntityId, category: "office_supplies", reason: "保留审批测试", requestedAmountCents: "100", requestKey: randomUUID() });
    expect(created.status).toBe(201);
    expect((await request(`/general-procurements/${created.body.id}/submission`, { revision: 1 })).status).toBe(201);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 2 })).status).toBe(409);
    const prisma = app.get(PrismaService);
    await prisma.generalProcurement.update({ where: { id: created.body.id }, data: { status: "draft" } });
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 2 })).status).toBe(409);
  });

  (enabled ? it : it.skip)("删除未提交草稿：附件关联删除，文件保留既有私有回收边界", async () => {
    const prisma = app.get(PrismaService);
    for (const claimType of ["loan", "incidental_expense"] as const) {
    const created = await request("/expense-claims", selfInput(applicantUserId, claimType));
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成凭证.png");
    const uploaded = await fetch(`${baseUrl}/expense-claims/${created.body.id}/draft-attachment-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json() as { id: string };
    expect((await request(`/expense-claims/${created.body.id}/attachments`, { fileId: file.id, category: "other" })).status).toBe(201);
    const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: created.body.id } });
    expect((await request(`/expense-claims/${row.id}/draft-deletion`, { expectedUpdatedAt: row.updatedAt.toISOString() })).status).toBe(201);
    expect(await prisma.expenseClaimAttachment.count({ where: { expenseClaimId: row.id } })).toBe(0);
    expect(await prisma.fileObject.count({ where: { id: file.id } })).toBe(1);
    const stored = await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: row.id, action: "expense_claim.draft.delete" } });
    expect(audit.metadata).toMatchObject({ files: [{ id: file.id, name: stored.originalName, contentSha256: stored.contentSha256, sizeBytes: stored.sizeBytes }] });
    expect(JSON.stringify(audit.metadata)).not.toContain(stored.objectKey);
    }
  });

  (enabled ? it : it.skip)("删除未提交草稿：费用和采购的提交删除并发只能一个成功", async () => {
    const prisma = app.get(PrismaService);
    const expense = await request("/expense-claims", selfInput(applicantUserId));
    const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: expense.body.id } });
    const results = await Promise.all([
      request(`/expense-claims/${row.id}/submission`, {}),
      request(`/expense-claims/${row.id}/draft-deletion`, { expectedUpdatedAt: row.updatedAt.toISOString() })
    ]);
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    expect(results.filter(result => result.status >= 400 && result.status < 500)).toHaveLength(1);
    const procurement = await request("/general-procurements", { projectId, companyEntityId, category: "office_supplies", reason: "并发删除验证", requestedAmountCents: "100", requestKey: randomUUID() });
    const procurementResults = await Promise.all([
      request(`/general-procurements/${procurement.body.id}/submission`, { revision: 1 }),
      request(`/general-procurements/${procurement.body.id}/draft-deletion`, { revision: 1 })
    ]);
    expect(procurementResults.filter(result => result.status === 201)).toHaveLength(1);
    expect(procurementResults.filter(result => result.status >= 400 && result.status < 500)).toHaveLength(1);
  });

  (enabled ? it : it.skip)("删除未提交草稿：受限数据库账号只可调用窄入口，不能直接删表", async () => {
    const prisma = app.get(PrismaService);
    const created = await request("/general-procurements", { projectId, companyEntityId, category: "office_supplies", reason: "受限删除验证", requestedAmountCents: "100", requestKey: randomUUID() });
    const role = `draft_delete_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_general_procurement(TEXT,TEXT,INTEGER), public.jg_delete_unsubmitted_expense_claim(TEXT,TEXT,TIMESTAMP) TO "${role}"`);
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        await tx.$executeRaw`DELETE FROM "GeneralProcurement" WHERE "id" = ${created.body.id}`;
      })).rejects.toThrow();
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        expect(await tx.$queryRaw`SELECT public.jg_delete_unsubmitted_general_procurement(${created.body.id}, ${financeSession.user.id}, 1) AS deleted`).toEqual([{ deleted: false }]);
        expect(await tx.$queryRaw`SELECT public.jg_delete_unsubmitted_general_procurement(${created.body.id}, ${applicantUserId}, 1) AS deleted`).toEqual([{ deleted: true }]);
      });
      expect(await prisma.generalProcurement.count({ where: { id: created.body.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
      await prisma.$executeRawUnsafe(`DROP ROLE "${role}"`);
    }
  });

  (enabled ? it : it.skip)("本人申请：保存后撤销项目归属，提交拒绝且保留未提交草稿", async () => {
    const prisma = app.get(PrismaService);
    const session = await selfAccount();
    await prisma.projectRosterMember.create({ data: { userId: session.user.id, projectId } });
    const created = await request("/expense-claims", selfInput(session.user.id), session.tokens.accessToken);
    expect(created.status).toBe(201);
    await prisma.projectRosterMember.deleteMany({ where: { userId: session.user.id, projectId } });
    expect(await request(`/expense-claims/${created.body.id}/submission`, {}, session.tokens.accessToken)).toMatchObject({ status: 403 });
    expect(await request(`/expense-claims/${created.body.id}`, undefined, session.tokens.accessToken)).toMatchObject({ status: 200, body: { status: "draft", entrySnapshots: [] } });
  });

  (enabled ? it : it.skip)("本人申请：财务岗位可以读取创建表单且只能选择本人", async () => {
    expect(await request("/expense-claims/create-options", undefined, financeToken)).toMatchObject({
      status: 200,
      body: { canProxy: false, applicantUsers: [{ id: financeSession.user.id }], availableActions: ["create_expense_claim"] }
    });
  });

  (enabled ? it : it.skip)("本人申请：有效公司财务岗位可选择全部项目，但仍只能为本人申请", async () => {
    expect(await request("/expense-claims/create-options", undefined, financeToken)).toMatchObject({
      status: 200, body: { projects: expect.arrayContaining([expect.objectContaining({ id: projectId })]), selfProjectIds: expect.arrayContaining([projectId]), selfApplicantUserId: financeSession.user.id }
    });
    expect(await request("/expense-claims", {
      claimType: "loan", companyEntityId, projectId, applicantUserId: financeSession.user.id,
      reason: "公司财务本人项目申请", requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01"
    }, financeToken)).toMatchObject({ status: 201 });
    expect(await request("/expense-claims", {
      claimType: "loan", companyEntityId, projectId, applicantUserId,
      reason: "仍禁止财务代他人申请", requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01"
    }, financeToken)).toMatchObject({ status: 403 });
  });

  (enabled ? it : it.skip).each([undefined, ...ROLE_KEYS])("本人申请：启用岗位 %s 可以为本人创建并提交三类费用", async (role) => {
    const session = await selfAccount(role);
    await app.get(PrismaService).projectRosterMember.create({ data: { userId: session.user.id, projectId } });
    for (const claimType of ["reimbursement", "loan", "incidental_expense"] as const) {
      const created = await request("/expense-claims", selfInput(session.user.id, claimType), session.tokens.accessToken);
      expect(created.status).toBe(201);
      const path = `/expense-claims/${created.body.id}`;
      expect(await request(`${path}/submission`, {}, session.tokens.accessToken)).toMatchObject({ status: 201, body: { status: "approval_pending" } });
      expect(await request(path, undefined, session.tokens.accessToken)).toMatchObject({ status: 200, body: { applicantUserId: session.user.id, handledByUserId: session.user.id, status: "approval_pending", entrySnapshots: [expect.objectContaining({ valuesSnapshot: expect.objectContaining({ applicantUserId: session.user.id }) })] } });
    }
  });

  (enabled ? it : it.skip)("本人申请：无项目人员可报销非项目费用，不能代办或审批付款", async () => {
    const session = await selfAccount();
    const accessToken = session.tokens.accessToken;
    expect(await request("/expense-claims/create-options", undefined, accessToken)).toMatchObject({ status: 200, body: { projects: [], canProxy: false } });
    const input = { ...selfInput(session.user.id, "reimbursement"), projectId: undefined, factWitnessUserId };
    expect(await request("/expense-claims", { ...input, applicantUserId }, accessToken)).toMatchObject({ status: 403 });
    expect(await request("/expense-claims", { ...input, applicantUserId: undefined, applicantName: "无账号合成人员", applicantPhone: "13800000000" }, accessToken)).toMatchObject({ status: 403 });
    expect((await request("/expense-claims", undefined, accessToken)).body).toEqual([]);
    const created = await request("/expense-claims", input, accessToken);
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect(await request(`${path}/submission`, {}, strangerToken)).toMatchObject({ status: 403 });
    expect(await request(`${path}/submission`, {}, accessToken)).toMatchObject({ status: 201 });
    for (const endpoint of ["approval", "payments", "disbursements"]) {
      expect(await request(`${path}/${endpoint}`, { decision: "approve" }, accessToken)).toMatchObject({ status: 403 });
    }
    expect(await request(path, undefined, accessToken)).toMatchObject({ status: 200, body: { status: "approval_pending", fundedAmountCents: "0" } });
  });

  (enabled ? it : it.skip)("本人申请：公司综合部可选择全部项目，原代办能力保持", async () => {
    const accessToken = approvalTokens[0]!;
    const options = await request("/expense-claims/create-options", undefined, accessToken);
    expect(options).toMatchObject({ status: 200, body: { canProxy: true, selfApplicantUserId: factWitnessUserId, selfProjectIds: expect.arrayContaining([projectId]), projects: expect.arrayContaining([expect.objectContaining({ id: projectId })]) } });
    expect(await request("/expense-claims", selfInput(factWitnessUserId), accessToken)).toMatchObject({ status: 201 });
    for (const applicant of [{ applicantUserId }, { applicantUserId: undefined, applicantName: "无账号合成人员", applicantPhone: "13800000000" }]) {
      const created = await request("/expense-claims", { ...selfInput(applicantUserId, "reimbursement"), ...applicant }, accessToken);
      expect(created.status).toBe(201);
      expect(await request(`/expense-claims/${created.body.id}/submission`, {}, accessToken)).toMatchObject({ status: 201 });
    }
  });

  (enabled ? it : it.skip)("本人申请：停用账户的旧会话不能加载、创建或提交", async () => {
    const prisma = app.get(PrismaService);
    const session = await selfAccount();
    await prisma.projectRosterMember.create({ data: { userId: session.user.id, projectId } });
    const input = selfInput(session.user.id);
    const created = await request("/expense-claims", input, session.tokens.accessToken);
    expect(created.status).toBe(201);
    await prisma.user.update({ where: { id: session.user.id }, data: { isActive: false } });
    expect(await request("/expense-claims/create-options", undefined, session.tokens.accessToken)).toMatchObject({ status: 401 });
    expect(await request("/expense-claims", input, session.tokens.accessToken)).toMatchObject({ status: 401 });
    expect(await request(`/expense-claims/${created.body.id}/submission`, {}, session.tokens.accessToken)).toMatchObject({ status: 401 });
    expect(await request("/expense-claims/create-options", undefined, "")).toMatchObject({ status: 401 });
  });

  (enabled ? it : it.skip)("本人申请：停用项目不能创建或提交，原草稿仍可读取", async () => {
    const prisma = app.get(PrismaService);
    const session = await selfAccount();
    const project = await prisma.project.create({ data: { code: `SELF-${randomUUID()}`, name: "停用归属合成项目" } });
    await prisma.projectMember.create({ data: { userId: session.user.id, projectId: project.id, positionKey: "employee" } });
    const input = { ...selfInput(session.user.id), projectId: project.id };
    const created = await request("/expense-claims", input, session.tokens.accessToken);
    expect(created.status).toBe(201);
    await prisma.project.update({ where: { id: project.id }, data: { isActive: false } });
    expect(await request("/expense-claims/create-options", undefined, session.tokens.accessToken)).toMatchObject({ status: 200, body: { projects: [] } });
    expect(await request("/expense-claims", input, session.tokens.accessToken)).toMatchObject({ status: 404 });
    expect(await request(`/expense-claims/${created.body.id}/submission`, {}, session.tokens.accessToken)).toMatchObject({ status: 403 });
    expect(await request(`/expense-claims/${created.body.id}`, undefined, session.tokens.accessToken)).toMatchObject({ status: 200, body: { status: "draft", entrySnapshots: [] } });
  });

  (enabled ? it : it.skip)("本人申请：未配置岗位的经办人可上传、登记和移除自己的草稿附件", async () => {
    const session = await selfAccount();
    const accessToken = session.tokens.accessToken;
    await app.get(PrismaService).projectRosterMember.create({ data: { userId: session.user.id, projectId } });
    const created = await request("/expense-claims", selfInput(session.user.id), accessToken);
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    const body = new FormData();
    body.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "本人成本凭证.png");
    body.append("idempotencyKey", randomUUID());
    const upload = await fetch(`${baseUrl}${path}/draft-attachment-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body });
    expect(upload.status).toBe(201);
    const file = await upload.json() as { id: string };
    expect(await request(`${path}/attachments`, { fileId: file.id, category: "receipt_or_other" }, strangerToken)).toMatchObject({ status: 403 });
    const attachment = await request(`${path}/attachments`, { fileId: file.id, category: "receipt_or_other" }, accessToken);
    expect(attachment.status).toBe(201);
    expect(await request(`${path}/attachments/${attachment.body.id}/removal`, {}, strangerToken)).toMatchObject({ status: 403 });
    expect(await request(`${path}/attachments/${attachment.body.id}/removal`, {}, accessToken)).toMatchObject({ status: 201 });
    expect(await request(path, undefined, accessToken)).toMatchObject({ status: 200, body: { status: "draft", entrySnapshots: [] } });
  });

  (enabled ? it : it.skip)("草稿附件上传仍拒绝无关账号和非法幂等键，不改变草稿或提交快照", async () => {
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "附件权限验证", requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    async function upload(accessToken: string, idempotencyKey?: string) {
      const body = new FormData();
      body.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成费用凭证.png");
      if (idempotencyKey !== undefined) body.append("idempotencyKey", idempotencyKey);
      return fetch(`${baseUrl}${path}/draft-attachment-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body });
    }
    // Authentication now reaches the domain, which conceals unrelated claims.
    expect((await upload(strangerToken)).status).toBe(404);
    expect((await upload(token, "invalid-key")).status).toBe(400);
    const detail = await request(path);
    expect(detail).toMatchObject({ status: 200, body: { status: "draft", requestedAmountCents: "1", attachments: [], entrySnapshots: [] } });
  });

  (enabled ? it : it.skip)("提交后经办人通过真实上传接口追加资料并从详情回读", async () => {
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "追加资料验证", requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(201);

    const uploadBody = new FormData();
    uploadBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成追加资料.png");
    const upload = await fetch(`${baseUrl}${path}/append-attachment-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: uploadBody });
    const uploadText = await upload.text();
    if (upload.status !== 201) throw new Error(`追加资料上传失败：${upload.status} ${uploadText}`);
    expect(upload.status).toBe(201);
    const uploaded = JSON.parse(uploadText) as { id: string };

    const appended = await request(`${path}/attachments/append`, { fileId: uploaded.id, category: "receipt_or_other" });
    expect(appended.status).toBe(201);
    expect(await request(path)).toMatchObject({ status: 200, body: { status: "approval_pending", attachments: [{ fileName: "合成追加资料.png", category: "receipt_or_other", stage: "post_submit_append" }] } });
  });

  (enabled ? it : it.skip)("已完成真实审批的待付款费用可上传单字段幂等付款凭证", async () => {
    const created = await request("/expense-claims", { claimType: "reimbursement", companyEntityId, projectId, applicantUserId, reason: "付款凭证上传验证", requestedAmountCents: "1", lines: [{ expenseCategory: "办公费", occurredOn: "2026-09-17", purpose: "购买文具", receiptCount: 0, amountCents: "1", evidenceType: "none", noEvidenceReason: "合成验收无纸质凭证" }] });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    for (const [approvalIndex, approvalToken] of approvalTokens.entries()) {
      const approval = await request(`${path}/approval`, { decision: "approve" }, approvalToken);
      if (approval.status !== 201) throw new Error(`费用真实审批${approvalIndex + 1}失败：${approval.status} ${JSON.stringify(approval.body)}`);
    }
    expect(await request(path)).toMatchObject({ status: 200, body: { status: "approved_pending_payment", companyPayableAmountCents: "1" } });

    const idempotencyKey = randomUUID();
    const upload = async () => {
      const uploadBody = new FormData();
      uploadBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成付款凭证.png");
      uploadBody.append("idempotencyKey", idempotencyKey);
      return fetch(`${baseUrl}${path}/payment-voucher-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: uploadBody });
    };
    const first = await upload();
    const firstText = await first.text();
    if (first.status !== 201) throw new Error(`付款凭证上传失败：${first.status} ${firstText}`);
    const firstBody = JSON.parse(firstText) as { id: string };
    expect(firstBody.id).toEqual(expect.any(String));
    const replay = await upload();
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ id: firstBody.id });
  }, 60_000);

  (enabled ? it : it.skip)("已完成真实审批的待放款借款可上传单字段幂等放款凭证", async () => {
    const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "放款凭证上传验证", requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    for (const [approvalIndex, approvalToken] of approvalTokens.entries()) {
      const approval = await request(`${path}/approval`, { decision: "approve" }, approvalToken);
      if (approval.status !== 201) throw new Error(`借款真实审批${approvalIndex + 1}失败：${approval.status} ${JSON.stringify(approval.body)}`);
    }
    expect(await request(path)).toMatchObject({ status: 200, body: { status: "approved_pending_disbursement", requestedAmountCents: "1" } });

    const idempotencyKey = randomUUID();
    const upload = async () => {
      const uploadBody = new FormData();
      uploadBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成放款凭证.png");
      uploadBody.append("idempotencyKey", idempotencyKey);
      return fetch(`${baseUrl}${path}/disbursement-voucher-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: uploadBody });
    };
    const first = await upload();
    const firstText = await first.text();
    if (first.status !== 201) throw new Error(`放款凭证上传失败：${first.status} ${firstText}`);
    const firstBody = JSON.parse(firstText) as { id: string };
    expect(firstBody.id).toEqual(expect.any(String));
    const replay = await upload();
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ id: firstBody.id });
  }, 60_000);

  (enabled ? it : it.skip)("公开登记实际放款后按原职责登记、确认并更正员工还款", async () => {
    const createDisbursedLoan = async (targetProjectId: string, label: string) => {
      const quotaAttachmentBody = new FormData();
      quotaAttachmentBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), `合成垫资申请依据-${label}.png`);
      const quotaAttachmentResponse = await fetch(`${baseUrl}/files`, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: quotaAttachmentBody });
      expect(quotaAttachmentResponse.status).toBe(201);
      const quotaAttachment = await quotaAttachmentResponse.json() as { id: string };
      const quotaRequest = await request(`/projects/${targetProjectId}/financing-quotas`, { idempotencyKey: randomUUID(), amountCents: "1", reason: `合成${label}还款链放款资金`, attachmentFileId: quotaAttachment.id }, financeToken);
      expect(quotaRequest.status).toBe(201);
      const quotaId = (quotaRequest.body as unknown as { quotaId: string }).quotaId;
      for (const approvalToken of [approvalTokens[2]!, approvalTokens[3]!]) {
        const capabilityResponse = await fetch(`${baseUrl}/projects/${targetProjectId}/financing-quotas/${quotaId}/review-capability`, { headers: { authorization: `Bearer ${approvalToken}` } });
        expect(capabilityResponse.status).toBe(200);
        const capability = await capabilityResponse.json() as { lifecycleToken: string };
        expect((await request(`/projects/${targetProjectId}/financing-quotas/${quotaId}/approval`, { actionId: randomUUID(), expectedLifecycleToken: capability.lifecycleToken, decision: "approve", confirmationPassword: accountPassword }, approvalToken)).status).toBe(201);
      }
      const created = await request("/expense-claims", { claimType: "loan", companyEntityId, projectId: targetProjectId, applicantUserId, reason: `合成${label}还款验证`, requestedAmountCents: "1", loanExpectedClearanceOn: "2026-12-01" });
      expect(created.status).toBe(201);
      const claimPath = `/expense-claims/${created.body.id}`;
      expect((await request(`${claimPath}/submission`, {})).status).toBe(201);
      for (const approvalToken of approvalTokens) expect((await request(`${claimPath}/approval`, { decision: "approve" }, approvalToken)).status).toBe(201);
      const disbursementUploadBody = new FormData();
      disbursementUploadBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), `合成实际放款凭证-${label}.png`);
      disbursementUploadBody.append("idempotencyKey", randomUUID());
      const disbursementUpload = await fetch(`${baseUrl}${claimPath}/disbursement-voucher-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: disbursementUploadBody });
      expect(disbursementUpload.status).toBe(201);
      const disbursementFile = await disbursementUpload.json() as { id: string };
      expect((await request(`${claimPath}/disbursements`, { amountCents: "1", paidAt: "2026-09-17", paymentMethod: "合成银行转账", voucherFileId: disbursementFile.id, confirmationPassword: accountPassword }, financeToken)).status).toBe(201);
      expect(await request(claimPath)).toMatchObject({ status: 200, body: { status: "disbursed", fundedAmountCents: "1", loanAccount: { balanceAmountCents: "1" } } });
      return { id: created.body.id, path: claimPath };
    };

    const created = await createDisbursedLoan(projectId, "PG");
    const path = created.path;

    const idempotencyKey = randomUUID();
    const upload = async () => {
      const uploadBody = new FormData();
      uploadBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成还款凭证.png");
      uploadBody.append("idempotencyKey", idempotencyKey);
      return fetch(`${baseUrl}${path}/repayment-voucher-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: uploadBody });
    };
    const first = await upload();
    const firstText = await first.text();
    if (first.status !== 201) throw new Error(`还款凭证上传失败：${first.status} ${firstText}`);
    const firstBody = JSON.parse(firstText) as { id: string };
    expect(firstBody.id).toEqual(expect.any(String));
    const replay = await upload();
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ id: firstBody.id });

    const overBalance = await request(`${path}/repayments`, { amountCents: "2", repaidAt: "2026-09-17", paymentMethod: "合成银行转账", voucherFileId: firstBody.id, confirmationPassword: accountPassword }, financeToken);
    expect(overBalance.status).toBe(201);
    expect(await request(`${path}/repayments/${overBalance.body.id}/confirmation`, { confirmationPassword: accountPassword }, financeDirectorToken)).toMatchObject({ status: 400 });

    const recorded = await request(`${path}/repayments`, { amountCents: "1", repaidAt: "2026-09-17", paymentMethod: "合成银行转账", voucherFileId: firstBody.id, confirmationPassword: accountPassword }, financeToken);
    expect(recorded).toMatchObject({ status: 201, body: { status: "recorded", amountCents: "1" } });
    const repaymentId = recorded.body.id;
    expect(await request(path)).toMatchObject({ status: 200, body: { loanAccount: { fundedAmountCents: "1", repaidAmountCents: "0", balanceAmountCents: "1" }, loanRepayments: expect.arrayContaining([expect.objectContaining({ id: repaymentId, status: "recorded", amountCents: "1" })]) } });

    expect((await request(`${path}/repayments/${repaymentId}/confirmation`, { confirmationPassword: accountPassword }, financeToken)).status).toBe(403);
    const confirmed = await request(`${path}/repayments/${repaymentId}/confirmation`, { confirmationPassword: accountPassword, confirmationNote: "合成财务核对" }, financeDirectorToken);
    expect(confirmed).toMatchObject({ status: 201, body: { status: "confirmed", amountCents: "1" } });
    expect(await request(path)).toMatchObject({ status: 200, body: { loanAccount: { fundedAmountCents: "1", repaidAmountCents: "1", balanceAmountCents: "0" }, loanRepayments: expect.arrayContaining([expect.objectContaining({ id: repaymentId, status: "confirmed", confirmationNote: "合成财务核对" })]) } });
    expect((await request(`${path}/repayments/${repaymentId}/confirmation`, { confirmationPassword: accountPassword }, financeDirectorToken)).status).toBe(400);

    expect((await request(`${path}/repayments/${repaymentId}/reversal`, { reason: "合成错误更正", confirmationPassword: accountPassword }, financeToken)).status).toBe(403);
    const reversed = await request(`${path}/repayments/${repaymentId}/reversal`, { reason: "合成错误更正", confirmationPassword: accountPassword }, financeDirectorToken);
    expect(reversed).toMatchObject({ status: 201, body: { status: "reversed", amountCents: "1" } });
    expect(await request(path)).toMatchObject({ status: 200, body: { loanAccount: { fundedAmountCents: "1", repaidAmountCents: "0", balanceAmountCents: "1" }, loanRepayments: expect.arrayContaining([expect.objectContaining({ id: repaymentId, status: "reversed", reversalReason: "合成错误更正" })]) } });
    expect((await request(`${path}/repayments/${repaymentId}/reversal`, { reason: "重复更正", confirmationPassword: accountPassword }, financeDirectorToken)).status).toBe(400);
    for (const viewport of ["desktop", "mobile"] as const) {
      browserRepaymentClaimIds[viewport] = (await createDisbursedLoan(browserRepaymentProjectIds[viewport], viewport)).id;
    }
  }, 60_000);

  (enabled ? it.each(["reimbursement", "loan", "incidental_expense"] as const) : it.skip.each(["reimbursement", "loan", "incidental_expense"] as const))("V6 正式 PDF：%s 逐节点签名及未通过下载边界", async claimType => {
    const created = await request("/expense-claims", selfInput(applicantUserId, claimType));
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    const capability = `/approval-forms/expense_claim/${created.body.id}/capability`;
    expect(await request(capability)).toMatchObject({ status: 200, body: { available: false } });
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    for (const approvalToken of approvalTokens) {
      expect(await request(capability)).toMatchObject({ status: 200, body: { available: false } });
      expect((await request(`${path}/approval`, { decision: "approve" }, approvalToken)).status).toBe(201);
    }
    await verifyApprovedPdf({ db: app.get(PrismaService), baseUrl, token, password: accountPassword,
      businessType: "expense_claim", businessId: created.body.id,
      roles: ["comprehensive_director", "project_manager", "finance_director", "chairman"], label: `费用-${claimType}` });
    expect((await request(`/approval-forms/expense_claim/${created.body.id}/download`, { confirmationPassword: accountPassword, downloadReason: "无关人员边界" }, strangerToken)).status).toBe(403);
  }, 60_000);

  async function prepareBrowserDeletionFixtures() {
    const prisma = app.get(PrismaService);
    const contractSession = await selfAccount("contract_director");
    const fixtures = [];
    for (const viewport of ["desktop", "mobile"]) {
      for (const kind of ["incidental_expense", "general_procurement", "contract_takeover"] as const) {
        const session = kind === "contract_takeover" ? contractSession : browserSession;
        const reason = `本地草稿删除验收-${viewport}-${kind}-${randomUUID()}`;
        const rootPath = kind === "contract_takeover" ? `/projects/${projectId}/contract-takeovers` : kind === "general_procurement" ? "/general-procurements" : "/expense-claims";
        const input = kind === "contract_takeover"
          ? { code: `YS-${randomUUID()}`, name: reason, counterparty: "合成相对方", contractTypeKey: "material_purchase", companyEntityId, amountCents: "100", signedAt: "2026-10-20", takeoverLevel: "B", takeoverLevelAdjustmentReason: "仅本机删除验收", lifecycleStatus: "in_progress", takeoverCutoffDate: "2026-10-20", responsibleUserId: session.user.id }
          : kind === "general_procurement"
            ? { projectId, companyEntityId, reason, category: "office_supplies", requestedAmountCents: "100", requestKey: randomUUID() }
            : { ...selfInput(applicantUserId, "incidental_expense"), reason };
        const created = await request(rootPath, input, session.tokens.accessToken);
        expect(created.status).toBe(201);
        const id = created.body.id;
        let fileId: string | null = null;
        if (kind !== "general_procurement") {
          const form = new FormData();
          form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "本地合成删除凭证.png");
          const upload = await fetch(`${baseUrl}${kind === "contract_takeover" ? `${rootPath}/files` : `${rootPath}/${id}/draft-attachment-file-uploads`}`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body: form });
          expect(upload.status).toBe(201);
          fileId = ((await upload.json()) as { id: string }).id;
          expect((await request(`${rootPath}/${id}/${kind === "contract_takeover" ? "evidence-files" : "attachments"}`, kind === "contract_takeover" ? { fileId, purpose: "historical_contract_scan" } : { fileId, category: "other" }, session.tokens.accessToken)).status).toBe(201);
        }
        const beforeAudits = await prisma.auditLog.findMany({ where: { businessId: id }, orderBy: { id: "asc" } });
        expect(beforeAudits.length).toBeGreaterThan(0);
        const history = kind === "contract_takeover" ? await prisma.contractTakeover.findUniqueOrThrow({ where: { id } }) : null;
        const path = kind === "contract_takeover" ? `/历史合同接管?projectId=${projectId}&takeoverId=${id}` : kind === "general_procurement" ? `/综合采购申请/${id}` : `/费用与报销/${id}`;
        fixtures.push({ viewport, kind, id, path, rootPath, session, fileId, history, beforeAudits });
      }
    }
    return fixtures;
  }

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("桌面和手机通过真实页面创建费用草稿而不自动提交", async () => {
    await app.get(PrismaService).projectRosterMember.upsert({ where: { projectId_userId: { projectId, userId: financeSession.user.id } }, create: { projectId, userId: financeSession.user.id }, update: {} });
    const deletionTitle = "本地三类草稿删除：取消保留、确认彻底删除且审计留存";
    const deletionSelected = (!process.env.POL115_BROWSER_SPEC || process.env.POL115_BROWSER_SPEC === "draft-deletion-real.e2e.ts")
      && (!process.env.POL115_BROWSER_GREP?.trim() || new RegExp(process.env.POL115_BROWSER_GREP.trim()).test(deletionTitle));
    const deletionFixtures = deletionSelected ? await prepareBrowserDeletionFixtures() : [];
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        POL115_API_URL: baseUrl,
        POL115_DELETION_FIXTURES: JSON.stringify(deletionFixtures.map(({ viewport, kind, id, path, rootPath, session }) => ({ viewport, kind, id, path, rootPath, session }))),
        POL115_BROWSER_SESSION: JSON.stringify(browserSession),
        POL115_FINANCE_SESSION: JSON.stringify(financeSession),
        POL115_PROXY_SESSION: JSON.stringify(proxySession),
        POL115_FINANCE_DIRECTOR_SESSION: JSON.stringify(financeDirectorSession),
        POL115_REPAYMENT_CLAIM_IDS: JSON.stringify(browserRepaymentClaimIds),
        POL115_ACCOUNT_PASSWORD: accountPassword
      };
      delete env.JEST_WORKER_ID;
      const browserArgs = ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts"];
      const browserGrep = process.env.POL115_BROWSER_GREP?.trim();
      if (browserGrep) {
        browserArgs.push("--grep", browserGrep);
        console.info(`[POL115] 费用真实浏览器仅执行显式筛选: ${browserGrep}`);
      }
      const child = spawn("pnpm", browserArgs, {
        cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit"
      });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("费用真实浏览器验证失败")));
    });
    if (deletionSelected) {
      const prisma = app.get(PrismaService);
      for (const fixture of deletionFixtures) {
        const { id, kind, history, session, fileId, beforeAudits } = fixture;
        const businessType = kind === "incidental_expense" ? "expense_claim" : kind;
        const audit = await prisma.auditLog.findMany({ where: { businessId: id, action: `${businessType}.draft.delete` } });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ actorUserId: session.user.id, businessType });
        expect(audit[0]!.metadata).toMatchObject({ projectId, previousStatus: "draft" });
        expect(await prisma.auditLog.findMany({ where: { id: { in: beforeAudits.map(row => row.id) } }, orderBy: { id: "asc" } })).toEqual(beforeAudits);
        expect(await prisma.approvalInstance.count({ where: { businessId: id } })).toBe(0);
        if (kind === "incidental_expense") {
          expect(await prisma.expenseClaim.count({ where: { id } })).toBe(0);
          expect(await prisma.expenseClaimAttachment.count({ where: { expenseClaimId: id } })).toBe(0);
          expect(audit[0]!.metadata).toMatchObject({ companyEntityId, claimType: kind, requestedAmountCents: "1", handledByUserId: session.user.id });
        } else if (history) {
          expect(await prisma.contractTakeover.count({ where: { id } })).toBe(0);
          expect(await prisma.contract.count({ where: { id: history.contractId } })).toBe(0);
          expect(await prisma.contractVersion.count({ where: { id: history.contractVersionId } })).toBe(0);
          expect(await prisma.paymentTermsVersion.count({ where: { id: history.paymentTermsVersionId } })).toBe(0);
          expect(await prisma.archiveRecord.count({ where: { businessId: id } })).toBe(0);
          expect(audit[0]!.metadata).toMatchObject({ contractId: history.contractId, contractVersionId: history.contractVersionId });
        } else {
          expect(await prisma.generalProcurement.count({ where: { id } })).toBe(0);
          expect(audit[0]!.metadata).toMatchObject({ companyEntityId, requestedAmountCents: "100", revision: 1, applicantUserId: session.user.id });
        }
        if (fileId) {
          const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
          expect(audit[0]!.metadata).toMatchObject({ files: [{ id: fileId, contentSha256: file.contentSha256, sizeBytes: file.sizeBytes, name: file.originalName }] });
          expect(JSON.stringify(audit[0]!.metadata)).not.toContain(file.objectKey);
        }
      }
    }
  }, 180_000);

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
    for (const approvalToken of approvalTokens) {
      expect((await request(`${path}/approval`, { decision: "approve" }, approvalToken)).status).toBe(201);
    }
    await verifyApprovedPdf({ db: app.get(PrismaService), baseUrl, token, password: accountPassword,
      businessType: "expense_claim", businessId: created.body.id,
      roles: ["comprehensive_director", "project_manager", "finance_director", "chairman"], label: "费用-备用金用途" });
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
