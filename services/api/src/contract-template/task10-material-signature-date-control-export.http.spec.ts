import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Server, type Draft, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const typographyVersion = "reviewed-material-primary-secondary-body25-v4";
const dateVersion = "reviewed-material-signature-date-v1";
const dateText = "签署日期：　年　月　日";
const slotIds = ["be6d8bf0f1e5172844c287c65d2f53f404b033dd67611442873a02d5a37a312e", "f20c09d2043ff82ab2e75bd5cce357c5c2a7dc7885246d96872c54245e699d2f"];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const direct = (element: Element, name: string) => Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === name);
const textOf = (element: Element) => Array.from(element.getElementsByTagNameNS(W, "t")).map(t => t.textContent ?? "").join("");
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


async function actualPair(server: Server, draft: Draft, layoutId: string, coordinates: { draftRevision: number; documentContentRevision: number; documentContentFingerprint: string }, withDate: boolean, directory: string, lock: string) {
  await mkdir(directory, { recursive: false });
  const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: coordinates.draftRevision }) }); expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
  const generation = await queued.json();
  const list = async () => {
    const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return response.json();
  };
  const pending = (await list()).find((item: { id: string }) => item.id === generation.generationId);
  expect(pending).toMatchObject({ status: "queued", inputSnapshot: { documentContentRevision: coordinates.documentContentRevision, documentContentFingerprint: coordinates.documentContentFingerprint,
    bodyDocument: { sourceSha256: sourceSha, typographyVersion, runtimeLockSha256: lock }, renderInput: { values: { "contract.typographyVersion": typographyVersion } } } });
  expect(Object.hasOwn(pending.inputSnapshot.bodyDocument, "signatureDateVersion")).toBe(withDate);
  expect(Object.hasOwn(pending.inputSnapshot.renderInput.values, "contract.signatureDateVersion")).toBe(withDate);
  if (withDate) {
    expect(pending.inputSnapshot.bodyDocument.signatureDateVersion).toBe(dateVersion);
    expect(pending.inputSnapshot.renderInput.values["contract.signatureDateVersion"]).toBe(dateVersion);
  }
  const tuple = [draft.version.id, coordinates.documentContentRevision, coordinates.documentContentFingerprint, layoutId, "draft", [], "contract-body-docx4j-v1", lock, "contract-money-v1", "body-bill-loop-v2", typographyVersion, ...(withDate ? [dateVersion] : [])];
  expect(pending.idempotencyKey).toBe(sha(JSON.stringify(tuple)));
  const started = performance.now(); expect(await server.processor.processNext()).toBe(true); expect(performance.now() - started).toBeLessThanOrEqual(130_000);
  const output = (await list()).find((item: { id: string }) => item.id === generation.generationId);
  expect(output).toMatchObject({ status: "success", idempotencyKey: pending.idempotencyKey, inputSnapshot: pending.inputSnapshot, docxFileId: expect.any(String), pdfFileId: expect.any(String) });
  const files = {} as Record<"docx" | "pdf", Buffer>;
  for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
    const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对同一合同V4日期开关严格纸面对照" }) }); expect(ticket.status).toBe(201);
    const { downloadUrl } = await ticket.json(); expect(downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
    const response = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(response.status).toBe(200);
    files[format] = Buffer.from(await response.arrayBuffer()); await writeFile(join(directory, "actual." + format), files[format]);
  }
  const pdfText = inspectActualTemplatePdf(files.docx, files.pdf, withDate ? "same-v4-date-on" : "same-v4-date-off", output.inputSnapshot.inspection.runtime);
  expect((pdfText.replace(/\s/gu, "").match(/签署日期：年月日/gu) ?? []).length).toBe(withDate ? 2 : 0);
  await writeFile(join(directory, "receipt.json"), JSON.stringify({ generation, coordinates, tuple, withDate, output, docxSha256: sha(files.docx), pdfSha256: sha(files.pdf) }, null, 2));
  return { files, output, tuple };
}

