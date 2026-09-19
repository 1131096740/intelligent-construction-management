import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import * as ExcelJS from "exceljs";
import type { BusinessEntryFrozenSnapshot, BusinessEntrySceneDefinition, ContractDetailReadModel, ContractPaymentApplicationPreviewReadModel } from "@jiangkong/shared-domain";
import { AppModule } from "../app.module";
import { PrismaService } from "./prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";

const enabled = process.env.RUN_POL114_HTTP_PG16 === "1";
type Identified = { id: string };
type CreatedDraft = { version: Identified; contract: Identified };
type Workbench = {
  version: { draftRevision: number };
  businessEntry: { definition: BusinessEntrySceneDefinition; values: Record<string, unknown> };
  templateEntry?: { definition: BusinessEntrySceneDefinition; values: Record<string, unknown> };
  billEntries?: Array<{ billKey: string; definition: BusinessEntrySceneDefinition }>;
  settlementModeEntry?: {
    definition: BusinessEntrySceneDefinition;
    values: { settlementMode: string | null };
    history: BusinessEntryFrozenSnapshot[];
  };
  bills: Array<{ id: string; billKey: string; revision: number }>;
};
type Submission = { approvalInstanceId: string; draftRevision: number; businessEntrySnapshot: BusinessEntryFrozenSnapshot; templateEntrySnapshot: BusinessEntryFrozenSnapshot; billEntrySnapshots: BusinessEntryFrozenSnapshot[]; partyEntrySnapshots: BusinessEntryFrozenSnapshot[]; commercialEntrySnapshot: BusinessEntryFrozenSnapshot; paymentTermsEntrySnapshot: BusinessEntryFrozenSnapshot; paymentStageEntrySnapshots: BusinessEntryFrozenSnapshot[] };
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/jiangkong_pol114") {
    throw new Error("合同统一录入测试仅允许本机专用数据库");
  }
}

