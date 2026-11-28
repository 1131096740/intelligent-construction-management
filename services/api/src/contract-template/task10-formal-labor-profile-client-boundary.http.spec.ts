import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";

describe("task10 formal labor server-owned render profile client boundary", () => {
  it("rejects a client-forged unknown render profile while preserving the entire saved public draft", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-labor-profile-client-boundary-"));
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
      // preservation is checked after the attempted client profile write.
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
      const attemptedProfile = { reviewedLaborTaxBindingVersion: "client-forged-unknown-version" };
      const attackIdempotencyKey = randomUUID();
      const refused = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: attackIdempotencyKey, saveKind: "manual", expectedRevision: before.wb.version.draftRevision, changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, draftData: { ...before.wb.version.draftData, documentBody: ordinaryPlan, documentRenderProfile: attemptedProfile },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "合成劳务甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: before.wb.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      const refusedText = await refused.text();
      let safeMessage = "";
      try { const value = JSON.parse(refusedText) as { message?: unknown }; safeMessage = typeof value.message === "string" ? value.message : Array.isArray(value.message) ? value.message.join("；") : ""; } catch { safeMessage = "非结构化拒绝响应"; }
      const after = await readState();
      await writeFile(join(directory, "public-profile-boundary-observation.json"), JSON.stringify({ before, after, attemptedProfile,
        attackIdempotencyKey, expectedRevision: before.wb.version.draftRevision,
        refusal: { status: refused.status, message: safeMessage }, generationOrNativeRequested: false }, null, 2));
      expect(refused.status).toBe(400);
      expect(safeMessage).toBe("合同文书呈现资料由系统维护，请刷新后重新保存");
      expect(after.wb).toEqual(before.wb);
      // Public readback, not DB/audit/private counters. All stored version
      // fields include R/F, draftRev, amount, tax facts and ordinary edit plan.
      expect(after.wb.version).toEqual(before.wb.version);
      expect(after.wb.parties).toEqual(before.wb.parties);
      expect(after.wb.bills).toEqual(before.wb.bills);
      expect(after.body).toEqual(before.body);
      expect(after.documents).toEqual(before.documents);
      expect(after.body.blocks.find(block => block.id === ordinary!.id)?.text).toBe(manualText);
      expect(after.body.blocks.find(block => block.id === tax.id)).toMatchObject({ text: tax.text, editable: false });
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_CLIENT_PROFILE_REFUSED_AND_ENTIRE_READBACK_UNCHANGED", refusalStatus: refused.status,
        rejectedProfile: attemptedProfile, taxPositionId: tax.id, ordinaryPositionId: ordinary!.id, draftRevision: before.wb.version.draftRevision,
        documentContentRevision: before.wb.version.documentContentRevision, documentContentFingerprint: before.wb.version.documentContentFingerprint,
        amountYuan: "600.0000", sourceSha256: sourceSha, generationOrNativeRequested: false }, null, 2));
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("正式劳务呈现资料边界核对失败，证据 " + directory, { cause }); }
    finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
