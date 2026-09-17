import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import * as ExcelJS from "exceljs";
import type { BusinessEntryFrozenSnapshot, BusinessEntrySceneDefinition, ContractDetailReadModel } from "@jiangkong/shared-domain";
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
  bills: Array<{ id: string; billKey: string; revision: number }>;
};
type Submission = { approvalInstanceId: string; draftRevision: number; businessEntrySnapshot: BusinessEntryFrozenSnapshot; templateEntrySnapshot: BusinessEntryFrozenSnapshot; billEntrySnapshots: BusinessEntryFrozenSnapshot[] };
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

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    const prisma = app.get(PrismaService);
    const phone = `114${Date.now()}`;
    const password = `Test-${randomUUID()}`;
    const user = await prisma.user.create({ data: {
      phone, name: "合同录入测试负责人", passwordHash: await hash(password, 4),
      mustChangePassword: false
    } });
    for (const key of ["chairman", "contract_director"] as const) {
      const position = await prisma.position.upsert({
        where: { key }, update: {}, create: { key, name: key }
      });
      await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    }
    token = (await request<{ tokens: { accessToken: string } }>("POST", "/auth/login", { phone, password })).tokens.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  it.each(["aggregate", "legacy", "legacy-ownerless"] as const)("合同真实提交与字段历史冻结：%s", async (entryMode) => {
    const project = await request<Identified>("POST", "/projects", {
      code: `POL114-${randomUUID()}`, name: "合同统一录入合成项目"
    });
    const prisma = app.get(PrismaService);
    for (const key of ["material_director", "project_manager", "finance_director", "budget_director", "contract_director", "chairman"]) {
      const reviewer = await prisma.user.create({ data: { name: `合成审批岗位 ${key}`, mustChangePassword: false } });
      const position = await prisma.position.upsert({ where: { key }, update: {}, create: { key, name: key } });
      await prisma.userPosition.create({ data: {
        userId: reviewer.id, positionId: position.id,
        projectId: key === "project_manager" ? project.id : null
      } });
      if (key === "project_manager") {
        await prisma.projectMember.create({ data: { projectId: project.id, userId: reviewer.id, positionKey: key } });
      }
    }
    const template = await request<{ version: Identified }>("POST", "/contract-templates", {
      code: `POL114-${randomUUID()}`, businessCode: `合同录入验证${Date.now()}`,
      name: "合同录入验证模板", contractTypeKey: "material_purchase",
      schema: {
        fields: [{ key: "deliveryLocation", label: "交货地点", type: "text", required: true }, { key: "adjustment", label: "调整系数", type: "number" }],
        bills: [{ key: "reference", name: "参考清单", amountRole: "reference", pricingMode: "tax_inclusive",
          quantityScale: 2, unitPriceScale: 2,
          columns: [{ key: "brand", label: "指定品牌", type: "text", required: true }] }],
        clauses: [], attachments: [], validations: []
      }
    });
    await request("POST", `/contract-template-versions/${template.version.id}/submission`);
    await request("POST", `/contract-template-versions/${template.version.id}/publication`, {
      changeSummary: "合成数据公开接口验证"
    });
    const draft = await request<CreatedDraft>("POST", "/contracts", {
      projectId: project.id, contractTypeKey: "material_purchase",
      businessTemplateVersionId: template.version.id, signingSubjectType: "our_company"
    });
    const workbench = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
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
    const companies = await request<Array<Identified & { unifiedSocialCreditCode: string }>>("GET", "/company-entities");
    const company = Object.values(companies).find((item) =>
      item.unifiedSocialCreditCode === "91350211M000100Y46"
    ) ?? (await request<{ entity: Identified }>("POST", "/company-entities", {
      name: "统一录入合成我方公司", unifiedSocialCreditCode: "91350211M000100Y46"
    })).entity;
    expect(company.id).toEqual(expect.any(String));
    const lease = await request<{ token: string }>("POST", `/contract-drafts/${draft.version.id}/edit-lease`);
    await request("PUT", `/contract-drafts/${draft.version.id}`, {
      idempotencyKey: randomUUID(), saveKind: "manual",
      expectedRevision: workbench.version.draftRevision, changedSections: ["draft"],
      draft: {
        companyEntityId: company.id, draftData: { contractName: "合成材料采购合同", fieldValues: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" } },
        clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountCents: "10000",
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" }
      },
      parties: [], bills: workbench.bills.map((bill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, rows: [] })), paymentTerms: null, attachments: [],
      negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }, lease.token);
    const saved = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    expect(saved.businessEntry?.values).toEqual({
      contractName: "合成材料采购合同", companyEntityId: company.id
    });

    const zip = new PizZip(await readFile(join(__dirname, "../../assets/templates/generic-contract-v1.docx")));
    zip.file("word/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{contract.name} {contract.temporaryCode} {document.watermark}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
    const docx = await upload("合成合同版式.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip.generate({ type: "nodebuffer" }));
    const layout = await request<{ version: Identified }>("POST", "/contract-layout-templates", {
      name: "合成合同版式", contractTypeKey: "material_purchase",
      docxFileId: docx.id, placeholderSchema: { bills: [] }
    });
    const inspection = await request<{ blockingErrors: string[] }>("POST", `/contract-layout-template-versions/${layout.version.id}/inspection`);
    if (inspection.blockingErrors.length) throw new Error(`版式检查：${JSON.stringify(inspection)}`);
    await request("POST", `/contract-layout-template-versions/${layout.version.id}/preview-generation`, {});
    let preview;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      preview = await request<{ status: string }>("GET", `/contract-layout-template-versions/${layout.version.id}/preview-generation`);
      if (preview.status === "succeeded" || preview.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (preview?.status !== "succeeded") throw new Error(`版式预览未成功：${JSON.stringify(preview)}`);
    await request("POST", `/contract-layout-template-versions/${layout.version.id}/submission`);
    await request("POST", `/contract-layout-template-versions/${layout.version.id}/publication`, { changeSummary: "合成版式" });
    await request("PUT", `/contract-drafts/${draft.version.id}`, {
      idempotencyKey: randomUUID(), saveKind: "manual",
      expectedRevision: saved.version.draftRevision, changedSections: ["draft", "parties", "payment_terms", "bills"],
      draft: {
        companyEntityId: company.id, draftData: { contractName: "合成材料采购合同", fieldValues: { deliveryLocation: "合成仓库", adjustment: "-1.234e-7" } },
        clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountCents: "10000",
        layoutTemplateVersionId: layout.version.id,
        taxFacts: { invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" }
      },
      parties: [{ roleKey: "party_b", displayOrder: 0, snapshot: { name: "合成材料供应商" } }],
      bills: saved.bills.map((bill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, rows: [{
        clientRowKey: "synthetic-row-1", sortOrder: 0, itemName: "合成材料", unit: "件", quantity: "2.00", unitPrice: "10.00",
        taxRateSource: "version_default", isProvisional: false, customData: { brand: "合成品牌" }
      }] })), paymentTerms: { originalText: "验收后付款", stages: [] }, attachments: [],
      negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }, lease.token);
    let current = await request<Workbench>("GET", `/contract-drafts/${draft.version.id}/workbench`);
    await request("POST", `/contract-workbench/${draft.version.id}/settlement-mode/confirm`, {
      expectedRevision: current.version.draftRevision, settlementMode: "direct_payment"
    });
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
      if (entryMode === "legacy-ownerless") {
        // Authorized isolated historical-draft fixture transform; not a claim of
        // all-HTTP legacy creation, and never a manufactured confirmed fact.
        await prisma.contract.update({ where: { id: draft.contract.id }, data: { ownerUserId: null } });
      }
      await request("POST", `/contracts/${draft.version.id}/approval-submission`, {});
      const before = await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`);
      expect(before.businessEntrySubmissions).toHaveLength(3);
      expect(before.businessEntrySubmissions?.map((entry) => entry.snapshot.sceneKey)).toEqual([
        "contract_basic", "contract_template_fields", "contract_bill_row"
      ]);
      expect(before.businessEntrySubmissions?.[1]?.snapshot.definition.source?.id).toBe(template.version.id);
      await expect(request("POST", `/contracts/${draft.version.id}/approval-submission`, {})).rejects.toThrow("不能重复提交审批");
      const after = await request<ContractDetailReadModel>("GET", `/contracts/${draft.contract.id}?versionId=${draft.version.id}`);
      expect(after.businessEntrySubmissions).toEqual(before.businessEntrySubmissions);
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
    const laterTemplate = await request<Identified>("POST", `/contract-template-versions/${template.version.id}/clone`);
    await request("PATCH", `/contract-template-versions/${laterTemplate.id}`, {
      schema: {
        fields: [{ key: "deliveryLocation", label: "新版本交货地址", type: "text", required: true }],
        bills: [], clauses: [], attachments: [], validations: []
      }
    });
    await request("POST", `/contract-template-versions/${laterTemplate.id}/submission`);
    await request("POST", `/contract-template-versions/${laterTemplate.id}/publication`, { changeSummary: "合成新版本，不改变旧合同" });
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
  });
});
