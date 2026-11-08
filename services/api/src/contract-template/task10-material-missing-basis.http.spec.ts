import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const typographyVersion = "reviewed-material-primary-secondary-body25-v4";
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string };

describe("task10 material typography without an entered amount basis through public HTTP", () => {
  it("saves omitted basis, reads normative roles, and freezes typography with both money stamps absent without changing saved R/F", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-missing-basis-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      const beforeResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json();
      expect(before.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // No saveTask09Draft: it would supply amountBasis:'tax_inclusive'.
      // Rebuild basics explicitly; no spread of a hidden previous basis.
      const payload = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: before.version.draftRevision,
        changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...before.version.draftData,
          contractName: "上游新建当前合同名称",
          contractBasics: { businessType: "material_purchase", relationship: "upward", invoiceStatus: "pending" }
        }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } },
          { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: before.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey,
          expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: [{ clientRowKey: "missing-basis-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      };
      const serialized = JSON.stringify(payload);
      expect(Object.hasOwn(JSON.parse(serialized).draft.draftData.contractBasics, "amountBasis")).toBe(false);
      await writeFile(join(directory, "public-save-payload.json"), serialized);
      const savedResponse = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: serialized });
      const savedText = await savedResponse.text();
      await writeFile(join(directory, "public-save-response.json"), JSON.stringify({ status: savedResponse.status, body: savedText }, null, 2));
      expect(savedResponse.status === 200 ? "OK" : savedText).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(wbResponse.status).toBe(200);
      const wb = await wbResponse.json();
      await writeFile(join(directory, "saved-public-workbench.json"), JSON.stringify(wb, null, 2));
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "6.5000", layoutTemplateVersionId: layout.id,
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" } });
      expect(wb.version.draftData.contractBasics).toEqual(payload.draft.draftData.contractBasics);
      expect(Object.hasOwn(wb.version.draftData.contractBasics, "amountBasis")).toBe(false);
      expect(wb.version.draftData.documentRenderProfile).toEqual({ typographyVersion, signatureDateVersion: "reviewed-material-signature-date-v1" });
      expect(wb.version.documentContentRevision).toBeGreaterThan(before.version.documentContentRevision);
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.version.documentContentFingerprint).not.toBe(before.version.documentContentFingerprint);
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(1);
      expect(wb.bills[0].rows[0]).toMatchObject({ itemName: "正文清单钢材", quantity: "2", unitPrice: "3.25", taxRatePercent: "0", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as PublicBody;
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(body, null, 2));
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
        draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      const ordered = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph")
        .map(node => body.blocks.find(block => block.id === node.paragraphId)!);
      expect(ordered.every(Boolean)).toBe(true);
      const titles = ordered.filter(block => block.text === "上游新建当前合同名称"); expect(titles).toHaveLength(2);
      const [cover, bodyTitle] = titles;
      const articles = ordered.filter(block => block.text === "第一条  货物名称、规格型号、数量、价格等"); expect(articles).toHaveLength(1);
      const article = articles[0];
      expect([cover.id, bodyTitle.id, article.id]).toEqual([
        "fe8a01bb7008d14107fd6abe3584dee8f92c5544c883bbd85c67e4dcadd4a17c",
        "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9",
        "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72"
      ]);
      expect(ordered.indexOf(cover)).toBeLessThan(ordered.indexOf(bodyTitle));
      expect(ordered.indexOf(bodyTitle)).toBeLessThan(ordered.indexOf(article));
      expect(cover.format).toMatchObject({ fontFamily: "方正小标宋简体", fontSizePt: 22 });
      expect(bodyTitle.format).toMatchObject({ fontFamily: "方正小标宋简体", fontSizePt: 22 });
      expect(article.format).toMatchObject({ fontFamily: "黑体", fontSizePt: 14 });
      const queueResponse = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers,
        body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      const queueText = await queueResponse.text();
      await writeFile(join(directory, "public-queue-response.json"), JSON.stringify({ status: queueResponse.status, body: queueText }, null, 2));
      expect(queueResponse.status === 201 ? "OK" : queueText).toBe("OK");
      const generation = JSON.parse(queueText);
      expect(generation).toMatchObject({ generationId: expect.any(String), status: "queued", sourceRevision: body.draftRevision,
        documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const listResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(listResponse.status).toBe(200);
      const documents = await listResponse.json();
      await writeFile(join(directory, "public-documents.json"), JSON.stringify(documents, null, 2));
      const queued = documents.find((row: { id: string }) => row.id === generation.generationId);
      expect(queued).toBeDefined();
      expect(queued).toMatchObject({ status: "queued", layoutTemplateVersionId: layout.id,
        documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { protocolVersion: 1, sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, typographyVersion },
          renderInput: { values: { "contract.typographyVersion": typographyVersion } } } });
      // These are existing PUBLIC list fields, not a store/private snapshot read.
      expect(Object.hasOwn(queued.inputSnapshot.bodyDocument, "typographyVersion")).toBe(true);
      expect(Object.hasOwn(queued.inputSnapshot.renderInput.values, "contract.typographyVersion")).toBe(true);
      expect(Object.hasOwn(queued.inputSnapshot.bodyDocument, "renderSemanticVersion")).toBe(false);
      expect(Object.hasOwn(queued.inputSnapshot.renderInput.values, "contract.renderSemanticVersion")).toBe(false);
      const afterResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.json();
      await writeFile(join(directory, "after-public-workbench.json"), JSON.stringify(after, null, 2));
      expect(after.version).toMatchObject({ draftRevision: wb.version.draftRevision,
        documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        numericProtocolVersion: 2, amountYuan: "6.5000" });
      expect(after.version.draftData).toEqual(wb.version.draftData);
      expect(Object.hasOwn(after.version.draftData.contractBasics, "amountBasis")).toBe(false);
      expect(after.version.draftData.documentRenderProfile).toEqual({ typographyVersion, signatureDateVersion: "reviewed-material-signature-date-v1" });
      expect(after.bills).toEqual(wb.bills);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_MISSING_BASIS_TYPOGRAPHY_AND_QUEUE_MONEY_ABSENCE_PRESERVED",
        sourceSha256: sourceSha, generation, documentContentRevision: wb.version.documentContentRevision,
        documentContentFingerprint: wb.version.documentContentFingerprint, profile: { typographyVersion, signatureDateVersion: "reviewed-material-signature-date-v1" }, amountYuan: "6.5000",
        amountBasisOwnAbsent: true, bothMoneyStampsOwnAbsent: true, processNextOrNativeRequested: false }, null, 2));
      console.info("材料未填金额口径公开证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("材料未填金额口径核对失败，证据 " + directory, { cause });
    } finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