(enabled ? describe : describe.skip)("合同统一录入公开 HTTP", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let actorUserId: string;
  let actorPhone: string;
  let actorPassword: string;
  let prisma: PrismaService;
  let settlementAttachmentSnapshotFailure = false;
  const identities = new Map<string, { phone: string; password: string }>();
  jest.setTimeout(60_000);

  async function request<T = unknown>(method: string, path: string, body?: unknown, leaseToken?: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(leaseToken ? { "x-contract-draft-lease": leaseToken } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const value = await response.json() as T;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }

  async function upload(name: string, mimeType: string, data: Uint8Array) {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(data).buffer], { type: mimeType }), name);
    const response = await fetch(`${baseUrl}/files`, {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: form
    });
    const result = await response.json() as Identified;
    if (!response.ok) throw new Error(`上传失败：${JSON.stringify(result)}`);
    return result;
  }

  async function runSettlementBrowserAcceptance(
    settlementId: string,
    expectedLines: Array<{ name: string; amountYuan: string; quantity?: string }>,
    expectedAttachmentPurposes: string[] = []
  ) {
    if (process.env.RUN_POL114_BROWSER !== "1") return;
    await new Promise<void>((resolve, reject) => {
      const childEnv = { ...process.env };
      delete childEnv.JEST_WORKER_ID;
      const child = spawn(process.env.PNPM_BIN ?? "pnpm", [
        "--filter", "@jiangkong/web-admin", "exec", "playwright", "test",
        "--config", "playwright.settlement-entry-history-real.config.ts"
      ], {
        cwd: join(__dirname, "../../../.."),
        env: {
          ...childEnv,
          POL114_REAL_SETTLEMENT_ID: settlementId,
          POL114_REAL_SETTLEMENT_PHONE: actorPhone,
          POL114_REAL_SETTLEMENT_PASSWORD: actorPassword,
          POL114_REAL_SETTLEMENT_LINES: JSON.stringify(expectedLines),
          POL114_REAL_SETTLEMENT_ATTACHMENT_PURPOSES: JSON.stringify(expectedAttachmentPurposes),
          VITE_API_PROXY_TARGET: baseUrl
        },
        stdio: "inherit"
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`真实结算历史浏览器验收失败：${signal ?? code ?? "unknown"}`));
      });
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    // Test-only database-boundary fault; all earlier writes use the real PG transaction.
    // No production service is replaced and no persistent database object is installed.
    prisma.$use(async (params, next) => {
      if (settlementAttachmentSnapshotFailure &&
          params.model === "BusinessEntrySubmissionSnapshot" && params.action === "create" &&
          params.args?.data?.sceneKey === "settlement_line_attachment_purpose") {
        settlementAttachmentSnapshotFailure = false;
        throw new Error("POL114_SYNTHETIC_SETTLEMENT_ATTACHMENT_SNAPSHOT_FAILURE");
      }
      return next(params);
    });
    const phone = process.env.POL114_HTTP_TEST_PHONE ?? `114${Date.now()}`;
    const password = process.env.POL114_HTTP_TEST_PASSWORD ?? `Test-${randomUUID()}`;
    actorPhone = phone;
    actorPassword = password;
    const user = await prisma.user.create({ data: {
      phone, name: "合同录入测试负责人", passwordHash: await hash(password, 4),
      mustChangePassword: false
    } });
    actorUserId = user.id;
    identities.set(user.id, { phone, password });
    for (const key of ["chairman", "contract_director"] as const) {
      const position = await prisma.position.upsert({
        where: { key }, update: {}, create: { key, name: key }
      });
      await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    }
    token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", { phone, password })).tokens.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  it.each(["aggregate", "legacy", "legacy-ownerless"] as const)("合同现役提交与旧入口退出：%s", async (entryMode) => {
    token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", {
      phone: actorPhone, password: actorPassword
    })).tokens.accessToken;
    const settlementFinance = process.env.RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16 === "1";
    const paymentFinance = process.env.RUN_POL114_PAYMENT_HTTP_PG16 === "1" || settlementFinance;
    const contractTypeKey = paymentFinance && !settlementFinance ? "generic_contract" : "material_purchase";
    const settlementMode = settlementFinance ? "settlement_required" : "direct_payment";
    const project = await request<Identified>("POST", "/projects", {
      code: `POL114-${randomUUID()}`, name: "合同统一录入合成项目"
    });
    const prisma = app.get(PrismaService);
    let projectFinanceUserId = "";
    const roleUsers = new Map<string, string>();
    for (const key of ["budget_staff", "contract_staff", "material_staff", "material_director", "project_manager", "finance_director", "finance_staff", "budget_director", "contract_director", "chairman", "comprehensive_director"]) {
      const phone = `114-${randomUUID()}`;
      const password = `Test-${randomUUID()}`;
      const reviewer = await prisma.user.create({ data: {
        name: `合成审批岗位 ${key}`, phone, passwordHash: await hash(password, 4), mustChangePassword: false
      } });
      identities.set(reviewer.id, { phone, password });
      roleUsers.set(key, reviewer.id);
      const position = await prisma.position.upsert({ where: { key }, update: {}, create: { key, name: key } });
      await prisma.userPosition.create({ data: {
        userId: reviewer.id, positionId: position.id,
        projectId: ["project_manager", "material_staff", "contract_staff", "budget_staff"].includes(key) ? project.id : null
      } });
      if (["project_manager", "material_staff", "contract_staff", "budget_staff"].includes(key)) {
        await prisma.projectMember.create({ data: { projectId: project.id, userId: reviewer.id, positionKey: key } });
      }
      if (key === "finance_director") {
        projectFinanceUserId = reviewer.id;
        await prisma.userPosition.create({ data: { userId: reviewer.id, positionId: position.id, projectId: project.id } });
      }
      if (key === "finance_staff") {
        await prisma.userPosition.create({ data: { userId: reviewer.id, positionId: position.id, projectId: project.id } });
      }
      if (key === "budget_staff") {
        // Existing upload and upstream-record routes require different roles.
        // Use a legitimate composite test identity; do not widen either guard.
        const uploadPosition = await prisma.position.upsert({ where: { key: "contract_staff" }, update: {}, create: { key: "contract_staff", name: "合成合同经办" } });
        await prisma.userPosition.create({ data: { userId: reviewer.id, positionId: uploadPosition.id, projectId: project.id } });
      }
    }
    const templateSchema = {
      fields: [{ key: "deliveryLocation", label: "交货地点", type: "text", required: true }, { key: "adjustment", label: "调整系数", type: "number" }],
      bills: [{ key: "reference", name: "参考清单", amountRole: "reference", pricingMode: "tax_inclusive",
        quantityScale: 2, unitPriceScale: 2,
        columns: [{ key: "brand", label: "指定品牌", type: "text", required: true }] }],
      clauses: [], attachments: [], validations: []
    };
    // Synthetic published master-data bootstrap only: retired template write routes stay unavailable.
    const templateRecord = await prisma.contractBusinessTemplate.create({ data: {
      code: `POL114-${randomUUID()}`, businessCode: `合同录入验证${randomUUID()}`,
      name: "合同录入验证模板", contractTypeKey, status: "published", createdByUserId: actorUserId
    } });
    const templateVersion = await prisma.contractBusinessTemplateVersion.create({ data: {
      templateId: templateRecord.id, versionNo: 1, status: "published",
      fieldSchema: templateSchema.fields, billSchema: templateSchema.bills,
      clauseSchema: templateSchema.clauses, attachmentSchema: templateSchema.attachments,
      validationSchema: templateSchema.validations, submittedByUserId: actorUserId,
      publishedByUserId: actorUserId, publishedAt: new Date(),
      changeSummary: "合成数据公开接口验证"
    } });
    const template = { version: { id: templateVersion.id } };
    const draft = await request<CreatedDraft>("POST", "/contracts", {
      projectId: project.id, contractTypeKey,
      businessTemplateVersionId: template.version.id, signingSubjectType: "our_company"
    });
    const workbench = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    expect(workbench.settlementModeEntry?.definition).toMatchObject({
      key: "contract_settlement_mode", entityType: "contract_version", version: 1,
      fields: [{ key: "settlementMode", label: "结算方式", type: "single_select", options: [
        { value: "settlement_required", label: "需要结算" },
        { value: "direct_payment", label: "按合同直接付款" }
      ] }]
    });
    expect(workbench.settlementModeEntry?.history).toEqual([]);
    expect(workbench.businessEntry?.definition).toMatchObject({
      key: "contract_basic", entityType: "contract_version",
      fields: [
        { key: "contractName", label: "合同名称", type: "text" },
        { key: "companyEntityId", label: "我方签约主体", type: "company" }
      ]
    });
    expect(workbench.templateEntry?.definition).toMatchObject({
      key: "contract_template_fields", entityType: "contract_version",
      source: { kind: "contract_business_template_version", id: template.version.id, version: 1 },
      fields: [{ key: "deliveryLocation", label: "交货地点", type: "text", required: true }, { key: "adjustment", label: "调整系数", type: "number" }]
    });
    expect(workbench.billEntries).toEqual(expect.arrayContaining([expect.objectContaining({
      billKey: "reference", definition: expect.objectContaining({
        key: "contract_bill_row", entityType: "contract_bill_row",
        source: expect.objectContaining({ id: template.version.id, version: 1 }),
        fields: expect.arrayContaining([expect.objectContaining({ key: "brand", label: "指定品牌", type: "text", required: true })])
      })
    })]));
    const excelResponse = await fetch(`${baseUrl}/contract-bills/${workbench.bills[0]!.id}/excel-template`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(excelResponse.status).toBe(200);
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(await excelResponse.arrayBuffer());
    expect(JSON.stringify(excel.getWorksheet("填写说明")!.getSheetValues())).toContain("请填写指定品牌，正式提交后保留本次填写内容。");
    const creditCode = "91350211M000100Y46";
    let companyRecord = await prisma.companyEntity.findFirst({ where: { unifiedSocialCreditCode: creditCode } });
    if (!companyRecord) {
      companyRecord = await prisma.companyEntity.create({ data: {
        name: "统一录入合成我方公司", unifiedSocialCreditCode: creditCode,
        dataStatus: "complete", currentVersionNo: 1, isActive: true
      } });
      await prisma.companyEntityVersion.create({ data: {
        companyEntityId: companyRecord.id, versionNo: 1, name: companyRecord.name,
        unifiedSocialCreditCode: creditCode, isActive: true,
        action: "test_master", actorUserId, actorRoleKey: "contract_director"
      } });
    }
    const companies = await request<Array<Identified & { unifiedSocialCreditCode: string }>>("GET", "/company-entities");
    expect(companies).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: companyRecord.id, unifiedSocialCreditCode: creditCode })
    ]));
    const company = { id: companyRecord.id };
    if (paymentFinance) {
      const values = { name: `公开链合成施工企业-${randomUUID()}` };
      const idempotencyKey = randomUUID();
      const fingerprint = createHash("sha256").update(JSON.stringify({ attachments: [], name: values.name, type: "organization" })).digest("hex");
      const probe = await request<{ createTarget: string }>("POST", "/business-entry-definitions/business-party/create/probe", { idempotencyKey, fingerprint });
      const intent = await request<{ target: unknown; definitionKey: string; definitionVersion: number }>("POST", "/business-entry-definitions/business-party/create/submission-target", { idempotencyKey, fingerprint, probe: probe.createTarget });
      const enterprise = await request<{ version: Identified }>("POST", "/business-parties", {
        target: intent.target, definitionKey: intent.definitionKey, definitionVersion: intent.definitionVersion, idempotencyKey, values
      });
      const actorToken = token;
      const identity = identities.get(projectFinanceUserId)!;
      token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", identity)).tokens.accessToken;
      try {
        await request("POST", `/projects/${project.id}/construction-enterprise`, {
          businessPartyVersionId: enterprise.version.id, effectiveFrom: "2026-01-01", changeReason: "合成公开合同链"
        });
        await request("POST", `/projects/${project.id}/participating-companies`, {
          companyEntityId: company.id, effectiveFrom: "2026-01-01", changeReason: "合成公开合同链"
        });
      } finally { token = actorToken; }
    }
    const lease = await request<{ token: string }>("POST", `/contract-drafts/${draft.version.id}/edit-lease`);
    await request("PUT", `/contract-drafts/${draft.version.id}`, {
      idempotencyKey: randomUUID(), saveKind: "manual",
      expectedRevision: workbench.version.draftRevision, changedSections: ["draft"],
      draft: {
        companyEntityId: company.id, draftData: { contractName: "合成材料采购合同", fieldValues: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" } },
        clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountCents: "500000",
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" }
      },
      parties: [], bills: workbench.bills.map((bill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, rows: [] })), paymentTerms: null, attachments: [],
      negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }, lease.token);
    let saved = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    expect(saved.businessEntry?.values).toEqual({
      contractName: "合成材料采购合同", companyEntityId: company.id
    });

    const zip = new PizZip(await readFile(join(__dirname, "../../assets/templates/generic-contract-v1.docx")));
    zip.file("word/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{contract.name} {contract.temporaryCode} {document.watermark}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
    const docx = await upload("合成合同版式.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip.generate({ type: "nodebuffer" }));
    const layoutRecord = await prisma.contractLayoutTemplate.create({ data: {
      name: "合成合同版式", contractTypeKey, createdByUserId: actorUserId
    } });
    const layoutVersion = await prisma.contractLayoutTemplateVersion.create({ data: {
      layoutTemplateId: layoutRecord.id, versionNo: 1, status: "published",
      docxFileId: docx.id, placeholderSchema: { bills: [] },
      inspectionReport: { blockingErrors: [], warnings: [] }, inspectionRevision: 1,
      submittedByUserId: actorUserId, publishedByUserId: actorUserId,
      publishedAt: new Date(), changeSummary: "合成版式"
    } });
    const layout = { version: { id: layoutVersion.id } };
    if (paymentFinance) {
      await request("POST", `/contract-workbench/${draft.version.id}/settlement-mode/confirm`, {
        expectedRevision: saved.version.draftRevision, settlementMode
      });
      saved = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    }
    await request("PUT", `/contract-drafts/${draft.version.id}`, {
      idempotencyKey: randomUUID(), saveKind: "manual",
      expectedRevision: saved.version.draftRevision, changedSections: ["draft", "parties", "payment_terms", "bills"],
      draft: {
        companyEntityId: company.id, draftData: { contractName: "合成材料采购合同", fieldValues: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" } },
        clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountCents: "500000",
        layoutTemplateVersionId: layout.version.id,
        taxFacts: { invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" }
      },
      parties: [{ roleKey: "party_b", displayOrder: 0, snapshot: { name: "合成材料供应商" } }],
      bills: saved.bills.map((bill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, rows: [{
        clientRowKey: "synthetic-row-1", sortOrder: 0, itemName: "合成材料", unit: "件", quantity: "2.00", unitPrice: "10.00",
        taxRateSource: "version_default", isProvisional: false, customData: { brand: "合成品牌" }
      }] })), paymentTerms: { originalText: "验收后付款", stages: paymentFinance ? [{
        name: "合同款", stageType: "progress", basis: settlementFinance ? "current_settlement" : "contract_amount", ratioBps: 10000,
        triggerAnchor: settlementFinance ? "settlement_effective" : "contract_effective", triggerEvent: settlementFinance ? "结算生效" : "合同生效", dueDays: 0,
        requiresInvoice: false, allowsEarlyPayment: false, allowsInstallments: true,
        originalText: "合同生效后支付合同金额的100%。"
      }] : [] }, attachments: [],
      negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }, lease.token);
    let current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    const modeConfirmation = await request<{ settlementModeSnapshot: BusinessEntryFrozenSnapshot }>("POST", `/contract-workbench/${draft.version.id}/settlement-mode/confirm`, {
      expectedRevision: current.version.draftRevision, settlementMode
    });
    expect(modeConfirmation.settlementModeSnapshot).toMatchObject({
      sceneKey: "contract_settlement_mode", revision: 1,
      target: { projectId: project.id, entityType: "contract_version", entityId: draft.version.id },
      values: { settlementMode }
    });
    await expect(request("POST", `/contract-workbench/${draft.version.id}/settlement-mode/confirm`, {
      expectedRevision: current.version.draftRevision, settlementMode: settlementFinance ? "direct_payment" : "settlement_required"
    })).rejects.toThrow("400");
    const confirmedMode = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    expect(confirmedMode.settlementModeEntry?.history).toEqual([modeConfirmation.settlementModeSnapshot]);
    expect(confirmedMode.settlementModeEntry?.values).toEqual({ settlementMode });
    for (const side of ["first_party", "counterparty"]) {
      current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
      await request("POST", `/contracts/${draft.version.id}/authorizations`, {
        side, expectedRevision: current.version.draftRevision, required: false
      });
    }
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Synthetic contract for integration test");
    const formal = await upload("合成审批文件.pdf", "application/pdf", await pdf.save());
    current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    const signed = await request<{ previewFormalFileId: string }>("POST", `/contracts/${draft.version.id}/formal-files/counterparty`, {
      fileIds: [formal.id], sourceRevision: current.version.draftRevision
    });
    await request("POST", `/contracts/${draft.version.id}/formal-files/counterparty/confirmation`, {
      formalFileId: signed.previewFormalFileId, expectedDraftRevision: current.version.draftRevision
    });
    current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    const submission = {
      idempotencyKey: randomUUID(), expectedRevision: current.version.draftRevision
    };
    if (entryMode !== "aggregate") {
      const ownerToken = token;
      await expect(request("POST", `/contracts/${draft.version.id}/approval-submission`, {}))
        .rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
      const otherSubmitter = identities.get(roleUsers.get("contract_director")!)!;
      token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", otherSubmitter)).tokens.accessToken;
      try {
        await expect(request("POST", `/contracts/${draft.version.id}/approval-submission`, {}))
          .rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
      } finally {
        token = ownerToken;
      }
      if (entryMode === "legacy-ownerless") {
        // Synthetic historical ownerless draft proves that the tombstone is
        // independent from former owner exceptions and business authorization.
        await prisma.contract.update({ where: { id: draft.contract.id }, data: { ownerUserId: null } });
        const outsiderPhone = `114${Date.now()}`;
        const outsiderPassword = `Test-${randomUUID()}`;
        await prisma.user.create({ data: {
          phone: outsiderPhone, name: "无合同提交岗位的活跃账号",
          passwordHash: await hash(outsiderPassword, 4), mustChangePassword: false
        } });
        const authorizedToken = token;
        token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", {
          phone: outsiderPhone, password: outsiderPassword
        })).tokens.accessToken;
        try {
          await expect(request("POST", `/contracts/${draft.version.id}/approval-submission`, {}))
            .rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
        } finally {
          token = authorizedToken;
        }
      }
      expect(await prisma.contractDraftSubmissionRequest.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      expect(await prisma.approvalInstance.count({ where: { businessType: "contract_version", businessId: draft.version.id } })).toBe(0);
      expect((await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`)).businessEntrySubmissions).toEqual([]);
      expect((await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`)).version.draftRevision).toBe(current.version.draftRevision);
      return;
    }
    const submitted = await request<Submission>("POST", `/contract-drafts/${draft.version.id}/submission`, submission, lease.token);
    expect(submitted.businessEntrySnapshot).toMatchObject({
      sceneKey: "contract_basic", revision: 1,
      values: { contractName: "合成材料采购合同", companyEntityId: company.id }
    });
    expect(submitted.draftRevision).toBeGreaterThan(submitted.businessEntrySnapshot.revision);
    expect(submitted.templateEntrySnapshot).toMatchObject({
      sceneKey: "contract_template_fields", revision: 1,
      definition: { source: { id: template.version.id, version: 1 } },
      values: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" }
    });
    expect(submitted.billEntrySnapshots).toEqual([expect.objectContaining({
      sceneKey: "contract_bill_row", target: expect.objectContaining({ entityType: "contract_bill_row" }),
      definition: expect.objectContaining({ source: expect.objectContaining({ id: template.version.id, billKey: "reference" }) }),
      values: expect.objectContaining({ itemName: "合成材料", quantity: "2", unitPrice: "10", brand: "合成品牌" })
    })]);
    expect(submitted.partyEntrySnapshots).toEqual([expect.objectContaining({
      sceneKey: "contract_party", values: expect.objectContaining({ roleName: "乙方", displayOrder: 0, name: "合成材料供应商" })
    })]);
    expect(submitted.commercialEntrySnapshot).toMatchObject({
      sceneKey: "contract_commercial_terms",
      values: expect.objectContaining({ pricingNature: "fixed_total", amountSource: "manual", contractAmountYuan: "5000.00", invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: 13, taxFactSource: "contract_document" })
    });
    expect(submitted.paymentTermsEntrySnapshot).toMatchObject({ sceneKey: "contract_payment_terms", values: { originalText: "验收后付款" } });
    expect(submitted.paymentStageEntrySnapshots).toEqual([expect.objectContaining({
      sceneKey: "contract_payment_stage", values: expect.objectContaining({ name: "合同款", basis: "current_settlement", ratioBps: 10000, dueDays: 0, requiresInvoice: false, allowsEarlyPayment: false, allowsInstallments: true })
    })]);
    await prisma.contractBusinessTemplateVersion.create({ data: {
      templateId: templateRecord.id, versionNo: 2, status: "published",
      fieldSchema: [{ key: "deliveryLocation", label: "新版本交货地址", type: "text", required: true }],
      billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [],
      submittedByUserId: actorUserId, publishedByUserId: actorUserId,
      publishedAt: new Date(), changeSummary: "合成新版本，不改变旧合同"
    } });
    const repeated = await request("POST", `/contract-drafts/${draft.version.id}/submission`, submission, lease.token);
    expect(repeated).toEqual(submitted);
    const detail = await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`);
    expect(detail.businessEntrySubmissions).toContainEqual({
      approvalInstanceId: submitted.approvalInstanceId,
      snapshot: submitted.businessEntrySnapshot
    });
    expect(detail.businessEntrySubmissions).toContainEqual({
      approvalInstanceId: submitted.approvalInstanceId,
      snapshot: submitted.templateEntrySnapshot
    });
    expect(detail.businessEntrySubmissions).toContainEqual({
      approvalInstanceId: submitted.approvalInstanceId,
      snapshot: submitted.billEntrySnapshots[0]
    });
    for (const snapshot of [submitted.commercialEntrySnapshot, ...submitted.partyEntrySnapshots,
      submitted.paymentTermsEntrySnapshot, ...submitted.paymentStageEntrySnapshots]) {
      expect(detail.businessEntrySubmissions).toContainEqual({ approvalInstanceId: submitted.approvalInstanceId, snapshot });
    }
    if (entryMode === "aggregate" && paymentFinance) {
      const loginAs = async (userId: string) => {
        const identity = identities.get(userId);
        if (!identity) throw new Error("公开链缺少本次合成账号");
        token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", identity)).tokens.accessToken;
        return identity;
      };
      for (let step = 0; step < 12; step++) {
        // Read the actual frozen reviewer; never fabricate approval state.
        const approval = await prisma.approvalInstance.findFirst({ where: {
          businessId: draft.version.id, businessType: "contract_version", status: "in_progress"
        } });
        if (!approval) break;
        const nodes = approval.frozenNodes as unknown as Array<{ candidateUserIds: string[] }>;
        const reviewerId = nodes[approval.currentNodeIndex]?.candidateUserIds.find((id) => identities.has(id));
        if (!reviewerId) throw new Error("公开链缺少冻结审核人");
        const identity = await loginAs(reviewerId);
        const signature = new FormData();
        signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-signature.png");
        const signedResponse = await fetch(`${baseUrl}/me/signature/canvas`, {
          method: "POST", headers: { authorization: `Bearer ${token}` }, body: signature
        });
        if (!signedResponse.ok) throw new Error(`合成签名上传失败：${signedResponse.status}`);
        const reviewDetail = await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`);
        if (!reviewDetail.reviewApprovalContext) throw new Error("公开合同详情没有审核坐标");
        await request("POST", `/contracts/${draft.version.id}/approval`, {
          ...reviewDetail.reviewApprovalContext, decision: "approve", confirmationPassword: identity.password,
          selfReviewReason: "合成合同公开链验证", ownerContractRiskConfirmed: true,
          expectedOwnerContractRisk: reviewDetail.ownerContractRisk
        });
      }
      const sealPosition = await prisma.position.findUniqueOrThrow({ where: { key: "comprehensive_director" } });
      const sealActor = await prisma.userPosition.findFirstOrThrow({ where: { positionId: sealPosition.id, projectId: null, userId: { in: [...identities.keys()] } } });
      const sealIdentity = await loginAs(sealActor.userId);
      await request("POST", `/contracts/${draft.version.id}/seal/approve`, { confirmationPassword: sealIdentity.password });
      await loginAs(actorUserId);
      const declaration = { firstPartySignedOrStamped: true, companySealCompleted: true, crossPageSealCompleted: true, signingDateCompleted: true };
      await request("POST", `/contracts/${draft.version.id}/seal/complete`, declaration);
      const finalDocument = await PDFDocument.load(await pdf.save());
      finalDocument.getPages()[0]!.drawText("SYNTHETIC FIRST PARTY SIGNATURE / SEAL / DATE", { y: 650 });
      const finalFile = await upload("synthetic-final.pdf", "application/pdf", await finalDocument.save());
      const finalVersion = await prisma.contractVersion.findUniqueOrThrow({ where: { id: draft.version.id }, select: { draftRevision: true } });
      const final = await request<Identified>("POST", `/contracts/${draft.version.id}/formal-files/final`, {
        ...declaration, fileId: finalFile.id, sourceRevision: finalVersion.draftRevision,
        onlyPermittedSignatureChanges: true, documentOrderConfirmed: true
      });
      await request("POST", `/contracts/${draft.version.id}/formal-files/final/confirmation`, {
        ...declaration, formalFileId: final.id, onlyPermittedSignatureChanges: true, documentOrderConfirmed: true
      });
      let payment: Identified & { businessEntrySnapshot?: BusinessEntryFrozenSnapshot };
      if (settlementFinance) {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("本期结算明细");
        sheet.addRow(["清单编码/行号", "清单项名称", "是否本期结算", "合同数量", "合同单价", "前期已结算数量", "本期数量", "累计结算数量", "剩余可结算数量", "本期结算金额(分)", "人工调整金额(分)", "调整原因", "证据说明", "异常说明", "备注"]);
        sheet.getCell("A6").value = "经办人签字：";
        sheet.getCell("H6").value = "审核人签字：";
        sheet.pageSetup.printArea = "A1:O8";
        const source = await upload("synthetic-settlement-template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array(await workbook.xlsx.writeBuffer()));
        const settlementTemplateRecord = await prisma.settlementTemplate.create({ data: {
          name: "公开链合成结算模板", code: `POL114-ST-${randomUUID()}`, createdByUserId: actorUserId
        } });
        const settlementTemplateVersion = await prisma.settlementTemplateVersion.create({ data: {
          settlementTemplateId: settlementTemplateRecord.id, versionNo: 1, status: "published",
          xlsxFileId: source.id, compatibleContractTypeKeys: [contractTypeKey],
          columnSchema: {}, printRules: {}, evidenceRules: {}, anomalyRules: {},
          inspectionReport: { blockingErrors: [], warnings: [] }, inspectionRevision: 1,
          submittedByUserId: actorUserId, publishedByUserId: actorUserId,
          publishedAt: new Date(), changeSummary: "合成结算公开链"
        } });
        const settlementTemplate = { version: { id: settlementTemplateVersion.id } };
        const upstreamActor = await loginAs(roleUsers.get("budget_staff")!);
        const upstreamSignature = new FormData();
        upstreamSignature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-upstream-signature.png");
        const upstreamSignatureResponse = await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: upstreamSignature });
        if (!upstreamSignatureResponse.ok) throw new Error(`合成上游签名上传失败：${upstreamSignatureResponse.status}`);
        const upstreamVoucher = await upload("synthetic-upstream.pdf", "application/pdf", await pdf.save());
        const upstream = await request<Identified>("POST", `/projects/${project.id}/upstream-settlements`, {
          settledAt: "2026-09-17T00:00:00.000Z", reportedAmountCents: "25000", approvedAmountCents: "25000",
          approvingPartyName: "合成业主", periodLabel: "2026-09", voucherFileId: upstreamVoucher.id
        });
        expect(await request("POST", `/projects/${project.id}/upstream-settlements/${upstream.id}/confirmation`, { confirmationPassword: upstreamActor.password })).toMatchObject({ status: "confirmed" });
        const settlementApplicant = await loginAs(roleUsers.get("contract_staff")!);
        const applicantSignature = new FormData();
        applicantSignature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-applicant-signature.png");
        const applicantSignatureResponse = await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: applicantSignature });
        if (!applicantSignatureResponse.ok) throw new Error(`合成经办签名上传失败：${applicantSignatureResponse.status}`);
        const settlementDraftPath = `/projects/${project.id}/settlement-drafts`;
        const rejectedSubmissionBaseline = {
          approvals: await prisma.approvalInstance.count({ where: { businessType: "settlement" } }),
          snapshots: await prisma.businessEntrySubmissionSnapshot.count({
            where: { sceneKey: { in: ["settlement_basic", "settlement_line"] } }
          })
        };
        const rejectedSettlementCode = `POL114-ST-REJECT-${randomUUID()}`;
        const rejectedQuantityDraft = await request<Identified & { revision: number }>("POST", settlementDraftPath, {
          contractVersionId: draft.version.id, settlementTemplateVersionId: settlementTemplate.version.id,
          code: rejectedSettlementCode, periodLabel: "2026-09",
          settlementLines: [{ sourceType: "manual_adjustment", name: "非法负数量", quantity: "-1", amountCents: "10000", reason: "失败不应写入" }]
        });
        await expect(request("POST", `${settlementDraftPath}/${rejectedQuantityDraft.id}/frozen-document`, {
          expectedRevision: rejectedQuantityDraft.revision
        })).rejects.toThrow(`POST ${settlementDraftPath}/${rejectedQuantityDraft.id}/frozen-document: 400`);
        expect(await prisma.settlementDraft.count({ where: { code: rejectedSettlementCode, status: "draft" } })).toBe(1);
        const rejectedUnitPriceCode = `POL114-ST-PRICE-REJECT-${randomUUID()}`;
        await expect(request("POST", settlementDraftPath, {
          contractVersionId: draft.version.id, settlementTemplateVersionId: settlementTemplate.version.id,
          code: rejectedUnitPriceCode, periodLabel: "2026-09",
          settlementLines: [{
            sourceType: "manual_adjustment", name: "非法负单价", quantity: "1", unitPriceCents: "-100",
            amountCents: "10000", reason: "失败不应写入"
          }]
        })).rejects.toThrow(`POST ${settlementDraftPath}: 400`);
        expect(await Promise.all([
          prisma.settlementDraft.count({ where: { code: rejectedUnitPriceCode } }),
          prisma.settlement.count({ where: { code: { in: [rejectedSettlementCode, rejectedUnitPriceCode] } } }),
          prisma.approvalInstance.count({ where: { businessType: "settlement" } }),
          prisma.businessEntrySubmissionSnapshot.count({
            where: { sceneKey: { in: ["settlement_basic", "settlement_line"] } }
          })
        ])).toEqual([0, 0, rejectedSubmissionBaseline.approvals, rejectedSubmissionBaseline.snapshots]);
        await request("POST", `${settlementDraftPath}/${rejectedQuantityDraft.id}/abandonment`, {
          expectedRevision: rejectedQuantityDraft.revision, action: "delete_pristine_draft"
        });
        expect(await prisma.settlementDraft.count({
          where: { id: rejectedQuantityDraft.id, status: "abandoned", submittedSettlementId: null }
        })).toBe(1);
        const settlementCode = process.env.POL114_HTTP_SETTLEMENT_CODE ?? `POL114-ST-${randomUUID()}`;
        const settlementDraft = await request<Identified & { revision: number }>("POST", settlementDraftPath, {
          contractVersionId: draft.version.id, settlementTemplateVersionId: settlementTemplate.version.id,
          code: settlementCode, periodLabel: "2026-09", periodEnd: "2026-09-30",
          fieldReviewerUserId: roleUsers.get("material_staff"), fieldReviewerRoleKey: "material_staff",
          settlementLines: [
            { sourceType: "manual_adjustment", name: "合成现场签认金额", quantity: "2.50", amountCents: "10000", reason: "本期合成现场签认" },
            { sourceType: "manual_adjustment", name: "合成零数量调整", quantity: "0", amountCents: "5000", reason: "原领域允许零数量" }
          ]
        });
        const draftPath = `${settlementDraftPath}/${settlementDraft.id}`;
        const settlementDraftDetail = await request<{
          businessEntry?: { definition: BusinessEntrySceneDefinition; values: Record<string, unknown> };
          businessEntryLines?: Array<{ lineKey: string; definition: BusinessEntrySceneDefinition; values: Record<string, unknown> }>;
        }>("GET", draftPath);
        expect(settlementDraftDetail.businessEntry?.definition).toMatchObject({
          key: "settlement_basic", entityType: "settlement", version: 2,
          fields: [
            { key: "contractVersionId", label: "关联合同", type: "single_select" },
            { key: "settlementTemplateVersionId", label: "结算模板", type: "single_select" },
            { key: "code", label: "结算编号", type: "text" },
            { key: "periodLabel", label: "结算期间", type: "text" },
            { key: "periodEnd", label: "结算截止日", type: "date" },
            { key: "isFinal", label: "最终结算", type: "boolean" },
            { key: "finalDeclarationAccepted", label: "最终结算总体声明", type: "boolean" },
            { key: "finalCumulativeAmountYuan", label: "审定累计结算金额", type: "money" },
            { key: "fieldReviewerUserId", label: "现场复核人", type: "single_select" },
            { key: "fieldReviewerRoleKey", label: "现场复核岗位", type: "single_select" }
          ]
        });
        expect(settlementDraftDetail.businessEntry?.values).toMatchObject({
          contractVersionId: draft.version.id,
          settlementTemplateVersionId: settlementTemplate.version.id,
          periodLabel: "2026-09",
          periodEnd: "2026-09-30",
          isFinal: false,
          fieldReviewerUserId: roleUsers.get("material_staff"),
          fieldReviewerRoleKey: "material_staff"
        });
        expect(settlementDraftDetail.businessEntryLines).toEqual(expect.arrayContaining([
          expect.objectContaining({
            definition: expect.objectContaining({
              key: "settlement_line", entityType: "settlement_line", version: 2,
              fields: expect.arrayContaining([
                expect.objectContaining({ key: "sourceType", label: "明细来源", type: "single_select" }),
                expect.objectContaining({ key: "name", label: "明细名称", type: "text" }),
                expect.objectContaining({ key: "quantity", label: "数量", type: "number", precision: 2,
                  exactDecimalString: { sign: "nonnegative", maximumExclusive: "1000000000000000000" } }),
                expect.objectContaining({ key: "amountYuan", label: "本期金额", type: "money" }),
                expect.objectContaining({ key: "reason", label: "业务原因", type: "long_text" })
              ])
            }),
            values: expect.objectContaining({
              sourceType: "manual_adjustment",
              name: "合成现场签认金额",
              quantity: "2.5",
              amountYuan: "100.00",
              reason: "本期合成现场签认"
            })
          }),
          expect.objectContaining({ values: expect.objectContaining({ name: "合成零数量调整", quantity: "0", amountYuan: "50.00" }) })
        ]));
        expect(settlementDraftDetail.businessEntryLines).toHaveLength(2);
        const settlementLineKey = settlementDraftDetail.businessEntryLines?.[0]?.lineKey;
        if (!settlementLineKey) throw new Error("公开结算草稿未返回明细标识");
        const lineEvidence = await upload("synthetic-line-evidence.pdf", "application/pdf", await pdf.save());
        const firstAttached = await request<{ revision: number }>(
          "POST",
          `${draftPath}/lines/${encodeURIComponent(settlementLineKey)}/attachments`,
          { fileId: lineEvidence.id, purpose: "现场签证单", expectedRevision: settlementDraft.revision }
        );
        const measurementEvidence = await upload("synthetic-measurement-evidence.pdf", "application/pdf", await pdf.save());
        const attached = await request<{ revision: number }>(
          "POST",
          `${draftPath}/lines/${encodeURIComponent(settlementLineKey)}/attachments`,
          { fileId: measurementEvidence.id, purpose: "计量凭证", expectedRevision: firstAttached.revision }
        );
        const frozen = await request<Identified & { fileId: string }>("POST", `${draftPath}/frozen-document`, { expectedRevision: attached.revision });
        const download = await request<{ downloadUrl: string }>("POST", `/files/${frozen.fileId}/download-ticket`, {
          confirmationPassword: settlementApplicant.password, downloadReason: "合成签署扫描件", accessMode: "download"
        });
        const downloaded = await fetch(new URL(download.downloadUrl, baseUrl));
        if (!downloaded.ok) throw new Error(`结算冻结件下载失败：${downloaded.status}`);
        const signed = await upload("synthetic-settlement-signed.pdf", "application/pdf", new Uint8Array(await downloaded.arrayBuffer()));
        await request("POST", `${draftPath}/counterparty-signed-documents`, {
          expectedRevision: attached.revision, frozenDocumentId: frozen.id, uploadedFileId: signed.id,
          declaration: { pageOrderMatchesFrozenDocument: true, counterpartySignedAndDated: true, everyPageStamped: true, crossPageSealCompleted: true }
        });
        type SettlementSubmission = Identified & {
          businessEntrySnapshot?: { sceneKey: string; values: Record<string, unknown> };
          businessEntryLineSnapshots?: Array<{ sceneKey: string; target: { entityId: string }; values: Record<string, unknown> }>;
          businessEntryLineAttachmentSnapshots?: Array<{ sceneKey: string; target: { entityId: string }; values: Record<string, unknown> }>;
        };
        const beforeFailedSubmission = {
          settlements: await prisma.settlement.count({ where: { code: settlementCode } }),
          formalAttachments: await prisma.settlementLineAttachment.count({ where: { settlementLineId: { not: null } } }),
          purposeSnapshots: await prisma.businessEntrySubmissionSnapshot.count({
            where: { sceneKey: "settlement_line_attachment_purpose" }
          }),
          approvals: await prisma.approvalInstance.count({ where: { businessType: "settlement" } })
        };
        settlementAttachmentSnapshotFailure = true;
        await expect(request("POST", `${draftPath}/approval-submission`, { expectedRevision: attached.revision }))
          .rejects.toThrow(`POST ${draftPath}/approval-submission: 500`);
        await expect(Promise.all([
          prisma.settlement.count({ where: { code: settlementCode } }),
          prisma.settlementLineAttachment.count({ where: { settlementLineId: { not: null } } }),
          prisma.businessEntrySubmissionSnapshot.count({ where: { sceneKey: "settlement_line_attachment_purpose" } }),
          prisma.approvalInstance.count({ where: { businessType: "settlement" } })
        ])).resolves.toEqual([
          beforeFailedSubmission.settlements,
          beforeFailedSubmission.formalAttachments,
          beforeFailedSubmission.purposeSnapshots,
          beforeFailedSubmission.approvals
        ]);
        expect(await request<Array<{ purpose: string }>>("GET", `${draftPath}/line-attachments`)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ purpose: "现场签证单" }),
            expect.objectContaining({ purpose: "计量凭证" })
          ])
        );
        const settlement = await request<SettlementSubmission>("POST", `${draftPath}/approval-submission`, { expectedRevision: attached.revision });
        expect(settlement.businessEntrySnapshot).toMatchObject({
          sceneKey: "settlement_basic", definitionVersion: 2,
          values: {
            contractVersionId: draft.version.id,
            settlementTemplateVersionId: settlementTemplate.version.id,
            periodLabel: "2026-09",
            periodEnd: "2026-09-30",
            isFinal: false,
            fieldReviewerUserId: roleUsers.get("material_staff"),
            fieldReviewerRoleKey: "material_staff"
          }
        });
        expect(settlement.businessEntryLineSnapshots).toEqual(expect.arrayContaining([
          expect.objectContaining({
            sceneKey: "settlement_line",
            target: expect.objectContaining({ entityType: "settlement_line" }),
            values: expect.objectContaining({
              sourceType: "manual_adjustment",
              name: "合成现场签认金额",
              quantity: "2.5",
              amountYuan: "100.00",
              reason: "本期合成现场签认"
            })
          }),
          expect.objectContaining({
            sceneKey: "settlement_line",
            values: expect.objectContaining({ name: "合成零数量调整", quantity: "0", amountYuan: "50.00" })
          })
        ]));
        expect(settlement.businessEntryLineSnapshots).toHaveLength(2);
        expect(settlement.businessEntryLineAttachmentSnapshots).toHaveLength(2);
        expect(new Set(settlement.businessEntryLineAttachmentSnapshots?.map((snapshot) => snapshot.values.purpose)))
          .toEqual(new Set(["现场签证单", "计量凭证"]));
        expect(new Set(settlement.businessEntryLineAttachmentSnapshots?.map((snapshot) => snapshot.target.entityId)).size).toBe(2);
        expect(settlement.businessEntryLineAttachmentSnapshots).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sceneKey: "settlement_line_attachment_purpose",
              target: expect.objectContaining({ entityType: "settlement_line_attachment" })
            })
          ])
        );
        const formalAttachmentFacts = await prisma.settlementLineAttachment.findMany({
          where: { id: { in: settlement.businessEntryLineAttachmentSnapshots!.map((snapshot) => snapshot.target.entityId) } },
          select: { id: true, purpose: true }
        });
        expect(new Map(formalAttachmentFacts.map((attachment) => [attachment.id, attachment.purpose])))
          .toEqual(new Map(settlement.businessEntryLineAttachmentSnapshots!.map((snapshot) => [
            snapshot.target.entityId,
            snapshot.values.purpose as string
          ])));
        await expect(Promise.all([
          prisma.settlement.count({ where: { code: settlementCode } }),
          prisma.settlementLineAttachment.count({ where: {
            settlementLineId: { in: settlement.businessEntryLineSnapshots!.map((snapshot) => snapshot.target.entityId) }
          } }),
          prisma.businessEntrySubmissionSnapshot.count({ where: {
            sceneKey: "settlement_line_attachment_purpose",
            entityId: { in: settlement.businessEntryLineAttachmentSnapshots!.map((snapshot) => snapshot.target.entityId) }
          } }),
          prisma.approvalInstance.count({ where: { businessType: "settlement", businessId: settlement.id } })
        ])).resolves.toEqual([1, 2, 2, 1]);
        const settlementDetail = await request<{ businessEntryHistory?: unknown[] }>("GET", `/settlements/${settlement.id}`);
        expect(settlementDetail.businessEntryHistory).toEqual([
          settlement.businessEntrySnapshot,
          ...settlement.businessEntryLineSnapshots!,
          ...settlement.businessEntryLineAttachmentSnapshots!
        ]);
        if (entryMode === "aggregate") {
          await runSettlementBrowserAcceptance(settlement.id, [
            { name: "合成现场签认金额", amountYuan: "100.00", quantity: "2.5" },
            { name: "合成零数量调整", amountYuan: "50.00", quantity: "0" }
          ], ["现场签证单", "计量凭证"]);
        }
        for (const role of ["material_staff", "material_director", "contract_director", "project_manager", "finance_director"]) {
          const identity = await loginAs(roleUsers.get(role)!);
          const signature = new FormData();
          signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-signature.png");
          const response = await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: signature });
          if (!response.ok) throw new Error(`合成结算签名上传失败：${response.status}`);
          await request("POST", `/settlements/${settlement.id}/approval`, { decision: "approve", confirmationPassword: identity.password, selfReviewReason: "合成结算链验证" });
        }
        const archiveActor = await loginAs(roleUsers.get("contract_director")!);
        await request("POST", `/settlements/${settlement.id}/signed-document-generation-retry`, {});
        expect(await request("POST", `/settlements/${settlement.id}/archive-confirmation`, { confirmationPassword: archiveActor.password })).toMatchObject({ status: "effective" });
        const sourceSettlementLineId = settlement.businessEntryLineSnapshots?.[0]?.target.entityId;
        if (!sourceSettlementLineId) throw new Error("公开结算提交未返回可追溯明细");
        await loginAs(roleUsers.get("contract_staff")!);
        const offsetDraft = await request<Identified & { revision: number }>("POST", settlementDraftPath, {
          contractVersionId: draft.version.id, settlementTemplateVersionId: settlementTemplate.version.id,
          code: `POL114-ST-OFFSET-${randomUUID()}`, periodLabel: "2026-10", periodEnd: "2026-10-31",
          fieldReviewerUserId: roleUsers.get("material_staff"), fieldReviewerRoleKey: "material_staff",
          settlementLines: [
            { sourceType: "manual_adjustment", name: "合成本期补充量", amountCents: "10000", reason: "本期合法正向调整" },
            {
              sourceType: "manual_adjustment", adjustmentKind: "over_settlement_offset", name: "合成超结冲减",
              amountCents: "-5000", relatedSettlementLineId: sourceSettlementLineId,
              overageReason: "合同清单调减", reason: "冲减前期超结"
            }
          ]
        });
        const offsetDraftPath = `${settlementDraftPath}/${offsetDraft.id}`;
        const offsetFrozen = await request<Identified & { fileId: string }>(
          "POST", `${offsetDraftPath}/frozen-document`, { expectedRevision: offsetDraft.revision }
        );
        const offsetDownload = await request<{ downloadUrl: string }>(
          "POST", `/files/${offsetFrozen.fileId}/download-ticket`, {
            confirmationPassword: settlementApplicant.password, downloadReason: "合成冲减签署扫描件", accessMode: "download"
          }
        );
        const offsetDownloaded = await fetch(new URL(offsetDownload.downloadUrl, baseUrl));
        if (!offsetDownloaded.ok) throw new Error(`结算冲减冻结件下载失败：${offsetDownloaded.status}`);
        const offsetSigned = await upload(
          "synthetic-offset-signed.pdf", "application/pdf", new Uint8Array(await offsetDownloaded.arrayBuffer())
        );
        await request("POST", `${offsetDraftPath}/counterparty-signed-documents`, {
          expectedRevision: offsetDraft.revision, frozenDocumentId: offsetFrozen.id, uploadedFileId: offsetSigned.id,
          declaration: { pageOrderMatchesFrozenDocument: true, counterpartySignedAndDated: true, everyPageStamped: true, crossPageSealCompleted: true }
        });
        const offsetSettlement = await request<SettlementSubmission>(
          "POST", `${offsetDraftPath}/approval-submission`, { expectedRevision: offsetDraft.revision }
        );
        expect(offsetSettlement.businessEntryLineSnapshots).toEqual(expect.arrayContaining([
          expect.objectContaining({
            sceneKey: "settlement_line",
            values: expect.objectContaining({ name: "合成本期补充量", amountYuan: "100.00" })
          }),
          expect.objectContaining({
            sceneKey: "settlement_line",
            values: expect.objectContaining({
              name: "合成超结冲减", amountYuan: "-50.00",
              relatedSettlementLineId: sourceSettlementLineId, overageReason: "合同清单调减", reason: "冲减前期超结"
            })
          })
        ]));
        expect(offsetSettlement.businessEntryLineSnapshots).toHaveLength(2);
        const offsetDetail = await request<{ businessEntryHistory?: Array<{ sceneKey: string; values: Record<string, unknown> }> }>(
          "GET", `/settlements/${offsetSettlement.id}`
        );
        expect(offsetDetail.businessEntryHistory?.filter((snapshot) => snapshot.sceneKey === "settlement_line"))
          .toEqual(offsetSettlement.businessEntryLineSnapshots);
        if (entryMode === "aggregate") {
          await runSettlementBrowserAcceptance(offsetSettlement.id, [
            { name: "合成本期补充量", amountYuan: "100.00" },
            { name: "合成超结冲减", amountYuan: "-50.00" }
          ]);
        }
        await loginAs(actorUserId);
        const paymentEntry = await request<{ businessEntry?: { definition: BusinessEntrySceneDefinition } }>("GET", `/payments/create-capability?projectId=${project.id}`);
        expect(paymentEntry.businessEntry?.definition).toMatchObject({
          key: "payment_request", entityType: "payment_request", version: 1,
          fields: expect.arrayContaining([
            expect.objectContaining({ key: "code", type: "text" }),
            expect.objectContaining({ key: "requestedAmountYuan", type: "money" })
          ])
        });
        payment = await request<Identified & { businessEntrySnapshot?: BusinessEntryFrozenSnapshot }>("POST", "/payments", {
          settlementId: settlement.id, code: `POL114-PAY-${randomUUID()}`, requestedAmountCents: "10000",
          paymentMatter: "本期结算付款", amountCalculationExplanation: "按已归档生效结算申请100元"
        });
        expect(payment.businessEntrySnapshot).toMatchObject({
          sceneKey: "payment_request", target: { projectId: project.id, entityType: "payment_request", entityId: payment.id },
          values: expect.objectContaining({
            code: expect.stringMatching(/^POL114-PAY-/), sourceType: "settlement", paymentSubjectType: "our_company",
            settlementId: settlement.id, contractId: draft.contract.id, contractVersionId: draft.version.id,
            paymentMatter: "本期结算付款", amountCalculationExplanation: "按已归档生效结算申请100元",
            requestedAmountYuan: "100.00"
          })
        });
      } else {
        const application = await request<ContractPaymentApplicationPreviewReadModel>("GET", `/payments/contract-application?contractVersionId=${draft.version.id}`);
        const stage = application.availableStages.find((item) => !item.disabledReason);
        if (!stage) throw new Error("公开合同没有可申请付款阶段");
        payment = await request<Identified>("POST", "/payments", {
          sourceType: "contract_due", contractVersionId: draft.version.id,
          paymentTermsVersionId: stage.paymentTermsVersionId, paymentTermsStageId: stage.paymentTermsStageId,
          code: `POL114-PAY-${randomUUID()}`, requestedAmountCents: "10000", paymentMatter: "合成合同款",
          amountCalculationExplanation: "按合同生效阶段100%支付100元"
        });
      }
      const paymentDetail = await request<{
        financeEntry?: { definition: BusinessEntrySceneDefinition };
        businessEntryHistory?: BusinessEntryFrozenSnapshot[];
      }>("GET", `/payments/${payment.id}`);
      expect(paymentDetail.financeEntry?.definition).toMatchObject({
        key: "payment_finance_record", entityType: "finance_record", version: 1,
        fields: [{ key: "amountYuan", type: "money" }, { key: "occurredAt", type: "text" }]
      });
      if (settlementFinance) expect(paymentDetail.businessEntryHistory).toEqual([payment.businessEntrySnapshot]);
      const expectedApprovedAmountCents = entryMode === "aggregate" ? "9000" : "10000";
      const expectedApprovedAmountYuan = entryMode === "aggregate" ? "90.00" : "100.00";
      let paymentApprovalSnapshot: BusinessEntryFrozenSnapshot | undefined;
      for (let step = 0; step < 12; step++) {
        const approval = await prisma.approvalInstance.findFirst({ where: {
          businessType: "payment_request", businessId: payment.id, status: "in_progress"
        } });
        if (!approval) break;
        const node = (approval.frozenNodes as unknown as Array<{ roleKeys: string[]; approvedRoleKeys?: string[] }>)[approval.currentNodeIndex];
        const role = node?.roleKeys.find((key) => !node.approvedRoleKeys?.includes(key) && roleUsers.has(key));
        if (!role) throw new Error("公开付款链缺少审批岗位");
        const identity = await loginAs(roleUsers.get(role)!);
        const signature = new FormData();
        signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-payment-signature.png");
        const signedResponse = await fetch(`${baseUrl}/me/signature/canvas`, {
          method: "POST", headers: { authorization: `Bearer ${token}` }, body: signature
        });
        if (!signedResponse.ok) throw new Error(`合成签名上传失败：${signedResponse.status}`);
        const review = await request<{ reviewApprovalContext: Record<string, unknown> }>("GET", `/payments/${payment.id}`);
        const finalNode = approval.currentNodeIndex === (approval.frozenNodes as unknown[]).length - 1;
        if (!finalNode) {
          await expect(request("POST", `/payments/${payment.id}/approval`, {
            ...review.reviewApprovalContext, decision: "approve", approvedAmountCents: "9000",
            confirmationPassword: identity.password
          })).rejects.toThrow();
          if (settlementFinance) {
            expect((await request<{ businessEntryHistory: BusinessEntryFrozenSnapshot[] }>("GET", `/payments/${payment.id}`)).businessEntryHistory)
              .toEqual([payment.businessEntrySnapshot]);
          }
        }
        const approved = await request<{ businessEntrySnapshot?: BusinessEntryFrozenSnapshot }>("POST", `/payments/${payment.id}/approval`, {
          ...review.reviewApprovalContext, decision: "approve",
          ...(finalNode && entryMode === "aggregate" ? { approvedAmountCents: "9000" } : {}),
          confirmationPassword: identity.password
        });
        if (finalNode) paymentApprovalSnapshot = approved.businessEntrySnapshot;
      }
      if (settlementFinance) {
        expect(paymentApprovalSnapshot).toMatchObject({
          sceneKey: "payment_approval_amount", target: { projectId: project.id, entityType: "payment_request", entityId: payment.id },
          values: { approvedAmountYuan: expectedApprovedAmountYuan }
        });
        expect((await request<{ businessEntryHistory: BusinessEntryFrozenSnapshot[] }>("GET", `/payments/${payment.id}`)).businessEntryHistory)
          .toEqual([payment.businessEntrySnapshot, paymentApprovalSnapshot]);
      }
      await loginAs(projectFinanceUserId);
      const quotaEvidence = await upload("synthetic-quota.pdf", "application/pdf", await pdf.save());
      const quota = await request<{ quotaId: string }>("POST", `/projects/${project.id}/financing-quotas`, {
        idempotencyKey: randomUUID(), amountCents: "10000", reason: "合成公开付款链额度", attachmentFileId: quotaEvidence.id
      });
      for (const reviewerId of [projectFinanceUserId, actorUserId]) {
        const identity = await loginAs(reviewerId);
        const signature = new FormData();
        signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "synthetic-quota-signature.png");
        const signedResponse = await fetch(`${baseUrl}/me/signature/canvas`, {
          method: "POST", headers: { authorization: `Bearer ${token}` }, body: signature
        });
        if (!signedResponse.ok) throw new Error(`合成签名上传失败：${signedResponse.status}`);
        const quotaCapability = await request<{ lifecycleToken: string }>("GET", `/projects/${project.id}/financing-quotas/${quota.quotaId}/review-capability`);
        await request("POST", `/projects/${project.id}/financing-quotas/${quota.quotaId}/approval`, {
          actionId: randomUUID(), expectedLifecycleToken: quotaCapability.lifecycleToken,
          decision: "approve", confirmationPassword: identity.password,
          selfReviewReason: "合成公开链由财务主管独立复核本人额度申请"
        });
      }
      const financeIdentity = await loginAs(roleUsers.get("finance_staff")!);
      const voucher = await upload("synthetic-payment-voucher.pdf", "application/pdf", await pdf.save());
      const executable = await request<{ executionContext: { expectedPaymentUpdatedAt: string } }>("GET", `/payments/${payment.id}`);
      expect(executable.executionContext).toMatchObject({ expectedPaymentUpdatedAt: expect.any(String) });
      await request("POST", `/payments/${payment.id}/executions`, {
        ...executable.executionContext, idempotencyKey: randomUUID(), amountCents: expectedApprovedAmountCents,
        paidAt: new Date().toISOString(), voucherFileId: voucher.id, confirmationPassword: financeIdentity.password
      });
      const finance = await request<{ businessEntrySnapshot?: BusinessEntryFrozenSnapshot }>("POST", `/payments/${payment.id}/finance-records`, {
        amountCents: expectedApprovedAmountCents, occurredAt: "2026-09-17T04:34:56.000Z", confirmationPassword: financeIdentity.password
      });
      expect(finance.businessEntrySnapshot).toMatchObject({
        sceneKey: "payment_finance_record", revision: 1,
        values: { amountYuan: expectedApprovedAmountYuan, occurredAt: "2026-09-17T04:34:56.000Z" }
      });
      const recorded = await request<{ financeEntry: { history: BusinessEntryFrozenSnapshot[] } }>("GET", `/payments/${payment.id}`);
      expect(recorded.financeEntry.history).toEqual([finance.businessEntrySnapshot]);
      await expect(request("POST", `/payments/${payment.id}/finance-records`, {
        amountCents: expectedApprovedAmountCents, occurredAt: "2026-09-17T04:34:56.000Z", confirmationPassword: financeIdentity.password
      })).rejects.toThrow();
      expect((await request<{ financeEntry: { history: BusinessEntryFrozenSnapshot[] } }>("GET", `/payments/${payment.id}`)).financeEntry.history).toEqual(recorded.financeEntry.history);
      const nonFinanceIdentity = await loginAs(actorUserId);
      await expect(request("POST", `/payments/${payment.id}/finance-records`, {
        amountCents: "1", occurredAt: "2026-09-17T04:34:56.000Z", confirmationPassword: nonFinanceIdentity.password
      })).rejects.toThrow("403");
      expect((await request<{ financeEntry: { history: BusinessEntryFrozenSnapshot[] } }>("GET", `/payments/${payment.id}`)).financeEntry.history).toEqual([]);
    }
  });
});
