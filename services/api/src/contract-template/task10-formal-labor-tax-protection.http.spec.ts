import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";

describe("task10 formal labor public tax position protection", () => {
  it("rejects an ordinary edit of the actual protected tax position while preserving the saved draft and ordinary hand edit", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-labor-tax-protection-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath); expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "formal-labor-00" + i, sortOrder: i - 1,
        itemName: "正式劳务行00" + i, unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const saved = await saveBody(draft, undefined, "合成劳务甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const firstResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json() as Body;
      const ordinary = first.blocks.find(block => block.editable && block.text.startsWith("材料的使用必须按设计要求")); expect(ordinary).toBeDefined();
      const manualText = ordinary!.text + "双方已经保存的普通劳务补充约定应当保留。";
      const ordinaryPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
        edits: [{ positionId: ordinary!.id, text: manualText }] };
      // Positive public control also establishes the ordinary content whose
      // preservation is checked after the attempted protected-position write.
      const positive = await saveBody(draft, ordinaryPlan, "合成劳务甲方", rows);
      expect(positive.status === 200 ? "OK" : await positive.text()).toBe("OK");
      const readState = async () => {
        const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200);
        const wb = await wbResponse.json();
        const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200);
        const body = await bodyResponse.json() as Body & { draftRevision: number; layoutTemplateVersionId: string };
        const docsResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(docsResponse.status).toBe(200);
        const documents = await docsResponse.json();
        return { wb, body, documents };
      };
      const before = await readState();
      expect(before.wb.version).toMatchObject({ amountYuan: "600.0000", taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" },
        draftData: { documentRenderProfile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1" } } });
      expect(before.wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(before.wb.bills).toHaveLength(1);
      expect(before.wb.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(before.wb.bills[0].rows).toHaveLength(3);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(before.wb.bills[0].rows[i]).toMatchObject({
        itemName: "正式劳务行00" + (i + 1), quantity: String(i + 1), taxRatePercent: "0", taxInclusiveAmountYuan: amount, taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000"
      });
      expect(before.body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
        draftRevision: before.wb.version.draftRevision, documentContentRevision: before.wb.version.documentContentRevision });
      expect(before.body.blocks.find(block => block.id === ordinary!.id)?.text).toBe(manualText);
      const taxPositions = before.body.blocks.filter(block => block.text.startsWith("本合同采用以下第")); expect(taxPositions).toHaveLength(1);
      const tax = taxPositions[0]; expect(tax.editable).toBe(false); expect(tax.text).toMatch(/税率\s*0%/u);
      expect(before.documents).toEqual([]);
      const attemptedTaxText = tax.text + "正文另行约定税率9%。";
      const refused = await saveBody(draft, { ...ordinaryPlan, edits: [...ordinaryPlan.edits, { positionId: tax.id, text: attemptedTaxText }] }, "合成劳务甲方", rows);
      const refusedText = await refused.text();
      let safeMessage = "";
      try { const value = JSON.parse(refusedText) as { message?: unknown }; safeMessage = typeof value.message === "string" ? value.message : Array.isArray(value.message) ? value.message.join("；") : ""; } catch { safeMessage = "非结构化拒绝响应"; }
      const after = await readState();
      await writeFile(join(directory, "public-protection-observation.json"), JSON.stringify({ before, after, attemptedTaxPositionId: tax.id,
        attemptedTaxText, refusal: { status: refused.status, message: safeMessage }, generationOrNativeRequested: false }, null, 2));
      expect([400, 409]).toContain(refused.status);
      expect(safeMessage).toMatch(/填写资料自动同步|关键资料|填写页/u);
      // Public readback, not DB/audit/private counters. All stored version
      // fields include R/F, draftRev, amount, tax facts and ordinary edit plan.
      expect(after.wb.version).toEqual(before.wb.version);
      expect(after.wb.parties).toEqual(before.wb.parties);
      expect(after.wb.bills).toEqual(before.wb.bills);
      expect(after.body).toEqual(before.body);
      expect(after.documents).toEqual(before.documents);
      expect(after.body.blocks.find(block => block.id === ordinary!.id)?.text).toBe(manualText);
      expect(after.body.blocks.find(block => block.id === tax.id)).toMatchObject({ text: tax.text, editable: false });
      expect(after.body.blocks.some(block => block.text === attemptedTaxText)).toBe(false);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_TAX_EDIT_REFUSED_AND_READBACK_UNCHANGED", refusalStatus: refused.status,
        taxPositionId: tax.id, ordinaryPositionId: ordinary!.id, draftRevision: before.wb.version.draftRevision,
        documentContentRevision: before.wb.version.documentContentRevision, documentContentFingerprint: before.wb.version.documentContentFingerprint,
        amountYuan: "600.0000", sourceSha256: sourceSha, generationOrNativeRequested: false }, null, 2));
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("正式劳务税率保护核对失败，证据 " + directory, { cause }); }
    finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
