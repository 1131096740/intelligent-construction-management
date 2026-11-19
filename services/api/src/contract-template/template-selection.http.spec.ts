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
});
