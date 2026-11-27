import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import * as ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const enabled = process.env.RUN_A01_EXPENSE_PRECISION_PG16 === "1";
const testIfEnabled = enabled ? it : it.skip;

const line = {
  expenseCategory: "办公费",
  occurredOn: "2026-10-16",
  purpose: "合成文具",
  receiptCount: 0,
  evidenceType: "none",
  noEvidenceReason: "隔离测试"
};

describe("A01 报销四位金额真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let baseUrl: string;
  let token: string;
  let projectId: string;
  let companyEntityId: string;
  let applicantUserId: string;
  let factWitnessUserId: string;
  let financeToken: string;
  let financeDirectorToken: string;
  let accountPassword: string;
  const approvalTokens: string[] = [];

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    const database = process.env.JG_A01_EXPENSE_PRECISION_DATABASE;
    if (process.env.NODE_ENV !== "test" || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
        || url.username !== "jg_task01_owner" || !/^jg_task01_[a-f0-9]{32}$/u.test(database ?? "")
        || url.pathname !== "/" + database || url.searchParams.getAll("sslmode").join(",") !== "require"
        || url.searchParams.getAll("sslaccept").join(",") !== "strict"
        || !url.searchParams.getAll("sslcert").join(",")) {
      throw new Error("A01 报销金额测试只允许本机隔离 PostgreSQL 数据库");
    }

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);

    accountPassword = randomUUID();
    const suffix = randomUUID();
    const passwordHash = await hash(accountPassword, 4);
    const actor = await prisma.user.create({ data: {
      name: "报销申请人", phone: `a01-expense-${suffix}`, passwordHash, mustChangePassword: false
    } });
    applicantUserId = actor.id;
    projectId = (await prisma.project.create({ data: { code: `A01-${suffix}`, name: "四位报销合成项目" } })).id;
    const constructionEnterprise = await prisma.businessParty.create({ data: {
      name: "合成施工企业", normalizedName: `a01-construction-${suffix}`,
      unifiedSocialCreditCode: `POL115${suffix.replaceAll("-", "").slice(0, 12)}`, createdByUserId: actor.id
    } });
    const constructionEnterpriseVersion = await prisma.businessPartyVersion.create({ data: {
      businessPartyId: constructionEnterprise.id,
      versionNo: 1,
      snapshot: { name: constructionEnterprise.name, unifiedSocialCreditCode: constructionEnterprise.unifiedSocialCreditCode },
      createdByUserId: actor.id
    } });
    await prisma.projectAffiliateAssignment.create({ data: {
      projectId, businessPartyId: constructionEnterprise.id, businessPartyVersionId: constructionEnterpriseVersion.id,
      affiliateNameSnapshot: constructionEnterprise.name, affiliateCreditCodeSnapshot: constructionEnterprise.unifiedSocialCreditCode,
      effectiveFrom: new Date("2026-01-01"), changeReason: "合成项目主数据", assignedByUserId: actor.id
    } });
    companyEntityId = (await prisma.companyEntity.create({ data: { name: "四位报销合成公司", dataStatus: "complete" } })).id;

    for (const key of ["employee", "comprehensive_director", "project_manager", "finance_director", "chairman", "finance_staff"]) {
      const position = await prisma.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
      const person = key === "employee" ? actor : await prisma.user.create({ data: {
        name: `审批岗位${key}`, phone: `a01-expense-${key}-${suffix}`, passwordHash, mustChangePassword: false
      } });
      await prisma.userPosition.create({ data: {
        userId: person.id, positionId: position.id, projectId: key === "employee" || key === "project_manager" ? projectId : null
      } });
      const login = await fetch(baseUrl + "/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: person.phone, password: accountPassword })
      });
      expect(login.status).toBe(201);
      const { tokens: { accessToken } } = await login.json() as { tokens: { accessToken: string } };
      if (key === "employee") {
        token = accessToken;
        continue;
      }
      if (key === "finance_staff") {
        financeToken = accessToken;
        continue;
      }
      if (key === "comprehensive_director") factWitnessUserId = person.id;
      if (key === "finance_director") financeDirectorToken = accessToken;
      approvalTokens.push(accessToken);
      const signatureBody = new FormData();
      signatureBody.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")],
        { type: "image/png" }), `合成签名-${key}.png`);
      const signature = await fetch(baseUrl + "/me/signature/canvas", {
        method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: signatureBody
      });
      expect(signature.status).toBe(201);
    }
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function request(path: string, body?: unknown, accessToken = token, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(baseUrl + path, {
      method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as {
      id: string;
      updatedAt: string;
      approvalInstanceId: string | null;
      approval?: { approvalInstanceId?: string; actionableDuties?: Array<{ index: number }> } | null;
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

  function reimbursementInput() {
    return { claimType: "reimbursement", companyEntityId, projectId, applicantUserId, reason: "合成本人费用申请" };
  }

  testIfEnabled("报销四位元金额按明细精确求和、仅在付款总额取整", async () => {
    const claim = reimbursementInput();
    const exact = (amount: string) => ({ ...line, amountYuan: amount });
    const reason = "四位金额验收";
    const path = "/expense-claims";
    const countBefore = await prisma.expenseClaim.count({ where: { reason } });
    for (const invalid of ["", "0", "-0.0001", "0.00501", "1e2", "92233720368547758.0750", "100000000000000000000.0000"]) {
      expect((await request(path, { ...claim, reason, requestedAmountYuan: invalid, lines: [exact(invalid)] })).status).toBe(400);
    }
    expect((await request(path, { ...claim, reason, requestedAmountYuan: "0.0101", lines: [exact("0.005"), exact("0.005")] })).status).toBe(400);
    expect((await request(path, { ...claim, reason, requestedAmountYuan: "92233720368547758.0800", lines: [exact("92233720368547758.0700"), exact("0.0100")] })).status).toBe(400);
    for (const quantity of ["0", "00.0000", "-1", "1.23456", "1e2", "100000000000000000000"]) {
      const invalidLine = { ...exact("0.0100"), quantity };
      expect((await request(path, { ...claim, reason, requestedAmountYuan: "0.0100", lines: [invalidLine] })).status).toBe(400);
    }
    expect(await prisma.expenseClaim.count({ where: { reason } })).toBe(countBefore);

    const created = await request(path, { ...claim, reason, requestedAmountYuan: "0.0100", lines: [exact("0.005"), { ...exact("0.005"), quantity: "0002.0001" }] });
    expect(created).toMatchObject({ status: 201, body: { requestedAmountYuan: "0.0100", requestedAmountCents: "1", numericProtocolVersion: 2 } });
    const detailPath = path + "/" + created.body.id;
    expect(await request(detailPath)).toMatchObject({ status: 200, body: {
      requestedAmountYuan: "0.0100", requestedAmountCents: "1",
      lines: [{ amountYuan: "0.0050", amountCents: "1", quantity: null }, { amountYuan: "0.0050", amountCents: "0", quantity: "2.0001" }]
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
    expect((await request(detailPath + "/draft", { expectedUpdatedAt: refreshed.body.updatedAt, reason, lines: [{ ...line, amountCents: "1" }] }, token, "PATCH")).status).toBe(400);
    const replacement = await request(detailPath + "/draft", {
      expectedUpdatedAt: refreshed.body.updatedAt, reason, lines: [exact("0.0001"), exact("0.0100")]
    }, token, "PATCH");
    expect(replacement).toMatchObject({ status: 200, body: { requestedAmountYuan: "0.0101", requestedAmountCents: "1" } });
    expect(await request(detailPath)).toMatchObject({ status: 200, body: {
      requestedAmountYuan: "0.0101", lines: [{ amountYuan: "0.0001", amountCents: "0" }, { amountYuan: "0.0100", amountCents: "1" }]
    } });
  }, 45_000);

  testIfEnabled("报销四位元金额终审保留项目成本并分开整数分待付", async () => {
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

    const claim = reimbursementInput();
    let cashExpenseCode: string | null = null;
    for (const scenario of [
      { exact: "12.3400", payable: "1234", amounts: ["12.3400"], status: "approved_pending_payment", costBearingCompanyEntityId: company.id },
      { exact: "0.0100", payable: "1", amounts: ["0.0050", "0.0050"], status: "approved_pending_payment", costBearingCompanyEntityId: company.id },
      { exact: "100.0050", payable: "10001", amounts: ["100.0050"], status: "approved_pending_payment", costBearingCompanyEntityId: company.id },
      { exact: "12.3456", payable: "1235", amounts: ["12.3456"], status: "approved_pending_payment", costBearingCompanyEntityId: null },
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
      expect(fact.costBearingCompanySubjectId).toBe(scenario.costBearingCompanyEntityId);
      const costs = fact.impacts.filter(impact => impact.impactKind === "confirmed_cost");
      const payables = fact.impacts.filter(impact => impact.impactKind === "payable_increase");
      if (scenario.exact === "12.3400") {
        expect(fact).toMatchObject({ numericProtocolVersion: 1, amountCents: 1234n, amountYuan: null });
        expect(costs).toMatchObject([{ numericProtocolVersion: 1, amountCents: 1234n }]);
        expect(payables).toMatchObject([{ numericProtocolVersion: 1, amountCents: 1234n }]);
      } else {
        expect(fact).toMatchObject({ numericProtocolVersion: 2, amountCents: null });
        expect(fact.amountYuan?.toFixed(4)).toBe(scenario.exact);
        expect(costs.map(impact => impact.amountYuan?.toFixed(4))).toEqual(scenario.amounts);
        expect(payables.map(impact => impact.amountYuan?.toFixed(4))).toEqual(scenario.payable === "0" ? [] : scenario.payable === "1" ? ["0.0100"] : scenario.payable === "1235" ? ["12.3500"] : ["100.0100"]);
      }
      expect(await prisma.expenseClaimPaymentExecution.count({ where: { expenseClaimId: created.body.id } })).toBe(0);
      if (scenario.exact === "12.3456") {
        cashExpenseCode = fact.sourceBusinessCode;
        const keeperId = factWitnessUserId;
        const keeperToken = approvalTokens[0]!;
        const cash = await prisma.registeredFundAccount.create({ data: { kind: "public_cash", scopeKey: "public_cash" } });
        const opening = await prisma.fundAccountBalanceRegistration.create({ data: {
          accountId: cash.id, version: 1, kind: "opening", status: "confirmed", balanceYuan: "30.0000",
          asOfDate: "2026-11-01", evidenceReference: "合成原始盘点记录", reconciliationNote: "已核对", reason: "隔离期初",
          idempotencyKey: randomUUID(), payloadFingerprint: "c".repeat(64), createdByUserId: keeperId,
          confirmedByUserId: keeperId, confirmedAt: effectiveFrom,
          sources: { create: [{ lineNo: 1, amountYuan: "30.0000", sourceStatus: "known",
            sourceName: "合成出资来源", projectStatus: "pending" }] }
        }, include: { sources: true } });
        expect(await request("/public-cash-handovers/initial-custodian", { expectedRevision: 0, idempotencyKey: randomUUID() }, keeperToken))
          .toMatchObject({ status: 201, body: { custodianId: keeperId } });
        const costImpactId = costs[0]!.id;
        expect(await request(path, undefined, keeperToken)).toMatchObject({ status: 200, body: {
          cashCostAllocationOptions: [{ costImpactId, availableAmountCents: "1234" }]
        } });
        const voucher = new FormData();
        voucher.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")],
          { type: "image/png" }), "合成公共现金凭证.png");
        voucher.append("idempotencyKey", randomUUID());
        const upload = await fetch(baseUrl + path + "/payment-voucher-file-uploads?scopeKey=public_cash", {
          method: "POST", headers: { authorization: `Bearer ${keeperToken}` }, body: voucher
        });
        expect(upload.status).toBe(201);
        const { id: voucherFileId } = await upload.json() as { id: string };
        const pay = (costCents: string) => request(path + "/payments", {
          amountCents: "1235", paidAt: "2026-11-26", paymentMethod: "现金", confirmationPassword: accountPassword, voucherFileId,
          registeredFunding: { scopeKey: "public_cash", expectedRegistrationId: opening.id,
            sourceAllocations: [{ sourceBatchId: opening.sources[0]!.id, amountCents: "1235" }],
            costAllocations: [{ costImpactId, amountCents: costCents }] }
        }, keeperToken);
        expect((await pay("1235")).status).toBe(409);
        expect(await prisma.expenseClaimPaymentExecution.count({ where: { expenseClaimId: created.body.id } })).toBe(0);
        expect(await prisma.expensePublicCashCostLink.count({ where: { costImpactId } })).toBe(0);
        const paid = await pay("1234");
        if (paid.status !== 201) throw new Error(`四位报销现金实付 ${paid.status} ${JSON.stringify(paid.body)}`);
        expect(paid.body).toMatchObject({ status: "paid", paidAmountCents: "1235", registeredFunding: { actualPayerKind: "public_cash" } });
        const link = await prisma.expensePublicCashCostLink.findFirstOrThrow({ where: { costImpactId } });
        expect(link.amountCents).toBe(1234n);
        const attributionPath = `/projects/${projectId}/cost-attributions`;
        const attribution = await request(attributionPath + "/" + fact.id, {
          companyEntityId, reason: "归属已核对", idempotencyKey: randomUUID(), expenseCashCostLinkId: link.id
        }, financeToken);
        expect(attribution).toMatchObject({ status: 201, body: { status: "pending_review", attributedAmountCents: "1234" } });
        const { revision } = attribution.body as unknown as { revision: number };
        expect(await request(attributionPath + "/" + attribution.body.id + "/review", {
          decision: "confirm", revision, reason: "复核通过"
        }, financeDirectorToken)).toMatchObject({ status: 201, body: { status: "confirmed", attributedAmountCents: "1234" } });
      }
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

    const projectionPath = `/operating-projections/project/${projectId}`;
    const projection = await request(projectionPath + "?numericProtocolVersion=2", undefined, financeToken);
    expect(projection).toMatchObject({ status: 200, body: {
      schema: "operating_projection/V2",
      operating: { confirmedCostCents: null, confirmedCostYuan: "124.7007", payableCents: "1235" },
      costAttribution: { unattributedCostCents: null, unattributedCostYuan: "0.0057", publicCashCostCents: "1234" }
    } });
    const detailQuery = "/details?numericProtocolVersion=2&sourceType=expense_claim_approval";
    const detail = await request(projectionPath + detailQuery, undefined, financeToken);
    expect(detail.status).toBe(200);
    type DetailLine = { numericProtocolVersion?: 1 | 2; sourceBusinessCode: string; signedImpactYuan?: string; signedImpactCents: string | null };
    const rows = (detail.body as unknown as { items: DetailLine[] }).items;
    const preciseAmounts = rows.filter(item => item.numericProtocolVersion === 2).map(item => item.signedImpactYuan);
    expect(preciseAmounts.sort()).toEqual(
      ["0.0001", "0.0050", "0.0050", "0.0100", "12.3456", "12.3500", "100.0050", "100.0100"].sort()
    );
    expect(rows.filter(item => item.numericProtocolVersion !== 2).map(item => item.signedImpactCents)).toEqual(["1234", "1234"]);
    expect(cashExpenseCode).not.toBeNull();
    const companyDetail = await request(projectionPath + detailQuery +
      `&companyEntityId=${companyEntityId}&costCategoryCode=project_daily_expense`, undefined, financeToken);
    expect(companyDetail.status).toBe(200);
    expect((companyDetail.body as unknown as { items: DetailLine[] }).items.filter(row => row.sourceBusinessCode === cashExpenseCode))
      .toMatchObject([{ signedImpactCents: null, signedImpactYuan: "12.3400" }]);
    const exportResponse = await fetch(baseUrl + "/operating-projections/export", {
      method: "POST", headers: { authorization: `Bearer ${financeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ numericProtocolVersion: "2", scopeKind: "project", projectId,
        sourceType: "expense_claim_approval", confirmationPassword: accountPassword, exportKind: "project_operating_ledger_detail" })
    });
    expect(exportResponse.ok).toBe(true);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    const csv = await exportResponse.text();
    for (const amount of ["0.0001", "0.0050", "12.3456", "100.0050"]) expect(csv).toContain(`"${amount}"`);
  }, 60_000);
});
