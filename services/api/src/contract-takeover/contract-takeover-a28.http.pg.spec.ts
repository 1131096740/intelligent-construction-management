import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { openSignedSettlementQualification } from "../database/signed-settlement-qualification.test-support";
import { createApiValidationPipe } from "../validation/api-validation";

const enabled = process.env.RUN_CONTRACT_TAKEOVER_A28_PG16 === "1";
const roles = ["contract_staff", "finance_staff", "finance_director", "contract_director"] as const;
const paymentReviewRoles = ["comprehensive_director", "project_manager", "chairman", "general_manager"] as const;
const openingProof = process.env.JG_HISTORICAL_ACCEPTANCE_SCENARIO === "a29-opening";
const unknownExcessProof = process.env.JG_HISTORICAL_ACCEPTANCE_SCENARIO === "a28-unknown-overpay";
type OpeningCheckpoint = "ACTORS_READY" | "OPENING_REGISTERED" | "FINANCE_CONFIRMED" | "TAKEOVER_ACTIVATED" |
  "HISTORY_AND_OPENING_RECONCILED" | "SIGNED_APPLICATION_READY" | "SIGNED_SETTLEMENT_CONFIRMED" | "PAYMENT_BASIS_CONFIRMED" |
  "PAYMENT_REQUESTED" | "PAYMENT_APPROVED" | "PAYMENT_OPTIONS_CONFIRMED" | "PAYMENT_REGISTERED" | "PAYMENT_RECONCILED";
function openingCheckpoint(checkpoint: OpeningCheckpoint) {
  if (openingProof) process.stdout.write(`A29_CHECKPOINT ${checkpoint}\n`);
}
type Role = (typeof roles | typeof paymentReviewRoles)[number];
type Actor = { id: string; token: string };
type Revision = { revision: number; financeBasisRevision: number };
type ContractOption = {
  contractId: string;
  contractNo: string;
  contractVersionId: string | null;
  source: string;
  canCreateSettlement: boolean;
  settlements: Array<{ amountCents: string; paidAmountCents: string }>;
};
type SignedSettlementOption = { id: string; kind: string; relationship: string };
type SignedSettlementRecord = { id: string; revision: number };
const signedAt = "2026-09-01";
const cutoff = "2026-10-31";
const contractTypeKey = "material_purchase";
const ourCompany = "合成我方签约主体";
const constructionEnterprise = "A28 合成施工企业";

