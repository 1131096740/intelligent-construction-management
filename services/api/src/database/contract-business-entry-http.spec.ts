import { verifyApprovedPdf } from "./approval-pdf-acceptance.test-support";
import { verifyLayoutPreviewHttp } from "./layout-preview-http.acceptance";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import * as ExcelJS from "exceljs";
import { createRequire } from "node:module";
import type { BusinessEntryFrozenSnapshot, BusinessEntrySceneDefinition, ContractDetailReadModel, ContractPaymentApplicationPreviewReadModel, PaymentDetailReadModel } from "@jiangkong/shared-domain";
import { AppModule } from "../app.module";
import { SEED_LAYOUT_FONT } from "../contract-document/seed-layout-docx-source";
import { PrismaService } from "./prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { openSignedSettlementQualification } from "./signed-settlement-qualification.test-support";

const enabled = process.env.RUN_POL114_HTTP_PG16 === "1";
const { createSignedChangeQualification } = createRequire(__filename)("../../prisma/signed-change-qualification.cjs") as {
  createSignedChangeQualification(databaseUrl: string): {
    databaseUrl: string; witnessKey: string; install: string[]; uninstall: string[];
  };
};
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
  bills: Array<{ id: string; billKey: string; revision: number; rows: Array<Record<string, unknown>> }>;
};
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
  let actorUserId: string;
  let actorPhone: string;
  let actorPassword: string;
  let prisma: PrismaService;
  let signedSettlementQualification: Awaited<ReturnType<typeof openSignedSettlementQualification>> | undefined;
  let signedBaseUrl: string | undefined;
  const identities = new Map<string, { phone: string; password: string }>();
  jest.setTimeout(60_000);

  async function runSignedSettlementBrowserAcceptance(projectId: string, settlementId: string, number: string, amount: string) {
    if (process.env.RUN_POL114_BROWSER !== "1") return;
    await new Promise<void>((resolve, reject) => {
      const childEnv = { ...process.env };
      delete childEnv.JEST_WORKER_ID;
      const child = spawn(process.env.PNPM_BIN ?? "pnpm", [
        "--filter", "@jiangkong/web-admin", "exec", "playwright", "test",
        "--config", "playwright.settlement-entry-history-real.config.ts",
        "--global-timeout=85000"
      ], {
        cwd: join(__dirname, "../../../.."),
        env: {
          ...childEnv,
          POL114_SIGNED_SETTLEMENT_ID: settlementId,
          POL114_SIGNED_SETTLEMENT_PROJECT_ID: projectId,
          POL114_SIGNED_SETTLEMENT_NUMBER: number,
          POL114_SIGNED_SETTLEMENT_AMOUNT: amount,
          POL114_SIGNED_SETTLEMENT_API: signedBaseUrl,
          POL114_REAL_SETTLEMENT_PHONE: actorPhone,
          POL114_REAL_SETTLEMENT_PASSWORD: actorPassword,
          VITE_API_PROXY_TARGET: baseUrl
        },
        stdio: "inherit"
      });
      child.once("error", reject);
      child.once("close", (code, signal) => code === 0
        ? resolve()
        : reject(new Error(`真实已签结算浏览器验收失败：${signal ?? code ?? "unknown"}`)));
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
    if(process.env.OPERATING_LEDGER_DB_WRITE_SECRET){const secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET;await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;}
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
  });

  it("四类版式真实样张、V1保持与资源授权公开HTTP及浏览器", async () => {
    await verifyLayoutPreviewHttp(app, baseUrl, { id: actorUserId, phone: actorPhone, password: actorPassword });
  }, 180_000);

  afterAll(async () => {
    try { await signedSettlementQualification?.close(); }
    finally { await app?.close(); }
  });

  function signedSettlementFailure(status: number, value: unknown) {
    const code = (value as { code?: string } | null)?.code;
    const allowed = code && ["OPERATIONAL_WRITE_FREEZE_ACTIVE", "OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED", "OLD_WRITE_ENTRY_RETIRED"].includes(code)
      ? code : "UNCLASSIFIED";
    return `POL114_SIGNED_SETTLEMENT_HTTP_${status}_${allowed} ${signedSettlementQualification?.takeQueryFailure() ?? ""}`;
  }

  async function runContractCase(entryMode: "aggregate" | "legacy" | "legacy-ownerless", typeOverride?: string, paymentMode?: "direct") {
    // Each case owns its identity, even if Jest eventually aborts an earlier case.
    let token = "";
    async function request<T = unknown>(method: string, path: string, body?: unknown, leaseToken?: string, target = baseUrl): Promise<T> {
      const response = await fetch(`${target}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-contract-numeric-protocol": "2",
          ...(leaseToken ? { "x-contract-draft-lease": leaseToken } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const value = await response.json() as T;
      if (!response.ok) {
        const diagnostic = target !== baseUrl ? signedSettlementFailure(response.status, value) : JSON.stringify(value);
        throw new Error(`${method} ${path}: ${response.status} ${diagnostic}`);
      }
      return value;
    }

    async function upload(name: string, mimeType: string, data: Uint8Array, uploadPath = "/files", target = baseUrl) {
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(data).buffer], { type: mimeType }), name);
      const response = await fetch(`${target}${uploadPath}`, {
        method: "POST", headers: { authorization: `Bearer ${token}` }, body: form
      });
      const result = await response.json() as Identified;
      if (!response.ok) {
        const diagnostic = target !== baseUrl ? signedSettlementFailure(response.status, result) : JSON.stringify(result);
        throw new Error(`上传失败 HTTP ${response.status}: ${diagnostic}`);
      }
      return result;
    }

    token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", {
      phone: actorPhone, password: actorPassword
    })).tokens.accessToken;
    const tokensByUserId = new Map([[actorUserId, token]]);
    const settlementFinance = paymentMode !== "direct" && process.env.RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16 === "1";
    const paymentFinance = paymentMode === "direct" || process.env.RUN_POL114_PAYMENT_HTTP_PG16 === "1" || settlementFinance;
    const contractTypeKey = typeOverride ?? (paymentFinance && !settlementFinance ? "generic_contract" : "material_purchase");
    const settlementMode = settlementFinance ? "settlement_required" : "direct_payment";
    const project = await request<Identified>("POST", "/projects", {
      code: `POL114-${randomUUID()}`, name: "合同统一录入合成项目"
    });
    const prisma = app.get(PrismaService);
    let projectFinanceUserId = "";
    const roleUsers = new Map<string, string>();
    for (const key of ["budget_staff", "contract_staff", "material_staff", "material_director", "project_manager", "finance_director", "finance_staff", "budget_director", "contract_director", "chairman", "comprehensive_director", "engineering_director", "engineering_foreman", "engineering_tech"]) {
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
        projectId: ["project_manager", "material_staff", "contract_staff", "budget_staff", "engineering_director", "engineering_foreman", "engineering_tech"].includes(key) ? project.id : null
      } });
      if (["project_manager", "material_staff", "contract_staff", "budget_staff", "engineering_director", "engineering_foreman", "engineering_tech"].includes(key)) {
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
    let controlledCounterpartyVersionId:string|undefined;
    if(process.env.COMPANY_TRANSFER_CORE_RECEIPT){const party=await prisma.businessParty.create({data:{name:"合成材料供应商",normalizedName:`合成材料供应商-${randomUUID()}`,createdByUserId:actorUserId}});controlledCounterpartyVersionId=(await prisma.businessPartyVersion.create({data:{businessPartyId:party.id,versionNo:1,snapshot:{name:party.name},createdByUserId:actorUserId}})).id;}
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
    let draft = await request<CreatedDraft>("POST", "/contracts", {
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
      key: "contract_basic", entityType: "contract_version", version: 1,
      fields: [
        { key: "contractName", label: "合同名称", type: "text" },
        { key: "companyEntityId", label: "我方签约主体", type: "company" },
        { key: "relationship", label: "合同关系", type: "single_select" },
        { key: "businessType", label: "业务类型", type: "single_select" },
        { key: "amountBasis", label: "金额口径", type: "single_select" },
        { key: "invoiceStatus", label: "发票约定", type: "single_select" },
        { key: "settlementText", label: "结算约定", type: "long_text" }
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
      const identity = identities.get(roleUsers.get("comprehensive_director")!)!;
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
    if(process.env.COMPANY_TRANSFER_CORE_RECEIPT){await prisma.project.update({where:{id:project.id},data:{operatingLedgerEffectiveDate:new Date("2026-01-01")}});}
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
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${SEED_LAYOUT_FONT}" w:hAnsi="${SEED_LAYOUT_FONT}" w:eastAsia="${SEED_LAYOUT_FONT}"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
    const layoutFields = {
      "contract.name": "合成合同名称",
      "party.owner.name": "合成甲方",
      "party.counterparty.name": "合成乙方",
      "contract.temporaryCode": "合成合同编号",
      "document.watermark": "合成文档水印"
    };
    const sourceParagraphs = Object.values(layoutFields).map((value) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`).join("");
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${sourceParagraphs}<w:sectPr/></w:body></w:document>`);
    const docx = await upload("合成合同版式.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip.generate({ type: "nodebuffer" }));
    const layout = await request<{ version: Identified }>("POST", "/contract-layout-templates", {
      name: "合成合同版式", contractTypeKey, docxFileId: docx.id, placeholderSchema: { bills: [] }
    });
    const layoutPath = `/contract-layout-template-versions/${layout.version.id}`;
    const positions = await request<{
      sourceSha256: string;
      draftRevision: number;
      positions: Array<{ positionId: string; text: string }>;
    }>("GET", `${layoutPath}/source-positions`);
    const bindings = Object.entries(layoutFields).map(([fieldKey, text]) => {
      const position = positions.positions.find((candidate) => candidate.text === text);
      if (!position) throw new Error(`合成版式缺少原文位置：${text}`);
      return { positionId: position.positionId, start: 0, end: text.length, fieldKey };
    });
    const sourceIdentity = { sourceFileId: docx.id, sourceSha256: positions.sourceSha256 };
    const mapping = await request<{ draftRevision: number; mappingFingerprint: string }>("PATCH", `${layoutPath}/source-mapping`, {
      expectedRevision: positions.draftRevision, ...sourceIdentity, bindings
    });
    await request("POST", `${layoutPath}/inspection`);
    const previewPath = `${layoutPath}/preview-generation`;
    await request("POST", previewPath, {
      contract: { name: "合成合同样张" }, party: { owner: { name: "合成甲方" }, counterparty: { name: "合成乙方" } }
    });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const preview = await request<{ status: string; errorMessage?: string }>("GET", previewPath);
      if (preview.status === "succeeded") break;
      if (preview.status === "failed") throw new Error(`合成合同版式样张失败：${preview.errorMessage}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await request("POST", `${layoutPath}/source-mapping-confirmation`, {
      expectedRevision: mapping.draftRevision, ...sourceIdentity, mappingFingerprint: mapping.mappingFingerprint
    });
    await request("POST", `${layoutPath}/submission`);
    await request("POST", `${layoutPath}/publication`, { changeSummary: "合成版式原文与真实样张确认" });
    if (paymentFinance) {
      await request("POST", `/contract-workbench/${draft.version.id}/settlement-mode/confirm`, {
        expectedRevision: saved.version.draftRevision, settlementMode
      });
      saved = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    }
    const completeDraftInput = {
      idempotencyKey: randomUUID(), saveKind: "manual",
      expectedRevision: saved.version.draftRevision, changedSections: ["draft", "parties", "payment_terms", "bills"],
      draft: {
        companyEntityId: company.id, draftData: { contractName: "合成材料采购合同", fieldValues: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" } },
        clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountCents: "500000",
        taxFacts: { invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" }
      },
      parties: [{ roleKey: "party_b", displayOrder: 0, ...(controlledCounterpartyVersionId?{businessPartyVersionId:controlledCounterpartyVersionId}:{}), snapshot: { name: "合成材料供应商" } }],
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
    };
    await request("PUT", `/contract-drafts/${draft.version.id}`, completeDraftInput, lease.token);
    let current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    expect(current.bills).toEqual(expect.arrayContaining([expect.objectContaining({
      billKey: "reference", rows: expect.arrayContaining([expect.objectContaining({
        itemName: "合成材料", quantity: expect.stringMatching(/^2(?:\.0+)?$/u),
        unitPrice: expect.stringMatching(/^10(?:\.0+)?$/u), customData: { brand: "合成品牌" }
      })])
    })]));
    expect(current.templateEntry?.values).toMatchObject({ deliveryLocation: "合成仓库", adjustment: "-1.234e-7" });
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
    current = confirmedMode;
    await expect(request("POST", `/contract-drafts/${draft.version.id}/submission`, {
      idempotencyKey: randomUUID(), expectedRevision: current.version.draftRevision
    }, lease.token)).rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
    expect(await prisma.contractDraftSubmissionRequest.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
    expect(await prisma.approvalInstance.count({ where: { businessType: "contract_version", businessId: draft.version.id } })).toBe(0);
    for (const retired of ["seal-approval", "seal/approve", "seal/complete"]) {
      await expect(request("POST", `/contracts/${draft.version.id}/${retired}`, {}))
        .rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
    }
    expect(await prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
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
    // The Linux named image does not admit the Darwin-pinned V2 renderer.
    // This exact NUMERIC V2 effective prerequisite is synthetic historical input.
    // The separate native lifecycle owns generation, approval, seal and archive proofs.
    const companyVersion = await prisma.companyEntityVersion.findUniqueOrThrow({
      where: { companyEntityId_versionNo: { companyEntityId: company.id, versionNo: companyRecord.currentVersionNo } }
    });
    const counterpartyName = "合成材料供应商";
    const historicalAt = new Date("2026-01-02T00:00:00.000Z");
    draft = await prisma.$transaction(async tx => {
      const contract = await tx.contract.create({ data: {
        projectId: project.id, contractTypeKey, ownerUserId: actorUserId,
        code: `POL114-HISTORICAL-${randomUUID()}`,
        name: "合成历史已生效合同", counterparty: counterpartyName,
        companyEntityId: company.id, companyEntityName: companyVersion.name
      } });
      const version = await tx.contractVersion.create({ data: {
        contractId: contract.id, versionNo: 1, changeType: "original", status: "effective", effectiveAt: historicalAt,
        numericProtocolVersion: 2, amountCents: 500000n, amountYuan: "5000.0000", amountLimitType: "capped",
        pricingNature: "fixed_total", amountSource: "manual", signingSubjectType: "our_company",
        companyEntityIdSnapshot: company.id, companyEntityVersionId: companyVersion.id,
        companyEntityNameSnapshot: companyVersion.name, companyEntityCreditCodeSnapshot: companyVersion.unifiedSocialCreditCode,
        companyEntityRegisteredAddressSnapshot: companyVersion.registeredAddress,
        settlementMode, settlementModeSource: "contract_director",
        settlementModeConfirmedByUserId: roleUsers.get("contract_director")!,
        settlementModeConfirmedAt: historicalAt,
        invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: "13",
        taxFactStatus: "frozen", taxFactsFrozenAt: historicalAt, taxFactSource: "contract_document", taxFactRevision: 1,
        draftData: { contractName: contract.name, contractBasics: { relationship: "inside" } },
        templateSnapshot: {}, clauseSnapshot: []
      } });
      const terms = await tx.paymentTermsVersion.create({ data: {
        contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "effective",
        originalText: completeDraftInput.paymentTerms.originalText
      } });
      for (const stage of completeDraftInput.paymentTerms.stages) {
        await tx.paymentTermsStage.create({ data: { paymentTermsVersionId: terms.id, ...stage } });
      }
      return { contract, version };
    });
    const detail = await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`);
    expect(detail.contractVersionId).toBe(draft.version.id);
    expect(await prisma.approvalInstance.count({ where: { businessType: "contract_version", businessId: draft.version.id } })).toBe(0);
    if (paymentFinance) {
      const loginAs = async (userId: string) => {
        const identity = identities.get(userId);
        if (!identity) throw new Error("公开链缺少本次合成账号");
        const cachedToken = tokensByUserId.get(userId);
        token = cachedToken ?? (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", identity)).tokens.accessToken;
        tokensByUserId.set(userId, token);
        return identity;
      };
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText("SYNTHETIC PAYMENT FIXTURE");
      let payment: Identified & { businessEntrySnapshot?: BusinessEntryFrozenSnapshot };
      if (settlementFinance) {
        if (!signedSettlementQualification) {
          signedSettlementQualification = await openSignedSettlementQualification(prisma, process.env.DATABASE_URL!);
          signedBaseUrl = signedSettlementQualification.baseUrl;
        }
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
        const signedPath = `/projects/${project.id}/signed-contract-settlements`;
        const requestSigned = <T = unknown>(method: string, path: string, body?: unknown) =>
          request<T>(method, path, body, undefined, signedBaseUrl!);
        const contractSelection = { contractKind: "downstream", contractId: draft.contract.id };
        const original = new Uint8Array(await pdf.save());
        type SignedRecord = Identified & { revision: number; state: string; confirmationNo: string | null };
        const signedNumber = process.env.POL114_HTTP_SETTLEMENT_CODE ?? `POL114-ST-${randomUUID()}`;
        const registerSignedSettlement = async (number: string, amountYuan: string, returnedOnce: boolean) => {
          await loginAs(roleUsers.get("contract_staff")!);
          const file = await upload(`${number}.pdf`, "application/pdf", original, `${signedPath}/files`, signedBaseUrl);
          const inputs = { ...contractSelection, number, amountYuan, fileIds: [file.id] };
          const created = await requestSigned<SignedRecord>("POST", signedPath, inputs);
          expect(created.state).toBe("draft");
          const rowPath = `${signedPath}/${created.id}`;
          let submitted = await requestSigned<SignedRecord>("POST", `${rowPath}/submission`, { revision: created.revision });
          expect(submitted.state).toBe("pending_review");
          await expect(requestSigned("POST", `${rowPath}/review`, {
            revision: submitted.revision, decision: "confirm"
          })).rejects.toThrow(`POST ${rowPath}/review: 403`);
          await loginAs(roleUsers.get("contract_director")!);
          if (returnedOnce) {
            const returned = await requestSigned<SignedRecord>("POST", `${rowPath}/review`, {
              revision: submitted.revision, decision: "return", reason: "合成复核退回核对原件"
            });
            expect(returned.state).toBe("returned");
            await loginAs(roleUsers.get("contract_staff")!);
            const resaved = await requestSigned<SignedRecord>("PATCH", rowPath, { ...inputs, revision: returned.revision });
            expect(resaved.state).toBe("draft");
            submitted = await requestSigned<SignedRecord>("POST", `${rowPath}/submission`, { revision: resaved.revision });
            await loginAs(roleUsers.get("contract_director")!);
          }
          const review = { revision: submitted.revision, decision: "confirm" };
          const attempts = await Promise.allSettled([
            requestSigned<SignedRecord>("POST", `${rowPath}/review`, review),
            requestSigned<SignedRecord>("POST", `${rowPath}/review`, review)
          ]);
          const approved = attempts.filter((attempt) => attempt.status === "fulfilled");
          const rejected = attempts.filter((attempt) => attempt.status === "rejected");
          expect({
            approved: approved.length,
            rejected: rejected.length,
            responses: rejected.flatMap(({ reason }) => reason instanceof Error
              ? (reason.message.match(/POL114_SIGNED_SETTLEMENT_(?:HTTP_[1-5][0-9]{2}_[A-Z_]+|QUERY_[0-9A-Z_]+)/gu) ?? [])
              : [])
          }).toMatchObject({ approved: 1, rejected: 1 });
          expect(rejected[0]?.reason).toEqual(expect.objectContaining({
            message: expect.stringContaining(`POST ${rowPath}/review: 409`)
          }));
          const confirmed = approved[0]!.value;
          expect(confirmed.state).toBe("confirmed");
          const filePath = `${rowPath}/attachments/${file.id}`;
          expect(await requestSigned("GET", filePath)).toMatchObject({ fileId: file.id, mimeType: "application/pdf" });
          const ticket = await requestSigned<{ downloadUrl: string }>("POST", `${filePath}/download-ticket`, {
            downloadReason: "核对合成结算已签原件"
          });
          const downloaded = await fetch(new URL(ticket.downloadUrl, signedBaseUrl), { headers: { authorization: `Bearer ${token}` } });
          expect(downloaded.status).toBe(200);
          expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
          return confirmed;
        };
        const firstSettlement = await registerSignedSettlement(signedNumber, "200.0000", true);
        const settlement = await registerSignedSettlement(`${signedNumber}-OFFSET`, "-50.0000", false);
        expect([firstSettlement.confirmationNo, settlement.confirmationNo]).toEqual(["1", "2"]);
        const paymentBasisPath = `${signedPath}/payment-basis?${new URLSearchParams(contractSelection)}`;
        expect(await requestSigned("GET", paymentBasisPath)).toMatchObject({
          latestConfirmed: { id: settlement.id, amountYuan: "-50.0000" },
          confirmedHistory: expect.arrayContaining([expect.objectContaining({ id: firstSettlement.id, amountYuan: "200.0000" })]),
          confirmedYuan: "150.0000",
          downstreamCapacity: { wholeCentLimit: "15000" }
        });
        if (entryMode === "aggregate") {
          await runSignedSettlementBrowserAcceptance(project.id, firstSettlement.id, signedNumber, "200.0000");
          await runSignedSettlementBrowserAcceptance(project.id, settlement.id, `${signedNumber}-OFFSET`, "-50.0000");
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
        await expect(request("POST", "/payments", {
          sourceType: "signed_settlement", signedSettlementId: firstSettlement.id,
          code: `POL114-OUTDATED-${randomUUID()}`, requestedAmountCents: "10000"
        })).rejects.toThrow("付款只可选择最近确认的一期已签结算");
        payment = await request<Identified & { businessEntrySnapshot?: BusinessEntryFrozenSnapshot }>("POST", "/payments", {
          sourceType: "signed_settlement", signedSettlementId: settlement.id, code: `POL114-PAY-${randomUUID()}`, requestedAmountCents: "10000",
          paymentMatter: "本期结算付款", amountCalculationExplanation: "按已签结算累计可付金额申请100元"
        });
        expect(payment.businessEntrySnapshot).toMatchObject({
          sceneKey: "payment_request", target: { projectId: project.id, entityType: "payment_request", entityId: payment.id },
          values: expect.objectContaining({
            code: expect.stringMatching(/^POL114-PAY-/), sourceType: "signed_settlement", paymentSubjectType: "our_company",
            settlementId: settlement.id, contractId: draft.contract.id, contractVersionId: draft.version.id,
            paymentMatter: "本期结算付款", amountCalculationExplanation: "按已签结算累计可付金额申请100元",
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
        const { reviewApprovalContext } = await request<{ reviewApprovalContext: {
          expectedPaymentUpdatedAt: string;
          expectedApprovalInstanceId: string;
          expectedNodeIndex: number;
          expectedApprovalUpdatedAt: string;
        } | null }>("GET", `/payments/${payment.id}`);
        if (!reviewApprovalContext) throw new Error("公开付款详情没有审批坐标");
        const { expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt } = reviewApprovalContext;
        const approvalCoordinates = { expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt };
        const finalNode = approval.currentNodeIndex === (approval.frozenNodes as unknown[]).length - 1;
        if (!finalNode) {
          await expect(request("POST", `/payments/${payment.id}/approval`, {
            ...approvalCoordinates, decision: "approve", approvedAmountCents: "9000",
            confirmationPassword: identity.password
          })).rejects.toThrow();
          if (settlementFinance) {
            expect((await request<{ businessEntryHistory: BusinessEntryFrozenSnapshot[] }>("GET", `/payments/${payment.id}`)).businessEntryHistory)
              .toEqual([payment.businessEntrySnapshot]);
          }
        }
        const approved = await request<{ businessEntrySnapshot?: BusinessEntryFrozenSnapshot }>("POST", `/payments/${payment.id}/approval`, {
          ...approvalCoordinates, decision: "approve",
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
      const paymentPdfActor = await loginAs(projectFinanceUserId);
      await verifyApprovedPdf({ db: prisma, baseUrl, token, password: paymentPdfActor.password,
        businessType: "payment_request", businessId: payment.id,
        roles: ["comprehensive_director", "project_manager", "finance_director", "contract_director", "chairman"], label: settlementFinance ? "结算付款" : "直接付款" });
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
      await verifyApprovedPdf({ db: prisma, baseUrl, token, password: actorPassword,
        businessType: "project_financing_quota", businessId: quota.quotaId,
        roles: ["finance_director", "chairman"], label: "融资额度" });
      const financeIdentity = await loginAs(roleUsers.get("finance_staff")!);
      const voucher = await upload("synthetic-payment-voucher.pdf", "application/pdf", await pdf.save());
      const executionAmounts = settlementFinance
        ? [BigInt(expectedApprovedAmountCents)]
        : [BigInt(expectedApprovedAmountCents) / 2n, BigInt(expectedApprovedAmountCents) - BigInt(expectedApprovedAmountCents) / 2n];
      const executionIds: string[] = [];
      for (const [index, amount] of executionAmounts.entries()) {
        const executionVoucher = index === 0 ? voucher : await upload("synthetic-second-voucher.pdf", "application/pdf", await pdf.save());
        const actualPaidAt = new Date().toISOString();
        const bank = await request<Identified>("POST", "/contract-bank-verifications", {
          projectId: project.id, companyEntityId: company.id, accountNumber: "6222000011111111",
          bankReference: randomUUID(), direction: "outflow", amountCents: amount.toString(), occurredAt: actualPaidAt,
          evidenceFileId: (await upload("synthetic-bank-proof.pdf", "application/pdf", await pdf.save())).id,
          reason: "合成实付银行回单", idempotencyKey: randomUUID(), confirmationPassword: financeIdentity.password
        });
        const checker = await loginAs(projectFinanceUserId);
        const holder = await upload("synthetic-holder.pdf", "application/pdf", await pdf.save());
        await request("POST", `/contract-bank-verifications/${bank.id}/decision`, {
          decision: "confirm", accountNumber: "6222000011111111", holderEvidenceFileId: holder.id, confirmationPassword: checker.password
        });
        const verified = await prisma.contractBankVerificationRequest.findUniqueOrThrow({ where: { id: bank.id } });
        const bankReceiptReference = (await prisma.verifiedBankTransactionObservation.findUniqueOrThrow({ where: { id: verified.observationId! } })).reference;
        await loginAs(roleUsers.get("finance_staff")!);

        const executable = await request<PaymentDetailReadModel & { executionContext: { expectedPaymentUpdatedAt: string } }>("GET", `/payments/${payment.id}`);
        expect(executable.executionContext).toMatchObject({ expectedPaymentUpdatedAt: expect.any(String) });
        if (process.env.COMPANY_TRANSFER_CORE_RECEIPT) {
          expect(executable.registeredExecutionCapability).toMatchObject({
            supportedDomain: false, workflowReady: false, canSupplementVoucher: false
          });
        }
        const executionBody = {
          ...executable.executionContext, idempotencyKey: randomUUID(), amountCents: amount.toString(),
          paidAt: actualPaidAt, bankReceiptReference, voucherFileId: executionVoucher.id, confirmationPassword: financeIdentity.password
        };
        const execution = await request<Identified>("POST", `/payments/${payment.id}/executions`, executionBody);
        executionIds.push(execution.id);
        if (!settlementFinance) {
          const replay = await request<Identified>("POST", `/payments/${payment.id}/executions`, executionBody);
          expect(replay.id).toBe(execution.id);
          const persisted = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
          expect(persisted.paidAmountCents).toBe(executionAmounts.slice(0, index + 1).reduce((sum, value) => sum + value, 0n));
          expect(persisted.status).toBe(index === 0 ? "partially_paid" : "paid");
        }
      }
      if (!settlementFinance) {
        const allocations = await prisma.paymentExecutionAllocation.findMany({ where: { paymentRequestId: payment.id } });
        expect(allocations).toHaveLength(2);
        expect(allocations.reduce((sum, item) => sum + item.amountCents, 0n)).toBe(BigInt(expectedApprovedAmountCents));
        const allocation = allocations[0]!;
        const frozenRequest = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
        expect(allocation).toMatchObject({
          settlementId: null, sourceType: "contract_due", allocationType: "contract_due_payment",
          contractVersionId: frozenRequest.contractVersionId, paymentTermsVersionId: frozenRequest.paymentTermsVersionId,
          stageId: frozenRequest.paymentTermsStageId,
          sourceRowId: `contract:${frozenRequest.paymentTermsVersionId}:${frozenRequest.paymentTermsStageId}`
        });
        const mutations: Array<Partial<typeof allocation>> = [
          { paymentExecutionId: randomUUID() }, { paymentRequestId: randomUUID() },
          { projectId: randomUUID() }, { contractId: randomUUID() },
          { contractVersionId: randomUUID() }, { contractVersionId: null },
          { paymentTermsVersionId: randomUUID() }, { stageId: randomUUID() }, { stageId: null },
          { sourceType: "settlement" }, { allocationType: "advance_deduction" },
          { sourceRowId: `contract:${frozenRequest.paymentTermsVersionId}:invented-stage` },
          { triggerAnchor: "settlement_effective" }, { triggerAnchor: null },
          { stageType: "final" }, { stageName: "替换后的阶段" },
          { dueDays: allocation.dueDays! + 1 }, { ratioBps: 9999 }, { fixedAmountCents: 1n },
          { sourceEffectiveAt: new Date(allocation.sourceEffectiveAt!.getTime() + 1) },
          { expectedPayableAt: new Date(allocation.expectedPayableAt!.getTime() + 1) },
          { sourcePayableAmountCents: allocation.sourcePayableAmountCents + 1n },
          { amountCents: BigInt(expectedApprovedAmountCents) + 1n },
          { createdByUserId: randomUUID() }, { allocationOrder: 1 }
        ];
        for (const mutation of mutations) {
          await expect(prisma.paymentExecutionAllocation.create({
            data: { ...allocation, ...mutation, id: randomUUID() }
          })).rejects.toThrow("Direct contract allocation does not match its frozen payment stage");
        }
        await expect(prisma.paymentExecutionAllocation.create({
          data: { ...allocation, id: randomUUID(), amountCents: 0n }
        })).rejects.toThrow("PaymentExecutionAllocation_amount_positive_check");
        await expect(prisma.paymentExecutionAllocation.create({
          data: { ...allocation, id: randomUUID(), amountCents: 1n }
        })).rejects.toThrow("payment_execution_allocation_total_invalid");
        await expect(prisma.paymentExecutionAllocation.update({
          where: { id: allocation.id }, data: { amountCents: allocation.amountCents + 1n }
        })).rejects.toThrow("immutable");
        // Fixed stages are supported by historical takeover, not the current
        // aggregate editor. This rollback-only PG fixture isolates the SAME
        // database guard; it is not claimed as a fixed-stage HTTP lifecycle.
        const stageBefore = await prisma.paymentTermsStage.findUniqueOrThrow({ where: { id: allocation.stageId! } });
        const fixtureRollback = new Error("fixed-stage-constraint-fixture-rollback");
        try {
          await prisma.$transaction(async tx => {
            await tx.paymentTermsStage.update({ where: { id: stageBefore.id }, data: { ratioBps: null, fixedAmountCents: 100000n } });
            await tx.$executeRawUnsafe('CREATE TEMP TABLE direct_stage_guard_fixture (LIKE public."PaymentExecutionAllocation" INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP');
            await tx.$executeRawUnsafe('CREATE TRIGGER direct_stage_guard_fixture BEFORE INSERT ON direct_stage_guard_fixture FOR EACH ROW EXECUTE FUNCTION public.guard_direct_contract_stage_allocation()');
            const fixture = { ...allocation, id: randomUUID(), ratioBps: null, fixedAmountCents: 100000n, sourcePayableAmountCents: 100000n };
            const fields = Object.keys(fixture);
            const sql = `INSERT INTO direct_stage_guard_fixture (${fields.map(key => `"${key}"`).join(",")}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")})`;
            expect(await tx.$executeRawUnsafe(sql, ...Object.values(fixture))).toBe(1);
            await expect(tx.$executeRawUnsafe(sql, ...Object.values({ ...fixture, id: randomUUID(), fixedAmountCents: 1n })))
              .rejects.toThrow("Direct contract allocation does not match its frozen payment stage");
            throw fixtureRollback;
          });
          throw new Error("fixed-stage fixture must roll back");
        } catch (error) { if (error !== fixtureRollback) throw error; }
        expect(await prisma.paymentTermsStage.findUniqueOrThrow({ where: { id: stageBefore.id } })).toEqual(stageBefore);
        expect(await prisma.paymentExecutionAllocation.count({ where: { paymentRequestId: payment.id } })).toBe(2);
        expect(await prisma.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(2);
        expect(await prisma.auditLog.count({ where: { action: "payment.execution.record", businessId: payment.id } })).toBe(2);
        const funding = await prisma.projectFundingAllocation.findMany({ where: { executionId: { in: executionIds } } });
        expect(funding.reduce((sum, row) => sum + row.amountCents, 0n)).toBe(BigInt(expectedApprovedAmountCents));
      }
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
      if (settlementFinance) {
        const reviewer = roleUsers.get("contract_director")!;
        await loginAs(reviewer);
        const applicant = roleUsers.get("contract_staff")!;
        const terms = await prisma.paymentTermsVersion.findFirstOrThrow({
          where: { contractVersionId: draft.version.id }, select: { id: true }
        });
        const historical = await prisma.settlement.create({ data: {
          projectId: project.id, contractId: draft.contract.id, contractVersionId: draft.version.id, paymentTermsVersionId: terms.id,
          code: `POL114-HISTORICAL-ST-${randomUUID()}`, periodLabel: "2026-09", status: "approval_pending",
          amountCents: 2500n, payableAmountCents: 2500n, preparedByUserId: applicant
        } });
        const round = await prisma.approvalInstance.create({ data: {
          businessType: "settlement", businessId: historical.id, flowType: "settlement.approve",
          status: "in_progress", applicantUserId: applicant, currentNodeIndex: 0,
          frozenNodes: [{ name: "合同部主管", mode: "any", roleKeys: ["contract_director"],
            candidateUserIds: [reviewer], candidateUserIdsByRole: { contract_director: [reviewer] } }]
        } });
        const path = `/settlements/${historical.id}`;
        expect(await request("GET", path)).toMatchObject({
          id: historical.code, settlementId: historical.id, withdrawApprovalContext: null, availableActionKeys: []
        });
        for (const [action, body] of [
          ["approval", { decision: "approve" }],
          ["approval-transfer", { toUserId: applicant }],
          ["approval-delegation", { toUserId: applicant }]
        ] as const) {
          await expect(request("POST", `${path}/${action}`, body)).rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
        }
        const approvalProgressPath = `/approval-progress/${round.id}`;
        expect(await request("GET", approvalProgressPath)).toMatchObject({
          businessCode: historical.code, canHandle: false, canRemind: false
        });
        await loginAs(applicant);
        await expect(request("POST", path + "/approval-withdrawal", {
          expectedSettlementUpdatedAt: historical.updatedAt.toISOString(), expectedApprovalInstanceId: round.id,
          expectedNodeIndex: 0, expectedApprovalUpdatedAt: round.updatedAt.toISOString()
        })).rejects.toThrow(/410.*OLD_WRITE_ENTRY_RETIRED/u);
        const progress = await request<{ reminderToken: string }>("GET", approvalProgressPath);
        await expect(request("POST", approvalProgressPath + "/remind", {
          requestId: randomUUID(), reminderToken: progress.reminderToken
        })).rejects.toThrow(/410/u);
        expect(await prisma.settlement.findUnique({ where: { id: historical.id } })).toEqual(historical);
        expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(round);
        expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: round.id } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { businessType: "settlement", businessId: historical.id } })).toBe(0);
      }
      if (paymentMode === "direct") {
        const signedChange = createSignedChangeQualification(process.env.DATABASE_URL!);
        const previousWitnessKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
        await prisma.$transaction(signedChange.install.map(sql => prisma.$executeRawUnsafe(sql)));
        process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = signedChange.witnessKey;
        const signedPrisma = new PrismaService({ datasourceUrl: signedChange.databaseUrl });
        let signedApp: INestApplication | undefined;
        try {
          const signedModule = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(PrismaService).useValue(signedPrisma).compile();
          signedApp = signedModule.createNestApplication();
          signedApp.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
          signedApp.useGlobalPipes(createApiValidationPipe());
          try {
            await signedApp.listen(0, "127.0.0.1");
          } catch (error) {
            const failure = error as { errorCode?: string; code?: string };
            const code = failure.errorCode ?? failure.code ?? "";
            const safeCode = /^(?:P[0-9]{4}|EADDRINUSE|EACCES|ECONNREFUSED)$/u.test(code) ? code : "UNCLASSIFIED";
            throw new Error(`POL114_SIGNED_CHANGE_BOOT_${safeCode}`);
          }
          const signedApiUrl = await signedApp.getUrl();
          const submitSignedRequest = async (path: string, body: Record<string, string>) => {
            const response = await fetch(`${signedApiUrl}${path}`, {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify(body)
            });
            const result = await response.json().catch(() => null) as (Identified & { status: string; code?: string }) | null;
            if (response.status !== 201 || !result) {
              const code = result?.code;
              const safeCode = code && [
                "OLD_WRITE_ENTRY_RETIRED", "OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED", "OPERATIONAL_WRITE_FREEZE_ACTIVE"
              ].includes(code) ? code : "UNCLASSIFIED";
              throw new Error(`POL114_SIGNED_CHANGE_HTTP_${response.status}_${safeCode}`);
            }
            return result;
          };

          await loginAs(actorUserId);
          const changeFile = await upload("合成双方签章补充协议.pdf", "application/pdf", await pdf.save());
          const paymentAgreementText = "补充协议约定验收后三十日付款";
          const change = await submitSignedRequest(`/contracts/${draft.version.id}/signed-changes`, {
            fileId: changeFile.id, summary: "合成合同付款约定调整，金额不变", amountDeltaYuan: "0", paymentAgreementText
          });
          expect(change.status).toBe("pending_review");
          await loginAs(roleUsers.get("finance_staff")!);
          const originalPayment = await request<PaymentDetailReadModel>("GET", `/payments/${payment.id}`);
          expect(originalPayment.baseInfo).toContainEqual({ label: "付款约定原文", value: "验收后付款" });
          expect(originalPayment.financeEntry?.history).toEqual(recorded.financeEntry.history);

          await loginAs(roleUsers.get("contract_director")!);
          const reviewed = await submitSignedRequest(`/contracts/${draft.version.id}/signed-changes/${change.id}/review`, {
            decision: "approve"
          });
          expect(reviewed.status).toBe("approved");

          await loginAs(roleUsers.get("finance_staff")!);
          const updatedPayment = await request<PaymentDetailReadModel>("GET", `/payments/${payment.id}`);
          expect(updatedPayment.meta).toContainEqual({ label: "付款约定", value: "约定已更新，请核对提交时和最新约定" });
          expect(updatedPayment.baseInfo).toEqual(expect.arrayContaining([
            { label: "提交时付款约定", value: "验收后付款" },
            { label: "最新付款约定", value: paymentAgreementText }
          ]));
          expect(updatedPayment.baseInfo.find(item => item.label === "付款阶段"))
            .toEqual(originalPayment.baseInfo.find(item => item.label === "付款阶段"));
          expect(updatedPayment.financeEntry?.history).toEqual(recorded.financeEntry.history);
          expect(await prisma.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(2);
        } finally {
          if (previousWitnessKey === undefined) delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
          else process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = previousWitnessKey;
          if (signedApp) await signedApp.close();
          else await signedPrisma.$disconnect();
          await prisma.$transaction(signedChange.uninstall.map(sql => prisma.$executeRawUnsafe(sql)));
        }
      }
      if(process.env.COMPANY_TRANSFER_CORE_RECEIPT)await writeFile(process.env.COMPANY_TRANSFER_CORE_RECEIPT,JSON.stringify({projectId:project.id,companyId:company.id,contractId:draft.contract.id,contractVersionId:draft.version.id,paymentId:payment.id}),{mode:0o600});
    }
  }

  it("按冻结合同阶段直接付款：分次实付、幂等、真实分摊约束与财务回读", async () => {
    await runContractCase("aggregate", "generic_contract", "direct");
  }, 60_000);

  const signedBrowserTimeout = process.env.RUN_POL114_BROWSER === "1"
    ? 60_000 + 2 * (85_000 + 30_000) + 10_000 : 60_000;
  for (const entryMode of ["aggregate", "legacy", "legacy-ownerless"] as const) {
    it.each([entryMode])("合同现役提交与旧入口退出：%s", mode => runContractCase(mode),
      entryMode === "aggregate" ? signedBrowserTimeout : 60_000);
  }
  (process.env.RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16 === "1" ? it.each(["equipment_rental", "labor_subcontract", "professional_subcontract"]) : it.skip.each(["equipment_rental", "labor_subcontract", "professional_subcontract"]))("历史已生效合同进入现役结算付款完整链：%s", async kind => {
    await runContractCase("aggregate", kind);
  }, signedBrowserTimeout);

});
