import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;

export async function loginTemplateActor(server: Server, actorId: string) {
  const actor = server.actors.find(actor => actor.id === actorId)!;
  const response = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password: server.password }) });
  if (response.status !== 201) throw new Error(`合成账号真实登录前置失败：${response.status}`);
  return (await response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

export async function seedSelectionDraft(server: Server, includeBill = false, name = "手动选版草稿") {
  const projectId = randomUUID(), contractId = randomUUID(), versionId = randomUUID();
  await server.store.prisma.project.create({ data: { id: projectId, name: "模板选版合成项目", isActive: true } });
  await server.store.prisma.contract.create({ data: { id: contractId, projectId, ownerUserId: "staff", name, temporaryCode: "T11-NEW", code: null, contractTypeKey: "material_purchase", voidedAt: null } });
  await server.store.prisma.contractVersion.create({ data: { id: versionId, contractId, versionNo: 1, status: "draft", changeType: "original", baseVersionId: null, firstSubmittedAt: null, layoutTemplateVersionId: null, numericProtocolVersion: 2, draftRevision: 1, documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), draftData: {}, clauseSnapshot: [], templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] }, pricingNature: "unit_price", amountSource: "bill_sum", amountLimitType: "capped", amountCents: 0n, amountYuan: new Prisma.Decimal(0), estimatedAmountCents: null, estimatedAmountYuan: null, invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, taxFactStatus: "pending", companyEntityId: null, companyEntityNameSnapshot: null, settlementMode: "none", settlementModeConfirmedAt: null, readinessSnapshot: null, latestDraftPreviewDocumentId: null } });
  for (const [roleKey, name] of [["party_a", "实际甲方"], ["party_b", "实际乙方"]]) await server.store.prisma.contractPartySnapshot.create({ data: { contractVersionId: versionId, roleKey, displayOrder: 0, businessPartyVersionId: null, snapshot: { name } } });
  if (includeBill) await server.store.prisma.contractBill.create({ data: { contractVersionId: versionId, billKey: "main", name: "合成含税清单", revision: 1, numericProtocolVersion: 2, pricingMode: "tax_inclusive", amountRole: "included", quantityScale: 4, unitPriceScale: 4, schemaSnapshot: { key: "main", name: "合成含税清单", columns: [] }, sourceExcelFileId: null, taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n, taxInclusiveAmountYuan: new Prisma.Decimal(0), taxExclusiveAmountYuan: new Prisma.Decimal(0), taxAmountYuan: new Prisma.Decimal(0) } });
  return { projectId, contractId, versionId };
}

/** Preparation uses the actual public maintenance routes and local converter. */
export async function publishMappedSelectionLayout(server: Server, name = "真实手动选版样张") {
  const token = await loginTemplateActor(server, "director");
  const base = await server.app.getUrl();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  async function request(path: string, method = "GET", body?: unknown, expected = method === "GET" ? 200 : 201) {
    const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status !== expected) throw new Error(`真实模板前置 ${method} ${path}：${response.status} ${await response.text()}`);
    return response.json();
  }
  const upload = new FormData(); upload.append("file", new Blob([new Uint8Array(syntheticWordSource(true))]), name + ".docx");
  const response = await fetch(base + "/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: upload });
  if (response.status !== 201) throw new Error("真实模板源上传前置失败");
  const file = await response.json() as { id: string };
  const layout = await request("/contract-layout-templates", "POST", { name, contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) as { template: { id: string }; version: { id: string } };
  const path = `/contract-layout-template-versions/${layout.version.id}`;
  const source = await request(path + "/source-positions") as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
  const keys = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
  const bindings = source.positions.slice(0, 5).map((position, index) => ({ positionId: position.positionId, start: index === 0 ? 5 : index === 4 ? 0 : 3, end: position.text.length, fieldKey: keys[index] }));
  bindings.push(...source.positions.slice(7, 9).map((position, index) => ({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey: index === 0 ? "party.owner.name" : "party.counterparty.name" })));
  const mapping = await request(path + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }, 200) as { mappingFingerprint: string };
  await request(path + "/inspection", "POST");
  await request(path + "/preview-generation", "POST", { contract: { name: "样张核对" }, party: { owner: { name: "核对甲方" }, counterparty: { name: "核对乙方" } } });
  await server.processor.processNext();
  await request(path + "/source-mapping-confirmation", "POST", { expectedRevision: 2, sourceFileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint });
  await request(path + "/submission", "POST");
  await request(path + "/publication", "POST", { changeSummary: "真实字段、正文、签章与样张确认" });
  return { id: layout.version.id, templateId: layout.template.id, fileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint };
}

export async function saveSelectionThroughHttp(server: Server, versionId: string, layoutId: string | null, oldLeaseToken?: string) {
  const token = await loginTemplateActor(server, "staff");
  const base = await server.app.getUrl();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" };
  const read = await fetch(`${base}/contract-drafts/${versionId}/workbench`, { headers });
  if (read.status !== 200) throw new Error("保存选版前无法读取实际草稿");
  const workbench = await read.json() as { version: { draftRevision: number } };
  const leaseToken = oldLeaseToken ?? await fetch(`${base}/contract-drafts/${versionId}/edit-lease`, { method: "POST", headers }).then(async response => {
    if (response.status !== 201) throw new Error(`实际编辑权前置失败：${response.status}`);
    return (await response.json() as { token: string }).token;
  });
  if (!leaseToken) throw new Error("实际编辑权响应未包含可用令牌");
  const input = {
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: workbench.version.draftRevision, changedSections: ["draft"],
    draft: { draftData: {}, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layoutId, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
    parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "实际甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "实际乙方" } }],
    bills: [], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  };
  const response = await fetch(`${base}/contract-drafts/${versionId}`, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": leaseToken }, body: JSON.stringify(input) });
  if (response.status !== 200) throw new Error(`实际选版保存失败：${response.status} ${await response.text()}`);
  return { token, headers, leaseToken, saved: await response.json() };
}
