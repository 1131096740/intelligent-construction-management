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

const run = process.env.RUN_LINE_A_REAL_DB === "1" ? describe : describe.skip;

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
    staff: "linea-user-staff", director: "linea-user-director",
    manager: "linea-user-manager", finance: "linea-user-finance"
  };
  const phones: Record<string, string> = {
    staff: "13900001601", director: "13900001602", manager: "13900001603", finance: "13900001604"
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

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    const ownerTarget = new URL(process.env.OWNER_DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" ||
        target.pathname !== ownerTarget.pathname || !target.pathname.endsWith("_line_a_real_db")) {
      throw new Error("LINE_A_ISOLATED_DATABASE_REQUIRED");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    owner = new PrismaClient({ datasources: { db: { url: ownerTarget.href } } });

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
      { key: "finance_director", name: "财务主管" }
    ], skipDuplicates: true });
    const positions = await owner.position.findMany({ where: { key: { in: ["contract_director", "contract_staff", "project_manager", "finance_staff", "finance_director"] } } });
    const positionId = (key: string) => positions.find(position => position.key === key)!.id;
    await owner.userPosition.createMany({ data: [
      { userId: ids.director, positionId: positionId("contract_director"), projectId: null },
      { userId: ids.finance, positionId: positionId("finance_staff"), projectId: null },
      { userId: ids.finance, positionId: positionId("finance_director"), projectId: null }
    ] });
    await owner.projectMember.createMany({ data: [
      { projectId: ids.project, userId: ids.staff, positionKey: "contract_staff" },
      { projectId: ids.project, userId: ids.manager, positionKey: "project_manager" },
      { projectId: ids.project, userId: ids.finance, positionKey: "finance_staff" }
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
      { id: ids.contractC, code: "LINEA-HT-C", name: "隔离框架其他合同", contractTypeKey: "other", ...contractBase }
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
        amountCents: 0n, amountLimitType: "unlimited", pricingNature: "framework" }
    ] });
    await owner.paymentTermsVersion.createMany({ data: [
      { id: "linea-terms-a", contractId: ids.contractA, contractVersionId: ids.versionA, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：结算后三十日支付" },
      { id: "linea-terms-b", contractId: ids.contractB, contractVersionId: ids.versionB, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：验收后三十日支付" },
      { id: "linea-terms-c", contractId: ids.contractC, contractVersionId: ids.versionC, versionNo: 1,
        status: "effective", originalText: "隔离付款约定：按实际完成工作确认" }
    ] });
    await owner.contractPartySnapshot.createMany({ data: [
      { contractVersionId: ids.versionA, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } },
      { contractVersionId: ids.versionB, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } },
      { contractVersionId: ids.versionC, roleKey: "party_b", displayOrder: 0,
        businessPartyVersionId: ids.counterpartyVersion, snapshot: { name: "隔离相对方" } }
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

  it("registers, returns and confirms a signed settlement from a real uploaded original", async () => {
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

    const created = await call("staff", `/projects/${ids.project}/signed-contract-settlements`, {
      contractKind: "downstream", contractId: ids.contractA, number: "LINEA-JS-001",
      amountYuan: "1000.0000", fileIds: [uploaded.id]
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
      number: "LINEA-JS-001", amountYuan: "1000.0000", fileIds: [uploaded.id]
    }, "PATCH");
    expect(resaved.body.state).toBe("draft");
    const resubmitted = await call("staff", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/submission`,
      { revision: resaved.body.revision });
    const confirmed = await call("director", `/projects/${ids.project}/signed-contract-settlements/${settlementId}/review`,
      { revision: resubmitted.body.revision, decision: "confirm" });
    expect(confirmed.body.state).toBe("confirmed");
    expect(confirmed.body.confirmationNo).toBe("1");

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
    for (const [actor, dutyIndex] of duties) {
      const result = await call(actor, `/contracts/${ids.versionB}/work-completions/${workCompletionId}/approval`, {
        approvalInstanceId, dutyIndex, decision: "approve"
      });
      expect(result.status).toBe(201);
    }
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
