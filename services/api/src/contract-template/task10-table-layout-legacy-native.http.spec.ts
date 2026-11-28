import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { Prisma } from "@prisma/client";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { createTemplateTestServer } from "./template-management.test-support";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Draft = Awaited<ReturnType<typeof createTask09Draft>>;

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

describe("task10 old no-table-layout queued job actual execution", () => {
  it("executes the frozen old layout with real guarded Java while an independent historical success stays immutable", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    const referenceDirectory = process.env.TASK10_LEGACY_REFERENCE_DIRECTORY;
    if (!python || !referenceDirectory || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("旧布局实际正控需要明确的锁定运行时及原始文件来源");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-old-layout-native-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const uploads = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const referenceDocx = await readFile(join(referenceDirectory, "actual.docx"));
      const referencePdf = await readFile(join(referenceDirectory, "actual.pdf"));
      const referenceJson = await readFile(join(referenceDirectory, "receipt.json"));
      expect(hash(referenceDocx)).toBe("b2ddd1b64464d5f63113907d2c5a89cf752d452b53ed3ae4e603bec74ef727b0");
      expect(hash(referencePdf)).toBe("e0f34de765cdd9548de649aed4526f1aeda0ca63ee3c01abe052390f3827eb25");
      expect(hash(referenceJson)).toBe("034f97b7e322aaf0271b3f44d94f7c8b73d7939f12614aea1d7fa8203b311a6c");
      const reference = JSON.parse(referenceJson.toString("utf8"));
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const list = async (draft: Draft, headers = draft.headers) => {
        const response = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers });
        expect(response.status).toBe(200);
        return response.json();
      };
      const workbench = async (draft: Draft, headers = draft.headers) => {
        const response = await fetch(draft.base + "/workbench", { headers });
        expect(response.status).toBe(200);
        return response.json();
      };
      const prepareUnprofiledHistoricalOwner = async (draft: Draft) => {
        // Explicit synthetic historical import after all public business saves.
        // Calibration establishes fixture consistency only, not an independent F oracle.
        const currentSaved = await workbench(draft);
        expect(currentSaved.draft).toEqual(currentSaved.version.draftData);
        expect(currentSaved.draft.documentRenderProfile).toEqual({ typographyVersion: "reviewed-material-primary-secondary-body25-v4",
          signatureDateVersion: "reviewed-material-signature-date-v1" });
        expect(currentSaved.paymentTerms).toMatchObject({ originalText: "", stages: [] });
        expect(currentSaved.attachments).toEqual([]); expect(currentSaved.version.clauseSnapshot).toEqual([]);
        // Only bill compatibility cents are masked by the public numeric2 read.
        // Copy the existing persisted F-preimage values by exact owner/bill IDs;
        // never infer zero from unknown business amounts or change public facts.
        // The public unitPrice display adds trailing zeros; only its F preimage
        // below uses Decimal.toString, as the saved fingerprint producer does.
        const compatibilityCents = new Map<string, { taxInclusiveAmountCents: string; taxExclusiveAmountCents: string; taxAmountCents: string }>();
        for (const bill of currentSaved.bills as PublicBill[]) {
          // This in-memory arrangement API has no select option. Access only the
          // two identity fields and three compatibility fields listed below.
          const persisted = await server.store.prisma.contractBill.findFirst({ where: { id: bill.id, contractVersionId: draft.version.id } });
          expect(persisted).not.toBeNull(); expect(persisted!.id).toBe(bill.id); expect(persisted!.contractVersionId).toBe(draft.version.id);
          for (const key of ["taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents"]) expect(typeof persisted![key]).toBe("bigint");
          compatibilityCents.set(bill.id, { taxInclusiveAmountCents: String(persisted!.taxInclusiveAmountCents),
            taxExclusiveAmountCents: String(persisted!.taxExclusiveAmountCents), taxAmountCents: String(persisted!.taxAmountCents) });
        }
        expect(compatibilityCents.size).toBe(currentSaved.bills.length);
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
            sourceExcelFileId: bill.sourceExcelFileId, taxInclusiveAmountCents: compatibilityCents.get(bill.id)!.taxInclusiveAmountCents,
            numericProtocolVersion: bill.numericProtocolVersion, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan,
            taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
            taxExclusiveAmountCents: compatibilityCents.get(bill.id)!.taxExclusiveAmountCents, taxAmountCents: compatibilityCents.get(bill.id)!.taxAmountCents,
            rows: bill.rows.map((row: PublicRow) => ({ rowKey: row.rowKey, sortOrder: row.sortOrder, itemCode: row.itemCode,
              itemName: row.itemName, specification: row.specification, unit: row.unit, quantity: row.quantity,
              unitPrice: row.unitPrice == null ? null : new Prisma.Decimal(row.unitPrice).toString(), taxRate: row.taxRate, taxRateSource: row.taxRateSource, pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy, numericProtocolVersion: row.numericProtocolVersion, numericSource: row.numericSource,
              numericReviewStatus: row.numericReviewStatus, taxInclusiveAmountYuan: row.taxInclusiveAmountYuan,
              taxExclusiveAmountYuan: row.taxExclusiveAmountYuan, taxAmountYuan: row.taxAmountYuan,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents, taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents, taxExclusiveUnitPrice: row.taxExclusiveUnitPrice, isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis, customData: row.customData })) })) },
        paymentTerms: { originalText: currentSaved.paymentTerms.originalText, stages: [] },
        clauses: currentSaved.version.clauseSnapshot, attachments: []
      };
        await writeFile(join(directory, `fixture-fingerprint-input-${draft.version.id}.json`), JSON.stringify({
          currentSaved, fixtureInput, persistedCompatibilityCentsByBillId: [...compatibilityCents.entries()],
          compatibilityCentsArePreimageOnlyNotKnownBusinessAmounts: true
        }, null, 2), { flag: "wx" });
        const calibratedF = calculateContractDocumentContentFingerprint(fixtureInput);
        expect(calibratedF).toBe(currentSaved.version.documentContentFingerprint);
        const historicalDraft = { ...currentSaved.draft };
        delete historicalDraft.documentRenderProfile;
        const historicalF = calculateContractDocumentContentFingerprint({ ...fixtureInput, subjectAndScope: historicalDraft });
        expect(historicalF).toMatch(/^[a-f0-9]{64}$/u); expect(historicalF).not.toBe(calibratedF);
        const draftRevision = currentSaved.version.draftRevision + 1;
        const documentContentRevision = currentSaved.version.documentContentRevision + 1;
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: {
          draftData: historicalDraft, draftRevision, documentContentRevision, documentContentFingerprint: historicalF
        } });
        const imported = await workbench(draft);
        expect(imported.version).toEqual({ ...currentSaved.version, draftData: historicalDraft, draftRevision,
          documentContentRevision, documentContentFingerprint: historicalF, updatedAt: imported.version.updatedAt });
        expect(typeof imported.version.updatedAt).toBe("string");
        expect(Date.parse(imported.version.updatedAt)).toBeGreaterThanOrEqual(Date.parse(currentSaved.version.updatedAt));
        expect(imported.draft).toEqual(historicalDraft);
        for (const key of ["parties", "bills", "paymentTerms", "attachments"]) expect(imported[key]).toEqual(currentSaved[key]);
        expect(Object.hasOwn(imported.draft, "documentRenderProfile")).toBe(false);
        const repeated = await workbench(draft);
        expect(repeated).toEqual(imported);
        await writeFile(join(directory, `historical-owner-${draft.version.id}.json`), JSON.stringify({ currentSaved,
          calibratedF, imported, repeated, calibrationIsFixtureConsistencyNotFingerprintAcceptance: true,
          syntheticHistoricalImportNotCompleteAuditLifecycle: true }, null, 2), { flag: "wx" });
      };
      const queue = async (draft: Draft) => {
        await prepareUnprofiledHistoricalOwner(draft);
        const state = await workbench(draft);
        const response = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers,
          body: JSON.stringify({ sourceRevision: state.version.draftRevision }) });
        expect(response.status === 201 ? "OK" : await response.text()).toBe("OK");
        const generated = await response.json();
        const document = (await list(draft)).find((item: { id: string }) => item.id === generated.generationId);
        expect(document.inputSnapshot).toMatchObject({ bodyDocument: { tableLayoutVersion: "body-bill-loop-v2", renderSemanticVersion: "contract-money-v1", pdfEngine: "docx4j-17.3.5" },
          renderInput: { values: { "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.renderSemanticVersion": "contract-money-v1" } } });
        return { document, state };
      };
      const saveFacts = async (draft: Draft, basis: "tax_inclusive" | "tax_exclusive", rows: Array<Record<string, unknown>>, suffix: string, rate: string | null) => {
        const before = await fetch(draft.base + "/document-body", { headers: draft.headers }).then(response => response.json()) as Body;
        const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"))!;
        expect(ordinary).toBeDefined();
        const manualText = ordinary.text + suffix;
        const state = await workbench(draft);
        const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
          idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: state.version.draftRevision, changedSections: ["draft", "bills"],
          draft: { numericProtocolVersion: 2, draftData: { ...state.version.draftData,
            contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: basis, invoiceStatus: "pending" },
            documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manualText }] }
          }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: rate, source: "contract_document" } },
          parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
          bills: state.bills.map((bill: { billKey: string; revision: number }, index: number) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: index ? [] : rows })),
          paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
        }) });
        expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
        return manualText;
      };
      const removeTableContext = (value: unknown) => {
        const snapshot = JSON.parse(JSON.stringify(value));
        delete snapshot.bodyDocument.tableLayoutVersion;
        delete snapshot.renderInput.values["contract.tableLayoutVersion"];
        return snapshot;
      };
      // Fixed pre-layout 2cd protocol, never the current private key helper.
      const oldKey = (draft: Draft, snapshot: { documentContentRevision: number; documentContentFingerprint: string; bodyDocument: { runtimeLockSha256: string } }) =>
        hash(JSON.stringify([draft.version.id, snapshot.documentContentRevision, snapshot.documentContentFingerprint, layout.id, "draft", [],
          "contract-body-docx4j-v1", snapshot.bodyDocument.runtimeLockSha256, "contract-money-v1"]));
      const downloadPair = async (draft: Draft, record: { docxFileId: string; pdfFileId: string }, headers = draft.headers) => {
        const bytes: Partial<Record<"docx" | "pdf", Buffer>> = {};
        for (const [format, fileId] of [["docx", record.docxFileId], ["pdf", record.pdfFileId]] as const) {
          const ticket = await fetch((await server.app.getUrl()) + "/files/" + fileId + "/download-ticket", { method: "POST", headers,
            body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对历史文件守恒与旧无标记任务实际输出" }) });
          expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
          const { downloadUrl } = await ticket.json() as { downloadUrl: string };
          const response = await fetch((await server.app.getUrl()) + downloadUrl);
          expect(response.status).toBe(200);
          bytes[format] = Buffer.from(await response.arrayBuffer());
        }
        return { docx: bytes.docx!, pdf: bytes.pdf! };
      };

      // A is a synthetic historical-success record with exact known GIS bytes.
      // This does not replay or claim the original GIS business lifecycle.
      const history = await createTask09Draft(server);
      await server.store.prisma.contract.update({ where: { id: history.contract.id }, data: {
        temporaryCode: reference.output.inputSnapshot.renderInput.values["contract.temporaryCode"]
      } });
      expect((await saveTask09Draft(server, history, "material_purchase", layout.id)).status).toBe(200);
      await saveFacts(history, "tax_exclusive", [{ clientRowKey: "history-net", sortOrder: 0, itemName: "净口径材料", unit: "吨", quantity: "1", unitPrice: "1.5340", customData: {} }], "双方人工补充约定应当保留。", null);
      expect((await workbench(history)).version).toMatchObject({ amountYuan: "1.5340" });
      const historicalBase = await queue(history);
      const oldSnapshotA = removeTableContext(historicalBase.document.inputSnapshot);
      const historyFiles: string[] = [];
      for (const [format, bytes, mimeType] of [["docx", referenceDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["pdf", referencePdf, "application/pdf"]] as const) {
        const file = await server.files.uploadPrivateFile({ originalName: "既有历史文件." + format, mimeType, buffer: bytes, sizeBytes: bytes.length, uploadedByUserId: "staff" });
        historyFiles.push(file.id);
      }
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: historicalBase.document.id }, data: {
        status: "success", inputSnapshot: oldSnapshotA, idempotencyKey: oldKey(history, oldSnapshotA),
        docxFileId: historyFiles[0], pdfFileId: historyFiles[1], completedAt: new Date()
      } });
      await server.store.prisma.contractVersion.update({ where: { id: history.version.id }, data: { latestDraftPreviewDocumentId: historicalBase.document.id } });
      const historyBefore = (await list(history)).find((item: { id: string }) => item.id === historicalBase.document.id);
      const beforeBytes = await downloadPair(history, historyBefore);
      expect(hash(beforeBytes.docx)).toBe(hash(referenceDocx)); expect(hash(beforeBytes.pdf)).toBe(hash(referencePdf));
      expect((await workbench(history)).version.latestDraftPreviewDocumentId).toBe(historyBefore.id);

      // B is a newly executed pre-layout queued fixture, not immutable history A.
      const draft = await createTask09Draft(server);
      await server.store.prisma.contract.update({ where: { id: draft.contract.id }, data: { temporaryCode: "草稿-旧布局实际正控-001" } });
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const manualText = await saveFacts(draft, "tax_inclusive", [1, 2].map(index => ({ clientRowKey: "old-layout-" + index, sortOrder: index - 1,
        itemName: "旧任务材料00" + index, unit: "项", quantity: "1", unitPrice: index + ".0000", taxRatePercent: "0", customData: {} })),
      "旧无标记任务的人工条款应原样保留。", "0");
      const currentBody = await fetch(draft.base + "/document-body", { headers: draft.headers }).then(response => response.json()) as Body & {
        flow: Array<{ kind: string; rows?: unknown[] }>
      };
      expect(currentBody.flow.filter(node => node.kind === "table").map(node => node.rows?.length)).toEqual([3, 1]);
      const base = await queue(draft);
      expect(base.state.version.amountYuan).toBe("3.0000");
      expect(base.state.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "3.0000", taxExclusiveAmountYuan: "3.0000", taxAmountYuan: "0.0000" });
      const oldSnapshotB = removeTableContext(base.document.inputSnapshot);
      const keyB = oldKey(draft, oldSnapshotB);
      expect(keyB).not.toBe(base.document.idempotencyKey);
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: base.document.id }, data: { inputSnapshot: oldSnapshotB, idempotencyKey: keyB } });
      // Both historical owners and frozen queue fixtures are complete; consume only public boundaries below.
      Object.defineProperty(server, "store", { configurable: false, get() { throw new Error("历史准备完成后禁止测试访问store"); } });
      const queuedOld = (await list(draft)).find((item: { id: string }) => item.id === base.document.id);
      expect(queuedOld).toMatchObject({ status: "queued", idempotencyKey: keyB });
      expect(Object.hasOwn(queuedOld.inputSnapshot.bodyDocument, "tableLayoutVersion")).toBe(false);
      expect(Object.hasOwn(queuedOld.inputSnapshot.renderInput.values, "contract.tableLayoutVersion")).toBe(false);
      expect(queuedOld.inputSnapshot.bodyDocument.renderSemanticVersion).toBe("contract-money-v1");
      for (const axis of ["typographyVersion", "signatureDateVersion"]) {
        expect(Object.hasOwn(queuedOld.inputSnapshot.bodyDocument, axis)).toBe(false);
        expect(Object.hasOwn(queuedOld.inputSnapshot.renderInput.values, "contract." + axis)).toBe(false);
      }

      uploads.mockClear();
      expect(await server.processor.processNext()).toBe(true);
      const output = (await list(draft)).find((item: { id: string }) => item.id === base.document.id);
      expect(output).toMatchObject({ status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      expect(Object.hasOwn(output.inputSnapshot.bodyDocument, "tableLayoutVersion")).toBe(false);
      expect(Object.hasOwn(output.inputSnapshot.renderInput.values, "contract.tableLayoutVersion")).toBe(false);
      const files = await downloadPair(draft, output);
      await writeFile(join(directory, "actual.docx"), files.docx); await writeFile(join(directory, "actual.pdf"), files.pdf);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ purpose: "draft", legalSigningAcceptance: false,
        history: { id: historyBefore.id, docxFileId: historyFiles[0], pdfFileId: historyFiles[1], docxSha256: hash(referenceDocx), pdfSha256: hash(referencePdf) },
        oldQueued: output, oldKey: keyB, currentNewBodyTableRows: [3, 1], expectedOldWordTableRows: [2, 2, 1],
        docxSha256: hash(files.docx), pdfSha256: hash(files.pdf), verdict: "PENDING" }, null, 2));
      const zip = new PizZip(files.docx), original = new PizZip(source);
      const allowedBindings = new Set(["word/document.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const name of Object.keys(original.files).filter(name => !original.files[name].dir && !allowedBindings.has(name))) {
        const before = original.file(name)!.asNodeBuffer(), after = zip.file(name)!.asNodeBuffer();
        if (name === "[Content_Types].xml") {
          expect(after).toEqual(Buffer.from(before.toString("utf8").replace(/\r\n/g, "\n")));
          expect(new XMLSerializer().serializeToString(new DOMParser().parseFromString(after.toString("utf8"), "application/xml")))
            .toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(before.toString("utf8"), "application/xml")));
        } else expect(after).toEqual(before);
      }
      expect(zip.file("word/header1.xml")!.asText()).toContain("\u8349\u7a3f");
      const word = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "application/xml");
      const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")).map(node => Array.from(node.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join(""));
      const tables = Array.from(word.getElementsByTagNameNS(ns, "tbl"));
      expect(tables.map(table => table.getElementsByTagNameNS(ns, "tblGrid")[0].getElementsByTagNameNS(ns, "gridCol").length)).toEqual([8, 8, 2]);
      expect(tables.map(table => table.getElementsByTagNameNS(ns, "tr").length)).toEqual([2, 2, 1]);
      const totalLiteral = "1.本合同暂定总价（含税）：人民币叁元整。适用税率：0%。";
      for (const literal of [totalLiteral, manualText, "旧任务材料001", "旧任务材料002", "买方（章）：当前单甲方", "卖方（章）：当前单乙方"]) expect(paragraphs).toContain(literal);

      inspectActualTemplatePdf(files.docx, files.pdf, "task10-old-table-layout-actual-queued", output.inputSnapshot.inspection.runtime);
      const result = await promisify(execFile)(python, ["-c",
        "import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); v={'pageCount':len(d),'pages':[''.join(chr(c[0]) for s in p.get_texttrace() for c in s['chars']) for p in d]}; open(sys.argv[2],'x').write(json.dumps(v,ensure_ascii=False,indent=2)); print(json.dumps(v,ensure_ascii=False))",
        join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const drawing = JSON.parse(result.stdout) as { pageCount: number; pages: string[] };
      const drawn = drawing.pages.join("").replace(/\s/gu, "");
      for (const literal of [totalLiteral, manualText, "旧任务材料001", "旧任务材料002", "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "草稿"]) expect(drawn).toContain(literal.replace(/\s/gu, ""));
      expect(uploads.mock.calls).toHaveLength(2);
      for (const [index, bytes] of [files.docx, files.pdf].entries()) expect(hash(uploads.mock.calls[index][0].buffer)).toBe(hash(bytes));
      const historyAfter = (await list(history, draft.headers)).find((item: { id: string }) => item.id === historyBefore.id);
      expect(historyAfter).toMatchObject({ status: "success", docxFileId: historyFiles[0], pdfFileId: historyFiles[1], inputSnapshot: oldSnapshotA });
      expect(historyAfter.inputSnapshot).toEqual(historyBefore.inputSnapshot);
      expect(historyAfter.idempotencyKey).toBe(historyBefore.idempotencyKey);
      const afterBytes = await downloadPair(history, historyAfter, draft.headers);
      expect(hash(afterBytes.docx)).toBe(hash(beforeBytes.docx)); expect(hash(afterBytes.pdf)).toBe(hash(beforeBytes.pdf));
      expect((await workbench(history, draft.headers)).version.latestDraftPreviewDocumentId).toBe(historyBefore.id);
      const executedOwner = await workbench(draft);
      expect(executedOwner.version.latestDraftPreviewDocumentId).toBe(output.id);
      expect(executedOwner.version).toMatchObject({ draftRevision: base.state.version.draftRevision,
        documentContentRevision: base.state.version.documentContentRevision,
        documentContentFingerprint: base.state.version.documentContentFingerprint, draftData: base.state.version.draftData });
      expect(executedOwner.draft).toEqual(base.state.draft); expect(executedOwner.bills).toEqual(base.state.bills);
      expect(Object.hasOwn(executedOwner.draft, "documentRenderProfile")).toBe(false);
      expect(hash(await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx")))).toBe(layout.sha256);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "OLD_NO_LAYOUT_NATIVE_AND_HISTORY_IMMUTABILITY_GREEN",
        pdfPageCount: drawing.pageCount, historyLatestPointerUnchanged: true, queuedLatestPointerPublished: output.id,
        limits: ["Synthetic A historical record, not original GIS business lifecycle replay", "Actual B newly executes frozen no-layout metadata; not byte comparison with a prior B success", "Native Word pagination/full source fonts/layout geometry unproved"] }, null, 2));
      console.info("旧无标记任务实际证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("旧无标记任务实际检查失败，证据 " + directory, { cause });
    } finally { uploads.mockRestore(); await server.app.close(); }
  }, 150_000);
});
