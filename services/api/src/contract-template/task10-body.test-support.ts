import { createHash, randomUUID } from "node:crypto";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "./layout-field-mapping";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

export type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;
export type Draft = Awaited<ReturnType<typeof createTask09Draft>>;
export type Body = { sourceSha256: string; documentContentRevision: number; blocks: Array<{ id: string; kind: string; text: string; editable: boolean }> };

export async function saveBody(draft: Draft, documentBody: unknown, partyA = "当前单甲方", billRows: Array<Record<string, unknown>> = [], bodyAction?: unknown, layoutId?: string, partyBVersionId?: string, defaultTaxRateOverride?: string | null) {
  const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number; draftData: Record<string, unknown>; layoutTemplateVersionId: string }; bills: Array<{ billKey: string; revision: number }> };
  return fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties"],
    draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData, documentBody, ...(bodyAction === undefined ? {} : { documentBodyAction: bodyAction }) }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layoutId ?? current.version.layoutTemplateVersionId, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: defaultTaxRateOverride === undefined ? (billRows.length ? "0" : null) : defaultTaxRateOverride, source: "contract_document" } },
    parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: partyA } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" }, ...(partyBVersionId ? { businessPartyVersionId: partyBVersionId } : {}) }],
    bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: index === 0 ? billRows : [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  }) });
}

/** Synthetic, immutable published-layout fixture; template publication is tested separately. */
export async function confirmedBodyLayout(server: Server, originalSource?: Buffer, billKey?: string, contractTypeKey = "material_purchase", displayName = "完整正文确认样张", additionalFields: readonly (readonly [string, readonly string[]])[] = []) {
  const source = originalSource ?? syntheticWordSource(true);
  const file = await server.files.uploadPrivateFile({ originalName: "完整正文确认样张.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: source.length, buffer: source, uploadedByUserId: "director" });
  const positions = readLayoutSourcePositions(source).positions;
  const keys = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
  const bindings = positions.slice(0, 5).map((position, index) => ({ positionId: position.positionId, start: index === 0 ? 5 : index === 4 ? 0 : 3, end: position.text.length, fieldKey: keys[index] }));
  const literalSyntheticSource = positions[0].text === "合同名称：合成工程合同";
  if (literalSyntheticSource) bindings.push(...positions.slice(7, 9).map((position, index) => ({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey: index === 0 ? "party.owner.name" : "party.counterparty.name" })));
  if (!literalSyntheticSource) {
    bindings.length = 0;
    const fields: readonly (readonly [string, readonly string[]])[] = [["contract.name", ["合同名称"]], ["party.owner.name", ["甲方名称"]], ["party.counterparty.name", ["乙方名称"]], ["contract.temporaryCode", ["草稿编号", "合同编号"]], ["document.watermark", ["文档水印"]], ...additionalFields];
    for (const position of positions) for (const [fieldKey, names] of fields) for (const name of names) {
      const token = `{${name}}`;
      let start = position.text.indexOf(token);
      while (start >= 0) { bindings.push({ positionId: position.positionId, start, end: start + token.length, fieldKey }); start = position.text.indexOf(token, start + token.length); }
    }
  }
  const { mapping } = prepareLayoutSourceMapping(source, file.id, 1, bindings);
  const templateId = randomUUID(), id = randomUUID();
  await server.store.prisma.contractLayoutTemplate.create({ data: { id: templateId, name: displayName, contractTypeKey } });
  await server.store.prisma.contractLayoutTemplateVersion.create({ data: { id, layoutTemplateId: templateId, versionNo: 1, status: "published", draftRevision: 1, docxFileId: file.id, publishedAt: new Date(), publishedByUserId: "director", previewPdfFileId: "synthetic-confirmed-preview", placeholderSchema: { bills: billKey ? [{ key: billKey }] : [], sourceMapping: { ...mapping, confirmation: { sourceFileId: file.id, sourceSha256: mapping.sourceSha256, draftRevision: 1, mappingFingerprint: mapping.fingerprint, previewJobId: "synthetic-confirmation-job", previewPdfFileId: "synthetic-confirmed-preview" } } }, inspectionReport: { status: "passed", requiredKeys: [] } } });
  return { id, sha256: createHash("sha256").update(source).digest("hex") };
}
