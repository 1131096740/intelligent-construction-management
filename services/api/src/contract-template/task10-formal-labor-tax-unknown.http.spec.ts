import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";

describe("task10 formal labor public unknown tax body", () => {
  it("keeps saved gross600 known and net/tax unknown while rendering a protected pending tax label", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-labor-tax-unknown-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath); expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json(); expect(current.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // Legal unknown contract: taxMode remains single_rate; header rate is null.
      // Omit row taxRatePercent (null is not a legal row request value).
      // Do not use saveBody: that helper supplies0 whenever priced rows exist.
      const taxFacts = { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" };
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "unknown-labor-00" + i, sortOrder: i - 1, itemName: "未知税率劳务行00" + i,
        unit: "项", quantity: String(i), unitPrice: "100.0000", customData: {} }));
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
          contractBasics: { businessType: "labor_subcontract", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id, taxFacts },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "合成劳务甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200); const wb = await wbResponse.json();
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "600.0000", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null },
        draftData: { contractBasics: { amountBasis: "tax_inclusive", invoiceStatus: "pending" }, documentRenderProfile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1" } } });
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: null, taxAmountYuan: null });
      expect(wb.bills[0].rows).toHaveLength(3);
      // Independent worked literals:1/2/3 times100 inclusive gives100/200/300.
      // No known tax rate exists, so net/tax cannot be inferred from gross600.
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(wb.bills[0].rows[i]).toMatchObject({
        itemName: "未知税率劳务行00" + (i + 1), quantity: String(i + 1), taxRatePercent: null,
        taxInclusiveAmountYuan: amount, taxExclusiveAmountYuan: null, taxAmountYuan: null
      });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as Body & { draftRevision: number; layoutTemplateVersionId: string };
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
        draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      const positions = body.blocks.filter(block => block.text.startsWith("本合同采用以下第"));
      const afterResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(afterResponse.status).toBe(200); const after = await afterResponse.json();
      await writeFile(join(directory, "public-unknown-tax-observation.json"), JSON.stringify({ submitted: { taxFacts, rows }, wb, bodyTaxPositions: positions,
        afterBodyRead: { version: after.version, bills: after.bills }, generationOrNativeRequested: false }, null, 2));
      expect(positions).toHaveLength(1); const tax = positions[0]; expect(tax.id).toEqual(expect.any(String)); expect(tax.id.length).toBeGreaterThan(0);
      expect(tax.editable).toBe(false); expect(tax.text).toMatch(/税率\s*待补充。$/u);
      expect(tax.text).not.toMatch(/税率\s*(?:0|3)\s*%/u); expect(tax.text).not.toMatch(/待补充\s*%/u);
      expect(after.version).toEqual(wb.version); expect(after.bills).toEqual(wb.bills);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_UNKNOWN_TAX_STAYS_UNKNOWN", sourceSha256: sourceSha,
        taxPositionId: tax.id, text: tax.text, editable: tax.editable, amountYuan: "600.0000", taxExclusiveAmountYuan: null, taxAmountYuan: null,
        draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        generationOrNativeRequested: false }, null, 2));
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("正式劳务未知税率核对失败，证据 " + directory, { cause }); }
    finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
