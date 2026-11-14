import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
type PublicBody = Body & { contractVersionId: string; draftRevision: number; layoutTemplateVersionId: string; warnings?: string[] };
interface PublicRow {
  id: string; rowKey: string; sortOrder: number; itemCode: string | null; itemName: string; specification: string | null;
  unit: string; quantity: string; unitPrice: string; taxRate: string; taxRatePercent: string; taxRateSource: string;
  pricingFactStatus: string; precisionPolicy: string; numericProtocolVersion: number; numericSource: string; numericReviewStatus: string;
  taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string;
  taxInclusiveAmountCents: string; taxExclusiveAmountCents: string; taxAmountCents: string; taxExclusiveUnitPrice: string;
  isProvisional: boolean; settlementBasis: string | null; customData: Record<string, unknown>;
}
interface PublicBill {
  id: string; billKey: string; name: string; revision: number; amountRole: string; pricingMode: string; quantityScale: number; unitPriceScale: number;
  schemaSnapshot: unknown; sourceExcelFileId: string | null; numericProtocolVersion: number;
  taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string;
  taxInclusiveAmountCents: string; taxExclusiveAmountCents: string; taxAmountCents: string; rows: PublicRow[];
}
interface PublicParty { id: string; roleKey: string; displayOrder: number; businessPartyVersionId?: string | null; snapshot: Record<string, unknown> }

