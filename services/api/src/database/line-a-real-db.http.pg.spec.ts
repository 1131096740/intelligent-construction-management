import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { currentRegisteredPaymentDomain } from "../payment/registered-payment-domain";
import { loadSignedSettlementPaymentBasis } from "../payment/signed-settlement-payment-capacity";

const run = process.env.RUN_LINE_A_REAL_DB === "1" ? describe : describe.skip;
const upwardArchive = process.env.RUN_LINE_A_UPWARD_ARCHIVE_332 === "1";
const paymentRemainder = process.env.RUN_LINE_A_PAYMENT_REMAINDER_331 === "1";
const historicalSettlement = process.env.RUN_LINE_A_HISTORICAL_SETTLEMENT_334 === "1";

run("line A contract candidate on real PostgreSQL and HTTP", () => {
  jest.setTimeout(180_000);
  const password = "LineA-Real-Db-Password-01";
  const ids = {
    project: "linea-project", company: "linea-company", companyVersion: "linea-company-v1",
    affiliate: "linea-affiliate-party", affiliateVersion: "linea-affiliate-v1",
    counterparty: "linea-counterparty", counterpartyVersion: "linea-counterparty-v1",
    assignment: "linea-assignment", participating: "linea-participating",
    contractA: "linea-contract-a", versionA: "linea-contract-a-v1",
    contractB: "linea-contract-b", versionB: "linea-contract-b-v1",
    contractC: "linea-contract-c", versionC: "linea-contract-c-v1",
    contractD: "linea-contract-d", versionD: "linea-contract-d-v1",
    contractE: "linea-contract-e", versionE: "linea-contract-e-v1",
    contractF: "linea-contract-f", versionF: "linea-contract-f-v1",
    contractG: "linea-contract-g", versionG: "linea-contract-g-v1",
    contractH: "linea-contract-h", versionH: "linea-contract-h-v1",
    contractI: "linea-contract-i", versionI: "linea-contract-i-v1",
    contractJ: "linea-contract-j", versionJ: "linea-contract-j-v1",
    staff: "linea-user-staff", director: "linea-user-director",
    manager: "linea-user-manager", finance: "linea-user-finance", managerPeer: "linea-user-manager-peer"
  };
  const phones: Record<string, string> = {
    staff: "13900001601", director: "13900001602", manager: "13900001603", finance: "13900001604", managerPeer: "13900001605"
  };
  const tokens = new Map<string, string>();
  let app: INestApplication;
  let owner: PrismaClient;
  let base: string;
  let changeAppendixFileId: string;
  let contractChangeId: string;
  let settlementId: string;
  let workCompletionId: string;
  let approvalInstanceId: string;
  const signedPaymentId = randomUUID();

  const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  const callRaw = async (actor: keyof typeof phones, path: string, body?: unknown, method?: string) => {
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get(actor)}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const call = async (actor: keyof typeof phones, path: string, body?: unknown, method?: string) => {
    const result = await callRaw(actor, path, body, method);
    if (result.status >= 400) {
      throw new Error(`LINE_A_HTTP ${method ?? "POST"} ${path} -> ${result.status}: ${JSON.stringify(result.body)}`);
    }
    return result;
  };
  const readBaseInfo = (detail: { baseInfo: Array<{ label: string; value: string }> }, label: string) =>
    detail.baseInfo.find(item => item.label === label)?.value;
  const seedConfirmedSignedSettlement = async (input: {
    id: string; contractId: string; versionId: string; number: string;
    amountYuan: string; confirmationNo: bigint; reviewedAt: Date;
  }) => owner.signedContractSettlement.create({ data: {
    id: input.id, projectId: ids.project, contractKind: "downstream", contractId: input.contractId,
    ownerUserId: ids.director, number: input.number, amountYuan: input.amountYuan,
    state: "confirmed", revision: 2, submittedAt: input.reviewedAt, reviewedAt: input.reviewedAt,
    reviewedByUserId: ids.director, confirmationNo: input.confirmationNo,
    confirmedContractSource: {
      sourceRecordId: input.versionId, sourceVersion: "1", relationship: "inside",
      contractTypeKey: "labor_subcontract"
    }
  } });

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    const ownerTarget = new URL(process.env.OWNER_DATABASE_URL ?? "");
    const sealedRun = process.env.JG_LINE_A_SEALED_RUN_ID;
    const sealedDatabase = sealedRun && /^[0-9a-f]{32}$/u.test(sealedRun) &&
      target.pathname === `/jg_task01_${sealedRun}` && target.username === `finance_runtime_${sealedRun}` &&
      ownerTarget.username === "jg_task01_owner" && [target, ownerTarget].every(url =>
        url.searchParams.get("sslmode") === "require" && url.searchParams.get("sslaccept") === "strict" &&
        url.searchParams.get("sslcert") === join(process.env.TMPDIR ?? "", "ca.crt"));
    if (process.env.NODE_ENV !== "test" || [target, ownerTarget].some(url =>
      url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1") ||
        target.port !== ownerTarget.port || target.pathname !== ownerTarget.pathname ||
        !(sealedRun ? sealedDatabase : target.pathname.endsWith("_line_a_real_db"))) {
      throw new Error("LINE_A_ISOLATED_DATABASE_REQUIRED");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    owner = new PrismaClient({ datasources: { db: { url: ownerTarget.href } } });
    if (paymentRemainder || upwardArchive || historicalSettlement) {
      const [ledger] = await owner.$queryRaw<Array<{ count: bigint; terminal: string }>>`
        SELECT count(*), max(migration_name) AS terminal
        FROM public._prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      const expectedLedger = historicalSettlement
        ? { count: 334n, terminal: "20261129003000_historical_signed_settlement_continuation" }
        : upwardArchive
          ? { count: 332n, terminal: "20261129001000_contract_upward_archive_verifier_pin_forward" }
          : { count: 331n, terminal: "20261129000000_payment_remaining_withdrawal" };
      expect(ledger).toEqual(expectedLedger);
    }

    const passwordHash = await hash(password, 4);
    const operatingDate = new Date();
    operatingDate.setUTCDate(operatingDate.getUTCDate() - 40);
    await owner.user.createMany({ data: Object.values(ids).filter(id => id.startsWith("linea-user-")).map((id, index) => ({
      id, name: `隔离用户${index + 1}`, phone: Object.values(phones)[index], passwordHash,
      mustChangePassword: false, isActive: true
    })) });
    await owner.project.create({ data: { id: ids.project, code: "LINEA-PROJECT", name: "隔离真库项目", isActive: true } });
    await owner.position.createMany({ data: [
      { key: "contract_director", name: "合同部主管" },
      { key: "contract_staff", name: "合同员" },
      { key: "project_manager", name: "项目经理" },
      { key: "finance_staff", name: "财务" },
      { key: "finance_director", name: "财务主管" },
      { key: "comprehensive_director", name: "综合部主管" },
      { key: "chairman", name: "董事长" }
    ], skipDuplicates: true });
    const positions = await owner.position.findMany({ where: { key: { in: ["contract_director", "contract_staff", "project_manager", "finance_staff", "finance_director", "comprehensive_director", "chairman"] } } });
    const positionId = (key: string) => positions.find(position => position.key === key)!.id;
    await owner.userPosition.createMany({ data: [
      { userId: ids.director, positionId: positionId("contract_director"), projectId: null },
      { userId: ids.finance, positionId: positionId("finance_staff"), projectId: null },
      { userId: ids.finance, positionId: positionId("finance_director"), projectId: null }
    ] });
    await owner.projectMember.createMany({ data: [
      { projectId: ids.project, userId: ids.staff, positionKey: "contract_staff" },
      { projectId: ids.project, userId: ids.staff, positionKey: "comprehensive_director" },
      { projectId: ids.project, userId: ids.manager, positionKey: "project_manager" },
      { projectId: ids.project, userId: ids.managerPeer, positionKey: "project_manager" },
      { projectId: ids.project, userId: ids.finance, positionKey: "finance_staff" },
      { projectId: ids.project, userId: ids.director, positionKey: "chairman" }
    ] });

    await owner.companyEntity.create({ data: { id: ids.company, name: "隔离参与公司", unifiedSocialCreditCode: "91350100LINEA00001",
      registeredAddress: "福建省福州", dataStatus: "complete", currentVersionNo: 1, isActive: true } });
    await owner.companyEntityVersion.create({ data: { id: ids.companyVersion, companyEntityId: ids.company, versionNo: 1,
      name: "隔离参与公司", unifiedSocialCreditCode: "91350100LINEA00001", registeredAddress: "福建省福州", isActive: true,
      action: "create", actorUserId: ids.director, actorRoleKey: "contract_director" } });
    await owner.projectParticipatingCompany.create({ data: { id: ids.participating, projectId: ids.project,
      companyEntityId: ids.company, companyEntityVersionId: ids.companyVersion, companyNameSnapshot: "隔离参与公司",
      companyCreditCodeSnapshot: "91350100LINEA00001", effectiveFrom: operatingDate, changeReason: "隔离真库验证",
      addedByUserId: ids.director } });
    await owner.businessParty.createMany({ data: [
      { id: ids.affiliate, type: "organization", name: "隔离施工企业", normalizedName: "隔离施工企业",
        unifiedSocialCreditCode: "91350100LINEA00002", status: "active", createdByUserId: ids.director },
      { id: ids.counterparty, type: "organization", name: "隔离相对方", normalizedName: "隔离相对方",
        unifiedSocialCreditCode: "91350100LINEA00003", status: "active", createdByUserId: ids.director }
    ] });
    await owner.businessPartyVersion.createMany({ data: [
      { id: ids.affiliateVersion, businessPartyId: ids.affiliate, versionNo: 1, createdByUserId: ids.director,
        snapshot: { type: "organization", name: "隔离施工企业" } },
      { id: ids.counterpartyVersion, businessPartyId: ids.counterparty, versionNo: 1, createdByUserId: ids.director,
        snapshot: { type: "organization", name: "隔离相对方" } }
    ] });
    await owner.projectAffiliateAssignment.create({ data: { id: ids.assignment, projectId: ids.project,
      businessPartyId: ids.affiliate, businessPartyVersionId: ids.affiliateVersion, affiliateNameSnapshot: "隔离施工企业",
      affiliateCreditCodeSnapshot: "91350100LINEA00002", effectiveFrom: operatingDate, changeReason: "隔离真库验证",
      assignedByUserId: ids.director } });
    await owner.project.update({ where: { id: ids.project }, data: { operatingLedgerEffectiveDate: operatingDate } });

    const effectiveAt = new Date();
    effectiveAt.setUTCDate(effectiveAt.getUTCDate() - 1);
    const contractBase = {
      projectId: ids.project, counterparty: "隔离相对方", ownerUserId: ids.director,
      companyEntityId: ids.company, companyEntityName: "隔离参与公司"
    };
    await owner.contract.createMany({ data: [
      { id: ids.contractA, code: "LINEA-HT-A", name: "隔离下游合同", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractB, code: "LINEA-HT-B", name: "隔离其他合同", contractTypeKey: "generic_contract", ...contractBase },
      { id: ids.contractC, code: "LINEA-HT-C", name: "隔离框架其他合同", contractTypeKey: "other", ...contractBase },
      { id: ids.contractD, code: "LINEA-HT-D", name: "隔离已签结算付款合同D", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractE, code: "LINEA-HT-E", name: "隔离付款并发合同E", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractF, code: "LINEA-HT-F", name: "隔离调减暂停合同F", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractG, code: "LINEA-HT-G", name: "隔离负结算竞争合同", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractH, code: "LINEA-HT-H", name: "隔离历史结算承接合同", contractTypeKey: "labor_subcontract", ...contractBase },
      { id: ids.contractI, code: "LINEA-HT-I", name: "隔离四位结算合同", contractTypeKey: "labor_subcontract", ...contractBase },
      ...(paymentRemainder ? [{ id: ids.contractJ, code: "LINEA-HT-J", name: "隔离余款重审合同", contractTypeKey: "labor_subcontract", ...contractBase }] : [])
    ] });
    const versionBase = {
      changeType: "original", status: "effective", amountCents: 1_000_000n, numericProtocolVersion: 1,
      effectiveAt, pricingNature: "fixed_total", amountLimitType: "capped", settlementMode: "settlement_required",
      settlementModeSource: "contract_director", settlementModeConfirmedByUserId: ids.director,
      settlementModeConfirmedAt: effectiveAt,
      signingSubjectType: "our_company", companyEntityIdSnapshot: ids.company,
      companyEntityVersionId: ids.companyVersion, companyEntityNameSnapshot: "隔离参与公司",
      companyEntityCreditCodeSnapshot: "91350100LINEA00001", draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    };
    await owner.contractVersion.createMany({ data: [
      { id: ids.versionA, contractId: ids.contractA, versionNo: 1, ...versionBase },
      { id: ids.versionB, contractId: ids.contractB, versionNo: 1, ...versionBase },
      { id: ids.versionC, contractId: ids.contractC, versionNo: 1, ...versionBase,
        amountCents: 0n, amountLimitType: "unlimited", pricingNature: "framework" },
      { id: ids.versionD, contractId: ids.contractD, versionNo: 1, ...versionBase },
      { id: ids.versionE, contractId: ids.contractE, versionNo: 1, ...versionBase },
      { id: ids.versionF, contractId: ids.contractF, versionNo: 1, ...versionBase },
      { id: ids.versionG, contractId: ids.contractG, versionNo: 1, ...versionBase },
      { id: ids.versionH, contractId: ids.contractH, versionNo: 1, ...versionBase },
      { id: ids.versionI, contractId: ids.contractI, versionNo: 1, ...versionBase },
      ...(paymentRemainder ? [{ id: ids.versionJ, contractId: ids.contractJ, versionNo: 1, ...versionBase }] : [])
    ] });
    await owner.paymentTermsVersion.createMany({ data: [
      { id: "linea-terms-a", contractId: ids.contractA, contractVersionId: ids.versionA, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      { id: "linea-terms-b", contractId: ids.contractB, contractVersionId: ids.versionB, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：验收后三十日支付" },
      { id: "linea-terms-c", contractId: ids.contractC, contractVersionId: ids.versionC, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：按实际完成工作确认" },
      { id: "linea-terms-d", contractId: ids.contractD, contractVersionId: ids.versionD, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      { id: "linea-terms-e", contractId: ids.contractE, contractVersionId: ids.versionE, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      { id: "linea-terms-f", contractId: ids.contractF, contractVersionId: ids.versionF, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：按累计结算的 80% 支付" },
      { id: "linea-terms-h", contractId: ids.contractH, contractVersionId: ids.versionH, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      { id: "linea-terms-i", contractId: ids.contractI, contractVersionId: ids.versionI, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      ...(paymentRemainder ? [{ id: "linea-terms-j", contractId: ids.contractJ, contractVersionId: ids.versionJ, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" }] : [])
    ] });
    await owner.contractPartySnapshot.createMany({ data: [
      { contractVersionId: ids.versionA, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } },
      { contractVersionId: ids.versionB, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } },
      { contractVersionId: ids.versionC, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } },
      ...[ids.versionF, ids.versionG, ids.versionH, ids.versionI, ...(paymentRemainder ? [ids.versionJ] : [])].map(contractVersionId => ({
        contractVersionId, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" }
      }))
    ] });

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const storageRoot = process.env.FILE_STORAGE_ROOT!;
    const objectKey = "uploads/line-a/change-appendix.pdf";
    await mkdir(join(storageRoot, "uploads/line-a"), { recursive: true, mode: 0o700 });
    await writeFile(join(storageRoot, objectKey), pdfBytes, { mode: 0o600 });
    changeAppendixFileId = randomUUID();
    await owner.fileObject.create({ data: { id: changeAppendixFileId, bucket: "private-local", objectKey,
      originalName: "补充协议.pdf", mimeType: "application/pdf", sizeBytes: pdfBytes.length,
      uploadedByUserId: ids.staff, contentSha256: sha(pdfBytes), storageStatus: "active" } });

    await owner.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash")
      VALUES (1, public.crypt(${process.env.OPERATING_LEDGER_DB_WRITE_SECRET!}, public.gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    for (const actor of Object.keys(phones) as Array<keyof typeof phones>) {
      const response = await fetch(`${base}/auth/login`, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phones[actor], password }) });
      const payload = await response.json();
      if (response.status !== 201) throw new Error(`LINE_A_LOGIN ${actor} -> ${response.status}`);
      tokens.set(actor, payload.tokens.accessToken);
    }
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
  });

  if (process.env.RUN_LINE_A_TEXT_DIRECT_330 === "1") it("preserves contract amounts and payment history after reviewed supplements (A09)", async () => {
    const agreement = "完成服务经双方确认后支付";
    const supplement = "补充协议约定按合同总价的 5% 核对付款";
    const actualDays = new Date();
    actualDays.setUTCDate(actualDays.getUTCDate() - 1);
    const seed = async (name: string, knownLimit: boolean) => {
      const contract = await owner.contract.create({ data: {
        projectId: ids.project, ownerUserId: ids.director, code: "LINEA-TEXT-" + name,
        name: "隔离零阶段服务合同", counterparty: "隔离相对方", contractTypeKey: "other",
        companyEntityId: ids.company, companyEntityName: "隔离参与公司"
      } });
      const version = await owner.contractVersion.create({ data: {
        contractId: contract.id, versionNo: 1, changeType: "original", status: "effective", effectiveAt: actualDays,
        numericProtocolVersion: 2, amountCents: knownLimit ? 60_000n : 0n, amountYuan: knownLimit ? "600.0000" : null,
        pricingNature: knownLimit ? "fixed_total" : "framework", amountLimitType: knownLimit ? "capped" : "unlimited",
        settlementMode: "direct_payment", settlementModeSource: "contract_director",
        settlementModeConfirmedByUserId: ids.director, settlementModeConfirmedAt: actualDays,
        signingSubjectType: "our_company", companyEntityIdSnapshot: ids.company,
        companyEntityVersionId: ids.companyVersion, companyEntityNameSnapshot: "隔离参与公司",
        companyEntityCreditCodeSnapshot: "91350100LINEA00001", draftData: {}, templateSnapshot: {}, clauseSnapshot: []
      } });
      const terms = await owner.paymentTermsVersion.create({ data: {
        contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "effective", originalText: agreement
      } });
      return { contract, version, terms };
    };

    const capped = await seed("CAPPED", true);
    const uncapped = await seed("UNKNOWN", false);
    const preview = (versionId: string) => call("staff", "/payments/contract-application?contractVersionId=" + versionId);
    const start = await preview(capped.version.id);
    expect(start.body).toMatchObject({ paymentMode: "text_agreement", availableStages: [],
      capacity: { maxRequestableCents: "60000", duePayableCents: null },
      textAgreement: { paymentTermsVersionId: capped.terms.id, agreementText: agreement } });
    expect((await preview(uncapped.version.id)).body).toMatchObject({
      paymentMode: "text_agreement", availableStages: [],
      capacity: { maxRequestableCents: null, duePayableCents: null },
      genericContractCapacity: { contractAmountCents: null, contractRemainingCents: null }
    });
    const input = {
      sourceType: "contract_due", contractVersionId: capped.version.id, paymentTermsVersionId: capped.terms.id,
      expectedAgreementFingerprint: start.body.textAgreement.fingerprint,
      paymentMatter: "实际巡检服务", amountCalculationExplanation: "按工单核对的服务费用"
    };
    const simultaneous = await Promise.all(["A", "B"].map(key => callRaw("staff", "/payments", {
      ...input, code: "LINEA-TEXT-RACE-" + key, requestedAmountCents: "40000"
    })));
    expect(simultaneous.map(result => result.status).sort()).toEqual([201, 400]);
    const approvedCapacity = await owner.paymentRequest.findMany({ where: { contractId: capped.contract.id } });
    expect(approvedCapacity).toHaveLength(1);
    expect(approvedCapacity[0]).toMatchObject({
      status: "approval_pending", requestedAmountCents: 40_000n, paidAmountCents: 0n,
      approvedAmountCents: null, contractDueBasis: "text_agreement_v1", paymentTermsStageId: null, settlementId: null
    });
    const firstId = approvedCapacity[0].id;
    const firstPath = "/payments/" + firstId;
    const before = await call("staff", firstPath);
    expect(before.status).toBe(200);
    expect(readBaseInfo(before.body, "付款约定原文")).toBe(agreement);
    expect(await owner.paymentRequestAgreementSnapshot.findUnique({ where: { paymentRequestId: firstId } })).toMatchObject({ agreementText: agreement });

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const uploadAppendix = async (name: string) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
      const upload = await fetch(`${base}/files`, {
        method: "POST", headers: { authorization: `Bearer ${tokens.get("staff")}` }, body: form
      });
      expect(upload.status).toBe(201);
      return await upload.json() as { id: string };
    };
    const appendix = await uploadAppendix("零阶段合同已签补充协议.pdf");
    const pending = await call("staff", "/contracts/" + capped.version.id + "/signed-changes", {
      fileId: appendix.id, summary: "核对零阶段服务合同付款约定",
      amountDeltaYuan: "0.0000", paymentAgreementText: supplement
    });
    expect(pending.status).toBe(201);
    expect((await call("director", "/contracts/" + capped.version.id + "/signed-changes/" + pending.body.id + "/review", {
      decision: "approve"
    })).body.status).toBe("approved");
    const after = await call("staff", firstPath);
    expect(after.body.meta).toContainEqual({ label: "付款约定", value: "约定已更新，请核对提交时和最新约定" });
    expect(readBaseInfo(after.body, "提交时付款约定")).toBe(agreement);
    expect(readBaseInfo(after.body, "最新付款约定")).toBe(supplement);
    expect(readBaseInfo(after.body, "申请金额")).toBe(readBaseInfo(before.body, "申请金额"));
    expect(await owner.paymentRequest.findUnique({ where: { id: firstId } })).toEqual(approvedCapacity[0]);
    expect(await owner.paymentRequestAgreementSnapshot.findUnique({ where: { paymentRequestId: firstId } })).toMatchObject({ agreementText: agreement });
    const stale = await callRaw("staff", "/payments", { ...input, code: "LINEA-TEXT-STALE", requestedAmountCents: "10000" });
    expect(stale.status).toBe(409);
    const next = await preview(capped.version.id);
    expect(next.body).toMatchObject({ textAgreement: { paymentTermsVersionId: capped.terms.id, agreementText: supplement },
      capacity: { maxRequestableCents: "20000" } });
    expect(next.body.textAgreement.fingerprint).not.toBe(input.expectedAgreementFingerprint);
    const current = await call("staff", "/payments", {
      ...input, code: "LINEA-TEXT-FRESH", requestedAmountCents: "10000", expectedAgreementFingerprint: next.body.textAgreement.fingerprint
    });
    expect(current.status).toBe(201);
    const request = await owner.paymentRequest.findUniqueOrThrow({ where: { code: "LINEA-TEXT-FRESH" } });
    expect(await owner.paymentRequestAgreementSnapshot.findUnique({ where: { paymentRequestId: request.id } })).toMatchObject({ agreementText: supplement });
    const framework = "/contracts/" + uncapped.version.id + "/signed-changes";
    const frameworkAppendix = await uploadAppendix("框架服务范围补充协议.pdf");
    const submitted = await call("staff", framework, {
      fileId: frameworkAppendix.id, summary: "增补巡检服务范围，单价变更为每次六十元", amountDeltaYuan: "0.0000"
    });
    expect(submitted.body).toMatchObject({ status: "pending_review", precedingAmountYuan: null, effectiveAmountYuan: null });
    expect((await call("director", `${framework}/${submitted.body.id}/review`, { decision: "approve" })).body.status).toBe("approved");
    expect((await call("staff", framework)).body).toMatchObject({
      originalAmountYuan: null, effectiveAmountYuan: null,
      changes: [expect.objectContaining({ id: submitted.body.id, status: "approved", effectiveAmountYuan: null })]
    });
    expect((await preview(uncapped.version.id)).body.genericContractCapacity).toMatchObject({
      contractAmountCents: null, contractRemainingCents: null
    });
    expect(await owner.paymentTermsStage.count({ where: { paymentTermsVersionId: { in: [capped.terms.id, uncapped.terms.id] } } })).toBe(0);
    expect(await owner.settlement.count({ where: { contractId: { in: [capped.contract.id, uncapped.contract.id] } } })).toBe(0);
  });

  it("reads an effective contract through both candidate read functions", async () => {
    const initial = await call("staff", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    expect(initial.status).toBe(200);
    expect(readBaseInfo(initial.body, "合同金额")).toBe("¥10,000.00");
    expect(readBaseInfo(initial.body, "发票类型")).toBe("未明确");
    expect(readBaseInfo(initial.body, "合同税率")).toBe("未明确");

    const tax = await call("staff", `/contracts/${ids.versionA}/tax-revisions`, {
      invoiceType: "vat_special", taxRate: "9", explanation: "隔离真库补充原空税率"
    });
    expect(tax.status).toBe(201);
    expect(tax.body.status).toBe("confirmed");

    const afterTax = await call("staff", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    expect(readBaseInfo(afterTax.body, "发票类型")).toBe("增值税专用发票");
    expect(readBaseInfo(afterTax.body, "合同税率")).toBe("9%");
  });

  it("submits and approves a signed change with the provisioned witness", async () => {
    const submitted = await call("staff", `/contracts/${ids.versionA}/signed-changes`, {
      fileId: changeAppendixFileId, summary: "隔离真库补充协议", amountDeltaYuan: "500.0000",
      paymentAgreementText: "补充协议约定第二期付款延后三十日"
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("pending_review");
    expect(submitted.body.effectiveAmountYuan).toBe("10500.0000");
    contractChangeId = submitted.body.id;

    const pending = await call("director", `/contracts/${ids.versionA}/signed-changes`);
    expect(pending.status).toBe(200);
    expect(pending.body.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: contractChangeId, status: "pending_review" })
    ]));

    const approved = await call("director", `/contracts/${ids.versionA}/signed-changes/${contractChangeId}/review`, {
      decision: "approve"
    });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("approved");

    const detail = await call("staff", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    expect(readBaseInfo(detail.body, "合同金额")).toBe("¥10500.0000");
    expect(readBaseInfo(detail.body, "原版本合同金额")).toBe("¥10,000.00");

    const audit = await owner.auditLog.findFirst({ where: { businessId: ids.versionA, action: "contract.signed_change.approve" } });
    expect(audit?.actorUserId).toBe(ids.director);
  });

  it("registers, returns and confirms a signed settlement with private originals (A10)", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const form = new FormData();
    form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "已签结算.pdf");
    const upload = await fetch(`${base}/projects/${ids.project}/signed-contract-settlements/files`, {
      method: "POST", headers: { authorization: `Bearer ${tokens.get("staff")}` }, body: form
    });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json();
    const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
    const photoForm = new FormData();
    photoForm.append("file", new Blob([photo], { type: "image/png" }), "已签结算照片.png");
    const photoUpload = await fetch(`${base}${settlementPath}/files`, {
      method: "POST", headers: { authorization: `Bearer ${tokens.get("staff")}` }, body: photoForm
    });
    expect(photoUpload.status).toBe(201);
    const uploadedPhoto = await photoUpload.json();
    const fileIds = [uploaded.id, uploadedPhoto.id];

    const created = await call("staff", `/projects/${ids.project}/signed-contract-settlements`, {
      contractKind: "downstream", contractId: ids.contractA, number: "LINEA-JS-001",
      amountYuan: "1000.0000", fileIds
    });
    expect(created.status).toBe(201);
    expect(created.body.state).toBe("draft");
    settlementId = created.body.id;

    const submitted = await call("staff", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/submission`,
      { revision: created.body.revision });
    expect(submitted.body.state).toBe("pending_review");

    const returned = await call("director", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/review`,
      { revision: submitted.body.revision, decision: "return", reason: "请核对本期金额" });
    expect(returned.body.state).toBe("returned");

    const resaved = await call("staff", `/projects/${ids.project}/signed-contract-settlements/${settlementId}`, {
      revision: returned.body.revision, contractKind: "downstream", contractId: ids.contractA,
      number: "LINEA-JS-001", amountYuan: "1000.0000", fileIds
    }, "PATCH");
    expect(resaved.body.state).toBe("draft");
    const resubmitted = await call("staff", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/submission`,
      { revision: resaved.body.revision });
    const confirmed = await call("director", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/review`,
      { revision: resubmitted.body.revision, decision: "confirm" });
    expect(confirmed.body.state).toBe("confirmed");
    expect(confirmed.body.confirmationNo).toBe("1");

    const duplicate = await newSignedDraft(ids.contractA, "LINEA-JS-001", "0.0000");
    expect(duplicate.duplicateNumber).toBe(true);
    const zero = await callRaw("staff", `${settlementPath}/${duplicate.id}/submission`, { revision: duplicate.revision });
    expect(zero).toMatchObject({ status: 400, body: { message: expect.stringContaining("非零本期金额") } });
    const editedDuplicate = await call("staff", `${settlementPath}/${duplicate.id}`, {
      revision: duplicate.revision, contractKind: "downstream", contractId: ids.contractA,
      number: "LINEA-JS-001", amountYuan: "1.0000", fileIds: [duplicate.fileId]
    }, "PATCH");
    const submittedDuplicate = await call("staff", `${settlementPath}/${duplicate.id}/submission`, {
      revision: editedDuplicate.body.revision
    });
    expect(submittedDuplicate.body).toMatchObject({ state: "pending_review", duplicateNumber: true });
    const replaceConfirmed = await callRaw("staff", `${settlementPath}/${settlementId}`, {
      revision: confirmed.body.revision, contractKind: "downstream", contractId: ids.contractA,
      number: "LINEA-JS-001", amountYuan: "1000.0000", fileIds: [uploaded.id]
    }, "PATCH");
    expect(replaceConfirmed.status).toBe(409);
    const originals = await owner.signedContractSettlementAttachment.findMany({
      where: { settlementId }, select: { fileId: true, sha256: true }
    });
    expect(originals).toHaveLength(2);
    expect(originals).toEqual(expect.arrayContaining([
      { fileId: uploaded.id, sha256: sha(pdfBytes) },
      { fileId: uploadedPhoto.id, sha256: sha(photo) }
    ]));
    if (paymentRemainder) {
      const reason = "隔离核对已签结算原件";
      const files = [
        { id: uploaded.id, mime: "application/pdf", bytes: pdfBytes },
        { id: uploadedPhoto.id, mime: "image/png", bytes: photo }
      ];
      for (const file of files) {
        const body = { downloadReason: reason, accessMode: "download" };
        const wrongSettlement = await callRaw("staff",
          `${settlementPath}/${duplicate.id}/attachments/${file.id}/download-ticket`, body);
        expect(wrongSettlement.status).toBe(403);

        const path = `${settlementPath}/${settlementId}/attachments/${file.id}/download-ticket`;
        expect((await callRaw("manager", path, body)).status).toBe(403);
        const ticket = await call("staff", path, body);
        expect(ticket).toMatchObject({ status: 201, body: {
          fileId: file.id, mimeType: file.mime, sizeBytes: file.bytes.length
        } });
        const url = new URL(ticket.body.downloadUrl, base);
        const readAs = (actor: string) => fetch(url, { headers: { authorization: `Bearer ${tokens.get(actor)}` } });
        expect((await readAs("manager")).status).toBe(400);
        const downloaded = await readAs("staff");
        expect(downloaded.status).toBe(200);
        expect(downloaded.headers.get("content-type")).toBe(file.mime);
        expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
        expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(file.bytes);
        const audits = await owner.auditLog.findMany({
          where: { businessId: file.id, action: { in: ["file.download.ticket", "file.download"] } },
          select: { actorUserId: true, action: true }, orderBy: { action: "asc" }
        });
        expect(audits).toEqual([
          { actorUserId: ids.staff, action: "file.download" },
          { actorUserId: ids.staff, action: "file.download.ticket" }
        ]);
      }
    }

    const basis = await call("staff", `/projects/${ids.project}/signed-contract-settlements/payment-basis?contractKind=downstream&contractId=${ids.contractA}`);
    expect(basis.status).toBe(200);
    expect(basis.body.latestConfirmed).toMatchObject({ amountYuan: "1000.0000" });
    expect(basis.body.confirmedYuan).toBe("1000.0000");

    // 确认事实同时进入经营账：一次成本、一次应付，不因后续实付重复计成本。
    const signedFact = await owner.operatingFact.findFirst({
      where: { sourceType: "signed_contract_settlement", sourceBusinessId: settlementId }
    });
    expect(signedFact?.amountCents).toBe(100_000n);
    const signedImpacts = await owner.operatingImpactEntry.findMany({ where: { factId: signedFact!.id } });
    expect(signedImpacts).toHaveLength(2);
    expect(signedImpacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ impactKind: "confirmed_cost", amountCents: 100_000n, direction: "increase" }),
      expect.objectContaining({ impactKind: "payable_increase", amountCents: 100_000n, direction: "increase" })
    ]));
  });

  const settlementPath = `/projects/${ids.project}/signed-contract-settlements`;
  async function newSignedDraft(contractId: string, number: string, amountYuan: string) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.setTitle(number);
    const original = new Uint8Array(await pdf.save());
    const form = new FormData();
    form.append("file", new Blob([original], { type: "application/pdf" }), `${number}.pdf`);
    const upload = await fetch(`${base}${settlementPath}/files`, {
      method: "POST", headers: { authorization: `Bearer ${tokens.get("staff")}` }, body: form
    });
    expect(upload.status).toBe(201);
    const { id: fileId } = await upload.json();
    const created = await call("staff", settlementPath, {
      contractKind: "downstream", contractId, number, amountYuan, fileIds: [fileId]
    });
    expect(created.status).toBe(201);
    expect(created.body.state).toBe("draft");
    return {
      id: created.body.id as string, revision: created.body.revision as number,
      duplicateNumber: created.body.duplicateNumber as boolean, fileId: fileId as string
    };
  }

  it("serializes two -8 yuan settlements at both submission and review (A11)", async () => {
    const initial = await newSignedDraft(ids.contractG, "LINEA-G-10", "10.0000");
    const initialSubmission = await call("staff", `${settlementPath}/${initial.id}/submission`, { revision: initial.revision });
    expect(initialSubmission.body.state).toBe("pending_review");
    const initialReview = await call("director", `${settlementPath}/${initial.id}/review`, {
      revision: initialSubmission.body.revision, decision: "confirm"
    });
    expect(initialReview.body.state).toBe("confirmed");
    const drafts = [
      await newSignedDraft(ids.contractG, "LINEA-G-NEG-1", "-8.0000"),
      await newSignedDraft(ids.contractG, "LINEA-G-NEG-2", "-8.0000")
    ];
    const submitted = await Promise.all(drafts.map(draft =>
      callRaw("staff", `${settlementPath}/${draft.id}/submission`, { revision: draft.revision })
    ));
    expect(submitted.map(result => result.status).sort()).toEqual([201, 409]);
    expect(submitted.find(result => result.status === 409)?.body.message).toContain("已确认金额不足以冲减");

    const rejectedDraft = drafts[submitted.findIndex(result => result.status === 409)]!;
    const accepted = drafts[submitted.findIndex(result => result.status === 201)]!;
    expect(await owner.signedContractSettlement.findUniqueOrThrow({ where: { id: rejectedDraft.id } }))
      .toMatchObject({ state: "draft", revision: rejectedDraft.revision, submittedAt: null });
    expect(await owner.auditLog.count({
      where: { action: "settlement.signed_submitted", businessId: { in: drafts.map(draft => draft.id) } }
    })).toBe(1);

    // Seed an inherited pending record to exercise the independent review guard
    // even though current submission rules already prevent two live pending rows.
    const inherited = await owner.signedContractSettlement.update({
      where: { id: rejectedDraft.id },
      data: { state: "pending_review", submittedAt: new Date(), revision: { increment: 1 } }
    });
    const reviewInputs = [
      { id: accepted.id, revision: submitted.find(result => result.status === 201)!.body.revision as number },
      { id: inherited.id, revision: inherited.revision }
    ];
    const confirm = (draft: typeof reviewInputs[number]) =>
      callRaw("director", `${settlementPath}/${draft.id}/review`, { revision: draft.revision, decision: "confirm" });
    const review = await Promise.all(reviewInputs.map(confirm));
    expect(review.map(result => result.status).sort()).toEqual([201, 409]);
    const pending = reviewInputs[review.findIndex(result => result.status === 409)]!;
    // The racing request can first hit a transaction conflict. Once the
    // winner has settled, the losing original revision must fail the cap.
    const confirmation = await confirm(pending);
    expect(confirmation.status).toBe(409);
    expect(confirmation.body.message).toContain("累计结算不得小于零");
    expect(await owner.signedContractSettlement.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ state: "pending_review", revision: pending.revision, reviewedAt: null });
    const overview = await call("staff", `${settlementPath}/contract-overview?contractKind=downstream&contractId=${ids.contractG}`);
    expect(overview.body.confirmedYuan).toBe("2.0000");
    expect(review.find(result => result.status === 201)?.body).toMatchObject({ state: "confirmed", amountYuan: "-8.0000" });
    expect(await owner.auditLog.count({
      where: { action: "settlement.signed_confirmed", businessId: { in: drafts.map(draft => draft.id) } }
    })).toBe(1);
  });

  it("counts a 60 yuan legacy settlement and a 10 yuan signed settlement once each (A11)", async () => {
    const legacy = await owner.settlement.create({ data: {
      id: "linea-legacy-settlement-h", projectId: ids.project, contractId: ids.contractH,
      contractVersionId: ids.versionH, paymentTermsVersionId: "linea-terms-h",
      code: "LINEA-JS-LEGACY-H", periodLabel: "隔离历史一期", status: "effective",
      amountCents: 6_000n, payableAmountCents: 6_000n, paidAmountCents: 0n
    } });
    const overviewPath = `${settlementPath}/contract-overview?contractKind=downstream&contractId=${ids.contractH}`;
    expect((await call("staff", overviewPath)).body.confirmedYuan).toBe("60.0000");

    const draft = await newSignedDraft(ids.contractH, "LINEA-H-NEW-10", "10.0000");
    const submitted = await call("staff", `${settlementPath}/${draft.id}/submission`, { revision: draft.revision });
    expect(submitted.body.state).toBe("pending_review");
    expect((await call("staff", overviewPath)).body.confirmedYuan).toBe("60.0000");
    const reviewed = await call("director", `${settlementPath}/${draft.id}/review`, {
      revision: submitted.body.revision, decision: "confirm"
    });
    expect(reviewed.body).toMatchObject({ id: draft.id, state: "confirmed", amountYuan: "10.0000" });
    expect((await call("staff", overviewPath)).body.confirmedYuan).toBe("70.0000");
    expect(await owner.settlement.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await owner.signedContractSettlement.count({ where: { contractId: ids.contractH, state: "confirmed" } })).toBe(1);
  });

  it("rounds the confirmed cumulative once and reads a paid balance without a tail (A02)", async () => {
    const confirmAmount = async (number: string, amountYuan: string) => {
      const draft = await newSignedDraft(ids.contractI, number, amountYuan);
      const submitted = await call("staff", `${settlementPath}/${draft.id}/submission`, { revision: draft.revision });
      expect(submitted.body.state).toBe("pending_review");
      const reviewed = await call("director", `${settlementPath}/${draft.id}/review`, {
        revision: submitted.body.revision, decision: "confirm"
      });
      expect(reviewed.body).toMatchObject({ state: "confirmed", amountYuan });
      return draft.id;
    };
    const firstId = await confirmAmount("LINEA-JS-I-ROUNDING", "100.0050");

    const basisPath = `${settlementPath}/payment-basis?contractKind=downstream&contractId=${ids.contractI}`;
    const before = await call("staff", basisPath);
    expect(before.body).toMatchObject({
      confirmedYuan: "100.0050",
      downstreamCapacity: { unoccupiedYuan: "100.0050", wholeCentLimit: "10001" }
    });

    // Restore an already recorded payment to exercise the read model over existing facts.
    const paid = await owner.paymentRequest.create({ data: {
      projectId: ids.project, signedSettlementId: firstId, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "100.0050", signedSettlementContractConfirmedYuan: "100.0050",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: new Date(),
      sourceType: "signed_settlement", contractId: ids.contractI, contractVersionId: ids.versionI,
      paymentTermsVersionId: "linea-terms-i", code: "LINEA-FK-I-ROUNDING",
      status: "paid", requestedAmountCents: 10_001n, approvedAmountCents: 10_001n,
      paidAmountCents: 10_001n, paymentSubjectType: "our_company"
    } });
    const after = await call("staff", basisPath);
    expect(after.body).toMatchObject({
      confirmedYuan: "100.0050",
      latestConfirmed: { id: firstId, amountYuan: "100.0050" },
      downstreamCapacity: {
        recordedPaidYuan: "100.0100", unoccupiedYuan: "0.0000", wholeCentLimit: "0",
        overpayYuan: "0.0000", capacityShortfallYuan: "0.0000", suspended: false
      }
    });
    expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: paid.id } })).toEqual(paid);

    await confirmAmount("LINEA-JS-I-HALF-CENT-1", "0.0050");
    expect((await call("staff", basisPath)).body).toMatchObject({
      confirmedYuan: "100.0100", downstreamCapacity: { wholeCentLimit: "0" }
    });
    await confirmAmount("LINEA-JS-I-HALF-CENT-2", "0.0050");
    expect((await call("staff", basisPath)).body).toMatchObject({
      confirmedYuan: "100.0150", latestConfirmed: { amountYuan: "0.0050" },
      downstreamCapacity: { wholeCentLimit: "1" }
    });
  });

  it("lets the unified registered payment workbench accept the confirmed signed settlement", async () => {
    await owner.paymentRequest.create({ data: {
      id: signedPaymentId, projectId: ids.project, settlementId: null, signedSettlementId: settlementId,
      signedSettlementConfirmationNo: 1n, signedSettlementConfirmedYuan: "1000.0000",
      signedSettlementContractConfirmedYuan: "1000.0000", signedSettlementOccupiedCents: 0n,
      signedSettlementBasisAt: new Date(), sourceType: "signed_settlement", contractId: ids.contractA,
      contractVersionId: ids.versionA, paymentTermsVersionId: "linea-terms-a", code: "LINEA-FK-SIGNED-001",
      status: "approved_pending_payment", requestedAmountCents: 50_000n, approvedAmountCents: 50_000n,
      paidAmountCents: 0n, paymentSubjectType: "our_company"
    } });
    await owner.approvalInstance.create({ data: {
      flowType: "payment.approve", businessType: "payment_request", businessId: signedPaymentId,
      status: "approved", currentNodeIndex: 0, frozenNodes: [], applicantUserId: ids.staff
    } });
    await expect(owner.$transaction(tx =>
      currentRegisteredPaymentDomain(tx as never, signedPaymentId)
    )).resolves.toMatchObject({ supportedDomain: true });
    const registered = app.get(RegisteredPaymentExecutionService);
    const workItems = await registered.workItems(ids.finance);
    expect(workItems.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentId: signedPaymentId, remainingAmountCents: "50000" })
    ]));
  });

  it("counts a paid contract advance against the signed settlement cumulative and audits the rejected over-capacity request (PAY-07/PAY-08)", async () => {
    const reviewedAt = new Date();
    await seedConfirmedSignedSettlement({
      id: "linea-d-signed-20", contractId: ids.contractD, versionId: ids.versionD,
      number: "JS-D-20", amountYuan: "20.0000", confirmationNo: 1n, reviewedAt
    });
    await owner.paymentRequest.create({ data: {
      id: "linea-d-advance-30", projectId: ids.project, settlementId: null,
      sourceType: "contract_advance", contractId: ids.contractD, contractVersionId: ids.versionD,
      paymentTermsVersionId: "linea-terms-d", code: "LINEA-FK-D-ADV-030", status: "paid",
      requestedAmountCents: 3_000n, approvedAmountCents: 3_000n, paidAmountCents: 3_000n,
      paymentSubjectType: "our_company"
    } });

    const basis = await call("staff", `/projects/${ids.project}/signed-contract-settlements/payment-basis?contractKind=downstream&contractId=${ids.contractD}`);
    expect(basis.status).toBe(200);
    expect(basis.body.confirmedYuan).toBe("20.0000");
    expect(basis.body.downstreamCapacity).toMatchObject({
      advancePaidYuan: "30.0000", unsettledAdvanceYuan: "10.0000",
      overpayYuan: "10.0000", abnormalOverpayYuan: "0.0000",
      wholeCentLimit: "0", suspended: true
    });

    const rejected = await callRaw("staff", "/payments", {
      sourceType: "signed_settlement", signedSettlementId: "linea-d-signed-20",
      code: "LINEA-FK-D-OVER-CAP", requestedAmountCents: "1"
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toContain("合同已签结算累计可付金额不足");
    const blocked = await owner.auditLog.findFirst({
      where: { action: "payment.capacity.blocked", businessType: "contract", businessId: ids.contractD }
    });
    expect(blocked?.metadata).toMatchObject({
      reason: "signed_settlement_cumulative_exceeded",
      confirmedCents: "2000", occupiedCents: "3000",
      unsettledAdvanceCents: "1000", suspended: true
    });
  });

  it("allows only one 40 yuan concurrent application after 50 of 90 has been paid (A13/PAY-03)", async () => {
    const signedSettlementId = "linea-e-signed-90";
    await seedConfirmedSignedSettlement({
      id: signedSettlementId, contractId: ids.contractE, versionId: ids.versionE,
      number: "JS-E-90", amountYuan: "90.0000", confirmationNo: 1n, reviewedAt: new Date()
    });
    const previouslyPaid = await owner.paymentRequest.create({ data: {
      id: "linea-e-paid-50", projectId: ids.project, settlementId: null,
      signedSettlementId, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "90.0000", signedSettlementContractConfirmedYuan: "90.0000",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: new Date(),
      sourceType: "signed_settlement", contractId: ids.contractE, contractVersionId: ids.versionE,
      paymentTermsVersionId: "linea-terms-e", code: "LINEA-FK-E-PAID-50",
      status: "paid", requestedAmountCents: 5_000n, approvedAmountCents: 5_000n,
      paidAmountCents: 5_000n, paymentSubjectType: "our_company"
    } });
    const readBasis = () => owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx as never, ids.contractE));
    expect(await readBasis()).toMatchObject({
      confirmedCents: 9_000n, remainingCents: 4_000n, occupiedCents: 5_000n, outstandingCents: 0n
    });

    const applications = await Promise.all(["LINEA-FK-E-CONCURRENT-1", "LINEA-FK-E-CONCURRENT-2"].map(code =>
      callRaw("staff", "/payments", { sourceType: "signed_settlement", signedSettlementId, code, requestedAmountCents: "4000" })
    ));
    expect(applications.map(result => result.status).sort()).toEqual([201, 400]);
    expect(applications.find(result => result.status === 400)?.body.message).toContain("合同已签结算累计可付金额不足");
    const created = await owner.paymentRequest.findMany({
      where: { contractId: ids.contractE, id: { not: previouslyPaid.id } }
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ requestedAmountCents: 4_000n, status: "approval_pending" });
    expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: previouslyPaid.id } })).toEqual(previouslyPaid);
    expect(await readBasis()).toMatchObject({
      confirmedCents: 9_000n, remainingCents: 0n, occupiedCents: 9_000n, outstandingCents: 4_000n, suspended: false
    });
  });

  it("restores payment capacity after a correction and exposes the frozen and current basis (A12/A14)", async () => {
    const confirm = async (number: string, amountYuan: string) => {
      const draft = await newSignedDraft(ids.contractF, number, amountYuan);
      const submitted = await call("staff", `${settlementPath}/${draft.id}/submission`, { revision: draft.revision });
      expect(submitted.body.state).toBe("pending_review");
      const reviewed = await call("director", `${settlementPath}/${draft.id}/review`, {
        revision: submitted.body.revision, decision: "confirm"
      });
      expect(reviewed.body).toMatchObject({ id: draft.id, state: "confirmed", amountYuan });
      return draft.id;
    };
    const original = await confirm("JS-F-100", "100.0000");
    const basisPath = `${settlementPath}/payment-basis?contractKind=downstream&contractId=${ids.contractF}`;
    const pending = await owner.paymentRequest.create({ data: {
      id: "linea-f-pending-80", projectId: ids.project, settlementId: null,
      signedSettlementId: original, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "100.0000", signedSettlementContractConfirmedYuan: "100.0000",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: new Date(),
      sourceType: "signed_settlement", contractId: ids.contractF, contractVersionId: ids.versionF,
      paymentTermsVersionId: "linea-terms-f", code: "LINEA-FK-F-PENDING-080",
      status: "approved_pending_payment", requestedAmountCents: 8_000n, approvedAmountCents: 8_000n,
      paidAmountCents: 0n, paymentSubjectType: "our_company"
    } });

    const before = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx as never, ids.contractF));
    expect(before).toMatchObject({ remainingCents: 2_000n, suspended: false });

    await confirm("JS-F--50", "-50.0000");
    const reduced = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx as never, ids.contractF));
    expect(reduced).toMatchObject({
      confirmedCents: 5_000n, occupiedCents: 8_000n,
      rawRemainingCents: -3_000n, capacityShortfallCents: 3_000n,
      remainingCents: 0n, suspended: true
    });

    expect((await call("staff", basisPath)).body).toMatchObject({
      confirmedYuan: "50.0000", downstreamCapacity: { wholeCentLimit: "0", capacityShortfallYuan: "30.0000", suspended: true }
    });
    const paymentDetailPath = `/payments/${pending.id}`;
    const pauseMessage = expect.stringContaining("相关未付申请已暂停");
    expect((await call("staff", paymentDetailPath)).body.blockedReasons).toEqual(
      expect.arrayContaining([pauseMessage])
    );
    const prior = await confirm("JS-F-+40", "40.0000");
    const restored = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx as never, ids.contractF));
    expect(restored).toMatchObject({
      confirmedCents: 9_000n, occupiedCents: 8_000n,
      rawRemainingCents: 1_000n, remainingCents: 1_000n, suspended: false
    });

    expect((await call("staff", paymentDetailPath)).body.blockedReasons).not.toEqual(
      expect.arrayContaining([pauseMessage])
    );
    expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(pending);

    const latest = await confirm("JS-F--5", "-5.0000");
    const basis = await call("staff", basisPath);
    expect(basis.body).toMatchObject({
      confirmedYuan: "85.0000", latestConfirmed: { id: latest, amountYuan: "-5.0000" },
      downstreamCapacity: { wholeCentLimit: "500", suspended: false },
      paymentAgreementText: "隔离付款约定：按累计结算的 80% 支付"
    });

    const payment = { sourceType: "signed_settlement", code: "LINEA-FK-F-LATEST", requestedAmountCents: "500" };
    const stale = await callRaw("staff", "/payments", { ...payment, signedSettlementId: prior });
    expect(stale).toMatchObject({ status: 409, body: { message: expect.stringContaining("最近确认的一期") } });
    const applied = await call("staff", "/payments", { ...payment, signedSettlementId: latest });
    expect(applied.status).toBe(201);
    const application = await owner.paymentRequest.findUniqueOrThrow({ where: { code: payment.code } });
    expect(application.requestedAmountCents).toBe(500n);

    await confirm("JS-F-+5", "5.0000");
    const detail = await call("staff", `/payments/${application.id}`);
    expect(detail.body.baseInfo).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "依据快照", value: "本期 -5.0000 元 · 发起时合同累计 85.0000 元" }),
      expect.objectContaining({ label: "当前合同累计", value: "90.0000 元 · 最新确认已变化" }),
      expect.objectContaining({ label: "付款约定原文", value: "隔离付款约定：按累计结算的 80% 支付" })
    ]));
  });

  if (paymentRemainder) it("withdraws an approved unpaid remainder and starts a fresh approval within corrected capacity (A14)", async () => {
    const contractId = ids.contractJ;
    const confirm = async (number: string, amountYuan: string) => {
      const draft = await newSignedDraft(contractId, number, amountYuan);
      const submitted = await call("staff", `${settlementPath}/${draft.id}/submission`, { revision: draft.revision });
      await call("director", `${settlementPath}/${draft.id}/review`, { revision: submitted.body.revision, decision: "confirm" });
      return draft;
    };
    const first = await confirm("JS-J-100", "100.0000");
    const prior = await owner.paymentRequest.create({ data: {
      projectId: ids.project, contractId, contractVersionId: ids.versionJ, paymentTermsVersionId: "linea-terms-j",
      code: "LINEA-FK-A14-PREVIOUS", sourceType: "signed_settlement", paymentSubjectType: "our_company",
      signedSettlementId: first.id, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "100.0000", signedSettlementContractConfirmedYuan: "100.0000",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: new Date(),
      status: "partially_paid", requestedAmountCents: 10000n, approvedAmountCents: 10000n, paidAmountCents: 4000n
    } });
    const originalApproval = await owner.approvalInstance.create({ data: {
      flowType: "payment.approve", businessType: "payment_request", businessId: prior.id,
      status: "approved", currentNodeIndex: 0, frozenNodes: [], applicantUserId: ids.staff
    } });
    const corrected = await confirm("JS-J--30", "-30.0000");
    const path = `/payments/${prior.id}/remainder-withdrawal`;
    const request = { expectedUpdatedAt: prior.updatedAt.toISOString(), requestedAmountCents: "3000",
      code: "LINEA-FK-A14-REAPPROVED", reason: "隔离复核调减后的付款余款" };
    expect((await callRaw("manager", path, request)).status).toBe(403);
    expect((await callRaw("staff", path, { ...request, requestedAmountCents: "3100" })).status).toBe(400);
    expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: prior.id } })).toEqual(prior);
    const accepted = await call("staff", path, request);
    expect(accepted).toMatchObject({ status: 201, body: {
      origin: { approvedAmountCents: "10000", paidAmountCents: "4000", remainingWithdrawnCents: "6000" },
      revised: { status: "approval_pending", requestedAmountCents: "3000", signedSettlementId: corrected.id }
    } });
    expect(await owner.approvalInstance.findUniqueOrThrow({ where: { id: originalApproval.id } })).toEqual(originalApproval);
    const revisedId = accepted.body.revised.id;
    expect(await owner.approvalInstance.findFirstOrThrow({ where: { businessId: revisedId } }))
      .toMatchObject({ status: "in_progress", applicantUserId: ids.staff });
    const basis = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx as never, contractId));
    expect(basis).toMatchObject({ confirmedCents: 7000n, occupiedCents: 7000n, outstandingCents: 3000n, suspended: false });
    expect((await callRaw("staff", path, request)).status).toBe(409);
    expect(await owner.auditLog.count({ where: { businessId: prior.id, action: "payment.request.withdraw_remainder" } })).toBe(1);
  });

  it("confirms work completion through three duties and posts one operating cost", async () => {
    const draft = await call("staff", `/contracts/${ids.versionB}/work-completion-drafts`, {
      work: "隔离真库已完成其他合同工作", amountYuan: "18000.0123", requestKey: "linea-work-001"
    });
    expect(draft.status).toBe(201);
    expect(draft.body.exceedsContractAmount).toBe(true);
    workCompletionId = draft.body.id;

    const submitted = await call("staff", `/contracts/${ids.versionB}/work-completions/${workCompletionId}/submission`, undefined, "POST");
    expect(submitted.body.status).toBe("in_approval");
    approvalInstanceId = submitted.body.approvalInstanceId;

    const duties: Array<[keyof typeof phones, number]> = [["director", 0], ["manager", 1], ["finance", 2]];
    const reviews = await Promise.all(duties.map(([actor, dutyIndex]) =>
      call(actor, `/contracts/${ids.versionB}/work-completions/${workCompletionId}/approval`, {
        approvalInstanceId, dutyIndex, decision: "approve"
      })
    ));
    expect(reviews.map(result => result.status)).toEqual([201, 201, 201]);
    expect(reviews.filter(result => result.body.status === "confirmed")).toHaveLength(1);
    const view = await call("staff", `/contracts/${ids.versionB}/work-completions`);
    expect(view.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workCompletionId, status: "confirmed" })
    ]));
    expect(await owner.contractWorkCompletionFact.count({ where: { completionId: workCompletionId } })).toBe(1);
    const fact = await owner.operatingFact.findFirst({ where: { sourceType: "contract_work_completion" } });
    expect(fact?.amountYuan?.toFixed(4)).toBe("18000.0123");
    expect(await owner.operatingImpactEntry.count({ where: { factId: fact!.id, impactKind: "confirmed_cost" } })).toBe(1);
    expect(await owner.auditLog.count({ where: { businessId: workCompletionId, action: "contract.work_completion.approve" } })).toBe(3);
    // 财务同一人同时持有 finance_staff / finance_director：只落一次签字，并按冻结顺序记 finance_staff。
    expect(await owner.approvalActionLog.count({ where: { approvalInstanceId, action: "approve" } })).toBe(3);
    expect(await owner.approvalActionLog.count({ where: { approvalInstanceId,
      metadata: { path: ["nodeIndex"], equals: 2 } } })).toBe(1);
    const financeAction = await owner.approvalActionLog.findFirst({ where: { approvalInstanceId,
      metadata: { path: ["nodeIndex"], equals: 2 } } });
    expect(financeAction).toMatchObject({ actorUserId: ids.finance, approvedRoleKey: "finance_staff" });
  });

  it("returns a rejected work completion, revises it and counts only the latest confirmed round", async () => {
    const draft = await call("staff", `/contracts/${ids.versionB}/work-completion-drafts`, {
      work: "隔离真库待修订工作", amountYuan: "2000.0000", requestKey: "linea-work-002"
    });
    const completionId = draft.body.id;
    const first = await call("staff", `/contracts/${ids.versionB}/work-completions/${completionId}/submission`, undefined, "POST");
    const firstRound = first.body.approvalInstanceId;
    const rejected = await call("manager", `/contracts/${ids.versionB}/work-completions/${completionId}/approval`, {
      approvalInstanceId: firstRound, dutyIndex: 1, decision: "reject", comment: "请核对已完成工作量"
    });
    expect(rejected.body.status).toBe("draft");

    const returned = await call("staff", `/contracts/${ids.versionB}/work-completions`);
    expect(returned.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completionId, status: "draft", canRevise: true,
        rejectionReason: "请核对已完成工作量" })
    ]));

    const revised = await call("staff", `/contracts/${ids.versionB}/work-completions/${completionId}`, {
      work: "隔离真库修正后的工作", amountYuan: "2100.0000"
    }, "PATCH");
    expect(revised.body).toMatchObject({ work: "隔离真库修正后的工作", amountYuan: "2100.0000",
      exceedsContractAmount: false });
    const reviseAudit = await owner.auditLog.findFirst({ where: { businessId: ids.versionB,
      action: "contract.work_completion.draft.revise" }, orderBy: { createdAt: "desc" } });
    expect(reviseAudit?.metadata).toMatchObject({ completionId, previousWork: "隔离真库待修订工作",
      previousAmountYuan: "2000.0000", amountYuan: "2100.0000" });

    const second = await call("staff", `/contracts/${ids.versionB}/work-completions/${completionId}/submission`, undefined, "POST");
    const secondRound = second.body.approvalInstanceId;
    expect(secondRound).not.toBe(firstRound);
    // 旧轮迟到同意被拒绝，旧轮不产生签字，也不产生成本。
    const late = await callRaw("finance", `/contracts/${ids.versionB}/work-completions/${completionId}/approval`, {
      approvalInstanceId: firstRound, dutyIndex: 2, decision: "approve"
    });
    expect(late.status).toBe(409);

    for (const [actor, dutyIndex] of [["director", 0], ["manager", 1], ["finance", 2]] as const) {
      await call(actor, `/contracts/${ids.versionB}/work-completions/${completionId}/approval`, {
        approvalInstanceId: secondRound, dutyIndex, decision: "approve"
      });
    }
    const facts = await owner.contractWorkCompletionFact.findMany({ where: { completionId } });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ approvalInstanceId: secondRound });
    expect(facts[0].amountYuan.toFixed(4)).toBe("2100.0000");
    expect(await owner.approvalActionLog.count({ where: { approvalInstanceId: firstRound, action: "approve" } })).toBe(0);
    expect(await owner.approvalActionLog.count({ where: { approvalInstanceId: firstRound, action: "reject" } })).toBe(1);

    // 已确认不可再修订，已确认事实不可覆盖。
    const blocked = await callRaw("staff", `/contracts/${ids.versionB}/work-completions/${completionId}`, {
      work: "确认后篡改", amountYuan: "1.0000"
    }, "PATCH");
    expect(blocked.status).toBe(409);
    await expect(owner.contractWorkCompletionFact.update({ where: { id: facts[0].id },
      data: { amountYuan: 1 } })).rejects.toThrow();
  });

  it("returns the registration-time settled/paid comparison and still accepts a truthful below-balance supplement", async () => {
    await owner.settlement.create({ data: {
      id: "linea-legacy-settlement", projectId: ids.project, contractId: ids.contractA,
      contractVersionId: ids.versionA, paymentTermsVersionId: "linea-terms-a",
      code: "LINEA-JS-LEGACY-001", periodLabel: "隔离已结算一期", status: "effective",
      amountCents: 100_000n, payableAmountCents: 100_000n, paidAmountCents: 0n
    } });
    const voucherFileId = "linea-payment-voucher";
    await owner.fileObject.create({ data: {
      id: voucherFileId, bucket: "private-local", objectKey: "uploads/line-a/payment-voucher.pdf",
      originalName: "隔离付款凭证.pdf", mimeType: "application/pdf", sizeBytes: 1,
      uploadedByUserId: ids.staff, contentSha256: "a".repeat(64), storageStatus: "active"
    } });
    await owner.paymentExecution.create({ data: {
      id: "linea-payment-execution-1", idempotencyKey: randomUUID(),
      paymentRequestId: signedPaymentId, paymentSubjectType: "our_company",
      companyEntityIdSnapshot: ids.company, companyEntityNameSnapshot: "隔离参与公司",
      companyEntityCreditCodeSnapshot: "91350100LINEA00001", amountCents: 50_000n,
      paidAt: new Date(), executedByUserId: ids.finance, voucherFileId
    } });

    const before = await call("staff", `/contracts/${ids.versionA}/signed-changes`);
    expect(before.body).toMatchObject({
      effectiveAmountYuan: "10500.0000",
      totalEffectiveSettlementYuan: "1000.0000",
      cumulativePaidYuan: "500.0000",
      belowSettled: false,
      belowPaid: false
    });

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const form = new FormData();
    form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "低额补充协议.pdf");
    const upload = await fetch(`${base}/files`, {
      method: "POST", headers: { authorization: `Bearer ${tokens.get("staff")}` }, body: form
    });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json() as { id: string };

    const low = await call("staff", `/contracts/${ids.versionA}/signed-changes`, {
      fileId: uploaded.id, summary: "如实登记减额至低于累计结算与实付", amountDeltaYuan: "-10300.0000"
    });
    expect(low.status).toBe(201);
    expect(low.body).toMatchObject({ status: "pending_review", effectiveAmountYuan: "200.0000" });

    const duplicate = await callRaw("staff", `/contracts/${ids.versionA}/signed-changes`, {
      fileId: uploaded.id, summary: "重复提交", amountDeltaYuan: "0"
    });
    expect(duplicate.status).toBe(409);

    const flagged = await call("director", `/contracts/${ids.versionA}/signed-changes`);
    expect(flagged.body).toMatchObject({
      effectiveAmountYuan: "10500.0000", belowSettled: false, belowPaid: false
    });

    const denied = await callRaw("staff", `/contracts/${ids.versionA}/signed-changes/${low.body.id}/review`, {
      decision: "approve"
    });
    expect(denied.status).toBe(403);

    const approved = await call("director", `/contracts/${ids.versionA}/signed-changes/${low.body.id}/review`, {
      decision: "approve"
    });
    expect(approved.body.status).toBe("approved");

    const after = await call("director", `/contracts/${ids.versionA}/signed-changes`);
    expect(after.body).toMatchObject({
      effectiveAmountYuan: "200.0000", totalEffectiveSettlementYuan: "1000.0000",
      cumulativePaidYuan: "500.0000", belowSettled: true, belowPaid: true
    });

    const audit = await owner.auditLog.findFirst({
      where: { businessId: ids.versionA, action: "contract.signed_change.balance_check" },
      orderBy: { createdAt: "desc" }
    });
    expect(audit?.actorUserId).toBe(ids.staff);
    expect(audit?.metadata).toMatchObject({
      changeId: low.body.id, contractId: ids.contractA, effectiveAmountYuan: "200.0000",
      totalEffectiveSettlementYuan: "1000.0000", cumulativePaidYuan: "500.0000",
      belowSettled: true, belowPaid: true
    });

    const detail = await call("manager", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    const prompt = (detail.body.settlementPayment.summary as Array<{ label: string; value: string }>)
      .find(row => row.label === "合同金额提示");
    expect(prompt?.value).toContain("累计生效结算");
    expect(prompt?.value).toContain("累计实付");
  });

  it("records one signature for a competing duty and one final decision (A03)", async () => {
    const path = `/contracts/${ids.versionB}`;
    const draft = await call("staff", `${path}/work-completion-drafts`, {
      work: "隔离履约并联审批竞争", amountYuan: "3500.0000", requestKey: "linea-work-a03"
    });
    const completionId = draft.body.id;
    const completionPath = `${path}/work-completions/${completionId}`;
    const submitted = await call("staff", `${completionPath}/submission`, undefined, "POST");
    const roundId = submitted.body.approvalInstanceId;
    const review = (actor: keyof typeof phones, dutyIndex: number, decision: "approve" | "reject") =>
      callRaw(actor, `${completionPath}/approval`, {
        approvalInstanceId: roundId, dutyIndex, decision,
        ...(decision === "reject" ? { comment: "隔离复核需补事实" } : {})
      });

    const sameDuty = await Promise.all([review("manager", 1, "approve"), review("managerPeer", 1, "approve")]);
    expect(sameDuty.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await owner.approvalActionLog.count({
      where: { approvalInstanceId: roundId, action: "approve", metadata: { path: ["nodeIndex"], equals: 1 } }
    })).toBe(1);
    expect(await review("director", 0, "approve")).toMatchObject({ status: 201, body: { status: "in_approval" } });
    expect(await owner.contractWorkCompletionFact.count({ where: { completionId } })).toBe(0);

    const finalDecisions = ["approve", "reject"] as const;
    const operatingBefore = await owner.operatingFact.count({ where: { projectId: ids.project, sourceType: "contract_work_completion" } });
    const terminal = await Promise.all(finalDecisions.map(decision => review("finance", 2, decision)));
    expect(terminal.map(result => result.status).sort()).toEqual([201, 409]);
    const winningDecision = finalDecisions[terminal.findIndex(result => result.status === 201)];
    const approved = winningDecision === "approve";
    const finalLogs = await owner.approvalActionLog.findMany({
      where: { approvalInstanceId: roundId, metadata: { path: ["nodeIndex"], equals: 2 } }
    });
    expect(finalLogs).toHaveLength(1);
    expect(finalLogs[0]).toMatchObject({ action: winningDecision, actorUserId: ids.finance });
    if (!approved) expect(finalLogs[0]).toMatchObject({
      signatureFileIdSnapshot: null, signatureSha256Snapshot: null, signatureVersionIdSnapshot: null
    });
    expect(await owner.approvalInstance.findUniqueOrThrow({ where: { id: roundId } }))
      .toMatchObject({ status: approved ? "approved" : "rejected" });
    expect(await owner.contractWorkCompletionFact.count({ where: { completionId } })).toBe(approved ? 1 : 0);
    expect(await owner.operatingFact.count({ where: { projectId: ids.project, sourceType: "contract_work_completion" } }))
      .toBe(operatingBefore + (approved ? 1 : 0));
    expect((await review("finance", 2, "approve")).status).toBe(409);
    expect(await owner.approvalActionLog.count({
      where: { approvalInstanceId: roundId, metadata: { path: ["nodeIndex"], equals: 2 } }
    })).toBe(1);
  });

  it("keeps the original tax value until a correction passes supervisor review", async () => {
    const submitted = await call("staff", `/contracts/${ids.versionA}/tax-revisions`, {
      invoiceType: "vat_general", taxRate: "6", explanation: "原发票类型与税率填错，申请更正"
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("pending_contract_confirmation");

    const pending = await call("staff", `/contracts/${ids.versionA}/tax-revisions`);
    expect(pending.body.current).toMatchObject({ invoiceType: "vat_special", taxRate: "9" });

    const before = await call("director", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    expect(readBaseInfo(before.body, "发票类型")).toBe("增值税专用发票");
    expect(readBaseInfo(before.body, "合同税率")).toBe("9%");

    const approved = await call("director", `/contracts/${ids.versionA}/tax-revisions/${submitted.body.id}/review`, {
      decision: "approve"
    });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("confirmed");

    const afterList = await call("staff", `/contracts/${ids.versionA}/tax-revisions`);
    expect(afterList.body.current).toMatchObject({ invoiceType: "vat_general", taxRate: "6" });
    const correction = afterList.body.revisions.find((row: { id: string }) => row.id === submitted.body.id);
    expect(correction).toMatchObject({
      kind: "correction", status: "confirmed",
      before: { invoiceType: "vat_special", taxRate: "9" },
      proposed: { invoiceType: "vat_general", taxRate: "6" }
    });

    const detail = await call("director", `/contracts/${ids.contractA}?versionId=${ids.versionA}`);
    expect(readBaseInfo(detail.body, "发票类型")).toBe("增值税普通发票");
    expect(readBaseInfo(detail.body, "合同税率")).toBe("6%");
    expect(await owner.auditLog.count({
      where: { businessId: ids.versionA, action: "contract.tax_correction.confirm" }
    })).toBe(1);
  });

  it("does not block real work confirmation when the framework contract has no total price", async () => {
    const draft = await call("staff", `/contracts/${ids.versionC}/work-completion-drafts`, {
      work: "隔离真库框架合同已完成工作", amountYuan: "300.0123", requestKey: "linea-work-003"
    });
    expect(draft.body.exceedsContractAmount).toBe(false);
    const submitted = await call("staff", `/contracts/${ids.versionC}/work-completions/${draft.body.id}/submission`, undefined, "POST");
    const round = submitted.body.approvalInstanceId;
    for (const [actor, dutyIndex] of [["director", 0], ["manager", 1], ["finance", 2]] as const) {
      await call(actor, `/contracts/${ids.versionC}/work-completions/${draft.body.id}/approval`, {
        approvalInstanceId: round, dutyIndex, decision: "approve"
      });
    }
    const fact = await owner.contractWorkCompletionFact.findFirst({ where: { completionId: draft.body.id } });
    expect(fact?.amountYuan.toFixed(4)).toBe("300.0123");
    const cost = await owner.operatingFact.findFirst({ where: { sourceType: "contract_work_completion",
      sourceBusinessId: fact!.id } });
    expect(cost?.amountYuan?.toFixed(4)).toBe("300.0123");
  });
});