describe("A28 历史合同接管真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let signedQualification: Awaited<ReturnType<typeof openSignedSettlementQualification>> | undefined;
  let baseUrl: string;
  let projectId: string;
  let companyEntityId: string;
  let affiliateVersionId: string;
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
        || !nativeDatabase
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
    const company = await prisma.companyEntity.create({ data: { name: ourCompany } });
    companyEntityId = company.id;
    const passwordHash = await hash(password, 4);
    for (const role of openingProof ? [...roles, ...paymentReviewRoles] : roles) {
      const phone = `a28-${role}-${suffix}`;
      const actor = await prisma.user.create({ data: { name: role, phone, passwordHash, mustChangePassword: false } });
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.create({
        data: { userId: actor.id, positionId: position.id, ...(role === "project_manager" ? { projectId } : {}) }
      });
      if (role === "finance_director") {
        await prisma.userPosition.create({ data: { userId: actor.id, positionId: position.id, projectId } });
      }
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
    affiliateVersionId = await configureProjectParties();
    openingCheckpoint("ACTORS_READY");
  });

  afterAll(async () => {
    try { await signedQualification?.close(); }
    finally { await app?.close(); }
  });

  async function request<T = unknown>(role: Role, route: string, method = "GET", body?: unknown, target = baseUrl) {
    const response = await fetch(`${target}${route}`, {
      method,
      headers: { authorization: `Bearer ${actors[role].token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function uploadPdf(role: Role, name: string, uploadPath = path, target = baseUrl) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(`Synthetic A28 ${randomUUID()}`);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(await pdf.save())], { type: "application/pdf" }), `${name}.pdf`);
    if (uploadPath === path) form.append("idempotencyKey", randomUUID());
    const response = await fetch(`${target}${uploadPath}/files`, {
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

  async function configureProjectParties() {
    const start = new Date("2026-01-01");
    const userId = actors.contract_staff.id;
    const creditCode = "91310000000000000X";
    const party = await prisma.businessParty.create({ data: {
      name: constructionEnterprise, normalizedName: constructionEnterprise,
      unifiedSocialCreditCode: creditCode, createdByUserId: userId
    } });
    const partyVersion = await prisma.businessPartyVersion.create({ data: {
      businessPartyId: party.id, versionNo: 1, createdByUserId: userId,
      snapshot: { name: constructionEnterprise, unifiedSocialCreditCode: creditCode }
    } });
    await prisma.projectAffiliateAssignment.create({ data: {
      projectId, businessPartyId: party.id, businessPartyVersionId: partyVersion.id,
      affiliateNameSnapshot: constructionEnterprise, affiliateCreditCodeSnapshot: creditCode,
      effectiveFrom: start, changeReason: "A28 测试施工企业", assignedByUserId: userId
    } });
    const company = await prisma.companyEntityVersion.create({ data: {
      companyEntityId, versionNo: 1, name: ourCompany, unifiedSocialCreditCode: "913100000000000018",
      isActive: true, action: "create", actorUserId: userId
    } });
    await prisma.companyEntity.update({ where: { id: companyEntityId }, data: {
      currentVersionNo: 1, dataStatus: "complete", unifiedSocialCreditCode: company.unifiedSocialCreditCode
    } });
    await prisma.projectParticipatingCompany.create({ data: {
      projectId, companyEntityId, companyEntityVersionId: company.id,
      companyNameSnapshot: company.name, companyCreditCodeSnapshot: company.unifiedSocialCreditCode,
      effectiveFrom: start, changeReason: "A28 测试参与公司", addedByUserId: userId
    } });
    return partyVersion.id;
  }

  async function enableOperatingLedger() {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!secret) throw new Error("A28 启用经营账场景需要隔离经营账写入凭据");
    await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, public.crypt(${secret}, public.gen_salt('bf')))`;
    expect(await request("finance_director", `/projects/${projectId}/operating-profile`, "PATCH", {
      operatingLedgerEffectiveDate: "2026-11-01"
    })).toMatchObject({ status: 200, body: { operatingLedgerEffectiveDate: "2026-11-01" } });
  }

  async function moneyWrites() {
    return {
      operatingFacts: await prisma.operatingFact.count({ where: { projectId } }),
      paymentExecutions: await prisma.paymentExecution.count(),
      fundExecutions: await prisma.fundExecution.count(),
      fundMovements: await prisma.fundMovement.count(),
      refunds: await prisma.paymentExecutionRefund.count(),
      registeredFunding: await prisma.registeredPaymentFunding.count(),
      registeredAllocations: await prisma.registeredFundPaymentAllocation.count()
    };
  }

  async function registerNewPayment(
    signedSettlementId: string,
    code: string,
    scopeKey: string,
    opening: { id: string; sources: [{ id: string }] }
  ) {
    const before = await moneyWrites();
    const payment = await request<{ id: string }>("contract_staff", "/payments", "POST", {
      sourceType: "signed_settlement", signedSettlementId, code: `${code}-PAY`,
      requestedAmountCents: "1000", paymentMatter: "接管后新增结算实付",
      amountCalculationExplanation: "历史累计实付六十元已计，批准本期新增十元"
    });
    expect(payment).toMatchObject({ status: 201, body: { status: "approval_pending", signedSettlementId } });
    openingCheckpoint("PAYMENT_REQUESTED");
    const paymentRoute = `/payments/${payment.body.id}`;
    const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const signedRoles = new Set<Role>();
    const approvedDuties: Role[] = [];
    let lastApproval: unknown;
    const recordApprovalStep = (operation: "SIGNATURE" | "DETAIL" | "REVIEW", index: number, status: number) =>
      process.stdout.write(`A29_APPROVAL ${operation} ${index} ${status}\n`);
    for (let step = 0; step < 12; step++) {
      const round = await prisma.approvalInstance.findFirst({
        where: { businessType: "payment_request", businessId: payment.body.id, status: "in_progress" }
      });
      if (!round) break;
      const nodes = round.frozenNodes as unknown as Array<{ roleKeys: Role[]; approvedRoleKeys?: Role[] }>;
      const pending = nodes[round.currentNodeIndex];
      const actor = pending?.roleKeys.find((role) => actors[role] && !pending.approvedRoleKeys?.includes(role));
      if (!actor) throw new Error("付款审批缺少隔离测试岗位");
      if (!signedRoles.has(actor)) {
        const form = new FormData();
        form.append("file", new Blob([signature], { type: "image/png" }), "synthetic-a29-signature.png");
        const uploaded = await fetch(`${baseUrl}/me/signature/canvas`, {
          method: "POST", headers: { authorization: `Bearer ${actors[actor].token}` }, body: form
        });
        recordApprovalStep("SIGNATURE", step, uploaded.status);
        expect(uploaded.status).toBe(201);
        signedRoles.add(actor);
      }
      const detail = await request<{ reviewApprovalContext: {
        expectedPaymentUpdatedAt: string; expectedApprovalInstanceId: string;
        expectedNodeIndex: number; expectedApprovalUpdatedAt: string;
      } | null }>(actor, paymentRoute);
      recordApprovalStep("DETAIL", step, detail.status);
      expect(detail.status).toBe(200);
      const coordinates = detail.body.reviewApprovalContext;
      if (!coordinates) throw new Error("公开付款详情没有审批坐标");
      const { expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt } = coordinates;
      expect(expectedApprovalInstanceId).toBe(round.id);
      expect(expectedNodeIndex).toBe(round.currentNodeIndex);
      const approval = await request(actor, `${paymentRoute}/approval`, "POST", {
        expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt,
        decision: "approve", confirmationPassword: password
      });
      recordApprovalStep("REVIEW", step, approval.status);
      expect(approval.status).toBe(201);
      lastApproval = approval.body;
      approvedDuties.push(actor);
    }
    expect(approvedDuties).toEqual(["comprehensive_director", "project_manager", "finance_director", "contract_director", "chairman"]);
    expect(lastApproval).toMatchObject({
      status: "approved_pending_payment", approvedAmountCents: "1000",
      businessEntrySnapshot: { values: { approvedAmountYuan: "10.00" } }
    });
    expect(await request("finance_staff", paymentRoute)).toMatchObject({
      status: 200, body: {
        reviewApprovalContext: null,
        meta: expect.arrayContaining([expect.objectContaining({ label: "审批状态", value: "已通过" })]),
        baseInfo: expect.arrayContaining([expect.objectContaining({ label: "批准金额", value: "¥10.00" })])
      }
    });
    openingCheckpoint("PAYMENT_APPROVED");
    const executionRoute = `/payment-executions/${payment.body.id}`;
    const options = await request<{ expectedPaymentUpdatedAt: string; contractHistoryBasis: { fingerprint: string } }>(
      "finance_staff", `${executionRoute}/registration-options`);
    expect(options).toMatchObject({
      status: 200, body: {
        remainingAmountCents: "1000",
        accounts: expect.arrayContaining([expect.objectContaining({ scopeKey, eligible: true, currentRegistrationId: opening.id })]),
        contractHistoryBasis: { required: true, records: [{ historicalPaidCents: "6000" }] }
      }
    });
    openingCheckpoint("PAYMENT_OPTIONS_CONFIRMED");
    const command = {
      idempotencyKey: randomUUID(), expectedPaymentUpdatedAt: options.body.expectedPaymentUpdatedAt,
      amountCents: "1000", paidAt: "2026-11-12", scopeKey, expectedRegistrationId: opening.id,
      openingTreatment: "not_included", openingReason: "同项目期初只包含原历史实付",
      openingEvidence: "合成新增付款凭据", sourceAllocations: [{ sourceBatchId: opening.sources[0].id, amountCents: "1000" }],
      confirmationPassword: password,
      contractHistoryConfirmation: {
        treatment: "not_included", expectedFingerprint: options.body.contractHistoryBasis.fingerprint,
        reason: "本次新增付款未计入原历史合同实付六十元", evidence: "合成合同历史与新增付款核对表"
      }
    };
    const register = () => request<{ id: string }>("finance_staff", `${executionRoute}/registrations`, "POST", command);
    const recorded = await register();
    expect(recorded).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    openingCheckpoint("PAYMENT_REGISTERED");
    expect(await register()).toMatchObject({ status: 201, body: { id: recorded.body.id } });
    expect(await request("finance_staff", `/payment-executions/results/${command.idempotencyKey}`)).toMatchObject({
      status: 200, body: { status: "recorded", execution: { executionId: recorded.body.id, amountCents: "1000" } }
    });
    expect(await prisma.paymentExecution.findMany({ where: { paymentRequestId: payment.body.id } }))
      .toMatchObject([{ id: recorded.body.id, amountCents: 1_000n }]);
    expect(await prisma.registeredFundPaymentAllocation.findMany({ where: { executionId: recorded.body.id } }))
      .toMatchObject([{ sourceBatchId: opening.sources[0].id, amountCents: 1_000n }]);
    const after = await moneyWrites();
    expect(after).toMatchObject({
      paymentExecutions: before.paymentExecutions + 1, registeredFunding: before.registeredFunding + 1,
      registeredAllocations: before.registeredAllocations + 1, refunds: before.refunds
    });
  }

  const test = enabled ? it : it.skip;
  type HistoricalCase = {
    relationship: "outside" | "inside" | "upward";
    settledCents: "0" | "6000";
    finance: "finance_staff" | "finance_director";
    excessTreatment: "historical_advance" | "abnormal_overpay" | null | undefined;
  };
  const cases: HistoricalCase[] = [
    { relationship: "outside", settledCents: "6000", finance: "finance_staff", excessTreatment: "historical_advance" },
    { relationship: "inside", settledCents: "0", finance: "finance_director", excessTreatment: null },
    { relationship: "upward", settledCents: "6000", finance: "finance_staff", excessTreatment: "abnormal_overpay" }
  ];
  const selectedCases: HistoricalCase[] = openingProof
    ? [{ relationship: "inside", settledCents: "6000", finance: "finance_director", excessTreatment: undefined }]
    : unknownExcessProof
      ? [{ relationship: "outside", settledCents: "6000", finance: "finance_staff", excessTreatment: "abnormal_overpay" }]
      : cases;
  test.each(selectedCases)("由实际岗位接管并继续办理 $relationship 历史合同", async ({ relationship, settledCents, finance, excessTreatment }) => {
    if (relationship === "upward" || openingProof) await enableOperatingLedger();
    const scopeKey = `company:${companyEntityId}`;
    const opening = openingProof ? await request<{ id: string; sources: [{ id: string }] }>("finance_staff", "/fund-accounts/openings", "POST", {
      scopeKey, balanceYuan: "100.0000", asOfDate: "2026-11-01",
      evidenceReference: "合成期初核对表", reconciliationNote: "本项目期初余额已包含十月三十日历史实付六十元",
      reason: "历史实付已在期初余额中核对", idempotencyKey: randomUUID(),
      sources: [{ amountYuan: "100.0000", sourceStatus: "known", sourceName: "本项目合成公司资金",
        projectStatus: "project", projectId }]
    }) : null;
    async function assertOpening(balanceYuan: string) {
      expect(await request("finance_staff", `/fund-accounts/${encodeURIComponent(scopeKey)}`)).toMatchObject({
        status: 200, body: { balanceYuan, currentRegistrationId: opening?.body.id,
          projectBalances: [{ projectStatus: "project", projectId, amountYuan: balanceYuan }] }
      });
    }
    if (openingProof) {
      expect(opening).toMatchObject({ status: 201, body: { balanceYuan: "100.0000", kind: "opening", status: "confirmed" } });
      await assertOpening("100.0000");
      openingCheckpoint("OPENING_REGISTERED");
    }
    const beforeMoney = await moneyWrites();
    const zero = settledCents === "0";
    const code = `A28-${relationship}-${randomUUID()}`;
    const name = `合成历史合同 ${relationship}`;
    const counterparty = relationship === "upward" ? constructionEnterprise : `合成签约相对方 ${relationship}`;
    let counterpartyVersionId: string | undefined;
    if (relationship !== "upward") {
      const createdByUserId = actors.contract_staff.id;
      const party = await prisma.businessParty.create({
        data: { name: counterparty, normalizedName: counterparty, createdByUserId }
      });
      const version = await prisma.businessPartyVersion.create({
        data: { businessPartyId: party.id, versionNo: 1, createdByUserId, snapshot: { name: counterparty } }
      });
      counterpartyVersionId = version.id;
    }
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
        ...(counterpartyVersionId ? { counterpartyVersionId } : {}),
        ...(relationship === "outside" ? { signingPartyVersionId: affiliateVersionId } : {}),
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
          zeroPaymentDeclared: false,
          ...(excessTreatment ? { excessTreatment,
            excessReason: relationship === "upward" || unknownExcessProof ? "超额款项性质尚待核对" : "原合同明确约定预付",
            excessEvidenceFileIds: [await uploadPdf(finance, "独立超额核对依据")]
          } : {}),
          payments: [{
            rowKey: "历史回单-1", paidAt: "2026-10-30", amountCents: openingProof ? "6000" : "7000",
            ...(relationship === "upward" ? { payerName: constructionEnterprise, payeeName: ourCompany } : {}),
            ...(openingProof ? { payerName: ourCompany, payeeName: counterparty } : {}),
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
      expect(await request("contract_director", `${entry}/supplement-return`, "POST", { reason: unknownExcessProof ? "请制单人复核超付款项依据" : "请制单人复核约定预付款" }))
        .toMatchObject({ status: 201, body: { takeoverStatus: "needs_supplement", responsibleUserId: actors.contract_staff.id } });
      await assertUnposted("needs_supplement");
      expect(await submit()).toMatchObject({ status: 201, body: { takeoverStatus: "pending_finance", financeSide: { confirmedRevision: null } } });
      expect(await confirmDirector()).toMatchObject({ status: 400 });
      expect(await confirmFinance(1, "finance_director")).toMatchObject({ status: 201, body: { confirmed: true, activated: false } });
      await assertUnposted("pending_review");
    }

    openingCheckpoint("FINANCE_CONFIRMED");
    const activation = await confirmDirector();
    if (activation.status !== 201) {
      const message = (activation.body as { message?: unknown } | null)?.message;
      const publicMessage = message === "C级证据只能进入历史资料缺口，不能直接进入正式经营账"
        ? "历史实付证据等级不允许进入正式经营账"
        : typeof message === "string" && /^[\p{Script=Han}，。；：！？、]{1,96}$/u.test(message)
          ? message : "未提供符合回执格式的公开提示";
      throw new Error(`A28_ACTIVATION_HTTP(${activation.status},${publicMessage})`);
    }
    expect(activation.body).toMatchObject({ confirmed: true, activated: true });
    openingCheckpoint("TAKEOVER_ACTIVATED");
    const moneySummary = relationship === "upward"
      ? { historicalReceiptsCents: "7000", historicalOverReceivedCents: "1000", historicalOverReceivedPendingVerification: true, historicalOverpaidCents: "0" }
      : zero
        ? { historicalPaidTotalCents: "0", historicalOverpaidCents: "0", financeSide: { zeroPaymentDeclared: true }, contractSide: { contractFacts: { zeroSettlementDeclared: true } } }
        : openingProof
          ? { historicalPaidTotalCents: "6000", historicalOverpaidCents: "0" }
          : { historicalPaidTotalCents: "7000", historicalOverpaidCents: "1000",
              historicalOverpaymentLabel: unknownExcessProof ? "超付，性质待核对" : "未结算预付款",
              historicalOverpaymentKind: unknownExcessProof ? "pending_verification" : "unsettled_advance" };
    expect(await request("contract_staff", entry)).toMatchObject({
      status: 200, body: { takeoverStatus: "confirmed", historicalFactStatus: "confirmed", ...moneySummary }
    });
    const confirmedOption = (await options()).find((item) => item.contractNo === code);
    expect(confirmedOption).toMatchObject({
      source: "historical_takeover", canCreateSettlement: true, contractVersionId: expect.any(String),
      settlements: zero ? [] : [expect.objectContaining({ amountCents: "6000", paidAmountCents: "6000" })]
    });
    const afterMoney = await moneyWrites();
    if (relationship === "upward") {
      expect(afterMoney).toEqual({ ...beforeMoney, operatingFacts: beforeMoney.operatingFacts + 3 });
      const persisted = await prisma.operatingFact.findMany({ where: { projectId }, include: { impacts: true } });
      expect(persisted).toHaveLength(3);
      const receipt = persisted.find((fact) => fact.sourceType === "contract_takeover_historical_payment");
      expect(receipt).toMatchObject({
        amountCents: 7_000n, factKind: "fund_movement", direction: "inflow", evidenceLevel: "A",
        isBeforeOperatingLedgerEffectiveDate: true,
        actualPayerSubjectKind: "construction_enterprise", actualPayerSubjectId: affiliateVersionId,
        payeeSubjectKind: "participating_company", payeeSubjectId: companyEntityId,
        sourceSnapshot: { contractRelationship: "upward", unmatchedReceiptCents: "1000" }
      });
      expect(persisted.flatMap((fact) => fact.impacts).map(({ impactKind, direction, amountCents }) =>
        [impactKind, direction, amountCents])).toEqual(expect.arrayContaining([
        ["contract_commitment_reference", "increase", 10_000n],
        ["receivable_increase", "increase", 6_000n],
        ["receivable_decrease", "decrease", 6_000n]
      ]));
      expect(persisted.flatMap((fact) => fact.impacts)).toHaveLength(3);
      expect(await prisma.contractTakeoverBalanceAccount.count({ where: { takeoverId: draft.body.id } })).toBe(0);
    } else if (openingProof) {
      expect(afterMoney).toEqual({ ...beforeMoney, operatingFacts: beforeMoney.operatingFacts + 3 });
      expect(await prisma.operatingFact.findFirst({
        where: { projectId, sourceType: "contract_takeover_historical_payment" }, include: { impacts: true }
      })).toMatchObject({
        amountCents: 6_000n,
        isBeforeOperatingLedgerEffectiveDate: true, actualPayerSubjectKind: "participating_company",
        sourceSnapshot: { historicalOpeningPayment: true },
        impacts: [{ impactKind: "payable_decrease", amountCents: 6_000n }]
      });
      await assertOpening("100.0000");
      openingCheckpoint("HISTORY_AND_OPENING_RECONCILED");
    } else {
      expect(afterMoney).toEqual(beforeMoney);
    }
    if (unknownExcessProof) {
      expect(await prisma.contractTakeoverBalanceAccount.findMany({ where: { takeoverId: draft.body.id } }))
        .toMatchObject([{ balanceType: "abnormal_overpay", openingCents: 1_000n, balanceCents: 1_000n }]);
      return;
    }

    const retired = await request("contract_staff", `/projects/${projectId}/settlement-drafts`, "POST", {});
    expect(retired).toMatchObject({ status: 410, body: { code: "OLD_WRITE_ENTRY_RETIRED" } });

    signedQualification ??= await openSignedSettlementQualification(prisma, process.env.DATABASE_URL!, { historicalPaymentBasis: true });
    openingCheckpoint("SIGNED_APPLICATION_READY");
    const signedPath = `/projects/${projectId}/signed-contract-settlements`;
    const signedTarget = signedQualification.baseUrl;
    const picker = await request<SignedSettlementOption[]>("contract_staff", `${signedPath}/contracts`, "GET", undefined, signedTarget);
    expect(picker.status).toBe(200);
    const sameContract = picker.body.find((item) => item.id === confirmedOption?.contractId);
    const expectedKind = relationship === "inside" ? "downstream" : relationship === "outside" ? "outside_fact" : "upward";
    expect(sameContract).toMatchObject({ relationship, kind: expectedKind });

    const selection = { contractKind: sameContract?.kind, contractId: sameContract?.id };
    const overviewPath = `${signedPath}/contract-overview?${new URLSearchParams({
      contractKind: selection.contractKind!, contractId: selection.contractId!
    })}`;
    expect(await request("contract_staff", overviewPath, "GET", undefined, signedTarget))
      .toMatchObject({ status: 200, body: { confirmedYuan: zero ? "0.0000" : "60.0000" } });

    const nextNumber = `${code}-NEXT`;
    const fileId = await uploadPdf("contract_staff", "接管后首期合成已签结算", signedPath, signedTarget);
    const saved = await request<SignedSettlementRecord>("contract_staff", signedPath, "POST", {
      ...selection, number: nextNumber, amountYuan: "10.0000", fileIds: [fileId]
    }, signedTarget);
    expect(saved).toMatchObject({ status: 201, body: { ...selection, number: nextNumber, state: "draft", amountYuan: "10.0000" } });
    const signedEntry = `${signedPath}/${saved.body.id}`;
    const submitted = await request<SignedSettlementRecord>("contract_staff", `${signedEntry}/submission`, "POST", {
      revision: saved.body.revision
    }, signedTarget);
    expect(submitted).toMatchObject({ status: 201, body: { ...selection, state: "pending_review" } });
    expect(await request("contract_director", `${signedEntry}/review`, "POST", {
      revision: submitted.body.revision, decision: "confirm"
    }, signedTarget)).toMatchObject({
      status: 201,
      body: { ...selection, state: "confirmed", confirmedContractSource: {
        relationship, sourceRecordId: confirmedOption?.contractVersionId, historicalTakeoverId: draft.body.id,
        ...(relationship === "outside" ? {
          payerKind: "construction_enterprise", payerVersionId: affiliateVersionId,
          counterpartyKind: "downstream_counterparty", counterpartyVersionId
        } : {})
      } }
    });
    openingCheckpoint("SIGNED_SETTLEMENT_CONFIRMED");
    const confirmedYuan = zero ? "10.0000" : "70.0000";
    expect(await request("contract_staff", overviewPath, "GET", undefined, signedTarget))
      .toMatchObject({ status: 200, body: { confirmedYuan } });
    signedQualification.takeQueryFailure();
    const paymentBasis = await request("contract_staff", overviewPath.replace("/contract-overview?", "/payment-basis?"),
      "GET", undefined, signedTarget);
    if (paymentBasis.status !== 200) {
      throw new Error(`A28_SIGNED_PAYMENT_BASIS_HTTP(${paymentBasis.status},${signedQualification.takeQueryFailure() ?? "QUERY_UNAVAILABLE"})`);
    }
    expect(paymentBasis).toMatchObject({
      status: 200,
      body: {
        confirmedYuan,
        latestConfirmed: { id: saved.body.id, amountYuan: "10.0000", source: "signed_registration" },
        downstreamCapacity: relationship === "upward" ? null : {
          recordedPaidYuan: zero ? "0.0000" : openingProof ? "60.0000" : "70.0000",
          wholeCentLimit: zero || openingProof ? "1000" : "0",
          ...(zero || openingProof ? {} : { advancePaidYuan: "10.0000", abnormalOverpayYuan: "0.0000" })
        }
      }
    });

    expect(await moneyWrites()).toEqual({
      ...afterMoney,
      operatingFacts: afterMoney.operatingFacts + (relationship === "upward" || openingProof ? 1 : 0)
    });
    if (openingProof && opening) {
      await assertOpening("100.0000");
      openingCheckpoint("PAYMENT_BASIS_CONFIRMED");
      await registerNewPayment(saved.body.id, code, scopeKey, opening.body);
      await assertOpening("90.0000");
      expect(await request("contract_staff", entry)).toMatchObject({
        status: 200, body: { takeoverStatus: "confirmed", historicalPaidTotalCents: "6000", historicalOverpaidCents: "0" }
      });
      openingCheckpoint("PAYMENT_RECONCILED");
    }
  }, openingProof ? 120_000 : 60_000);
});
