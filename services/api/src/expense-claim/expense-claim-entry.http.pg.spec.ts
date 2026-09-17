import "reflect-metadata";
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
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

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
    expect((await upload(strangerToken)).status).toBe(403);
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

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("桌面和手机通过真实页面创建费用草稿而不自动提交", async () => {
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        POL115_API_URL: baseUrl,
        POL115_BROWSER_SESSION: JSON.stringify(browserSession),
        POL115_FINANCE_SESSION: JSON.stringify(financeSession),
        POL115_FINANCE_DIRECTOR_SESSION: JSON.stringify(financeDirectorSession),
        POL115_REPAYMENT_CLAIM_IDS: JSON.stringify(browserRepaymentClaimIds),
        POL115_ACCOUNT_PASSWORD: accountPassword
      };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts", "--grep", "零星费用选择既有分类后保存并明确提交"], {
        cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit"
      });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("费用真实浏览器验证失败")));
    });
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
