import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../app.module";
import { PrismaService } from "./prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { verifyApprovedPdf } from "./approval-pdf-acceptance.test-support";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";
type Actor = { id: string; token: string };
(enabled ? describe : describe.skip)("V6 独立审批真实 HTTP 与 PostgreSQL", () => {
  let app: INestApplication;
  let db: PrismaService;
  let baseUrl: string;
  let projectId: string;
  let takeoverId: string;
  let contractId: string;
  let staff: Actor;
  let finance: Actor;
  let contractDirector: Actor;
  let financeDirector: Actor;
  const password = randomUUID();
  const suffix = randomUUID();
  const prefix = () => `/projects/${projectId}/contract-takeovers`;
  async function request<T = { id: string; status: string }>(actor: Actor, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
    return value as T;
  }
  async function actor(role: string): Promise<Actor> {
    const user = await db.user.create({ data: { name: `验收${role}`, phone: `${role}-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: ["contract_staff", "finance_staff"].includes(role) ? projectId : null } });
    await db.projectMember.create({ data: { projectId, userId: user.id, positionKey: role } });
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) });
    expect(response.status).toBe(201);
    const login = await response.json() as { tokens: { accessToken: string } };
    const result = { id: user.id, token: login.tokens.accessToken };
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成账号签名.png");
    expect((await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${result.token}` }, body: form })).status).toBe(201);
    return result;
  }
  async function evidenceFile(owner: Actor) {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(await pdf.save()).buffer], { type: "application/pdf" }), "合成历史依据.pdf");
    const response = await fetch(`${baseUrl}/files`, { method: "POST", headers: { authorization: `Bearer ${owner.token}` }, body: form });
    const result = await response.json() as { id: string };
    if (response.status !== 201) throw new Error(`依据上传失败 ${response.status} ${JSON.stringify(result)}`);
    return result.id;
  }
  async function verify(owner: Actor, businessType: string, businessId: string, roles: string[], label: string) {
    await verifyApprovedPdf({ db, baseUrl, token: owner.token, password, businessType, businessId, roles, label });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") throw new Error("仅限新建本机临时验收数据库");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1"); baseUrl = await app.getUrl(); db = app.get(PrismaService);
    projectId = (await db.project.create({ data: { code: `V6-HIST-${suffix}`, name: "独立审批合成历史项目" } })).id;
    staff = await actor("contract_staff"); finance = await actor("finance_staff");
    contractDirector = await actor("contract_director"); financeDirector = await actor("finance_director");
    const party = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: suffix, createdByUserId: staff.id } });
    const partyVersion = await db.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name }, createdByUserId: staff.id } });
    await db.projectAffiliateAssignment.create({ data: { projectId, businessPartyId: party.id, businessPartyVersionId: partyVersion.id, affiliateNameSnapshot: party.name, effectiveFrom: new Date("2020-01-01"), changeReason: "验收历史主数据", assignedByUserId: staff.id } });
    // Only prerequisite historical facts are seeded. Every review and its signature is produced by the public API.
    const contract = await db.contract.create({ data: { projectId, source: "historical_takeover", code: `V6-H-${suffix}`, name: "合成历史合同", counterparty: "合成供应商", contractTypeKey: "generic_contract" } });
    contractId = contract.id;
    const version = await db.contractVersion.create({ data: { contractId, versionNo: 1, changeType: "historical_takeover", status: "effective", amountCents: 1000n, effectiveAt: new Date("2026-01-01"), draftData: {}, templateSnapshot: {}, clauseSnapshot: {} } });
    const terms = await db.paymentTermsVersion.create({ data: { contractId, contractVersionId: version.id, versionNo: 1, status: "effective", originalText: "合成历史条款" } });
    const takeover = await db.contractTakeover.create({ data: { projectId, contractId, contractVersionId: version.id, paymentTermsVersionId: terms.id, takeoverLevel: "A", takeoverStatus: "confirmed", lifecycleStatus: "in_progress", signedAt: new Date("2026-01-01"), historicalPaidCents: 101n, historicalBalanceConfirmedAt: new Date(), historicalBalanceConfirmedByUserId: financeDirector.id, confirmedAt: new Date(), confirmedByUserId: contractDirector.id, activationIdempotencyKey: `v6-${suffix}`, activatedAt: new Date(), activatedByUserId: contractDirector.id, createdByUserId: staff.id } });
    takeoverId = takeover.id;
    await db.contractTakeoverContractFacts.create({ data: { takeoverId, revision: 1, financeBasisRevision: 1, signedAt: new Date("2026-01-01"), historicalSettledCents: 0n, zeroSettlementDeclared: true, performanceStatus: "performing", paymentTermsSnapshot: {}, contractFactsSnapshot: {}, confirmedRevision: 1, confirmedByUserId: contractDirector.id, confirmedAt: new Date(), updatedByUserId: staff.id } });
    await db.contractTakeoverFinanceFacts.create({ data: { takeoverId, revision: 1, basedOnContractRevision: 1, basedOnFinanceBasisRevision: 1, zeroPaymentDeclared: false, excessTreatment: "abnormal_overpay", excessReason: "合成超付", confirmedRevision: 1, confirmedContractRevision: 1, confirmedFinanceBasisRevision: 1, confirmedByUserId: financeDirector.id, confirmedAt: new Date(), updatedByUserId: finance.id } });
    const account = await db.contractTakeoverBalanceAccount.create({ data: { takeoverId, balanceType: "abnormal_overpay", openingCents: 101n, balanceCents: 101n } });
    await db.contractTakeoverBalanceEntry.create({ data: { accountId: account.id, entryKind: "opening", amountCents: 101n, idempotencyKey: `v6-opening-${suffix}`, createdByUserId: financeDirector.id } });
  }, 60_000);
  afterAll(async () => { if (app) await app.close(); });

  it.each(["accepted", "limited_accepted"])("批次 %s 真实复核后下载；不能重复签批", async status => {
    const batch = await db.contractTakeoverBatch.create({ data: { projectId, batchNo: randomUUID(), status: "drafts_generated", takeoverCutoffDate: new Date("2026-01-01"), responsibleUserId: staff.id, reviewComment: "", acceptanceConclusion: "", importFingerprint: randomUUID(), totalRows: 1, createdCount: 1, createdByUserId: staff.id } });
    const path = `${prefix()}/import-batches/${batch.id}/review-result`;
    await request(contractDirector, path, { status: "under_review", reviewComment: "开始复核", acceptanceConclusion: "待验收" }, "PATCH");
    await request(contractDirector, path, { status, reviewComment: "核对合成历史来源", acceptanceConclusion: "通过本次验收" }, "PATCH");
    await verify(contractDirector, "contract_takeover_batch", batch.id, ["contract_director"], `历史批次-${status}`);
    await expect(request(contractDirector, path, { status, reviewComment: "重复", acceptanceConclusion: "重复" }, "PATCH")).rejects.toThrow();
    expect(await db.approvalActionLog.count({ where: { action: "approve", approvalInstanceId: (await db.approvalInstance.findFirstOrThrow({ where: { businessType: "contract_takeover_batch", businessId: batch.id } })).id } })).toBe(1);
  });
  it("我方主体更正通过实际提交和合同部主管签批生成 PDF", async () => {
    const company = await db.companyEntity.create({ data: { name: "更正目标合成公司", dataStatus: "complete" } });
    const created = await request(staff, `${prefix()}/${takeoverId}/company-entity-corrections`, { targetCompanyEntityId: company.id, reason: "核对历史原件后更正", responsibleUserId: staff.id, attachmentFileId: await evidenceFile(staff), currentPassword: password });
    await request(contractDirector, `${prefix()}/${takeoverId}/company-entity-corrections/${created.id}/review`, { decision: "approve", comment: "核对一致", currentPassword: password });
    await verify(contractDirector, "contract_company_correction", created.id, ["contract_director"], "历史我方主体更正");
    expect((await db.contract.findUniqueOrThrow({ where: { id: contractId } })).companyEntityId).toBe(company.id);
  });
  it("税务事实先财务后合同主管；首级通过仍禁止正式下载", async () => {
    const created = await request(staff, `${prefix()}/${takeoverId}/tax-fact-revisions`, { kind: "supplement", invoiceType: "vat_special", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "business_finance_confirmation", confirmationExplanation: "核对合成历史合同及财务依据", rowFacts: [] });
    const path = `${prefix()}/${takeoverId}/tax-fact-revisions/${created.id}`;
    await request(staff, `${path}/finance-review-submission`, {});
    await request(financeDirector, `${path}/finance-review`, { decision: "approve", comment: "税务事实复核一致" });
    expect(await request(contractDirector, `/approval-forms/contract_tax_fact_revision/${created.id}/capability`)).toMatchObject({ available: false });
    await request(contractDirector, `${path}/contract-confirmation`, { decision: "approve", comment: "合同原件核对一致" });
    await verify(contractDirector, "contract_tax_fact_revision", created.id, ["finance_director", "contract_director"], "历史税务事实修订");
  });
  it("历史超付更正由实际财务主管签批并留存 PDF", async () => {
    const created = await request(finance, `${prefix()}/${takeoverId}/corrections`, { correctionScope: "abnormal_overpay", correctionOperation: "correction", targetRevision: 1, targetBalanceRevision: 1, deltaCents: "-101", reason: "合成历史超付全额退回", responsibleUserId: finance.id, attachmentFileId: await evidenceFile(finance), applicationIdempotencyKey: randomUUID(), currentPassword: password });
    await request(financeDirector, `${prefix()}/${takeoverId}/corrections/${created.id}/review`, { decision: "apply", reviewComment: "退款依据一致", currentPassword: password });
    await verify(financeDirector, "contract_takeover_correction", created.id, ["finance_director"], "历史承接更正");
  });
  it.each(["project_expense_request", "project_settlement_exception_quota", "no_invoice_confirmation", "invoice_exception_confirmation"])("历史审批日志 %s 缺冻结签名时禁止下载，也不借用当前签名补造", async businessType => {
    // Imported legacy log fixture, not an active-flow approval: intentionally lacks historical signature evidence.
    const businessId = randomUUID();
    const instance = await db.approvalInstance.create({ data: { businessType, businessId,
      flowType: "legacy_acceptance_fixture", applicantUserId: staff.id, status: "approved", currentNodeIndex: 0,
      frozenNodes: [{ name: "财务主管", mode: "any", roleKeys: ["finance_director"] }] } });
    await db.approvalActionLog.create({ data: { approvalInstanceId: instance.id, action: "approve", actorUserId: financeDirector.id,
      approvedRoleKey: "finance_director", createdAt: new Date("2020-01-01"), metadata: { approverName: "历史财务主管" } } });
    expect(await request(staff, `/approval-forms/${businessType}/${businessId}/capability`)).toMatchObject({ available: false });
    const response = await fetch(`${baseUrl}/approval-forms/${businessType}/${businessId}/download`, {
      method: "POST", headers: { authorization: `Bearer ${staff.token}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmationPassword: password, downloadReason: "历史缺证据拒绝核验" })
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/签名|签批|证据/u);
    expect(await db.pdfDocument.count({ where: { businessType, businessId } })).toBe(0);
    const log = await db.approvalActionLog.findFirstOrThrow({ where: { approvalInstanceId: instance.id } });
    expect(log.signatureVersionIdSnapshot).toBeNull();
  });

});
