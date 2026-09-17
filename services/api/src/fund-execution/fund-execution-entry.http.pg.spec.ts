import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { VerifiedBankTransactionObservationService } from "./verified-bank-transaction-observation.service";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";
type CaseBody = { caseId: string; revision: number; status: string; entrySnapshots: Array<{ definitionVersion: number; valuesSnapshot: Record<string, unknown> }> };

describe("资金办理统一录入真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let reviewerToken: string;
  let browserSession: unknown;
  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") throw new Error("仅允许本票本机专用数据库");
    const secret = randomUUID();
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = secret;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    const db = app.get(PrismaService);
    const suffix = randomUUID();
    const password = randomUUID();
    const actor = await db.user.create({ data: { name: "资金填写人", phone: suffix, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const reviewer = await db.user.create({ data: { name: "核验人", phone: `reviewer-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const role = await db.position.upsert({ where: { key: "finance_staff" }, create: { key: "finance_staff", name: "财务人员" }, update: {} });
    await db.userPosition.create({ data: { userId: actor.id, positionId: role.id } });
    const reviewerRole = await db.position.upsert({ where: { key: "finance_director" }, create: { key: "finance_director", name: "财务主管" }, update: {} });
    await db.userPosition.create({ data: { userId: reviewer.id, positionId: reviewerRole.id } });
    // Synthetic external master data and trusted bank evidence; no confirmed business fact is seeded.
    const company = await db.companyEntity.create({ data: { name: "资金合成公司", unifiedSocialCreditCode: "91310000POL115001", dataStatus: "complete", currentVersionNo: 1 } });
    const companyVersion = await db.companyEntityVersion.create({ data: { companyEntityId: company.id, versionNo: 1, name: company.name, unifiedSocialCreditCode: company.unifiedSocialCreditCode, isActive: true, action: "test_master", actorUserId: actor.id } });
    const party = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: `pol115-${suffix}`, unifiedSocialCreditCode: "91310000POL115002", createdByUserId: actor.id } });
    const partyVersion = await db.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name, unifiedSocialCreditCode: party.unifiedSocialCreditCode }, createdByUserId: actor.id } });
    const project = await db.project.create({ data: { code: `FUND115-${suffix}`, name: "合成资金项目" } });
    await db.projectAffiliateAssignment.create({ data: { projectId: project.id, businessPartyId: party.id, businessPartyVersionId: partyVersion.id, affiliateNameSnapshot: party.name, affiliateCreditCodeSnapshot: party.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "合成主数据", assignedByUserId: actor.id } });
    await db.projectParticipatingCompany.create({ data: { projectId: project.id, companyEntityId: company.id, companyEntityVersionId: companyVersion.id, companyNameSnapshot: company.name, companyCreditCodeSnapshot: company.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "合成主数据", addedByUserId: actor.id } });
    await db.project.update({ where: { id: project.id }, data: { operatingLedgerEffectiveDate: new Date("2026-01-01") } });
    const files = await Promise.all(["核验依据.pdf", "银行流水.pdf"].map((name, index) => db.fileObject.create({ data: { bucket: "pol115-test", objectKey: `${suffix}/${name}`, originalName: name, mimeType: "application/pdf", sizeBytes: 128, contentSha256: "a".repeat(64), uploadedByUserId: index === 0 ? reviewer.id : actor.id, storageStatus: "active" } })));
    await db.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret"("id", "secretHash") VALUES (1, crypt(${secret}, gen_salt('bf'))) ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"`;
    const verificationId = randomUUID();
    await db.$queryRaw`SELECT * FROM public."jg_issue_payment_execution_payer_verification_trusted"(${JSON.stringify({ id: verificationId, reference: suffix, holderCompanyEntityId: company.id, holderNameSnapshot: company.name, holderCreditCodeSnapshot: company.unifiedSocialCreditCode, verificationReference: suffix, verifiedByUserId: reviewer.id, verifiedAt: "2026-09-01T00:00:00.000Z", verificationEvidenceFileId: files[0]!.id, verificationEvidenceContentSha256: "a".repeat(64), status: "verified", sourceType: "bank_account_legal_holder", sourceRecordId: suffix })}::JSONB)`;
    await app.get(VerifiedBankTransactionObservationService).record({ reference: suffix, payerVerificationId: verificationId, transactionSourceType: "pol115_test_statement", transactionSourceId: suffix, transactionSourceIdentity: "b".repeat(64), transactionEvidenceFileId: files[1]!.id, transactionExecutedByUserId: actor.id, amountCents: 12500n, currencyCode: "CNY", direction: "inflow", occurredAt: new Date("2026-09-16T00:00:00.000Z"), createdByUserId: actor.id, auditRequestId: randomUUID() });
    const login = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password }) });
    expect(login.status).toBe(201);
    const actorSession = await login.json();
    browserSession = {
      user: { id: actor.id, name: actor.name, phone: actor.phone, mustChangePassword: false, roleKeys: ["finance_staff"], globalRoleKeys: ["finance_staff"] },
      tokens: (actorSession as { tokens: unknown }).tokens
    };
    token = (actorSession as { tokens: { accessToken: string } }).tokens.accessToken;
    const reviewerLogin = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: reviewer.phone, password }) });
    expect(reviewerLogin.status).toBe(201);
    const reviewerSession = await reviewerLogin.json();
    reviewerToken = (reviewerSession as { tokens: { accessToken: string } }).tokens.accessToken;
  }, 60_000);
  afterAll(async () => { if (app) await app.close(); });
  async function request<T>(path: string, method = "GET", body?: unknown, accessToken = token) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify({ status: response.status, body: result }));
    return result as T;
  }
  (enabled ? it : it.skip)("经公开候选创建分类并提交，回读冻结字段且同命令重放保持同一快照", async () => {
    const observations = await request<Array<{ selectionRef: string }>>("/fund-executions/observation-options");
    expect(observations).toHaveLength(1);
    const created = await request<CaseBody>("/fund-executions/cases", "POST", { observationSelectionRef: observations[0]!.selectionRef, reason: "公司资金到账", idempotencyKey: randomUUID() });
    const path = `/fund-executions/cases/${created.caseId}`;
    const plans = await request<Array<{ lines: Array<{ axes: Array<{ selectionRef: string }> }> }>>(`${path}/classification-options`);
    expect(plans).toHaveLength(1);
    const updated = await request<CaseBody>(path, "PATCH", { reason: "公司项目资金到账", expectedRevision: created.revision, selections: plans[0]!.lines.flatMap((line) => line.axes.map(({ selectionRef }) => ({ selectionRef }))), idempotencyKey: randomUUID() });
    const submit = { expectedRevision: updated.revision, idempotencyKey: randomUUID() };
    const submitted = await request<CaseBody>(`${path}/submit`, "POST", submit);
    expect(submitted).toMatchObject({ status: "submitted", revision: 3 });
    const detail = await request<CaseBody>(path);
    expect(detail.entrySnapshots).toHaveLength(1);
    expect(detail.entrySnapshots[0]).toMatchObject({ definitionVersion: 1, valuesSnapshot: { reason: "公司项目资金到账", amountCents: "12500", direction: "inflow" } });
    expect(await request(`${path}/submit`, "POST", submit)).toEqual(submitted);
    expect((await request<CaseBody>(path)).entrySnapshots).toEqual(detail.entrySnapshots);

    await request(`${path}/approval-actions`, "POST", { action: "return_to_applicant", comment: "分类说明需更精确" }, reviewerToken);
    const returned = await request<CaseBody>(`${path}/return`, "POST", { expectedRevision: submitted.revision, reason: "补充分项目说明", idempotencyKey: randomUUID() }, reviewerToken);
    await request<CaseBody>(`${path}/submit`, "POST", { expectedRevision: returned.revision, idempotencyKey: randomUUID() }, reviewerToken);
    const resubmitted = await request<CaseBody>(path, "GET", undefined, reviewerToken);
    expect(resubmitted.entrySnapshots).toHaveLength(2);
    expect(resubmitted.entrySnapshots[0]).toEqual(detail.entrySnapshots[0]);
    expect(resubmitted.entrySnapshots[1]).toMatchObject({ valuesSnapshot: { reason: "公司项目资金到账", amountCents: "12500", direction: "inflow" } });
  }, 60_000);

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("桌面和手机从真实详情回读冻结提交记录", async () => {
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, POL115_API_URL: baseUrl, POL115_BROWSER_SESSION: JSON.stringify(browserSession), POL115_BROWSER_SPEC: "pol115-fund-real.e2e.ts" };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("资金执行历史真实浏览器验证失败")));
    });
  }, 180_000);
});
