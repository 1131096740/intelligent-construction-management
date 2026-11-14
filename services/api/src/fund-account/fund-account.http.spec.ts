import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { FileService } from "../file/file.service";
import { type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../database/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService as JwtProvider } from "../auth/jwt-token.service";
import { ApprovalDelegationController } from "../approval/approval-delegation.controller";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { AuditController } from "../audit/audit.controller";
import { AuditService } from "../audit/audit.service";
import { FundAccountController } from "./fund-account.controller";
import { createFundAccountSyntheticDb } from "./testing/fund-account.synthetic-db";
import { FundAccountService } from "./fund-account.service";

// The only synthetic boundary is persistence. Controller, service, JWT,
// company role resolver, permission/retirement guards and DTO pipe are real.
describe("registered fund accounts public HTTP (synthetic database)", () => {
  let app: INestApplication;
  const tokens = new JwtTokenService();
  const database = createFundAccountSyntheticDb();
  const { prisma } = database;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FundAccountController, AuditController, ApprovalDelegationController, MeController], providers: [FundAccountService, ApprovalDelegationService, AuthService, JwtProvider, AuditService, MeService, { provide: FileService, useValue: {} }, { provide: PrismaService, useValue: prisma }] }).compile();
    app = module.createNestApplication({ logger: false });
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, prisma as never), new RetiredWriteEntryGuard(), new PermissionGuard(reflector, prisma as never));
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
  });
  beforeEach(() => database.reset());
  afterAll(async () => { await app?.close(); });
  async function get(actor = "finance", path = "/fund-accounts") {
    const token = tokens.signAccessToken({ id: actor, name: "合成人员", phone: null, sessionVersion: 0 });
    const response = await fetch(`${await app.getUrl()}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }
  async function post(body: unknown, actor = "finance", path = "/fund-accounts/openings") {
    const match = /^\/fund-accounts\/registrations\/([^/]+)\/(confirm|return|withdraw)$/.exec(path);
    if (match && body && typeof body === "object" && !("idempotencyKey" in body)) body = { idempotencyKey: `${actor}:${match[1]}:${match[2]}`, ...body };
    if (match && body && typeof body === "object" && !("expectedApprovalInstanceId" in body)) {
      const receipt = await get(actor, `/fund-accounts/registrations/${match[1]}`);
      body = { expectedApprovalInstanceId: receipt.body.approvalInstanceId, ...body };
    }
    const token = tokens.signAccessToken({ id: actor, name: "合成人员", phone: null });
    const response = await fetch(`${await app.getUrl()}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  it("shows exactly one registered balance for every company and one companyless public cash; unknown is never zero", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.accounts).toEqual([
      expect.objectContaining({ scopeKey: "company:company-a", companyEntityId: "company-a", balanceYuan: null }),
      expect.objectContaining({ scopeKey: "company:company-b", companyEntityId: "company-b", balanceYuan: null }),
      expect.objectContaining({ scopeKey: "public_cash", companyEntityId: null, balanceYuan: null, custodianLabel: "当前综合部主管" })
    ]);
  });
  it("registers known public cash while source and project remain pending, and retries do not duplicate the opening", async () => {
    const body = { scopeKey: "public_cash", balanceYuan: "80000", asOfDate: "2026-11-05", evidenceReference: "现金实点表第15号", reconciliationNote: "实点与现金账核对一致，历史支出已包含", reason: "首次启用核对", idempotencyKey: "opening-cash-15", sources: [{ amountYuan: "80000", sourceStatus: "pending", sourceName: null, projectStatus: "pending", projectId: null }] };
    expect(await post(body, "keeper")).toMatchObject({ status: 201, body: { balanceYuan: "80000.0000", status: "confirmed", sources: [{ sourceStatus: "pending", projectId: null }] } });
    expect(await post(body, "keeper")).toMatchObject({ status: 201, body: { balanceYuan: "80000.0000" } });
    const result = await get();
    expect(result.body.accounts.find((account: { scopeKey: string }) => account.scopeKey === "public_cash")).toMatchObject({ balanceYuan: "80000.0000", history: [expect.objectContaining({ reason: "首次启用核对" })] });
  });
  it("corrects registered 50000 to verified 80000 only after finance director review, retaining the original and source lineage", async () => {
    const basis = { scopeKey: "company:company-a", balanceYuan: "50000", asOfDate: "2026-11-05", evidenceReference: "甲公司财务核对表", reconciliationNote: "已扣历史支出", reason: "期初", idempotencyKey: "company-opening", sources: [{ amountYuan: "50000", sourceStatus: "pending", projectStatus: "pending" }] };
    const opening = await post(basis);
    expect(opening.status).toBe(201);
    const correction = await post({ ...basis, balanceYuan: "80000", idempotencyKey: "company-correction", previousRegistrationId: opening.body.id, reason: "实际余额8万，复核漏登记差额3万；不作收入", sources: [{ amountYuan: "80000", sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: opening.body.sources[0].id }] }, "finance", "/fund-accounts/corrections");
    expect(correction).toMatchObject({ status: 201, body: { status: "pending_review", previousRegistrationId: opening.body.id } });
    expect((await get()).body.accounts[0].balanceYuan).toBe("50000.0000");
    expect(await post({ reviewNote: "已核银行对账及原始凭据" }, "director", `/fund-accounts/registrations/${correction.body.id}/confirm`)).toMatchObject({ status: 201, body: { status: "confirmed", balanceYuan: "80000.0000" } });
    const account = (await get()).body.accounts[0];
    expect(account.balanceYuan).toBe("80000.0000");
    expect(account.history).toHaveLength(2);
    expect(account.history[1]).toMatchObject({ balanceYuan: "50000.0000", reason: "期初" });
    expect(account.sources[0].previousSourceBatchId).toBe(opening.body.sources[0].id);
  });
  const basis = { scopeKey: "company:company-b", balanceYuan: "0", asOfDate: "2026-11-05", evidenceReference: "核对表", reconciliationNote: "已核对", reason: "期初登记", idempotencyKey: "negative-opening", sources: [] };
  it("keeps an explicitly reconciled zero distinct from an unknown balance", async () => {
    expect(await post({ ...basis, balanceYuan: null, idempotencyKey: "unknown-company-a", scopeKey: "company:company-a" })).toMatchObject({ status: 201, body: { balanceYuan: null, sources: [] } });
    expect(await post(basis)).toMatchObject({ status: 201, body: { balanceYuan: "0.0000" } });
  });
  it.each(["admin", "employee", "project_finance"])("denies company account authority to %s at the real guard/service boundary", async actor => {
    expect((await post(basis, actor)).status).toBe(403);
    expect((await get()).body.accounts[1].balanceYuan).toBeNull();
    expect((await get("director", "/audit-logs")).body.rows).toEqual([]);
  });
  it("forbids financial staff from opening public cash and the custodian from opening a company account", async () => {
    expect((await post({ ...basis, scopeKey: "public_cash" }, "finance")).status).toBe(403);
    expect((await post(basis, "keeper")).status).toBe(403);
  });
  it.each([
    { asOfDate: "invalid" }, { asOfDate: "2026-02-30" }, { asOfDate: "2999-01-01" },
    { balanceYuan: "1.00001" }, { balanceYuan: "-1" }, { balanceYuan: 12 }, { balanceYuan: "NaN" },
    { balanceYuan: "1", sources: [] }, { balanceYuan: null, sources: [{ amountYuan: "0", sourceStatus: "pending", projectStatus: "pending" }] },
    { sources: [{ amountYuan: "0", sourceStatus: "known", projectStatus: "pending" }] },
    { sources: [{ amountYuan: "0", sourceStatus: "pending", sourceName: "未核来源", projectStatus: "pending" }] },
    { sources: [{ amountYuan: "0", sourceStatus: "pending", projectStatus: "project" }] },
    { sources: [{ amountYuan: "0", sourceStatus: "pending", projectStatus: "pending", projectId: "project-a" }] },
    { companyEntityId: "company-a" }, { historicalPaidYuan: "30" }
  ])("rejects invalid or invented opening facts without success/audit mutations: %j", async patch => {
    expect((await post({ ...basis, ...patch })).status).toBe(400);
    expect((await get()).body.accounts[1].history).toEqual([]);
    expect((await get("director", "/audit-logs")).body.rows).toEqual([]);
  });
  it("does not re-open under another key or reuse a key for different facts; one public audit event survives retries", async () => {
    expect((await post(basis)).status).toBe(201);
    expect((await post(basis)).status).toBe(201);
    expect((await post({ ...basis, reason: "另一事实" })).status).toBe(409);
    expect((await post({ ...basis, idempotencyKey: "duplicate-opening" })).status).toBe(409);
    expect((await get("director", "/audit-logs")).body.rows).toHaveLength(1);
  });
  it("rolls back opening and sources when audit persistence fails", async () => {
    database.failAudit(true);
    expect((await post(basis)).status).toBe(500);
    database.failAudit(false);
    expect((await get()).body.accounts[1].history).toEqual([]);
    expect((await get("director", "/audit-logs")).body.rows).toEqual([]);
    expect((await post(basis)).status).toBe(201);
  });
  it("requires the initiating director's current password for self review, and rechecks revoked company authority", async () => {
    const opening = await post(basis);
    const correction = await post({ ...basis, balanceYuan: "80000", idempotencyKey: "self-correction", previousRegistrationId: opening.body.id, sources: [{ amountYuan: "80000", sourceStatus: "pending", projectStatus: "pending" }] }, "director", "/fund-accounts/corrections");
    const path = `/fund-accounts/registrations/${correction.body.id}/confirm`;
    expect((await post({ reviewNote: "本人核对" }, "director", path)).status).toBe(400);
    expect((await post({ reviewNote: "本人核对", selfReviewReason: "本人实点并核对原始资料", confirmationPassword: "wrong" }, "director", path)).status).toBe(400);
    expect((await get()).body.accounts[1].balanceYuan).toBe("0.0000");
    database.setRole("director", "employee");
    expect((await post({ reviewNote: "本人核对", selfReviewReason: "本人实点并核对原始资料", confirmationPassword: "Synthetic15Password!" }, "director", path)).status).toBe(403);
    database.setRole("director", "finance_director");
    expect((await post({ reviewNote: "本人核对", selfReviewReason: "本人实点并核对原始资料", confirmationPassword: "Synthetic15Password!" }, "director", path)).status).toBe(201);
    expect((await get()).body.accounts[1].balanceYuan).toBe("80000.0000");
    const audit = await get("director", "/audit-logs");
    expect(audit.body.rows).toHaveLength(3);
    expect(JSON.stringify(audit.body)).not.toContain("Synthetic15Password!");
  });
  it("separates account total from each project attribution without allocating unresolved sources or losing four-place amounts", async () => {
    expect((await post({ ...basis, balanceYuan: "80000.1234", sources: [
      { amountYuan: "30000.1234", sourceStatus: "known", sourceName: "原出资人", projectStatus: "pending" },
      { amountYuan: "20000", sourceStatus: "pending", projectStatus: "project", projectId: "project-a" },
      { amountYuan: "30000", sourceStatus: "known", sourceName: "公司原自有资金", projectStatus: "company_daily" }
    ] })).status).toBe(201);
    const account = (await get()).body.accounts[1];
    expect(account.balanceYuan).toBe("80000.1234");
    expect(account.projectBalances).toEqual([
      { projectStatus: "pending", projectId: null, amountYuan: "30000.1234" },
      { projectStatus: "project", projectId: "project-a", amountYuan: "20000.0000" },
      { projectStatus: "company_daily", projectId: null, amountYuan: "30000.0000" }
    ]);
    expect(account.sources[0]).toMatchObject({ sourceName: "原出资人", projectId: null });
    expect(account.sources[1]).toMatchObject({ sourceStatus: "pending", projectId: "project-a" });
  });
  it("admits Beijing today before UTC midnight and rejects the next business day", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-04T16:30:00Z"), doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "hrtime", "performance"] });
    try {
      expect(await post({ ...basis, asOfDate: "2026-11-05" })).toMatchObject({ status: 201, body: { asOfDate: "2026-11-05" } });
      expect((await post({ ...basis, scopeKey: "company:company-a", idempotencyKey: "future-business-day", asOfDate: "2026-11-06" })).status).toBe(400);
    } finally { jest.useRealTimers(); }
  });
  it("serves fresh target-bound capabilities and denies anonymous requests", async () => {
    const anonymous = await fetch(`${await app.getUrl()}/fund-accounts`);
    expect(anonymous.status).toBe(401);
    expect((await get("finance", "/fund-accounts/company%3Acompany-b")).body).toMatchObject({ scopeKey: "company:company-b", canRegisterOpening: true, canRegisterBalance: true });
    expect((await get("finance", "/fund-accounts/missing")).status).toBe(404);
    const opening = await post(basis);
    const correction = await post({ ...basis, idempotencyKey: "fresh-correction", previousRegistrationId: opening.body.id }, "director", "/fund-accounts/corrections");
    expect((await get("director", `/fund-accounts/registrations/${correction.body.id}`)).body).toMatchObject({ id: correction.body.id, canConfirm: true, requiresSelfPassword: true, previousRegistrationId: opening.body.id });
    expect((await get("keeper", `/fund-accounts/registrations/${correction.body.id}`)).body).toMatchObject({ id: correction.body.id, canConfirm: false, requiresSelfPassword: false });
    expect((await get("director", "/fund-accounts/company%3Acompany-b")).body.canRequestCorrection).toBe(false);
  });
  it("rejects cross-account predecessor and source substitution while preserving both original histories", async () => {
    const a = await post({ ...basis, scopeKey: "company:company-a", idempotencyKey: "cross-a", balanceYuan: "5", sources: [{ amountYuan: "5", sourceStatus: "pending", projectStatus: "pending" }] });
    const b = await post({ ...basis, idempotencyKey: "cross-b", balanceYuan: "5", sources: [{ amountYuan: "5", sourceStatus: "pending", projectStatus: "pending" }] });
    expect((await post({ ...basis, previousRegistrationId: a.body.id, idempotencyKey: "cross-predecessor" }, "finance", "/fund-accounts/corrections")).status).toBe(409);
    expect((await post({ ...basis, balanceYuan: "8", previousRegistrationId: b.body.id, idempotencyKey: "cross-source", sources: [{ amountYuan: "8", sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: a.body.sources[0].id }] }, "finance", "/fund-accounts/corrections")).status).toBe(400);
    expect((await get()).body.accounts.map((row: { history: unknown[] }) => row.history.length)).toEqual([1, 1, 0]);
    expect((await get("director", "/audit-logs")).body.rows).toHaveLength(2);
  });
  it("returns a mistaken pending correction with a reason, preserves the effective balance, and allows a new version without reviving the old request", async () => {
    const opening = await post(basis);
    const payload = { ...basis, previousRegistrationId: opening.body.id, idempotencyKey: "return-correction", reason: "误填待复核更正" };
    const pending = await post(payload, "finance", "/fund-accounts/corrections");
    const returnPath = `/fund-accounts/registrations/${pending.body.id}/return`;
    expect((await post({ reviewNote: "缺少核对依据，请制单人补齐重提" }, "finance", returnPath)).status).toBe(403);
    expect((await post({ reviewNote: " " }, "director", returnPath)).status).toBe(400);
    expect(await post({ reviewNote: "缺少核对依据，请制单人补齐重提" }, "director", returnPath)).toMatchObject({ status: 201, body: { status: "returned", reason: "误填待复核更正", balanceYuan: "0.0000" } });
    expect((await get()).body.accounts[1].balanceYuan).toBe("0.0000");
    expect(await post(payload, "finance", "/fund-accounts/corrections")).toMatchObject({ status: 201, body: { id: pending.body.id, status: "returned" } });
    expect((await post({ reviewNote: "旧请求不能再确认" }, "director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(409);
    const next = await post({ ...payload, idempotencyKey: "corrected-resubmission", reason: "补齐核对依据后重提" }, "finance", "/fund-accounts/corrections");
    expect(next).toMatchObject({ status: 201, body: { version: 3, previousRegistrationId: opening.body.id, status: "pending_review" } });
    expect((await get()).body.accounts[1].history).toHaveLength(3);
  });
  it("lets only the active initiator withdraw an unconfirmed correction with password and reason, then submit a distinct new version", async () => {
    const opening = await post(basis);
    const payload = { ...basis, previousRegistrationId: opening.body.id, idempotencyKey: "withdraw-correction" };
    const pending = await post(payload, "finance", "/fund-accounts/corrections");
    const path = `/fund-accounts/registrations/${pending.body.id}/withdraw`;
    expect((await post({ reviewNote: "主动补正", confirmationPassword: "Synthetic15Password!" }, "director", path)).status).toBe(403);
    expect((await post({ reviewNote: "主动补正" }, "finance", path)).status).toBe(400);
    expect(await post({ reviewNote: "主动补正", confirmationPassword: "Synthetic15Password!" }, "finance", path)).toMatchObject({ status: 201, body: { status: "withdrawn", closeReason: "主动补正" } });
    expect((await post({ reviewNote: "旧请求不允许确认" }, "director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(409);
    expect((await post(payload, "finance", "/fund-accounts/corrections")).body.status).toBe("withdrawn");
    const next = await post({ ...payload, idempotencyKey: "withdrawn-resubmit" }, "finance", "/fund-accounts/corrections");
    expect(next.body.version).toBe(3);
    expect((await get()).body.accounts[1].balanceYuan).toBe("0.0000");
  });
  it("rolls back returned and withdrawn transitions when audit persistence fails; self-return requires the current password", async () => {
    const opening = await post(basis);
    const pending = await post({ ...basis, idempotencyKey: "failed-close", previousRegistrationId: opening.body.id }, "director", "/fund-accounts/corrections");
    const path = `/fund-accounts/registrations/${pending.body.id}`;
    expect((await post({ reviewNote: "本人退回" }, "director", `${path}/return`)).status).toBe(400);
    database.failAudit(true);
    expect((await post({ reviewNote: "本人退回", selfReviewReason: "本人发现资料依据不足", confirmationPassword: "Synthetic15Password!" }, "director", `${path}/return`)).status).toBe(500);
    expect((await post({ reviewNote: "本人撤回", confirmationPassword: "Synthetic15Password!" }, "director", `${path}/withdraw`)).status).toBe(500);
    database.failAudit(false);
    expect((await get("director", path)).body.status).toBe("pending_review");
    expect((await get()).body.accounts[1].balanceYuan).toBe("0.0000");
    expect((await get("director", "/audit-logs")).body.rows).toHaveLength(2);
  });
  it("requires the actual finance reviewer's valid handwritten signature before making a corrected balance effective", async () => {
    const opening = await post(basis);
    const pending = await post({ ...basis, idempotencyKey: "signed-correction", previousRegistrationId: opening.body.id }, "finance", "/fund-accounts/corrections");
    database.setSignature("director", false);
    expect((await post({ reviewNote: "核对通过" }, "director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(400);
    expect((await get("director", `/fund-accounts/registrations/${pending.body.id}`)).body.status).toBe("pending_review");
    database.setSignature("director", true);
    expect((await post({ reviewNote: "核对通过" }, "director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(201);
    expect((await get("director", `/fund-accounts/registrations/${pending.body.id}`)).body.approvalEvidence).toContainEqual(expect.objectContaining({ actorUserId: "director", representedUserId: "director", signed: true, signatureVersionId: "signature-version:director" }));
  });
  it("allows an exact live fund duty delegation to sign as the actual actor without granting account-list access", async () => {
    const opening = await post(basis);
    const pending = await post({ ...basis, idempotencyKey: "delegated-correction", previousRegistrationId: opening.body.id }, "finance", "/fund-accounts/corrections");
    const round = pending.body.approvalInstanceId;
    const mandate = await post({ toUserId: "delegate", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${round}:0` }, "director", "/approval-delegations");
    expect(mandate.status).toBe(201);
    expect((await get("delegate", "/approval-delegations")).body).toContainEqual(expect.objectContaining({reviewPath:`/资金余额复核/${pending.body.id}`}));
    expect((await get("delegate")).status).toBe(403);
    expect((await get("delegate", `/fund-accounts/registrations/${pending.body.id}/review`)).body).toMatchObject({ id: pending.body.id, canConfirm: true });
    expect((await post({ expectedApprovalInstanceId: round, reviewNote: "受托人实核余额与凭据" }, "delegate", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(201);
    expect((await get("director", `/fund-accounts/registrations/${pending.body.id}`)).body.approvalEvidence).toContainEqual(expect.objectContaining({ actorUserId: "delegate", representedUserId: "director", signed: true, signatureVersionId: "signature-version:delegate" }));
  });
  async function delegatedPending(toUserId = "delegate") {
    const opening = await post(basis);
    const payload = { ...basis, idempotencyKey: "negative-delegate-correction", previousRegistrationId: opening.body.id };
    const pending = await post(payload, "finance", "/fund-accounts/corrections");
    const mandate = await post({ toUserId, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${pending.body.approvalInstanceId}:0` }, "director", "/approval-delegations");
    expect(mandate.status).toBe(201);
    return { pending: pending.body, mandate: mandate.body, payload };
  }
  it.each(["delegator_role", "delegator_inactive", "actor_inactive", "expired", "revoked"])("denies invalid live mandate %s without changing balance or signature evidence", async mode => {
    const { pending, mandate } = await delegatedPending();
    if (mode === "delegator_role") database.setRole("director", "employee");
    if (mode === "delegator_inactive") database.setActive("director", false);
    if (mode === "actor_inactive") database.setActive("delegate", false);
    if (mode === "revoked") {
      const token = tokens.signAccessToken({ id: "director", name: "财务主管", phone: null });
      const response = await fetch(`${await app.getUrl()}/approval-delegations/${mandate.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
    }
    if (mode === "expired") jest.useFakeTimers({ now: Date.now() + 61000, doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "hrtime", "performance"] });
    try {
      const response = await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "不应成功" }, "delegate", `/fund-accounts/registrations/${pending.id}/confirm`);
      expect([401, 403]).toContain(response.status);
      const todos = await get("delegate", "/me/work-items");
      if (mode === "actor_inactive") expect([401, 403]).toContain(todos.status);
      else { expect(todos.status).toBe(200); expect(todos.body.queueMeta.pending.total).toBe(0); }
      expect((await get("finance")).body.accounts[1].balanceYuan).toBe("0.0000");
      expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body.approvalEvidence).toEqual([]);
    } finally { if (mode === "expired") jest.useRealTimers(); }
  });
  it.each(["confirm", "withdraw"])("projects current fund duty and count for the actual director and exact delegate, then removes them after %s", async action => {
    const { pending } = await delegatedPending();
    for (const actor of ["director", "delegate"]) {
      const items = await get(actor, "/me/work-items");
      expect(items.status).toBe(200);
      expect(items.body.queues.pending).toContainEqual(expect.objectContaining({ businessType: "fund_account_balance_registration", businessId: pending.id, targetPath: `/资金余额复核/${pending.id}` }));
      expect(items.body.queueMeta.pending.total).toBe(1);
      const summary = await get(actor, "/me/workbench-summary");
      expect(summary.status).toBe(200);
      expect(summary.body.cards).toContainEqual(expect.objectContaining({ id: "approval_todo", count: 1 }));
    }
    expect((await get("employee", "/me/work-items")).body.queueMeta.pending.total).toBe(0);
    if (action === "confirm") expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "current duty" }, "delegate", `/fund-accounts/registrations/${pending.id}/confirm`)).status).toBe(201);
    else expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "withdraw original correction", confirmationPassword: "Synthetic15Password!" }, "finance", `/fund-accounts/registrations/${pending.id}/withdraw`)).status).toBe(201);
    expect((await get("finance")).body.accounts[1].balanceYuan).toBe("0.0000");
    for (const actor of ["director", "delegate"]) {
      expect((await get(actor, "/me/work-items")).body.queueMeta.pending.total).toBe(0);
      const cards = (await get(actor, "/me/workbench-summary")).body.cards;
      expect(cards.find((card: { id: string }) => card.id === "approval_todo")?.count ?? 0).toBe(0);
    }
  });
  it("does not lend a delegator signature or let an ordinary delegate re-delegate someone else's duty", async () => {
    const { pending } = await delegatedPending();
    database.setSignature("delegate", false);
    expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "不能借用原财务主管签名" }, "delegate", `/fund-accounts/registrations/${pending.id}/confirm`)).status).toBe(400);
    expect((await post({ toUserId: "employee", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${pending.approvalInstanceId}:0` }, "delegate", "/approval-delegations")).status).toBe(403);
    expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body.approvalEvidence).toEqual([]);
  });
  it("does not let an exact old mandate approve another account or a resubmitted round", async () => {
    const { pending, payload } = await delegatedPending();
    const otherOpening = await post({ ...basis, scopeKey: "company:company-a", idempotencyKey: "other-opening" });
    const other = await post({ ...basis, scopeKey: "company:company-a", previousRegistrationId: otherOpening.body.id, idempotencyKey: "other-pending" }, "finance", "/fund-accounts/corrections");
    expect((await post({ expectedApprovalInstanceId: other.body.approvalInstanceId, reviewNote: "他案禁止" }, "delegate", `/fund-accounts/registrations/${other.body.id}/confirm`)).status).toBe(403);
    expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "轮次不匹配" }, "director", `/fund-accounts/registrations/${other.body.id}/confirm`)).status).toBe(409);
    expect((await post({ reviewNote: "退回补依据" }, "director", `/fund-accounts/registrations/${pending.id}/return`)).status).toBe(201);
    const next = await post({ ...payload, idempotencyKey: "new-round-after-return" }, "finance", "/fund-accounts/corrections");
    expect((await post({ expectedApprovalInstanceId: next.body.approvalInstanceId, reviewNote: "旧委托不得进入新轮" }, "delegate", `/fund-accounts/registrations/${next.body.id}/confirm`)).status).toBe(403);
  });
  it("requires real initiator self-review reason and password even when authority is delegated back to that initiator", async () => {
    const { pending } = await delegatedPending("finance");
    const path = `/fund-accounts/registrations/${pending.id}/confirm`;
    expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "不能绕过本人自审" }, "finance", path)).status).toBe(400);
    expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "本人实核", selfReviewReason: "本人核对原始凭据与差额" }, "finance", path)).status).toBe(400);
    expect((await post({ expectedApprovalInstanceId: pending.approvalInstanceId, reviewNote: "本人实核", selfReviewReason: "本人核对原始凭据与差额", confirmationPassword: "Synthetic15Password!" }, "finance", path)).status).toBe(201);
    expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body.approvalEvidence).toContainEqual(expect.objectContaining({ actorUserId: "finance", representedUserId: "director", signed: true, metadata: expect.objectContaining({ selfReview: true }) }));
  });
  it("retains a pending-configuration correction and hands its same round to a newly assigned current finance director", async () => {
    const opening = await post(basis);
    database.setRole("director", "employee"); database.setRole("other_director", "employee");
    const pending = await post({ ...basis, idempotencyKey: "no-duty", previousRegistrationId: opening.body.id }, "finance", "/fund-accounts/corrections");
    expect(pending).toMatchObject({ status: 201, body: { status: "pending_review" } });
    const before = (await get()).body.accounts[1];
    expect(before.balanceYuan).toBe("0.0000");
    expect(before.history).toHaveLength(2);
    expect(before.history[0]).toMatchObject({ pendingConfiguration: true, canConfirm: false });
    expect((await get("director", "/me/work-items")).body.queueMeta.pending.total).toBe(0);
    expect((await get("finance", "/me/work-items")).body.queues.started).toContainEqual(expect.objectContaining({ businessId: pending.body.id, currentNode: "财务主管待配置" }));
    database.setRole("finance", "employee");
    expect((await get("finance", "/me/work-items")).body.queues.started).toEqual([]);
    database.setRole("finance", "finance_staff");
    expect((await post({ expectedApprovalInstanceId: pending.body.approvalInstanceId, reviewNote: "无岗不得办理" }, "director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(403);
    database.setRole("other_director", "finance_director");
    const resumed = (await get("other_director")).body.accounts[1];
    expect(resumed.history[0]).toMatchObject({ id: pending.body.id, approvalInstanceId: pending.body.approvalInstanceId, pendingConfiguration: false, canConfirm: true });
    expect(resumed.balanceYuan).toBe("0.0000");
    expect((await get("other_director", "/me/work-items")).body.queues.pending).toContainEqual(expect.objectContaining({ businessId: pending.body.id }));
    expect((await get("other_director", "/me/workbench-summary")).body.cards).toContainEqual(expect.objectContaining({ id: "approval_todo", count: 1 }));
    expect((await post({ expectedApprovalInstanceId: pending.body.approvalInstanceId, reviewNote: "补岗后复核同一原单" }, "other_director", `/fund-accounts/registrations/${pending.body.id}/confirm`)).status).toBe(201);
  });
  it("returns the exact actor's frozen success receipt after a delegated approval has completed, without repeating money or signature logs", async () => {
    const { pending } = await delegatedPending();
    const body = { expectedApprovalInstanceId: pending.approvalInstanceId, idempotencyKey: "delegate-response-loss-command", reviewNote: "受托核实后批准" };
    const path = `/fund-accounts/registrations/${pending.id}/confirm`;
    const first = await post(body, "delegate", path);
    expect(first.status).toBe(201);
    database.conflictNextTransaction(); // Fresh committed readback after the write transaction has ended.
    const replay = await post(body, "delegate", path);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body.approvalEvidence).toHaveLength(1);
    expect((await get("delegate")).status).toBe(403);
  });
  it("reads a natural reviewer's already committed frozen command before new business handling", async () => {
    const opening = await post(basis);
    const pending = await post({ ...basis, previousRegistrationId: opening.body.id, idempotencyKey: "natural-review-receipt" }, "finance", "/fund-accounts/corrections");
    const input = { expectedApprovalInstanceId: pending.body.approvalInstanceId, idempotencyKey: "natural-response-loss-command", reviewNote: "核对后的正式签批" };
    const path = `/fund-accounts/registrations/${pending.body.id}/confirm`;
    const first = await post(input, "director", path);
    expect(first.status).toBe(201);
    expect(await post(input, "director", path)).toEqual(first);
    expect((await get("finance", `/fund-accounts/registrations/${pending.body.id}`)).body.approvalEvidence).toHaveLength(1);
  });
  it("never washes changed payload, another actor, another case or a new key through a completed delegation receipt", async () => {
    const { pending } = await delegatedPending();
    const input = { expectedApprovalInstanceId: pending.approvalInstanceId, idempotencyKey: "strict-frozen-receipt", reviewNote: "本人受托核实后批准" };
    const path = `/fund-accounts/registrations/${pending.id}/confirm`;
    const first = await post(input, "delegate", path);
    expect(first.status).toBe(201);
    const before = (await get("finance", `/fund-accounts/registrations/${pending.id}`)).body;
    expect((await post({ ...input, reviewNote: "另一意见" }, "delegate", path)).status).toBe(409);
    expect((await post({ ...input, selfReviewReason: "另一业务内容" }, "delegate", path)).status).toBe(409);
    expect((await post(input, "employee", path)).status).toBe(403);
    expect((await post(input, "director", path)).status).toBe(409);
    expect((await post({ ...input, idempotencyKey: "new-key-after-completion" }, "delegate", path)).status).toBe(403);
    const otherOpening = await post({ ...basis, scopeKey: "company:company-a", idempotencyKey: "receipt-other-opening" });
    const other = await post({ ...basis, scopeKey: "company:company-a", previousRegistrationId: otherOpening.body.id, idempotencyKey: "receipt-other-correction" }, "finance", "/fund-accounts/corrections");
    expect((await post({ ...input, expectedApprovalInstanceId: other.body.approvalInstanceId }, "delegate", `/fund-accounts/registrations/${other.body.id}/confirm`)).status).toBe(403);
    expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body).toEqual(before);
    expect((await get("delegate")).status).toBe(403);
  });
  it("replays only the completed actor receipt after mandate revocation, but never past account/session deactivation", async () => {
    const { pending, mandate } = await delegatedPending();
    const input = { expectedApprovalInstanceId: pending.approvalInstanceId, idempotencyKey: "receipt-after-revoke", reviewNote: "有效委托时已完成的本次签批" };
    const path = `/fund-accounts/registrations/${pending.id}/confirm`;
    const first = await post(input, "delegate", path);
    const token = tokens.signAccessToken({ id: "director", name: "财务主管", phone: null });
    expect((await fetch(`${await app.getUrl()}/approval-delegations/${mandate.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(await post(input, "delegate", path)).toEqual(first);
    expect((await post({ ...input, idempotencyKey: "not-a-replay" }, "delegate", path)).status).toBe(403);
    database.setSessionVersion("delegate", 1);
    expect((await post(input, "delegate", path)).status).toBe(401);
    database.setSessionVersion("delegate", 0); database.setActive("delegate", false);
    expect((await post(input, "delegate", path)).status).toBe(401);
    expect((await get("finance", `/fund-accounts/registrations/${pending.id}`)).body.approvalEvidence).toHaveLength(1);
  });
  it("returns only the current delegated registration and its required effective predecessor, never unrelated same-account history", async () => {
    const opening = await post(basis);
    const old = await post({ ...basis, idempotencyKey: "private-old", previousRegistrationId: opening.body.id, reason: "不应进入本次委托的旧整理说明" }, "finance", "/fund-accounts/corrections");
    expect((await post({ reviewNote: "退回旧整理" }, "director", `/fund-accounts/registrations/${old.body.id}/return`)).status).toBe(201);
    const current = await post({ ...basis, idempotencyKey: "current-only", previousRegistrationId: opening.body.id }, "finance", "/fund-accounts/corrections");
    expect((await post({ toUserId: "delegate", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${current.body.approvalInstanceId}:0` }, "director", "/approval-delegations")).status).toBe(201);
    const target = await get("delegate", `/fund-accounts/registrations/${current.body.id}/review`);
    expect(target.status).toBe(200);
    expect(target.body.account.history.map((row: { id: string }) => row.id)).toEqual([current.body.id, opening.body.id]);
    expect(JSON.stringify(target.body)).not.toContain("不应进入本次委托的旧整理说明");
    expect((await get("delegate", `/fund-accounts/registrations/${old.body.id}/review`)).status).toBe(403);
    expect((await get("delegate", `/approval-delegations/duty-capability?dutyId=${current.body.approvalInstanceId}:0`)).status).toBe(403);
    expect((await get("delegate", "/approval-delegations/duty-options")).body).toEqual([]);
  });
  it("returns the old frozen delegated result after a newer balance version has become effective", async () => {
    const opening = await post(basis);
    const firstPending = await post({ ...basis, balanceYuan: "5", sources: [{ amountYuan: "5", sourceStatus: "pending", projectStatus: "pending" }], previousRegistrationId: opening.body.id, idempotencyKey: "history-five" }, "finance", "/fund-accounts/corrections");
    expect((await post({ toUserId: "delegate", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${firstPending.body.approvalInstanceId}:0` }, "director", "/approval-delegations")).status).toBe(201);
    const input = { expectedApprovalInstanceId: firstPending.body.approvalInstanceId, idempotencyKey: "historical-five-receipt", reviewNote: "本次核对余额为五元" };
    const path = `/fund-accounts/registrations/${firstPending.body.id}/confirm`;
    const first = await post(input, "delegate", path);
    expect(first).toMatchObject({ status: 201, body: { balanceYuan: "5.0000" } });
    const next = await post({ ...basis, balanceYuan: "8", sources: [{ amountYuan: "8", sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: firstPending.body.sources[0].id }], previousRegistrationId: firstPending.body.id, idempotencyKey: "history-eight" }, "finance", "/fund-accounts/corrections");
    expect((await post({ reviewNote: "新核对余额为八元" }, "director", `/fund-accounts/registrations/${next.body.id}/confirm`)).status).toBe(201);
    expect((await get()).body.accounts[1].balanceYuan).toBe("8.0000");
    expect(await post(input, "delegate", path)).toEqual(first);
    expect((await get()).body.accounts[1].balanceYuan).toBe("8.0000");
  });
});
