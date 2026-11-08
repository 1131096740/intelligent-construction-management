import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const runtimePath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/runtime-manifest.json";
const inspectionPath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/inspection-manifest.json";
const runtimeSha = "200e2a3be3008e0b9c9c2bca1579024fd1df93d3616613c7fd834c38dd49080a";
const inspectionSha = "c1e9ea341612950b257cc894c5a67fe4c8b9a4b8bdc98962a2cb9d2193edcade";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";
const punctuation = ["公司审批后方可生效，否则不予作为最终结算依据。", "所有工序、工艺，若乙方报价", "向甲方汇报，48小时"];
// Independent worked literals: quantities1,2,3 times100, inclusive tax0.
const expectedAmounts = ["100.0000", "200.0000", "300.0000"];

describe("task10 formal d828 current-profile labor actual private Word/PDF export", () => {
  it("exports current protected zero-percent facts, a saved hand edit and all three source tables in one actual private Word/PDF pair", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("正式劳务实际检查需要原锁定物理环境");
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("正式劳务检查需要准确任务10 API目录");
    expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
    expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
    expect(sha(await readFile(runtimePath))).toBe(runtimeSha);
    expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(lockSha);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-labor-current-export-"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
    const beforeScratch = await readdir(runtime.scratchDirectory);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json(); expect(current.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "formal-labor-00" + i, sortOrder: i - 1, itemName: "正式劳务行00" + i,
        unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json() as Body;
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("材料的使用必须按设计要求")); expect(ordinary).toBeDefined();
      const manualText = ordinary!.text + "双方人工补充劳务约定应当保留。";
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
          contractBasics: { businessType: "labor_subcontract", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
          documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [{ positionId: ordinary!.id, text: manualText }] } },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "合成劳务甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "合成劳务乙方" } }],
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200);
      const wb = await wbResponse.json();
      expect(wb.contract.code).toBeNull();
      expect(wb.parties).toHaveLength(2);
      expect(wb.parties).toEqual(expect.arrayContaining([
        expect.objectContaining({ roleKey: "party_a", snapshot: expect.objectContaining({ name: "合成劳务甲方" }) }),
        expect.objectContaining({ roleKey: "party_b", snapshot: expect.objectContaining({ name: "合成劳务乙方" }) })
      ]));
      expect(wb.version).toMatchObject({ amountYuan: "600.0000", numericProtocolVersion: 2,
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" },
        draftData: { contractBasics: { businessType: "labor_subcontract", amountBasis: "tax_inclusive" }, documentRenderProfile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1" } } });
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(3);
      for (const [i, row] of wb.bills[0].rows.entries()) expect(row).toMatchObject({ itemName: "正式劳务行00" + (i + 1), quantity: String(i + 1), unit: "项", taxRatePercent: "0",
        numericProtocolVersion: 2, numericSource: "decimal_input", taxInclusiveAmountYuan: expectedAmounts[i], taxExclusiveAmountYuan: expectedAmounts[i], taxAmountYuan: "0.0000" });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as Body & { flow: ContractBodyFlow[]; draftRevision: number };
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      expect(body.blocks.find(block => block.id === ordinary!.id)?.text).toBe(manualText);
      const taxPositions = body.blocks.filter(block => block.text.startsWith("本合同采用以下第")); expect(taxPositions).toHaveLength(1);
      expect(taxPositions[0]).toMatchObject({ id: "298826034afdc7bb047479758631c74f5207b80b57b9e83858e8d9fa20032453", editable: false });
      const taxLiteral = "本合同采用以下第   （2）   项计价方式，乙方提供 R增值税专用发票/ □增值税普通发票，税率  0%。";
      expect(taxPositions[0].text).toBe(taxLiteral);
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table");
      expect(tables.map(table => table.rows.length)).toEqual([9, 3, 4]);
      expect(tables[0].rows.map(row => row.cells.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 2]);
      expect(tables[1].rows.map(row => row.cells.length)).toEqual([2, 2, 1]);
      for (let i = 0; i < 3; i++) expect(tables[2].rows[i + 1].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)?.text ?? "").join(""))).toEqual([
        "", "正式劳务行00" + (i + 1), "项", String(i + 1), "100", expectedAmounts[i], ""
      ]);
      const sameResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(sameResponse.status).toBe(200);
      expect((await sameResponse.json()).version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(body, null, 2));
      const documentsBefore = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(documentsBefore.status).toBe(200); expect(await documentsBefore.json()).toEqual([]);
      const asRunPaths = ["services/api/src/contract-template/task10-formal-labor-current-export.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/task09-draft-template.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-workbench/contract-workbench.service.ts", "services/api/src/contract-template/template-pdf-physical.test-support.ts", "services/api/test-support/inspect-contract-pdf-physical.py"];
      await writeFile(join(directory, "as-run-source-pins.json"), JSON.stringify(await Promise.all(asRunPaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      upload.mockClear();
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK"); const generation = await queued.json();
      expect(generation).toMatchObject({ status: "queued", documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const list = async () => { const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return await response.json(); };
      const frozen = { purpose: "draft", layoutTemplateVersionId: layout.id, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { sourceSha256: sourceSha, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha },
          renderInput: { values: { "contract.reviewedLaborTaxBindingVersion": "reviewed-labor-tax-v1", "contract.taxRateLabel": "0%", "contract.amountBasis": "tax_inclusive", "contract.taxInclusiveAmount": "600.0000", "contract.taxExclusiveAmount": "600.0000", "contract.taxAmount": "0.0000" } } } };
      expect((await list()).find((row: { id: string }) => row.id === generation.generationId)).toMatchObject({ ...frozen, status: "queued" });
      const workerStarted = performance.now(); let workerOverBudget = false;
      const timer = setTimeout(() => { workerOverBudget = true; }, 130_000);
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { clearTimeout(timer); await writeFile(join(directory, "worker-budget.json"), JSON.stringify({ elapsedMs: performance.now() - workerStarted, budgetMs: 130_000, ownedOperationSettled: true })); }
      expect(workerOverBudget).toBe(false); expect(performance.now() - workerStarted).toBeLessThanOrEqual(130_000);
      const output = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(output).toMatchObject({ ...frozen, status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      expect(output.inputSnapshot.inspection.runtime).toMatchObject({ engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const scratch = (await readdir(runtime.scratchDirectory)).filter(name => !beforeScratch.includes(name)); expect(scratch).toHaveLength(1);
      const completed = JSON.parse(await readFile(join(runtime.scratchDirectory, scratch[0], "completed.json"), "utf8"));
      expect(completed).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const rawPdf = join(runtime.scratchDirectory, scratch[0], "output.pdf"); expect((await stat(rawPdf)).size).toBeLessThanOrEqual(100_000_000); expect(sha(await readFile(rawPdf))).toBe(completed.pdfSha256);
      await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(completed, null, 2));
      const files = {} as Record<"docx" | "pdf", Buffer>;
      for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const capability = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket-capability`, { headers: draft.headers }); expect(capability.status).toBe(200);
        expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
        const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "正式劳务当前草稿双格式及原条款核验" }) }); expect(ticket.status).toBe(201);
        const { downloadUrl } = await ticket.json(); expect(downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u); const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(downloaded.status).toBe(200);
        files[format] = Buffer.from(await downloaded.arrayBuffer()); await writeFile(join(directory, "actual." + format), files[format]);
      }
      expect(sha(files.docx)).toBe(output.inputSnapshot.inspection.runtime.exportedDocxSha256); expect(sha(files.pdf)).toBe(output.inputSnapshot.inspection.runtime.exportedPdfSha256);
      expect(files.pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(files.pdf.length).toBeLessThanOrEqual(100_000_000);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ sourceSha256: sourceSha, generation, output,
        docxSha256: sha(files.docx), pdfSha256: sha(files.pdf), verdict: "PENDING", legalSigningAcceptance: false }, null, 2));
      const zip = new PizZip(files.docx), original = new PizZip(source); const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
      const word = parse(zip.file("word/document.xml")!.asText()), sourceWord = parse(original.file("word/document.xml")!.asText());
      const paragraphs = (doc: typeof word) => Array.from(doc.getElementsByTagNameNS(ns, "p")).map(p => Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join(""));
      const texts = paragraphs(word), sourceTexts = paragraphs(sourceWord), compact = (s: string) => s.replace(/\s/gu, "");
      expect(texts.filter(t => t.includes("人民币陆佰元整"))).toHaveLength(2);
      expect(texts).toContain(taxLiteral);
      expect(texts.filter(t => t.startsWith("本合同采用以下第"))).toEqual([taxLiteral]);
      const sourceTaxLiteral = sourceTexts.find(t => t.startsWith("本合同采用以下第"))!;
      expect(sourceTaxLiteral).toContain("税率  3   %");
      for (const doc of [sourceWord, word]) {
        const taxParagraphs = Array.from(doc.getElementsByTagNameNS(ns, "p")).filter(p =>
          Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("").startsWith("本合同采用以下第"));
        expect(taxParagraphs).toHaveLength(1);
        const symbolRuns = Array.from(taxParagraphs[0].getElementsByTagNameNS(ns, "r")).filter(run =>
          Array.from(run.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("") === "R");
        expect(symbolRuns).toHaveLength(1);
        const fonts = Array.from(symbolRuns[0].getElementsByTagNameNS(ns, "rFonts")); expect(fonts).toHaveLength(1);
        expect(["ascii", "hAnsi", "eastAsia", "cs"].map(name => fonts[0].getAttributeNS(ns, name))).toEqual(["Wingdings 2", "Wingdings 2", "Wingdings 2", "Wingdings 2"]);
        for (const name of ["sz", "szCs"]) {
          const sizes = Array.from(symbolRuns[0].getElementsByTagNameNS(ns, name)); expect(sizes).toHaveLength(1);
          expect(sizes[0].getAttributeNS(ns, "val")).toBe("28");
        }
      }
      // Plain source clauses are independent inputs. Only the already asserted
      // reviewed tax sentence and explicitly saved ordinary edit may differ.
      for (const text of sourceTexts.filter(text => text.trim() && !/[{}]/u.test(text) && text !== sourceTaxLiteral && text !== ordinary!.text)) expect(texts).toContain(text);
      for (const literal of ["合同金额大写：人民币陆佰元整。", "甲方：合成劳务甲方", "乙方：合成劳务乙方", "发包人：合成劳务甲方（以下简称“甲方”）", "承包人：合成劳务乙方（以下简称“乙方”）", manualText]) expect(texts.map(compact)).toContain(compact(literal));
      const headings = sourceTexts.filter(t => /^[一二三四五六七八九十]+、/u.test(t)); expect(headings.length).toBeGreaterThan(0);
      for (const literal of headings) expect(texts).toContain(literal);
      const wordTables = Array.from(word.getElementsByTagNameNS(ns, "tbl")), sourceTables = Array.from(sourceWord.getElementsByTagNameNS(ns, "tbl")); expect(wordTables).toHaveLength(3);
      // Both signatures contain original blank values and merges, not name tokens.
      const directElements = (parent: Element, name: string) => Array.from(parent.childNodes).filter((node): node is Element =>
        node.nodeType === 1 && (node as Element).namespaceURI === ns && (node as Element).localName === name);
      const signatureXml = (table: Element) => {
        const clone = table.cloneNode(true) as Element;
        const properties = directElements(clone, "tblPr")[0];
        const margins = properties && directElements(properties, "tblCellMar")[0];
        if (!margins) throw new Error("正式签署表缺少原全局边距");
        for (const [alias, logical] of [["left", "start"], ["right", "end"]]) {
          const nodes = directElements(margins, alias); expect(nodes).toHaveLength(1);
          const originalMargin = directElements(margins, logical)[0];
          expect([originalMargin.getAttributeNS(ns, "w"), originalMargin.getAttributeNS(ns, "type")]).toEqual(["80", "dxa"]);
          expect([nodes[0].getAttributeNS(ns, "w"), nodes[0].getAttributeNS(ns, "type")]).toEqual(["80", "dxa"]);
          expect(Array.from(nodes[0].attributes).filter(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/").map(attribute => attribute.localName).sort()).toEqual(["type", "w"]);
          margins.removeChild(nodes[0]);
        }
        return new XMLSerializer().serializeToString(clone);
      };
      // Only v2's already-reviewed equal80dxa aliases are projected away. Every
      // signature text/blank cell/merge/paragraph/run property stays source-equal.
      for (const i of [0, 1]) expect(signatureXml(wordTables[i])).toBe(new XMLSerializer().serializeToString(sourceTables[i]));
      const billRows = Array.from(wordTables[2].getElementsByTagNameNS(ns, "tr")); expect(billRows).toHaveLength(4);
      expect(Array.from(wordTables[2].getElementsByTagNameNS(ns, "gridCol")).map(col => Number(col.getAttributeNS(ns, "w")))).toEqual([680, 2041, 765, 1020, 1276, 1276, 1446]);
      for (let i = 0; i < 3; i++) expect(Array.from(billRows[i + 1].getElementsByTagNameNS(ns, "tc")).map(cell => Array.from(cell.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join(""))).toEqual(["", "正式劳务行00" + (i + 1), "项", String(i + 1), "100", expectedAmounts[i], ""]);
      for (const table of wordTables) { expect(table.getElementsByTagNameNS(ns, "tblHeader").length).toBe(0); for (const row of Array.from(table.getElementsByTagNameNS(ns, "tr"))) expect(row.getElementsByTagNameNS(ns, "cantSplit").length).toBe(1); }
      expect(Object.values(zip.files).filter(part => !part.dir).map(part => part.name).sort()).toEqual(Object.values(original.files).filter(part => !part.dir).map(part => part.name).sort());
      expect(zip.file("word/header1.xml")!.asText()).toContain("草稿");
      const bound = new Set(["word/document.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const part of Object.values(original.files).filter(part => !part.dir && !bound.has(part.name))) {
        const actual = zip.file(part.name)!.asNodeBuffer(), originalBytes = part.asNodeBuffer();
        if (part.name === "[Content_Types].xml") expect(actual).toEqual(Buffer.from(originalBytes.toString("utf8").replace(/\r\n/g, "\n"))); else expect(actual).toEqual(originalBytes);
      }
      inspectActualTemplatePdf(files.docx, files.pdf, "task10-formal-d828-current-profile-three-row-draft", output.inputSnapshot.inspection.runtime);
      const script = `import pymupdf,sys,json

def text(span):
    return ''.join(chr(c[0]) for c in span['chars'])

d = pymupdf.open(sys.argv[1])
pages = []
for p in d:
    spans = p.get_texttrace()
    projected, pairs = [], []
    i = 0
    while i < len(spans):
        a = spans[i]
        b = spans[i + 1] if i + 1 < len(spans) else None
        # Official get_texttrace2Tr representation: one fill+stroke drawing.
        # No text-only/bbox tolerance/global dedup/visibility filtering.
        same_draw = (b is not None and a['type'] == 0 and b['type'] == 1
            and b['seqno'] == a['seqno'] + 1 and a['opacity'] > 0 and b['opacity'] > 0
            and a.keys() == b.keys()
            and all(a[key] == b[key] for key in a if key not in ('type', 'seqno')))
        projected.append(text(a))
        if same_draw:
            pairs.append({'sourceIndices': [i, i + 1], 'fill': a, 'stroke': b})
            i += 2
        else:
            i += 1
    pages.append({'page': p.number + 1, 'width': p.rect.width, 'height': p.rect.height,
        'drawnText': ''.join(projected), 'rawDrawnText': ''.join(text(s) for s in spans),
        'rawSpans': spans, 'fillStrokePairs': pairs})
out = {'pageCount': len(d), 'pages': pages}
with open(sys.argv[2], 'x') as stream:
    json.dump(out, stream, ensure_ascii=False, indent=2)
# Full raw evidence stays in the owned artifact; bounded stdout contains only
# the text used by the original public-pair assertions, never a changed expected.
print(json.dumps({'pageCount': len(d), 'pages': [{'drawnText': p['drawnText']} for p in pages]}, ensure_ascii=False))`;
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawn = compact(actual.pages.map(page => page.drawnText).join(""));
      const pdfTaxLiteral = "本合同采用以下第   （2）   项计价方式，乙方提供 ☑增值税专用发票/ □增值税普通发票，税率  0%。";
      for (const literal of [pdfTaxLiteral, "上游新建当前合同名称", ...headings, "人民币陆佰元整", manualText, "甲方：合成劳务甲方", "乙方：合成劳务乙方", "发包人：合成劳务甲方", "承包人：合成劳务乙方", ...punctuation, "公司名称：（盖章）", "授权委托人：（签章）", "发包人：(盖章)", "承包人：(盖章)", "草稿"]) expect(drawn).toContain(compact(literal));
      expect(drawn.split("人民币陆佰元整")).toHaveLength(3);
      for (const i of [1, 2, 3]) expect(drawn.split("正式劳务行00" + i)).toHaveLength(2);
      expect(upload.mock.calls).toHaveLength(2); expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [i, format] of [[0, "docx"], [1, "pdf"]] as const) expect(sha(upload.mock.calls[i][0].buffer)).toBe(sha(files[format]));
      expect(sha(await readFile(sourcePath))).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "RUNTIME_AND_LITERAL_GATES_GREEN", pageCount: actual.pageCount,
        remaining: ["complete source-to-face/size/paragraph-role matching (including nonempty missing styles)", "source missing BodyText/BodyTextIndent/Heading1/Style13 including eight nonempty references unresolved", "signature blank-space and row/page geometry", "formal template adoption", "native Word pagination and non-draft signing"] }, null, 2));
      console.info("正式劳务当前草稿实际双格式证据：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("正式劳务实际检查失败，证据 " + directory, { cause }); }
    finally {
      upload.mockRestore(); const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 400_000);
});