describe("task10 same-contract V4 signature-date on/off actual public control", () => {
  it("keeps an old V4 owner and its old key unupgraded and produces a strict same-business pair differing only in the two date slots", async () => {
    const repository = await task10HttpRepository(__dirname), directory = await mkdtemp(join(tmpdir(), "jg-task10-date-on-off-control-"));
    const source = await readFile(join(repository, "services/api/assets/templates/material-purchase-real-v1.docx")); expect(sha(source)).toBe(sourceSha);
    const lock = sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock-material-body25-v4.json")));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server, source, "materials"), draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "date-control-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      const saved = await saveBody(draft, undefined, "当前单甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const initialWb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(initialWb.draft.documentRenderProfile).toEqual({ typographyVersion, signatureDateVersion: dateVersion });
      const dated = await actualPair(server, draft, layout.id, initialWb.version, true, join(directory, "date-on"), lock);
      let wb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(wb.version).toEqual({ ...initialWb.version, latestDraftPreviewDocumentId: dated.output.id, updatedAt: wb.version.updatedAt });
      // Historical fixture preparation ONLY, after every real business save has completed.
      // The exported F builder calibrates the complete public projection first;
      // its result is not an expected producer/worker fingerprint acceptance value.
      const currentSaved = wb;
      expect(currentSaved.draft).toEqual(currentSaved.version.draftData);
      expect(currentSaved.paymentTerms).toMatchObject({ originalText: "", stages: [] });
      expect(currentSaved.attachments).toEqual([]); expect(currentSaved.version.clauseSnapshot).toEqual([]);
      const fixtureInput = {
        templateSnapshot: currentSaved.version.templateSnapshot, layoutTemplateVersionId: layout.id,
        parties: currentSaved.parties.map((party: PublicParty) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
          businessPartyVersionId: party.businessPartyVersionId ?? null, snapshot: party.snapshot })),
        subjectAndScope: currentSaved.draft,
        amountAndTax: { pricingNature: currentSaved.version.pricingNature, amountSource: currentSaved.version.amountSource,
          amountCents: currentSaved.version.amountCents, numericProtocolVersion: 2, amountYuan: currentSaved.version.amountYuan,
          estimatedAmountCents: currentSaved.version.estimatedAmountCents, amountAdjustmentReason: currentSaved.version.amountAdjustmentReason,
          taxFacts: { invoiceType: currentSaved.version.taxFacts.invoiceType, taxMode: currentSaved.version.taxFacts.taxMode,
            defaultTaxRatePercent: currentSaved.version.taxFacts.defaultTaxRatePercent, source: currentSaved.version.taxFacts.source },
          bills: currentSaved.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, name: bill.name, amountRole: bill.amountRole,
            pricingMode: bill.pricingMode, quantityScale: bill.quantityScale, unitPriceScale: bill.unitPriceScale, schemaSnapshot: bill.schemaSnapshot,
            sourceExcelFileId: bill.sourceExcelFileId, taxInclusiveAmountCents: bill.taxInclusiveAmountCents,
            numericProtocolVersion: bill.numericProtocolVersion, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan,
            taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
            taxExclusiveAmountCents: bill.taxExclusiveAmountCents, taxAmountCents: bill.taxAmountCents,
            rows: bill.rows.map((row: PublicRow) => ({ rowKey: row.rowKey, sortOrder: row.sortOrder, itemCode: row.itemCode,
              itemName: row.itemName, specification: row.specification, unit: row.unit, quantity: row.quantity,
              unitPrice: row.unitPrice, taxRate: row.taxRate, taxRateSource: row.taxRateSource, pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy, numericProtocolVersion: row.numericProtocolVersion, numericSource: row.numericSource,
              numericReviewStatus: row.numericReviewStatus, taxInclusiveAmountYuan: row.taxInclusiveAmountYuan,
              taxExclusiveAmountYuan: row.taxExclusiveAmountYuan, taxAmountYuan: row.taxAmountYuan,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents, taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents, taxExclusiveUnitPrice: row.taxExclusiveUnitPrice, isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis, customData: row.customData })) })) },
        paymentTerms: { originalText: currentSaved.paymentTerms.originalText, stages: [] },
        clauses: currentSaved.version.clauseSnapshot, attachments: []
      };
      const calibratedF = calculateContractDocumentContentFingerprint(fixtureInput);
      expect(calibratedF).toBe(currentSaved.version.documentContentFingerprint);
      const historicalDraft = { ...currentSaved.draft, documentRenderProfile: { typographyVersion } };
      const historicalF = calculateContractDocumentContentFingerprint({ ...fixtureInput, subjectAndScope: historicalDraft });
      expect(historicalF).toMatch(/^[a-f0-9]{64}$/u); expect(historicalF).not.toBe(calibratedF);
      const historicalDraftR = currentSaved.version.draftRevision + 1, historicalContentR = currentSaved.version.documentContentRevision + 1;
      await writeFile(join(directory, "historical-owner-fixture-construction.json"), JSON.stringify({
        publicBaseline: currentSaved, calibratedF, historicalDraft, historicalCoordinates: {
          draftRevision: historicalDraftR, documentContentRevision: historicalContentR, fingerprint: historicalF, layoutTemplateVersionId: layout.id },
        calibrationIsFixtureConsistencyNotFingerprintAcceptance: true, syntheticHistoricalImportNotCompleteAuditLifecycle: true
      }, null, 2));
      // Sole historical persistence write. Existing aggregate receipt/checkpoint/audit remain at their original coordinates.
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: {
        draftData: historicalDraft, layoutTemplateVersionId: layout.id, draftRevision: historicalDraftR,
        documentContentRevision: historicalContentR, documentContentFingerprint: historicalF
      } });
      Object.defineProperty(server, "store", { configurable: false, get() { throw new Error("历史准备完成后禁止测试访问store"); } });
      const historicalWbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(historicalWbResponse.status).toBe(200);
      wb = await historicalWbResponse.json();
      expect(wb.version).toEqual({ ...currentSaved.version, draftData: historicalDraft, layoutTemplateVersionId: layout.id,
        draftRevision: historicalDraftR, documentContentRevision: historicalContentR, documentContentFingerprint: historicalF,
        updatedAt: wb.version.updatedAt });
      expect(typeof wb.version.updatedAt).toBe("string");
      expect(Date.parse(wb.version.updatedAt)).toBeGreaterThanOrEqual(Date.parse(currentSaved.version.updatedAt));
      expect(wb.draft).toEqual(historicalDraft);
      for (const section of ["parties", "bills", "paymentTerms", "attachments"]) expect(wb[section]).toEqual(currentSaved[section]);
      await writeFile(join(directory, "historical-owner-public-workbench.json"), JSON.stringify(wb, null, 2));

      expect(wb.draft.documentRenderProfile).toEqual({ typographyVersion });
      const beforeBody = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(beforeBody.status).toBe(200); const oldBody = await beforeBody.json() as Body;
      for (const id of slotIds) expect(oldBody.blocks.find(block => block.id === id)).toMatchObject({ text: "", editable: true });
      const repeat = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(repeat.version).toEqual(wb.version); expect(repeat.draft).toEqual(wb.draft); expect(repeat.version.latestDraftPreviewDocumentId).toBe(dated.output.id);
      const undated = await actualPair(server, draft, layout.id, wb.version, false, join(directory, "date-off"), lock);
      // Same contract/source/layout/values. Only the date capability plus its
      // fixture R/F coordinates and corresponding queue metadata may differ.
      const onValues = { ...dated.output.inputSnapshot.renderInput.values }, offValues = { ...undated.output.inputSnapshot.renderInput.values };
      expect(onValues["field.documentRenderProfile"]).toEqual({ typographyVersion, signatureDateVersion: dateVersion });
      expect(offValues["field.documentRenderProfile"]).toEqual({ typographyVersion });
      expect(typeof onValues["document.generatedAt"]).toBe("string"); expect(typeof offValues["document.generatedAt"]).toBe("string");
      expect(Date.parse(offValues["document.generatedAt"])).toBeGreaterThan(Date.parse(onValues["document.generatedAt"]));
      const generationTimes = { dateOn: onValues["document.generatedAt"], dateOff: offValues["document.generatedAt"] };
      delete onValues["contract.signatureDateVersion"]; onValues["field.documentRenderProfile"] = { typographyVersion };
      delete onValues["document.generatedAt"]; delete offValues["document.generatedAt"];
      expect(offValues).toEqual(onValues);
      const oldBodyDocument = { ...dated.output.inputSnapshot.bodyDocument }; delete oldBodyDocument.signatureDateVersion;
      expect(undated.output.inputSnapshot.bodyDocument).toEqual(oldBodyDocument);
      const zipOn = new PizZip(dated.files.docx), zipOff = new PizZip(undated.files.docx), serializer = new XMLSerializer();
      const onParts = Object.keys(zipOn.files).filter(name => !zipOn.files[name].dir).sort(), offParts = Object.keys(zipOff.files).filter(name => !zipOff.files[name].dir).sort(); expect(onParts).toEqual(offParts);
      for (const name of onParts.filter(name => name !== "word/document.xml")) expect(zipOn.file(name)!.asNodeBuffer()).toEqual(zipOff.file(name)!.asNodeBuffer());
      const parse = (bytes: Buffer) => new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(), "application/xml");
      const onDocument = parse(dated.files.docx), offDocument = parse(undated.files.docx), onTable = onDocument.getElementsByTagNameNS(W, "tbl")[1], offTable = offDocument.getElementsByTagNameNS(W, "tbl")[1];
      const onCells = direct(direct(onTable, "tr")[0], "tc"), offCells = direct(direct(offTable, "tr")[0], "tc"); expect(onCells).toHaveLength(2); expect(offCells).toHaveLength(2);
      for (let i = 0; i < 2; i++) {
        const onParagraphs = direct(onCells[i], "p"), offParagraphs = direct(offCells[i], "p"); expect(onParagraphs).toHaveLength(7); expect(offParagraphs).toHaveLength(7);
        expect(textOf(onParagraphs[5])).toBe(dateText); expect(offParagraphs[5].childNodes.length).toBe(0);
        while (onParagraphs[5].firstChild) onParagraphs[5].removeChild(onParagraphs[5].firstChild!);
      }
      expect(serializer.serializeToString(onDocument)).toBe(serializer.serializeToString(offDocument));
      const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(after.version).toEqual({ ...wb.version, latestDraftPreviewDocumentId: undated.output.id, updatedAt: after.version.updatedAt });
      for (const section of ["draft", "parties", "bills", "paymentTerms", "attachments"]) expect(after[section]).toEqual(wb[section]);
      const upgraded = await saveBody(draft, undefined, "当前单甲方", rows); expect(upgraded.status === 200 ? "OK" : await upgraded.text()).toBe("OK");
      const newWb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json()); expect(newWb.draft.documentRenderProfile).toEqual({ typographyVersion, signatureDateVersion: dateVersion });
      expect(newWb.version.documentContentFingerprint).not.toBe(wb.version.documentContentFingerprint); expect(newWb.version.documentContentRevision).toBeGreaterThan(wb.version.documentContentRevision); expect(newWb.version.latestDraftPreviewDocumentId).toBe(undated.output.id);
      const staleResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(staleResponse.status).toBe(200);
      const stale = (await staleResponse.json()).find((item: { id: string }) => item.id === undated.output.id);
      expect(stale).toMatchObject({ status: "stale", idempotencyKey: undated.output.idempotencyKey, docxFileId: undated.output.docxFileId, pdfFileId: undated.output.pdfFileId });
      expect(stale.inputSnapshot).toEqual(undated.output.inputSnapshot);
      for (const [id, expected] of [[dated.output.docxFileId, dated.files.docx], [dated.output.pdfFileId, dated.files.pdf]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对原生成文书仍有引用且历史文件受控可读" }) }); expect(ticket.status).toBe(201);
        const { downloadUrl } = await ticket.json(); const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(downloaded.status).toBe(200);
        expect(sha(Buffer.from(await downloaded.arrayBuffer()))).toBe(sha(expected));
      }
      const finalBody = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(finalBody.status).toBe(200);
      const final = await finalBody.json() as Body; for (const id of slotIds) expect(final.blocks.find(block => block.id === id)).toMatchObject({ text: dateText });
      await writeFile(join(directory, "comparison.json"), JSON.stringify({ sourceSha256: sourceSha, sameContractId: draft.contract.id, sameVersionId: draft.version.id, layoutId: layout.id,
        dateOn: { coordinates: initialWb.version, docxSha256: sha(dated.files.docx), pdfSha256: sha(dated.files.pdf), tuple: dated.tuple },
        dateOff: { coordinates: wb.version, docxSha256: sha(undated.files.docx), pdfSha256: sha(undated.files.pdf), tuple: undated.tuple },
        onlyDeclaredDifferences: ["signatureDateVersion in persisted profile/values/bodyDocument/key", "natural document.generatedAt metadata (exact values recorded)", "synthetic old-owner draft/content revisions and calibrated fingerprint", "two default date slot paragraphs in main Word XML", "generated artifact identifiers and inspection witnesses"],
        generationTimes, allOtherWordPartsByteIdentical: true, mainWordXmlIdenticalAfterRemovingExactlyTwoNewDateRuns: true,
        actualPdfGeometryIndependentObserverPending: true, historicalFixtureIsNotAnAuditedImportLifecycle: true, newSaveUpgrade: newWb.version }, null, 2));
      console.info(`任务10同合同V4日期开关严格对照：${directory}`);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 330_000);
});