describe("task10 material old queued typography no-retrofit", () => {
  it("keeps an old public queued snapshot frozen and stale after a same-business save upgrades the server profile", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-oldqueue-stale-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    let stage = "preparation-public-auto-baseline";
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials", "material_purchase");
      const draft = await createTask09Draft(server);
      const wbRead = async () => { const response = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(response.status).toBe(200); return response.json(); };
      const initial = await wbRead(); expect(initial.version.layoutTemplateVersionId).toBeNull();
      const baselineKey = randomUUID();
      const knownRows = [{ clientRowKey: "oldqueue-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      const taxFacts = { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" };
      const baselinePayload = { idempotencyKey: baselineKey, saveKind: "auto", expectedRevision: initial.version.draftRevision,
        changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { contractName: "上游新建当前合同名称",
          contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", taxFacts },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "合成材料甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: initial.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: knownRows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const baselineResponse = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(baselinePayload) });
      expect(baselineResponse.status === 200 ? "OK" : await baselineResponse.text()).toBe("OK");
      const baselineAck = await baselineResponse.json(); const baseline = await wbRead();
      expect(baseline.version).toMatchObject({ status: "draft", numericProtocolVersion: 2, amountYuan: "6.5000", amountCents: "650",
        layoutTemplateVersionId: null, pricingNature: "unit_price", amountSource: "bill_sum", estimatedAmountCents: null, amountAdjustmentReason: null,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } });
      expect(baseline.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(baseline.version.draftRevision).toBe(baselineAck.serverRevision);
      expect(baseline.version.documentContentRevision).toBe(baselineAck.documentContentRevision);
      expect(baseline.version.documentContentFingerprint).toBe(baselineAck.documentContentFingerprint);
      expect(Object.hasOwn(baseline.draft, "documentRenderProfile")).toBe(false);
      expect(Object.hasOwn(baseline.draft, "documentBody")).toBe(false); expect(Object.hasOwn(baseline.draft, "documentBodyAction")).toBe(false);
      expect(baseline.draft).toEqual(baseline.version.draftData); expect(baseline.contract.code).toBeNull();
      expect(baseline.bills).toHaveLength(1); expect(baseline.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive",
        numericProtocolVersion: 2, taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      expect(baseline.bills[0].rows).toHaveLength(1);
      for (const [i, amount] of ["6.5000"].entries()) {
        const row = baseline.bills[0].rows[i] as PublicRow;
        expect(row).toMatchObject({ sortOrder: i, itemName: "正文清单钢材", unit: "吨", quantity: "2",
          taxRate: "0", taxRatePercent: "0", taxRateSource: "version_default", precisionPolicy: "four_decimal", pricingFactStatus: "confirmed",
          numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified", taxInclusiveAmountYuan: amount,
          taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000", itemCode: null, specification: null, settlementBasis: null, isProvisional: false, customData: {} });
        expect(row.unitPrice).toBe("3.25"); expect(row.taxExclusiveUnitPrice).toBe("3.25");
        expect(typeof row.rowKey).toBe("string"); expect(row.rowKey.length).toBeGreaterThan(0);
      }
      expect(baseline.paymentTerms).toMatchObject({ originalText: "", stages: [] }); expect(baseline.attachments).toEqual([]);
      expect(baseline.version.clauseSnapshot).toEqual([]);

      stage = "preparation-public-input-projection-calibration";
      // PUBLIC exported function is ONLY a fixture-data builder. No expected newF is ever computed below.
      // The projection is from complete public WB facts plus fixed worked decimal literals, not private DB reads.
      const fixtureInput = {
        templateSnapshot: baseline.version.templateSnapshot, layoutTemplateVersionId: null as string | null,
        parties: baseline.parties.map((party: PublicParty) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
          businessPartyVersionId: party.businessPartyVersionId ?? null, snapshot: party.snapshot })),
        subjectAndScope: baseline.draft,
        amountAndTax: { pricingNature: baseline.version.pricingNature, amountSource: baseline.version.amountSource,
          amountCents: baseline.version.amountCents, numericProtocolVersion: 2, amountYuan: baseline.version.amountYuan,
          estimatedAmountCents: baseline.version.estimatedAmountCents, amountAdjustmentReason: baseline.version.amountAdjustmentReason, taxFacts,
          bills: baseline.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, name: bill.name, amountRole: bill.amountRole,
            pricingMode: bill.pricingMode, quantityScale: bill.quantityScale, unitPriceScale: bill.unitPriceScale, schemaSnapshot: bill.schemaSnapshot,
            sourceExcelFileId: bill.sourceExcelFileId, taxInclusiveAmountCents: bill.taxInclusiveAmountCents,
            numericProtocolVersion: bill.numericProtocolVersion, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan,
            taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
            taxExclusiveAmountCents: bill.taxExclusiveAmountCents, taxAmountCents: bill.taxAmountCents,
            rows: bill.rows.map((row: PublicRow) => ({ rowKey: row.rowKey, sortOrder: row.sortOrder, itemCode: row.itemCode,
              itemName: row.itemName, specification: row.specification, unit: row.unit, quantity: row.quantity,
              unitPrice: "3.25", taxRate: "0", taxRateSource: row.taxRateSource, pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy, numericProtocolVersion: row.numericProtocolVersion, numericSource: row.numericSource,
              numericReviewStatus: row.numericReviewStatus, taxInclusiveAmountYuan: row.taxInclusiveAmountYuan,
              taxExclusiveAmountYuan: row.taxExclusiveAmountYuan, taxAmountYuan: row.taxAmountYuan,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents, taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents, taxExclusiveUnitPrice: "3.25", isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis, customData: row.customData })) })) },
        paymentTerms: { originalText: baseline.paymentTerms.originalText, stages: [] }, clauses: baseline.version.clauseSnapshot, attachments: []
      };
      const calibratedF = calculateContractDocumentContentFingerprint(fixtureInput);
      expect(calibratedF).toBe(baseline.version.documentContentFingerprint);
      const historicalF = calculateContractDocumentContentFingerprint({ ...fixtureInput, layoutTemplateVersionId: layout.id });
      expect(historicalF).toMatch(/^[a-f0-9]{64}$/u); expect(historicalF).not.toBe(calibratedF);
      const oldDraftR = baseline.version.draftRevision + 1, oldContentR = baseline.version.documentContentRevision + 1;
      await writeFile(join(directory, "fixture-data-construction.json"), JSON.stringify({ stage, baselineCoordinates: {
        draftRevision: baseline.version.draftRevision, documentContentRevision: baseline.version.documentContentRevision, fingerprint: calibratedF },
        historicalCoordinates: { draftRevision: oldDraftR, documentContentRevision: oldContentR, fingerprint: historicalF, layoutId: layout.id },
        baselineRequestKeySha256: sha(baselineKey), calibrationIsFixtureConsistencyNotFingerprintAcceptance: true,
        noExpectedNewFingerprintCalculated: true, historicalImportDoesNotClaimCompleteAuditHistory: true }, null, 2));
      // The ONLY historical fixture persistence write: successor coordinates preserve the baseline receipt's original R/F.
      // No checkpoint/receipt/audit rewriting and no adapter reads/counters as acceptance assertions.
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: {
        layoutTemplateVersionId: layout.id, draftRevision: oldDraftR, documentContentRevision: oldContentR, documentContentFingerprint: historicalF
      } });

      // Arm only the test server handle: production services already hold their
      // injected synthetic Prisma reference; no adapter read/write is allowed
      // through this fixture handle after historical preparation.
      Object.defineProperty(server, "store", { configurable: false, get() { throw new Error("历史准备完成后禁止测试访问store"); } });
      stage = "historical-public-preconditions";
      const documentsUrl = `${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`;
      const documentsRead = async () => { const response = await fetch(documentsUrl, { headers: draft.headers }); expect(response.status).toBe(200); return response.json(); };
      const bodyRead = async () => { const response = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(response.status).toBe(200); return await response.json() as PublicBody; };
      const before = await wbRead(); const oldBody = await bodyRead(); const afterOldRead = await wbRead();
      expect(before.version).toMatchObject({ draftRevision: oldDraftR, documentContentRevision: oldContentR, documentContentFingerprint: historicalF, layoutTemplateVersionId: layout.id, amountYuan: "6.5000" });
      expect(Object.hasOwn(before.draft, "documentRenderProfile")).toBe(false); expect(before.draft).toEqual(baseline.draft);
      expect(oldBody).toMatchObject({ sourceSha256: sourceSha, draftRevision: oldDraftR, documentContentRevision: oldContentR });
      expect(afterOldRead.version).toEqual(before.version); expect(afterOldRead.draft).toEqual(before.draft); expect(await documentsRead()).toEqual([]);
      stage = "target-public-old-producer";
      const queuedResponse = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: oldDraftR }) });
      expect(queuedResponse.status === 201 ? "OK" : await queuedResponse.text()).toBe("OK"); const generation = await queuedResponse.json();
      expect(generation).toMatchObject({ status: "queued", documentContentRevision: oldContentR, documentContentFingerprint: historicalF });
      const queuedDocuments = await documentsRead(); expect(queuedDocuments).toHaveLength(1); const oldJob = queuedDocuments[0];
      expect(oldJob).toMatchObject({ id: generation.generationId, status: "queued", purpose: "draft", layoutTemplateVersionId: layout.id, documentContentRevision: oldContentR, documentContentFingerprint: historicalF });
      expect(oldJob.idempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
      expect(oldJob.inputSnapshot).toMatchObject({ documentContentRevision: oldContentR, documentContentFingerprint: historicalF,
        bodyDocument: { sourceSha256: sourceSha, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", pdfEngine: "docx4j-17.3.5" },
        renderInput: { values: { "contract.amountBasis": "tax_inclusive", "contract.taxRateLabel": "0%", "contract.taxInclusiveAmount": "6.5000", "contract.taxExclusiveAmount": "6.5000", "contract.taxAmount": "0.0000" } } });
      expect(Object.hasOwn(oldJob.inputSnapshot.bodyDocument, "typographyVersion")).toBe(false);
      expect(Object.hasOwn(oldJob.inputSnapshot.renderInput.values, "contract.typographyVersion")).toBe(false);
      await writeFile(join(directory, "public-old-queued-observation.json"), JSON.stringify({ before, oldBody, generation, queuedDocuments, actualPublicProducer: true, noWorkerYet: true }, null, 2));
      stage = "target-same-business-public-upgrade";
      const release = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(release.status).toBe(200); expect(await release.json()).toMatchObject({ released: true });
      const leaseResponse = await fetch(draft.base + "/edit-lease", { method: "POST", headers: draft.headers }); expect(leaseResponse.status).toBe(201);
      const lease = await leaseResponse.json(); expect(typeof lease.token).toBe("string");
      const upgradeKey = randomUUID(); expect(upgradeKey).not.toBe(baselineKey);
      const upgradePayload = { idempotencyKey: upgradeKey, saveKind: "manual", expectedRevision: oldDraftR, changedSections: ["draft"],
        draft: { numericProtocolVersion: 2, draftData: before.draft, clauses: before.version.clauseSnapshot, pricingNature: before.version.pricingNature,
          amountSource: before.version.amountSource, layoutTemplateVersionId: layout.id, taxFacts },
        parties: before.parties.map((party: PublicParty) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
          ...(party.businessPartyVersionId ? { businessPartyVersionId: party.businessPartyVersionId } : {}), snapshot: party.snapshot })),
        bills: before.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: bill.rows.map((row: PublicRow) => ({ clientRowKey: knownRows[row.sortOrder].clientRowKey, rowKey: row.rowKey, sortOrder: row.sortOrder,
            itemName: row.itemName, unit: row.unit, quantity: row.quantity, unitPrice: "3.2500", taxRatePercent: "0", isProvisional: row.isProvisional, customData: row.customData })) })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(upgradePayload) });
      const responseText = await response.text(); expect(response.status === 200 ? "OK" : responseText).toBe("OK"); const ack = JSON.parse(responseText);
      const after = await wbRead(); const afterBody = await bodyRead(); const afterDocuments = await documentsRead();
      await writeFile(join(directory, "public-stale-upgrade-observation.json"), JSON.stringify({ before, oldBody, oldJob, ack, after, afterBody, afterDocuments, noNewFingerprintComputed: true, noNativeRequested: true }, null, 2));
      expect(after.version.draftRevision).toBe(oldDraftR + 1); expect(after.version.documentContentRevision).toBe(oldContentR + 1);
      expect(after.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u); expect(after.version.documentContentFingerprint).not.toBe(historicalF);
      expect(ack).toMatchObject({ serverRevision: after.version.draftRevision, documentContentRevision: after.version.documentContentRevision, documentContentFingerprint: after.version.documentContentFingerprint });
      const expectedDraft = { ...before.draft, documentRenderProfile: { typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: "reviewed-material-signature-date-v1" } };
      expect(after.draft).toEqual(expectedDraft); expect(after.version.draftData).toEqual(expectedDraft);
      expect(after.version).toMatchObject({ amountYuan: "6.5000", amountCents: "650", numericProtocolVersion: 2, layoutTemplateVersionId: layout.id, taxFacts: before.version.taxFacts, pricingNature: before.version.pricingNature, amountSource: before.version.amountSource });
      expect(after.parties).toEqual(before.parties); expect(after.paymentTerms).toEqual(before.paymentTerms); expect(after.attachments).toEqual(before.attachments);
      const billFacts = (bills: PublicBill[]) => bills.map(bill => ({ ...bill, rows: bill.rows.map(row => {
        const facts = { ...row } as PublicRow & { availableActions?: unknown; remainderCancellation?: unknown };
        delete facts.availableActions; delete facts.remainderCancellation; return facts;
      }) }));
      // Same C4 business projection: actions may depend on changed draft R/F;
      // all persisted row fields including rowKey and worked amounts remain.
      expect(billFacts(after.bills)).toEqual(billFacts(before.bills));
      expect(afterBody).toMatchObject({ sourceSha256: sourceSha, draftRevision: after.version.draftRevision, documentContentRevision: after.version.documentContentRevision });
      expect(afterDocuments).toHaveLength(1); const stale = afterDocuments[0];
      expect(stale).toMatchObject({ id: oldJob.id, status: "stale", idempotencyKey: oldJob.idempotencyKey, documentContentRevision: oldContentR, documentContentFingerprint: historicalF });
      expect(stale.inputSnapshot).toEqual(oldJob.inputSnapshot); expect(stale.docxFileId).toBe(oldJob.docxFileId); expect(stale.pdfFileId).toBe(oldJob.pdfFileId);
      expect(Object.hasOwn(stale.inputSnapshot.bodyDocument, "typographyVersion")).toBe(false);
      expect(Object.hasOwn(stale.inputSnapshot.renderInput.values, "contract.typographyVersion")).toBe(false);
      stage = "target-stale-sole-job-not-consumed";
      // Public processor seam only after stale+sole-job proof; no job/status
      // mutation, synthetic success or bypass to force an old stale render.
      expect(await server.processor.processNext()).toBe(false);
      const finalDocuments = await documentsRead(); expect(finalDocuments).toEqual(afterDocuments);
      const final = await wbRead(); expect(final.version).toEqual(after.version); expect(final.draft).toEqual(after.draft);
      expect(final.parties).toEqual(after.parties); expect(billFacts(final.bills)).toEqual(billFacts(after.bills));
      expect(sha(await readFile(sourcePath))).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_OLD_QUEUE_STALE_AND_FROZEN_NO_TYPOGRAPHY_RETROFIT", sourceSha256: sourceSha,
        oldGenerationId: oldJob.id, oldIdempotencyKey: oldJob.idempotencyKey, oldR: oldContentR, oldF: historicalF,
        newR: after.version.documentContentRevision, newF: after.version.documentContentFingerprint, sameBusinessAndRowKeys: true,
        oldSnapshotUnchanged: true, oldTypographyPartnersAbsent: true, oneProcessNextResult: false, nativeConversions: 0 }, null, 2));
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), JSON.stringify({ stage, classification: stage.startsWith("preparation-") || stage === "historical-public-preconditions" ? "fixture/precondition; not target RED" : "public oldqueue/no-retrofit assertion failure", message: String(cause) }, null, 2));
      throw new Error("旧材料队列核对失败，阶段 " + stage + "，证据 " + directory, { cause });
    } finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
