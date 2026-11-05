import { execFileSync } from "node:child_process";
import PizZip from "pizzip";
import { loginTemplateActor, seedSelectionDraft, publishMappedSelectionLayout, saveSelectionThroughHttp } from "./template-selection.test-support";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";

describe("manual template selection through existing real aggregate HTTP authority", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  beforeAll(async () => { server = await createTemplateTestServer({ draftWorkbench: true }); });
  afterAll(async () => { await server.app.close(); });
  it("reads a fresh synthetic draft through the real workbench service", async () => {
    const projectId = randomUUID(), contractId = randomUUID(), versionId = randomUUID();
    await server.store.prisma.project.create({ data: { id: projectId, name: "模板选版合成项目", isActive: true } });
    await server.store.prisma.contract.create({ data: { id: contractId, projectId, ownerUserId: "staff", name: "手动选版草稿", temporaryCode: "T11-NEW", code: null, contractTypeKey: "material_purchase", voidedAt: null } });
    await server.store.prisma.contractVersion.create({ data: { id: versionId, contractId, versionNo: 1, status: "draft", changeType: "original", baseVersionId: null, firstSubmittedAt: null, layoutTemplateVersionId: null, numericProtocolVersion: 2, draftRevision: 1, documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), draftData: {}, clauseSnapshot: [], templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] }, pricingNature: "unit_price", amountSource: "bill_sum", amountLimitType: "capped", amountCents: 0n, amountYuan: new Prisma.Decimal(0), estimatedAmountCents: null, estimatedAmountYuan: null, invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, taxFactStatus: "pending", companyEntityId: null, companyEntityNameSnapshot: null, settlementMode: "none", settlementModeConfirmedAt: null, readinessSnapshot: null, latestDraftPreviewDocumentId: null } });
    const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[1].phone, password: server.password }) });
    const token = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const response = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/workbench`, { headers: { authorization: `Bearer ${token}`, "x-contract-numeric-protocol": "2" } });
    const body = await response.json();
    expect({ status: response.status, body }).toMatchObject({ status: 200, body: { version: { id: versionId, layoutTemplateVersionId: null }, contract: { id: contractId } } });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" };
    const leaseResponse = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/edit-lease`, { method: "POST", headers });
    const lease = await leaseResponse.json() as { token: string };
    expect({ status: leaseResponse.status, body: lease }).toMatchObject({ status: 201, body: { token: expect.any(String) } });
    const input = { idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: 1, changedSections: ["draft"], draft: { draftData: {}, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } }, parties: [], bills: [], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
    const save = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(input) });
    expect({ status: save.status, body: await save.json() }).toMatchObject({ status: 200 });
    const directorLogin = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[0].phone, password: server.password }) });
    const director = (await directorLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const uploadBody = new FormData(); uploadBody.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "未发布选用负控.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${director}` }, body: uploadBody }).then(response => response.json()) as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${director}`, "content-type": "application/json" }, body: JSON.stringify({ name: "未发布选用负控", contractTypeKey: "material_purchase", docxFileId: uploaded.id, placeholderSchema: { bills: [] } }) });
    expect(created.status).toBe(201);
    const unpublished = await created.json() as { version: { id: string } };
    const latest = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/workbench`, { headers }).then(response => response.json()) as { version: { draftRevision: number } };
    const invalidSelection = { ...input, idempotencyKey: randomUUID(), expectedRevision: latest.version.draftRevision, draft: { ...input.draft, layoutTemplateVersionId: unpublished.version.id } };
    const rejected = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(invalidSelection) });
    expect({ status: rejected.status, body: await rejected.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("已发布") } });
    // Existing stopped-version reference is a synthetic historical precondition,
    // not an assertion that a new unpublished template was legally published.
    await server.store.prisma.contractLayoutTemplateVersion.update({ where: { id: unpublished.version.id }, data: { status: "stopped" } });
    await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { layoutTemplateVersionId: unpublished.version.id } });
    const ordinaryEdit = { ...input, idempotencyKey: randomUUID(), expectedRevision: latest.version.draftRevision, draft: { ...input.draft, draftData: {} } };
    const kept = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(ordinaryEdit) });
    expect(kept.status === 200 ? "OK" : await kept.text()).toBe("OK");
    const preserved = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/workbench`, { headers }).then(response => response.json()) as { version: { layoutTemplateVersionId: string | null; draftRevision: number } };
    expect(preserved.version.layoutTemplateVersionId).toBe(unpublished.version.id);
    const clearInput = { ...input, idempotencyKey: randomUUID(), expectedRevision: preserved.version.draftRevision, draft: { ...input.draft, layoutTemplateVersionId: null } };
    const clear = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(clearInput) });
    expect(clear.status === 200 ? "OK" : await clear.text()).toBe("OK");
    const cleared = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/workbench`, { headers }).then(response => response.json()) as { version: { layoutTemplateVersionId: string | null; draftRevision: number } };
    expect(cleared.version.layoutTemplateVersionId).toBeNull();
    const noOldLayout = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}/preview-generation`, { method: "POST", headers, body: JSON.stringify({ sourceRevision: cleared.version.draftRevision }) });
    expect({ status: noOldLayout.status, body: await noOldLayout.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("尚未选择") } });
    // A newly uploaded unconfirmed source cannot become a legacy template merely
    // because a synthetic persisted row says published and omits sourceMapping.
    await server.store.prisma.contractLayoutTemplateVersion.update({ where: { id: unpublished.version.id }, data: { status: "published", publishedAt: new Date(), publishedByUserId: "director", previewPdfFileId: randomUUID() } });
    const fakeLegacy = { ...input, idempotencyKey: randomUUID(), expectedRevision: cleared.version.draftRevision, draft: { ...input.draft, layoutTemplateVersionId: unpublished.version.id } };
    const noEvidence = await fetch(`${await server.app.getUrl()}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(fakeLegacy) });
    expect({ status: noEvidence.status, body: await noEvidence.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("主管") } });
    await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { layoutTemplateVersionId: unpublished.version.id } });
    const untrustedQueue = await fetch(`${await server.app.getUrl()}/contract-workbench/${versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: unpublished.version.id }) });
    expect({ status: untrustedQueue.status, body: await untrustedQueue.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("主管") } });
  });
  it("rejects a new queue whose explicit template differs from the saved draft selection", async () => {
    const layout = await publishMappedSelectionLayout(server);
    const draft = await seedSelectionDraft(server);
    const token = await loginTemplateActor(server, "staff");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 409, body: { message: expect.stringContaining("保存") } });
    const documents = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json());
    expect(documents).toEqual([]);
    const saved = await saveSelectionThroughHttp(server, draft.versionId, layout.id);
    const read = await fetch(`${await server.app.getUrl()}/contract-drafts/${draft.versionId}/workbench`, { headers: saved.headers }).then(response => response.json());
    expect(read).toMatchObject({ version: { layoutTemplateVersionId: layout.id, layoutTemplateSelection: { id: layout.id, name: "真实手动选版样张", versionNo: 1, status: "published" } } });
    const queued = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
    expect(queued.status).toBe(201);
    const job = await queued.json() as { id: string };
    await server.processor.processNext();
    const finished = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; errorMessage: string | null; docxFileId: string; pdfFileId: string }>;
    const output = finished.find(value => value.id === job.id)!;
    expect(output).toMatchObject({ status: "success", errorMessage: null });
    const docx = await server.files.getFileBuffer(output.docxFileId);
    const xml = new PizZip(docx.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("手动选版草稿");
    expect(xml.match(/实际甲方/gu)).toHaveLength(2);
    expect(xml.match(/实际乙方/gu)).toHaveLength(2);
    expect(xml).toContain("本项普通约定按原文保留");
    expect(xml).not.toContain("合成甲方公司");
    const pdf = await server.files.getFileBuffer(output.pdfFileId);
    const text = execFileSync(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON ?? "python3", ["-c", "import sys,pymupdf; d=pymupdf.open(stream=sys.stdin.buffer.read(),filetype='pdf'); print(''.join(p.get_text() for p in d))"], { input: pdf.buffer, encoding: "utf8" });
    expect(text).toContain("手动选版草稿");
    expect(text.match(/实际甲方/gu)).toHaveLength(2);
    expect(text.match(/实际乙方/gu)).toHaveLength(2);
    expect(text).toContain("本项普通约定按原文保留");
  });

  it("classifies a real worker failure retry before and after catalog stop without rewriting successful history", async () => {
    const layout = await publishMappedSelectionLayout(server, "真实失败重试样张");
    const token = await loginTemplateActor(server, "staff");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = await server.app.getUrl();
    async function failedJob() {
      const draft = await seedSelectionDraft(server);
      await saveSelectionThroughHttp(server, draft.versionId, layout.id);
      const queue = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
      expect(queue.status).toBe(201);
      const job = await queue.json() as { id: string };
      server.failNextPrivateRead();
      await server.processor.processNext();
      const list = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; docxFileId: string | null; pdfFileId: string | null }>;
      expect(list.find(value => value.id === job.id)).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null });
      return { draft, job };
    }
    const first = await failedJob();
    expect((await fetch(`${base}/contract-documents/${first.job.id}/retry`, { method: "POST", headers })).status).toBe(201);
    await server.processor.processNext();
    const success = (await fetch(`${base}/contract-workbench/${first.draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; pdfFileId: string }>).find(value => value.id === first.job.id)!;
    expect(success.status).toBe("success");
    const original = await server.files.getFileBuffer(success.pdfFileId);
    const stopped = await failedJob();
    const director = await loginTemplateActor(server, "director");
    expect((await fetch(`${base}/contract-layout-template-versions/${layout.id}/stop`, { method: "POST", headers: { authorization: `Bearer ${director}` } })).status).toBe(201);
    const blocked = await fetch(`${base}/contract-documents/${stopped.job.id}/retry`, { method: "POST", headers });
    expect({ status: blocked.status, body: await blocked.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("尚未发布") } });
    expect((await server.files.getFileBuffer(success.pdfFileId)).buffer.equals(original.buffer)).toBe(true);
    const list = await fetch(`${base}/contract-workbench/${stopped.draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string }>;
    expect(list.find(value => value.id === stopped.job.id)).toMatchObject({ status: "failed" });
  });

});
