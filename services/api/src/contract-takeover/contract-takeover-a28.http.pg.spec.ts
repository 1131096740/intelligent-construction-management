import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const enabled = process.env.RUN_CONTRACT_TAKEOVER_A28_PG16 === "1";
const roles = ["contract_staff", "finance_staff", "finance_director", "contract_director"] as const;
type Role = (typeof roles)[number];
type Actor = { id: string; token: string };
type Revision = { revision: number; financeBasisRevision: number };
type ContractOption = {
  contractNo: string;
  contractVersionId: string | null;
  source: string;
  canCreateSettlement: boolean;
  settlements: Array<{ amountCents: string; paidAmountCents: string }>;
};
const signedAt = "2026-09-01";
const cutoff = "2026-10-31";
const contractTypeKey = "material_purchase";

describe("A28 历史合同接管真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let projectId: string;
  let companyEntityId: string;
  let path: string;
  const password = randomUUID();
  const actors = {} as Record<Role, Actor>;

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    const nativeDatabase = process.env.JG_NATIVE_A28_DATABASE === url.pathname.slice(1)
      && /^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname)
      && url.username === "jg_task01_owner"
      && url.searchParams.get("sslmode") === "require"
      && url.searchParams.get("sslaccept") === "strict"
      && Boolean(url.searchParams.get("sslcert"));
    if (process.env.NODE_ENV !== "test" || url.hostname !== "127.0.0.1"
        || (url.pathname !== "/jiangkong_contract_takeover_a28" && !nativeDatabase)
        || process.env.FILE_STORAGE_DRIVER !== "local" || !process.env.FILE_STORAGE_ROOT
        || process.env.SMS_ENABLED !== "false" || process.env.APPROVAL_SMS_ENABLED !== "false") {
      throw new Error("历史合同 A28 验收只允许本机专用数据库、独立文件存储和关闭短信的测试环境");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    const [postgres] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT current_setting('server_version_num') AS version`;
    expect(Number(postgres.version)).toBeGreaterThanOrEqual(160000);
    expect(Number(postgres.version)).toBeLessThan(170000);

    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { code: `A28-${suffix}`, name: "合成历史接管项目" } });
    projectId = project.id;
    path = `/projects/${projectId}/contract-takeovers`;
    const company = await prisma.companyEntity.create({ data: { name: "合成我方签约主体" } });
    companyEntityId = company.id;
    const passwordHash = await hash(password, 4);
    for (const role of roles) {
      const phone = `a28-${role}-${suffix}`;
      const actor = await prisma.user.create({ data: { name: role, phone, passwordHash, mustChangePassword: false } });
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.create({ data: { userId: actor.id, positionId: position.id } });
      await prisma.projectRosterMember.create({ data: { projectId, userId: actor.id } });
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password })
      });
      expect(login.status).toBe(201);
      const session = await login.json() as { tokens: { accessToken: string } };
      actors[role] = { id: actor.id, token: session.tokens.accessToken };
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  async function request<T = unknown>(role: Role, route: string, method = "GET", body?: unknown) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { authorization: `Bearer ${actors[role].token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function uploadPdf(role: Role, name: string) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(`Synthetic A28 ${randomUUID()}`);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(await pdf.save())], { type: "application/pdf" }), `${name}.pdf`);
    form.append("idempotencyKey", randomUUID());
    const response = await fetch(`${baseUrl}${path}/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${actors[role].token}` },
      body: form
    });
    const body = await response.json() as { id: string };
    expect({ status: response.status, body }).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    return body.id;
  }

  async function options() {
    const result = await request<ContractOption[]>("contract_staff", `/contracts/settlement-create-options?projectId=${projectId}`);
    expect(result.status).toBe(200);
    return result.body;
  }

  async function moneyWrites() {
    return {
      operatingFacts: await prisma.operatingFact.count({ where: { projectId } }),
      fundMovements: await prisma.fundMovement.count(),
      refunds: await prisma.paymentExecutionRefund.count()
    };
  }

  const test = enabled ? it : it.skip;
  test.each([
    { relationship: "outside", settledCents: "6000", finance: "finance_staff", excessTreatment: "historical_advance" },
    { relationship: "inside", settledCents: "0", finance: "finance_director", excessTreatment: null },
    { relationship: "upward", settledCents: "6000", finance: "finance_staff", excessTreatment: "abnormal_overpay" }
  ] as const)("由实际岗位接管并继续办理 $relationship 历史合同", async ({ relationship, settledCents, finance, excessTreatment }) => {
    const beforeMoney = await moneyWrites();
    const zero = settledCents === "0";
    const code = `A28-${relationship}-${randomUUID()}`;
    const name = `合成历史合同 ${relationship}`;
    const counterparty = `合成签约相对方 ${relationship}`;
    const terms = "按经双方确认的历史结算金额办理收付";
    const draft = await request<{ id: string }>("contract_staff", path, "POST", {
      code, name, counterparty, relationship, contractTypeKey, companyEntityId,
      amountCents: "10000", signedAt, lifecycleStatus: "in_progress",
      paymentTermsOriginalText: terms, takeoverCutoffDate: cutoff
    });
    expect(draft).toMatchObject({
      status: 201,
      body: { takeoverLevel: "NONE", takeoverLevelAdjustmentReason: null, relationship, takeoverStatus: "draft", contractSide: null, financeSide: null }
    });
    const entry = `${path}/${draft.body.id}`;
    const handover = await request("contract_director", `${entry}/handover`, "PUT", {
      idempotencyKey: randomUUID(), contractUserId: actors.contract_staff.id,
      financeUserId: actors[finance].id, supervisorUserId: actors.contract_director.id
    });
    expect(handover).toMatchObject({ status: 200, body: { registered: true } });
    const scan = await uploadPdf("contract_staff", "已签历史合同");
    expect(await request("contract_staff", `${entry}/evidence-files`, "POST", { fileId: scan, purpose: "historical_contract_scan" }))
      .toMatchObject({ status: 201, body: { evidenceFiles: expect.arrayContaining([expect.objectContaining({ fileId: scan })]) } });

    async function assertUnposted(status: string) {
      expect(await request("contract_staff", entry)).toMatchObject({
        status: 200,
        body: { takeoverStatus: status, historicalFactStatus: "pending_verification", confirmedAt: null }
      });
      expect((await options()).find((item) => item.contractNo === code)).toMatchObject({
        canCreateSettlement: false, settlements: []
      });
      expect(await moneyWrites()).toEqual(beforeMoney);
    }

    if (zero) {
      expect(await request("contract_staff", `${entry}/review-submission`, "POST")).toMatchObject({ status: 400 });
      await assertUnposted("draft");
    }
    const settlementEvidence = await uploadPdf("contract_staff", "累计结算原始核对依据");
    const contractSide = await request<Revision>("contract_staff", `${entry}/contract-side`, "PUT", {
      idempotencyKey: randomUUID(), expectedRevision: 0, signedAt, performanceStatus: "performing",
      historicalSettledCents: settledCents, settlementEvidenceSummary: "已对照历史结算台账",
      settlementEvidenceFileIds: [settlementEvidence], paymentTerms: { originalText: terms, stages: [] },
      contractFacts: {
        contractNo: code, contractName: name, contractTypeKey, counterparty, originalAmountCents: "10000",
        settlementCutoffDate: cutoff, zeroSettlementDeclared: zero,
        ...(zero ? { zeroSettlementBasis: "逐期核对台账，确认历史结算未发生" } : {})
      }
    });
    expect(contractSide).toMatchObject({ status: 200, body: { revision: 1, financeBasisRevision: 1 } });
    const submit = () => request("contract_staff", `${entry}/review-submission`, "POST");
    expect(await submit()).toMatchObject({ status: 201, body: { takeoverStatus: "pending_finance" } });
    if (relationship === "outside") {
      expect(await request(finance, `${entry}/finance-supplement-return`, "POST", { reason: "请补充历史结算核对依据" }))
        .toMatchObject({ status: 201, body: { takeoverStatus: "needs_supplement", responsibleUserId: actors.contract_staff.id } });
      await assertUnposted("needs_supplement");
      expect(await submit()).toMatchObject({ status: 201, body: { takeoverStatus: "pending_finance" } });
    }
    const financeBasis = {
      basedOnContractRevision: contractSide.body.revision,
      basedOnFinanceBasisRevision: contractSide.body.financeBasisRevision
    };
    const financeSave = (expectedRevision: number, facts: object) => request<Revision>(finance, `${entry}/finance-side`, "PUT", {
      idempotencyKey: randomUUID(), expectedRevision, ...financeBasis, ...facts
    });
    if (zero) {
      expect(await financeSave(0, { zeroPaymentDeclared: false, payments: [] })).toMatchObject({ status: 400 });
      await assertUnposted("pending_finance");
    }
    const facts = zero
      ? { zeroPaymentDeclared: true, payments: [] }
      : {
          zeroPaymentDeclared: false, excessTreatment,
          excessReason: relationship === "upward" ? "超收性质待复核" : "原合同明确约定预付",
          excessEvidenceFileIds: [await uploadPdf(finance, "独立超额核对依据")],
          payments: [{
            rowKey: "历史回单-1", paidAt: "2026-10-30", amountCents: "7000",
            voucherFileIds: [await uploadPdf(finance, "历史银行回单")]
          }]
        };
    const financeSide = await financeSave(0, facts);
    expect(financeSide).toMatchObject({ status: 200, body: { revision: 1 } });
    const confirmFinance = (expectedRevision: number, role: Role = finance) =>
      request(role, `${entry}/finance-side/confirmation`, "POST", {
        idempotencyKey: randomUUID(), expectedRevision, currentPassword: password, ...financeBasis
      });
    async function pendingItem(role: Role) {
      const result = await request<{ queues: { pending: Array<{ id: string; currentNode: string }> } }>(role, "/me/work-items");
      expect(result.status).toBe(200);
      return result.body.queues.pending.find((item) => item.id === `takeover:${draft.body.id}`);
    }
    if (relationship === "outside") {
      expect(await pendingItem("finance_staff")).toMatchObject({ currentNode: "核对历史收付" });
      expect(await pendingItem("finance_director")).toMatchObject({ currentNode: "核对历史收付" });
    }
    const confirmDirector = () => request("contract_director", `${entry}/contract-side/confirmation`, "POST", {
      idempotencyKey: randomUUID(), expectedRevision: 1, currentPassword: password
    });
    expect(await confirmDirector()).toMatchObject({ status: 400 });
    expect(await confirmFinance(1)).toMatchObject({ status: 201, body: { confirmed: true, activated: false } });
    if (relationship === "outside") {
      expect(await confirmFinance(1, "finance_director")).toMatchObject({ status: 400 });
      expect(await pendingItem("finance_staff")).toBeUndefined();
      expect(await pendingItem("finance_director")).toBeUndefined();
      expect(await pendingItem("contract_director")).toMatchObject({ currentNode: "复核历史合同接管" });
    }
    await assertUnposted("pending_review");

    if (relationship === "outside") {
      expect(await request("contract_director", `${entry}/supplement-return`, "POST", { reason: "请制单人复核约定预付款" }))
        .toMatchObject({ status: 201, body: { takeoverStatus: "needs_supplement", responsibleUserId: actors.contract_staff.id } });
      await assertUnposted("needs_supplement");
      expect(await submit()).toMatchObject({ status: 201, body: { takeoverStatus: "pending_finance", financeSide: { confirmedRevision: null } } });
      expect(await confirmDirector()).toMatchObject({ status: 400 });
      expect(await confirmFinance(1, "finance_director")).toMatchObject({ status: 201, body: { confirmed: true, activated: false } });
      await assertUnposted("pending_review");
    }

    expect(await confirmDirector()).toMatchObject({ status: 201, body: { confirmed: true, activated: true } });
    const moneySummary = relationship === "upward"
      ? { historicalReceiptsCents: "7000", historicalOverReceivedCents: "1000", historicalOverReceivedPendingVerification: true, historicalOverpaidCents: "0" }
      : zero
        ? { historicalPaidTotalCents: "0", historicalOverpaidCents: "0", financeSide: { zeroPaymentDeclared: true }, contractSide: { contractFacts: { zeroSettlementDeclared: true } } }
        : { historicalPaidTotalCents: "7000", historicalOverpaidCents: "1000", historicalOverpaymentLabel: "未结算预付款" };
    expect(await request("contract_staff", entry)).toMatchObject({
      status: 200, body: { takeoverStatus: "confirmed", historicalFactStatus: "confirmed", ...moneySummary }
    });
    const confirmedOption = (await options()).find((item) => item.contractNo === code);
    expect(confirmedOption).toMatchObject({
      source: "historical_takeover", canCreateSettlement: true, contractVersionId: expect.any(String),
      settlements: zero ? [] : [expect.objectContaining({ amountCents: "6000", paidAmountCents: "6000" })]
    });
    const continuation = await request("contract_staff", `/projects/${projectId}/settlement-drafts`, "POST", {
      contractVersionId: confirmedOption?.contractVersionId,
      settlementTemplateVersionId: "a28-continuation-preview",
      code: `${code}-NEXT`,
      periodLabel: "接管后第一期结算",
      settlementLines: [{ sourceType: "manual_adjustment", adjustmentKind: "ordinary", name: "接管后新增结算", amountCents: "1000", reason: "本期新增履约" }]
    });
    expect(continuation).toMatchObject({
      status: 201, body: { status: "draft", contractVersionId: confirmedOption?.contractVersionId }
    });
    // The project has no operating-ledger date. Contract opening facts activate without moving cash or issuing any refund.
    expect(await moneyWrites()).toEqual(beforeMoney);
  }, 60_000);
});
