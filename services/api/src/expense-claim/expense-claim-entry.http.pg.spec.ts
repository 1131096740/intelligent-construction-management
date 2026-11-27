import "reflect-metadata";
import * as ExcelJS from "exceljs";
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { verifyApprovedPdf } from "../database/approval-pdf-acceptance.test-support";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { ExpenseClaimService } from "./expense-claim.service";
import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";
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
  const approvalActorIds: string[] = [];
  let browserSession: BrowserAuthSession;
  let financeSession: BrowserAuthSession;
  let proxySession: BrowserAuthSession;
  let financeDirectorSession: BrowserAuthSession;
  const browserRepaymentProjectIds: Record<"desktop" | "mobile", string> = { desktop: "", mobile: "" };
  const browserRepaymentClaimIds: Record<"desktop" | "mobile", string> = { desktop: "", mobile: "" };

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    const nativeA04 = process.env.JG_NATIVE_331_A04_DATABASE === url.pathname.slice(1)
      && /^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname)
      && url.username === "jg_task01_owner"
      && url.searchParams.get("sslmode") === "require"
      && url.searchParams.get("sslaccept") === "strict"
      && Boolean(url.searchParams.get("sslcert"));
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1"
        || (url.pathname !== "/jiangkong_pol115_entry_test" && !nativeA04)) {
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
          approvalActorIds.push(userId);
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

  async function request(path: string, body?: unknown, accessToken = token, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as {
      id: string;
      status: string;
      updatedAt: string;
      approvalInstanceId: string | null;
      entryDefinition: BusinessEntrySceneDefinition;
      entrySnapshots: Array<{ definitionSnapshot: BusinessEntrySceneDefinition; valuesSnapshot: Record<string, unknown> }>;
      approval?: { approvalInstanceId?: string; actionableDuties?: Array<{ index: number; name: string }> } | null;
    } };
  }

  async function parallelReviewCoordinates(path: string, reviewerToken: string) {
    const detail = await request(path, undefined, reviewerToken);
    expect(detail.status).toBe(200);
    const approval = detail.body.approval;
    expect(approval?.approvalInstanceId).toEqual(expect.any(String));
    expect(approval?.actionableDuties).toHaveLength(1);
    return { approvalInstanceId: approval!.approvalInstanceId!, approvalDutyIndex: approval!.actionableDuties![0]!.index };
  }

  function procurementInput(reason: string) {
    return {
      requestProtocolVersion: 2,
      scope: "project",
      projectId,
      companyEntityId,
      category: "office_supplies",
      reason,
      estimatedAmount: "1.0000",
      lines: [{ id: randomUUID(), name: "合成办公用品" }],
      requestKey: randomUUID()
    };
  }

  async function selfAccount(role?: RoleKey, assignmentProjectId = projectId) {
    const prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { name: `本人申请${role ?? "未配置岗位"}`, phone: `self-${suffix}`, passwordHash: await hash(accountPassword, 4), mustChangePassword: false } });
    if (role) {
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: GLOBAL_USER_POSITION_ROLE_KEYS.includes(role) ? null : assignmentProjectId } });
    }
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password: accountPassword }) });
    expect(response.status).toBe(201);
    return await response.json() as BrowserAuthSession;
  }

  function selfInput(userId: string, claimType: "reimbursement" | "incidental_expense" = "incidental_expense") {
    return {
      claimType, companyEntityId, projectId, applicantUserId: userId, reason: "合成本人费用申请", requestedAmountCents: "1",
      ...(claimType === "incidental_expense" ? { incidentalExpenseCategory: "temporary_service", payeeName: "合成服务提供方" } : {}),
      ...(claimType === "reimbursement" ? { lines: [{ expenseCategory: "办公费", occurredOn: "2026-10-16", purpose: "合成文具", receiptCount: 0, amountCents: "1", evidenceType: "none", noEvidenceReason: "隔离测试" }] } : {})
    };
  }

  (enabled ? it : it.skip)("报销四位元金额按明细精确求和、仅在付款总额取整", async () => {
    const prisma = app.get(PrismaService);
    const { requestedAmountCents, lines: legacyLines, ...claim } = selfInput(applicantUserId, "reimbursement");
    const { amountCents, ...line } = legacyLines![0];
    const exact = (amount: string) => ({ ...line, amountYuan: amount });
    const reason = "四位金额验收";
    const path = "/expense-claims";
    const countBefore = await prisma.expenseClaim.count({ where: { reason } });
    for (const invalid of ["", "0", "-0.0001", "0.00501", "1e2", "92233720368547758.0750", "100000000000000000000.0000"]) {
      expect((await request(path, { ...claim, reason, requestedAmountYuan: invalid, lines: [exact(invalid)] })).status).toBe(400);
    }
    expect((await request(path, { ...claim, reason, requestedAmountYuan: "0.0101", lines: [exact("0.005"), exact("0.005")] })).status).toBe(400);
    expect((await request(path, { ...claim, reason, requestedAmountYuan: "92233720368547758.0800", lines: [exact("92233720368547758.0700"), exact("0.0100")] })).status).toBe(400);
    expect(await prisma.expenseClaim.count({ where: { reason } })).toBe(countBefore);

    const created = await request(path, { ...claim, reason, requestedAmountYuan: "0.0100", lines: [exact("0.005"), exact("0.005")] });
    expect(created).toMatchObject({ status: 201, body: { requestedAmountYuan: "0.0100", requestedAmountCents: "1", numericProtocolVersion: 2 } });
    const detailPath = path + "/" + created.body.id;
    expect(await request(detailPath)).toMatchObject({ status: 200, body: {
      requestedAmountYuan: "0.0100", requestedAmountCents: "1",
      lines: [{ amountYuan: "0.0050", amountCents: "1" }, { amountYuan: "0.0050", amountCents: "0" }]
    } });
    const submitted = await request(detailPath + "/submission", {});
    expect(submitted).toMatchObject({ status: 201, body: { companyPayableAmountCents: "1" } });
    const snapshot = await prisma.expenseClaimEntrySnapshot.findFirstOrThrow({ where: { expenseClaimId: created.body.id } });
    expect(snapshot.valuesSnapshot).toMatchObject({ requestedAmountYuan: "0.0100", requestedAmountCents: "1", numericProtocolVersion: 2, lines: [{ amountYuan: "0.0050", amountCents: "1" }, { amountYuan: "0.0050", amountCents: "0" }] });

    const zeroPayable = await request(path, { ...claim, reason, requestedAmountYuan: "0.0001", lines: [exact("0.0001")] });
    expect(zeroPayable).toMatchObject({ status: 201, body: { requestedAmountYuan: "0.0001", requestedAmountCents: "0" } });
    const maxPayable = await request(path, { ...claim, reason, requestedAmountYuan: "92233720368547758.0749", lines: [exact("92233720368547758.0749")] });
    expect(maxPayable).toMatchObject({ status: 201, body: { requestedAmountYuan: "92233720368547758.0749", requestedAmountCents: "9223372036854775807" } });
    const exportResponse = await fetch(`${baseUrl}${path}/ledger-export?keyword=${encodeURIComponent(reason)}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(exportResponse.status).toBe(200);
    const ledger = new ExcelJS.Workbook();
    await ledger.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const sheet = ledger.getWorksheet("费用与报销台账");
    const amountColumn = sheet?.getRow(1).values;
    const column = Array.isArray(amountColumn) ? amountColumn.indexOf("申请金额（元）") : -1;
    expect(column).toBeGreaterThan(0);
    expect(sheet!.getColumn(column).values).toEqual(expect.arrayContaining([0.01, 0.0001, "92233720368547758.0749"]));
    expect([2, 3, 4].map(row => [sheet!.getRow(row).getCell(column).value, sheet!.getRow(row).getCell(column).numFmt]))
      .toEqual(expect.arrayContaining([[0.0001, "#,##0.0000"], ["92233720368547758.0749", "@"]]));

    expect(await request(detailPath + "/withdrawal", { approvalInstanceId: submitted.body.approvalInstanceId }))
      .toMatchObject({ status: 201, body: { status: "draft" } });
    const returned = await request(detailPath);
    const refreshed = await request(detailPath + "/draft", { expectedUpdatedAt: returned.body.updatedAt, reason }, token, "PATCH");
    expect(refreshed).toMatchObject({ status: 200, body: { requestedAmountYuan: "0.0100", requestedAmountCents: "1" } });
    expect((await request(detailPath + "/draft", { expectedUpdatedAt: refreshed.body.updatedAt, reason, lines: legacyLines }, token, "PATCH")).status).toBe(400);
    const replacement = await request(detailPath + "/draft", {
      expectedUpdatedAt: refreshed.body.updatedAt, reason, lines: [exact("0.0001"), exact("0.0100")]
    }, token, "PATCH");
    expect(replacement).toMatchObject({ status: 200, body: { requestedAmountYuan: "0.0101", requestedAmountCents: "1" } });
    expect(await request(detailPath)).toMatchObject({ status: 200, body: {
      requestedAmountYuan: "0.0101", lines: [{ amountYuan: "0.0001", amountCents: "0" }, { amountYuan: "0.0100", amountCents: "1" }]
    } });
  }, 45_000);

  (enabled ? it : it.skip)("报销四位元金额终审保留项目成本并分开整数分待付", async () => {
    const prisma = app.get(PrismaService);
    const company = await prisma.companyEntity.update({
      where: { id: companyEntityId },
      data: { unifiedSocialCreditCode: "91310000A01EXP0001", currentVersionNo: 1 }
    });
    const version = await prisma.companyEntityVersion.create({
      data: { companyEntityId, versionNo: 1, name: company.name, unifiedSocialCreditCode: company.unifiedSocialCreditCode,
        isActive: true, action: "test_master", actorUserId: applicantUserId }
    });
    const effectiveFrom = new Date("2026-01-01");
    await prisma.projectParticipatingCompany.create({
      data: { projectId, companyEntityId, companyEntityVersionId: version.id,
        companyNameSnapshot: company.name, companyCreditCodeSnapshot: company.unifiedSocialCreditCode,
        effectiveFrom, changeReason: "隔离四位报销成本验收", addedByUserId: applicantUserId }
    });
    await prisma.project.update({ where: { id: projectId }, data: { operatingLedgerEffectiveDate: effectiveFrom } });

    const { requestedAmountCents, lines: legacyLines, ...claim } = selfInput(applicantUserId, "reimbursement");
    const { amountCents, ...line } = legacyLines![0];
    for (const scenario of [
      { exact: "0.0100", payable: "1", amounts: ["0.0050", "0.0050"], status: "approved_pending_payment", costBearingCompanyEntityId: company.id },
      { exact: "100.0050", payable: "10001", amounts: ["100.0050"], status: "approved_pending_payment", costBearingCompanyEntityId: company.id },
      { exact: "0.0001", payable: "0", amounts: ["0.0001"], status: "offset_completed", costBearingCompanyEntityId: null }
    ]) {
      const created = await request("/expense-claims", { ...claim, costBearingCompanyEntityId: scenario.costBearingCompanyEntityId,
        requestedAmountYuan: scenario.exact, lines: scenario.amounts.map(amountYuan => ({ ...line, amountYuan })) });
      expect(created).toMatchObject({ status: 201, body: { requestedAmountYuan: scenario.exact, requestedAmountCents: scenario.payable } });
      const path = `/expense-claims/${created.body.id}`;
      expect(await request(path + "/submission", {})).toMatchObject({ status: 201, body: { companyPayableAmountCents: scenario.payable } });
      for (const [approvalIndex, approvalToken] of approvalTokens.entries()) {
        const coordinates = await parallelReviewCoordinates(path, approvalToken);
        const approval = await request(path + "/approval", { decision: "approve", ...coordinates }, approvalToken);
        if (approval.status !== 201) throw new Error(`四位报销 ${scenario.exact} 审批 ${approvalIndex + 1}：${approval.status} ${JSON.stringify(approval.body)}`);
      }
      expect(await request(path)).toMatchObject({ status: 200, body: {
        status: scenario.status, requestedAmountYuan: scenario.exact, companyPayableAmountCents: scenario.payable
      } });
      const facts = await prisma.operatingFact.findMany({
        where: { sourceType: "expense_claim_approval", sourceBusinessId: created.body.id },
        include: { impacts: { orderBy: { sourceImpactKey: "asc" } } }
      });
      expect(facts).toHaveLength(1);
      const [fact] = facts;
      expect(fact).toMatchObject({ numericProtocolVersion: 2, amountCents: null, costBearingCompanySubjectId: scenario.costBearingCompanyEntityId });
      expect(fact.amountYuan?.toFixed(4)).toBe(scenario.exact);
      expect(fact.impacts.filter(impact => impact.impactKind === "confirmed_cost").map(impact => impact.amountYuan?.toFixed(4))).toEqual(scenario.amounts);
      expect(fact.impacts.filter(impact => impact.impactKind === "payable_increase").map(impact => impact.amountYuan?.toFixed(4))).toEqual(scenario.payable === "0" ? [] : scenario.payable === "1" ? ["0.0100"] : ["100.0100"]);
      expect(await prisma.expenseClaimPaymentExecution.count({ where: { expenseClaimId: created.body.id } })).toBe(0);
      if (scenario.exact === "100.0050") {
        const scopeKey = `company:${companyEntityId}`;
        const account = await prisma.registeredFundAccount.create({
          data: { scopeKey, kind: "company", companyEntityId }
        });
        const registration = await prisma.fundAccountBalanceRegistration.create({
          data: { accountId: account.id, version: 1, kind: "opening", status: "confirmed", balanceYuan: "200.0000",
            asOfDate: "2026-11-01", evidenceReference: "合成余额凭证", reconciliationNote: "已核对",
            reason: "合成期初", idempotencyKey: randomUUID(), payloadFingerprint: "b".repeat(64),
            createdByUserId: applicantUserId, confirmedByUserId: applicantUserId, confirmedAt: effectiveFrom,
            sources: { create: [{ lineNo: 1, amountYuan: "200.0000", sourceStatus: "known",
              sourceName: "合成项目资金", projectStatus: "project", projectId }] } },
          include: { sources: true }
        });
        const voucher = new FormData();
        voucher.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")],
          { type: "image/png" }), "合成付款凭证.png");
        voucher.append("idempotencyKey", randomUUID());
        const upload = await fetch(baseUrl + path + "/payment-voucher-file-uploads", {
          method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body: voucher
        });
        expect(upload.status).toBe(201);
        const { id: voucherFileId } = await upload.json() as { id: string };
        const pay = (amountCents: string) => request(path + "/payments", {
          amountCents, paidAt: "2026-11-26", paymentMethod: "银行转账", confirmationPassword: accountPassword, voucherFileId,
          registeredFunding: { scopeKey, expectedRegistrationId: registration.id,
            sourceAllocations: [{ sourceBatchId: registration.sources[0]!.id, amountCents }] }
        }, financeToken);
        expect((await pay("10002")).status).toBe(400);
        expect(await prisma.expenseClaimPaymentExecution.count({ where: { expenseClaimId: created.body.id } })).toBe(0);
        const paid = await pay("10001");
        if (paid.status !== 201) throw new Error(`四位报销实付 ${paid.status} ${JSON.stringify(paid.body)}`);
        expect(paid).toMatchObject({ status: 201, body: { status: "paid", paidAmountCents: "10001" } });
        expect(await request(path)).toMatchObject({ status: 200, body: {
          status: "paid", requestedAmountYuan: "100.0050", fundedAmountCents: "10001"
        } });
        const cashFact = await prisma.operatingFact.findFirstOrThrow({
          where: { sourceType: "expense_claim_payment_execution", sourceBusinessId: paid.body.id }, include: { impacts: true }
        });
        expect(cashFact.amountCents).toBe(10001n);
        expect(cashFact.impacts.filter(impact => impact.impactKind === "payable_decrease").map(impact => impact.amountCents)).toEqual([10001n]);
        expect(cashFact.impacts.filter(impact => impact.impactKind === "confirmed_cost")).toEqual([]);
        expect((await prisma.operatingFact.findUniqueOrThrow({ where: { id: fact.id } })).amountYuan?.toFixed(4)).toBe("100.0050");
      }
    }
  }, 60_000);

  function seedHistoricalLoan(status: "draft" | "approved_pending_disbursement" | "disbursed", reason: string, loanProjectId = projectId, requestedAmountCents = 1n) {
    const now = new Date();
    const approved = status !== "draft";
    return app.get(PrismaService).expenseClaim.create({ data: {
      code: "JK-HIST-" + randomUUID(), claimType: "loan", status, companyEntityId, projectId: loanProjectId,
      companyEntityNameSnapshot: "入口合成公司", applicantUserId, applicantNameSnapshot: browserSession.user.name,
      handledByUserId: applicantUserId, handledByNameSnapshot: browserSession.user.name, reason, requestedAmountCents,
      fundedAmountCents: status === "disbursed" ? requestedAmountCents : 0n,
      loanExpectedClearanceAt: new Date("2026-12-01"), submittedAt: approved ? now : null, approvedAt: approved ? now : null
    } });
  }

  (enabled ? it.each(["loan", "reimbursement", "incidental_expense"] as const) : it.skip.each(["loan", "reimbursement", "incidental_expense"] as const))("草稿删除边界：%s 新费用可删除且保留审计，旧借款保留", async claimType => {
    const prisma = app.get(PrismaService);
    const historical = claimType === "loan" ? await seedHistoricalLoan("draft", "删除旧借款草稿测试") : null;
    const created = claimType === "loan" ? null : await request("/expense-claims", selfInput(applicantUserId, claimType));
    if (created) expect(created.status).toBe(201);
    const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: historical?.id ?? created!.body.id } });
    const result = await request(`/expense-claims/${row.id}/draft-deletion`, { expectedUpdatedAt: row.updatedAt.toISOString() });
    if (historical) {
      expect(result.status).toBe(410);
      expect(await prisma.expenseClaim.findUnique({ where: { id: row.id } })).toEqual(row);
      expect(await prisma.auditLog.count({ where: { businessId: row.id, action: "expense_claim.draft.delete" } })).toBe(0);
      return;
    }
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
    const body = procurementInput("删除草稿测试");
    const created = await request("/general-procurements", body);
    expect(created).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    const draft = await prisma.generalProcurement.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(draft).toMatchObject({ requestProtocolVersion: 2, scope: "project", projectId, companyEntityId, requestedAmountCents: null });
    expect(draft.estimatedAmount?.toFixed(4)).toBe(body.estimatedAmount);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 1 }, financeToken)).status).toBe(403);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 2 })).status).toBe(409);
    expect((await request(`/general-procurements/${created.body.id}/draft-deletion`, { revision: 1 })).status).toBe(201);
    expect(await prisma.generalProcurement.findUnique({ where: { id: created.body.id } })).toBeNull();
    expect((await request("/general-procurements", body)).status).toBe(409);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: created.body.id, action: "general_procurement.draft.delete" } });
    expect(audit).toMatchObject({ actorUserId: applicantUserId, businessType: "general_procurement" });
    expect(audit.metadata).toMatchObject({ requestKey: body.requestKey, revision: 1, projectId, companyEntityId, applicantUserId, previousStatus: "draft", category: body.category, requestedAmountCents: null });
    expect(await prisma.auditLog.count({ where: { businessId: created.body.id, action: "general_procurement.create" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: created.body.id, action: "general_procurement.draft.delete" } })).toBe(1);
  });

  (enabled ? it : it.skip)("删除未提交草稿：综合采购审批后即使退回也不能硬删除", async () => {
    const created = await request("/general-procurements", procurementInput("保留审批测试"));
    expect(created).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    const path = `/general-procurements/${created.body.id}`;
    expect((await request(`${path}/submission`, { revision: 1 })).status).toBe(201);
    expect((await request(`${path}/draft-deletion`, { revision: 2 })).status).toBe(409);
    const returned = await request(`${path}/review`, { revision: 2, expectedNodeIndex: 0, decision: "return", comment: "核对采购用途" }, proxySession.tokens.accessToken);
    expect(returned).toMatchObject({ status: 201, body: { status: "returned", revision: 3 } });
    expect((await request(`${path}/draft-deletion`, { revision: 3 })).status).toBe(409);
    const prisma = app.get(PrismaService);
    await prisma.generalProcurement.update({ where: { id: created.body.id }, data: { status: "draft" } });
    expect((await request(`${path}/draft-deletion`, { revision: 3 })).status).toBe(409);
  });

  (enabled ? it : it.skip)("删除未提交草稿：附件关联删除，文件保留既有私有回收边界", async () => {
    const prisma = app.get(PrismaService);
    for (const claimType of ["reimbursement", "incidental_expense"] as const) {
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
    const procurement = await request("/general-procurements", procurementInput("并发删除验证"));
    expect(procurement).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    const procurementResults = await Promise.all([
      request(`/general-procurements/${procurement.body.id}/submission`, { revision: 1 }),
      request(`/general-procurements/${procurement.body.id}/draft-deletion`, { revision: 1 })
    ]);
    expect(procurementResults.filter(result => result.status === 201)).toHaveLength(1);
    expect(procurementResults.filter(result => result.status >= 400 && result.status < 500)).toHaveLength(1);
  });

  (enabled ? it : it.skip)("删除未提交草稿：受限数据库账号只可调用窄入口，不能直接删表", async () => {
    const prisma = app.get(PrismaService);
    const created = await request("/general-procurements", procurementInput("受限删除验证"));
    expect(created).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    const role = `draft_delete_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_general_procurement(TEXT,TEXT,INTEGER), public.jg_delete_unsubmitted_expense_claim(TEXT,TEXT,TIMESTAMP) TO "${role}"`);
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        await tx.$executeRaw`DELETE FROM "GeneralProcurement" WHERE "id" = ${created.body.id}`;
      })).rejects.toMatchObject({ code: "P2010", meta: { code: "42501" } });
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
      ...selfInput(financeSession.user.id), reason: "公司财务本人项目申请"
    }, financeToken)).toMatchObject({ status: 201 });
    expect(await request("/expense-claims", {
      ...selfInput(applicantUserId), reason: "仍禁止财务代他人申请"
    }, financeToken)).toMatchObject({ status: 403 });
  });

  (enabled ? it : it.skip).each([undefined, ...ROLE_KEYS])("本人申请：启用岗位 %s 可以为本人创建并提交报销和零星费用", async (role) => {
    const session = await selfAccount(role);
    await app.get(PrismaService).projectRosterMember.create({ data: { userId: session.user.id, projectId } });
    for (const claimType of ["reimbursement", "incidental_expense"] as const) {
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
    for (const endpoint of ["approval", "payments"]) {
      expect(await request(`${path}/${endpoint}`, { decision: "approve" }, accessToken)).toMatchObject({ status: 403 });
    }
    expect((await request(path + "/disbursements", {}, accessToken)).status).toBe(410);
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
    const created = await request("/expense-claims", { ...selfInput(applicantUserId), reason: "附件权限验证" });
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
    const created = await request("/expense-claims", { ...selfInput(applicantUserId), reason: "追加资料验证" });
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
      const coordinates = await parallelReviewCoordinates(path, approvalToken);
      const approval = await request(`${path}/approval`, { decision: "approve", ...coordinates }, approvalToken);
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

  (enabled ? it : it.skip)("历史借款拒绝两类凭证上传且不新增文件", async () => {
    const historical = await seedHistoricalLoan("approved_pending_disbursement", "历史待放款凭证入口");
    const db = app.get(PrismaService);
    const path = "/expense-claims/" + historical.id;
    expect(await request(path)).toMatchObject({ status: 200, body: { status: "approved_pending_disbursement" } });
    const originalFiles = await db.fileObject.count();
    for (const route of ["disbursement-voucher-file-uploads", "repayment-voucher-file-uploads"]) {
      const body = new FormData();
      body.append("file", new Blob(["合成凭证"], { type: "application/pdf" }), "合成凭证.pdf");
      body.append("idempotencyKey", randomUUID());
      const upload = await fetch(baseUrl + path + "/" + route, { method: "POST", headers: { authorization: `Bearer ${financeToken}` }, body });
      expect(upload.status).toBe(410);
    }
    expect(await db.fileObject.count()).toBe(originalFiles);
  });

  (enabled ? it : it.skip)("历史借款保留余额、放款、还款和现有归档，拒绝继续办理", async () => {
    const db = app.get(PrismaService);
    const at = new Date("2026-09-17");
    async function uploadHistoricalFile(bytes: Uint8Array, mimeType: string, name: string) {
      const body = new FormData();
      body.append("file", new Blob([Buffer.from(bytes)], { type: mimeType }), name);
      const result = await fetch(baseUrl + "/files", { method: "POST", body, headers: { authorization: `Bearer ${financeToken}` } });
      expect(result.status).toBe(201);
      const { id } = await result.json() as { id: string };
      return id;
    }
    async function seedDisbursedLoan(targetProjectId: string) {
      const claim = await seedHistoricalLoan("disbursed", "合成已放款历史借款", targetProjectId);
      const account = await db.employeeProjectLoanAccount.create({ data: {
        userId: applicantUserId, projectId: targetProjectId, companyEntityId, scopeKey: `project:${targetProjectId}`,
        fundedAmountCents: 1n, balanceAmountCents: 1n
      } });
      const voucherFileId = await uploadHistoricalFile(
        Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64"),
        "image/png", "历史放款凭证.png"
      );
      const disbursement = await db.employeeProjectLoanEntry.create({ data: {
        loanAccountId: account.id, sequenceNo: 1n, entryType: "disbursement", amountCents: 1n, balanceDeltaCents: 1n,
        sourceExpenseClaimId: claim.id, occurredAt: at, createdByUserId: financeSession.user.id, paymentMethod: "合成历史银行转账", voucherFileId
      } });
      const repayment = await db.employeeLoanRepayment.create({ data: {
        loanAccountId: account.id, amountCents: 1n, repaidAt: at, paymentMethod: "合成历史现金",
        status: "recorded", recordedByUserId: financeSession.user.id
      } });
      const document = await PDFDocument.create();
      document.addPage().drawText("Synthetic historical expense loan archive");
      const fileId = await uploadHistoricalFile(await document.save(), "application/pdf", "历史借款归档.pdf");
      const pdf = await db.pdfDocument.create({ data: {
        businessType: "expense_claim", businessId: claim.id, fileId, templateKey: "expense_claim_loan_final_disbursement_a5"
      } });
      await db.archiveRecord.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId, departmentScope: "finance" } });
      return { claim, account, disbursement, repayment, pdf };
    }
    const { claim, account, disbursement, repayment, pdf } = await seedDisbursedLoan(projectId);
    const path = "/expense-claims/" + claim.id;
    expect(await request(path)).toMatchObject({ status: 200, body: {
      status: "disbursed", fundedAmountCents: "1", loanAccount: { balanceAmountCents: "1" },
      loanDisbursements: [{ id: disbursement.id, amountCents: "1", voucherFileId: disbursement.voucherFileId }],
      loanRepayments: [{ id: repayment.id, status: "recorded", amountCents: "1" }],
      finalPaymentPdf: { id: pdf.id, fileId: pdf.fileId }, attachmentPermissions: { canAppendEvidence: false }
    } });
    expect((await request(path, undefined, strangerToken)).status).toBe(404);
    expect(await request(path + "/repayments/" + repayment.id + "/capability", undefined, financeDirectorToken)).toMatchObject({
      status: 200, body: { repaymentId: repayment.id, availableActions: [] }
    });
    const payload = { amountCents: "1", paymentMethod: "现金", voucherFileId: pdf.fileId, confirmationPassword: accountPassword };
    for (const [route, input, accessToken] of [
      ["disbursements", { ...payload, paidAt: at.toISOString().slice(0, 10) }, financeToken],
      ["repayments", { ...payload, repaidAt: at.toISOString().slice(0, 10) }, financeToken],
      [`repayments/${repayment.id}/confirmation`, { confirmationPassword: accountPassword }, financeDirectorToken],
      [`repayments/${repayment.id}/reversal`, { confirmationPassword: accountPassword, reason: "合成更正" }, financeDirectorToken],
      ["final-disbursement-pdf", {}, financeToken],
      ["attachments/append", { fileId: pdf.fileId, category: "receipt_or_other" }, financeToken]
    ] as const) {
      expect(await request(path + "/" + route, input, accessToken)).toMatchObject({ status: 410 });
    }
    expect(await db.employeeProjectLoanAccount.findUnique({ where: { id: account.id } })).toEqual(account);
    expect(await db.employeeProjectLoanEntry.count({ where: { loanAccountId: account.id } })).toBe(1);
    expect(await db.employeeLoanRepayment.findMany({ where: { loanAccountId: account.id } })).toEqual([repayment]);
    expect(await db.pdfDocument.findMany({ where: { businessId: claim.id } })).toEqual([pdf]);
    expect(await db.archiveRecord.count({ where: { businessId: claim.id, fileId: pdf.fileId } })).toBe(1);
    for (const viewport of ["desktop", "mobile"] as const) {
      browserRepaymentClaimIds[viewport] = (await seedDisbursedLoan(browserRepaymentProjectIds[viewport])).claim.id;
    }
  }, 60_000);

  (enabled ? it.each(["reimbursement", "incidental_expense"] as const) : it.skip.each(["reimbursement", "incidental_expense"] as const))(
    "并联费用 %s 部分签批后被退回，原经办人修订重提，旧轮不可继续办理",
    async claimType => {
      const db = app.get(PrismaService);
      const payload = selfInput(applicantUserId, claimType);
      const originalInput = {
        ...payload, requestedAmountCents: "10",
        ...(payload.lines ? { lines: payload.lines.map(line => ({ ...line, amountCents: "10" })) } : {})
      };
      const created = await request("/expense-claims", originalInput);
      expect(created.status).toBe(201);
      const path = `/expense-claims/${created.body.id}`;
      const formPath = `/approval-forms/expense_claim/${created.body.id}`;
      const capability = (id: string) => `${formPath}/capability?expectedApprovalInstanceId=${id}`;
      const downloadInput = (id: string) => ({
        confirmationPassword: accountPassword, downloadReason: "验收费用审批轮次", expectedApprovalInstanceId: id
      });
      const downloadAudits = () => db.auditLog.count({ where: { businessId: created.body.id, action: "approval.form.download" } });
      async function expectPdfSignatures(id: string, count: number) {
        const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
        const available = await fetch(`${baseUrl}${capability(id)}`, { headers });
        expect(available.status).toBe(200);
        expect(available.headers.get("cache-control")).toBe("no-store");
        expect(await available.json()).toMatchObject({ available: true });
        const response = await fetch(`${baseUrl}${formPath}/download`, {
          method: "POST", headers, body: JSON.stringify(downloadInput(id))
        });
        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("content-type")).toMatch(/application\/pdf/u);
        const pdf = await PDFDocument.load(await response.arrayBuffer());
        expect(pdf.getPageCount()).toBeGreaterThan(0);
        const signatureImages = pdf.getPages().flatMap(page =>
          page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.entries().filter(([, reference]) =>
            pdf.context.lookupMaybe(reference, PDFStream)?.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
          ) ?? []
        );
        if (signatureImages.length !== count) {
          throw new Error(`A04_PDF_SIGNATURE_IMAGES ${claimType} ${count} ${signatureImages.length}`);
        }
      }
      const submitted = await request(`${path}/submission`, {});
      expect(submitted.status).toBe(201);
      const oldId = submitted.body.approvalInstanceId!;
      const signed = await parallelReviewCoordinates(path, approvalTokens[2]!);
      const pending = await parallelReviewCoordinates(path, approvalTokens[0]!);
      expect((await request(`${path}/approval`, { decision: "approve", ...signed }, approvalTokens[2]!)).status).toBe(201);
      await expectPdfSignatures(oldId, 1);
      const originalSignature = await db.approvalActionLog.findFirstOrThrow({ where: { approvalInstanceId: oldId, action: "approve" } });
      const originalSnapshot = await db.expenseClaimEntrySnapshot.findFirstOrThrow({ where: { expenseClaimId: created.body.id, submissionRevision: oldId } });
      expect((await request(`${path}/approval`, { decision: "reject", ...pending }, approvalTokens[0]!)).status).toBe(400);
      expect(await request(`${path}/approval`, { decision: "reject", comment: "请修订金额和事由", ...pending }, approvalTokens[0]!))
        .toMatchObject({ status: 201, body: { status: "draft" } });
      expect(await request(capability(oldId))).toMatchObject({ status: 200, body: { available: false } });
      const withdrawnDetail = await request(path);
      expect(withdrawnDetail).toMatchObject({ status: 200, body: {
        status: "draft", approval: null, canEditReturnedDraft: true, canDeleteDraft: false, canWithdrawApproval: false,
        loanOffsetAmountCents: "0", companyPayableAmountCents: "0"
      } });
      expect(await request(`${path}/capability`)).toMatchObject({ status: 200, body: {
        availableActions: expect.arrayContaining(["edit_returned_expense_claim", "submit_expense_claim"])
      } });
      const patch = {
        expectedUpdatedAt: withdrawnDetail.body.updatedAt, reason: "合成事由已修订",
        ...(claimType === "reimbursement"
          ? { lines: originalInput.lines!.map(line => ({ ...line, amountCents: "8" })) }
          : { requestedAmountCents: "8" })
      };
      expect((await request(`${path}/draft`, patch, approvalTokens[2]!, "PATCH")).status).toBe(403);
      expect(await request(`${path}/draft`, patch, token, "PATCH")).toMatchObject({
        status: 200, body: { status: "draft", requestedAmountCents: "8" }
      });
      expect((await request(`${path}/draft`, patch, token, "PATCH")).status).toBe(409);

      const resubmitted = await request(`${path}/submission`, {});
      expect(resubmitted).toMatchObject({ status: 201, body: { status: "approval_pending", companyPayableAmountCents: "8" } });
      const newId = resubmitted.body.approvalInstanceId!;
      expect(newId).not.toBe(oldId);
      expect(await request(capability(oldId))).toMatchObject({ status: 200, body: { available: false } });
      expect(await request(capability(newId))).toMatchObject({ status: 200, body: { available: true, incomplete: true } });
      expect(await request(`/approval-progress/${oldId}`)).toMatchObject({
        status: 200, body: { canHandle: false, canRemind: false, pendingRecipients: [] }
      });
      expect((await request(`${formPath}/download`, downloadInput(oldId))).status).toBe(409);
      expect(await downloadAudits()).toBe(1);
      expect(await db.pdfDocument.count({ where: { businessId: created.body.id } })).toBe(0);
      await expectPdfSignatures(newId, 0);
      expect((await request(`${path}/approval`, { decision: "approve", ...pending }, approvalTokens[0]!)).status).toBe(409);
      expect((await db.approvalInstance.findUniqueOrThrow({ where: { id: oldId } })).status).toBe("returned");
      expect(await db.approvalActionLog.findUniqueOrThrow({ where: { id: originalSignature.id } })).toEqual(originalSignature);
      expect(await db.approvalActionLog.findFirstOrThrow({ where: { approvalInstanceId: oldId, action: "return_to_applicant" } }))
        .toMatchObject({ comment: "请修订金额和事由", signatureFileIdSnapshot: null, signatureVersionIdSnapshot: null });
      expect(await db.expenseClaimEntrySnapshot.findUniqueOrThrow({ where: { id: originalSnapshot.id } })).toEqual(originalSnapshot);
      expect(await db.expenseClaimEntrySnapshot.findFirstOrThrow({ where: { expenseClaimId: created.body.id, submissionRevision: newId } }))
        .toMatchObject({ valuesSnapshot: expect.objectContaining({ requestedAmountCents: "8", reason: "合成事由已修订" }) });
      const newRound = await db.approvalInstance.findUniqueOrThrow({ where: { id: newId } });
      expect(newRound.frozenNodes).toHaveLength(4);
      expect(await db.approvalActionLog.count({ where: { approvalInstanceId: newId, action: "approve" } })).toBe(0);
      const newSigned = await parallelReviewCoordinates(path, approvalTokens[2]!);
      expect((await request(`${path}/approval`, { decision: "approve", ...newSigned }, approvalTokens[2]!)).status).toBe(201);
      expect((await request(`${path}/withdrawal`, { approvalInstanceId: newId }, approvalTokens[2]!)).status).toBe(403);
      expect((await request(`${path}/withdrawal`, { approvalInstanceId: oldId })).status).toBe(409);
      expect(await request(`${path}/withdrawal`, { approvalInstanceId: newId })).toMatchObject({ status: 201, body: { status: "draft" } });
      expect(await request(capability(newId))).toMatchObject({ status: 200, body: { available: false } });
      expect((await db.approvalInstance.findUniqueOrThrow({ where: { id: newId } })).status).toBe("withdrawn");
      expect(await db.approvalActionLog.count({ where: { approvalInstanceId: newId, action: "approve" } })).toBe(1);
      const afterWithdrawal = await request(`${path}/submission`, {});
      expect(afterWithdrawal).toMatchObject({ status: 201, body: { status: "approval_pending", companyPayableAmountCents: "8" } });
      expect(await request(path)).toMatchObject({ status: 200, body: { requestedAmountCents: "8" } });
      const finalId = afterWithdrawal.body.approvalInstanceId!;
      expect(finalId).not.toBe(newId);
      expect(await request(`/approval-progress/${newId}`)).toMatchObject({
        status: 200, body: { canHandle: false, canRemind: false, pendingRecipients: [] }
      });
      for (const roundId of [newId, finalId]) {
        expect(await request(`/approval-progress/${roundId}?view=viewable`, undefined, strangerToken))
          .toEqual({ status: 404, body: { statusCode: 404, message: "审批流程不存在或无权查看", error: "Not Found" } });
      }
      expect((await request(`${formPath}/download`, downloadInput(newId))).status).toBe(409);
      expect(await downloadAudits()).toBe(2);
      await expectPdfSignatures(finalId, 0);
      for (const reviewer of approvalTokens) {
        const input = { decision: "approve", ...await parallelReviewCoordinates(path, reviewer) };
        expect(input.approvalInstanceId).toBe(finalId);
        expect((await request(`${path}/approval`, input, reviewer)).status).toBe(201);
      }
      expect(await db.approvalActionLog.count({ where: { approvalInstanceId: finalId, action: "approve" } })).toBe(4);
      await expectPdfSignatures(finalId, 4);
      expect(await db.pdfDocument.findMany({ where: { businessId: created.body.id }, select: { approvalInstanceId: true } }))
        .toEqual([{ approvalInstanceId: finalId }]);
      expect(await downloadAudits()).toBe(4);
      expect(await db.expenseClaimPaymentExecution.count({ where: { expenseClaimId: created.body.id } })).toBe(0);
    }, 60_000
  );

  (enabled ? it.each(["reimbursement", "incidental_expense"] as const) : it.skip.each(["reimbursement", "incidental_expense"] as const))("V6 正式 PDF：%s 逐节点签名及未通过下载边界", async claimType => {
    const created = await request("/expense-claims", selfInput(applicantUserId, claimType));
    expect(created.status).toBe(201);
    const claimId = created.body.id;
    const path = "/expense-claims/" + claimId;
    const capability = "/approval-forms/expense_claim/" + claimId + "/capability";
    expect(await request(capability)).toMatchObject({ status: 200, body: { available: false } });
    expect((await request(path + "/submission", {})).status).toBe(201);
    const roles = ["comprehensive_director", "project_manager", "finance_director", "chairman"];
    const order = [2, 3, 0, 1];
    for (const index of order) {
      const approvalToken = approvalTokens[index]!;
      expect(await request(capability)).toMatchObject({ status: 200, body: { available: true, incomplete: true } });
      const input = { decision: "approve", ...await parallelReviewCoordinates(path, approvalToken) };
      if (index === 2) {
        expect((await request(path + "/approval", { decision: "approve" }, approvalToken)).status).toBe(409);
        expect((await request(path + "/approval", { ...input, approvalInstanceId: randomUUID() }, approvalToken)).status).toBe(409);
      }
      expect((await request(path + "/approval", input, approvalToken)).status).toBe(201);
      if (index === 2) expect((await request(path + "/approval", input, approvalToken)).status).toBe(409);
    }
    await verifyApprovedPdf({ db: app.get(PrismaService), baseUrl, token, password: accountPassword,
      businessType: "expense_claim", businessId: claimId, roles: order.map(index => roles[index]!), label: `费用-${claimType}` });
    expect((await request(`/approval-forms/expense_claim/${claimId}/download`, { confirmationPassword: accountPassword, downloadReason: "无关人员边界" }, strangerToken)).status).toBe(403);
  }, 60_000);

  (enabled ? it : it.skip)("历史借款审批仅可查看，拒绝签批、催办和补生成缺失原件", async () => {
    const db = app.get(PrismaService);
    const pending = await seedHistoricalLoan("draft", "合成旧借款审批");
    const frozenNodes = [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"],
      candidateUserIds: [approvalActorIds[0]!], candidateUserIdsByRole: { comprehensive_director: [approvalActorIds[0]!] } }];
    const round = await db.approvalInstance.create({ data: {
      businessType: "expense_claim", businessId: pending.id, flowType: "expense_claim.approve", status: "in_progress",
      currentNodeIndex: 0, applicantUserId, frozenNodes
    } });
    const loan = await db.expenseClaim.update({ where: { id: pending.id }, data: {
      status: "approval_pending", approvalInstanceId: round.id, submittedAt: new Date()
    } });
    const path = "/expense-claims/" + loan.id;
    const approver = approvalTokens[0]!;
    expect(await request(path, undefined, approver)).toMatchObject({
      status: 200, body: { approval: { currentNodeName: "综合部主管", canReview: false } }
    });
    for (const decision of ["approve", "reject"]) {
      expect((await request(path + "/approval", { decision, comment: "保持历史" }, approver)).status).toBe(410);
    }
    expect((await request(`/other-project-payments/${loan.id}/approval`, { decision: "approve" }, approver)).status).toBe(404);
    const progressPath = "/approval-progress/" + round.id;
    const progress = await request(progressPath, undefined, approver);
    expect(progress).toMatchObject({ status: 200, body: { canHandle: false, canRemind: false, pendingRecipients: [] } });
    expect((await request(progressPath + "/remind", {
      requestId: randomUUID(), reminderToken: (progress.body as unknown as { reminderToken: string }).reminderToken
    })).status).toBe(410);
    expect(await db.expenseClaim.findUnique({ where: { id: loan.id } })).toEqual(loan);
    expect(await db.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(round);
    expect(await db.approvalActionLog.count({ where: { approvalInstanceId: round.id } })).toBe(0);

    const approved = await seedHistoricalLoan("approved_pending_disbursement", "历史缺档借款");
    const approvedRound = await db.approvalInstance.create({ data: {
      businessType: "expense_claim", businessId: approved.id, flowType: "expense_claim.approve", status: "approved",
      currentNodeIndex: 1, applicantUserId, frozenNodes
    } });
    const pdfPath = "/approval-forms/expense_claim/" + approved.id;
    expect(await request(pdfPath + "/capability")).toMatchObject({ status: 200, body: { available: false } });
    expect((await request(pdfPath + "/download", {
      confirmationPassword: accountPassword, downloadReason: "核验历史"
    })).status).toBe(410);
    expect(await db.approvalFormGenerationClaim.count({ where: { approvalInstanceId: approvedRound.id } })).toBe(0);
    expect(await db.pdfDocument.count({ where: { approvalInstanceId: approvedRound.id } })).toBe(0);
  });

  (enabled ? it : it.skip)("历史合同附件即时回包含本人删除动作，连续删除保留上传与删除审计", async () => {
    const prisma = app.get(PrismaService);
    const owner = await selfAccount("contract_director");
    const other = await selfAccount("contract_director");
    const rootPath = `/projects/${projectId}/contract-takeovers`;
    const created = await request(rootPath, {
      code: `YS-${randomUUID()}`, name: "本地即时回包删除验收", counterparty: "合成相对方",
      contractTypeKey: "material_purchase", companyEntityId, amountCents: "100", signedAt: "2026-10-20",
      takeoverLevel: "B", takeoverLevelAdjustmentReason: "本地合成验收", lifecycleStatus: "in_progress",
      takeoverCutoffDate: "2026-10-20", responsibleUserId: owner.user.id
    }, owner.tokens.accessToken);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ lifecycleBlockers: [], availableActions: [expect.objectContaining({ key: "delete_pristine_draft", enabled: true })] });
    const path = `${rootPath}/${created.body.id}`;
    const original = await prisma.contractTakeover.findUniqueOrThrow({ where: { id: created.body.id } });
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Synthetic immediate response acceptance");
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(await pdf.save())], { type: "application/pdf" }), "本地即时回包验收.pdf");
    const uploaded = await fetch(`${baseUrl}${rootPath}/files`, { method: "POST", headers: { authorization: `Bearer ${owner.tokens.accessToken}` }, body: form });
    expect(uploaded.status).toBe(201);
    const { id: fileId } = await uploaded.json() as { id: string };
    const attached = await request(`${path}/evidence-files`, { fileId, purpose: "historical_contract_scan" }, owner.tokens.accessToken);
    expect(attached).toMatchObject({ status: 201, body: {
      lifecycleKind: "pristine_draft", lifecycleBlockers: [],
      availableActions: [expect.objectContaining({ key: "delete_pristine_draft", enabled: true, disabledReason: null })],
      evidenceFiles: [expect.objectContaining({ fileId })]
    } });
    const deletion = { expectedUpdatedAt: (attached.body as unknown as { updatedAt: string }).updatedAt, action: "delete_pristine_draft" };
    expect((await request(`${path}/abandonment`, deletion, other.tokens.accessToken)).status).toBe(403);
    expect((await request(`${path}/abandonment`, { ...deletion, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }, owner.tokens.accessToken)).status).toBe(409);
    const beforeAudits = await prisma.auditLog.findMany({ where: { businessId: created.body.id }, orderBy: { id: "asc" } });
    expect((await request(`${path}/abandonment`, deletion, owner.tokens.accessToken)).status).toBe(201);
    expect((await request(path, undefined, owner.tokens.accessToken)).status).toBe(404);
    expect(await prisma.contract.count({ where: { id: original.contractId } })).toBe(0);
    expect(await prisma.approvalInstance.count({ where: { businessId: created.body.id } })).toBe(0);
    expect(await prisma.archiveRecord.count({ where: { businessId: created.body.id } })).toBe(0);
    expect(await prisma.auditLog.findMany({ where: { id: { in: beforeAudits.map(row => row.id) } }, orderBy: { id: "asc" } })).toEqual(beforeAudits);
    const attachments = beforeAudits.filter(row => row.action === "contract_takeover.evidence.attach");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ actorUserId: owner.user.id, metadata: { projectId, fileId, purpose: "historical_contract_scan" } });
    const audits = await prisma.auditLog.findMany({ where: { businessId: created.body.id, action: "contract_takeover.draft.delete" } });
    expect(audits).toHaveLength(1);
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    expect(audits[0]).toMatchObject({ actorUserId: owner.user.id, metadata: { projectId, previousStatus: "draft", files: [{ id: fileId, name: file.originalName, contentSha256: file.contentSha256, sizeBytes: file.sizeBytes }] } });
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain(file.objectKey);
  });

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
            ? procurementInput(reason)
            : { ...selfInput(applicantUserId, "incidental_expense"), reason };
        const created = await request(rootPath, input, session.tokens.accessToken);
        expect(created).toMatchObject({ status: 201, body: { id: expect.any(String) } });
        const id = created.body.id;
        let fileId: string | null = null;
        if (kind === "incidental_expense") {
          const form = new FormData();
          form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "本地合成删除凭证.png");
          const upload = await fetch(`${baseUrl}${rootPath}/${id}/draft-attachment-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body: form });
          expect(upload.status).toBe(201);
          fileId = ((await upload.json()) as { id: string }).id;
          expect((await request(`${rootPath}/${id}/attachments`, { fileId, category: "other" }, session.tokens.accessToken)).status).toBe(201);
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
    const activeProjects = await app.get(PrismaService).project.findMany({
      where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true }
    });
    expect(activeProjects.map(project => project.id)).toEqual(expect.arrayContaining([projectId, ...Object.values(browserRepaymentProjectIds)]));
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Local synthetic takeover deletion acceptance");
    const pdfBase64 = Buffer.from(await pdf.save()).toString("base64");
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        POL115_API_URL: baseUrl,
        POL115_DELETION_PDF_BASE64: pdfBase64,
        POL115_DELETION_FIXTURES: JSON.stringify(deletionFixtures.map(({ viewport, kind, id, path, rootPath, session }) => ({ viewport, kind, id, path, rootPath, session }))),
        POL115_BROWSER_SESSION: JSON.stringify(browserSession),
        POL115_FINANCE_SESSION: JSON.stringify(financeSession),
        POL115_FINANCE_PROJECT_LABELS: JSON.stringify(activeProjects.map(project => `${project.code} · ${project.name}`)),
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
        const { id, kind, history, session, beforeAudits } = fixture;
        let fileId = fixture.fileId;
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
          const uploads = await prisma.auditLog.findMany({ where: { businessId: id, action: "contract_takeover.evidence.attach" } });
          expect(uploads).toHaveLength(1);
          expect(uploads[0]).toMatchObject({ actorUserId: session.user.id, businessType: "contract_takeover" });
          expect(uploads[0]!.metadata).toMatchObject({ projectId, purpose: "historical_contract_scan" });
          fileId = (uploads[0]!.metadata as { fileId: string }).fileId;
          expect(fileId).toBeTruthy();
          expect(await prisma.contractTakeover.count({ where: { id } })).toBe(0);
          expect(await prisma.contract.count({ where: { id: history.contractId } })).toBe(0);
          expect(await prisma.contractVersion.count({ where: { id: history.contractVersionId } })).toBe(0);
          expect(await prisma.paymentTermsVersion.count({ where: { id: history.paymentTermsVersionId } })).toBe(0);
          expect(await prisma.archiveRecord.count({ where: { businessId: id } })).toBe(0);
          expect(audit[0]!.metadata).toMatchObject({ contractId: history.contractId, contractVersionId: history.contractVersionId });
        } else {
          expect(await prisma.generalProcurement.count({ where: { id } })).toBe(0);
          expect(audit[0]!.metadata).toMatchObject({ companyEntityId, requestedAmountCents: null, revision: 1, applicantUserId: session.user.id });
        }
        if (fileId) {
          const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
          expect(audit[0]!.metadata).toMatchObject({ files: [{ id: fileId, contentSha256: file.contentSha256, sizeBytes: file.sizeBytes, name: file.originalName }] });
          expect(JSON.stringify(audit[0]!.metadata)).not.toContain(file.objectKey);
        }
      }
    }
  }, 180_000);

  (enabled ? it : it.skip)("员工借款拒绝新建和重提，仍按原权限读取历史冻结事实", async () => {
    const legacyInput = { claimType: "loan", companyEntityId, projectId, applicantUserId, reason: "现场备用金", requestedAmountCents: "12500", loanExpectedClearanceOn: "2026-12-01" };
    expect((await request("/expense-claims", legacyInput)).status).toBe(410);
    const historical = await seedHistoricalLoan("draft", legacyInput.reason, projectId, 12500n);
    const path = "/expense-claims/" + historical.id;
    const db = app.get(PrismaService);
    const snapshot = {
      claimType: "loan", reason: "现场备用金", requestedAmountCents: "12500", requestedAmountYuan: "125.00", loanExpectedClearanceOn: "2026-12-01"
    };
    const definition = { key: "expense_claim.application", fields: [{ key: "loanExpectedClearanceOn", label: "预计清账日期", type: "date" }] };
    await db.expenseClaimEntrySnapshot.create({ data: {
      expenseClaimId: historical.id, operationObjectId: historical.id, operationObjectType: "expense_claim",
      sceneKey: "expense_claim.application", businessAction: "expense_claim.submit", submissionRevision: "historical",
      definitionVersion: 1, definitionSnapshot: definition, valuesSnapshot: snapshot, frozenByUserId: applicantUserId
    } });
    await db.expenseClaim.update({ where: { id: historical.id }, data: { submittedAt: new Date() } });
    expect(await request(path)).toMatchObject({ status: 200, body: {
      claimType: "loan", canEditReturnedDraft: false, canDeleteDraft: false, entrySnapshots: [expect.objectContaining({ valuesSnapshot: snapshot, definitionSnapshot: definition })]
    } });
    expect((await request(path, undefined, strangerToken)).status).toBe(404);
    const capability = await request(path + "/capability");
    expect(capability.status).toBe(200);
    const { availableActions } = capability.body as unknown as { availableActions: string[] };
    for (const action of ["submit_expense_claim", "attach_expense_claim_attachment", "remove_expense_claim_attachment", "delete_expense_claim_draft"]) {
      expect(availableActions).not.toContain(action);
    }
    const form = new FormData();
    form.append("file", new Blob(["synthetic PDF"], { type: "application/pdf" }), "合成旧附件.pdf");
    const upload = await fetch(baseUrl + path + "/draft-attachment-file-uploads", {
      method: "POST", headers: { authorization: "Bearer " + token }, body: form
    });
    expect(upload.status).toBe(403);
    expect((await request(path + "/submission", {})).status).toBe(410);
    expect((await request(path + "/draft", { reason: "旧借款修订", expectedUpdatedAt: historical.updatedAt.toISOString() }, token, "PATCH")).status).toBe(410);
    expect(await db.expenseClaimEntrySnapshot.count({ where: { expenseClaimId: historical.id } })).toBe(1);
    expect(await db.approvalInstance.count({ where: { businessType: "expense_claim", businessId: historical.id } })).toBe(0);
  });

  (enabled ? it : it.skip)("填写选项提供与提交快照相同的统一字段定义，非项目报销不借用个人资料授权", async () => {
    const options = await request("/expense-claims/create-options");
    expect(options.status).toBe(200);
    expect(options.body.entryDefinition).toMatchObject({ key: "expense_claim.application", version: 1 });
    const created = await request("/expense-claims", { claimType: "reimbursement", companyEntityId, applicantUserId, reason: "办公室交通", requestedAmountCents: "3500", lines: [{ expenseCategory: "交通费", occurredOn: "2026-09-16", purpose: "办理公司事务", receiptCount: 0, amountCents: "3500", evidenceType: "none", noEvidenceReason: "公共交通无纸质凭证" }] });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(path)).body.entrySnapshots).toEqual([]);
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    const detail = await request(path);
    expect(detail.body.entrySnapshots).toHaveLength(1);
    expect(detail.body.entrySnapshots[0]!.definitionSnapshot).toEqual(options.body.entryDefinition);
    expect(detail.body.entrySnapshots[0]!.valuesSnapshot).toMatchObject({ projectId: null, claimType: "reimbursement", companyPayableAmountCents: "3500", lines: [{ expenseCategory: "交通费", amountCents: "3500", noEvidenceReason: "公共交通无纸质凭证" }] });
    const companyDuties = await Promise.all([0, 2, 3].map(index => parallelReviewCoordinates(path, approvalTokens[index]!)));
    expect(companyDuties.map(item => item.approvalDutyIndex)).toEqual([0, 1, 2]);
    expect(new Set(companyDuties.map(item => item.approvalInstanceId)).size).toBe(1);
    for (const index of [2, 1, 0]) {
      const duty = companyDuties[index]!;
      const reviewerToken = approvalTokens[[0, 2, 3][index]!]!;
      expect((await request(`${path}/approval`, { decision: "approve", ...duty }, reviewerToken)).status).toBe(201);
    }
    expect(await request(path)).toMatchObject({ status: 200, body: { status: "approved_pending_payment" } });
    expect((await request(path, undefined, strangerToken)).status).toBe(404);
    const illegalLoan = await request("/expense-claims", { claimType: "loan", companyEntityId, applicantUserId, factWitnessUserId, reason: "无项目借款", requestedAmountCents: "100" });
    expect(illegalLoan.status).toBe(410);
  }, 60_000);

  (enabled ? it : it.skip)("在途纯报销缺岗不跳过，到岗接续同一并联轮次", async () => {
    const db = app.get(PrismaService);
    const project = await db.project.create({ data: { code: `REIM-NO-PM-${randomUUID()}`, name: "报销审批补位合成项目" } });
    await db.projectRosterMember.create({ data: { projectId: project.id, userId: applicantUserId } });
    const created = await request("/expense-claims", { ...selfInput(applicantUserId, "reimbursement"), projectId: project.id });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect(await request(`${path}/submission`, {})).toMatchObject({ status: 201, body: { status: "approval_pending" } });
    const finance = await parallelReviewCoordinates(path, approvalTokens[2]!);
    expect((await request(`${path}/approval`, { decision: "approve", ...finance, approvalDutyIndex: 1 }, approvalTokens[2]!)).status).toBe(403);
    expect(await request(`${path}/approval`, { decision: "approve", ...finance }, approvalTokens[2]!)).toMatchObject({
      status: 201, body: { status: "approval_pending" }
    });
    const assignedManager = await selfAccount("project_manager", project.id);
    const managerDuty = await parallelReviewCoordinates(path, assignedManager.tokens.accessToken);
    expect(managerDuty).toEqual({ approvalInstanceId: finance.approvalInstanceId, approvalDutyIndex: 1 });
    const initial = await db.auditLog.findMany({
      where: { businessId: created.body.id, businessType: "expense_claim_approval_duty_notification", action: "queued" }
    });
    expect(initial.map(row => (row.metadata as { approvalDutyIndex: number }).approvalDutyIndex)).not.toContain(1);
    const notices = app.get(ExpenseClaimFundingNotificationService);
    await notices.reconcilePendingApprovalDuties();
    await notices.reconcilePendingApprovalDuties();
    const queued = await db.auditLog.findMany({
      where: { businessId: created.body.id, businessType: "expense_claim_approval_duty_notification", action: "queued" }
    });
    expect(queued.filter(row => (row.metadata as { approvalDutyIndex: number }).approvalDutyIndex === 1)).toEqual([
      expect.objectContaining({ metadata: {
        recipientId: assignedManager.user.id, approvalInstanceId: finance.approvalInstanceId, approvalDutyIndex: 1
      } })
    ]);
    const signature = new FormData();
    signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "项目经理签名.png");
    const signed = await fetch(`${baseUrl}/me/signature/canvas`, {
      method: "POST", headers: { authorization: `Bearer ${assignedManager.tokens.accessToken}` }, body: signature
    });
    expect(signed.status).toBe(201);
    expect(await request(`${path}/approval`, { decision: "approve", ...managerDuty }, assignedManager.tokens.accessToken)).toMatchObject({
      status: 201, body: { status: "approval_pending" }
    });
  });

  (enabled ? it.each : it.skip.each)([
    { label: "已签项目报销", claimType: "reimbursement", linked: false, signed: true },
    { label: "独立零星费用", claimType: "incidental_expense", linked: false, signed: false },
    { label: "已签综合采购付款", claimType: "incidental_expense", linked: true, signed: true }
  ] as const)("在途费用并联接续：$label", async ({ label, claimType, linked, signed }) => {
    const db = app.get(PrismaService);
    const owner = linked ? proxySession : browserSession;
    const accessToken = owner.tokens.accessToken;
    const archive = linked ? await db.fileObject.create({
      data: { bucket: "isolated", objectKey: `legacy-expense-${randomUUID()}`, originalName: "合成采购归档.pdf",
        mimeType: "application/pdf", sizeBytes: 1, uploadedByUserId: owner.user.id, storageStatus: "active" }
    }) : null;
    const procurement = archive ? await db.generalProcurement.create({
      data: {
        code: `LEGACY-${randomUUID()}`, requestKey: randomUUID(), creationFingerprint: "b".repeat(64),
        projectId, companyEntityId, companyNameSnapshot: "入口合成公司", applicantUserId: owner.user.id,
        applicantNameSnapshot: owner.user.name, category: "office_supplies", reason: "历史综合采购原单",
        requestedAmountCents: 500n, requestProtocolVersion: 1, status: "archived", revision: 6,
        archivedAt: new Date(), archivedByUserId: owner.user.id, archiveNote: "历史采购合成归档", archiveFileId: archive.id
      }
    }) : null;
    const draft = await request("/expense-claims", {
      ...selfInput(owner.user.id, claimType),
      ...(procurement ? {
        generalProcurementId: procurement.id, generalProcurementRequestKey: randomUUID(),
        incidentalExpenseCategory: "procurement_office_supplies"
      } : {})
    }, accessToken);
    expect(draft.status).toBe(201);

    const claimId = draft.body.id;
    const path = `/expense-claims/${claimId}`;
    const roles = ["comprehensive_director", "project_manager", "finance_director", "chairman"];
    const names = ["综合部主管", "项目经理", "财务主管", "董事长/总经理"];
    const original = await db.approvalInstance.create({
      data: {
        flowType: "expense_claim.approve", businessType: "expense_claim", businessId: claimId,
        status: "in_progress", currentNodeIndex: 0, applicantUserId: owner.user.id,
        frozenNodes: roles.map((role, index) => ({
          name: names[index], mode: "any", roleKeys: [role], candidateUserIds: [approvalActorIds[index]],
          candidateUserIdsByRole: { [role]: [approvalActorIds[index]] }
        }))
      }
    });
    await db.expenseClaim.update({ where: { id: claimId }, data: {
      status: "approval_pending", approvalInstanceId: original.id, submittedAt: new Date(), companyPayableAmountCents: 1n
    } });
    if (signed) {
      expect(await request(`${path}/approval`, {
        decision: "approve", ...(linked ? { selfReviewReason: "核对原来办理的采购付款", confirmationPassword: accountPassword } : {})
      }, approvalTokens[0]!)).toMatchObject({ status: 201, body: { status: "approval_pending" } });
    }
    const before = await db.expenseClaim.findUniqueOrThrow({ where: { id: claimId } });
    const round = await db.approvalInstance.findUniqueOrThrow({ where: { id: original.id } });
    const oldActions = await db.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } });
    expect(oldActions).toHaveLength(signed ? 1 : 0);
    const beforeFreeze = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    const beforeModules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    const coordinates = { approvalInstanceId: round.id, claimUpdatedAt: before.updatedAt, approvalUpdatedAt: round.updatedAt };
    try {
      process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
      process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "expense";
      expect((await request(`${path}/approval`, { decision: "approve" }, approvalTokens[2]!)).status).toBe(503);
      const service = app.get(ExpenseClaimService);
      await expect(service.migrateLegacyApprovalRound(claimId, owner.user.id, {
        ...coordinates, approvalUpdatedAt: new Date(0)
      })).rejects.toThrow("已变化");
      await expect(service.migrateLegacyApprovalRound(claimId, owner.user.id, coordinates)).resolves.toEqual({
        status: "mapped", pendingNodeIndexes: signed ? [1, 2, 3] : [0, 1, 2, 3]
      });
      await expect(service.migrateLegacyApprovalRound(claimId, owner.user.id, coordinates)).resolves.toEqual({ status: "already_mapped" });
    } finally {
      if (beforeFreeze === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
      else process.env.OPERATIONAL_WRITE_FREEZE_MODE = beforeFreeze;
      if (beforeModules === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
      else process.env.OPERATIONAL_WRITE_FREEZE_MODULES = beforeModules;
    }
    expect(await db.expenseClaim.findUniqueOrThrow({ where: { id: claimId } })).toEqual(before);
    expect(await db.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } })).toEqual(oldActions);
    const noticeRows = await db.auditLog.findMany({ where: {
      businessId: claimId, businessType: "expense_claim_approval_duty_notification", action: "queued"
    } });
    expect(noticeRows.map(row => (row.metadata as { approvalDutyIndex: number }).approvalDutyIndex).sort()).toEqual(
      signed ? [1, 2, 3] : [0, 1, 2, 3]
    );
    const financeDuty = await parallelReviewCoordinates(path, approvalTokens[2]!);
    expect(financeDuty).toEqual({ approvalInstanceId: round.id, approvalDutyIndex: 2 });
    expect(await request("/me/work-items", undefined, approvalTokens[2]!)).toMatchObject({
      status: 200, body: { approvalCenter: { pendingApproval: expect.arrayContaining([
        expect.objectContaining({ businessId: claimId, currentNode: "财务主管" })
      ]) } }
    });
    expect((await request(`${path}/approval`, { decision: "approve", ...financeDuty }, strangerToken)).status).toBe(403);
    expect(await db.auditLog.count({ where: { businessId: claimId, action: "expense_claim.approval.legacy_cutover" } })).toBe(1);
    const order = signed ? [2, 3, 1] : [2, 3, 1, 0];
    for (const index of order) {
      expect(await request(`${path}/approval`, {
        decision: "approve", approvalInstanceId: round.id, approvalDutyIndex: index
      }, approvalTokens[index]!)).toMatchObject({ status: 201, body: {
        status: index === order.at(-1) ? "approved_pending_payment" : "approval_pending"
      } });
      if (index === 2) {
        expect((await request(`${path}/approval`, { decision: "approve", ...financeDuty }, approvalTokens[2]!)).status).toBe(409);
      }
    }
    expect(await db.approvalInstance.count({ where: { businessType: "expense_claim", businessId: claimId } })).toBe(1);
    expect(await db.approvalActionLog.findMany({ where: { id: { in: oldActions.map(action => action.id) } } })).toEqual(oldActions);
    expect(await db.expenseClaimPaymentExecution.count({ where: { expenseClaimId: claimId } })).toBe(0);
    await verifyApprovedPdf({ db, baseUrl, token: accessToken, password: accountPassword, businessType: "expense_claim",
      businessId: claimId, roles: [...(signed ? [roles[0]!] : []), ...order.map(index => roles[index]!)], label
    });
  }, 60_000);

  (enabled ? it : it.skip)("不具项目归属时提交失败，原草稿与空快照可继续回读", async () => {
    const db = app.get(PrismaService);
    const project = await db.project.create({ data: { code: `NO-PM-${randomUUID()}`, name: "尚未配置审批岗位的项目" } });
    await db.projectMember.create({ data: { projectId: project.id, userId: applicantUserId, positionKey: "employee" } });
    const created = await request("/expense-claims", { ...selfInput(applicantUserId), projectId: project.id, reason: "审批配置失败回读", requestedAmountCents: "1200" });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    await db.projectMember.deleteMany({ where: { projectId: project.id, userId: applicantUserId } });
    expect((await request(path + "/submission", {})).status).toBe(403);
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
    const created = await request("/expense-claims", { ...selfInput(applicantUserId), reason: "精确金额回显", requestedAmountCents: cents });
    expect(created.status).toBe(201);
    const path = `/expense-claims/${created.body.id}`;
    expect((await request(`${path}/submission`, {})).status).toBe(201);
    const snapshot = (await request(path)).body.entrySnapshots[0]!;
    expect(snapshot.valuesSnapshot).toMatchObject({ requestedAmountCents: cents, requestedAmountYuan: yuan });
  }, 60_000);

  (enabled ? it.each : it.skip.each)(["", "1.1", "9223372036854775808"])("非法或超大分金额%s仍由原HTTP校验拒绝", async (requestedAmountCents) => {
    expect((await request("/expense-claims", { ...selfInput(applicantUserId), reason: "无效金额", requestedAmountCents })).status).toBe(400);
  });
});
