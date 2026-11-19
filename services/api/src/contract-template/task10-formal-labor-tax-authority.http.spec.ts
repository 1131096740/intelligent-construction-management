import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";

describe("task10 formal labor public body tax authority", () => {
  it("uses the saved zero-percent tax in the formal labor body as protected contract data", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-labor-tax-authority-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "formal-labor-00" + i, sortOrder: i - 1,
        itemName: "正式劳务行00" + i, unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const saved = await saveBody(draft, undefined, "合成劳务甲方", rows);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const workbenchResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(workbenchResponse.status).toBe(200);
      const wb = await workbenchResponse.json();
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "600.0000", layoutTemplateVersionId: layout.id,
        draftData: { contractBasics: { businessType: "labor_subcontract", amountBasis: "tax_inclusive" } },
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" } });
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(3);
      // Independent worked literals, not derived from a product money helper.
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(wb.bills[0].rows[i]).toMatchObject({
        itemName: "正式劳务行00" + (i + 1), quantity: String(i + 1), taxRatePercent: "0", taxInclusiveAmountYuan: amount, taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000"
      });
      const response = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(response.status).toBe(200);
      const body = await response.json() as Body & { draftRevision: number; layoutTemplateVersionId: string };
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
        draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      const taxPositions = body.blocks.filter(block => block.text.startsWith("本合同采用以下第"));
      await writeFile(join(directory, "public-tax-authority-observation.json"), JSON.stringify({ sourceSha256: sourceSha,
        wb: { version: wb.version, bills: wb.bills }, bodyRevision: body.draftRevision, sourceTaxParagraphs: taxPositions,
        expected: { taxRatePercent: "0", editable: false }, nativeOrGenerationRequested: false }, null, 2));
      expect(taxPositions).toHaveLength(1);
      const position = taxPositions[0]; expect(position.id).toEqual(expect.any(String)); expect(position.id.length).toBeGreaterThan(0);
      // Keep all actual text/opaque identity/editability as the falsifiable public
      // observation. A hard-coded3-percent ordinary paragraph must not count GREEN.
      const match = /税率\s*(\d+(?:\.\d+)?)\s*%/u.exec(position.text);
      expect({ taxRatePercent: match?.[1] ?? null, editable: position.editable }).toEqual({ taxRatePercent: "0", editable: false });
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_BODY_TAX_AUTHORITY_GREEN", sourceSha256: sourceSha,
        bodyRevision: body.draftRevision, positionId: position.id, taxRatePercent: match![1], editable: position.editable, nativeOrGenerationRequested: false }, null, 2));
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("正式劳务正文税率核对失败，证据 " + directory, { cause }); }
    finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
