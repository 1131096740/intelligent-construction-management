import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 adopted eight-column net draft actual dual-format preview", () => {
  it("exports the actual net draft as matching private Word and PDF bytes without inventing gross facts", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("净额实际双格式检查需要显式锁定物理检查环境");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-net-export-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const beforeResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json() as Body;
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"))!;
      expect(ordinary).toBeDefined();
      const manualText = `${ordinary.text}双方人工补充约定应当保留。`;
      const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as {
        version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }>
      };
      const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
          contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_exclusive", invoiceStatus: "pending" },
          documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manualText }] }
        }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: index ? [] : [{ clientRowKey: "net-row", sortOrder: 0, itemName: "净口径材料", unit: "吨", quantity: "1", unitPrice: "1.5340", customData: {} }] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
      const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(factResponse.status).toBe(200);
      const facts = await factResponse.json() as { version: { amountYuan: string | null; draftData: Record<string, unknown> }; bills: Array<Record<string, unknown>> };
      expect(facts.version).toMatchObject({ amountYuan: "1.5340", draftData: {
        contractBasics: { amountBasis: "tax_exclusive" }
      } });
      expect(facts.bills[0]).toMatchObject({ pricingMode: "tax_exclusive", taxExclusiveAmountYuan: "1.5340", taxInclusiveAmountYuan: null, taxAmountYuan: null });
      const row = (facts.bills[0].rows as Array<Record<string, unknown>>)[0];
      expect(row).toMatchObject({ numericProtocolVersion: 2, numericSource: "decimal_input", quantity: "1", taxRatePercent: null,
        taxExclusiveAmountYuan: "1.5340", taxInclusiveAmountYuan: null, taxAmountYuan: null });
      expect(row.unitPrice).toMatch(/^1\.5340*$/u);
      expect(row.taxExclusiveUnitPrice).toMatch(/^1\.5340*$/u);
      console.info("净税公开行权威", JSON.stringify({ netUnit: row.unitPrice, exclusiveUnit: row.taxExclusiveUnitPrice, rate: row.taxRatePercent,
        net: row.taxExclusiveAmountYuan, gross: row.taxInclusiveAmountYuan, tax: row.taxAmountYuan }));
      console.info("净税公开保存事实", JSON.stringify({ versionAmountYuan: facts.version.amountYuan, contractBasics: facts.version.draftData.contractBasics,
        bill: { pricingMode: facts.bills[0].pricingMode, gross: facts.bills[0].taxInclusiveAmountYuan, net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan } }));
      const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(reread.status).toBe(200);
      const after = await reread.json() as Body & { flow: ContractBodyFlow[]; draftRevision: number };
      const total = after.blocks.find(block => block.text.startsWith("1.本合同暂定总价"))!;
      console.info("净税实际正文总价句", total.text);
      expect(total.text).toContain("本合同暂定总价（不含税）：人民币壹元伍角叁分肆厘");
      expect(total.text).toContain("适用税率：待补充");
      expect(total.text).not.toContain("（含税）：人民币壹元伍角叁分肆厘");
      const table = after.flow.find((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table")!;
      expect(table.rows).toHaveLength(2);
      const cellText = (index: number) => table.rows[1].cells[index].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
      expect(cellText(4)).toBe("1");
      expect(cellText(5)).toBe("待确定"); // Source heading is explicitly 含税单价; raw net price cannot fill it.
      expect(cellText(6)).toBe("待补充");
      expect(cellText(7)).toBe("待确定");
      expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe(manualText);
      expect(after.sourceSha256).toBe(layout.sha256);
      upload.mockClear();
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers,
        body: JSON.stringify({ sourceRevision: after.draftRevision }) });
      const queueText = await queued.text();
      console.info("净税公开生成入口", JSON.stringify({ status: queued.status, sourceRevision: after.draftRevision, result: JSON.parse(queueText) }));
      expect(queued.status === 201 ? "OK" : queueText).toBe("OK");
      const generation = JSON.parse(queueText) as { generationId: string; status: string };
      expect(generation).toMatchObject({ generationId: expect.any(String), status: "queued" });
      const list = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(list.status).toBe(200);
      const documents = await list.json() as Array<{ id: string; status: string; inputSnapshot: Record<string, unknown> }>;
      const document = documents.find(item => item.id === generation.generationId)!;
      expect(document).toMatchObject({ status: "queued", inputSnapshot: {
        bodyDocument: { sourceSha256: layout.sha256, renderSemanticVersion: "contract-money-v1", pdfEngine: "docx4j-17.3.5" },
        renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1", "contract.amountBasis": "tax_exclusive",
          "contract.taxExclusiveAmount": "1.5340", "contract.taxInclusiveAmount": "待确定", "contract.taxAmount": "待确定" } }
      } });
      expect(await server.processor.processNext()).toBe(true);
      const outputResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(outputResponse.status).toBe(200);
      const output = (await outputResponse.json()).find((item: { id: string }) => item.id === generation.generationId);
      expect(output).toMatchObject({ status: "success", purpose: "draft", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
      for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "正式八列模板净额草稿双格式与签署区域排版核验" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json() as { downloadUrl: string };
        const download = await fetch(`${await server.app.getUrl()}${downloadUrl}`);
        expect(download.status).toBe(200);
        files[format] = Buffer.from(await download.arrayBuffer());
        await writeFile(join(directory, `actual.${format}`), files[format]!);
      }
      const zip = new PizZip(files.docx!), originalZip = new PizZip(source);
      const members = Object.values(zip.files).filter(file => !file.dir).map(file => ({ name: file.name, sha256: createHash("sha256").update(file.asNodeBuffer()).digest("hex") })).sort((a, b) => a.name.localeCompare(b.name));
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ purpose: "draft", legalSigningAcceptance: false, sourceSha256: layout.sha256,
        generation, output, members, docxSha256: createHash("sha256").update(files.docx!).digest("hex"), pdfSha256: createHash("sha256").update(files.pdf!).digest("hex"), verdict: "PENDING" }, null, 2));
      // Only these source members contain bound fields. Watermark replacement
      // is intentional; styles/fontTable/themes/relationships remain byte-equal.
      const boundParts = new Set(["word/document.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const name of Object.keys(originalZip.files).filter(name => !boundParts.has(name) && !originalZip.files[name].dir)) {
        const originalPart = originalZip.file(name)!.asNodeBuffer(), actualPart = zip.file(name)!.asNodeBuffer();
        if (name === "[Content_Types].xml") {
          // Existing docxtemplater round-trips this metadata XML. Only its exact
          // CRLF-to-LF serialization change is allowed, never arbitrary XML edits.
          expect(actualPart).toEqual(Buffer.from(originalPart.toString("utf8").replace(/\r\n/g, "\n")));
          const before = new DOMParser().parseFromString(originalPart.toString("utf8"), "application/xml");
          const after = new DOMParser().parseFromString(actualPart.toString("utf8"), "application/xml");
          expect(new XMLSerializer().serializeToString(after)).toBe(new XMLSerializer().serializeToString(before));
          for (const part of [before, after]) for (const tag of ["t", "instrText"]) expect(part.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", tag).length).toBe(0);
        } else expect(actualPart).toEqual(originalPart);
      }
      expect(zip.file("word/header1.xml")!.asText()).toContain("草稿");
      const xml = zip.file("word/document.xml")!.asText();
      // Actual Word paragraphs may split into runs; compare their visible text,
      // leaving original style and non-document ZIP members untouched.
      const word = new DOMParser().parseFromString(xml, "application/xml");
      const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")).map(p => Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join(""));
      const totalLiteral = "1.本合同暂定总价（不含税）：人民币壹元伍角叁分肆厘。适用税率：待补充。";
      expect(paragraphs).toContain(totalLiteral);
      expect(paragraphs).toContain(manualText);
      expect(paragraphs).toContain("买方（章）：当前单甲方");
      expect(paragraphs).toContain("卖方（章）：当前单乙方");
      expect(Array.from(word.getElementsByTagNameNS(ns, "tbl")).map(table => table.getElementsByTagNameNS(ns, "tblGrid")[0].getElementsByTagNameNS(ns, "gridCol").length)).toEqual([8, 2]);
      inspectActualTemplatePdf(files.docx!, files.pdf!, "task10-adopted-material-net-draft", output.inputSnapshot?.inspection?.runtime);
      const script = "import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); pages=[{'page':p.number+1,'width':p.rect.width,'height':p.rect.height,'drawnText':''.join(chr(c[0]) for s in p.get_texttrace() for c in s['chars'])} for p in d]; out={'pageCount':len(d),'pages':pages}; open(sys.argv[2],'x').write(json.dumps(out,ensure_ascii=False,indent=2)); print(json.dumps(out,ensure_ascii=False))";
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawnText = actual.pages.map(page => page.drawnText).join("").replace(/\s/gu, "");
      for (const literal of [totalLiteral, manualText, "净口径材料", "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "草稿"]) expect(drawnText).toContain(literal.replace(/\s/gu, ""));
      expect(upload.mock.calls).toHaveLength(2);
      expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [index, format] of [[0, "docx"], [1, "pdf"]] as const) expect(createHash("sha256").update(upload.mock.calls[index][0].buffer).digest("hex")).toBe(createHash("sha256").update(files[format]!).digest("hex"));
      expect(createHash("sha256").update(await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"))).digest("hex")).toBe(layout.sha256);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "RUNTIME_AND_LITERAL_GATES_GREEN",
        pageCount: actual.pageCount, remaining: ["independent source-to-drawing full font/size matcher", "signature-region geometry", "formal non-draft signing prerequisites", "45 rows/custom long dual facts"] }, null, 2));
      console.info(`正式八列净额草稿实际双格式证据：${directory}`);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error(`正式八列净额草稿实际检查失败，证据 ${directory}`, { cause });
    } finally { upload.mockRestore(); await server.app.close(); }
  }, 150_000);
});
