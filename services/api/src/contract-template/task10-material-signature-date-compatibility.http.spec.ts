import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const dateVersion = "reviewed-material-signature-date-v1";
const dateText = "签署日期：　年　月　日";
const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const slotIds = ["be6d8bf0f1e5172844c287c65d2f53f404b033dd67611442873a02d5a37a312e", "f20c09d2043ff82ab2e75bd5cce357c5c2a7dc7885246d96872c54245e699d2f"];
const rows = [{ clientRowKey: "date-compatibility-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
async function fixture() {
  const server = await createTemplateTestServer({ draftWorkbench: true });
  try {
    const layout = await confirmedBodyLayout(server, await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx")), "materials");
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const saved = await saveBody(draft, undefined, "当前单甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const wb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
    expect(wb.draft.documentRenderProfile).toEqual({ typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: dateVersion });
    expect(wb.version.amountYuan).toBe("6.5000");
    return { server, layout, draft, wb };
  } catch (cause) { await server.processor.onApplicationShutdown(); await server.app.close(); throw cause; }
}
async function bodyOf(draft: Awaited<ReturnType<typeof createTask09Draft>>) {
  const response = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(response.status).toBe(200); return response.json() as Promise<Body>;
}

describe("task10 signature-date capability public compatibility", () => {
  it("preserves explicit handwriting, an explicit empty edit and a later deletion through save and repeated reads", async () => {
    const { server, layout, draft } = await fixture();
    try {
      const initial = await bodyOf(draft); for (const id of slotIds) expect(initial.blocks.find(block => block.id === id)).toMatchObject({ text: dateText, editable: true });
      const manual = "甲方人工签署说明保留。";
      const plan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [{ positionId: slotIds[0], text: manual }, { positionId: slotIds[1], text: "" }] };
      const saved = await saveBody(draft, plan, "当前单甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const edited = await bodyOf(draft);
      expect(edited.blocks.find(block => block.id === slotIds[0])).toMatchObject({ text: manual, editable: true });
      expect(edited.blocks.find(block => block.id === slotIds[1])).toMatchObject({ text: "", editable: true });
      expect(edited.blocks.filter(block => block.text === dateText)).toEqual([]); expect(await bodyOf(draft)).toEqual(edited);
      const deletedPlan = { ...plan, edits: [{ positionId: slotIds[1], text: "" }], deletedPositionIds: [slotIds[0]] };
      const deleted = await saveBody(draft, deletedPlan, "当前单甲方", rows); expect(deleted.status === 200 ? "OK" : await deleted.text()).toBe("OK");
      const after = await bodyOf(draft); expect(after.blocks.some(block => block.id === slotIds[0])).toBe(false);
      expect(after.blocks.find(block => block.id === slotIds[1])).toMatchObject({ text: "", editable: true });
      expect(after.blocks.filter(block => block.text === dateText)).toEqual([]); expect(await bodyOf(draft)).toEqual(after);
      const wb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(wb.version.amountYuan).toBe("6.5000"); expect(wb.draft.documentBody).toMatchObject(deletedPlan);
      expect(wb.draft.documentRenderProfile).toEqual({ typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: dateVersion });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 30_000);

  it.each(["omit", "unknown", "wrongSourceVersion"] as const)("refuses a client %s date profile with all public business facts unchanged", async vector => {
    const { server, draft, wb } = await fixture();
    try {
      const profile = vector === "omit" ? { typographyVersion: "reviewed-material-primary-secondary-body25-v4" }
        : { typographyVersion: vector === "wrongSourceVersion" ? "reviewed-mechanical-primary-secondary-roles-v1" : "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: vector === "unknown" ? "unsupported-date-version" : dateVersion };
      const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: wb.version.draftRevision, changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, draftData: { ...wb.draft, documentRenderProfile: profile }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: wb.version.layoutTemplateVersionId,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: wb.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(response.status).toBe(400); expect(await response.text()).toContain("合同文书呈现资料由系统维护");
      const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      for (const field of ["version", "draft", "parties", "bills", "paymentTerms", "attachments"]) expect(after[field]).toEqual(wb[field]);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });

  it.each(["missingValue", "missingBody", "wrongValue", "wrongBody", "wrongSource", "wrongTypography", "wrongEngine"] as const)("refuses a frozen %s date partner before template reads or private uploads", async vector => {
    const { server, draft, wb } = await fixture();
    try {
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: wb.version.draftRevision }) }); expect(queued.status).toBe(201); const generation = await queued.json();
      const list = async () => {
        const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return response.json();
      };
      const fresh = (await list()).find((entry: { id: string }) => entry.id === generation.generationId);
      expect(fresh.inputSnapshot).toMatchObject({ bodyDocument: { sourceSha256: sourceSha, signatureDateVersion: dateVersion }, renderInput: { values: { "contract.signatureDateVersion": dateVersion } } });
      const corrupted = JSON.parse(JSON.stringify(fresh.inputSnapshot));
      if (vector === "missingValue") delete corrupted.renderInput.values["contract.signatureDateVersion"];
      else if (vector === "missingBody") delete corrupted.bodyDocument.signatureDateVersion;
      else if (vector === "wrongValue") corrupted.renderInput.values["contract.signatureDateVersion"] = "unsupported-date-version";
      else if (vector === "wrongBody") corrupted.bodyDocument.signatureDateVersion = "unsupported-date-version";
      else if (vector === "wrongSource") corrupted.bodyDocument.sourceSha256 = "0".repeat(64);
      else if (vector === "wrongEngine") delete corrupted.bodyDocument.pdfEngine;
      else { corrupted.bodyDocument.typographyVersion = "reviewed-material-primary-secondary-roles-v2"; corrupted.renderInput.values["contract.typographyVersion"] = "reviewed-material-primary-secondary-roles-v2"; }
      // Synthetic corrupt persistence fixture only. Observe the actual public
      // worker/result boundary, never a private snapshot validator.
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: generation.generationId }, data: { inputSnapshot: corrupted } });
      const reads = jest.spyOn(server.files, "getFileBuffer"), uploads = jest.spyOn(server.files, "uploadPrivateFile");
      try {
        expect(await server.processor.processNext()).toBe(true);
        const failed = (await list()).find((entry: { id: string }) => entry.id === generation.generationId);
        expect(failed).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null, errorMessage: vector === "wrongEngine" ? "合同文档输入快照格式不正确" : "合同签署日期呈现版本无法核对，请联系管理员处理" });
        expect(reads).toHaveBeenCalledTimes(0); expect(uploads).toHaveBeenCalledTimes(0);
        const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
        expect(after.version).toEqual(wb.version); expect(after.draft).toEqual(wb.draft); expect(after.bills).toEqual(wb.bills);
      } finally { reads.mockRestore(); uploads.mockRestore(); }
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
});
